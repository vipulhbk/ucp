import { BedDouble, MapPin, Moon, Plane, Sun, Sunrise } from "lucide-react";
import type { GeneratedItinerary } from "@/trips/types";

const SLOT = {
  morning: { label: "Morning", Icon: Sunrise, tile: "#ff9500" },
  afternoon: { label: "Afternoon", Icon: Sun, tile: "#30a2d8" },
  evening: { label: "Evening", Icon: Moon, tile: "#5e5ce6" },
} as const;

/** A model-written itinerary. Every string is model output and is rendered as plain text, never as markup. */
export function GeneratedPlan({ plan }: { plan: GeneratedItinerary }) {
  return (
    <div className="space-y-4 text-left" data-testid="generated-plan">
      <ul className="flex flex-wrap justify-center gap-2" aria-label="Highlights">
        {plan.highlights.map((h) => <li key={h} className="rounded-full bg-muted px-3 py-1.5 text-xs">{h}</li>)}
      </ul>
      <p className="text-center text-xs text-muted-foreground">{plan.destination}, {plan.country} · best time: {plan.bestSeason}</p>

      {plan.gettingThere && (
        <div className="flex items-start gap-3 rounded-2xl bg-muted p-4" data-testid="getting-there">
          <span className="ap-tile mt-0.5" style={{ "--tile": "#30a2d8" } as React.CSSProperties} aria-hidden><Plane className="size-4" /></span>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Getting there</div>
            <p className="text-sm leading-snug">{plan.gettingThere}</p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {plan.itinerary.map((d, n) => (
          <details key={n} open={n === 0} className="ap-group group" data-testid="generated-day">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Day {n + 1}</span>
                <span className="ap-title text-lg">{d.title}</span>
              </span>
              <span className="text-lg text-muted-foreground transition-transform duration-300 group-open:rotate-90" aria-hidden>&rsaquo;</span>
            </summary>
            <ul>
              {d.items.map((i, k) => {
                const { label, Icon, tile } = SLOT[i.slot];
                return (
                  <li key={k} className="flex items-start gap-3 border-t border-border p-4">
                    <span className="ap-tile mt-0.5" style={{ "--tile": tile } as React.CSSProperties} aria-hidden><Icon className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-muted-foreground">{label}</div>
                      <div className="text-[15px] font-semibold leading-snug">{i.title}</div>
                      <div className="mt-0.5 text-sm leading-snug text-muted-foreground">{i.detail}</div>
                      <div className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" aria-hidden />{i.area}</div>
                    </div>
                    <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">{i.costInr === 0 ? "Free" : `~₹${i.costInr.toLocaleString("en-IN")}`}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>

      <div data-testid="stays">
        <h3 className="mb-1 text-sm font-semibold">Where to stay</h3>
        <p className="mb-2 text-xs text-muted-foreground">AI suggestions with rough per-room prices. They are not checked against live availability, and they cannot be booked here.</p>
        <ul className="ap-group">
          {plan.stays.map((s, i) => (
            <li key={i} className="flex items-start gap-3 p-4" data-testid="stay-option">
              <span className="ap-tile mt-0.5" style={{ "--tile": "#34c759" } as React.CSSProperties} aria-hidden><BedDouble className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-snug">{s.name}</div>
                <div className="text-xs text-muted-foreground"><span className="capitalize">{s.kind}</span> · {s.area}</div>
                <div className="mt-0.5 text-sm leading-snug text-muted-foreground">{s.why}</div>
              </div>
              <span className="shrink-0 pt-0.5 text-right text-xs text-muted-foreground">~₹{s.nightlyInr.toLocaleString("en-IN")}<br />a night</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold">Tips</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{plan.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
    </div>
  );
}
