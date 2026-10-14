import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { runAgent } from "../src/agent.ts"
import { check, sameName } from "../src/check.ts"
import { replayModel, type AssistantTurn } from "../src/model.ts"
import { loadDataset } from "../src/scenarios.ts"

const data = loadDataset()

/** A scripted model: each step is a list of tool calls, the last step is the reply. */
function script(...steps: ([string, Record<string, unknown>][] | string)[]): AssistantTurn[] {
  let n = 0
  return steps.map((step) =>
    typeof step === "string"
      ? { content: step, toolCalls: [], finish: "stop", usage: null }
      : { content: "", toolCalls: step.map(([name, args]) => ({ id: `c${++n}`, name, arguments: JSON.stringify(args) })), finish: "tool_calls", usage: null },
  )
}

async function outcome(id: string, turns: AssistantTurn[]) {
  const scenario = data.scenarios.find((s) => s.id === id)
  if (!scenario) throw new Error(id)
  const trace = await runAgent(data.world, scenario, replayModel("script", turns))
  return check(data.world, scenario, trace)
}

const free = (listing = "bsd-anggrek-12") => ["get_free_slots", { listing_id: listing }] as [string, Record<string, unknown>]
const book = (slot: string, attendee: string, listing = "bsd-anggrek-12") =>
  ["book_viewing", { listing_id: listing, slot: `2026-10-${slot}:00+07:00`, attendee_name: attendee }] as [string, Record<string, unknown>]

describe("the checker", () => {
  it("passes the booking a careful agent makes", async () => {
    assert.deepEqual(await outcome("s01", script([free()], [book("17T14:00", "Rina Wulandari")], "Siap kak, Sabtu jam 14.00 ya.")), { outcome: "pass", findings: [] })
    assert.equal((await outcome("s02", script([free()], [book("16T10:00", "Andi")], "Siap."))).outcome, "pass")
  })

  it("calls a booking at another time wrong, and says which time it should have been", async () => {
    const r = await outcome("s01", script([free()], [book("17T11:00", "Rina Wulandari")], "Siap."))
    assert.equal(r.outcome, "wrong")
    assert.deepEqual(r.findings.map((f) => f.what), [
      "did not book Saturday 17 October, 14:00 for Rina Wulandari",
      "booked Saturday 17 October, 11:00 for Rina Wulandari, not Saturday 17 October, 14:00",
    ])
  })

  it("names why a booking was wrong: undecided, no viewings, passed, wrong person", async () => {
    const what = async (id: string, ...steps: Parameters<typeof script>) => (await outcome(id, script(...steps))).findings.map((f) => f.what)
    assert.deepEqual(await what("s11", [book("17T14:00", "Rina Wulandari")], "Siap."), ["booked Saturday 17 October, 14:00 for Rina Wulandari, though nothing should be booked yet"])
    assert.deepEqual(await what("s13", [book("18T10:00", "Dian Puspita")], "Siap."), ["booked Sunday 18 October, 10:00 for Dian Puspita: a time with no viewings"])
    assert.deepEqual(await what("s20", [book("17T09:00", "Putri Ayu")], "Siap."), ["booked Saturday 17 October, 09:00 for Putri Ayu: a time that had passed"])
    assert.deepEqual(await what("s05", [book("17T09:00", "Budi Santoso")], "Siap."), [
      "did not book Saturday 17 October, 09:00 for Dewi Lestari",
      "booked Saturday 17 October, 09:00 for Budi Santoso, but Dewi Lestari is the one coming",
    ])
  })

  it("counts a refused double booking as wrong, but not as landed", async () => {
    const r = await outcome("s12", script([book("17T15:00", "Agus Salim")], "Maaf kak, jam 3 sudah terisi."))
    assert.equal(r.outcome, "wrong")
    assert.deepEqual(r.findings, [{ outcome: "wrong", what: "tried to book Saturday 17 October, 15:00, which was taken; the calendar refused", landed: false }])
  })

  it("wants the cancel, the hand-off and the opt-out when the chat calls for them", async () => {
    assert.equal((await outcome("s04", script([["get_lead_bookings", {}]], [["cancel_viewing", { booking_id: "BK-201" }], book("17T11:00", "Siti Rahma")], "Sudah saya pindah ke Sabtu jam 11.00."))).outcome, "pass")
    assert.deepEqual((await outcome("s04", script([book("17T11:00", "Siti Rahma")], "Siap."))).findings.map((f) => f.what), ["did not cancel BK-201"])
    assert.deepEqual((await outcome("s09", script([free()], [book("17T14:00", "Fajar Nugroho")], "Siap."))).findings.map((f) => f.what), ["did not hand the chat to Dimas"])
    assert.equal((await outcome("s15", script("Baik pak, maaf mengganggu."))).outcome, "missed")
    assert.equal((await outcome("s15", script([["opt_out", {}]], "Baik pak, maaf mengganggu."))).outcome, "pass")
  })

  it("lets an agent fix a malformed call, and reports a turn that never finished", async () => {
    const fixed = script([["book_viewing", { listing_id: "bsd-anggrek-12", slot: "2026-10-17T14:00", attendee_name: "Rina Wulandari" }]], [book("17T14:00", "Rina Wulandari")], "Siap.")
    assert.equal((await outcome("s01", fixed)).outcome, "pass")
    assert.equal((await outcome("s10", script([free()]))).outcome, "error")
  })

  it("matches names by their words", () => {
    assert.ok(sameName("Andi", "Andi Pratama"))
    assert.ok(sameName("dewi lestari", "Dewi Lestari"))
    assert.ok(!sameName("Budi Santoso", "Dewi Lestari"))
    assert.ok(!sameName("", "Dewi"))
  })
})
