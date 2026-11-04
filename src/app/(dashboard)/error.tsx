"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Error boundary for every dashboard page: say what happened, offer a retry, never show a stack trace. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui] page error:", error.digest ?? error.message);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-lg space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6" data-testid="error-boundary">
      <div className="flex items-center gap-2 font-medium"><AlertTriangle className="size-5 text-destructive" aria-hidden /> This page hit an unexpected error</div>
      <p className="text-sm text-muted-foreground">Nothing was lost on the server. You can try again, reset your demo session from the AI Agent page, or go back to the overview.{error.digest ? ` (reference ${error.digest})` : ""}</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent">Overview</Link>
      </div>
    </div>
  );
}
