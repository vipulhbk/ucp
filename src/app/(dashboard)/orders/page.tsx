import { Suspense } from "react";
import { PageHeader, RealBadge } from "@/components/shell/page-header";
import { OrdersPanel } from "./orders-panel";

export const metadata = { title: "Order Management · UCP Playground" };

export default function OrdersPage() {
  return (
    <>
      <PageHeader
        title="Order Management"
        badge={<RealBadge />}
        description={
          <>
            The merchant-side dashboard. UCP defines exactly one order operation, <code className="font-mono">GET /orders/{"{id}"}</code>, plus webhooks. Shipping, delivery, cancellation, returns and refunds are the <strong>business&apos;s own</strong> actions: the
            admin buttons below are <em>not</em> UCP calls. Each one appends a fulfillment event or adjustment and pushes the full order to the platform as a signed webhook.
          </>
        }
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <OrdersPanel />
      </Suspense>
    </>
  );
}
