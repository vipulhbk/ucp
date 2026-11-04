import { randomBytes } from "node:crypto";
import type { Store } from "@/persistence/store";

/** Live mode: unguessable ids. Deterministic mode (DEMO_MODE=deterministic): sequential per platform, e.g. chk_0001. */
export async function newId(store: Store, platformId: string, prefix: string): Promise<string> {
  if (process.env.DEMO_MODE === "deterministic") {
    const n = await store.incr(`m:${platformId}:seq:${prefix}`, 24 * 3600);
    return `${prefix}_${String(n).padStart(4, "0")}`;
  }
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}
