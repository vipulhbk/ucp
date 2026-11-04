import { Suspense } from "react";
import { PageHeader, RealBadge } from "@/components/shell/page-header";
import { InspectorPanel } from "./inspector-panel";

export const metadata = { title: "Protocol Inspector · UCP Playground" };

export default function InspectorPage() {
  return (
    <>
      <PageHeader
        title="Protocol Inspector"
        badge={<RealBadge />}
        description={
          <>
            Every request this session made, as it actually crossed the wire: discovery, catalog, checkout, the simulated tokenizer, and both ends of every order webhook. Joined by Request-Id (or Webhook-Id). Credentials, tokens, card data and personal data are redacted
            when written, never shown, never exported. Nothing here is a hand-made example.
          </>
        }
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <InspectorPanel />
      </Suspense>
    </>
  );
}
