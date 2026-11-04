import Link from "next/link";
import { notFound } from "next/navigation";
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
  return { title: t ? `${t.title} · UCP Trips` : "Trip not found" };
}

const SLOT_LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" } as const;

export default async function TripPage({ params }: PageProps<"/trips/[id]">) {
  const trip = tripViewById((await params).id);
  if (!trip) notFound();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 md:px-8">
      <Link href="/trips" className="ap-link mb-3 inline-block text-sm">&lsaquo; All trips</Link>

      <section className="relative isolate flex min-h-[22rem] items-end overflow-hidden rounded-[1.75rem] p-7 text-white md:min-h-[26rem] md:p-10" aria-labelledby="trip-title">
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative static SVG */}
        <img src={trip.cover} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/70 via-black/20 to-transparent" aria-hidden />
        <div>
          <p className="mb-2 text-sm font-medium opacity-90">{trip.country}</p>
          <h1 id="trip-title" className="ap-display text-[clamp(2rem,6vw,3.5rem)]">{trip.title}</h1>
          <p className="mt-2 max-w-xl text-lg opacity-95">{trip.tagline}</p>
        </div>
      </section>

      <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
        {([["Length", `${trip.days} days`], ["Per day", `${BUDGET_LABEL[trip.budgetTier].symbol} · ${BUDGET_LABEL[trip.budgetTier].range.replace(" a day", "")}`], ["Best time", trip.bestSeason]] as const).map(([k, v]) => (
          <div key={k} className="ap-card px-3 py-4">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="mt-0.5 text-sm font-semibold sm:text-base">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-12">
          <section aria-labelledby="hl">
            <h2 id="hl" className="ap-title mb-4 text-3xl">Highlights.</h2>
            <ul className="flex flex-wrap gap-2">
              {trip.highlights.map((h) => <li key={h} className="ap-card rounded-full px-4 py-2 text-sm [border-radius:9999px]">{h}</li>)}
              {trip.interests.map((i) => <li key={i} className="rounded-full bg-muted px-3.5 py-2 text-xs text-muted-foreground">{INTEREST_LABEL[i]}</li>)}
            </ul>
          </section>

          <section aria-labelledby="it" className="space-y-4">
            <h2 id="it" className="ap-title text-3xl">Day by day.</h2>
            {trip.itinerary.map((d) => {
              const perDay = d.items.reduce((a, i) => a + i.costInr, 0);
              return (
                <article key={d.day} className="ap-card overflow-hidden" aria-labelledby={`day-${d.day}`} data-testid="day">
                  <header className="flex items-baseline justify-between gap-3 px-6 pb-2 pt-5">
                    <h3 id={`day-${d.day}`} className="ap-title text-xl"><span className="text-muted-foreground">Day {d.day}</span> &nbsp;{d.title}</h3>
                    <span className="shrink-0 text-xs text-muted-foreground">about {rupees(perDay * 100).replace(".00", "")} per person</span>
                  </header>
                  <ul className="px-6 pb-2">
                    {d.items.map((i) => (
                      <li key={i.title} className="grid gap-1 border-t border-border py-4 first:border-t-0 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:gap-4">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{SLOT_LABEL[i.slot]}</span>
                        <div className="min-w-0">
                          <div className="text-[15px] font-semibold">{i.title}</div>
                          <div className="text-sm text-muted-foreground">{i.detail}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{i.area}</div>
                        </div>
                        <span className="text-xs text-muted-foreground sm:text-right">{i.costInr === 0 ? "Free" : `~₹${i.costInr.toLocaleString("en-IN")}`}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
            <p className="text-xs text-muted-foreground">Costs are rough per-person estimates for illustration, not quotes. Confirm real opening hours, fares and availability before travelling.</p>
          </section>

          <section aria-labelledby="tips">
            <h2 id="tips" className="ap-title mb-3 text-3xl">Tips.</h2>
            <ul className="list-disc space-y-1.5 pl-5 text-[15px] text-muted-foreground">{trip.tips.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>

          <section aria-labelledby="ucp" className="ap-card p-6 text-[15px]">
            <h2 id="ucp" className="ap-title mb-2 text-xl">How booking uses UCP.</h2>
            <p className="leading-relaxed text-muted-foreground">The stay and the experience pass are products in the merchant&rsquo;s catalog. Booking runs Create Checkout and Update Checkout from the platform to the merchant, which prices everything itself, then asks for your authorization of the exact total before Complete. See <Link href="/architecture" className="ap-link">the architecture</Link> or <Link href="/inspector" className="ap-link">the protocol inspector</Link>.</p>
          </section>
        </div>

        <BookPanel tripId={trip.id} tripTitle={trip.title} lines={trip.lines} previewTotal={trip.packageTotal} />
      </div>
    </div>
  );
}
