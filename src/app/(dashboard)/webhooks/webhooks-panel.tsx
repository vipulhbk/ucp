"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Copy, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { JsonView } from "@/components/json/json-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BffError, get, post } from "@/lib/api";

/* eslint-disable @typescript-eslint/no-explicit-any -- protocol payloads are inspected, not typed, in the inspector */
interface State {
  outbox: any[];
  receipts: any[];
  snapshots: { orderId: string; webhookId: string; history: { webhookId: string; applied: boolean; ts: number }[]; order: any }[];
}

const ATTACKS: { mode: string; label: string; expect: string }[] = [
  { mode: "tamper_body", label: "Tamper with the body", expect: "digest_mismatch (400)" },
  { mode: "bad_signature", label: "Sign with the wrong private key", expect: "signature_invalid (401)" },
  { mode: "unknown_key", label: "Sign with an unpublished key", expect: "key_not_found (401)" },
  { mode: "stale_timestamp", label: "Replay with an old Webhook-Timestamp", expect: "webhook_timestamp_invalid (400)" },
  { mode: "wrong_signer", label: "Valid signature, wrong business identity", expect: "signer_not_order_business (403)" },
];

const OUTCOME_STYLE: Record<string, string> = { applied: "secondary", duplicate: "outline", stale_ignored: "outline", rejected: "destructive", pending: "outline" };
const time = (ms: number) => new Date(ms).toLocaleTimeString();

