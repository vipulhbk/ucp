/** Origins the merchant may fetch platform profiles from: itself plus configured demo platforms. */
export function demoOriginsFor(self: string): string[] {
  const extra = (process.env.DEMO_PLATFORM_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  return [...new Set([self.replace(/\/$/, ""), ...extra])];
}

export const demoPlatformOrigins = demoOriginsFor;
