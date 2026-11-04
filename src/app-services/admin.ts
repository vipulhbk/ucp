import "server-only";
import { resolveOrigin } from "@/config";
import { defer } from "@/lib/defer";
import { getStore } from "@/persistence";
import { applyAction, availableActions, type AdminAction } from "@/merchant/orders/events";
import { loadOrder, orderIndexKey, renderOrder, type OrderRecord } from "@/merchant/orders/orders";
import { outboxDeps } from "@/merchant/webhooks/deps";
import { flush, listRows, sendExtra, type AttackKind, type OutboxRow } from "@/merchant/webhooks/outbox";
import { listReceipts, listSnapshots } from "@/platform/orders";
import { platformIdFor } from "@/ucp/platform-credential";

/**
 * Merchant admin console + webhook inspector backends. The admin console is the business's INTERNAL tooling (not UCP):
 * it reads the business's own store for the session's platform and appends events through the same order service.
 */
const pidOf = (sid: string) => platformIdFor(sid);
const merchantCtx = (req: Request, sid: string) => ({ store: getStore(), platformId: pidOf(sid), origin: resolveOrigin(req), now: Date.now, defer });

export async function listOrders(req: Request, sid: string) {
  const ctx = merchantCtx(req, sid);
  const ids = await ctx.store.listRange<string>(orderIndexKey(ctx.platformId));
  const rows = await listRows(ctx.store, ctx.platformId);
  const out = [];
  for (const id of ids) {
    const rec = await loadOrder(ctx.store, ctx.platformId, id);
    if (!rec) continue;
    out.push(shape(rec, ctx.origin, rows.filter((r) => r.orderId === id)));
  }
  return out.reverse();
}

function shape(rec: OrderRecord, origin: string, rows: OutboxRow[]) {
  return {
    id: rec.id,
    createdAt: rec.createdAt,
    version: rec.version,
    webhookUrl: rec.webhookUrl ?? null,
    entity: renderOrder(rec, { origin, active: {} }), // exactly what Get Order / webhooks carry
    actions: availableActions(rec),
    webhooks: rows.map((r) => ({ id: r.id, summary: r.summary, status: r.status, orderVersion: r.orderVersion, attempts: r.attempts.length })),
  };
}

export async function orderAction(req: Request, sid: string, orderId: string, action: AdminAction) {
  const ctx = merchantCtx(req, sid);
  const r = await applyAction(ctx, orderId, action);
  if (!r.ok) return r;
  return { ok: true as const, summary: r.summary, order: shape(r.order, ctx.origin, (await listRows(ctx.store, ctx.platformId)).filter((x) => x.orderId === orderId)) };
}

export async function webhookState(req: Request, sid: string) {
  const store = getStore();
  const pid = pidOf(sid);
  const [outbox, receipts, snapshots] = await Promise.all([listRows(store, pid), listReceipts(store, pid), listSnapshots(store, pid)]);
  return {
    outbox: outbox.reverse().map((r) => ({ ...r, body: safeJson(r.body) })),
    receipts,
    snapshots: snapshots.map((s) => ({ orderId: String(s.order.id), webhookId: s.webhookId, receivedAt: s.receivedAt, history: s.history, order: s.order })),
    origin: resolveOrigin(req),
  };
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

export async function retryNow(req: Request, sid: string, force: boolean) {
  const delivered = await flush(outboxDeps(resolveOrigin(req)), pidOf(sid), { force });
  return { attempted: delivered.length, rows: delivered.map((r) => ({ id: r.id, status: r.status, attempts: r.attempts.length })) };
}

export async function sendExtraDelivery(req: Request, sid: string, rowId: string, mode: "redeliver" | AttackKind) {
  return sendExtra(outboxDeps(resolveOrigin(req)), pidOf(sid), rowId, mode);
}
