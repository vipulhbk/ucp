export default function Loading() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-4" data-testid="loading">
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
