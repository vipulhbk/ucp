import { Badge } from "@/components/ui/badge";

export function PageHeader({ title, description, badge }: { title: string; description: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {badge}
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
    </header>
  );
}

export function SimulatedBadge() {
  return (
    <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
      Simulated
    </Badge>
  );
}

export function RealBadge() {
  return (
    <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
      Real protocol behavior
    </Badge>
  );
}
