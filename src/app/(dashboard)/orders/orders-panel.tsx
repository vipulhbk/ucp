"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, Package, Truck, XCircle } from "lucide-react";
import { ExchangePanel } from "@/components/exchange/exchange-panel";
import { JsonView } from "@/components/json/json-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BffError, get, post, ucp, type CallResult } from "@/lib/api";
import { rupees } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any -- protocol payloads are inspected, not typed, in the console */
interface OrderRow {
  id: string;
  createdAt: number;
  version: number;
  webhookUrl: string | null;
  entity: any;
  actions: string[];
  webhooks: { id: string; summary: string; status: string; orderVersion: number; attempts: number }[];
}

const ACTION_LABEL: Record<string, string> = { ship: "Mark shipped", deliver: "Mark delivered", cancel: "Cancel order", return: "Record return", refund: "Issue refund" };
const LINE_TONE: Record<string, string> = { processing: "outline", partial: "outline", fulfilled: "secondary", removed: "destructive" };

export function OrdersPanel() {
  const highlight = useSearchParams().get("order");
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Record<string, CallResult>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setOrders((await get<{ orders: OrderRow[] }>("/api/playground/orders")).orders);
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 3000); // webhook delivery runs after responses; keep this view fresh
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function act(orderId: string, action: string) {
    setBusy(`${orderId}:${action}`);
    setError(null);
    try {
      await post(`/api/playground/orders/${orderId}/action`, { action });
      await load();
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function getOrder(orderId: string) {
    setBusy(`${orderId}:get`);
    setError(null);
    try {
      const r = await ucp("get_order", { id: orderId });
      setFetched((f) => ({ ...f, [orderId]: r }));
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!orders && !error) return <Loader2 className="size-4 animate-spin" aria-label="Loading" />;
  return (
    <div className="space-y-4">
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
      {orders?.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm">
            <p>No orders in this session yet. An order exists only after a checkout completes.</p>
            <Link href="/checkout" className="mt-2 inline-block font-medium text-primary hover:underline">Open the Checkout Playground →</Link>
          </CardContent>
        </Card>
      )}
      {orders?.map((o) => {
        const e = o.entity;
        const total = e.totals.find((t: any) => t.type === "total")?.amount ?? 0;
        const events: any[] = e.fulfillment.events ?? [];
        const adjustments: any[] = e.adjustments ?? [];
        return (
          <Card key={o.id} id={o.id} className={highlight === o.id ? "ring-2 ring-primary" : undefined} data-testid="order-card">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Package className="size-4" aria-hidden /> {e.label} <span className="font-mono text-xs font-normal text-muted-foreground">{o.id}</span>
                <span className="ml-auto font-mono text-sm">{rupees(total, e.currency)}</span>
              </CardTitle>
              <CardDescription>
                checkout <span className="font-mono">{e.checkout_id}</span> · snapshot v{o.version} · {o.webhookUrl ? "webhooks enabled" : "no webhook_url advertised by the platform: no events are pushed"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <ul className="space-y-1">
                {e.line_items.map((l: any) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2">
                    <span>{l.quantity.total}/{l.quantity.original} × {l.item.title}</span>
                    <Badge variant={(LINE_TONE[l.status] ?? "outline") as "outline"}>{l.status}</Badge>
                    <span className="text-xs text-muted-foreground">fulfilled {l.quantity.fulfilled}</span>
                  </li>
                ))}
              </ul>

              {(events.length > 0 || adjustments.length > 0) && (
                <ol className="space-y-1 border-l pl-3 text-xs" aria-label="Order timeline">
                  {events.map((ev) => (
                    <li key={ev.id} className="flex items-center gap-2"><Truck className="size-3.5" aria-hidden /> <strong>{ev.type}</strong> {ev.carrier && <span>via {ev.carrier}</span>} {ev.tracking_number && <span className="font-mono">{ev.tracking_number}</span>}</li>
                  ))}
                  {adjustments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2"><CheckCircle2 className="size-3.5" aria-hidden /> <strong>{a.type}</strong> ({a.status}) {a.totals?.[0] && <span className="font-mono">{rupees(a.totals[0].amount, e.currency)}</span>}</li>
                  ))}
                </ol>
              )}

              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="text-xs font-medium">Merchant admin console <span className="font-normal text-muted-foreground">(business-internal, not UCP)</span></div>
                <div className="flex flex-wrap gap-2">
                  {["ship", "deliver", "cancel", "return", "refund"].map((a) => (
                    <Button key={a} size="sm" variant="outline" disabled={!o.actions.includes(a) || busy !== null} onClick={() => act(o.id, a)} data-testid={`action-${a}`}>
                      {busy === `${o.id}:${a}` && <Loader2 className="size-3 animate-spin" />} {ACTION_LABEL[a]}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium">Webhooks pushed for this order</div>
                {o.webhooks.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
                <ul className="space-y-0.5 text-xs">
                  {o.webhooks.map((w) => (
                    <li key={w.id} className="flex items-center gap-2">
                      {w.status === "delivered" ? <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden /> : w.status === "dead" ? <XCircle className="size-3.5 text-destructive" aria-hidden /> : <Clock className="size-3.5 text-amber-500" aria-hidden />}
                      <span>{w.summary}</span> <span className="font-mono text-muted-foreground">{w.id}</span> <span className="text-muted-foreground">{w.status} · {w.attempts} attempt{w.attempts === 1 ? "" : "s"}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/webhooks" className="text-xs text-primary hover:underline">Inspect signatures and payloads →</Link>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => getOrder(o.id)} disabled={busy !== null} data-testid="get-order">
                  {busy === `${o.id}:get` && <Loader2 className="size-3 animate-spin" />} Get Order (the platform&apos;s UCP call)
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen((s) => ({ ...s, [o.id]: !s[o.id] }))}>{open[o.id] ? "Hide" : "Show"} order entity</Button>
              </div>
              {open[o.id] && <JsonView value={e} label="order entity" />}
              {fetched[o.id] && <ExchangePanel exchange={fetched[o.id]!.exchange} title="Get Order exchange" />}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
