import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { ArchitectureExplorer } from "@/components/architecture/explorer";
import { ArchitectureStart } from "./start";

export const metadata = { title: "Architecture · UCP Playground" };

export default function ArchitecturePage() {
  return (
    <>
      <PageHeader
        title="Architecture"
        description={
          <>
            The six participants and the messages between them. Click any box or message to see its responsibility, which endpoints it really serves and what is simulated, or take the guided tour of a complete purchase. The diagram is generated from data that tests check against the code.
          </>
        }
      />
      <Suspense fallback={<ArchitectureExplorer />}>
        <ArchitectureStart />
      </Suspense>
    </>
  );
}
