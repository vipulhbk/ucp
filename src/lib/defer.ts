import { after } from "next/server";

/**
 * Run work after the response has been sent (Next `after`), so slow side effects (webhook delivery) never delay the
 * caller. Outside a request scope (tests, scripts) it runs immediately. Tests can capture and await deferred work.
 */
let sink: (() => Promise<unknown>)[] | null = null;

export function defer(fn: () => Promise<unknown>): void {
  const run = () => fn().catch((e) => console.error("[defer] deferred task failed:", (e as Error).message));
  if (sink) {
    sink.push(run); // held until drain(), so tests decide when side effects happen
    return;
  }
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Test helper: hold deferred tasks until `drain()` is awaited. */
export function captureDeferred(): { drain: () => Promise<void>; stop: () => void } {
  const mine: (() => Promise<unknown>)[] = [];
  sink = mine;
  return {
    drain: async () => {
      while (mine.length) await Promise.all(mine.splice(0).map((f) => f()));
    },
    stop: () => {
      sink = null;
    },
  };
}
