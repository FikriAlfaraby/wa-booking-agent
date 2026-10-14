import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { IncompleteReply, parseTurn } from "../src/model.ts"

const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}`

describe("reading a model's turn", () => {
  it("reads tool calls from a JSON reply", () => {
    const turn = parseTurn(
      JSON.stringify({
        choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_free_slots", arguments: '{"listing_id":"bsd-anggrek-12"}' } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    )
    assert.deepEqual(turn.toolCalls, [{ id: "c1", name: "get_free_slots", arguments: '{"listing_id":"bsd-anggrek-12"}' }])
    assert.deepEqual(turn.usage, { input: 10, output: 5 })
  })

  it("puts a streamed tool call back together from its chunks", () => {
    const body = [
      chunk({ role: "assistant", tool_calls: [{ index: 0, id: "c1", function: { name: "book_viewing", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"listing_id":"bsd-anggrek-12",' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"slot":"2026-10-17T14:00:00+07:00","attendee_name":"Rina"}' } }] }),
      chunk({ tool_calls: [{ index: 1, id: "c2", function: { name: "handoff_to_human", arguments: '{"reason":"price"}' } }] }),
      chunk({}, "tool_calls"),
      "data: [DONE]",
    ].join("\n\n")
    const turn = parseTurn(body)
    assert.equal(turn.toolCalls.length, 2)
    assert.deepEqual(JSON.parse(turn.toolCalls[0]?.arguments ?? ""), { listing_id: "bsd-anggrek-12", slot: "2026-10-17T14:00:00+07:00", attendee_name: "Rina" })
    assert.equal(turn.toolCalls[1]?.name, "handoff_to_human")
    assert.equal(turn.finish, "tool_calls")
  })

  it("reads a streamed text reply", () => {
    const turn = parseTurn([chunk({ content: "Sabtu " }), chunk({ content: "jam 14.00 sudah saya catat." }, "stop"), "data: [DONE]"].join("\n"))
    assert.equal(turn.content, "Sabtu jam 14.00 sudah saya catat.")
    assert.deepEqual(turn.toolCalls, [])
  })

  it("treats a cut-off stream or an error as a reply to retry", () => {
    assert.throws(() => parseTurn(chunk({ content: "Sabtu" })), IncompleteReply)
    assert.throws(() => parseTurn(`data: ${JSON.stringify({ error: { message: "overloaded" } })}`), IncompleteReply)
    assert.throws(() => parseTurn("<html>bad gateway</html>"), IncompleteReply)
  })
})
