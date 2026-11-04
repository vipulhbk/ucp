"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { JsonView } from "@/components/json/json-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DiscoveryReport } from "@/platform/discovery";
import { PLATFORM_VARIANTS, type PlatformVariant } from "@/platform/profile-variants";

const VARIANTS = (Object.entries(PLATFORM_VARIANTS) as [PlatformVariant, string][]).map(([id, explain]) => ({ id, explain, label: id === "default" ? "Compatible platform" : id }));
type Variant = PlatformVariant;

export function DiscoveryPanel() {
  const [variant, setVariant] = useState<Variant>("default");
  const [report, setReport] = useState<DiscoveryReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch("/api/playground/discovery/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ variant }) });
      const body = await res.json();
      if (!res.ok) setFailure(body.message ?? body.error ?? `HTTP ${res.status}`);
      else setReport(body as DiscoveryReport);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const explain = VARIANTS.find((v) => v.id === variant)!.explain;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Choose the platform and run discovery</CardTitle>
          <CardDescription>{explain}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Platform fixture" className="flex flex-wrap gap-1">
            {VARIANTS.map((v) => (
              <Button key={v.id} role="radio" aria-checked={variant === v.id} variant={variant === v.id ? "default" : "outline"} size="sm" onClick={() => setVariant(v.id)}>
                {v.label}
              </Button>
            ))}
          </div>
          <Button onClick={run} disabled={busy} className="ml-auto" data-testid="run-discovery">
            {busy && <Loader2 className="size-4 animate-spin" />} Discover merchant
          </Button>
        </CardContent>
      </Card>

      {failure && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          {failure}
        </div>
      )}

      {!report && !failure && <p className="text-sm text-muted-foreground">No discovery run yet. The result, the raw profile and every check will appear here.</p>}

      {report && <Result report={report} />}
    </div>
  );
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {ok ? <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> : <XCircle className="size-4 text-destructive" aria-hidden />}
      {children}
    </span>
  );
}

function Result({ report }: { report: DiscoveryReport }) {
  return (
    <Card data-testid="discovery-result">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          2 · Result
          <Status ok={report.ok}>{report.ok ? "Discovery succeeded" : `Discovery failed: ${report.error?.kind}`}</Status>
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          GET {report.profileUrl}
          {report.fetch && ` → ${report.fetch.status} in ${report.fetch.durationMs} ms (${report.fetch.resolvedIp})`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {report.error && (
          <div role="alert" className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            <div>
              <div className="font-medium">{report.error.kind}</div>
              <div className="text-muted-foreground">{report.error.message}</div>
            </div>
          </div>
        )}

        <Tabs defaultValue="summary">
          <TabsList className="flex-wrap">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="raw">Raw profile</TabsTrigger>
            <TabsTrigger value="negotiation">Negotiation</TabsTrigger>
            <TabsTrigger value="binding">Authority binding</TabsTrigger>
            <TabsTrigger value="validation">Schema validation</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-3 pt-3 text-sm">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted-foreground">Protocol version selected</dt>
              <dd className="font-mono">{report.versionSelection ? (report.versionSelection.kind === "unsupported" ? "none" : report.versionSelection.version) : "—"}</dd>
              <dt className="text-muted-foreground">REST endpoint (from profile)</dt>
              <dd className="break-all font-mono">{report.rest?.endpoint ?? "—"}</dd>
              <dt className="text-muted-foreground">Active capabilities</dt>
              <dd className="flex flex-wrap gap-1.5">
                {report.negotiation ? Object.entries(report.negotiation.active).map(([n, e]) => (
                  <Badge key={n} variant="secondary" className="font-mono text-[11px]">
                    {n} @ {e.version}
                  </Badge>
                )) : "—"}
              </dd>
              <dt className="text-muted-foreground">Excluded</dt>
              <dd className="space-y-1">
                {report.negotiation?.excluded.length ? report.negotiation.excluded.map((x) => (
                  <div key={x.name} className="font-mono text-xs">
                    {x.name} <span className="text-muted-foreground">— {x.reason}: {x.detail}</span>
                  </div>
                )) : "none"}
              </dd>
              <dt className="text-muted-foreground">Payment handlers</dt>
              <dd className="space-y-1">
                {report.paymentHandlers.length ? report.paymentHandlers.map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center gap-2 font-mono text-xs">
                    {h.name} <span className="text-muted-foreground">id={h.id} · instruments: {h.instruments.join(", ") || "—"}</span>
                    {h.simulated && <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">simulated</Badge>}
                  </div>
                )) : "none"}
              </dd>
            </dl>
          </TabsContent>

          <TabsContent value="raw" className="pt-3">
            {report.profile ? <JsonView value={report.profile} label="profile" /> : <p className="text-sm text-muted-foreground">No profile was retrieved.</p>}
          </TabsContent>

          <TabsContent value="negotiation" className="space-y-2 pt-3 text-sm">
            <p className="text-muted-foreground">Exact-version intersection, then orphaned extensions are pruned (spec: Intersection Algorithm).</p>
            {report.negotiation ? (
              <ol className="list-decimal space-y-1 pl-5 font-mono text-xs">
                {report.negotiation.trace.map((t, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">step {t.step}:</span> {t.detail}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground">Negotiation did not run.</p>
            )}
          </TabsContent>

          <TabsContent value="binding" className="pt-3">
            <p className="mb-2 text-sm text-muted-foreground">
              A schema URL must be served from the namespace authority of the entity that declares it. This proves provenance, not trust. <strong>relaxed</strong> marks a documented demo deviation (localhost and shared public suffixes cannot be spec-valid authorities).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Entity</th>
                    <th className="pr-3">Name</th>
                    <th className="pr-3">Result</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {report.bindings.map((b, i) => (
                    <tr key={i} className="border-t align-top">
                      <td className="py-1 pr-3">{b.entity}</td>
                      <td className="pr-3">{b.name}</td>
                      <td className="pr-3">
                        <Badge variant={b.result.status === "invalid" ? "destructive" : "secondary"}>{b.result.status}</Badge>
                      </td>
                      <td className="text-muted-foreground">
                        {b.result.reason}
                        {b.result.warning && <div className="text-amber-600 dark:text-amber-400">⚠ {b.result.warning}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="validation" className="space-y-2 pt-3 text-sm">
            {report.profileValidation ? (
              <>
                <Status ok={report.profileValidation.ok}>
                  <span className="font-mono">{report.profileValidation.schema}</span> {report.profileValidation.ok ? "accepts this profile" : `rejects this profile (${report.profileValidation.issues.length} issues)`}
                </Status>
                <ul className="space-y-1 font-mono text-xs">
                  {report.profileValidation.issues.map((i, k) => (
                    <li key={k}>
                      <span className="text-destructive">{i.path}</span> — {i.message}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">This is JSON-shape validation with the official generated Zod schema. It is not protocol conformance.</p>
              </>
            ) : (
              <p className="text-muted-foreground">No profile to validate.</p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
