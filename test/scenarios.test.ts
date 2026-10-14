import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { jakartaTime } from "../src/prompt.ts"
import { loadDataset } from "../src/scenarios.ts"

const data = loadDataset()
const instant = (iso: string) => Date.parse(iso)
const listing = (id: string) => data.world.listings.find((l) => l.id === id)

describe("the scenarios", () => {
  it("have unique ids and end with the lead's message", () => {
    assert.equal(new Set(data.scenarios.map((s) => s.id)).size, data.scenarios.length)
    for (const s of data.scenarios) assert.equal(s.chat.at(-1)?.[0], "lead", s.id)
  })

  it("expect bookings only at open, future times nobody holds", () => {
    for (const s of data.scenarios) {
      for (const b of s.expect.book) {
        const l = listing(b.listing)
        assert.ok(l, `${s.id}: ${b.listing}`)
        assert.ok(l.open.some((slot) => instant(slot) === instant(b.slot)), `${s.id}: ${b.slot} is not open`)
        assert.ok(instant(b.slot) > instant(s.now), `${s.id}: ${b.slot} has passed`)
        const held = [...s.taken, ...s.bookings.filter((x) => !s.expect.cancel.includes(x.id))]
        assert.ok(!held.some((h) => h.listing === b.listing && instant(h.slot) === instant(b.slot)), `${s.id}: ${b.slot} is held`)
      }
    }
  })

  it("cancel only bookings the lead has, and hold times that exist", () => {
    for (const s of data.scenarios) {
      for (const id of s.expect.cancel) assert.ok(s.bookings.some((b) => b.id === id), `${s.id}: ${id}`)
      for (const h of [...s.taken, ...s.bookings]) assert.ok(listing(h.listing)?.open.some((slot) => instant(slot) === instant(h.slot)), `${s.id}: ${h.slot}`)
    }
  })

  it("set each trap where it says it is", () => {
    const byId = Object.fromEntries(data.scenarios.map((s) => [s.id, s]))
    // besok on a Thursday is Friday
    assert.match(jakartaTime(byId.s03?.now ?? ""), /^Thursday/)
    assert.match(jakartaTime(byId.s03?.expect.book[0]?.slot ?? ""), /^Friday/)
    // the time asked for in s12 and s23 is held by someone else
    assert.ok(byId.s12?.taken.some((t) => t.slot.includes("T15:00")))
    assert.ok(byId.s23?.taken.some((t) => t.slot.includes("T14:00")))
    // Sunday and 7 pm are not viewing times, and 9 am has passed in s20
    assert.ok(!listing("bsd-anggrek-12")?.open.some((slot) => /^Sunday/.test(jakartaTime(slot)) || slot.includes("T19:00")))
    assert.ok(instant("2026-10-17T09:00:00+07:00") < instant(byId.s20?.now ?? ""))
  })

  it("leave the controls and traps balanced", () => {
    const book = data.scenarios.filter((s) => s.expect.book.length > 0).length
    assert.equal(book, 9)
    assert.equal(data.scenarios.length - book, 15)
  })
})
