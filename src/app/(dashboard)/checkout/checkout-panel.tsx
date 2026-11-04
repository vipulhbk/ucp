"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldCheck } from "lucide-react";
import { ExchangePanel } from "@/components/exchange/exchange-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BffError, get, post, ucp, type CallResult } from "@/lib/api";
import { rupees } from "@/lib/format";
import type { InteractionRecord } from "@/observability/recorder";
import { PLATFORM_VARIANTS, type PlatformVariant } from "@/platform/profile-variants";

/* eslint-disable @typescript-eslint/no-explicit-any -- protocol payloads are inspected, not typed, in the playground */
type Co = any;
interface PlatformInfo {
  variant: PlatformVariant;
  ok: boolean;
  error?: { kind: string; message: string };
  active: string[];
  excluded: { name: string; reason: string }[];
}
interface CardInfo {
  id: string;
  label: string;
  outcome: string;
}
interface Summary {
  total: number;
  subtotal: number;
  discounts: number;
  fulfillment: number;
  tax: number;
  currency: string;
  lineItems: { title: string; quantity: number }[];
  shipping?: { title: string; destination?: string };
  paymentMethod: { label: string };
}

const STATUS_STYLE: Record<string, string> = {
  incomplete: "border-amber-500/50 text-amber-600 dark:text-amber-400",
  requires_escalation: "border-orange-500/50 text-orange-600 dark:text-orange-400",
  ready_for_complete: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  complete_in_progress: "border-sky-500/50 text-sky-600 dark:text-sky-400",
  completed: "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  canceled: "border-muted-foreground/40 text-muted-foreground",
};

const SEVERITY_STYLE: Record<string, string> = {
  recoverable: "text-amber-600 dark:text-amber-400",
  requires_buyer_input: "text-orange-600 dark:text-orange-400",
  requires_buyer_review: "text-orange-600 dark:text-orange-400",
  unrecoverable: "text-destructive",
};

const total = (co: Co, type: string) => co?.totals?.find((t: any) => t.type === type)?.amount as number | undefined;

