import { Suspense } from "react";
import { PageHeader, RealBadge } from "@/components/shell/page-header";
import { CheckoutPanel } from "./checkout-panel";

export const metadata = { title: "Checkout Playground · UCP Playground" };

export default function CheckoutPage() {
  return (
    <>
      <PageHeader
        title="Checkout Playground"
        badge={<RealBadge />}
        description={
          <>
            Drive the UCP checkout capability by hand: create, update (a <em>full replacement</em>), complete and cancel. Every button is a real server-side call from the platform to the business; the exact request and response appear under each action. The
            business recomputes all prices. Completing a checkout requires your explicit authorization.
          </>
        }
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <CheckoutPanel />
      </Suspense>
    </>
  );
}
