import { allTripViews } from "@/app-services/trips";
import { PlannerFlow } from "@/components/trips/planner-flow";
import { TripShelf } from "@/components/trips/trip-shelf";

export const metadata = { title: "Tiket AI Trips · Plan your dream trip", description: "Plan a trip from a short form or pick a ready-made one, then book it through the Universal Commerce Protocol against a simulated merchant." };

const REAL = [
  ["Planner: Gemini or a mock", <>With a Gemini API key configured on the server, plans are written by Google&rsquo;s Gemini from what you type (no live web search, so details are not checked). Without a key, or if Gemini fails or is rate-limited, a rule-based mock picks one of eight hand-written itineraries. Each result names which one made it. Both sit behind a <code>TripPlanner</code> interface.</>],
  ["Real protocol", "Booking makes real UCP calls (Create and Update Checkout, then Complete with your authorization) from a platform to a merchant, and every message is inspectable."],
  ["Simulated merchant and payment", "Only the eight ready-made trips can be booked: the packages are fictional demo vouchers and the card is a published test card. Nothing is reserved and no money moves."],
  ["No travel capability in UCP", "The pinned UCP release has none, so trips are modelled as ordinary catalog items, not as a UCP lodging or travel standard."],
] as const;

export default function TripsPage() {
  const trips = allTripViews().map(({ id, destination, country, days, budgetTier, tagline, interests, cover, packageTotal }) => ({ id, destination, country, days, budgetTier, tagline, interests, cover, packageTotal }));
  return (
    <>
      <section className="relative isolate overflow-hidden px-4 pb-16 pt-16 text-center md:px-8 md:pb-24 md:pt-28">
        <div className="ap-aura" aria-hidden />
        <p className="ap-rise mb-4 text-sm font-semibold tracking-wide text-primary" style={{ "--i": 0 } as React.CSSProperties}>Tiket AI Trips</p>
        <h1 className="ap-display ap-balance ap-rise mx-auto max-w-4xl text-[clamp(2.75rem,8vw,5.5rem)]" style={{ "--i": 1 } as React.CSSProperties}>
          Plan your <span className="ap-gradient-text">dream trip.</span>
        </h1>
        <p className="ap-rise ap-balance mx-auto mt-5 max-w-xl text-xl leading-snug text-muted-foreground md:text-2xl" style={{ "--i": 2 } as React.CSSProperties}>Tell us where, and what you like. Then book it end to end through UCP.</p>
        <div className="ap-rise mt-12" style={{ "--i": 3 } as React.CSSProperties}>
          <PlannerFlow />
        </div>
      </section>

      <section id="ready-made" className="mx-auto w-full max-w-6xl scroll-mt-16 space-y-8 px-4 py-16 md:px-8" aria-labelledby="rm">
        <div className="text-center md:text-left">
          <h2 id="rm" className="ap-display ap-balance text-[clamp(2rem,5vw,3.25rem)]">Ready-made trips.</h2>
          <p className="ap-balance mt-3 max-w-2xl text-lg leading-snug text-muted-foreground md:text-xl">Eight itineraries to try right away. Prices are what the simulated merchant charges for each trip&rsquo;s stay and experience pass.</p>
        </div>
        <TripShelf trips={trips} />
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-20 md:px-8" aria-labelledby="real">
        <h2 id="real" className="ap-display ap-balance mb-8 text-center text-[clamp(1.75rem,4vw,2.5rem)] md:text-left">What is real here, and what is not.</h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {REAL.map(([title, body]) => (
            <li key={title} className="ap-card p-7 text-[15px] leading-relaxed text-muted-foreground">
              <strong className="ap-title mb-2 block text-xl text-foreground">{title}</strong>
              {body}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
