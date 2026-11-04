import type { Store } from "@/persistence/store";
import type { CapabilityEntry } from "@/ucp/negotiation";
import type { ShippingAddress } from "./fulfillment";

export interface BuyerInput {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  consent?: unknown;
}

/** Display-safe instrument. The credential (token) is never stored on the checkout. */
export interface InstrumentInput {
  id: string;
  handler_id: string;
  type: string;
  selected?: boolean;
  display?: Record<string, unknown>;
  billing_address?: Record<string, unknown>;
}

export interface ShippingInput {
  destinations: ShippingAddress[];
  selectedDestinationId: string | null;
  selectedOptionId: string | null;
}

export interface CheckoutInputs {
  lines: { id: string; itemId: string; quantity: number }[];
  buyer?: BuyerInput;
  context?: Record<string, unknown>;
  codes: string[];
  shipping?: ShippingInput;
  instruments: InstrumentInput[];
}

export type Lifecycle = "open" | "complete_in_progress" | "completed" | "canceled";

export interface CheckoutRecord {
  id: string;
  platformId: string;
  lifecycle: Lifecycle;
  inputs: CheckoutInputs;
  lineSeq: number;
  destSeq: number;
  createdAt: number;
  expiresAt: number;
  version: number;
  platformProfileUrl: string;
  paymentFailure?: { code: string; content: string };
  pending?: { token: string; reference: string };
  orderId?: string;
}

export interface HandlerRegistry {
  [name: string]: { id: string; version: string; spec?: string; schema?: string; available_instruments?: unknown[]; config?: Record<string, unknown> }[];
}

export interface MerchantCtx {
  store: Store;
  platformId: string;
  origin: string;
  active: Record<string, CapabilityEntry>;
  platformProfileUrl: string;
  handlers: HandlerRegistry;
  now: () => number;
  /** The platform's `dev.ucp.shopping.order` config.webhook_url, when the order capability is negotiated. */
  webhookUrl?: string;
  /** Schedule work to run after the HTTP response (webhook delivery). */
  defer?: (fn: () => Promise<unknown>) => void;
}

export interface ServiceResult {
  status: number;
  body: unknown;
}
