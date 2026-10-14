import { Calendar } from "./calendar.ts"
import type { AssistantTurn, ChatModel, Message } from "./model.ts"
import { systemPrompt, toolSpecs } from "./prompt.ts"
import type { Scenario, World } from "./scenarios.ts"

/** Model calls the agent may make in one turn before it must have replied. */
export const MAX_STEPS = 8

export interface Trace {
  /** Every model turn, in order: enough to replay the run with no network. */
  turns: AssistantTurn[]
  /** The agent's last message to the lead. */
  reply: string
  calendar: Calendar
  /** The turn did not finish: too many steps, or the model could not be reached. */
  error?: string
}

/** The agent's next turn in a chat: call tools until it has something to say, then say it. */
export async function runAgent(world: World, scenario: Scenario, model: ChatModel): Promise<Trace> {
  const calendar = new Calendar(world, scenario)
  const tools = toolSpecs(world)
  const messages: Message[] = [
    { role: "system", content: systemPrompt(world, scenario) },
    ...scenario.chat.map(([who, text]): Message => (who === "lead" ? { role: "user", content: text } : { role: "assistant", content: text })),
  ]
  const turns: AssistantTurn[] = []
  for (let step = 0; step < MAX_STEPS; step++) {
    let turn: AssistantTurn
    try {
      turn = await model.turn(messages, tools)
    } catch (err) {
      return { turns, reply: "", calendar, error: `the model could not be reached: ${(err as Error).message}` }
    }
    turns.push(turn)
    if (turn.toolCalls.length === 0) return { turns, reply: turn.content, calendar }
    messages.push({
      role: "assistant",
      content: turn.content || null,
      tool_calls: turn.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
    })
    for (const call of turn.toolCalls) {
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(calendar.run(call.name, call.arguments)) })
    }
  }
  return { turns, reply: "", calendar, error: `no reply after ${MAX_STEPS} model calls` }
}
