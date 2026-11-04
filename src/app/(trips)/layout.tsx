import Link from "next/link";
import "./apple.css";

export default function TripsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="apple flex min-h-dvh flex-col">
      <header className="ap-glass sticky top-0 z-30 border-b border-border">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 text-xs md:px-8">
          <Link href="/trips" className="whitespace-nowrap text-[15px] font-semibold tracking-tight">UCP Trips</Link>
          <nav aria-label="Trips" className="flex items-center gap-4 whitespace-nowrap text-muted-foreground sm:gap-6">
            <Link href="/trips" className="hidden hover:text-foreground sm:inline">Plan</Link>
            <Link href="/trips#ready-made" className="hover:text-foreground">Trips</Link>
            <Link href="/" className="hover:text-foreground">Dashboard</Link>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 outline-none">{children}</main>
      <footer className="border-t border-border px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground md:px-8">
        A demonstration. The planner is a rule-based mock with no AI model, the merchant is simulated, bookings are demo vouchers for fictional packages and no real money moves.{" "}
        <Link href="/architecture" className="ap-link">How it works</Link>
      </footer>
    </div>
  );
}
