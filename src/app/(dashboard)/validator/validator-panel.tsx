"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, XCircle } from "lucide-react";
import { JsonView } from "@/components/json/json-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BffError, get, post } from "@/lib/api";
import type { InteractionRecord } from "@/observability/recorder";

/* eslint-disable @typescript-eslint/no-explicit-any -- examples and payloads are free-form JSON */
interface Example { title: string; why?: string; breaks?: "schema" | "rule"; payload: unknown }
interface Target { id: string; label: string; direction: string; description: string; zodName: string; docFile: string; docUrl: string; hasRules: boolean; examples: { valid: Example; invalid: Example[] } }
interface Targets { ucpVersion: string; scope: string; opTargets: Record<string, { request?: string; response?: string }>; targets: Target[] }
interface Issue { path: string; message: string; code: string; expected?: string; received?: string; actual?: string }
interface Rule { id: string; level: "spec" | "heuristic" | "info"; ok: boolean; statement: string; source: string; detail?: string }
interface Report { target: { id: string; label: string; zodName: string; docFile: string; docUrl: string }; parse: { ok: true } | { ok: false; message: string }; schema?: { ok: boolean; issues: Issue[] }; rules: Rule[]; scope: string }

const LEVEL: Record<Rule["level"], string> = { spec: "spec rule", heuristic: "heuristic (not a spec rule)", info: "info" };

