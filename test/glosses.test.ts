import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { describe, it } from "node:test"

import { amounts, isIndonesian, names, problems, shownLines, type RecordedRun } from "../src/glosses.ts"
import { loadDataset } from "../src/scenarios.ts"

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as T
const file = read<{ glosses: Record<string, string | null>; corrected_by_hand: Record<string, string> }>("data/glosses-en.json")
const glosses = file.glosses
const dataset = loadDataset()
const keep = names(dataset)
const results = ["results/2026-10-15-gpt-6-luna.json", "results/2026-10-15-gemini-3.8-flash.json"].map((p) => read<{ runs: RecordedRun[] }>(p).runs)
const quotes = read<{ replies: { quote: string }[] }>("review/2026-10-15.json").replies.map((r) => r.quote)
const english = (line: string) => (glosses[line] ?? "").toLowerCase()

describe("the English glosses", () => {
  it("cover every line the replay shows, in order, and nothing else", () => {
    assert.deepEqual(Object.keys(glosses), shownLines(dataset, results, quotes))
  })

  it("all pass the checks", () => {
    const failing = Object.entries(glosses).flatMap(([line, gloss]) => {
      const found = problems(line, gloss, keep)
      return found.length ? [`${line.slice(0, 60)}: ${found.join("; ")}`] : []
    })
    assert.deepEqual(failing, [])
  })

  it("exist exactly for the lines with Indonesian in them", () => {
    for (const [line, gloss] of Object.entries(glosses)) assert.equal(gloss === null, !isIndonesian(line), line)
  })

  it("say what the lines the findings rest on say", () => {
    // s15: the opt-out the agent must record, and offer nothing more
    const optOut = dataset.scenarios.find((s) => s.id === "s15")?.chat.at(-1)?.[1] ?? ""
    assert.match(english(optOut), /stop/)
    assert.match(english(optOut), /contact/)
    // s11: a tentative yes, not a booking request
    const tentative = dataset.scenarios.find((s) => s.id === "s11")?.chat.at(-1)?.[1] ?? ""
    assert.match(english(tentative), /let you know|get back to you/)
    // "siang" on its own is around midday (11:00 counts), never "afternoon"; "2 siang" is a clock time
    for (const line of Object.keys(glosses).filter((l) => /\bsiang\b/.test(l) && !/\b\d{1,2} siang\b/.test(l))) {
      assert.match(english(line), /midday/, line)
    }
    // s09: the price question is passed to Dimas; no gloss has the agent say the price is negotiable
    for (const [line, gloss] of Object.entries(glosses)) {
      if (/nego/.test(line) && gloss) assert.doesNotMatch(gloss, /(^|[.!?]\s+)(the )?price (can be negotiated|is negotiable)/i, line)
    }
  })

  it("say in English what each untrue reply the page marks said", () => {
    // the replies the page shows, with the reading the review gave each one
    const meant: [RegExp, RegExp][] = [
      [/belum tersedia/, /(not|n['’]t) available/],
      [/hapus/, /delet|remov/],
      [/penuh/, /full/],
      [/[Yy]ang masih kosong/, /only|still free/],
      [/slot siang/, /midday/],
      [/belum ada slot kosong/, /no .*(free|available|open)|nothing/],
    ]
    const models = ["gpt-6-luna", "gemini-3.8-flash"]
    for (const u of read<{ replies: { model: string; scenario: string; run: number; quote: string }[] }>("review/2026-10-15.json").replies) {
      const reply = results[models.indexOf(u.model)]?.find((r) => r.scenario === u.scenario && r.run === u.run)?.reply ?? ""
      assert.ok(reply.replace(/\*\*/g, "").includes(u.quote), `${u.scenario} ${u.model} ${u.run}: the quote is in the reply`)
      const reading = meant.find(([said]) => said.test(u.quote))
      assert.ok(reading, `no reading for "${u.quote}"`)
      assert.match(english(reply), reading[1], `${u.scenario} ${u.model} ${u.run}`)
    }
  })

  it("edited by hand say why, and still pass", () => {
    for (const [line, why] of Object.entries(file.corrected_by_hand)) {
      assert.ok(why.trim() && line in glosses && !problems(line, glosses[line] ?? null, keep).length, line)
    }
  })
})

describe("the gloss checks", () => {
  const wrong: [string, string | null, string][] = [
    ["Besok jam 2 siang bisa lihat yang di Cluster Anggrek kak?", "Can I view it tomorrow at 3 pm?", "the number 2 is missing"],
    ["Besok jam 2 siang bisa lihat yang di Cluster Anggrek kak?", "Can I see the one tomorrow at 2 pm?", "Cluster Anggrek is missing"],
    ["Harganya Rp 2,1 miliar ya kak", "The price is Rp 21 billion.", "the gloss adds the number 21000000000"],
    ["Sudah dipesan untuk Sabtu pukul 14.00 WIB", "Booked for Saturday at 15:00 WIB.", "the number 14:00 is missing"],
    ["Siap kak, sudah saya pesan BK-N1", "Sure, I booked it.", "BK-N1 is missing"],
    ["Siap kak, sudah dipesan", "Siap, it is booked.", "the Indonesian word 'Siap'"],
    ["Halo Kak Rina, mau lihat kapan?", "Hi, when would you like to view it?", "Rina is missing"],
    ["Halo kak, ada yang bisa dibantu?", null, "the line is Indonesian but has no gloss"],
    ["Is Saturday 4 pm free?", "Is Saturday 4 pm free?", "it needs no gloss"],
    ["aku lihat2 dulu ya kak", "I'll look around2 first.", "a repeated word written with 2"],
    ["Jadwal:\n- Sabtu 09.00\n- Sabtu 14.00", "Times: Saturday 09:00, Saturday 14:00", "line breaks"],
    ["Kak Jumat jam 7 malam bisa lihat rumahnya?", "Can I see the house on Friday at 7 am?", "wrong half of the day"],
    ["Kak Sabtu jam 3 sore bisa lihat?", "Can I view it on Sunday at 3 pm?", "Saturday is missing"],
    ["Sabtu jam 14.00 belum tersedia", "Saturday at 14.00 is available", "the gloss does not"],
    ["Untuk pertanyaan nego, Mas Dimas akan membalas.", "Mas Dimas will reply about the negotiation.", "'Mas'"],
    ["Halo Bu Lina!", null, "the line is Indonesian but has no gloss"],
  ]
  for (const [line, gloss, problem] of wrong) {
    it(`catch: ${problem}`, () => {
      const found = problems(line, gloss, keep)
      assert.ok(found.some((f) => f.includes(problem)), found.join("; "))
    })
  }

  const right: [string, string | null][] = [
    ["Harganya Rp 2,1 miliar ya kak", "The price is Rp 2.1 billion."],
    ["Sudah dipesan untuk Sabtu pukul 14.00 WIB", "Booked for Saturday at 14:00 WIB."],
    ["Besok jam 2 siang bisa lihat yang di Cluster Anggrek kak?", "Can I see the one in Cluster Anggrek tomorrow at 2 pm?"],
    ["Kirim ke Dan ya kak", "Send it to Dan, please."],
    ["Is Saturday 4 pm free?", null],
    ["Hi Dan, could I come at 4pm?", null],
    ["Ga jadi kak, saya udah dapet rumah lain.", "I changed my mind. I've already found another house."],
    ["Kamis 1 November kosong?", "Is Thursday, 1 November free?"],
    ["Harganya Rp 2,1 milyar ya kak", "The price is Rp 2.1 billion."],
  ]
  for (const [line, gloss] of right) {
    it(`pass: ${gloss}`, () => assert.deepEqual(problems(line, gloss, keep), []))
  }

  it("read amounts with their unit", () => {
    assert.deepEqual(amounts("Rp 2,1 miliar"), ["2100000000"])
    assert.deepEqual(amounts("Rp 2.1 billion"), ["2100000000"])
    assert.deepEqual(amounts("Rp45.000 and Rp45,000"), ["45000", "45000"])
    assert.deepEqual(amounts("14.00 or 14:00"), ["14:00", "14:00"])
    assert.deepEqual(amounts("lihat2 x2 Rp2.000"), ["2", "2000"])
  })
})

describe("the glosses never reach the agent", () => {
  it("nothing in src/ besides glosses.ts names them", () => {
    for (const name of readdirSync(new URL("../src/", import.meta.url))) {
      if (name === "glosses.ts") continue
      assert.doesNotMatch(readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"), /glosses/, name)
    }
  })
})
