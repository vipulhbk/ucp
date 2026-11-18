"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BffError, get, post } from "@/lib/api";
import { GeneratedPlan } from "./generated-plan";
import { BUDGET_LABEL, BUDGET_TIERS, INTERESTS, INTEREST_LABEL, type BudgetTier, type Interest, type PlanResult } from "@/trips/types";

const MAX_INTERESTS = 3;

type Step = "where" | "about" | "result";
type PlannerInfo = { mode: "mock" } | { mode: "gemini"; model: string };

/**
 * The three-step planner: where, about you, result. The server decides whether Gemini or the rule-based mock plans the trip
 * (/api/playground/trips/plan). The form asks which one first, so it can say before anything is sent whether the text goes to
 * Google, and the result always names who wrote the plan.
 */
export function PlannerFlow() {
  const [step, setStep] = useState<Step>("where");
  const [destination, setDestination] = useState("Paris, France");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [budget, setBudget] = useState<BudgetTier | undefined>();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [info, setInfo] = useState<PlannerInfo>({ mode: "mock" });
  const ai = info.mode === "gemini";

  useEffect(() => {
    void get<PlannerInfo>("/api/playground/trips/planner").then(setInfo).catch(() => undefined);
  }, []);

  const full = interests.length >= MAX_INTERESTS;
  const toggle = (i: Interest) => setInterests((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : cur.length >= MAX_INTERESTS ? cur : [...cur, i]));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setPlan(await post<PlanResult>("/api/playground/trips/plan", { destination, interests, budgetTier: budget, notes }));
      setStep("result");
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const reset = () => {
    setStep("where");
    setPlan(null);
    setError(null);
  };

  const pill = "h-11 rounded-full px-6 text-[15px]";
  return (
    <div className={`ap-card mx-auto w-full overflow-hidden p-6 text-left shadow-[var(--ap-shadow-hover)] transition-[max-width] duration-500 sm:p-9 ${plan?.generated ? "max-w-2xl" : "max-w-xl"}`} data-testid="planner">
      <ol className="mb-6 flex items-center justify-center gap-2 text-xs text-muted-foreground" aria-label="Progress">
        {([["where", "Where"], ["about", "About you"], ["result", "Your trip"]] as const).map(([id, label], i) => (
          <li key={id} aria-current={step === id ? "step" : undefined} className={`flex items-center gap-2 ${step === id ? "font-semibold text-foreground" : ""}`}>
            <span className={`h-1.5 rounded-full transition-all duration-500 ${step === id ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/40"}`} aria-hidden />
            {label}
            {i < 2 && <span aria-hidden className="mx-1 h-px w-5 bg-border" />}
          </li>
        ))}
      </ol>

      {step === "where" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStep("about");
          }}
          className="ap-rise space-y-4"
        >
          <label htmlFor="destination" className="ap-title block text-center text-2xl">Where do you want to go?</label>
          <input id="destination" value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={80} placeholder="Paris, France" className="ap-field text-center text-lg" />
          <p className="text-center text-xs text-muted-foreground">
            {ai ? "Type any city, region or country." : "Try Paris, Goa, Jaipur, Bali, Kyoto, Singapore, Manali or Santorini. Anything else gets the closest match, and we will say so."}
          </p>
          <div className="flex justify-center pt-1">
            <Button type="submit" className={pill}>Continue</Button>
          </div>
        </form>
      )}

      {step === "about" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="ap-rise space-y-7"
        >
          <h2 className="ap-title text-center text-2xl">About you</h2>
          <fieldset>
            <legend className="mb-3 w-full text-center text-sm">What are you interested in? <span className="text-muted-foreground">Pick up to {MAX_INTERESTS}.</span></legend>
            <div className="flex flex-wrap justify-center gap-2">
              {INTERESTS.map((i) => {
                const on = interests.includes(i);
                return (
                  <label key={i} className={`ap-press inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-sm transition-colors duration-300 ${on ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-secondary"} ${!on && full ? "cursor-not-allowed opacity-40" : ""} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]`}>
                    <input type="checkbox" className="sr-only" checked={on} disabled={!on && full} onChange={() => toggle(i)} />
                    {on && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
                    {INTEREST_LABEL[i]}
                  </label>
                );
              })}
            </div>
            {full && <p className="mt-2 text-center text-xs text-muted-foreground" role="status">That is {MAX_INTERESTS}. Deselect one to choose another.</p>}
          </fieldset>

          <fieldset>
            <legend className="mb-3 w-full text-center text-sm">How much do you want to spend per day?</legend>
            <div className="mx-auto flex w-fit rounded-full bg-muted p-1" role="radiogroup" aria-label="Budget per day">
              {BUDGET_TIERS.map((b) => (
                <label key={b} title={BUDGET_LABEL[b].range} className={`cursor-pointer rounded-full px-4 py-1.5 text-sm transition-all duration-300 ${budget === b ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--ring)]`}>
                  <input type="radio" name="budget" className="sr-only" checked={budget === b} onChange={() => setBudget(b)} />
                  {BUDGET_LABEL[b].symbol}
                </label>
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">{budget ? BUDGET_LABEL[budget].range : "Optional. Hover a symbol for the range."}</p>
          </fieldset>

          <div>
            <label htmlFor="notes" className="mb-2 block text-center text-sm">Anything else?</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3} placeholder={ai ? "E.g. 5 days, travelling with two kids, we like street food and avoid crowds" : "E.g. travelling with kids, or avoid night life"} className="ap-field resize-none text-sm" />
            <p className="mt-1.5 text-center text-xs text-muted-foreground">
              {ai ? "Gemini reads full sentences, so describe the trip you want." : "The demo planner understands a few keywords (kids, quiet, avoid night life, number of days), not full sentences."}
            </p>
          </div>

          {ai && (
            <p className="rounded-2xl bg-muted p-3 text-center text-xs leading-relaxed text-muted-foreground" data-testid="gemini-disclosure">
              When you press Plan, your destination, interests, budget and notes are sent to Google&rsquo;s Gemini API ({info.model}). On the free tier Google may use them to improve its products, so please do not type personal details.
            </p>
          )}
          {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-center gap-5">
            <button type="button" onClick={() => setStep("where")} disabled={busy} className="ap-link text-[15px]">&lsaquo; Back</button>
            <Button type="submit" disabled={busy} className={pill} data-testid="plan-submit">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {busy && ai ? "Asking Gemini…" : "Plan my trip"}
            </Button>
          </div>
        </form>
      )}

      {step === "result" && plan && (
        <div className="ap-rise space-y-5" data-testid="plan-result">
          {!plan.generated && (
            // eslint-disable-next-line @next/next/no-img-element -- decorative static SVG
            <img src={plan.trip.cover} alt="" className="aspect-[16/9] w-full rounded-2xl object-cover" />
          )}
          <div className="text-center">
            <Badge variant="secondary" className="mb-3">{plan.source.name}</Badge>
            <h2 className="ap-title text-3xl">{plan.generated?.title ?? plan.trip.title}</h2>
            <p className="mt-1 text-muted-foreground">{plan.generated?.tagline ?? plan.trip.tagline}</p>
          </div>
          <div>
            <h3 className="mb-1.5 text-sm font-semibold">{plan.generated ? "How this was planned" : "Why this trip"}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{plan.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
          {plan.caveats.length > 0 && (
            <div className="rounded-2xl bg-muted p-4 text-sm" role="note" data-testid="plan-caveats">
              <div className="mb-1 font-semibold">Worth knowing</div>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{plan.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
          {plan.generated && <GeneratedPlan plan={plan.generated} />}
          <div className="flex flex-wrap items-center justify-center gap-5 pt-1">
            <button type="button" onClick={reset} className="ap-link text-[15px]">Start over</button>
            <Link href={`/trips/${plan.trip.id}`} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-[15px] font-medium text-primary-foreground hover:opacity-90">
              {plan.generated ? `Book the closest ready-made trip: ${plan.trip.destination}` : "See the itinerary"}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