export function WebhooksPanel() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ label: string; attempt: any } | null>(null);

  const load = useCallback(async () => {
    try {
      setS(await get<State>("/api/playground/webhooks"));
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 2000); // webhook delivery runs after responses; keep this view fresh
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function send(rowId: string, mode: string, label: string) {
    setBusy(`${rowId}:${mode}`);
    setError(null);
    try {
      const r = await post<{ attempt: any }>("/api/playground/webhooks/send", { rowId, mode });
      setLast({ label, attempt: r.attempt });
      await load();
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    try {
      await post("/api/playground/webhooks/retry");
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!s && !error) return <Loader2 className="size-4 animate-spin" aria-label="Loading" />;
  const pending = s?.outbox.filter((r) => r.status === "pending").length ?? 0;
  return (
    <div className="space-y-6">
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}

      {/* BUSINESS OUTBOX */}
      <section aria-labelledby="outbox" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="outbox" className="text-sm font-medium">Business outbox <span className="font-normal text-muted-foreground">(sender)</span></h2>
          <Button size="sm" variant="outline" className="ml-auto" disabled={busy !== null || pending === 0} onClick={retry} data-testid="retry-now">
            {busy === "retry" && <Loader2 className="size-3 animate-spin" />} Retry pending now ({pending})
          </Button>
        </div>
        {s?.outbox.length === 0 && <p className="text-sm text-muted-foreground">Nothing sent yet. Complete a checkout and an &ldquo;Order created&rdquo; event appears here.</p>}
        {s?.outbox.map((r) => (
          <Card key={r.id} data-testid="outbox-row">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                {r.status === "delivered" ? <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> : r.status === "dead" ? <XCircle className="size-4 text-destructive" aria-hidden /> : <Clock className="size-4 text-amber-500" aria-hidden />}
                {r.summary}
                <Badge variant="outline" className="font-mono text-[11px]">{r.status}</Badge>
                <span className="font-mono text-xs font-normal text-muted-foreground">Webhook-Id {r.id}</span>
              </CardTitle>
              <CardDescription className="font-mono text-xs">POST {r.webhookUrl.replace(/^https?:\/\/[^/]+/, "")} · order {r.orderId} · v{r.orderVersion}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <details>
                <summary className="cursor-pointer text-muted-foreground">Signed payload (exact bytes sent) · {r.attempts.length} attempt(s)</summary>
                <div className="mt-2 space-y-2">
                  <JsonView value={r.body} label="webhook payload" maxHeight="16rem" />
                  <ul className="space-y-1 font-mono">
                    {r.attempts.map((a: any, i: number) => (
                      <li key={i} className={a.ok ? "" : "text-destructive"}>
                        #{i + 1} {time(a.at)} · {a.attack ? `ATTACK ${a.attack}` : a.redelivery ? "redelivery" : "attempt"} · {a.status ?? a.error} · {a.durationMs} ms {a.ack?.messages?.[0]?.code ? `· ${a.ack.messages[0].code}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => send(r.id, "redeliver", "Redelivery (same Webhook-Id)")} data-testid="redeliver">
                  <Copy className="size-3" /> Send again (duplicate)
                </Button>
                <details className="relative">
                  <summary className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"><ShieldAlert className="size-3 text-amber-500" aria-hidden /> Security demos</summary>
                  <div className="absolute z-10 mt-1 w-80 space-y-1 rounded-md border bg-popover p-2 shadow-md">
                    <p className="text-[11px] text-muted-foreground">The business plays an attacker. Each one should be rejected by the platform.</p>
                    {ATTACKS.map((a) => (
                      <button key={a.mode} type="button" disabled={busy !== null} onClick={() => send(r.id, a.mode, a.label)} className="block w-full rounded px-2 py-1 text-left hover:bg-accent" data-testid={`attack-${a.mode}`}>
                        <div>{a.label}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">expect {a.expect}</div>
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            </CardContent>
          </Card>
        ))}
        {last && (
          <div className="rounded-md border p-3 text-xs" data-testid="last-attempt">
            <div className="font-medium">{last.label}</div>
            <div className="font-mono">{last.attempt.ok ? "accepted" : "REJECTED"} · HTTP {last.attempt.status ?? "—"} {last.attempt.ack?.messages?.[0]?.code ? `· ${last.attempt.ack.messages[0].code}` : ""}</div>
            {last.attempt.ack?.messages?.[0]?.content && <div className="text-muted-foreground">{last.attempt.ack.messages[0].content}</div>}
          </div>
        )}
      </section>

      {/* PLATFORM RECEIPTS */}
      <section aria-labelledby="receipts" className="space-y-2">
        <h2 id="receipts" className="text-sm font-medium">Platform receipts <span className="font-normal text-muted-foreground">(receiver: verify → authorize → dedupe → ack → apply)</span></h2>
        {s?.receipts.length === 0 && <p className="text-sm text-muted-foreground">No deliveries received.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="py-1 pr-3">Time</th><th className="pr-3">Outcome</th><th className="pr-3">Webhook-Id</th><th className="pr-3">Order</th><th className="pr-3">Signature</th><th>Why</th></tr>
            </thead>
            <tbody className="font-mono">
              {s?.receipts.map((r) => (
                <tr key={r.id} className="border-t align-top" data-testid="receipt">
                  <td className="py-1 pr-3">{time(r.receivedAt)}</td>
                  <td className="pr-3"><Badge variant={(OUTCOME_STYLE[r.outcome] ?? "outline") as "outline"}>{r.outcome}</Badge></td>
                  <td className="pr-3">{r.webhookId ?? "—"}</td>
                  <td className="pr-3">{r.orderId ?? "—"}</td>
                  <td className="pr-3">{r.verified ? `✓ ${r.alg}` : "✗"}<div className="text-muted-foreground">{r.keyid ? `kid ${String(r.keyid).slice(0, 8)}…` : ""}</div></td>
                  <td className="text-muted-foreground">{r.reason ? `${r.reason} (${r.httpStatus})` : r.duplicate ? "same Webhook-Id already applied" : "ok"}{r.detail && <div className="max-w-md font-sans">{r.detail}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PLATFORM ORDER STATE */}
      <section aria-labelledby="snapshots" className="space-y-2">
        <h2 id="snapshots" className="text-sm font-medium">Order state at the platform <span className="font-normal text-muted-foreground">(built only from verified webhooks)</span></h2>
        {s?.snapshots.length === 0 && <p className="text-sm text-muted-foreground">No order has been received yet.</p>}
        {s?.snapshots.map((x) => (
          <Card key={x.orderId}>
            <CardContent className="space-y-2 pt-6 text-xs">
              <div className="font-mono">{x.orderId} · last applied {x.webhookId} · {x.history.filter((h) => h.applied).length} applied, {x.history.filter((h) => !h.applied).length} ignored as stale</div>
              <details>
                <summary className="cursor-pointer text-muted-foreground">Snapshot</summary>
                <div className="mt-2"><JsonView value={x.order} label="order snapshot" maxHeight="18rem" /></div>
              </details>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
