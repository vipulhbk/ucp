/**
 * Storage abstraction. Domain state must go through this interface; module-level variables are never
 * a source of truth (serverless instances do not share memory).
 */
export interface SetOptions {
  ttlSec?: number;
}

export interface Store {
  readonly driver: "memory" | "redis";
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, opts?: SetOptions): Promise<void>;
  /** Atomic set-if-absent. Returns true when this call created the key. Basis for idempotency and webhook dedupe. */
  setNX<T>(key: string, value: T, opts?: SetOptions): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Delete every key starting with `prefix` (session reset). Returns the number removed. */
  delPrefix(prefix: string): Promise<number>;
  /** Append to a capped list (newest last). */
  listPush<T>(key: string, value: T, opts?: { max?: number; ttlSec?: number }): Promise<void>;
  listRange<T>(key: string, start?: number, stop?: number): Promise<T[]>;
  /** Sorted-set helpers used by the webhook outbox (score = next attempt time, ms). */
  zAdd(key: string, score: number, member: string, opts?: { ttlSec?: number }): Promise<void>;
  zDue(key: string, maxScore: number, limit: number): Promise<string[]>;
  zRem(key: string, member: string): Promise<void>;
  /** Fixed-window counter. Returns the new count. */
  incr(key: string, ttlSec: number): Promise<number>;
  /** Short mutex for read-modify-write sequences. Throws LockTimeoutError if not acquired. */
  withLock<T>(key: string, fn: () => Promise<T>, opts?: { ttlMs?: number; waitMs?: number }): Promise<T>;
}

export class LockTimeoutError extends Error {
  constructor(key: string) {
    super(`could not acquire lock ${key}`);
    this.name = "LockTimeoutError";
  }
}

export const DEFAULT_TTL_SEC = 24 * 60 * 60;
