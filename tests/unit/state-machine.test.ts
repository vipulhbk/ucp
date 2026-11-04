import { describe, expect, it } from "vitest";
import { ALLOWED, CHECKOUT_STATUSES, IllegalTransitionError, assertTransition, isLegalTransition, operationAllowed } from "@/merchant/checkout/state-machine";

describe("checkout status lifecycle (spec diagram)", () => {
  it("uses exactly the six spec status values", () => {
    expect([...CHECKOUT_STATUSES].sort()).toEqual(["canceled", "complete_in_progress", "completed", "incomplete", "ready_for_complete", "requires_escalation"]);
  });
  it("terminal states have no outgoing edges", () => {
    expect(ALLOWED.completed).toEqual([]);
    expect(ALLOWED.canceled).toEqual([]);
  });
  it("every non-terminal state can be canceled", () => {
    for (const s of CHECKOUT_STATUSES.filter((s) => s !== "completed" && s !== "canceled")) expect(isLegalTransition(s, "canceled")).toBe(true);
  });
  it("complete_in_progress is only reachable from ready_for_complete", () => {
    const into = CHECKOUT_STATUSES.filter((s) => s !== "complete_in_progress" && ALLOWED[s].includes("complete_in_progress"));
    expect(into).toEqual(["ready_for_complete"]);
  });
  it("rejects edges the spec does not draw", () => {
    expect(isLegalTransition("incomplete", "completed")).toBe(false);
    expect(isLegalTransition("incomplete", "complete_in_progress")).toBe(false);
    expect(isLegalTransition("completed", "incomplete")).toBe(false);
    expect(isLegalTransition("canceled", "ready_for_complete")).toBe(false);
    expect(() => assertTransition("completed", "canceled")).toThrow(IllegalTransitionError);
  });
  it("operation permissions follow 'Accepted completion' and terminal rules", () => {
    expect(operationAllowed("ready_for_complete", "complete")).toBe(true);
    expect(operationAllowed("incomplete", "complete")).toBe(false);
    expect(operationAllowed("requires_escalation", "complete")).toBe(false);
    expect(operationAllowed("complete_in_progress", "update")).toBe(false);
    expect(operationAllowed("complete_in_progress", "complete")).toBe(false);
    expect(operationAllowed("complete_in_progress", "get")).toBe(true);
    expect(operationAllowed("completed", "update")).toBe(false);
    expect(operationAllowed("canceled", "cancel")).toBe(false);
    expect(operationAllowed("canceled", "get")).toBe(true);
  });
});
