import { z } from "zod"

import type { Booking, Scenario, World } from "./scenarios.ts"

/**
 * The world the agent acts on: Dimas's viewing calendar for one chat. Like a real calendar, it
 * refuses a time someone already holds and accepts any other time, open for viewings or not.
 * Whether a time should be booked is the agent's judgement; the checker reads what it did.
 */

export interface Held extends Booking {
  id: string
  /** Booked in this turn by the agent. */
  new: boolean
  /** One of this lead's bookings (cancellable by the agent). */
  ownedByLead: boolean
  cancelled: boolean
}

export interface ToolEvent {
  tool: string
  args: unknown
  result: unknown
  /** The call did not do what it asked for: bad arguments, a taken time, an unknown booking. */
  failed: boolean
}

const ISO = z.iso.datetime({ offset: true })
const DATE = z.iso.date()

export const ARGS = {
  get_free_slots: z.object({ listing_id: z.string(), from_date: DATE.optional(), to_date: DATE.optional() }),
  get_lead_bookings: z.object({}),
  book_viewing: z.object({ listing_id: z.string(), slot: ISO, attendee_name: z.string().min(1) }),
  cancel_viewing: z.object({ booking_id: z.string() }),
  handoff_to_human: z.object({ reason: z.string() }),
  opt_out: z.object({}),
} as const
export type ToolName = keyof typeof ARGS

const instant = (iso: string) => Date.parse(iso)
/** The calendar day in Jakarta, YYYY-MM-DD. */
const jakartaDay = (iso: string) => new Date(instant(iso) + 7 * 3600_000).toISOString().slice(0, 10)

export class Calendar {
  readonly held: Held[]
  readonly events: ToolEvent[] = []
  handedOff = false
  optedOut = false
  private next = 1
  private readonly world: World
  private readonly scenario: Scenario

  constructor(world: World, scenario: Scenario) {
    this.world = world
    this.scenario = scenario
    this.held = [
      ...scenario.bookings.map((b) => ({ ...b, new: false, ownedByLead: true, cancelled: false })),
      ...scenario.taken.map((b, i) => ({ ...b, id: `OT-${i + 1}`, new: false, ownedByLead: false, cancelled: false })),
    ]
  }

  private listing(id: string) {
    return this.world.listings.find((l) => l.id === id)
  }

  private holder(listing: string, slot: string) {
    return this.held.find((h) => !h.cancelled && h.listing === listing && instant(h.slot) === instant(slot))
  }

  /** Runs one tool call as the model wrote it, and returns what the model is told. */
  run(tool: string, rawArgs: string): unknown {
    let parsed: unknown
    try {
      parsed = rawArgs.trim() ? (JSON.parse(rawArgs) as unknown) : {}
    } catch {
      return this.log(tool, rawArgs, { error: "The arguments are not valid JSON." }, true)
    }
    if (!(tool in ARGS)) return this.log(tool, parsed, { error: `There is no tool called ${tool}.` }, true)
    const name = tool as ToolName
    const args = ARGS[name].safeParse(parsed)
    if (!args.success) {
      const hint = name === "book_viewing" ? " Write slot as ISO 8601 with the +07:00 offset, e.g. 2026-10-17T14:00:00+07:00." : ""
      return this.log(tool, parsed, { error: `Invalid arguments: ${args.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}.${hint}` }, true)
    }
    return this.dispatch(name, args.data, parsed)
  }

  private dispatch(name: ToolName, data: Record<string, unknown>, raw: unknown): unknown {
    switch (name) {
      case "get_free_slots": {
        const { listing_id, from_date, to_date } = data as z.infer<typeof ARGS.get_free_slots>
        const listing = this.listing(listing_id)
        if (!listing) return this.log(name, raw, { error: `Unknown listing ${listing_id}.` }, true)
        const free = listing.open.filter(
          (slot) =>
            instant(slot) > instant(this.scenario.now) &&
            !this.holder(listing.id, slot) &&
            (!from_date || jakartaDay(slot) >= from_date) &&
            (!to_date || jakartaDay(slot) <= to_date),
        )
        return this.log(name, raw, { listing_id, free }, false)
      }
      case "get_lead_bookings": {
        const mine = this.held.filter((h) => h.ownedByLead && !h.cancelled).map(({ id, listing, slot, attendee }) => ({ booking_id: id, listing_id: listing, slot, attendee_name: attendee }))
        return this.log(name, raw, { bookings: mine }, false)
      }
      case "book_viewing": {
        const { listing_id, slot, attendee_name } = data as z.infer<typeof ARGS.book_viewing>
        if (!this.listing(listing_id)) return this.log(name, raw, { error: `Unknown listing ${listing_id}.` }, true)
        if (this.holder(listing_id, slot)) return this.log(name, raw, { error: "That time is already booked." }, true)
        const id = `BK-N${this.next++}`
        this.held.push({ id, listing: listing_id, slot, attendee: attendee_name, new: true, ownedByLead: true, cancelled: false })
        return this.log(name, raw, { booking_id: id, listing_id, slot, attendee_name }, false)
      }
      case "cancel_viewing": {
        const { booking_id } = data as z.infer<typeof ARGS.cancel_viewing>
        const booking = this.held.find((h) => h.id === booking_id && h.ownedByLead && !h.cancelled)
        if (!booking) return this.log(name, raw, { error: `No booking ${booking_id} for this lead.` }, true)
        booking.cancelled = true
        return this.log(name, raw, { cancelled: booking_id }, false)
      }
      case "handoff_to_human":
        this.handedOff = true
        return this.log(name, raw, { handed_off: true, note: "Dimas will reply in this chat himself." }, false)
      case "opt_out":
        this.optedOut = true
        return this.log(name, raw, { opted_out: true }, false)
    }
  }

  private log(tool: string, args: unknown, result: unknown, failed: boolean): unknown {
    this.events.push({ tool, args, result, failed })
    return result
  }
}
