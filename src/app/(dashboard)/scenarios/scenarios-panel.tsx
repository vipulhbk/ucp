"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Circle, Loader2, Play, RotateCcw, XCircle } from "lucide-react";
import { ConfirmationCard } from "@/components/checkout/confirmation-card";
import { ExchangePanel } from "@/components/exchange/exchange-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BffError, get, post } from "@/lib/api";
import type { ScenarioState, StepResult } from "@/app-services/scenarios/types";

interface Described {
  id: string;
  title: string;
  summary: string;
  specRefs: string[];
  steps: { id: string; title: string; protocol: string; kind: "auto" | "buyer" }[];
}
type Done = ScenarioState["results"][number];

export function ScenariosPanel() {
  const initial = useSearchParams().get("s");
  const [list, setList] = useState<Described[]>([]);
  const [sel, setSel] = useState<string | null>(initial);
  const [state, setState] = useState<ScenarioState | null>(null);
  const [last, setLast] = useState<StepResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof BffError ? e.info.message : (e as Error).message);

  useEffect(() => {
    const t = setTimeout(() => {
      get<{ scenarios: Described[] }>("/api/playground/scenarios")
        .then((r) => {
          setList(r.scenarios);
          setSel((s) => s ?? r.scenarios[0]!.id);
        })
        .catch(fail);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const loadState = useCallback(async (id: string) => {
    try {
      const r = await get<{ state: ScenarioState }>(`/api/playground/scenarios/${id}`);
      setState(r.state);
      setLast(null);
    } catch (e) {
      fail(e);
    }
  }, []);
  useEffect(() => {
    if (!sel) return;
    const t = setTimeout(() => void loadState(sel), 0);
    return () => clearTimeout(t);
  }, [sel, loadState]);

  const def = list.find((s) => s.id === sel);

  async function runOne(): Promise<(StepResult & { done: boolean }) | null> {
    if (!sel) return null;
    try {
      const r = await post<{ state: ScenarioState; result: StepResult }>(`/api/playground/scenarios/${sel}/run`);
      setState(r.state);
      setLast(r.result);
      return { ...r.result, done: r.state.done };
    } catch (e) {
      fail(e);
      return null;
    }
  }
  async function step() {
    setBusy(true);
    setError(null);
    await runOne();
    setBusy(false);
  }
  /** Run automatic steps until the next buyer step, a failure, or the end. */
  async function runToBuyer() {
    setBusy(true);
    setError(null);
    for (let i = 0; i < 20; i++) {
      const r = await runOne();
      if (!r || !r.ok || r.needsBuyer || r.done) break;
    }
    setBusy(false);
  }
  async function reset() {
    if (!sel) return;
    setBusy(true);
    try {
      await post(`/api/playground/scenarios/${sel}/reset`);
      await loadState(sel);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const idx = state?.index ?? 0;
  const waiting = state?.awaitingBuyer && last?.needsBuyer;
  const doneBy = (id: string): Done | undefined => state?.results.find((r) => r.stepId === id);

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Scenarios" className="space-y-1">
        {list.map((s, i) => (
          <button key={s.id} type="button" onClick={() => setSel(s.id)} aria-current={s.id === sel ? "true" : undefined} className={`block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent ${s.id === sel ? "bg-accent font-medium" : ""}`} data-testid={`scenario-${s.id}`}>
            <span className="mr-2 font-mono text-xs text-muted-foreground">{i + 1}</span>{s.title}
          </button>
        ))}
      </nav>

      {def && state && (
        <div className="space-y-3">
          {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {def.title}
                <Badge variant="outline">{state.done ? "complete" : `step ${Math.min(idx + 1, def.steps.length)} of ${def.steps.length}`}</Badge>
              </CardTitle>
              <CardDescription>{def.summary}</CardDescription>
              <p className="text-xs text-muted-foreground">Spec: {def.specRefs.join(" · ")}</p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={step} disabled={busy || state.done || !!waiting} data-testid="run-step">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {state.done ? "Finished" : waiting ? "Waiting for your authorization" : `Run step ${idx + 1}`}
              </Button>
              <Button variant="outline" onClick={runToBuyer} disabled={busy || state.done || !!waiting} data-testid="run-all">Run to the next buyer step</Button>
              <Button variant="ghost" onClick={reset} disabled={busy} data-testid="reset"><RotateCcw className="size-4" /> Reset scenario</Button>
            </CardContent>
          </Card>

          <ol className="space-y-2">
            {def.steps.map((s, i) => {
              const done = doneBy(s.id);
              const current = i === idx && !state.done;
              return (
                <li key={s.id} className={`rounded-md border p-3 ${current ? "border-primary/60" : ""}`} data-testid={`step-${s.id}`} data-state={done ? "done" : current ? "current" : "pending"}>
                  <div className="flex items-start gap-2">
                    {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-label="done" /> : current ? <ChevronRight className="mt-0.5 size-4 shrink-0 text-primary" aria-label="current" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="pending" />}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-medium">{i + 1}. {s.title} {s.kind === "buyer" && <Badge variant="outline" className="ml-1 border-amber-500/50 text-amber-600 dark:text-amber-400">needs you</Badge>}</div>
                      <p className="text-xs text-muted-foreground"><span className="font-medium">Spec:</span> {s.protocol}</p>

                      {done && <StepOutcome r={done} />}
                      {current && last && !last.needsBuyer && <StepOutcome r={last} />}
                      {current && waiting && last?.needsBuyer && (
                        <div className="space-y-2 pt-1">
                          <ConfirmationCard
                            key={last.needsBuyer.checkoutId}
                            checkoutId={last.needsBuyer.checkoutId}
                            expectedTotal={last.needsBuyer.expectedTotal}
                            cards={last.needsBuyer.cards}
                            defaultCardId={last.needsBuyer.defaultCardId}
                            instruction={last.needsBuyer.instruction}
                            onDone={async () => {
                              setBusy(true);
                              await runOne(); // verify what the click actually did, by asking the merchant
                              setBusy(false);
                            }}
                          />
                          {last.exchanges.map((x, k) => <ExchangePanel key={k} exchange={x} />)}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function StepOutcome({ r }: { r: StepResult }) {
  return (
    <div className="space-y-2 pt-1 text-sm">
      <div className={`flex items-center gap-1.5 ${r.ok ? "" : "text-destructive"}`}>{r.ok ? <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />} {r.summary}</div>
      {r.facts && r.facts.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,12rem)_1fr] gap-x-3 gap-y-0.5 text-xs">
          {r.facts.map((f, i) => (<div key={i} className="contents"><dt className="truncate text-muted-foreground">{f.label}</dt><dd className="break-words font-mono">{f.value}</dd></div>))}
        </dl>
      )}
      {r.exchanges.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{r.exchanges.length} real exchange{r.exchanges.length > 1 ? "s" : ""}</summary>
          <div className="mt-2 space-y-2">{r.exchanges.map((x, i) => <ExchangePanel key={i} exchange={x} />)}</div>
        </details>
      )}
    </div>
  );
}
