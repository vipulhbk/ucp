/**
 * Checkout status lifecycle, transcribed from the diagram in checkout/index.md → Checkout Status Lifecycle.
 * The merchant sets status; `incomplete` / `ready_for_complete` / `requires_escalation` are *derived* from content,
 * the rest move only through structural events. Nothing outside this table may change status.
 */
export const CHECKOUT_STATUSES = ["incomplete", "requires_escalation", "ready_for_complete", "complete_in_progress", "completed", "canceled"] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

export const TERMINAL: readonly CheckoutStatus[] = ["completed", "canceled"];

/** Every edge the lifecycle permits. */
export const ALLOWED: Record<CheckoutStatus, readonly CheckoutStatus[]> = {
  incomplete: ["incomplete", "ready_for_complete", "requires_escalation", "canceled"],
  ready_for_complete: ["ready_for_complete", "incomplete", "requires_escalation", "complete_in_progress", "completed", "canceled"],
  // buyer handoff via continue_url can finish the order out of band
  requires_escalation: ["requires_escalation", "incomplete", "ready_for_complete", "completed", "canceled"],
  complete_in_progress: ["complete_in_progress", "completed", "incomplete", "canceled"],
  completed: [],
  canceled: [],
};

export function isLegalTransition(from: CheckoutStatus, to: CheckoutStatus): boolean {
  return ALLOWED[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    public from: CheckoutStatus,
    public to: CheckoutStatus,
  ) {
    super(`illegal checkout transition ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: CheckoutStatus, to: CheckoutStatus): void {
  if (!isLegalTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export type Operation = "update" | "complete" | "cancel" | "get";

/** What each operation may do in each status (spec: Accepted completion table, Status Values). */
export function operationAllowed(status: CheckoutStatus, op: Operation): boolean {
  if (op === "get") return true;
  if (TERMINAL.includes(status)) return false;
  if (status === "complete_in_progress") return op === "cancel";
  if (op === "complete") return status === "ready_for_complete";
  return true; // update / cancel
}
