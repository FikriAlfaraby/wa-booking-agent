/**
 * English glosses for readers who do not read Indonesian.
 *
 * data/glosses-en.json pairs every line the replay on fikrialfaraby.com/booking-agent shows (the
 * chats, each agent's reply, the text the agents passed to tools), plus the quotes in the review,
 * with an English line, or with null when the line has no Indonesian in it. `problems` checks that a
 * gloss says the same thing: no Indonesian left; every number with its unit; the leads', friends'
 * and places' names; every weekday; a "not" where the line says belum or tidak; morning and evening
 * hours not swapped; line breaks and length about the same. It cannot see every change of meaning,
 * so the replies a finding rests on are pinned by hand in test/glosses.test.ts. The agent never sees
 * a gloss: nothing in src/ besides this file names it.
 */

import type { Dataset } from "./scenarios.ts"

/** Indonesian chat words (and a few Javanese and Sundanese ones) that English never uses. */
const WORDS = `yang yg dan di ke dari untuk utk buat dengan dgn ini itu tidak tdk nggak ngga gak ga gk enggak ya iya
kak ka kakak sudah udah udh sdh belum blm bisa ada aku saya sy kamu mau juga atau kalau kalo klo jadi jd sama
lagi apa gimana dong aja tapi tp karena krn akan harus pada dalam adalah bahwa hari besok lusa kemarin kmrn
terima kasih makasih silakan mohon tolong kirim berapa brp boleh kok sih deh nih tuh banget sekarang skrg
nanti tadi dulu lebih kurang semua minta pakai pake dapat dapet siap baik sampai sampe lihat liat cek bentar
sebentar bagaimana kenapa kapan mana masih sedang hanya cuma saja kami kita anda dia mereka terus lalu jangan
jgn maaf nomor sesuai oke rumah ingin pukul siang pagi malam jadwal kosong penuh tersedia hapus dihapus
hubungi lantai apartemen kamar teman temen suami istri harga nego sertifikat kedua pertama ketiga kayaknya
kabarin kabari januari februari maret mei juni juli agustus oktober desember senin selasa rabu kamis jumat
sabtu minggu halo pak bu ibu bapak mas mbak selamat betul cocok pilih nama lain langsung waktu jika apakah
dibatalkan pertanyaan legalitas`.split(/\s+/)
/** Indonesian words that are also English ("jam", "sore"): they make a line Indonesian, but an English
 * gloss may use them. Months spelt the same in both (April, September, November) count for neither. */
const DETECT_ONLY = /\b(jam|sore)\b/i
/** Short words that are also English words or names when capitalised ("Hello Dan", "Ada"): in a gloss
 * they count only in lower case. A line is Indonesian if it has any word above, in any case. */
const AMBIGUOUS = new Set(["dan", "di", "ke", "ya", "ada", "apa", "mana", "dia", "sama", "mau", "kita", "ka", "ga", "aku"])
const STRICT = new RegExp(`\\b(${WORDS.filter((w) => !AMBIGUOUS.has(w)).join("|")})\\b`, "i")
const LOWER = new RegExp(`\\b(${[...AMBIGUOUS].join("|")})\\b`)
/** warnanya, nomornya: the -nya forms the list cannot hold one by one (not Kenya, not Tanya). */
const NYA = /\b[a-z]{3,}nya\b/i
/** A number, with the unit that scales it: 227rb, 2,1 miliar, 227k, 2.1 billion. */
const AMOUNT = /(?<![\d.,:])(\d+(?:[.,:]\d+)*)(?:\s?(rb|ribu|k|jt|juta|thousand|million|miliar|milyar|billion|bn)\b)?/gi
const ZEROS: Record<string, number> = {
  rb: 3, ribu: 3, k: 3, thousand: 3, jt: 6, juta: 6, million: 6, miliar: 9, milyar: 9, billion: 9, bn: 9,
}
/** In chat Indonesian a 2 after a word repeats it: lihat2 is lihat-lihat, not two. Not after p or x
 * (Rp2.000, x2), and not when more digits follow. */
const REPEAT = /(?<=[a-oq-wyz])2(?![.,]?\d)\b/g
/** Booking and listing IDs: BK-N1, bsd-anggrek-12. */
const ID = /\b(?:[A-Z]{2,}-[A-Z0-9]+|[a-z]+(?:-[a-z0-9]+)+-\d+)\b/g

/** A line is Indonesian when it has one of the words above; the short ones count only in lower case,
 * so "Hi Dan, could I come at 4pm?" is English. */
