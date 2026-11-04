import { DEFAULT_TTL_SEC, LockTimeoutError, type SetOptions, type Store } from "./store";

interface Entry {
  value: unknown;
  expiresAt: number;
}

/** Local development and unit tests only. `getConfig()` refuses it on Vercel. */
export class MemoryStore implements Store {
  readonly driver = "memory" as const;
  private kv = new Map<string, Entry>();
  private zsets = new Map<string, Map<string, number>>();

  constructor(private now: () => number = Date.now) {}

  private live(key: string): Entry | undefined {
    const e = this.kv.get(key);
    if (e && e.expiresAt <= this.now()) {
      this.kv.delete(key);
      return undefined;
    }
    return e;
  }
  private exp(ttlSec?: number): number {
    return this.now() + (ttlSec ?? DEFAULT_TTL_SEC) * 1000;
  }

  async get<T>(key: string): Promise<T | null> {
    const e = this.live(key);
    return e ? (structuredClone(e.value) as T) : null;
  }
  async set<T>(key: string, value: T, opts?: SetOptions): Promise<void> {
    this.kv.set(key, { value: structuredClone(value), expiresAt: this.exp(opts?.ttlSec) });
  }
  async setNX<T>(key: string, value: T, opts?: SetOptions): Promise<boolean> {
    if (this.live(key)) return false;
    await this.set(key, value, opts);
    return true;
  }
  async del(key: string): Promise<void> {
    this.kv.delete(key);
    this.zsets.delete(key);
  }
  async delPrefix(prefix: string): Promise<number> {
    let n = 0;
    for (const k of [...this.kv.keys()]) {
      if (k.startsWith(prefix)) {
        this.kv.delete(k);
        n++;
      }
    }
    for (const k of [...this.zsets.keys()]) {
      if (k.startsWith(prefix)) {
        this.zsets.delete(k);
        n++;
      }
    }
    return n;
  }
  async listPush<T>(key: string, value: T, opts?: { max?: number; ttlSec?: number }): Promise<void> {
    const cur = (this.live(key)?.value as T[] | undefined) ?? [];
    cur.push(structuredClone(value));
    const max = opts?.max;
    if (max && cur.length > max) cur.splice(0, cur.length - max);
    this.kv.set(key, { value: cur, expiresAt: this.exp(opts?.ttlSec) });
  }
  async listRange<T>(key: string, start = 0, stop = -1): Promise<T[]> {
    const cur = (this.live(key)?.value as T[] | undefined) ?? [];
    const end = stop < 0 ? cur.length + stop + 1 : stop + 1;
    return structuredClone(cur.slice(start, end));
  }
  async zAdd(key: string, score: number, member: string): Promise<void> {
    const z = this.zsets.get(key) ?? new Map<string, number>();
    z.set(member, score);
    this.zsets.set(key, z);
  }
  async zDue(key: string, maxScore: number, limit: number): Promise<string[]> {
    const z = this.zsets.get(key);
    if (!z) return [];
    return [...z.entries()].filter(([, s]) => s <= maxScore).sort((a, b) => a[1] - b[1]).slice(0, limit).map(([m]) => m);
  }
  async zRem(key: string, member: string): Promise<void> {
    this.zsets.get(key)?.delete(member);
  }
  async incr(key: string, ttlSec: number): Promise<number> {
    const e = this.live(key);
    const n = ((e?.value as number | undefined) ?? 0) + 1;
    this.kv.set(key, { value: n, expiresAt: e?.expiresAt ?? this.exp(ttlSec) });
    return n;
  }
  async withLock<T>(key: string, fn: () => Promise<T>, opts?: { ttlMs?: number; waitMs?: number }): Promise<T> {
    const lockKey = `lock:${key}`;
    const deadline = Date.now() + (opts?.waitMs ?? 2000);
    while (!(await this.setNX(lockKey, 1, { ttlSec: Math.max(1, Math.ceil((opts?.ttlMs ?? 5000) / 1000)) }))) {
      if (Date.now() > deadline) throw new LockTimeoutError(key);
      await new Promise((r) => setTimeout(r, 10));
    }
    try {
      return await fn();
    } finally {
      await this.del(lockKey);
    }
  }
}
