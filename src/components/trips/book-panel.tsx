"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Ticket } from "lucide-react";
import { ConfirmationCard } from "@/components/checkout/confirmation-card";
import { ExchangePanel } from "@/components/exchange/exchange-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BffError, get, post, ucp } from "@/lib/api";
import { rupees } from "@/lib/format";
import type { InteractionRecord } from "@/observability/recorder";

/* eslint-disable @typescript-eslint/no-explicit-any -- the merchant's checkout is shown as received */
interface Line {
  variantId: string;
  title: string;
  quantity: number;
  unitPrice: number;
}
interface Card {
  id: string;
  label: string;
}
type Labelled = { label: string; ex: InteractionRecord };

const totalOf = (co: any, type: string) => co?.totals?.find((t: any) => t.type === type)?.amount as number | undefined;

/**
 * Books a trip through the protocol. Step 1 is Create + Update Checkout (the platform asks the business to price the
 * bookable parts). Step 2 is the buyer's own click on the confirmation card, which authorizes exactly the total shown.
 * Nothing here can pay without that click, and all money is simulated.
 */
export function BookPanel({ tripId, tripTitle, lines, previewTotal }: { tripId: string; tripTitle: string; lines: Line[]; previewTotal: number }) {
  const [email, setEmail] = useState("asha@example.com");
  const [firstName, setFirstName] = useState("Asha");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<any>(null);
  const [exchanges, setExchanges] = useState<Labelled[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [failedCard, setFailedCard] = useState<string | undefined>();
  const [order, setOrder] = useState<{ id: string; label?: string } | null>(null);

  useEffect(() => {
    void get<{ cards: Card[] }>("/api/playground/payments/cards").then((r) => setCards(r.cards)).catch(() => undefined);
  }, []);

  async function book() {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ checkout: any; exchanges: Labelled[] }>("/api/playground/trips/book", { tripId, email, firstName });
      setCheckout(r.checkout);
      setExchanges(r.exchanges);
      setOrder(null);
      setFailedCard(undefined);
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function paid(r: { cardId: string; exchanges: InteractionRecord[]; completeStatus?: string }) {
    setExchanges((cur) => [...cur, ...r.exchanges.map((ex, i) => ({ label: ["Buyer consent (read-only Get Checkout)", "Tokenize at the payment handler (simulated)", "Complete checkout"][i] ?? "Exchange", ex }))]);
    if (r.completeStatus === "completed") {
      const live = await ucp("get_checkout", { id: checkout.id });
      setOrder({ id: live.body?.order?.id ?? "", label: live.body?.order?.label });
      setCheckout(live.body);
    } else {
      setFailedCard(r.cardId);
      const live = await ucp("get_checkout", { id: checkout.id });
      setCheckout(live.body);
    }
  }

  const reset = () => {
    setCheckout(null);
    setExchanges([]);
    setOrder(null);
    setError(null);
  };

  return (
    <aside className="ap-card h-fit space-y-4 p-6 lg:sticky lg:top-16" aria-label="Book this trip" data-testid="book-panel">
      <div className="flex items-center justify-between">
        <h2 className="ap-title flex items-center gap-2 text-xl"><Ticket className="size-5" aria-hidden /> Book this trip</h2>
        <Badge variant="secondary">Simulated merchant</Badge>
      </div>

      {!checkout && (
        <>
          <ul className="space-y-1.5 text-sm">
            {lines.map((l) => (
              <li key={l.variantId} className="flex items-start justify-between gap-3">
                <span>{l.quantity} × {l.title}</span>
                <span className="font-mono text-xs text-muted-foreground">{rupees(l.unitPrice * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Preview only. The merchant prices the checkout itself; with its automatic discount and GST the total comes to about <strong>{rupees(previewTotal)}</strong>. These are demo vouchers for fictional packages, delivered electronically, so there is no shipping.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void book();
            }}
            className="space-y-2"
          >
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">First name</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={60} className="ap-field text-sm" />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">Email for the vouchers (use a made-up one)</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={120} className="ap-field text-sm" />
            </label>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} className="h-11 w-full rounded-full text-[15px]" data-testid="book-submit">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Create the booking via UCP
            </Button>
          </form>
        </>
      )}

      {checkout && !order && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="font-mono">{checkout.status}</Badge>
            <span className="text-muted-foreground">checkout {checkout.id}</span>
          </div>
          {failedCard && <p role="alert" className="rounded bg-destructive/10 p-2 text-xs">That payment did not go through ({checkout.messages?.find((m: any) => m.code === "payment_failed")?.content ?? "declined"}). Choose another test card and try again.</p>}
          {totalOf(checkout, "total") !== undefined && cards.length > 0 && (
            <ConfirmationCard checkoutId={checkout.id} expectedTotal={totalOf(checkout, "total")!} cards={cards} defaultCardId="visa_ok" failedCardId={failedCard} instruction={`You are booking: ${tripTitle}.`} onDone={(r) => void paid(r)} />
          )}
          <button type="button" onClick={reset} className="ap-link text-sm">Start the booking again</button>
        </div>
      )}

      {order && (
        <div className="space-y-3" role="status" data-testid="booked">
          <div className="flex items-start gap-2 rounded-2xl bg-muted p-4 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <div>
              <div className="font-medium">Booked (simulated)</div>
              <div className="text-xs text-muted-foreground">Order <span className="font-mono">{order.label ?? order.id}</span>. No money moved and no real reservation exists.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/orders" className="ap-link">See the order</Link>
            <Link href="/webhooks" className="ap-link">See the signed order webhook</Link>
            <Link href="/inspector" className="ap-link">Inspect every UCP message</Link>
          </div>
          <button type="button" onClick={reset} className="ap-link text-sm">Book again</button>
        </div>
      )}

      {exchanges.length > 0 && (
        <details className="text-sm" data-testid="exchanges">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">What crossed the wire ({exchanges.length} UCP exchanges)</summary>
          <div className="mt-2 space-y-2">{exchanges.map((x, i) => <ExchangePanel key={i} exchange={x.ex} title={x.label} />)}</div>
        </details>
      )}
    </aside>
  );
}