export function ValidatorPanel() {
  const params = useSearchParams();
  const [cfg, setCfg] = useState<Targets | null>(null);
  const [targetId, setTargetId] = useState("checkout_response");
  const [text, setText] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [exLabel, setExLabel] = useState<string | null>(null);
  const [events, setEvents] = useState<InteractionRecord[]>([]);
  const [schemaDoc, setSchemaDoc] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof BffError ? e.info.message : (e as Error).message);

  const validate = useCallback(async (target: string, payload: string) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await post<Report>("/api/playground/validator/validate", { target, payload }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const c = await get<Targets>("/api/playground/validator/targets");
        setCfg(c);
        const load = params.get("load");
        if (load) {
          const ev = (await get<{ events: InteractionRecord[] }>("/api/playground/inspector/events?limit=1000")).events;
          const rec = ev.find((e) => e.id === load);
          const dir = params.get("dir") === "request" ? "request" : "response";
          const target = rec && c.opTargets[rec.op]?.[dir];
          const body = rec && (dir === "request" ? rec.requestBody : rec.responseBody);
          if (rec && target && body !== undefined) {
            const payload = JSON.stringify(body, null, 2);
            setTargetId(target);
            setText(payload);
            setExLabel(`${rec.actor}:${rec.op} ${dir} from the inspector (redacted)`);
            await validate(target, payload);
            return;
          }
          setError("That interaction has no body that maps to a validation target.");
        }
        const first = c.targets.find((x) => x.id === "checkout_response") ?? c.targets[0];
        if (!first) {
          setError("The server returned no validation targets.");
          return;
        }
        const payload = JSON.stringify(first.examples.valid.payload, null, 2);
        setTargetId(first.id);
        setText(payload);
        setExLabel(first.examples.valid.title);
        await validate(first.id, payload);
      } catch (e) {
        fail(e);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [params, validate]);

  const target = cfg?.targets.find((t) => t.id === targetId);

  useEffect(() => {
    if (!target) return;
    let live = true;
    get<{ schema: unknown }>(`/api/playground/validator/schema/${target.id}`).then((r) => live && setSchemaDoc(r.schema)).catch(() => live && setSchemaDoc(null));
    return () => {
      live = false;
    };
  }, [target]);

  useEffect(() => {
    const t = setTimeout(() => {
      get<{ events: InteractionRecord[] }>("/api/playground/inspector/events?limit=1000").then((r) => setEvents(r.events)).catch(() => setEvents([]));
    }, 0);
    return () => clearTimeout(t);
  }, [targetId]);

  function pick(ex: Example) {
    const payload = JSON.stringify(ex.payload, null, 2);
    setText(payload);
    setExLabel(ex.title);
    if (target) void validate(target.id, payload);
  }
  function changeTarget(id: string) {
    setTargetId(id);
    setReport(null);
    const t = cfg?.targets.find((x) => x.id === id);
    if (!t) return;
    const payload = JSON.stringify(t.examples.valid.payload, null, 2);
    setText(payload);
    setExLabel(t.examples.valid.title);
    void validate(id, payload);
  }

  const candidates: { e: InteractionRecord; dir: "request" | "response" }[] = [];
  if (cfg) {
    for (const e of events) {
      if (e.status && e.status >= 400) continue; // error bodies belong to the error_response target
      for (const dir of ["request", "response"] as const) {
        const body = dir === "request" ? e.requestBody : e.responseBody;
        if (cfg.opTargets[e.op]?.[dir] === targetId && body !== undefined) candidates.push({ e, dir });
      }
    }
  }
  const recent = candidates.slice(-12).reverse();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (!cfg) return error ? <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div> : <Loader2 className="size-4 animate-spin" aria-label="Loading" />;

  return (
    <div className="space-y-4">
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">1 · Choose what to validate</CardTitle>
          <CardDescription>{target?.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Message type</span>
            <select aria-label="Message type" value={targetId} onChange={(e) => changeTarget(e.target.value)} className="h-9 w-full max-w-md rounded-md border bg-background px-2 text-sm" data-testid="target">
              {cfg.targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          {target && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Examples">
              <Button size="sm" variant="outline" onClick={() => pick(target.examples.valid)} data-testid="ex-valid"><CheckCircle2 className="size-3.5 text-emerald-500" /> Valid example</Button>
              {target.examples.invalid.map((ex, i) => (
                <Button key={ex.title} size="sm" variant="outline" onClick={() => pick(ex)} title={ex.why} data-testid={`ex-invalid-${i}`}>
                  <XCircle className="size-3.5 text-destructive" /> {ex.title}
                </Button>
              ))}
            </div>
          )}
          {recent.length > 0 && (
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">…or load a real body this session recorded (redacted)</span>
              <select aria-label="Load from the inspector" className="h-9 w-full max-w-xl rounded-md border bg-background px-2 text-sm" value="" onChange={(e) => {
                const [id, dir] = e.target.value.split("|");
                const c = recent.find((x) => x.e.id === id && x.dir === dir);
                if (!c) return;
                const body = c.dir === "request" ? c.e.requestBody : c.e.responseBody;
                const payload = JSON.stringify(body, null, 2);
                setText(payload);
                setExLabel(`${c.e.actor}:${c.e.op} ${c.dir} (recorded ${c.e.ts.slice(11, 19)}, redacted)`);
                void validate(targetId, payload);
              }}>
                <option value="">select an interaction…</option>
                {recent.map(({ e, dir }) => <option key={`${e.id}|${dir}`} value={`${e.id}|${dir}`}>{e.ts.slice(11, 19)} · {e.actor} · {e.op} · {dir}</option>)}
              </select>
            </label>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">2 · Payload</CardTitle>
            <CardDescription>{exLabel ? `Loaded: ${exLabel}. ` : ""}Edit freely; broken JSON is reported too.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <textarea aria-label="Payload" value={text} onChange={(e) => { setText(e.target.value); setExLabel(null); }} spellCheck={false} className="h-96 w-full rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed" data-testid="payload" />
            <Button onClick={() => validate(targetId, text)} disabled={busy} data-testid="validate">{busy && <Loader2 className="size-4 animate-spin" />} Validate</Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {report && (
            <Card data-testid="schema-result">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  3 · JSON Schema validation
                  {!report.parse.ok ? <Badge variant="destructive">not valid JSON</Badge> : report.schema?.ok ? <Badge className="bg-emerald-600 text-white">schema-valid</Badge> : <Badge variant="destructive">{report.schema?.issues.length} issue(s)</Badge>}
                </CardTitle>
                <CardDescription className="font-mono text-xs">validated with {report.target.zodName} (generated from the official {report.target.docFile})</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {!report.parse.ok && <p role="alert" className="font-mono text-xs text-destructive" data-testid="parse-error">{report.parse.message}</p>}
                {report.schema?.ok && <p className="text-xs text-muted-foreground">Every required member is present with the right type. Extra members are allowed: UCP objects are open for extension.</p>}
                {report.schema && report.schema.issues.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-muted-foreground"><tr><th className="py-1 pr-3">Path</th><th className="pr-3">Problem</th><th className="pr-3">Expected</th><th className="pr-3">Received</th><th>Actual value</th></tr></thead>
                      <tbody className="align-top font-mono">
                        {report.schema.issues.map((i, k) => (
                          <tr key={k} className="border-t" data-testid="issue">
                            <td className="py-1 pr-3 text-destructive">{i.path}</td>
                            <td className="pr-3 font-sans">{i.message}</td>
                            <td className="pr-3">{i.expected ?? "—"}</td>
                            <td className="pr-3">{i.received ?? "—"}</td>
                            <td className="break-all">{i.actual ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {report && (
            <Card data-testid="rules-result">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">4 · Spec-rule checks <span className="text-xs font-normal text-muted-foreground">(beyond the schema)</span></CardTitle>
                <CardDescription>Rules a schema cannot express. They are not protocol conformance either.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {report.rules.length === 0 && <p className="text-muted-foreground">No rule checks are defined for this message type.</p>}
                {report.rules.map((r) => (
                  <div key={r.id} className="flex gap-2" data-testid="rule" data-ok={r.ok}>
                    {r.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-label="pass" /> : r.level === "spec" ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label="fail" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-label="warn" />}
                    <div>
                      <div>{r.statement} <Badge variant="outline" className="ml-1 text-[10px]">{LEVEL[r.level]}</Badge></div>
                      <div className="text-muted-foreground">{r.source}{r.detail ? ` · ${r.detail}` : ""}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="border-amber-500/40">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CircleHelp className="size-4" aria-hidden /> Schema validation is not conformance</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <p data-testid="scope">{cfg.scope}</p>
              <p className="text-muted-foreground">Not checked here: capability negotiation, status transitions, idempotency, authentication, signatures, price calculation, webhook delivery. Official conformance suite: <strong>not run</strong>.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Expected schema</CardTitle><CardDescription>Official source document <a className="text-primary hover:underline" href={target?.docUrl} target="_blank" rel="noreferrer">{target?.docFile}</a> (unmodified, annotations unresolved). The generated Zod schema above is what actually validates.</CardDescription></CardHeader>
          <CardContent>{schemaDoc ? <JsonView value={schemaDoc} label="official schema" maxHeight="24rem" /> : <p className="text-sm text-muted-foreground">Loading…</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Actual payload</CardTitle><CardDescription>As parsed from the editor.</CardDescription></CardHeader>
          <CardContent>{parsed !== undefined ? <JsonView value={parsed} label="payload" maxHeight="24rem" /> : <p className="text-sm text-muted-foreground">Nothing parseable to show.</p>}</CardContent>
        </Card>
      </div>
    </div>
  );
}
