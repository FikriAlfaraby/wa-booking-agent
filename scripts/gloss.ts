// Write data/glosses-en.json: an English line for every Indonesian line the replay shows.
//
//   LLM_API_KEY=... node scripts/gloss.ts [models/gpt-6-luna.json]
//
// Glosses already in the file that pass the checks are kept; only the rest are sent, in batches. A
// gloss that fails a check (src/glosses.ts) is asked for again with the reasons, twice at most; what
// still fails is listed at the end and left out of the file. Glosses edited by hand stay as they are.

import { existsSync, readFileSync, writeFileSync } from "node:fs"

import { names, problems, shownLines, type RecordedRun } from "../src/glosses.ts"
import { openAiModel, type ModelConfig } from "../src/model.ts"
import { loadDataset } from "../src/scenarios.ts"

const SYSTEM = `You translate lines from WhatsApp chats into English for readers who do not speak Indonesian. The
chats are between leads (people interested in a house or an apartment near Jakarta: BSD, Serpong,
Kemang) and an AI agent that books property viewings for Dimas, the property agent. The lines were
written by leads and by the agent, and include the text the agent passed to its booking tools. Many
are informal WhatsApp Indonesian with abbreviations (yg = yang, udh/sdh = sudah, blm = belum,
gk/ga/gak = tidak, aja = saja, brp = berapa).

Translate each line into natural English that says exactly what the line says: the same facts,
requests and tone (casual stays casual). Do not add, explain or leave out anything.

Words of these chats:
- pagi = morning; siang = midday to early afternoon; sore = late afternoon; malam = evening.
  jam 2 siang = 2 pm. besok = tomorrow; lusa = the day after tomorrow. Senin to Minggu are Monday to
  Sunday; Oktober = October; pukul = at; WIB stays WIB.
- kak, kakak, mas, mbak, bu, pak are polite forms of address: leave them out, but keep a name that
  follows them.
- A 2 written after a word repeats the word, it is not the number two: lihat2 = look around.
- viewing stays viewing; lead stays lead.

Keep exactly as written: every number and time (14.00 stays 14.00 or becomes 14:00; jam 2 is 2;
Rp 2,1 miliar may become Rp 2.1 billion), names of people, Cluster Anggrek, Serpong Garden, BSD,
Kemang, listing names, IDs (bsd-anggrek-12, BK-N1), emoji, Markdown (**bold**, lists, line breaks).

If a line is a JSON object, return the same JSON object, with the same keys, as a string,
translating only the human-readable text inside it.

If a line is already entirely in English, return null for it.

You receive a JSON object that maps ids to lines. Answer with one JSON object that maps every id to
its English line (or null), and nothing else.`

const PATH = new URL("../data/glosses-en.json", import.meta.url)
const BATCH_CHARS = 5000
const BATCH_LINES = 20

interface GlossFile {
  about: string
  model: string
  glosses: Record<string, string | null>
  corrected_by_hand: Record<string, string>
}

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as T
const config = JSON.parse(readFileSync(process.argv[2] ?? new URL("../models/gpt-6-luna.json", import.meta.url), "utf8")) as ModelConfig
// a batch of 20 lines needs more room than one agent turn
const model = openAiModel({ ...config, maxTokens: 4096 })
const dataset = loadDataset()
const keep = names(dataset)
const results = ["results/2026-10-15-gpt-6-luna.json", "results/2026-10-15-gemini-3.8-flash.json"].map((p) => read<{ runs: RecordedRun[] }>(p).runs)
const quotes = read<{ replies: { quote: string }[] }>("review/2026-10-15.json").replies.map((r) => r.quote)
const order = shownLines(dataset, results, quotes)
const file: GlossFile = existsSync(PATH)
  ? (JSON.parse(readFileSync(PATH, "utf8")) as GlossFile)
  : { about: "", model: config.model, glosses: {}, corrected_by_hand: {} }

function parse(answer: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""))
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
}

async function ask(content: string): Promise<Record<string, unknown>> {
  try {
    const turn = await model.turn([{ role: "system", content: SYSTEM }, { role: "user", content }], [])
    return parse(turn.content)
  } catch {
    return {}
  }
}

const asText = (value: unknown): string | null =>
  typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : null

/** Glosses for a batch; failures are asked again one by one with their problems. */
async function translate(lines: string[]): Promise<Map<string, string | null>> {
  const ids = Object.fromEntries(lines.map((line, i) => [String(i + 1), line]))
  const answer = await ask(JSON.stringify(ids))
  const out = new Map<string, string | null>()
  for (const [key, line] of Object.entries(ids)) {
    let gloss = asText(answer[key])
    for (let attempt = 0; attempt < 2; attempt++) {
      const found = problems(line, gloss, keep)
      if (!found.length) break
      const retry = `Line: ${JSON.stringify(line)}\nYour English: ${JSON.stringify(gloss)}\nProblems: ${found.join("; ")}.\nTranslate the line again. Answer with {"1": "..."} only.`
      gloss = asText((await ask(retry))["1"])
    }
    out.set(line, gloss)
  }
  return out
}

function batches(lines: string[]): string[][] {
  const out: string[][] = []
  let current: string[] = []
  let size = 0
  for (const line of lines) {
    if (current.length && (size + line.length > BATCH_CHARS || current.length >= BATCH_LINES)) {
      out.push(current)
      current = []
      size = 0
    }
    current.push(line)
    size += line.length
  }
  return current.length ? [...out, current] : out
}

function save() {
  const glosses = Object.fromEntries(order.filter((line) => line in file.glosses).map((line) => [line, file.glosses[line] ?? null]))
  const about =
    "English glosses for readers of the replay. The agent saw only the original lines. Written by scripts/gloss.ts " +
    "with the model below and checked by test/glosses.test.ts: no Indonesian left, every number with its unit and " +
    "every name the dataset knows kept. null: the line has no Indonesian in it."
  writeFileSync(PATH, `${JSON.stringify({ about, model: config.model, glosses, corrected_by_hand: file.corrected_by_hand }, null, 1)}\n`)
}

const todo = order.filter((line) => !(line in file.glosses) || problems(line, file.glosses[line] ?? null, keep).length)
console.log(`${order.length} lines shown, ${order.length - todo.length} glossed already, ${todo.length} to do`)
const chunks = batches(todo)
let next = 0
let done = 0
async function worker() {
  for (let i = next++; i < chunks.length; i = next++) {
    for (const [line, gloss] of await translate(chunks[i] ?? [])) {
      if (!problems(line, gloss, keep).length) file.glosses[line] = gloss
      else if (!problems(line, null, keep).length) file.glosses[line] = null // not Indonesian: no gloss needed
    }
    save()
    console.log(`  batch ${++done}/${chunks.length}`)
  }
}
await Promise.all([worker(), worker(), worker()])
const failing = order.filter((line) => !(line in file.glosses))
console.log(`${order.length - failing.length} of ${order.length} lines glossed; ${failing.length} still failing`)
for (const line of failing.slice(0, 40)) console.log(`  - ${line.slice(0, 160).replace(/\n/g, " ")}`)
