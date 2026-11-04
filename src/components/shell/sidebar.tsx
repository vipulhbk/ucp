"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { BRAND_ICON, NAV } from "./nav";

export function Sidebar() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const Brand = BRAND_ICON;
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground max-md:hidden">
      <div className="flex items-center gap-2 border-b px-4 py-3.5">
        <Brand className="size-5 text-primary" aria-hidden />
        <div className="leading-tight">
          <div className="text-sm font-semibold">UCP Playground</div>
          <div className="font-mono text-[11px] text-muted-foreground">release 2026-08-25</div>
        </div>
      </div>
      <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map(({ href, label, icon: Icon, status, milestone }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-sidebar-accent",
                active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate">{label}</span>
              {status === "planned" && <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">{milestone}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        <div className="mb-2 flex items-center justify-between">
          <span>Payments are simulated</span>
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="rounded p-1 hover:bg-sidebar-accent"
          >
            <Sun className="size-4 dark:hidden" />
            <Moon className="hidden size-4 dark:block" />
          </button>
        </div>
        <p>No real card data is ever accepted.</p>
      </div>
    </aside>
  );
}
