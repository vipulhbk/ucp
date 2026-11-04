import { Activity, Boxes, ListChecks, FileJson, Gauge, Network, PackageSearch, Plane, Radar, Receipt, ScrollText, ShieldCheck, ShoppingCart, Bot, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Honest status shown in the sidebar. Only "ready" once the module is implemented AND tested. */
  status: "ready" | "planned";
  milestone?: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: Gauge, status: "ready" },
  { href: "/architecture", label: "Architecture", icon: Network, status: "ready" },
  { href: "/discovery", label: "Merchant Discovery", icon: Radar, status: "ready" },
  { href: "/agent", label: "AI Agent", icon: Bot, status: "ready" },
  { href: "/scenarios", label: "Guided Scenarios", icon: ListChecks, status: "ready" },
  { href: "/catalog", label: "Product Catalog", icon: PackageSearch, status: "ready" },
  { href: "/checkout", label: "Checkout Playground", icon: ShoppingCart, status: "ready" },
  { href: "/payments", label: "Payment Simulator", icon: Wallet, status: "ready" },
  { href: "/orders", label: "Order Management", icon: Boxes, status: "ready" },
  { href: "/webhooks", label: "Webhook Inspector", icon: Receipt, status: "ready" },
  { href: "/inspector", label: "Protocol Inspector", icon: Activity, status: "ready" },
  { href: "/validator", label: "Schema Validator", icon: ShieldCheck, status: "ready" },
  { href: "/trips", label: "Trip Planner demo", icon: Plane, status: "ready" },
  { href: "/docs", label: "Documentation", icon: ScrollText, status: "ready" },
];

export const BRAND_ICON = FileJson;
