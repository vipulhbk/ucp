import { PageHeader, RealBadge } from "@/components/shell/page-header";
import { WebhooksPanel } from "./webhooks-panel";

export const metadata = { title: "Webhook Inspector · UCP Playground" };

export default function WebhooksPage() {
  return (
    <>
      <PageHeader
        title="Webhook Inspector"
        badge={<RealBadge />}
        description={
          <>
            Both ends of the order-webhook channel. The business signs each event (RFC 9421, ES256, key published in its profile) and sends the <em>full</em> order snapshot. The platform verifies the signature, checks that the signer is the business that owns the order,
            dedupes by <code className="font-mono">Webhook-Id</code>, acknowledges, then applies it asynchronously. Keys here are public demo keys: this shows the mechanism, not key custody.
          </>
        }
      />
      <WebhooksPanel />
    </>
  );
}
