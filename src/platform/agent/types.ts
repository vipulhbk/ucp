export interface BuyerProfile {
  email: string;
  first_name: string;
  last_name: string;
  street_address: string;
  address_locality: string;
  address_region: string;
  postal_code: string;
  address_country: string;
}

export const DEFAULT_PROFILE: BuyerProfile = {
  email: "asha@example.com",
  first_name: "Asha",
  last_name: "Rao",
  street_address: "12 MG Road",
  address_locality: "Bengaluru",
  address_region: "KA",
  postal_code: "560001",
  address_country: "IN",
};

export type AgentState = "idle" | "proposing" | "checkout" | "awaiting_consent" | "ordered";

export interface Candidate {
  productId: string;
  variantId: string;
  title: string;
  price: number;
  rating?: number;
  tags: string[];
  imageUrl?: string;
  /** Required features this product was verified to satisfy. */
  matches: string[];
}

export type TimelineKind = "discover" | "search" | "select" | "create_checkout" | "update_checkout" | "fix" | "present" | "await_consent" | "complete" | "order" | "handoff" | "capability" | "cancel" | "info" | "error";

export interface TimelineEvent {
  id: string;
  ts: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  status: "ok" | "warn" | "error" | "info";
  /** Joins to the Protocol Inspector: the Request-Id of the real HTTP exchange behind this step. */
  correlationId?: string;
  op?: string;
  httpStatus?: number;
}

export interface Msg {
  id: string;
  role: "buyer" | "agent";
  text: string;
  ts: string;
}

export interface CardOption {
  id: string;
  label: string;
}

/** What the UI must render next. Authorization is never performed by the agent. */
export type Pending =
  | { type: "choose_product" }
  | { type: "authorize"; checkoutId: string; expectedTotal: number; currency: string; cards: CardOption[]; defaultCardId: string; failedCardId?: string };

export interface AgentRun {
  id: string;
  state: AgentState;
  profile: BuyerProfile;
  query?: string;
  require: string[];
  candidates: Candidate[];
  selectedIdx?: number;
  quantity: number;
  codes: string[];
  option: "standard" | "express";
  checkoutId?: string;
  orderId?: string;
  transcript: Msg[];
  timeline: TimelineEvent[];
  pending?: Pending;
  /** Set when the last exchange ended in a handoff to the buyer (continue_url). */
  handoffUrl?: string;
  /** The card the buyer last authorized with (to steer a retry away from a card that just failed). */
  lastCardId?: string;
}

export const emptyRun = (id: string, profile: BuyerProfile = DEFAULT_PROFILE): AgentRun => ({
  id,
  state: "idle",
  profile,
  require: [],
  candidates: [],
  quantity: 1,
  codes: [],
  option: "standard",
  transcript: [],
  timeline: [],
});
