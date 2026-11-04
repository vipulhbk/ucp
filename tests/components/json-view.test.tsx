// @vitest-environment jsdom
import "../setup-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JsonView } from "@/components/json/json-view";
import { ExchangePanel } from "@/components/exchange/exchange-panel";
import type { InteractionRecord } from "@/observability/recorder";

describe("JsonView", () => {
  it("pretty-prints and colors tokens", () => {
    const { container } = render(<JsonView value={{ a: 1, b: "x", c: [true, null] }} />);
    expect(container.querySelector("code")!.textContent).toBe(JSON.stringify({ a: 1, b: "x", c: [true, null] }, null, 2));
    expect(container.querySelectorAll("span.text-sky-600, span.dark\\:text-sky-300").length).toBeGreaterThan(0);
  });
  it("renders payloads as TEXT: markup inside values never becomes elements", () => {
    const evil = { name: '<img src=x onerror="window.__pwned=1">', html: "<script>window.__pwned=1</script>", "<b>key</b>": "v" };
    const { container } = render(<JsonView value={evil} />);
    expect(container.querySelector("img, script, b")).toBeNull();
    expect(container.textContent).toContain("<script>window.__pwned=1</script>");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
  it("copies the exact JSON text and confirms", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<JsonView value={{ id: 1 }} label="payload" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy payload" }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ id: 1 }, null, 2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy payload" })).toHaveTextContent("Copied"));
  });
  it("survives a missing clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    render(<JsonView value={1} />);
    await userEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(screen.getByRole("button", { name: /Copy/ })).toHaveTextContent("Copy");
  });
  it("handles undefined and large values without crashing", () => {
    render(<JsonView value={undefined} />);
    expect(screen.getByText("undefined")).toBeInTheDocument();
    const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, { v: i }]));
    expect(() => render(<JsonView value={big} />)).not.toThrow();
  });
});

const rec = (over: Partial<InteractionRecord> = {}): InteractionRecord => ({ id: "1", correlationId: "c-1", ts: "2026-11-04T10:00:00.000Z", actor: "platform", op: "create_checkout", method: "POST", url: "http://localhost:3000/api/ucp/v1/checkout-sessions", requestHeaders: { "x-api-key": "[REDACTED]" }, requestBody: { a: 1 }, status: 201, responseHeaders: {}, responseBody: { id: "chk_1" }, durationMs: 12, validation: [{ target: "response", schema: "create_checkout response", ok: true, issues: [] }], ...over });

describe("ExchangePanel", () => {
  it("shows actor, operation, method, path, status, duration and validation verdicts", () => {
    render(<ExchangePanel exchange={rec()} title="Create" />);
    const p = screen.getByTestId("exchange");
    expect(p).toHaveTextContent("platform");
    expect(p).toHaveTextContent("create_checkout");
    expect(p).toHaveTextContent("POST /api/ucp/v1/checkout-sessions");
    expect(p).toHaveTextContent("201");
    expect(p).toHaveTextContent("12 ms");
    expect(p).toHaveTextContent("response schema ok");
  });
  it("flags a failed validation and shows errors and notes", () => {
    render(<ExchangePanel exchange={rec({ status: undefined, validation: [{ target: "response", schema: "x", ok: false, issues: [{ path: "$.status", message: "bad" }] }], error: { kind: "timeout", message: "timed out" }, note: "SECURITY DEMO" })} />);
    const p = screen.getByTestId("exchange");
    expect(p).toHaveTextContent("response schema FAILED");
    expect(p).toHaveTextContent("no response");
    expect(p).toHaveTextContent("timeout: timed out");
    expect(p).toHaveTextContent("SECURITY DEMO");
  });
  it("shows only redacted values: the stored record is what is rendered", async () => {
    render(<ExchangePanel exchange={rec()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Request" }));
    expect(screen.getByTestId("exchange")).toHaveTextContent("[REDACTED]");
  });
});
