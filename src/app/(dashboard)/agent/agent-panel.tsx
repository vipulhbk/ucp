"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, CircleDot, Handshake, Loader2, RotateCcw, Search, Send, ShoppingCart, Sparkles } from "lucide-react";
import { ConfirmationCard } from "@/components/checkout/confirmation-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BffError, get, post } from "@/lib/api";
import { rupees } from "@/lib/format";
import type { AgentRun, BuyerProfile, TimelineEvent } from "@/platform/agent/types";
import { PLATFORM_VARIANTS, type PlatformVariant } from "@/platform/profile-variants";

const SUGGESTIONS = ["Find me a wireless headphone under ₹5,000 with noise cancellation.", "I need a backpack under ₹2,000", "find noise cancelling headphones under ₹500"];
const ICON: Record<string, typeof Search> = { discover: Handshake, search: Search, select: Sparkles, create_checkout: ShoppingCart, update_checkout: ShoppingCart, fix: CircleDot, present: CheckCircle2, await_consent: CircleDot, complete: CheckCircle2, order: CheckCircle2, handoff: Ban, capability: AlertTriangle, cancel: Ban, info: CircleDot, error: AlertTriangle };
const TONE: Record<TimelineEvent["status"], string> = { ok: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", error: "text-destructive", info: "text-muted-foreground" };

export function AgentPanel() {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variant, setVariant] = useState<PlatformVariant>("default");
  const [profileOpen, setProfileOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const fail = (e: unknown) => setError(e instanceof BffError ? e.info.message : (e as Error).message);
  const load = useCallback(async () => {
    try {
      setRun((await get<{ run: AgentRun }>("/api/playground/agent")).run);
    } catch (e) {
      fail(e);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [run?.transcript.length]);

  async function send(message: string) {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    setText("");
    try {
      setRun((await post<{ run: AgentRun }>("/api/playground/agent/message", { text: message })).run);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function authorized(cardId: string) {
    setBusy(true);
    try {
      setRun((await post<{ run: AgentRun }>("/api/playground/agent/message", { event: "authorization_attempted", cardId })).run);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function changeVariant(v: PlatformVariant) {
    setVariant(v);
    setBusy(true);
    try {
      await post("/api/playground/discovery/fetch", { variant: v });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    try {
      await post("/api/playground/agent/reset");
      setVariant("default");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const pending = run?.pending;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Platform fixture</span>
        <select aria-label="Platform fixture" className="rounded-md border bg-background px-2 py-1" value={variant} disabled={busy} onChange={(e) => changeVariant(e.target.value as PlatformVariant)}>
          {(Object.keys(PLATFORM_VARIANTS) as PlatformVariant[]).filter((v) => v !== "malformed").map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{PLATFORM_VARIANTS[variant]}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={reset} disabled={busy}><RotateCcw className="size-3.5" /> New conversation (reset session)</Button>
      </div>
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Conversation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-96 min-h-40 space-y-2 overflow-y-auto pr-1" aria-live="polite" data-testid="transcript">
                {run?.transcript.length === 0 && <p className="text-sm text-muted-foreground">Tell the agent what you want. Try one of the suggestions.</p>}
                {run?.transcript.map((m) => (
                  <div key={m.id} className={`max-w-[92%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${m.role === "buyer" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`} data-role={m.role}>
                    {m.text}
                  </div>
                ))}
                {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> working…</div>}
                <div ref={endRef} />
              </div>
              <div className="flex flex-wrap gap-1">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" disabled={busy} onClick={() => send(s)} className="rounded border px-2 py-1 text-left text-xs hover:bg-accent">{s}</button>
                ))}
              </div>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
                <Input aria-label="Message the agent" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. yes · the second one · apply code WELCOME10 · make it 2 · use express shipping" maxLength={500} />
                <Button type="submit" disabled={busy || !text.trim()} data-testid="send"><Send className="size-4" /> Send</Button>
              </form>
            </CardContent>
          </Card>

          {pending?.type === "choose_product" && run && (
            <Card data-testid="candidates">
              <CardHeader className="pb-2"><CardTitle className="text-base">Agent&apos;s shortlist</CardTitle><CardDescription>Verified against your requirements by the agent, not just returned by search.</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {run.candidates.map((c, i) => (
                  <div key={c.variantId} className="flex items-center gap-3 rounded-md border p-2 text-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG placeholder */}
                    {c.imageUrl && <img src={c.imageUrl} alt="" width={40} height={40} className="size-10 rounded" />}
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{i + 1}. {c.title}</div><div className="text-xs text-muted-foreground">{rupees(c.price)}{c.rating ? ` · rated ${c.rating}` : ""}{i === 0 ? " · recommended" : ""}</div></div>
                    <Button size="sm" variant={i === 0 ? "default" : "outline"} disabled={busy} onClick={() => send(String(i + 1))} data-testid={`pick-${i + 1}`}>Choose</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {pending?.type === "authorize" && (
            <ConfirmationCard key={`${pending.checkoutId}-${pending.expectedTotal}-${pending.failedCardId ?? ""}`} checkoutId={pending.checkoutId} expectedTotal={pending.expectedTotal} cards={pending.cards} defaultCardId={pending.defaultCardId} failedCardId={pending.failedCardId} onDone={({ cardId }) => void authorized(cardId)} />
          )}
          {run?.state === "ordered" && run.orderId && (
            <p className="flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm" data-testid="ordered"><CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> Order <span className="font-mono">{run.orderId}</span> placed (simulated payment).</p>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">Buyer profile <Badge variant="outline">synthetic</Badge></CardTitle>
              <CardDescription>The agent fills buyer and shipping details from here when the merchant asks. Do not enter real personal data.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" variant="outline" onClick={() => setProfileOpen((o) => !o)}>{profileOpen ? "Hide" : "Edit"} profile</Button>
              {run && profileOpen && <ProfileForm profile={run.profile} onSaved={(r) => setRun(r)} />}
              {run && !profileOpen && <p className="mt-2 text-xs text-muted-foreground">{run.profile.first_name} {run.profile.last_name} · {run.profile.email} · {run.profile.address_locality}, {run.profile.address_country}</p>}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit" data-testid="timeline">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activity timeline</CardTitle>
            <CardDescription>Each protocol step the agent took. The Request-Id joins it to the exchange in the Protocol Inspector.</CardDescription>
          </CardHeader>
          <CardContent>
            {run?.timeline.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            <ol className="space-y-3">
              {run?.timeline.map((e) => {
                const Icon = ICON[e.kind] ?? CircleDot;
                return (
                  <li key={e.id} className="flex gap-2 text-sm" data-kind={e.kind}>
                    <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[e.status]}`} aria-hidden />
                    <div className="min-w-0">
                      <div>{e.title}</div>
                      {e.detail && <div className="break-words text-xs text-muted-foreground">{e.detail}</div>}
                      <div className="font-mono text-[11px] text-muted-foreground">{e.op ?? e.kind}{e.httpStatus ? ` · HTTP ${e.httpStatus}` : ""}{e.correlationId ? ` · ${e.correlationId.slice(0, 8)}…` : ""}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProfileForm({ profile, onSaved }: { profile: BuyerProfile; onSaved: (r: AgentRun) => void }) {
  const [p, setP] = useState(profile);
  const [err, setErr] = useState<string | null>(null);
  const fields: [keyof BuyerProfile, string, boolean][] = [["email", "Email", true], ["first_name", "First name", false], ["last_name", "Last name", false], ["street_address", "Street", true], ["address_locality", "City", false], ["address_region", "Region", false], ["postal_code", "PIN code", false], ["address_country", "Country (2 letters)", false]];
  return (
    <form
      className="mt-3 grid grid-cols-2 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try {
          onSaved((await post<{ run: AgentRun }>("/api/playground/agent/profile", p)).run);
        } catch (x) {
          setErr(x instanceof BffError ? x.info.message : (x as Error).message);
        }
      }}
    >
      {fields.map(([k, label, span]) => (
        <label key={k} className={`text-xs ${span ? "col-span-2" : ""}`}>
          <span className="mb-1 block text-muted-foreground">{label}</span>
          <Input className="h-8" value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
        </label>
      ))}
      {err && <p role="alert" className="col-span-2 text-xs text-destructive">{err}</p>}
      <Button type="submit" size="sm" className="col-span-2">Save profile</Button>
    </form>
  );
}
