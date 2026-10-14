import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

interface Run {
  scenario: string
  run: number
  outcome: "pass" | "wrong" | "missed" | "error"
}

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as T
const luna = read<{ runs: Run[] }>("results/2026-10-15-gpt-6-luna.json").runs
const gemini = read<{ runs: Run[] }>("results/2026-10-15-gemini-3.8-flash.json").runs
const reviewFile = read<{ items: { model: string; scenario: string; run: number; verdict: string }[]; replies: { model: string; scenario: string; run: number; quote: string }[] }>("review/2026-10-15.json")
const review = reviewFile.items
const replies = reviewFile.replies
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8").replace(/\s+/g, " ")
const says = (claim: string) => assert.ok(readme.includes(claim), `the README does not say: ${claim}`)
const count = (runs: Run[], outcome: Run["outcome"]) => runs.filter((r) => r.outcome === outcome).length

describe("the README", () => {
  it("quotes the results table", () => {
    says(`${luna.length + gemini.length} agent turns`)
    says(`| the calendar right | ${count(luna, "pass")} of ${luna.length} | ${count(gemini, "pass")} of ${gemini.length} |`)
    says(`| a wrong action on the calendar | ${count(luna, "wrong")} | ${count(gemini, "wrong")} |`)
    says(`| a missed action | ${count(luna, "missed")} | ${count(gemini, "missed")} |`)
    const untrue = (model: string) => replies.filter((r) => r.model === model).length
    says(`| a reply that told the lead something untrue (read by hand) | ${untrue("gpt-6-luna")} | ${untrue("gemini-3.8-flash")} |`)
    says(`reading every reply found ${replies.length} that told the lead something untrue`)
    assert.equal(count(luna, "error") + count(gemini, "error"), 0)
  })

  it("quotes the hand review", () => {
    const asked = review.filter((i) => i.model === "gpt-6-luna" && i.verdict === "asked first").length
    const real = review.filter((i) => i.verdict === "real")
    says(`No wrong action on the calendar in ${luna.length + gemini.length} turns`)
    assert.equal(count(luna, "wrong") + count(gemini, "wrong"), 0)
    const word = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
    const said = `${word[asked] ?? asked} of its ${word[count(luna, "missed")] ?? count(luna, "missed")} misses came when the lead asked`
    says(said.charAt(0).toUpperCase() + said.slice(1))
    assert.deepEqual(real.map((i) => `${i.model} ${i.scenario} ${i.run}`), ["gpt-6-luna s06 0"])
    says("(s06, first run)")
    // s21: Luna said the lead's own booking was not available, in all three runs
    assert.deepEqual(replies.filter((r) => r.scenario === "s21").map((r) => `${r.model} ${r.run}`), ["gpt-6-luna 0", "gpt-6-luna 1", "gpt-6-luna 2"])
    says("in all three runs, that her Saturday 14:00 was")
    // the deletion claims: every Gemini opt-out turn, and Luna once
    const deleted = replies.filter((r) => r.quote.toLowerCase().includes("hapus"))
    assert.deepEqual([...new Set(deleted.map((r) => r.model))].sort(), ["gemini-3.8-flash", "gpt-6-luna"])
    assert.equal(deleted.filter((r) => r.model === "gemini-3.8-flash").length, 6)
    assert.equal(deleted.filter((r) => r.model === "gpt-6-luna").length, 1)
    says("Gemini, in all six turns where a lead opted out, and Luna once, said the lead's number had been deleted")
  })

  it("says every trap was passed in every run", () => {
    const traps = read<{ scenarios: { id: string; expect: { book: unknown[] } }[] }>("data/scenarios.json").scenarios.filter((s) => s.expect.book.length === 0).map((s) => s.id)
    for (const runs of [luna, gemini]) for (const r of runs) if (traps.includes(r.scenario)) assert.equal(r.outcome, "pass", `${r.scenario} run ${r.run}`)
    says("By the checker, every trap was passed in every run")
  })
})
