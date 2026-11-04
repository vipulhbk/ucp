"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BffError, post, ucp } from "@/lib/api";
import { rupees } from "@/lib/format";
import type { InteractionRecord } from "@/observability/recorder";

/* eslint-disable @typescript-eslint/no-explicit-any -- the live checkout is rendered as received from the merchant */
export interface ConfirmationProps {
  checkoutId: string;
  /** The total the caller believes is payable. The card re-reads the checkout and refuses to authorize a different total. */
  expectedTotal: number;
  cards: { id: string; label: string }[];
  defaultCardId?: string;
  failedCardId?: string;
  instruction?: string;
  /** Called after the buyer's click completes (successfully or not). `exchanges` are the real protocol exchanges. */
  onDone: (r: { cardId: string; exchanges: InteractionRecord[]; completeStatus?: string }) => void;
}

/**
 * THE trusted confirmation UI. It shows what will be paid (re-read from the merchant, not from the agent) and only the
 * buyer's click on the button authorizes. The server additionally refuses if the live total differs from the one shown.
 */
export function ConfirmationCard({ checkoutId, expectedTotal, cards, defaultCardId, failedCardId, instruction, onDone }: ConfirmationProps) {
  const [co, setCo] = useState<any>(null);
  const [cardId, setCardId] = useState(defaultCardId ?? cards[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ucp("get_checkout", { id: checkoutId })
      .then((r) => live && setCo(r.body))
      .catch((e) => live && setError(e instanceof BffError ? e.info.message : (e as Error).message));
    return () => {
      live = false;
    };
  }, [checkoutId]);

  const t = (type: string) => co?.totals?.find((x: any) => x.type === type)?.amount as number | undefined;
  const liveTotal = t("total");
  const stale = co && liveTotal !== expectedTotal;
  const m = co?.fulfillment?.methods?.[0];
  const opt = m?.groups?.[0]?.options?.find((o: any) => o.id === m.groups[0].selected_option_id);
  const dest = m?.destinations?.find((d: any) => d.id === m.selected_destination_id);
  const card = cards.find((c) => c.id === cardId);
  const discounts = (t("items_discount") ?? 0) + (t("discount") ?? 0);

  async function authorize() {
    if (liveTotal === undefined) return;
    setBusy(true);
    setError(null);
    try {
      // This click IS the buyer's explicit authorization of exactly `liveTotal`, the amount displayed above.
      const done = await post<{ consentExchange: InteractionRecord; tokenize: { exchange: InteractionRecord }; complete: { exchange: InteractionRecord; body: { status?: string } } | null }>("/api/playground/checkout/authorize", { checkoutId, cardId, expectedTotal: liveTotal });
      onDone({ cardId, exchanges: [done.consentExchange, done.tokenize.exchange, ...(done.complete ? [done.complete.exchange] : [])], completeStatus: done.complete?.body?.status });
    } catch (e) {
      setError(e instanceof BffError ? `${e.info.code ?? e.info.kind}: ${e.info.message}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border-2 border-primary/40 p-3 text-sm" role="region" aria-label="Purchase confirmation" data-testid="confirmation">
      <div className="flex items-center gap-2 font-medium">
        <ShieldCheck className="size-4" aria-hidden /> Confirm your simulated purchase
      </div>
      {instruction && <p className="rounded bg-muted/50 p-2 text-xs">{instruction}</p>}
      {!co && !error && <Loader2 className="size-4 animate-spin" aria-label="Loading checkout" />}
      {co && (
        <>
          <ul className="list-disc pl-5">
            {co.line_items.map((l: any) => (
              <li key={l.id}>{l.quantity} × {l.item.title}</li>
            ))}
          </ul>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-xs">
            <dt>Subtotal</dt><dd className="text-right font-mono">{rupees(t("subtotal") ?? 0, co.currency)}</dd>
            <dt>Discounts</dt><dd className="text-right font-mono">{rupees(discounts, co.currency)}</dd>
            <dt>Shipping{opt ? ` (${opt.title})` : ""}</dt><dd className="text-right font-mono">{rupees(t("fulfillment") ?? 0, co.currency)}</dd>
            <dt>Tax</dt><dd className="text-right font-mono">{rupees(t("tax") ?? 0, co.currency)}</dd>
            <dt className="font-medium">Total</dt><dd className="text-right font-mono font-medium" data-testid="confirm-total">{rupees(liveTotal ?? 0, co.currency)}</dd>
          </dl>
          {dest && <p className="text-xs text-muted-foreground">Deliver to: {[dest.street_address, dest.address_locality, dest.postal_code].filter(Boolean).join(", ")}</p>}
        </>
      )}
      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Pay with</span>
        <select aria-label="Payment method" className="flex-1 rounded-md border bg-background px-2 py-1" value={cardId} onChange={(e) => setCardId(e.target.value)} disabled={busy}>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>{c.label}{c.id === failedCardId ? " (just failed)" : ""}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">Payment is <strong>simulated</strong>: no money moves. Only your click below authorizes it; the shopping agent cannot.</p>
      {stale && <p role="alert" className="text-xs text-destructive">The total changed to {rupees(liveTotal ?? 0, co.currency)} since it was presented ({rupees(expectedTotal, co.currency)}). Authorizing will use the amount shown here.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button onClick={authorize} disabled={busy || !co || liveTotal === undefined || co?.status !== "ready_for_complete"} data-testid="authorize">
        {busy && <Loader2 className="size-4 animate-spin" />} I authorize this purchase{liveTotal !== undefined ? ` of ${rupees(liveTotal, co.currency)}` : ""}{card ? ` with ${card.label.split(" · ")[0]}` : ""}
      </Button>
    </div>
  );
}
