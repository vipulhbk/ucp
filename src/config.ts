import "server-only";

/** Single place that reads environment. Nothing here is exposed to the browser. */
export type DemoMode = "deterministic" | "live";

export interface AppConfig {
  isProduction: boolean;
  vercelEnv: string | undefined;
  demoMode: DemoMode;
  storeDriver: "memory" | "redis";
  redis?: { url: string; token: string };
  publicBaseUrl?: string;
  serverSecret: string;
  enableTestingEndpoints: boolean;
  simulationSecret?: string;
  /** Hosts for which authority binding is reported as "relaxed" (documented demo deviation). */
  relaxedBindingHosts: string[];
  devLoopbackHosts: string[];
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const env = process.env;
  const vercelEnv = env.VERCEL_ENV;
  const isProduction = env.NODE_ENV === "production";
  const redisUrl = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  const storeDriver = env.STORE_DRIVER === "memory" ? "memory" : env.STORE_DRIVER === "redis" || (redisUrl && redisToken) ? "redis" : "memory";

  if (storeDriver === "redis" && (!redisUrl || !redisToken)) {
    throw new Error("STORE_DRIVER=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL/TOKEN)");
  }
  // Serverless instances do not share memory: refuse silent data loss on Vercel.
  if (storeDriver === "memory" && vercelEnv && env.ALLOW_MEMORY_STORE !== "true") {
    throw new Error("MemoryStore is not safe on Vercel (instances do not share memory). Configure Redis or set ALLOW_MEMORY_STORE=true for a throwaway demo.");
  }

  const serverSecret = env.SERVER_SECRET ?? (isProduction ? "" : "dev-only-secret-do-not-use-in-production");
  if (!serverSecret) throw new Error("SERVER_SECRET must be set in production");

  cached = {
    isProduction,
    vercelEnv,
    demoMode: env.DEMO_MODE === "deterministic" ? "deterministic" : "live",
    storeDriver,
    redis: redisUrl && redisToken ? { url: redisUrl, token: redisToken } : undefined,
    publicBaseUrl: env.PUBLIC_BASE_URL?.replace(/\/$/, ""),
    serverSecret,
    enableTestingEndpoints: env.ENABLE_TESTING_ENDPOINTS === "true",
    simulationSecret: env.SIMULATION_SECRET,
    relaxedBindingHosts: (env.RELAXED_BINDING_HOSTS ?? "localhost,vercel.app").split(",").map((s) => s.trim()).filter(Boolean),
    devLoopbackHosts: isProduction ? [] : ["localhost", "127.0.0.1"],
  };
  return cached;
}

/** Test seam: drop the memoized config after changing process.env. */
export function resetConfigForTests(): void {
  cached = undefined;
}

/**
 * Canonical public origin. Never trusts a client-supplied Host header when a trusted source exists
 * (prevents profile poisoning through Host header injection).
 */
export function resolveOrigin(req?: Request): string {
  const cfg = getConfig();
  if (cfg.publicBaseUrl) return cfg.publicBaseUrl;
  const env = process.env;
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL && cfg.vercelEnv === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;
  if (req) return new URL(req.url).origin; // local development only
  return "http://localhost:3000";
}
