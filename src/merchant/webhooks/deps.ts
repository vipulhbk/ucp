import "server-only";
import { getConfig } from "@/config";
import { getStore } from "@/persistence";
import { getMerchantSigningKey } from "../signing-key";
import { demoPlatformOrigins } from "../origins";
import type { OutboxDeps } from "./outbox";

/** Production wiring for the outbox: real store, the business signing key, allowlisted platform origins only. */
export function outboxDeps(origin: string): OutboxDeps {
  const cfg = getConfig();
  return { store: getStore(), origin, signingKey: getMerchantSigningKey(), allowedOrigins: demoPlatformOrigins(origin), devLoopbackHosts: cfg.devLoopbackHosts, now: Date.now };
}
