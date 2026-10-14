// Replays every recorded turn through the real agent loop and calendar, checks what the agent did,
// and writes results/<recording>.json. No network.
//
//   node scripts/score.ts recordings/*.json            write the results
//   node scripts/score.ts --check recordings/*.json    fail if a fresh score differs from results/
import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"

import { runAgent } from "../src/agent.ts"
import { check, type Finding, type Outcome } from "../src/check.ts"
import { replayModel } from "../src/model.ts"
import { loadDataset } from "../src/scenarios.ts"
import type { Recording } from "./record.ts"

const args = process.argv.slice(2)
const checkOnly = args.includes("--check")
const data = loadDataset()
let differs = false
for (const path of args.filter((a) => a !== "--check")) {
  const recording = JSON.parse(readFileSync(path, "utf8")) as Recording
  const runs: { scenario: string; run: number; outcome: Outcome; findings: Finding[]; reply: string; calls: { tool: string; args: unknown; result: unknown }[] }[] = []
  for (const r of recording.runs) {
    const scenario = data.scenarios.find((s) => s.id === r.scenario)
    if (!scenario) throw new Error(`${path}: unknown scenario ${r.scenario}`)
    const trace = await runAgent(data.world, scenario, replayModel(recording.model, r.turns))
    if (!trace.error && r.error) throw new Error(`${path} ${r.scenario}: the replay finished but the run had failed`)
    const { outcome, findings } = check(data.world, scenario, { ...trace, ...(r.error ? { error: r.error } : {}) })
    runs.push({ scenario: r.scenario, run: r.run, outcome, findings, reply: trace.reply, calls: trace.calendar.events.map(({ tool, args, result }) => ({ tool, args, result })) })
  }
  const text = JSON.stringify({ model: recording.model, recordedAt: recording.recordedAt, runs }, null, 1) + "\n"
  const target = new URL(`../results/${basename(path)}`, import.meta.url)
  if (checkOnly) {
    if (readFileSync(target, "utf8") !== text) {
      differs = true
      console.error(`a fresh score of ${path} differs from results/${basename(path)}`)
    } else console.log(`matches results/${basename(path)}`)
  } else {
    writeFileSync(target, text)
    const count = (o: Outcome) => runs.filter((r) => r.outcome === o).length
    console.log(`results/${basename(path)}: ${count("pass")} pass, ${count("wrong")} wrong, ${count("missed")} missed, ${count("error")} error`)
  }
}
if (differs) process.exit(1)
