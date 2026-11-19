import Link from "next/link";
import { notFound } from "next/navigation";
import { Lightbulb, MapPin, Moon, Sparkles, Sun, Sunrise } from "lucide-react";
import { allTripViews, tripViewById } from "@/app-services/trips";
import { BookPanel } from "@/components/trips/book-panel";
import { rupees } from "@/lib/format";
import { BUDGET_LABEL, INTEREST_LABEL } from "@/trips/types";

export const dynamicParams = false;

export function generateStaticParams() {
  return allTripViews().map((t) => ({ id: t.id }));
}

export async function generateMetadata({ params }: PageProps<"/trips/[id]">) {
  const t = tripViewById((await params).id);
  return { title: t ? `${t.title} · AI Trips` : "Trip not found" };
}

const SLOT = {
  morning: { label: "Morning", Icon: Sunrise, tile: "#ff9500" },
  afternoon: { label: "Afternoon", Icon: Sun, tile: "#30a2d8" },
  evening: { label: "Evening", Icon: Moon, tile: "#5e5ce6" },
} as const;

const delay = (i: number) => ({ "--i": i }) as React.CSSProperties;

export default async function TripPage({ params }: PageProps<"/trips/[id]">) {
  const trip = tripViewById((await params).id);
  if (!trip) notFound();
  const budget = BUDGET_LABEL[trip.budgetTier];
  const facts = [
    [String(trip.days), trip.days === 1 ? "day" : "days"],
    [budget.symbol, budget.range.replace(" a day", "") + " a day"],
    [trip.bestSeason, "best time to go"],
  ] as const;

  return (
    <>
      {/* Product-page bar: the trip's name and the way to book it stay in reach while reading. */}
      <div className="ap-glass sticky top-12 z-30 border-b border-border">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/trips" className="ap-link shrink-0 text-sm">&lsaquo; Trips</Link>
            <span className="truncate text-[15px] font-semibold">{trip.destination}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">From {rupees(trip.packageTotal)}</span>
            <a href="#book" className="ap-press inline-flex h-8 items-center rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:opacity-90">Book</a>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 md:px-8">
        <section className="ap-rise relative isolate flex min-h-[26rem] items-end overflow-hidden rounded-[2rem] p-7 text-white md:min-h-[34rem] md:p-12" aria-labelledby="trip-title">
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative static SVG */}
          <img src={trip.cover} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/15 to-transparent" aria-hidden />
          <div>
            <p className="mb-3 text-sm font-semibold tracking-wide opacity-90">{trip.country}</p>
            <h1 id="trip-title" className="ap-display ap-balance text-[clamp(2.5rem,7vw,5rem)]">{trip.title}</h1>
            <p className="ap-balance mt-3 max-w-xl text-xl leading-snug opacity-95 md:text-2xl">{trip.tagline}</p>
          </div>
        </section>

        <dl className="mt-5 grid grid-cols-3 gap-3 text-center md:gap-5">
          {facts.map(([big, small], i) => (
            <div key={small} className="ap-card ap-rise px-3 py-5 md:py-7" style={delay(i + 1)}>
              <dd className={`ap-display ap-balance ${big.length <= 5 ? "text-[clamp(1.5rem,4vw,2.5rem)]" : "text-[clamp(1rem,2.4vw,1.625rem)] leading-tight"}`}>{big}</dd>
              <dt className="mt-1 text-xs text-muted-foreground md:text-sm">{small}</dt>
            </div>
          ))}
        </dl>

        <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-16">
            <section aria-labelledby="hl">
              <h2 id="hl" className="ap-display mb-5 text-[clamp(1.75rem,4vw,2.5rem)]">Highlights.</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {trip.highlights.map((h) => (
                  <li key={h} className="ap-card flex items-start gap-3 p-5 text-[15px] [border-radius:1.25rem]">
                    <span className="ap-tile" style={{ "--tile": "#ff9500" } as React.CSSProperties} aria-hidden><Sparkles className="size-4" /></span>
                    <span className="pt-1 leading-snug">{h}</span>
                  </li>
                ))}
              </ul>
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Interests covered">
                {trip.interests.map((i) => <li key={i} className="rounded-full bg-muted px-3.5 py-1.5 text-xs text-muted-foreground">{INTEREST_LABEL[i]}</li>)}
              </ul>
            </section>

            <section aria-labelledby="it" className="space-y-6">
              <h2 id="it" className="ap-display text-[clamp(1.75rem,4vw,2.5rem)]">Day by day.</h2>
              <nav aria-label="Jump to a day" className="ap-noscrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
                {trip.itinerary.map((d) => <a key={d.day} href={`#day-${d.day}`} className="ap-chip">Day {d.day}</a>)}
              </nav>
              {trip.itinerary.map((d) => {
                const perDay = d.items.reduce((a, i) => a + i.costInr, 0);
                return (
                  <article key={d.day} className="scroll-mt-28" aria-labelledby={`day-${d.day}-t`} id={`day-${d.day}`} data-testid="day">
                    <header className="mb-3 flex items-end justify-between gap-3 px-1">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Day {d.day}</p>
                        <h3 id={`day-${d.day}-t`} className="ap-title text-2xl">{d.title}</h3>
                      </div>
                      <span className="shrink-0 pb-1 text-xs text-muted-foreground">about {rupees(perDay * 100).replace(".00", "")} per person</span>
                    </header>
                    <ul className="ap-group">
                      {d.items.map((i) => {
                        const { label, Icon, tile } = SLOT[i.slot];
                        return (
                          <li key={i.title} className="flex items-start gap-4 p-4 sm:p-5">
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
                  </article>
                );
              })}
              <p className="px-1 text-xs text-muted-foreground">Costs are rough per-person estimates for illustration, not quotes. Confirm real opening hours, fares and availability before travelling.</p>
            </section>

            <section aria-labelledby="tips">
              <h2 id="tips" className="ap-display mb-5 text-[clamp(1.75rem,4vw,2.5rem)]">Tips.</h2>
              <ul className="ap-group">
                {trip.tips.map((t) => (
                  <li key={t} className="flex items-start gap-4 p-4 text-[15px] leading-snug sm:p-5">
                    <span className="ap-tile" style={{ "--tile": "#34c759" } as React.CSSProperties} aria-hidden><Lightbulb className="size-4" /></span>
                    <span className="pt-1">{t}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="ucp" className="ap-card p-7 text-[15px]">
              <h2 id="ucp" className="ap-title mb-2 text-xl">How booking uses UCP.</h2>
              <p className="leading-relaxed text-muted-foreground">The stay and the experience pass are products in the merchant&rsquo;s catalog. Booking runs Create Checkout and Update Checkout from the platform to the merchant, which prices everything itself, then asks for your authorization of the exact total before Complete. See <Link href="/architecture" className="ap-link">the architecture</Link> or <Link href="/inspector" className="ap-link">the protocol inspector</Link>.</p>
            </section>
          </div>

          <div id="book" className="scroll-mt-32">
            <BookPanel tripId={trip.id} tripTitle={trip.title} lines={trip.lines} previewTotal={trip.packageTotal} />
          </div>
        </div>
      </div>
    </>
  );
}
