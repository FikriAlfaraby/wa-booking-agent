import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Calendar } from "../src/calendar.ts"
import { loadDataset } from "../src/scenarios.ts"

const data = loadDataset()
const scenario = (id: string) => {
  const s = data.scenarios.find((x) => x.id === id)
  if (!s) throw new Error(id)
  return s
}
const run = (cal: Calendar, tool: string, args: unknown) => cal.run(tool, JSON.stringify(args)) as Record<string, unknown>

describe("the calendar", () => {
  it("lists free times from now on, without the ones held, within the dates asked", () => {
    const cal = new Calendar(data.world, scenario("s12"))
    const free = run(cal, "get_free_slots", { listing_id: "bsd-anggrek-12", from_date: "2026-10-17", to_date: "2026-10-17" }).free
    assert.deepEqual(free, ["2026-10-17T09:00:00+07:00", "2026-10-17T11:00:00+07:00", "2026-10-17T14:00:00+07:00"])
    const later = new Calendar(data.world, scenario("s20"))
    const today = run(later, "get_free_slots", { listing_id: "bsd-anggrek-12", to_date: "2026-10-17" }).free
    assert.deepEqual(today, ["2026-10-17T11:00:00+07:00", "2026-10-17T14:00:00+07:00", "2026-10-17T15:00:00+07:00"])
  })

  it("refuses a time someone holds, and accepts any other time, open or not", () => {
    const cal = new Calendar(data.world, scenario("s12"))
    assert.deepEqual(run(cal, "book_viewing", { listing_id: "bsd-anggrek-12", slot: "2026-10-17T15:00:00+07:00", attendee_name: "Agus" }), { error: "That time is already booked." })
    const sunday = run(cal, "book_viewing", { listing_id: "bsd-anggrek-12", slot: "2026-10-18T10:00:00+07:00", attendee_name: "Agus" })
    assert.equal(sunday.booking_id, "BK-N1")
    assert.equal(cal.held.filter((h) => h.new).length, 1)
    assert.equal(cal.events.filter((e) => e.failed).length, 1)
  })

  it("asks for the +07:00 offset when a time has none", () => {
    const cal = new Calendar(data.world, scenario("s01"))
    const result = run(cal, "book_viewing", { listing_id: "bsd-anggrek-12", slot: "2026-10-17T14:00:00", attendee_name: "Rina" })
    assert.match(String(result.error), /\+07:00/)
    assert.equal(cal.held.filter((h) => h.new).length, 0)
  })

  it("cancels only the lead's own bookings, and lists them", () => {
    const cal = new Calendar(data.world, scenario("s23"))
    assert.match(String(run(cal, "cancel_viewing", { booking_id: "OT-1" }).error), /No booking/)
    const mine = new Calendar(data.world, scenario("s04"))
    assert.deepEqual(run(mine, "get_lead_bookings", {}).bookings, [
      { booking_id: "BK-201", listing_id: "bsd-anggrek-12", slot: "2026-10-16T10:00:00+07:00", attendee_name: "Siti Rahma" },
    ])
    assert.deepEqual(run(mine, "cancel_viewing", { booking_id: "BK-201" }), { cancelled: "BK-201" })
  })

  it("answers a broken call with an error the model can read", () => {
    const cal = new Calendar(data.world, scenario("s01"))
    assert.match(String((cal.run("book_viewing", "{not json") as { error: string }).error), /not valid JSON/)
    assert.match(String((cal.run("delete_everything", "{}") as { error: string }).error), /no tool/)
  })
})
