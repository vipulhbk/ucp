import { PageHeader, RealBadge } from "@/components/shell/page-header";
import { CatalogPanel } from "./catalog-panel";

export const metadata = { title: "Product Catalog · UCP Playground" };

export default function CatalogPage() {
  return (
    <>
      <PageHeader
        title="Product Catalog"
        badge={<RealBadge />}
        description={
          <>
            Search the demo merchant through the UCP <code className="font-mono">dev.ucp.shopping.catalog.search</code> capability. Every search is a real <code className="font-mono">POST /catalog/search</code> from the platform to the business.
            Prices are integer paise on the wire.
          </>
        }
      />
      <CatalogPanel />
    </>
  );
}
