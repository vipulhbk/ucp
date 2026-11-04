import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/persistence/memory";

describe("MemoryStore", () => {
  it("setNX is atomic-by-contract: only the first caller wins", async () => {
    const s = new MemoryStore();
    expect(await s.setNX("k", 1)).toBe(true);
    expect(await s.setNX("k", 2)).toBe(false);
    expect(await s.get("k")).toBe(1);
  });
  it("honors TTL", async () => {
    let now = 1_000;
    const s = new MemoryStore(() => now);
    await s.set("k", "v", { ttlSec: 10 });
    now += 9_000;
    expect(await s.get("k")).toBe("v");
    now += 2_000;
    expect(await s.get("k")).toBeNull();
  });
  it("returns copies, not references", async () => {
    const s = new MemoryStore();
    await s.set("k", { a: 1 });
    const v = (await s.get<{ a: number }>("k"))!;
    v.a = 99;
    expect((await s.get<{ a: number }>("k"))!.a).toBe(1);
  });
  it("caps lists and supports ranges", async () => {
    const s = new MemoryStore();
    for (let i = 0; i < 5; i++) await s.listPush("l", i, { max: 3 });
    expect(await s.listRange("l")).toEqual([2, 3, 4]);
  });
  it("delPrefix removes only the session's keys", async () => {
    const s = new MemoryStore();
    await s.set("s:a:1", 1);
    await s.set("s:a:2", 2);
    await s.set("s:b:1", 3);
    expect(await s.delPrefix("s:a:")).toBe(2);
    expect(await s.get("s:b:1")).toBe(3);
  });
  it("sorted set returns due members in score order", async () => {
    const s = new MemoryStore();
    await s.zAdd("z", 30, "c");
    await s.zAdd("z", 10, "a");
    await s.zAdd("z", 20, "b");
    expect(await s.zDue("z", 25, 10)).toEqual(["a", "b"]);
    await s.zRem("z", "a");
    expect(await s.zDue("z", 25, 10)).toEqual(["b"]);
  });
  it("withLock serializes read-modify-write", async () => {
    const s = new MemoryStore();
    await s.set("n", 0);
    await Promise.all(Array.from({ length: 10 }, () => s.withLock("n", async () => { const v = (await s.get<number>("n"))!; await new Promise((r) => setTimeout(r, 2)); await s.set("n", v + 1); })));
    expect(await s.get("n")).toBe(10);
  });
});