export function CheckoutPanel() {
  const params = useSearchParams();
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  const [cards, setCards] = useState<CardInfo[]>([]);
  const [co, setCo] = useState<Co | null>(null);
  const [exchanges, setExchanges] = useState<{ label: string; ex: InteractionRecord }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<Summary | null>(null);
  const [cardId, setCardId] = useState("visa_ok");
  const lastMutation = useRef<{ op: string; id?: string; body: unknown; key?: string } | null>(null);

  // form state (the *input* side of the full-replacement update)
  const [itemId, setItemId] = useState(params.get("add") ?? "var_aurora_anc");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [email, setEmail] = useState("asha@example.com");
  const [firstName, setFirstName] = useState("Asha");
  const [street, setStreet] = useState("12 MG Road");
  const [city, setCity] = useState("Bengaluru");
  const [region, setRegion] = useState("KA");
  const [pin, setPin] = useState("560001");
  const [country, setCountry] = useState("IN");
  const [option, setOption] = useState("standard");
  const [codes, setCodes] = useState("");

  const fail = (e: unknown) => setError(e instanceof BffError ? `${e.info.kind}${e.info.code ? `/${e.info.code}` : ""}: ${e.info.message}` : (e as Error).message);
  const addEx = useCallback((label: string, ex: InteractionRecord) => setExchanges((l) => [{ label, ex }, ...l].slice(0, 12)), []);

  useEffect(() => {
    void get<PlatformInfo>("/api/playground/session/info").then(setInfo).catch(fail);
    void get<{ cards: CardInfo[] }>("/api/playground/payments/cards").then((r) => setCards(r.cards));
    const cont = params.get("continue");
    if (cont) void run("Open via continue_url", () => ucp("get_checkout", { id: cont }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function adopt(r: CallResult, label: string) {
    addEx(label, r.exchange);
    if (r.body?.id && r.body?.line_items && !r.body?.checkout_id) {
      setCo(r.body);
      setQty(Object.fromEntries(r.body.line_items.map((l: any) => [l.id, l.quantity])));
      const sel = r.body.fulfillment?.methods?.[0]?.groups?.[0]?.selected_option_id;
      if (sel) setOption(sel);
    }
    return r;
  }

  async function run(label: string, f: () => Promise<CallResult>) {
    setBusy(label);
    setError(null);
    try {
      return adopt(await f(), label);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const createCheckout = () => {
    setConsent(null);
    const body = { line_items: [{ item: { id: itemId }, quantity: 1 }] };
    lastMutation.current = { op: "create_checkout", body };
    return run("Create checkout", async () => {
      const r = await ucp("create_checkout", { body });
      lastMutation.current = { op: "create_checkout", body, key: r.idempotencyKey };
      return r;
    });
  };

  /** Update is a FULL REPLACEMENT: everything the platform wants to keep must be resent. */
  function replacementBody(c: Co) {
    const ids = c.line_items.map((l: any) => l.id);
    const hasAddress = street || city || pin;
    const codeList = codes.split(",").map((s) => s.trim()).filter(Boolean);
    return {
      line_items: c.line_items.map((l: any) => ({ id: l.id, item: { id: l.item.id }, quantity: qty[l.id] ?? l.quantity })),
      buyer: { email, first_name: firstName },
      ...(c.discounts ? { discounts: { codes: codeList } } : {}),
      ...(c.fulfillment && hasAddress
        ? {
            fulfillment: {
              methods: [
                {
                  id: "method_1",
                  type: "shipping",
                  line_item_ids: ids,
                  destinations: [{ type: "shipping_address", id: "dest_1", street_address: street, address_locality: city, address_region: region, postal_code: pin, address_country: country }],
                  selected_destination_id: "dest_1",
                  groups: [{ id: "group_1", selected_option_id: option }],
                },
              ],
            },
          }
        : {}),
    };
  }

  const updateCheckout = () => {
    if (!co) return;
    setConsent(null);
    const body = replacementBody(co);
    return run("Update checkout (full replacement)", async () => {
      const r = await ucp("update_checkout", { id: co.id, body });
      lastMutation.current = { op: "update_checkout", id: co.id, body, key: r.idempotencyKey };
      return r;
    });
  };

  const replay = () => {
    const m = lastMutation.current;
    if (!m?.key) return;
    return run("Replay with the SAME Idempotency-Key", () => ucp(m.op, { id: m.id, body: m.body, idempotencyKey: m.key }));
  };

  const sendInvalid = () => run("Invalid payload (client validation skipped)", () => ucp("create_checkout", { body: { line_items: [{ item: { id: itemId }, quantity: 0 }] }, skipValidation: true }));

  async function changePlatform(variant: PlatformVariant) {
    setBusy("platform");
    try {
      await post("/api/playground/discovery/fetch", { variant });
      setInfo(await get<PlatformInfo>("/api/playground/session/info"));
      setCo(null);
      setConsent(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function review() {
    if (!co) return;
    const r = await run("Get checkout (review before authorizing)", () => ucp("get_checkout", { id: co.id }));
    if (r?.body?.status === "ready_for_complete") {
      const c = r.body;
      const m = c.fulfillment?.methods?.[0];
      const opt = m?.groups?.[0]?.options?.find((o: any) => o.id === m.groups[0].selected_option_id);
      const d = m?.destinations?.find((x: any) => x.id === m.selected_destination_id);
      const card = cards.find((x) => x.id === cardId)!;
      setConsent({
        total: total(c, "total")!, subtotal: total(c, "subtotal") ?? 0, discounts: (total(c, "items_discount") ?? 0) + (total(c, "discount") ?? 0), fulfillment: total(c, "fulfillment") ?? 0, tax: total(c, "tax") ?? 0, currency: c.currency,
        lineItems: c.line_items.map((l: any) => ({ title: l.item.title, quantity: l.quantity })),
        shipping: opt ? { title: opt.title, destination: d ? [d.street_address, d.address_locality, d.postal_code].filter(Boolean).join(", ") : undefined } : undefined,
        paymentMethod: { label: card.label },
      });
    } else setConsent(null);
  }

  async function authorizeAndPay() {
    if (!co) return;
    setBusy("pay");
    setError(null);
    try {
      // The click on this button IS the buyer's explicit authorization. It is recorded server-side, single-use,
      // and bound to exactly the totals and card shown above; Complete is refused if anything changed since.
      const done = await post<{ consentExchange: InteractionRecord; tokenize: { exchange: InteractionRecord }; complete: CallResult | null }>("/api/playground/checkout/authorize", { checkoutId: co.id, cardId, expectedTotal: consent!.total });
      addEx("Buyer authorization (consent recorded)", done.consentExchange);
      addEx("Tokenize (simulated credential provider)", done.tokenize.exchange);
      if (done.complete) adopt(done.complete, "Complete checkout");
      setConsent(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const status: string | undefined = co?.status;
  const messages: any[] = co?.messages ?? [];
  const options: any[] = co?.fulfillment?.methods?.[0]?.groups?.[0]?.options ?? [];
  const terminal = status === "completed" || status === "canceled";

  return (
    <div className="space-y-4">
      {/* platform fixture */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6 text-sm">
          <span className="text-muted-foreground">Platform fixture</span>
          <select
            aria-label="Platform fixture"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={info?.variant ?? "default"}
            disabled={busy !== null}
            onChange={(e) => changePlatform(e.target.value as PlatformVariant)}
          >
            {(Object.keys(PLATFORM_VARIANTS) as PlatformVariant[]).filter((v) => v !== "malformed").map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          {info && !info.ok && <span className="text-destructive">Discovery failed: {info.error?.kind}. {info.error?.message}</span>}
          {info?.ok && <span className="text-xs text-muted-foreground">active: {info.active.map((a) => a.replace("dev.ucp.shopping.", "")).join(", ")}{info.excluded.length ? ` · excluded: ${info.excluded.map((x) => x.name.replace("dev.ucp.shopping.", "")).join(", ")}` : ""}</span>}
          <Link href="/discovery" className="ml-auto text-xs text-primary hover:underline">See negotiation →</Link>
        </CardContent>
      </Card>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* LEFT: inputs */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1 · Create</CardTitle>
              <CardDescription><code className="font-mono">POST /checkout-sessions</code> with only item ids and quantities. Any price you send is ignored.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <label className="min-w-48 flex-1 text-sm">
                <span className="mb-1 block text-muted-foreground">Item id (variant)</span>
                <Input value={itemId} onChange={(e) => setItemId(e.target.value)} className="font-mono" />
              </label>
              <Button onClick={createCheckout} disabled={busy !== null || !info?.ok} data-testid="create">
                {busy === "Create checkout" && <Loader2 className="size-4 animate-spin" />} Create checkout
              </Button>
              <div className="flex w-full flex-wrap gap-1 text-xs text-muted-foreground">
                Try:
                {["var_aurora_anc", "var_glide_mouse", "var_studio_monitor_pair", "var_nova_lamp_limited", "var_retro_discman"].map((id) => (
                  <button key={id} type="button" className="rounded border px-1.5 py-0.5 font-mono hover:bg-accent" onClick={() => setItemId(id)}>{id}</button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className={!co ? "opacity-60" : undefined}>
            <CardHeader>
              <CardTitle className="text-base">2 · Update</CardTitle>
              <CardDescription>
                <code className="font-mono">PUT /checkout-sessions/{"{id}"}</code> replaces the whole resource. This form is resent in full each time; clear a field and it is cleared on the server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {co && (
                <div className="space-y-1">
                  {co.line_items.map((l: any) => (
                    <div key={l.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{l.item.title}</span>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        qty
                        <Input aria-label={`Quantity for ${l.item.title}`} type="number" min={1} className="h-8 w-16" value={qty[l.id] ?? l.quantity} onChange={(e) => setQty({ ...qty, [l.id]: Math.max(1, Number(e.target.value) || 1) })} />
                      </label>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Buyer email" value={email} onChange={setEmail} span />
                <Field label="First name" value={firstName} onChange={setFirstName} />
                <Field label="Country (IN only)" value={country} onChange={setCountry} />
                <Field label="Street" value={street} onChange={setStreet} span />
                <Field label="City" value={city} onChange={setCity} />
                <Field label="Region" value={region} onChange={setRegion} />
                <Field label="PIN code" value={pin} onChange={setPin} />
                <Field label="Discount codes (comma separated)" value={codes} onChange={setCodes} span placeholder="WELCOME10, FLAT500, SUMMER20" />
              </div>
              {options.length > 0 && (
                <fieldset className="space-y-1">
                  <legend className="mb-1 text-muted-foreground">Shipping option (offered by the business)</legend>
                  {options.map((o: any) => (
                    <label key={o.id} className="flex items-center gap-2">
                      <input type="radio" name="option" checked={option === o.id} onChange={() => setOption(o.id)} />
                      <span>{o.title}</span>
                      <span className="text-xs text-muted-foreground">{o.description?.plain}</span>
                      <span className="ml-auto font-mono text-xs">{rupees(o.totals[0].amount)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={updateCheckout} disabled={!co || terminal || busy !== null} data-testid="update">
                  {busy?.startsWith("Update") && <Loader2 className="size-4 animate-spin" />} Update checkout
                </Button>
                <Button variant="outline" onClick={() => co && run("Get checkout", () => ucp("get_checkout", { id: co.id }))} disabled={!co || busy !== null}>Get</Button>
                <Button variant="outline" onClick={() => co && run("Cancel checkout", () => ucp("cancel_checkout", { id: co.id }))} disabled={!co || terminal || busy !== null}>Cancel checkout</Button>
              </div>
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button size="sm" variant="ghost" onClick={replay} disabled={!lastMutation.current?.key || busy !== null} title="Idempotency: same key and payload returns the stored response, no second effect">Replay last call (same key)</Button>
                <Button size="sm" variant="ghost" onClick={sendInvalid} disabled={busy !== null || !info?.ok} title="Skips the platform's own validation so you can see the business reject it">Send an invalid payload</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: state */}
        <div className="space-y-4">
          <Card data-testid="state">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Checkout state
                {status && <Badge variant="outline" className={STATUS_STYLE[status]} data-testid="status">{status}</Badge>}
              </CardTitle>
              <CardDescription className="font-mono text-xs">{co ? co.id : "no checkout yet"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!co && <p className="text-muted-foreground">Create a checkout to see the business&apos;s authoritative state.</p>}
              {co && (
                <>
                  <table className="w-full text-sm">
                    <tbody>
                      {co.totals.map((t: any) => (
                        <tr key={t.type} className={t.type === "total" ? "border-t font-medium" : "text-muted-foreground"}>
                          <td className="py-0.5">{t.display_text ?? t.type}</td>
                          <td className="py-0.5 text-right font-mono" data-testid={`total-${t.type}`}>{rupees(t.amount, co.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {co.discounts?.applied?.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Applied: {co.discounts.applied.map((a: any) => `${a.code ?? "automatic"} (${a.title}, −${rupees(a.amount)})`).join(" · ")}
                    </div>
                  )}
                  {messages.length > 0 && (
                    <ul className="space-y-1" aria-label="Messages from the business">
                      {messages.map((m: any, i: number) => (
                        <li key={i} className="flex gap-2 text-xs">
                          {m.type === "error" ? <AlertTriangle className={`mt-0.5 size-3.5 shrink-0 ${SEVERITY_STYLE[m.severity] ?? ""}`} aria-hidden /> : <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                          <span>
                            <span className="font-mono">{m.code}</span>
                            {m.severity && <span className={`ml-1 ${SEVERITY_STYLE[m.severity]}`}>[{m.severity}]</span>} {m.content}
                            {m.path && <span className="ml-1 font-mono text-muted-foreground">{m.path}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {status === "requires_escalation" && co.continue_url && (
                    <p className="rounded border border-orange-500/40 bg-orange-500/10 p-2 text-xs">The platform cannot finish this through the API. Hand the buyer off to <span className="font-mono">{co.continue_url}</span>.</p>
                  )}
                  {co.order && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded border border-emerald-500/40 bg-emerald-500/10 p-2" data-testid="order">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />
                      <span className="min-w-0 break-words">
                        Order <span className="font-mono">{co.order.id}</span> ({co.order.label}) placed. This was a <strong>simulated</strong> payment.
                      </span>
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("Get order", () => ucp("get_order", { id: co.order.id }))}>
                        Get order (UCP)
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className={status !== "ready_for_complete" && !consent ? "opacity-60" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4" aria-hidden /> 3 · Authorize and complete
              </CardTitle>
              <CardDescription>
                Needs <strong>your</strong> consent: placing the order and charging the (simulated) card. UCP requires a trusted UI for this unless AP2 mandates are used; AP2 is <strong>not implemented</strong> here, so this explicit step is the only way to complete.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Payment method</span>
                <select aria-label="Test card" className="flex-1 rounded-md border bg-background px-2 py-1" value={cardId} onChange={(e) => { setCardId(e.target.value); setConsent(null); }}>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              {!consent && (
                <Button onClick={review} disabled={status !== "ready_for_complete" || busy !== null} data-testid="review">Review purchase</Button>
              )}
              {status && status !== "ready_for_complete" && !terminal && <p className="text-xs text-muted-foreground">Available once the status is ready_for_complete.</p>}
              {consent && (
                <div className="space-y-2 rounded-md border-2 border-primary/40 p-3" data-testid="confirmation" role="region" aria-label="Purchase confirmation">
                  <div className="font-medium">Confirm your simulated purchase</div>
                  <ul className="list-disc pl-5">
                    {consent.lineItems.map((l, i) => <li key={i}>{l.quantity} × {l.title}</li>)}
                  </ul>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-xs">
                    <dt>Subtotal</dt><dd className="text-right font-mono">{rupees(consent.subtotal, consent.currency)}</dd>
                    <dt>Discounts</dt><dd className="text-right font-mono">{rupees(consent.discounts, consent.currency)}</dd>
                    <dt>Shipping{consent.shipping ? ` (${consent.shipping.title})` : ""}</dt><dd className="text-right font-mono">{rupees(consent.fulfillment, consent.currency)}</dd>
                    <dt>Tax</dt><dd className="text-right font-mono">{rupees(consent.tax, consent.currency)}</dd>
                    <dt className="font-medium">Total</dt><dd className="text-right font-mono font-medium" data-testid="confirm-total">{rupees(consent.total, consent.currency)}</dd>
                  </dl>
                  {consent.shipping?.destination && <p className="text-xs text-muted-foreground">Deliver to: {consent.shipping.destination}</p>}
                  <p className="text-xs text-muted-foreground">Pay with: {consent.paymentMethod.label} · <strong>simulated</strong>, no money moves.</p>
                  <div className="flex gap-2">
                    <Button onClick={authorizeAndPay} disabled={busy !== null} data-testid="authorize">
                      {busy === "pay" && <Loader2 className="size-4 animate-spin" />} I authorize this purchase of {rupees(consent.total, consent.currency)}
                    </Button>
                    <Button variant="outline" onClick={() => setConsent(null)} disabled={busy !== null}>Not now</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <section aria-label="Protocol exchanges" className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Protocol exchanges (newest first)</h2>
        {exchanges.length === 0 && <p className="text-sm text-muted-foreground">Every action above adds its real request and response here.</p>}
        {exchanges.map((x, i) => (
          <ExchangePanel key={`${x.ex.id}-${i}`} exchange={x.ex} title={x.label} />
        ))}
      </section>
    </div>
  );
}

function Field({ label, value, onChange, span, placeholder }: { label: string; value: string; onChange: (v: string) => void; span?: boolean; placeholder?: string }) {
  return (
    <label className={`text-xs ${span ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8" />
    </label>
  );
}
