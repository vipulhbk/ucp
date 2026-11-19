"use client";

import Link from "next/link";
import { useMemo, useState, type ComponentType } from "react";
import { ArrowRight, Baby, Bike, Check, Heart, Loader2, MapPin, Moon, Mountain, Palette, Shuffle, ShoppingBag, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BffError, post } from "@/lib/api";
import { rupees } from "@/lib/format";
import { rankTrips } from "@/trips/rank";
import { BUDGET_LABEL, BUDGET_TIERS, INTERESTS, INTEREST_LABEL, type BudgetTier, type Interest, type PlanResult } from "@/trips/types";
import type { TripSummary } from "./trip-card";

const MAX_INTERESTS = 3;
const ICON: Record<Interest, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  art: Palette, kids: Baby, sports: Bike, shopping: ShoppingBag, beaches: Waves, nightlife: Moon, romantic: Heart, scenic: Mountain,
};

type Step = "where" | "about" | "result";

/**
 * The three-step planner: where, about you, result. The trip is chosen by the rule-based demo planner on the server
 * (/api/playground/trips/plan) and the result names it. While the traveller chooses, the form previews that same ranking in
 * the browser (`rankTrips`), so the form reacts to every tap, but the result always comes from the server.
 */
export function PlannerFlow({ trips = [] }: { trips?: TripSummary[] }) {
  const [step, setStep] = useState<Step>("where");
  const [destination, setDestination] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [budget, setBudget] = useState<BudgetTier | undefined>();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);

  const full = interests.length >= MAX_INTERESTS;
  const toggle = (i: Interest) => setInterests((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : cur.length >= MAX_INTERESTS ? cur : [...cur, i]));

  const ranked = useMemo(() => (trips.length ? rankTrips({ destination, interests, budgetTier: budget, notes }, trips) : []), [trips, destination, interests, budget, notes]);
  const leader = ranked[0]?.trip;

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

  const choose = (t: TripSummary) => {
    setDestination(t.destination);
    setStep("about");
  };
  const surprise = () => {
    if (trips.length) choose(trips[Math.floor(Math.random() * trips.length)]!);
  };
  const reset = () => {
    setStep("where");
    setPlan(null);
    setError(null);
  };

  const pill = "h-11 rounded-full px-6 text-[15px]";
  const picked = plan ? trips.find((t) => t.id === plan.trip.id) : undefined;
  const alsoConsider = plan ? ranked.filter((r) => r.trip.id !== plan.trip.id).slice(0, 2) : [];
  const stepIndex = step === "where" ? 0 : step === "about" ? 1 : 2;

  return (
    <div className="ap-card mx-auto w-full max-w-xl overflow-hidden p-6 text-left shadow-[var(--ap-shadow-hover)] sm:p-9" data-testid="planner">
      <ol className="mb-7 flex items-center justify-center gap-2 text-xs text-muted-foreground" aria-label="Progress">
        {([["where", "Where"], ["about", "About you"], ["result", "Your trip"]] as const).map(([id, label], i) => (
          <li key={id} aria-current={step === id ? "step" : undefined} className={`flex items-center gap-2 ${step === id ? "font-semibold text-foreground" : ""}`}>
            <span className={`h-1.5 rounded-full transition-all duration-500 ${i <= stepIndex ? "bg-primary" : "bg-muted-foreground/40"} ${step === id ? "w-6" : "w-1.5"}`} aria-hidden />
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
          className="ap-rise space-y-5"
        >
          <label htmlFor="destination" className="ap-title block text-center text-2xl">Where do you want to go?</label>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input id="destination" value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={80} placeholder="Paris, Goa, Kyoto…" autoComplete="off" className="ap-field text-lg" style={{ paddingLeft: "3rem" }} />
          </div>
          {trips.length > 0 && (
            <div>
              <p className="mb-2.5 text-center text-xs font-medium text-muted-foreground">Or start from a popular pick</p>
              <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Popular destinations">
                {trips.map((t) => (
                  <button key={t.id} type="button" onClick={() => choose(t)} className="ap-chip ap-press inline-flex items-center gap-2 !py-1.5 !pl-1.5" data-testid="quick-pick">
                    {/* eslint-disable-next-line @next/next/no-img-element -- decorative static SVG */}
                    <img src={t.cover} alt="" className="size-6 rounded-full object-cover" />
                    {t.destination}
                  </button>
                ))}
                <button type="button" onClick={surprise} className="ap-chip ap-press inline-flex items-center gap-1.5 !text-primary" data-testid="surprise">
                  <Shuffle className="size-3.5" aria-hidden /> Surprise me
                </button>
              </div>
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground">Anything else gets the closest match for your interests, and we will say so.</p>
          <div className="flex justify-center pt-1">
            <Button type="submit" className={pill}>Continue <ArrowRight className="size-4" aria-hidden /></Button>
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
          <div className="text-center">
            <h2 className="ap-title text-2xl">About you</h2>
            {destination.trim() && <p className="mt-1 text-sm text-muted-foreground">Planning for <span className="font-medium text-foreground">{destination.trim()}</span></p>}
          </div>
          <fieldset>
            <legend className="mb-3 w-full text-center text-sm">What are you interested in? <span className="text-muted-foreground">Pick up to {MAX_INTERESTS}.</span></legend>
            <div className="flex flex-wrap justify-center gap-2">
              {INTERESTS.map((i) => {
                const on = interests.includes(i);
                const Icon = ICON[i];
                return (
                  <label key={i} className={`ap-press inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-sm transition-colors duration-300 ${on ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-secondary"} ${!on && full ? "cursor-not-allowed opacity-40" : ""} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]`}>
                    <input type="checkbox" className="sr-only" checked={on} disabled={!on && full} onChange={() => toggle(i)} />
                    {on ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : <Icon className="size-3.5 opacity-70" aria-hidden />}
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
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} placeholder="E.g. travelling with kids, or avoid night life" className="ap-field resize-none text-sm" />
            <p className="mt-1.5 text-center text-xs text-muted-foreground">The planner understands a few keywords (kids, quiet, avoid night life, number of days), not full sentences.</p>
          </div>

          {leader && (
            <div aria-live="polite" data-testid="live-match">
              <div key={leader.id} className="ap-rise flex items-center gap-4 rounded-2xl bg-muted p-3 pr-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- decorative static SVG */}
                <img src={leader.cover} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Best match so far</div>
                  <div className="ap-title truncate text-lg">{leader.destination}, {leader.country}</div>
                  <div className="truncate text-xs text-muted-foreground">{leader.days} days · {BUDGET_LABEL[leader.budgetTier].symbol} · {leader.tagline}</div>
                </div>
              </div>
              <p className="mt-1.5 text-center text-[11px] text-muted-foreground">A live preview of the planner&rsquo;s ranking. It updates as you choose.</p>
            </div>
          )}

          {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
          <div className="flex items-center justify-center gap-5">
            <button type="button" onClick={() => setStep("where")} disabled={busy} className="ap-link text-[15px]">&lsaquo; Back</button>
            <Button type="submit" disabled={busy} className={pill} data-testid="plan-submit">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Plan my trip
            </Button>
          </div>
        </form>
      )}

      {step === "result" && plan && (
        <div className="space-y-6" data-testid="plan-result">
          <div className="ap-rise relative overflow-hidden rounded-2xl" style={{ "--i": 0 } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative static SVG */}
            <img src={plan.trip.cover} alt="" className="aspect-[16/10] w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-5 pt-16 text-white">
              <div className="text-xs font-medium opacity-90">{plan.trip.country}</div>
              <h2 className="ap-title text-3xl">{plan.trip.title}</h2>
              <p className="mt-0.5 text-sm opacity-90">{plan.trip.tagline}</p>
            </div>
          </div>

          <div className="ap-rise flex flex-wrap items-center justify-center gap-2" style={{ "--i": 1 } as React.CSSProperties}>
            <Badge variant="secondary">{plan.source.name}</Badge>
            <span className="ap-chip !cursor-default hover:!bg-card">{plan.trip.days} days</span>
            <span className="ap-chip !cursor-default hover:!bg-card">{BUDGET_LABEL[plan.trip.budgetTier].symbol} {BUDGET_LABEL[plan.trip.budgetTier].range}</span>
            <span className="ap-chip !cursor-default hover:!bg-card">Best in {plan.trip.bestSeason}</span>
            {picked && <span className="ap-chip !cursor-default font-semibold hover:!bg-card">From {rupees(picked.packageTotal)}</span>}
          </div>

          <div className="ap-rise" style={{ "--i": 2 } as React.CSSProperties}>
            <h3 className="mb-2 text-sm font-semibold">Why this trip</h3>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {plan.reasons.map((r) => (
                <li key={r} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={3} aria-hidden />{r}</li>
              ))}
            </ul>
          </div>

          {plan.caveats.length > 0 && (
            <div className="ap-rise rounded-2xl bg-muted p-4 text-sm" role="note" data-testid="plan-caveats" style={{ "--i": 3 } as React.CSSProperties}>
              <div className="mb-1 font-semibold">Worth knowing</div>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{plan.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}

          <div className="ap-rise" style={{ "--i": 4 } as React.CSSProperties}>
            <h3 className="mb-2 text-sm font-semibold">Your {plan.trip.days} days at a glance</h3>
            <ol className="ap-group" data-testid="day-glance">
              {plan.trip.itinerary.map((d) => (
                <li key={d.day} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="ap-tile !size-7 !rounded-lg text-xs font-semibold" aria-hidden>{d.day}</span>
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{d.items.length} stops</span>
                </li>
              ))}
            </ol>
          </div>

          {alsoConsider.length > 0 && (
            <div className="ap-rise" style={{ "--i": 5 } as React.CSSProperties}>
              <h3 className="mb-2 text-sm font-semibold">Also worth a look</h3>
              <div className="grid grid-cols-2 gap-3">
                {alsoConsider.map(({ trip: t }) => (
                  <Link key={t.id} href={`/trips/${t.id}`} className="ap-lift ap-zoom group overflow-hidden rounded-2xl bg-muted" data-testid="also-consider">
                    <div className="overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element -- decorative static SVG */}
                      <img src={t.cover} alt="" className="aspect-[16/9] w-full object-cover" />
                    </div>
                    <div className="px-3 py-2.5">
                      <div className="truncate text-sm font-semibold">{t.destination}</div>
                      <div className="text-xs text-muted-foreground">{t.days} days · {rupees(t.packageTotal)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="ap-rise flex flex-wrap items-center justify-center gap-5 pt-1" style={{ "--i": 6 } as React.CSSProperties}>
            <button type="button" onClick={reset} className="ap-link text-[15px]">Start over</button>
            <Link href={`/trips/${plan.trip.id}`} className="ap-press inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-medium text-primary-foreground hover:opacity-90">
              See the itinerary and book <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
