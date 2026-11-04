import { PageHeader } from "./page-header";
import { Card, CardContent } from "@/components/ui/card";

/** Placeholder for modules that are designed but not implemented. Never styled as working. */
export function NotBuilt({ title, milestone, description, covers }: { title: string; milestone: string; description: string; covers: string[] }) {
  return (
    <>
      <PageHeader title={title} description={description} badge={<span className="rounded border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">Not implemented · {milestone}</span>} />
      <Card>
        <CardContent className="space-y-2 pt-6 text-sm">
          <p className="font-medium">Planned for this module (see docs/IMPLEMENTATION_PLAN.md):</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {covers.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
