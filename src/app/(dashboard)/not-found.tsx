import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-3 p-6" data-testid="not-found">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">That page or document does not exist. Documents are listed under Documentation.</p>
      <div className="flex gap-4 text-sm"><Link href="/" className="text-primary hover:underline">Overview</Link><Link href="/docs" className="text-primary hover:underline">Documentation</Link></div>
    </div>
  );
}
