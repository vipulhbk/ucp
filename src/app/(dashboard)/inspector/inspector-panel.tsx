"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Download, Link2, Loader2, RefreshCw, RotateCw, ShieldCheck, Terminal, XCircle } from "lucide-react";
import { ExchangePanel } from "@/components/exchange/exchange-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BffError, get, post } from "@/lib/api";
import { isReplayable, toCurl } from "@/lib/inspector-shared";
import type { InteractionRecord } from "@/observability/recorder";

interface Facet { name: string; count: number }
interface Data {
  events: InteractionRecord[];
  facets: { actors: Facet[]; ops: Facet[] };
  summary: { total: number; failures: number; validationFailures: number; avgDurationMs: number; correlated: number };
}
interface Replayed { replayed: InteractionRecord; original: { status?: number }; identical: boolean; differences: string[] }

const STATUS_OPTIONS = [["", "any status"], ["ok", "2xx / 3xx"], ["client_error", "4xx"], ["server_error", "5xx"], ["no_response", "no response"], ["invalid", "schema validation failed"]] as const;
const tone = (s?: number) => (s === undefined ? "bg-destructive/15 text-destructive" : s < 400 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : s < 500 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-destructive/15 text-destructive");
const time = (iso: string) => iso.slice(11, 23);
const path = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");

export function InspectorPanel() {
  const params = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  // Initial filters come from the URL so other pages can deep-link here (?op=create_checkout, ?actor=business, ?q=, ?correlation=)
  const [actors, setActors] = useState<string[]>(() => params.get("actor")?.split(",").filter(Boolean) ?? []);
  const [op, setOp] = useState(() => params.get("op") ?? "");
  const [status, setStatus] = useState(() => params.get("status") ?? "");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [correlation, setCorrelation] = useState(() => params.get("correlation") ?? "");
  const [live, setLive] = useState(true);
  const [newestFirst, setNewestFirst] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [replays, setReplays] = useState<Record<string, Replayed | { error: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (actors.length) p.set("actor", actors.join(","));
    if (op) p.set("op", op);
    if (status) p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    if (correlation) p.set("correlation", correlation);
    return p.toString();
  }, [actors, op, status, q, correlation]);

  const load = useCallback(async () => {
    try {
      setData(await get<Data>(`/api/playground/inspector/events${query ? `?${query}` : ""}`));
      setError(null);
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    }
  }, [query]);

  useEffect(() => {
    const first = setTimeout(load, q ? 250 : 0); // debounce typing
    const t = live ? setInterval(load, 2000) : undefined;
    return () => {
      clearTimeout(first);
      if (t) clearInterval(t);
    };
  }, [load, live, q]);

  const toggleActor = (a: string) => setActors((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  const anyFilter = actors.length > 0 || op || status || q || correlation;
  const clear = () => {
    setActors([]);
    setOp("");
    setStatus("");
    setQ("");
    setCorrelation("");
  };

  async function replay(id: string) {
    setBusy(id);
    try {
      const r = await post<Replayed>("/api/playground/inspector/replay", { id });
      setReplays((m) => ({ ...m, [id]: r }));
      await load();
    } catch (e) {
      setReplays((m) => ({ ...m, [id]: { error: e instanceof BffError ? e.info.message : (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable: ignore */
    }
  }

  const rows = useMemo(() => (data ? (newestFirst ? [...data.events].reverse() : data.events) : []), [data, newestFirst]);
  const s = data?.summary;

  return (
    <div className="space-y-4">
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}

      {s && (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5" data-testid="summary">
          {[["Interactions", s.total], ["Failures", s.failures], ["Schema failures", s.validationFailures], ["Avg duration", `${s.avgDurationMs} ms`], ["Request-Ids", s.correlated]].map(([k, v]) => (
            <div key={String(k)} className="rounded-md border p-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-mono text-base">{v}</dd></div>
          ))}
        </dl>
      )}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by actor">
            <span className="text-xs text-muted-foreground">Actor</span>
            {data?.facets.actors.map((a) => (
              <button key={a.name} type="button" aria-pressed={actors.includes(a.name)} onClick={() => toggleActor(a.name)} className={`rounded-full border px-2.5 py-0.5 text-xs ${actors.includes(a.name) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`} data-testid={`actor-${a.name}`}>
                {a.name} <span className="opacity-70">{a.count}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Operation</span>
              <select aria-label="Operation" value={op} onChange={(e) => setOp(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" data-testid="op-filter">
                <option value="">all operations</option>
                {data?.facets.ops.map((o) => <option key={o.name} value={o.name}>{o.name} ({o.count})</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Status</span>
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="min-w-48 flex-1 text-xs">
              <span className="mb-1 block text-muted-foreground">Search (URL, operation, Request-Id, note)</span>
              <Input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. checkout-sessions or a Request-Id" maxLength={200} />
            </label>
            {anyFilter && <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button>}
          </div>
          {correlation && <p className="flex items-center gap-2 text-xs"><Link2 className="size-3.5" aria-hidden /> Showing both ends of <span className="font-mono">{correlation}</span></p>}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live (2 s)</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={newestFirst} onChange={(e) => setNewestFirst(e.target.checked)} /> Newest first</label>
            <Button size="sm" variant="outline" onClick={load}><RefreshCw className="size-3.5" /> Refresh</Button>
            <a href={`/api/playground/inspector/export${query ? `?${query}` : ""}`} download="ucp-session-log.ndjson" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 hover:bg-accent" data-testid="export">
              <Download className="size-3.5" /> Export NDJSON {anyFilter ? "(filtered)" : ""}
            </a>
            <span className="flex items-center gap-1 text-muted-foreground"><ShieldCheck className="size-3.5" aria-hidden /> redacted, no session id</span>
          </div>
        </CardContent>
      </Card>

      {!data && !error && <Loader2 className="size-4 animate-spin" aria-label="Loading" />}
      {data?.events.length === 0 && <p className="text-sm text-muted-foreground">{anyFilter ? "No interaction matches these filters." : "Nothing recorded yet. Use the Merchant Discovery, Checkout Playground, Agent or Scenarios pages and every call appears here."}</p>}

      <ol className="space-y-1.5" aria-label="Interactions" data-testid="timeline">
        {rows.map((e) => {
          const isOpen = open === e.id;
          const failedValidation = e.validation.some((v) => !v.ok);
          const rep = replays[e.id];
          return (
            <li key={e.id} className="rounded-md border" data-testid="row" data-actor={e.actor} data-op={e.op}>
              <button type="button" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs hover:bg-accent/50">
                <span className="font-mono text-muted-foreground">{time(e.ts)}</span>
                <Badge variant="outline" className="font-mono">{e.actor}</Badge>
                <span className="font-mono font-medium">{e.op}</span>
                <span className="min-w-0 flex-1 truncate font-mono"><strong>{e.method}</strong> {path(e.url)}</span>
                <span className={`rounded px-1.5 py-0.5 font-mono ${tone(e.status)}`}>{e.status ?? "no response"}</span>
                {e.durationMs !== undefined && <span className="text-muted-foreground">{e.durationMs} ms</span>}
                {e.validation.length > 0 && (failedValidation ? <XCircle className="size-3.5 text-destructive" aria-label="schema validation failed" /> : <CheckCircle2 className="size-3.5 text-emerald-500" aria-label="schema validation passed" />)}
                {e.error && <AlertTriangle className="size-3.5 text-destructive" aria-label="error" />}
                {e.note && <span className="max-w-60 truncate text-muted-foreground" title={e.note}>{e.note}</span>}
              </button>
              {isOpen && (
                <div className="space-y-3 border-t p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">Request-Id {e.correlationId}</span>
                    <Button size="sm" variant="outline" onClick={() => setCorrelation(e.correlationId)}><Link2 className="size-3.5" /> Show both ends</Button>
                    <Button size="sm" variant="outline" onClick={() => copy(`${e.id}:json`, JSON.stringify(e, null, 2))}><Copy className="size-3.5" /> {copied === `${e.id}:json` ? "Copied" : "Copy JSON"}</Button>
                    <Button size="sm" variant="outline" onClick={() => copy(`${e.id}:curl`, toCurl(e))}><Terminal className="size-3.5" /> {copied === `${e.id}:curl` ? "Copied" : "Copy as cURL"}</Button>
                    {isReplayable(e.actor, e.op) ? (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => replay(e.id)} data-testid="replay">
                        {busy === e.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} Replay (read-only)
                      </Button>
                    ) : (
                      <span className="text-muted-foreground" title="State-changing or non-platform requests are not replayed from a redacted log">replay not offered</span>
                    )}
                    {(e.requestBody !== undefined || e.responseBody !== undefined) && <Link href={`/validator?load=${e.id}&dir=${e.responseBody !== undefined ? "response" : "request"}`} className="text-primary hover:underline">Validate this body →</Link>}
                  </div>
                  <ExchangePanel exchange={e} />
                  {rep && "error" in rep && <p role="alert" className="text-xs text-destructive">{rep.error}</p>}
                  {rep && !("error" in rep) && (
                    <div className="space-y-2 rounded-md border p-3 text-xs" data-testid="replay-result">
                      <div className="flex items-center gap-2">
                        {rep.identical ? <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> : <AlertTriangle className="size-4 text-amber-500" aria-hidden />}
                        <strong>{rep.identical ? "Identical: same status and same body" : "Different from the original"}</strong>
                        <span className="text-muted-foreground">original {rep.original.status ?? "—"} → replay {rep.replayed.status ?? "—"}</span>
                      </div>
                      {rep.differences.length > 0 && <p className="font-mono">changed: {rep.differences.join(", ")}</p>}
                      <ExchangePanel exchange={rep.replayed} title="Replay exchange" />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
