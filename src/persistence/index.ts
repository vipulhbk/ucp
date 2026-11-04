import "server-only";
import { getConfig } from "@/config";
import { MemoryStore } from "./memory";
import { RedisStore } from "./redis";
import type { Store } from "./store";

export type { Store } from "./store";

const g = globalThis as unknown as { __ucpMemoryStore?: MemoryStore };

/** Dev-server module reloads would otherwise drop memory state; the singleton is for development only. */
export function getStore(): Store {
  const cfg = getConfig();
  if (cfg.storeDriver === "redis" && cfg.redis) return new RedisStore(cfg.redis);
  return (g.__ucpMemoryStore ??= new MemoryStore());
}
