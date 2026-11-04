"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

/** Shown below md, where the sidebar is hidden: brand, theme toggle, and a horizontally scrolling page list. */
export function MobileNav() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <header className="border-b md:hidden">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="leading-tight"><div className="text-sm font-semibold">UCP Playground</div><div className="font-mono text-[11px] text-muted-foreground">release 2026-08-25 · payments simulated</div></div>
        <button type="button" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} className="rounded-md border p-2 hover:bg-accent">
          <Sun className="size-4 dark:hidden" /><Moon className="hidden size-4 dark:block" />
        </button>
      </div>
      <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-3 pb-2">
        {NAV.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap rounded-md px-2.5 py-1 text-sm", active ? "bg-accent font-medium" : "text-muted-foreground")}>{label}</Link>
          );
        })}
      </nav>
    </header>
  );
}
