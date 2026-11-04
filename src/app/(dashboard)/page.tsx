import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FIDELITY } from "@/lib/fidelity";
import { UCP_VERSION } from "@/ucp/constants";

const ROLES = [
  { who: "Shopper", what: "Gives intent and explicitly authorizes the purchase.", kind: "human" },
  { who: "AI shopping agent / Platform", what: "Discovers the merchant, negotiates capabilities, calls UCP endpoints, shows the trusted confirmation UI.", kind: "simulated" },
  { who: "Merchant / Business", what: "Publishes /.well-known/ucp, owns pricing, checkout state and orders. Merchant of record.", kind: "real" },
  { who: "Payment service provider", what: "Processes the payment token for the merchant.", kind: "simulated" },
  { who: "Credential provider", what: "Turns a test credential into a token via the handler's tokenize step.", kind: "simulated" },
  { who: "Order management", what: "Order entity, Get Order, and signed webhooks to the platform.", kind: "real" },
] as const;

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Universal Commerce Protocol, made inspectable"
        description={
          <>
            A working UCP business and platform pair. Every request between them is a real HTTP call you can inspect. Protocol pinned to release{" "}
            <code className="font-mono">{UCP_VERSION}</code>. Payments, the credential provider and the shopping agent are simulated and labelled as such.
          </>
        }
      />

      <section aria-labelledby="status" className="mb-8">
        <h2 id="status" className="mb-2 text-sm font-medium text-muted-foreground">
          Build status
        </h2>
        <Card>
          <CardContent className="pt-6 text-sm">
            <p>
              <strong>Milestones M1–M6 are implemented:</strong> discovery and negotiation, catalog, the full checkout lifecycle with extensions, idempotency, simulated payments, buyer consent, orders with signed webhooks, the rule-based shopping agent, seven guided scenarios, the protocol inspector, and the schema validator.
              Conformance testing, browser-driven tests and deployment are still to come (milestones M7 and M8), so nothing here claims to be conformant or deployed.
            </p>
            <div className="mt-3 flex flex-wrap gap-4">
              <Link href="/architecture?tour=1" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" data-testid="tour-link">
                Start the guided tour <ArrowRight className="size-4" />
              </Link>
              <Link href="/discovery" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Merchant discovery <ArrowRight className="size-4" />
              </Link>
              <Link href="/catalog" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Catalog <ArrowRight className="size-4" />
              </Link>
              <Link href="/checkout" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Checkout playground <ArrowRight className="size-4" />
              </Link>
              <Link href="/agent" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Shopping agent <ArrowRight className="size-4" />
              </Link>
              <Link href="/scenarios" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Guided scenarios <ArrowRight className="size-4" />
              </Link>
              <Link href="/inspector" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Protocol inspector <ArrowRight className="size-4" />
              </Link>
              <Link href="/validator" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Schema validator <ArrowRight className="size-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="fidelity" className="mb-8" data-testid="fidelity">
        <h2 id="fidelity" className="mb-2 text-sm font-medium text-muted-foreground">
          Spec fidelity: what is real, what is simulated, what is missing
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {FIDELITY.map((sec) => (
            <Card key={sec.id} data-section={sec.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{sec.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {sec.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Full detail: <Link href="/docs/ucp-capability-matrix" className="text-primary hover:underline">capability matrix and known deviations</Link>.
        </p>
      </section>

      <section aria-labelledby="roles">
        <h2 id="roles" className="mb-2 text-sm font-medium text-muted-foreground">
          Participants
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => (
            <Card key={r.who}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {r.who}
                  <span
                    className={
                      r.kind === "simulated"
                        ? "rounded border border-amber-500/50 px-1.5 py-0.5 text-[11px] font-normal text-amber-600 dark:text-amber-400"
                        : r.kind === "real"
                          ? "rounded border border-emerald-500/50 px-1.5 py-0.5 text-[11px] font-normal text-emerald-600 dark:text-emerald-400"
                          : "rounded border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground"
                    }
                  >
                    {r.kind === "simulated" ? "simulated" : r.kind === "real" ? "real protocol" : "you"}
                  </span>
                </CardTitle>
                <CardDescription>{r.what}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
