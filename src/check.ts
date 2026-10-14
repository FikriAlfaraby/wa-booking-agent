import type { Trace } from "./agent.ts"
import type { Held } from "./calendar.ts"
import { jakartaTime } from "./prompt.ts"
import type { Booking, Scenario, World } from "./scenarios.ts"

/**
 * Reads what the agent did to the calendar in its turn, not what it said. pass: exactly what a
 * careful agent does. wrong: an action it should not have taken. missed: an action it should
 * have taken and did not. error: the turn did not finish.
 */
export type Outcome = "pass" | "wrong" | "missed" | "error"

export interface Finding {
  outcome: "wrong" | "missed"
  what: string
  /** For a wrong booking: it is in the calendar now. A refused attempt left no trace. */
  landed?: boolean
}

const instant = (iso: string) => Date.parse(iso)
const words = (name: string) => name.toLowerCase().replace(/[^\p{L}]+/gu, " ").trim().split(" ").filter(Boolean)

/** Names match by words: "Andi" is "Andi Pratama"; "Budi Santoso" is not "Dewi Lestari". */
export function sameName(a: string, b: string): boolean {
  const [short, long] = words(a).length <= words(b).length ? [words(a), words(b)] : [words(b), words(a)]
  return short.length > 0 && short.every((w) => long.includes(w))
}

const same = (a: Booking, b: Booking) => a.listing === b.listing && instant(a.slot) === instant(b.slot) && sameName(a.attendee, b.attendee)
const when = (iso: string) => jakartaTime(iso).replace(/ \d{4},/, ",")

function whyWrong(world: World, scenario: Scenario, held: Held): string {
  const listing = world.listings.find((l) => l.id === held.listing)
  const near = scenario.expect.book.find((b) => b.listing === held.listing && instant(b.slot) === instant(held.slot))
  if (near) return `booked ${when(held.slot)} for ${held.attendee}, but ${near.attendee} is the one coming`
  const reasons = []
  if (instant(held.slot) <= instant(scenario.now)) reasons.push("a time that had passed")
  else if (!listing?.open.some((slot) => instant(slot) === instant(held.slot))) reasons.push("a time with no viewings")
  const expected = scenario.expect.book[0]
  if (expected && expected.listing !== held.listing) reasons.push(`the wrong listing (${held.listing})`)
  const base = `booked ${when(held.slot)} for ${held.attendee}`
  if (reasons.length) return `${base}: ${reasons.join(", ")}`
  return scenario.expect.book.length ? `${base}, not ${scenario.expect.book.map((b) => when(b.slot)).join(" and ")}` : `${base}, though nothing should be booked yet`
}

export function check(world: World, scenario: Scenario, trace: Trace): { outcome: Outcome; findings: Finding[] } {
  const findings: Finding[] = []
  const cal = trace.calendar
  const created = cal.held.filter((h) => h.new && !h.cancelled)
  for (const expected of scenario.expect.book) {
    if (!created.some((h) => same(expected, h))) findings.push({ outcome: "missed", what: `did not book ${when(expected.slot)} for ${expected.attendee}` })
  }
  for (const held of created) {
    if (!scenario.expect.book.some((b) => same(b, held))) findings.push({ outcome: "wrong", what: whyWrong(world, scenario, held), landed: true })
  }
  for (const e of cal.events) {
    if (e.tool === "book_viewing" && e.failed && (e.result as { error?: string }).error === "That time is already booked.") {
      const slot = (e.args as { slot?: string }).slot ?? ""
      findings.push({ outcome: "wrong", what: `tried to book ${when(slot)}, which was taken; the calendar refused`, landed: false })
    }
  }
  const cancelled = cal.held.filter((h) => !h.new && h.cancelled).map((h) => h.id)
  for (const id of scenario.expect.cancel) if (!cancelled.includes(id)) findings.push({ outcome: "missed", what: `did not cancel ${id}` })
  for (const id of cancelled) if (!scenario.expect.cancel.includes(id)) findings.push({ outcome: "wrong", what: `cancelled ${id}, which the lead wanted to keep`, landed: true })
  if (scenario.expect.handoff && !cal.handedOff) findings.push({ outcome: "missed", what: `did not hand the chat to ${world.agent}` })
  if (scenario.expect.optOut && !cal.optedOut) findings.push({ outcome: "missed", what: "did not record that the lead opted out" })

  const outcome: Outcome = findings.some((f) => f.outcome === "wrong") ? "wrong" : trace.error ? "error" : findings.length ? "missed" : "pass"
  return { outcome, findings }
}
