import { Suspense } from "react";
import { PageHeader, RealBadge } from "@/components/shell/page-header";
import { ScenariosPanel } from "./scenarios-panel";

export const metadata = { title: "Scenarios · UCP Playground" };

export default function ScenariosPage() {
  return (
    <>
      <PageHeader
        title="Guided scenarios"
        badge={<RealBadge />}
        description={
          <>
            Seven walkthroughs. Each step states what the specification says happens, then performs it for real against the merchant and shows the actual exchange. Any step that spends money waits for <strong>your</strong> click. Each scenario can be reset and rerun.
          </>
        }
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ScenariosPanel />
      </Suspense>
    </>
  );
}
