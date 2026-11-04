import { PageHeader, RealBadge } from "@/components/shell/page-header";
import { DiscoveryPanel } from "./discovery-panel";

export const metadata = { title: "Merchant Discovery · UCP Playground" };

export default function DiscoveryPage() {
  return (
    <>
      <PageHeader
        title="Merchant Discovery"
        badge={<RealBadge />}
        description={
          <>
            The platform fetches <code className="font-mono">/.well-known/ucp</code>, validates it against the official schema, selects a protocol version, checks authority binding on every declared schema URL, and negotiates capabilities. Nothing is
            hardcoded: the REST endpoint below comes from the profile.
          </>
        }
      />
      <DiscoveryPanel />
    </>
  );
}
