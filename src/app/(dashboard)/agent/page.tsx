import { PageHeader, SimulatedBadge } from "@/components/shell/page-header";
import { AgentPanel } from "./agent-panel";

export const metadata = { title: "AI Agent · UCP Playground" };

export default function AgentPage() {
  return (
    <>
      <PageHeader
        title="AI Shopping Agent"
        badge={<SimulatedBadge />}
        description={
          <>
            A deterministic, rule-based agent (no model, no randomness). It is <strong>simulated</strong>, but everything it does to the merchant is a real UCP call through the platform client: it reads the profile, searches the catalog, builds the checkout, resolves
            the merchant&apos;s error messages, and reports. It cannot pay: only your click on the confirmation card authorizes a purchase.
          </>
        }
      />
      <AgentPanel />
    </>
  );
}