export const isIndonesian = (text: string): boolean =>
  STRICT.test(text) || LOWER.test(text) || NYA.test(text) || DETECT_ONLY.test(text)

const DAYS: [RegExp, RegExp, string][] = [
  [/\bsenin\b/i, /\bmon(day)?\b/i, "Monday"],
  [/\bselasa\b/i, /\btue(s|sday)?\b/i, "Tuesday"],
  [/\brabu\b/i, /\bwed(nesday)?\b/i, "Wednesday"],
  [/\bkamis\b/i, /\bthu(rs|rsday)?\b/i, "Thursday"],
  [/\bjumat\b/i, /\bfri(day)?\b/i, "Friday"],
  [/\bsabtu\b/i, /\bsat(urday)?\b/i, "Saturday"],
  // lower-case minggu is also "week"; Minggu, or hari minggu, is Sunday
  [/\bMinggu\b|\bhari minggu\b/, /\bsun(day)?\b/i, "Sunday"],
]
const NEGATION = /\b(tidak|tdk|belum|blm|bukan|jangan|jgn|gak|nggak|ngga|enggak|gk|ga|tak)\b/i
/** "ga jadi" (changed my mind) and "tidak apa-apa" (it's fine) carry no "not" in English. */
const IDIOM = /\b(ga|gak|nggak|ngga|enggak|tidak|tdk|gk)\s+(jadi|apa-apa|apa2|papa|masalah)\b/gi
const NOT = /\b(not|no|never|none|nothing|nobody|cannot|without|neither|nor|unavailable|longer)\b|n['’]t\b/i
/** "jam 7 malam" is 7 pm and "jam 9 pagi" is 9 am: a gloss must not turn one into the other. */
const HOUR = /\bjam\s+(\d{1,2})(?:[.:]\d{2})?\s+(pagi|siang|sore|malam)\b/gi
const AM = String.raw`(am|a\.m\.)`
const PM = String.raw`(pm|p\.m\.)`

function indonesianLeft(gloss: string): string | null {
  return (STRICT.exec(gloss) ?? LOWER.exec(gloss) ?? NYA.exec(gloss))?.[0] ?? null
}

/** Moves the decimal point `zeros` places right, exactly: ("2", "1", 9) is 2100000000. */
function scaled(whole: string, fraction: string, zeros: number): string {
  const point = whole.length + zeros
  const digits = (whole + fraction).padEnd(point, "0")
  const int = digits.slice(0, point).replace(/^0+(?=\d)/, "")
  const rest = digits.slice(point).replace(/0+$/, "")
  return rest ? `${int}.${rest}` : int
}

/** Each number as the value it stands for: Rp 2,1 miliar and 2.1 billion are 2100000000, 14.00 and
 * 14:00 are the time 14:00, Rp45.000 and Rp45,000 are 45000. */
export function amounts(text: string): string[] {
  const out: string[] = []
  for (const [, raw = "", unit] of text.replace(REPEAT, "").matchAll(AMOUNT)) {
    const time = /^(\d{1,2})[.:](\d{2})$/.exec(raw)
    if (time && !unit) {
      out.push(`${Number(time[1])}:${time[2]}`)
      continue
    }
    const groups = raw.split(/[.,:]/)
    const zeros = unit ? (ZEROS[unit.toLowerCase()] ?? 0) : 0
    if (groups.length === 1 || groups.slice(1).every((g) => g.length === 3)) out.push(scaled(groups.join(""), "", zeros))
    else if (groups.length === 2) out.push(scaled(groups[0] ?? "", groups[1] ?? "", zeros))
    else out.push(...groups.map((g) => String(Number(g))))
  }
  return out
}

/** Names a gloss must keep when its line has them: the agent, each lead and each person a booking
 * is for (full and first name), and the places the listings are known by. */
export function names(dataset: Dataset): string[] {
  const out = new Set<string>([dataset.world.agent, "Cluster Anggrek", "Serpong Garden", "BSD", "Kemang"])
  for (const s of dataset.scenarios) {
    for (const person of [s.lead, ...[...s.expect.book, ...s.taken, ...s.bookings].map((b) => b.attendee)]) {
      out.add(person)
      const first = person.split(" ")[0]
      if (first) out.add(first)
    }
  }
  return [...out].sort((a, b) => b.length - a.length)
}

/** What a gloss gets wrong about days, negation and the time of day, which numbers alone miss. */
function meaningProblems(line: string, gloss: string): string[] {
  const found: string[] = []
  for (const [said, meant, day] of DAYS) if (said.test(line) && !meant.test(gloss)) found.push(`${day} is missing`)
  if (NEGATION.test(line.replace(IDIOM, " ")) && !NOT.test(gloss)) found.push("the line says not (belum, tidak…) and the gloss does not")
  for (const [, hour = "", part = ""] of line.matchAll(HOUR)) {
    const h = Number(hour)
    const when = part.toLowerCase()
    // jam 10 or 11 siang may be am; any other siang, sore or malam hour is pm; pagi is am
    const wrong = when === "pagi" ? PM : when === "siang" && h >= 10 ? null : AM
    if (wrong && new RegExp(String.raw`\b${h}\s?${wrong}(?!\w)`, "i").test(gloss)) found.push(`jam ${hour} ${part} turned into the wrong half of the day`)
  }
  return found
}

function jsonProblem(line: string, gloss: string): string | null {
  if (!line.trimStart().startsWith("{")) return null
  let said: unknown
  try {
    said = JSON.parse(line)
  } catch {
    return null
  }
  if (!said || typeof said !== "object" || Array.isArray(said)) return null
  let meant: unknown
  try {
    meant = JSON.parse(gloss)
  } catch {
    meant = null
  }
  const keys = (o: object) => Object.keys(o).sort().join("\n")
  return meant && typeof meant === "object" && !Array.isArray(meant) && keys(meant) === keys(said)
    ? null
    : "the line is a JSON object: the gloss must be the same object with its text in English"
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const breaks = (s: string) => s.split("\n").length - 1

/** Why a gloss does not stand for its line in English; empty when it does. */
export function problems(line: string, gloss: string | null, keep: string[]): string[] {
  if (gloss === null) return isIndonesian(line) ? ["the line is Indonesian but has no gloss"] : []
  if (!isIndonesian(line)) return ["the line has no Indonesian in it: it needs no gloss"]
  if (!gloss.trim() || gloss.trim() === line.trim()) return ["the gloss is empty or repeats the line"]
  const found: string[] = []
  const plain = keep.reduce((text, name) => text.replaceAll(name, " "), gloss).replace(ID, " ")
  const left = indonesianLeft(plain)
  if (left) found.push(`the gloss still has the Indonesian word '${left}'`)
  const english = amounts(gloss)
  const said = amounts(line)
  for (const n of said) if (!english.includes(n)) found.push(`the number ${n} is missing`)
  for (const e of english) if (!said.includes(e)) found.push(`the gloss adds the number ${e}`)
  if (new RegExp(REPEAT.source).test(gloss)) found.push("the gloss keeps a repeated word written with 2 (lihat2 means look around)")
  for (const [id] of line.matchAll(ID)) {
    if (!new RegExp(`(?<!\\w)${escape(id)}(?!\\w)`).test(gloss)) found.push(`${id} is missing`)
  }
  for (const name of keep) {
    if (new RegExp(`(?<!\\w)${escape(name)}(?!\\w)`).test(line) && !gloss.includes(name)) found.push(`${name} is missing`)
  }
  if (!line.trimStart().startsWith("{") && (line.split('"').length - gloss.split('"').length) % 2 !== 0) {
    found.push("the gloss has a stray quote mark")
  }
  if (breaks(line) !== breaks(gloss)) found.push(`the gloss has ${breaks(gloss)} line breaks, the line ${breaks(line)}`)
  found.push(...meaningProblems(line, gloss))
  const shape = jsonProblem(line, gloss)
  if (shape) found.push(shape)
  const [low, high] = line.length >= 80 ? [0.65, 2.0] : [0.4, 2.5]
  const ratio = gloss.length / line.length
  if (line.length >= 40 && (ratio < low || ratio > high)) found.push(`the gloss is ${gloss.length} characters for a line of ${line.length}`)
  return [...new Set(found)]
}

export interface RecordedRun {
  scenario: string
  run: number
  reply: string
  calls: { tool: string; args: unknown; result: unknown }[]
}

/** Every distinct line the replay shows a reader, in the order first seen: the chats, the replies of
 * each model, the text arguments of tool calls, the review's quotes. */
export function shownLines(dataset: Dataset, results: RecordedRun[][], quotes: string[]): string[] {
  const seen = new Set<string>()
  const add = (text: unknown) => {
    if (typeof text === "string" && text.trim()) seen.add(text)
  }
  for (const s of dataset.scenarios) for (const [, text] of s.chat) add(text)
  for (const runs of results) {
    for (const r of runs) {
      add(r.reply)
      for (const call of r.calls) {
        if (call.args && typeof call.args === "object") Object.values(call.args).forEach(add)
      }
    }
  }
  quotes.forEach(add)
  return [...seen]
}
