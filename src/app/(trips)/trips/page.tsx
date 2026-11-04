import { allTripViews } from "@/app-services/trips";
import { PlannerFlow } from "@/components/trips/planner-flow";
import { TripCard } from "@/components/trips/trip-card";

export const metadata = { title: "UCP Trips · Plan your dream trip", description: "Plan a trip from a short form or pick a ready-made one, then book it through the Universal Commerce Protocol against a simulated merchant." };

export default function TripsPage() {
  const trips = allTripViews();
  return (
    <>
      <section className="px-4 pb-14 pt-16 text-center md:px-8 md:pt-24">
        <p className="mb-3 text-sm font-medium text-primary">Plan</p>
        <h1 className="ap-display mx-auto max-w-3xl text-[clamp(2.5rem,7vw,4.5rem)]">Plan your dream trip.</h1>
        <p className="mx-auto mt-4 max-w-xl text-xl leading-snug text-muted-foreground">Tell us where, and what you like. Then book it end to end through UCP.</p>
        <div className="mt-10">
          <PlannerFlow />
        </div>
      </section>

      <section id="ready-made" className="mx-auto w-full max-w-6xl scroll-mt-16 space-y-6 px-4 py-14 md:px-8" aria-labelledby="rm">
        <div className="text-center md:text-left">
          <h2 id="rm" className="ap-display text-[clamp(1.75rem,4vw,2.5rem)]">Ready-made trips.</h2>
          <p className="mt-2 text-lg text-muted-foreground">Eight itineraries to try right away. Prices are what the simulated merchant charges for each trip&rsquo;s stay and experience pass.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {trips.map((t) => <TripCard key={t.id} trip={t} />)}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8" aria-labelledby="real">
        <div className="ap-card p-7 md:p-10">
          <h2 id="real" className="ap-title mb-5 text-2xl">What is real here, and what is not.</h2>
          <ul className="grid gap-x-10 gap-y-5 text-[15px] leading-relaxed text-muted-foreground md:grid-cols-2">
            <li><strong className="block text-foreground">Mock planner</strong> Trips come from eight hand-written itineraries and a rule-based ranker, not an AI model. The planner sits behind a <code>TripPlanner</code> interface, so a model can replace it later without touching the pages.</li>
            <li><strong className="block text-foreground">Real protocol</strong> Booking makes real UCP calls (Create and Update Checkout, then Complete with your authorization) from a platform to a merchant, and every message is inspectable.</li>
            <li><strong className="block text-foreground">Simulated merchant and payment</strong> The packages are fictional demo vouchers and the card is a published test card. Nothing is reserved and no money moves.</li>
            <li><strong className="block text-foreground">No travel capability in UCP</strong> The pinned UCP release has none, so trips are modelled as ordinary catalog items, not as a UCP lodging or travel standard.</li>
          </ul>
        </div>
      </section>
    </>
  );
}
