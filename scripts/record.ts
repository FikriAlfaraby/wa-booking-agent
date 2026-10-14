// Runs the agent on every chat and keeps every model turn, so scoring needs no network:
//
//   LLM_API_KEY=... node scripts/record.ts models/gpt-6-luna.json recordings/<date>-gpt-6-luna.json [--runs 3] [--only s01,s02]
import { readFileSync, writeFileSync } from "node:fs"

import { runAgent } from "../src/agent.ts"
import { openAiModel, type AssistantTurn, type ModelConfig } from "../src/model.ts"
import { loadDataset } from "../src/scenarios.ts"

export interface Recording {
  recordedAt: string
  model: string
  runs: { scenario: string; run: number; turns: AssistantTurn[]; error?: string }[]
}

const [configPath, out, ...flags] = process.argv.slice(2)
if (!configPath || !out) throw new Error("usage: node scripts/record.ts <model.json> <out.json> [--runs N] [--only s01,s02]")
const flag = (name: string) => flags[flags.indexOf(name) + 1]
const runs = flags.includes("--runs") ? Number(flag("--runs")) : 1
const only = flags.includes("--only") ? new Set(flag("--only")?.split(",")) : undefined

const config = JSON.parse(readFileSync(configPath, "utf8")) as ModelConfig
const model = openAiModel(config)
const data = loadDataset()
const recording: Recording = { recordedAt: new Date().toISOString(), model: config.name, runs: [] }
for (const scenario of data.scenarios.filter((s) => !only || only.has(s.id))) {
  for (let run = 0; run < runs; run++) {
    const trace = await runAgent(data.world, scenario, model)
    recording.runs.push({ scenario: scenario.id, run, turns: trace.turns, ...(trace.error ? { error: trace.error } : {}) })
    console.log(`${config.name} ${scenario.id} run ${run + 1}: ${trace.turns.length} model calls${trace.error ? `, ${trace.error}` : ""}`)
    writeFileSync(out, JSON.stringify(recording, null, 1) + "\n") // after every run, so a crash keeps what was recorded
  }
}
