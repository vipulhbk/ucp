import { allTripViews } from "@/app-services/trips";
import { Compass, CreditCard, ListChecks } from "lucide-react";
import { PlannerFlow } from "@/components/trips/planner-flow";
import { TripShelf } from "@/components/trips/trip-shelf";

export const metadata = { title: "AI Trips · Plan your dream trip", description: "Plan a trip from a short form or pick a ready-made one, then book it through the Universal Commerce Protocol against a simulated merchant." };

const STEPS = [
  [Compass, "Tell us the vibe", "Pick a destination or a popular trip, up to three interests and a budget. The best match updates as you choose."],
  [ListChecks, "Review your days", "See the matched itinerary day by day, why it was chosen and anything the planner could not honour."],
  [CreditCard, "Book it through UCP", "Check out with a test card. Every protocol message behind the booking is inspectable."],
] as const;

const REAL = [
  ["Rule-based planner, no AI", <>The planner is a rule-based demo with no AI model: it ranks eight hand-written itineraries against what you choose, says why, and says when it could not honour something. It sits behind a <code>TripPlanner</code> interface, so a model could replace it.</>],
  ["Real protocol", "Booking makes real UCP calls (Create and Update Checkout, then Complete with your authorization) from a platform to a merchant, and every message is inspectable."],
  ["Simulated merchant and payment", "Only the eight ready-made trips can be booked: the packages are fictional demo vouchers and the card is a published test card. Nothing is reserved and no money moves."],
  ["No travel capability in UCP", "The pinned UCP release has none, so trips are modelled as ordinary catalog items, not as a UCP lodging or travel standard."],
] as const;

export default function TripsPage() {
  const trips = allTripViews().map(({ id, destination, country, aliases, days, budgetTier, tagline, interests, cover, packageTotal }) => ({ id, destination, country, aliases, days, budgetTier, tagline, interests, cover, packageTotal }));
  return (
    <>
      <section className="relative isolate overflow-hidden px-4 pb-16 pt-16 text-center md:px-8 md:pb-24 md:pt-28">
        <div className="ap-aura" aria-hidden />
        <p className="ap-rise mb-4 text-sm font-semibold tracking-wide text-primary" style={{ "--i": 0 } as React.CSSProperties}>AI Trips</p>
        <h1 className="ap-display ap-balance ap-rise mx-auto max-w-4xl text-[clamp(2.75rem,8vw,5.5rem)]" style={{ "--i": 1 } as React.CSSProperties}>
          Plan your <span className="ap-gradient-text">dream trip.</span>
        </h1>
        <p className="ap-rise ap-balance mx-auto mt-5 max-w-xl text-xl leading-snug text-muted-foreground md:text-2xl" style={{ "--i": 2 } as React.CSSProperties}>Tell us where, and what you like. Then book it end to end through UCP.</p>
        <div className="ap-rise mt-12" style={{ "--i": 3 } as React.CSSProperties}>
          <PlannerFlow trips={trips} />
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-4 md:px-8" aria-labelledby="how">
        <h2 id="how" className="sr-only">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map(([Icon, title, body], i) => (
            <li key={title} className="ap-card ap-rise p-6" style={{ "--i": i } as React.CSSProperties}>
              <span className="ap-tile mb-4 !size-10 !rounded-xl"><Icon className="size-5" aria-hidden /></span>
              <div className="ap-title text-xl"><span className="text-muted-foreground">{i + 1}.</span> {title}</div>
              <p className="mt-1.5 text-[15px] leading-snug text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
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
