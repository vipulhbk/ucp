import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">There is nothing at this address.</p>
      <Link href="/" className="text-sm text-primary hover:underline">Go to the UCP Playground</Link>
    </main>
  );
}
