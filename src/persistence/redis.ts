import { Redis } from "@upstash/redis";
import { DEFAULT_TTL_SEC, LockTimeoutError, type SetOptions, type Store } from "./store";

/** Upstash Redis over HTTP: works in serverless functions without connection pooling. */
export class RedisStore implements Store {
  readonly driver = "redis" as const;
  private r: Redis;

  constructor(opts: { url: string; token: string }) {
    this.r = new Redis({ url: opts.url, token: opts.token });
  }

  async get<T>(key: string): Promise<T | null> {
    return (await this.r.get<T>(key)) ?? null;
  }
  async set<T>(key: string, value: T, opts?: SetOptions): Promise<void> {
    await this.r.set(key, value as never, { ex: opts?.ttlSec ?? DEFAULT_TTL_SEC });
  }
  async setNX<T>(key: string, value: T, opts?: SetOptions): Promise<boolean> {
    const res = await this.r.set(key, value as never, { nx: true, ex: opts?.ttlSec ?? DEFAULT_TTL_SEC });
    return res === "OK";
  }
  async del(key: string): Promise<void> {
    await this.r.del(key);
  }
  async delPrefix(prefix: string): Promise<number> {
    let cursor = "0";
    let n = 0;
    do {
      const [next, keys] = await this.r.scan(cursor, { match: `${prefix}*`, count: 200 });
      cursor = String(next);
      if (keys.length) n += await this.r.del(...keys);
    } while (cursor !== "0");
    return n;
  }
  async listPush<T>(key: string, value: T, opts?: { max?: number; ttlSec?: number }): Promise<void> {
    const p = this.r.pipeline();
    p.rpush(key, value as never);
    if (opts?.max) p.ltrim(key, -opts.max, -1);
    p.expire(key, opts?.ttlSec ?? DEFAULT_TTL_SEC);
    await p.exec();
  }
  async listRange<T>(key: string, start = 0, stop = -1): Promise<T[]> {
    return (await this.r.lrange<T>(key, start, stop)) ?? [];
  }
  async zAdd(key: string, score: number, member: string, opts?: { ttlSec?: number }): Promise<void> {
    const p = this.r.pipeline();
    p.zadd(key, { score, member });
    p.expire(key, opts?.ttlSec ?? DEFAULT_TTL_SEC);
    await p.exec();
  }
  async zDue(key: string, maxScore: number, limit: number): Promise<string[]> {
    const rows = await this.r.zrange<string[]>(key, 0, maxScore, { byScore: true, offset: 0, count: limit });
    return rows.map(String);
  }
  async zRem(key: string, member: string): Promise<void> {
    await this.r.zrem(key, member);
  }
  async incr(key: string, ttlSec: number): Promise<number> {
    const p = this.r.pipeline();
    p.incr(key);
    p.expire(key, ttlSec, "NX");
    const [n] = await p.exec<[number, number]>();
    return n;
  }
  async withLock<T>(key: string, fn: () => Promise<T>, opts?: { ttlMs?: number; waitMs?: number }): Promise<T> {
    const lockKey = `lock:${key}`;
    const token = crypto.randomUUID();
    const deadline = Date.now() + (opts?.waitMs ?? 2000);
    for (;;) {
      const ok = await this.r.set(lockKey, token, { nx: true, px: opts?.ttlMs ?? 5000 });
      if (ok === "OK") break;
      if (Date.now() > deadline) throw new LockTimeoutError(key);
      await new Promise((r) => setTimeout(r, 25));
    }
    try {
      return await fn();
    } finally {
      // best-effort release; only if we still own it
      const cur = await this.r.get<string>(lockKey);
      if (cur === token) await this.r.del(lockKey);
    }
  }
}
