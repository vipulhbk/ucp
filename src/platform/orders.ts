import type { Store } from "@/persistence/store";

/** Platform-side order bookkeeping. Namespace `p:{platformId}:` (the platform's data, separate from the business's `m:`). */
export interface Ownership {
  orderId: string;
  checkoutId?: string;
  /** The business that created the order: webhooks for it must be signed by THIS profile (spec: order/index.md → Verification, Authorization). */
  businessProfileUrl: string;
  placedAt: number;
}

export interface OrderSnapshot {
  order: Record<string, unknown>;
  webhookId: string;
  webhookTs: number;
  receivedAt: number;
  history: { webhookId: string; ts: number; receivedAt: number; applied: boolean }[];
}

export interface WebhookReceipt {
  id: string;
  webhookId?: string;
  receivedAt: number;
  orderId?: string;
  signerProfileUrl?: string;
  keyid?: string;
  alg?: string;
  verified: boolean;
  /** For rejected deliveries: the machine-readable reason (spec error code where one exists). */
  reason?: string;
  detail?: string;
  httpStatus: number;
  duplicate: boolean;
  outcome: "pending" | "applied" | "stale_ignored" | "duplicate" | "rejected";
  webhookTimestamp?: number;
  bodyBytes: number;
  headers: Record<string, string>;
}

export const ownKey = (pid: string, orderId: string) => `p:${pid}:own:${orderId}`;
export const snapKey = (pid: string, orderId: string) => `p:${pid}:snap:${orderId}`;
export const receiptKey = (pid: string, id: string) => `p:${pid}:whr:${id}`;
export const receiptIndex = (pid: string) => `p:${pid}:whidx`;
export const seenKey = (pid: string, webhookId: string) => `p:${pid}:whseen:${webhookId}`;
export const snapIndex = (pid: string) => `p:${pid}:snapidx`;

export async function recordOwnership(store: Store, pid: string, o: Ownership): Promise<void> {
  await store.setNX(ownKey(pid, o.orderId), o); // first writer wins; the business of record cannot be rewritten later
}

export async function listReceipts(store: Store, pid: string): Promise<WebhookReceipt[]> {
  const ids = await store.listRange<string>(receiptIndex(pid));
  const rs = await Promise.all(ids.map((id) => store.get<WebhookReceipt>(receiptKey(pid, id))));
  return rs.filter((r): r is WebhookReceipt => r !== null).reverse();
}

export async function listSnapshots(store: Store, pid: string): Promise<OrderSnapshot[]> {
  const ids = [...new Set(await store.listRange<string>(snapIndex(pid)))];
  const s = await Promise.all(ids.map((id) => store.get<OrderSnapshot>(snapKey(pid, id))));
  return s.filter((x): x is OrderSnapshot => x !== null);
}
