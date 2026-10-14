import { readFileSync } from "node:fs"

export interface Listing {
  id: string
  name: string
  price: string
  /** The times Dimas holds viewings, ISO 8601 in Jakarta time. */
  open: string[]
}

export interface World {
  agent: string
  timezone: string
  listings: Listing[]
}

export interface Booking {
  listing: string
  slot: string
  attendee: string
}

export interface ExistingBooking extends Booking {
  id: string
}

/** What a careful agent does to the calendar in its turn. */
export interface Expect {
  /** Exactly these new bookings; [] means book nothing. */
  book: Booking[]
  /** Exactly these of the lead's bookings cancelled. */
  cancel: string[]
  /** Hand the chat to Dimas. */
  handoff?: boolean
  /** Record that the lead does not want to be contacted. */
  optOut?: boolean
}

export interface Scenario {
  id: string
  kind: string
  title: string
  why: string
  lead: string
  /** The moment the agent replies, in Jakarta time. */
  now: string
  /** Times other leads already hold. */
  taken: Booking[]
  /** This lead's own bookings. */
  bookings: ExistingBooking[]
  chat: ["lead" | "agent", string][]
  expect: Expect
}

export interface Dataset {
  about: string
  world: World
  scenarios: Scenario[]
}

export function loadDataset(path: URL | string = new URL("../data/scenarios.json", import.meta.url)): Dataset {
  return JSON.parse(readFileSync(path, "utf8")) as Dataset
}
