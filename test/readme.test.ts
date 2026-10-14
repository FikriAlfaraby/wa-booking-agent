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
const review = read<{ items: { model: string; scenario: string; run: number; verdict: string }[] }>("review/2026-10-15.json").items
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8").replace(/\s+/g, " ")
const says = (claim: string) => assert.ok(readme.includes(claim), `the README does not say: ${claim}`)
const count = (runs: Run[], outcome: Run["outcome"]) => runs.filter((r) => r.outcome === outcome).length

describe("the README", () => {
  it("quotes the results table", () => {
    says(`${luna.length + gemini.length} agent turns`)
    says(`| right | ${count(luna, "pass")} of ${luna.length} | ${count(gemini, "pass")} of ${gemini.length} |`)
    says(`| a wrong action | ${count(luna, "wrong")} | ${count(gemini, "wrong")} |`)
    says(`| a missed action | ${count(luna, "missed")} | ${count(gemini, "missed")} |`)
    assert.equal(count(luna, "error") + count(gemini, "error"), 0)
  })

  it("quotes the hand review", () => {
    const asked = review.filter((i) => i.model === "gpt-6-luna" && i.verdict === "asked first").length
    const real = review.filter((i) => i.verdict === "real")
    says(`No wrong action in ${luna.length + gemini.length} turns`)
    assert.equal(count(luna, "wrong") + count(gemini, "wrong"), 0)
    const word = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
    const said = `${word[asked] ?? asked} of its ${word[count(luna, "missed")] ?? count(luna, "missed")} misses came when the lead asked`
    says(said.charAt(0).toUpperCase() + said.slice(1))
    assert.deepEqual(real.map((i) => `${i.model} ${i.scenario} ${i.run}`), ["gpt-6-luna s06 0"])
    says("(s06, run 1)")
  })

  it("says every trap was passed in every run", () => {
    const traps = read<{ scenarios: { id: string; expect: { book: unknown[] } }[] }>("data/scenarios.json").scenarios.filter((s) => s.expect.book.length === 0).map((s) => s.id)
    for (const runs of [luna, gemini]) for (const r of runs) if (traps.includes(r.scenario)) assert.equal(r.outcome, "pass", `${r.scenario} run ${r.run}`)
    says("Every trap was passed in every run")
  })
})
