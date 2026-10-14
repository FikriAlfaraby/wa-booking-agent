import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { describe, it } from "node:test"

interface ResultRun {
  scenario: string
  run: number
  outcome: string
  reply: string
  calls: { tool: string }[]
}

interface ReviewItem {
  model: string
  scenario: string
  run: number
  outcome: string
  verdict: "asked first" | "real"
  note: string
}

const dir = (path: string) => new URL(`../${path}/`, import.meta.url)
const read = <T>(path: URL) => JSON.parse(readFileSync(path, "utf8")) as T
const results = readdirSync(dir("results"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => read<{ model: string; runs: ResultRun[] }>(new URL(f, dir("results"))))
const review = readdirSync(dir("review"))
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => read<{ items: ReviewItem[] }>(new URL(f, dir("review"))).items)
const key = (model: string, scenario: string, run: number) => `${model} ${scenario} ${run}`

describe("the review of every turn the checker did not pass", () => {
  it("covers each such turn once, and nothing else", () => {
    const flagged = results.flatMap((r) => r.runs.filter((x) => x.outcome !== "pass").map((x) => key(r.model, x.scenario, x.run))).sort()
    assert.deepEqual(review.map((i) => key(i.model, i.scenario, i.run)).sort(), flagged)
  })

  it("calls a turn 'asked first' only when the agent booked nothing and asked a question", () => {
    for (const item of review.filter((i) => i.verdict === "asked first")) {
      const run = results.find((r) => r.model === item.model)?.runs.find((x) => x.scenario === item.scenario && x.run === item.run)
      assert.ok(run, key(item.model, item.scenario, item.run))
      assert.equal(run.outcome, "missed")
      assert.ok(!run.calls.some((c) => c.tool === "book_viewing"), `${item.scenario}: booked`)
      assert.match(run.reply, /\?/, `${item.scenario}: no question in the reply`)
    }
  })

  it("gives every item a verdict and a note in words", () => {
    for (const item of review) {
      assert.ok(["asked first", "real"].includes(item.verdict), item.verdict)
      assert.ok(item.note.length > 40, item.note)
    }
  })
})
