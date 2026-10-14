import type { Scenario, World } from "./scenarios.ts"

/** The tools the model sees, as an OpenAI-style function list. Arguments are checked in calendar.ts. */
export function toolSpecs(world: World) {
  const listing = { type: "string", enum: world.listings.map((l) => l.id) }
  const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
    type: "function" as const,
    function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
  })
  return [
    fn("get_free_slots", "The viewing times still free for a listing, from now on. Dates are YYYY-MM-DD in Jakarta.", {
      listing_id: listing,
      from_date: { type: "string" },
      to_date: { type: "string" },
    }, ["listing_id"]),
    fn("get_lead_bookings", "The viewings this lead has booked, with their booking ids.", {}, []),
    fn("book_viewing", "Book a viewing. slot is ISO 8601 with the +07:00 offset.", {
      listing_id: listing,
      slot: { type: "string" },
      attendee_name: { type: "string", description: "Full name of the person who will come to the viewing." },
    }, ["listing_id", "slot", "attendee_name"]),
    fn("cancel_viewing", "Cancel one of this lead's viewings.", { booking_id: { type: "string" } }, ["booking_id"]),
    fn("handoff_to_human", "Ask Dimas to answer this chat himself.", { reason: { type: "string" } }, ["reason"]),
    fn("opt_out", "Record that the lead does not want to be contacted again.", {}, []),
  ]
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "2026-10-15T10:00:00+07:00" -> "Thursday 15 October 2026, 10:00" in Jakarta. */
export function jakartaTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 7 * 3600_000)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`
}

/** The agent's instructions: who it is, what it knows, and the rules it works by. */
export function systemPrompt(world: World, scenario: Scenario): string {
  const listings = world.listings.map((l) => `- ${l.id}: ${l.name}. ${l.price}.`).join("\n")
  return `You are the WhatsApp assistant of ${world.agent}, a property agent in BSD, Serpong and Kemang. You arrange viewings.
It is now ${jakartaTime(scenario.now)} in Jakarta (WIB, UTC+7). You are talking to ${scenario.lead}.

Listings:
${listings}

How you work:
- Before you offer or book a time, call get_free_slots. Offer and book only times it returns.
- Book only when the lead clearly asks for, or agrees to, one specific free time. If they are unsure or have not chosen, ask; do not book.
- Book under the name of the person who will come to the viewing. If someone else will come and you do not know their name, ask for it.
- To see, move or cancel the lead's viewings, call get_lead_bookings first.
- If the lead asks you to stop contacting them, call opt_out and offer nothing more.
- Prices, negotiation, legal documents, and anything not in these notes: call handoff_to_human; ${world.agent} will reply himself.
- Never book a time that has already passed.
- Write times as ISO 8601 with +07:00, for example 2026-10-17T14:00:00+07:00.
- Reply in the lead's language, in one or two short WhatsApp messages.`
}
