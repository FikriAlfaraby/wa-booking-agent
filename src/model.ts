/**
 * A chat model that can call tools, behind an OpenAI-compatible endpoint (a local gateway here).
 * Some gateways answer with SSE chunks even when not asked to stream; the parser reads both, and
 * puts a tool call's arguments back together from its chunks.
 */

export interface ToolCall {
  id: string
  name: string
  /** The arguments as the model wrote them: a JSON string, not yet checked. */
  arguments: string
}

export interface Usage {
  input: number
  output: number
}

export interface AssistantTurn {
  content: string
  toolCalls: ToolCall[]
  finish: string | null
  usage: Usage | null
}

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string }

export interface ChatModel {
  name: string
  turn(messages: Message[], tools: unknown[]): Promise<AssistantTurn>
}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`)
    this.status = status
  }
}

export class IncompleteReply extends Error {}

interface WireCall {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface WireChoice {
  message?: { content?: string | null; tool_calls?: WireCall[] }
  delta?: { content?: string | null; tool_calls?: WireCall[] }
  finish_reason?: string | null
}

interface WireBody {
  choices?: WireChoice[]
  error?: { message?: string }
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

const usageOf = (body: WireBody): Usage | null =>
  body.usage?.prompt_tokens === undefined || body.usage.completion_tokens === undefined ? null : { input: body.usage.prompt_tokens, output: body.usage.completion_tokens }

/** One assistant turn, whether the server answered with JSON or with SSE chunks. */
export function parseTurn(body: string): AssistantTurn {
  const trimmed = body.trim()
  if (!/^(data:|:|event:)/.test(trimmed)) {
    let parsed: WireBody
    try {
      parsed = JSON.parse(trimmed) as WireBody
    } catch {
      throw new IncompleteReply(`the reply is neither JSON nor a stream: ${trimmed.slice(0, 120)}`)
    }
    if (parsed.error) throw new IncompleteReply(`API error: ${parsed.error.message ?? "unknown"}`)
    const choice = parsed.choices?.[0]
    const calls = (choice?.message?.tool_calls ?? []).map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.function?.name ?? "", arguments: c.function?.arguments ?? "" }))
    return { content: choice?.message?.content ?? "", toolCalls: calls, finish: choice?.finish_reason ?? null, usage: usageOf(parsed) }
  }
  let content = ""
  let finish: string | null = null
  let usage: Usage | null = null
  let done = false
  const calls = new Map<number, ToolCall>()
  for (const line of trimmed.split("\n")) {
    if (!line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (data === "[DONE]") {
      done = true
      continue
    }
    if (!data) continue
    let chunk: WireBody
    try {
      chunk = JSON.parse(data) as WireBody
    } catch {
      throw new IncompleteReply("a stream chunk was cut off")
    }
    if (chunk.error) throw new IncompleteReply(`API error in the stream: ${chunk.error.message ?? "unknown"}`)
    const choice = chunk.choices?.[0]
    const part = choice?.delta ?? choice?.message
    content += part?.content ?? ""
    for (const [i, c] of (part?.tool_calls ?? []).entries()) {
      const index = c.index ?? i
      const call = calls.get(index) ?? { id: "", name: "", arguments: "" }
      if (c.id) call.id = c.id
      if (c.function?.name) call.name += c.function.name
      if (c.function?.arguments) call.arguments += c.function.arguments
      calls.set(index, call)
    }
    finish = choice?.finish_reason ?? finish
    usage = usageOf(chunk) ?? usage
  }
  if (!done && finish === null) throw new IncompleteReply("the stream ended before it said it was done")
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([i, c]) => ({ ...c, id: c.id || `call_${i}` }))
  return { content, toolCalls, finish, usage }
}

const retryable = (err: unknown) =>
  err instanceof HttpError ? err.status === 408 || err.status === 429 || err.status >= 500 : err instanceof IncompleteReply || err instanceof TypeError

export interface ModelConfig {
  name: string
  model: string
  endpoint: string
  apiKeyEnv: string
  maxTokens: number
}

export function openAiModel(config: ModelConfig, fetchImpl: typeof fetch = fetch, attempts = 6): ChatModel {
  return {
    name: config.name,
    async turn(messages, tools) {
      const key = process.env[config.apiKeyEnv]
      if (!key) throw new Error(`set ${config.apiKeyEnv} to the API key for ${config.name}`)
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetchImpl(`${config.endpoint.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: config.model, messages, tools, tool_choice: "auto", max_tokens: config.maxTokens, stream: false }),
          })
          const body = await res.text()
          if (!res.ok) throw new HttpError(res.status, body)
          return parseTurn(body)
        } catch (err) {
          if (attempt + 1 >= attempts || !retryable(err)) throw err
          await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** attempt)))
        }
      }
    },
  }
}

/** Plays back recorded turns in order; asking for more than were recorded means the replay diverged. */
export function replayModel(name: string, turns: AssistantTurn[]): ChatModel {
  let next = 0
  return {
    name,
    async turn() {
      const turn = turns[next++]
      if (!turn) throw new Error(`${name}: the replay asked for turn ${next} of ${turns.length}`)
      return turn
    },
  }
}
