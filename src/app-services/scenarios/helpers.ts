import { rupees } from "@/lib/format";
import { buildReplacement, type CheckoutView } from "@/platform/agent/agent";
import { DEFAULT_PROFILE } from "@/platform/agent/types";
import type { UcpClient, UcpResponse } from "@/platform/ucp-client";
import { TEST_CARDS } from "@/sim/psp";
import type { StepResult } from "./types";

export const exOf = (...rs: UcpResponse[]) => rs.map((r) => r.exchange);
export const totalOf = (c: CheckoutView) => c.totals.find((t) => t.type === "total")?.amount ?? 0;
export const money = (n: number) => rupees(n, "INR");
export const CARDS = TEST_CARDS.map((c) => ({ id: c.id, label: c.label }));

export const need = (c: UcpClient | undefined): UcpClient => {
  if (!c) throw new Error("discovery has not succeeded for this platform fixture");
  return c;
};

/** The buyer-profile defaults used by scenarios (synthetic data). */
export const profile = DEFAULT_PROFILE;

export interface Replacement {
  quantity?: number;
  codes?: string[];
  option?: "standard" | "express";
}

/** Update Checkout with the spec's full-replacement semantics, filling buyer and shipping from the synthetic profile. */
export function replacement(co: CheckoutView, r: Replacement = {}) {
  return buildReplacement(co, { profile, quantity: r.quantity ?? co.line_items[0]?.quantity ?? 1, codes: r.codes ?? co.discounts?.codes ?? [], option: r.option ?? "standard" });
}

/** Drive a checkout to ready_for_complete using only UCP calls. */
export async function makeReady(client: UcpClient, r: Replacement & { itemId?: string } = {}) {
  const exchanges = [];
  const created = await client.createCheckout({ line_items: [{ item: { id: r.itemId ?? "var_aurora_anc" }, quantity: r.quantity ?? 1 }] });
  exchanges.push(created.exchange);
  let co = created.body as CheckoutView;
  if (created.status !== 201) return { co, exchanges, ok: false };
  for (let i = 0; i < 3 && co.status !== "ready_for_complete"; i++) {
    const u = await client.updateCheckout(co.id, replacement(co, r));
    exchanges.push(u.exchange);
    co = u.body as CheckoutView;
  }
  return { co, exchanges, ok: co.status === "ready_for_complete" };
}

export const fail = (summary: string, extra: Partial<StepResult> = {}): StepResult => ({ ok: false, summary, exchanges: [], ...extra });
