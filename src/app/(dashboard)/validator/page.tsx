import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { ValidatorPanel } from "./validator-panel";

export const metadata = { title: "Schema Validator · UCP Playground" };

export default function ValidatorPage() {
  return (
    <>
      <PageHeader
        title="Schema Validator"
        description={
          <>
            Check a payload against the official UCP schemas (release 2026-08-25) and see exactly where and why it fails. <strong>This is JSON-shape validation, not protocol conformance.</strong> Separate spec-rule checks are shown on their own, and what no schema can
            check is listed explicitly.
          </>
        }
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ValidatorPanel />
      </Suspense>
    </>
  );
}
