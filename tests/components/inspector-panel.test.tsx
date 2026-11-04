// @vitest-environment jsdom
import "../setup-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InspectorPanel } from "@/app/(dashboard)/inspector/inspector-panel";
import type { InteractionRecord } from "@/observability/recorder";

let search = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search), usePathname: () => "/inspector" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const base = { ts: "2026-11-04T10:00:00.000Z", requestHeaders: { "ucp-agent": 'profile="https://p"' }, validation: [] as InteractionRecord["validation"], method: "GET" };
const events: InteractionRecord[] = [
  { ...base, id: "e1", correlationId: "c1", actor: "platform", op: "get_checkout", url: "http://x/api/ucp/v1/checkout-sessions/chk_1", status: 200, durationMs: 5, replayable: true },
  { ...base, id: "e2", correlationId: "c1", actor: "business", op: "get_checkout", url: "http://x/api/ucp/v1/checkout-sessions/chk_1", status: 200, durationMs: 2 },
  { ...base, id: "e3", correlationId: "c2", actor: "platform", op: "create_checkout", method: "POST", url: "http://x/api/ucp/v1/checkout-sessions", status: 201, requestBody: { line_items: [] }, durationMs: 9 },
  { ...base, id: "e4", correlationId: "c3", actor: "platform", op: "create_checkout", method: "POST", url: "http://x/api/ucp/v1/checkout-sessions", status: 400, validation: [{ target: "request", schema: "r", ok: false, issues: [] }], durationMs: 3 },
];
const payload = { events, facets: { actors: [{ name: "platform", count: 3 }, { name: "business", count: 1 }], ops: [{ name: "create_checkout", count: 2 }, { name: "get_checkout", count: 2 }] }, summary: { total: 4, failures: 1, validationFailures: 1, avgDurationMs: 5, correlated: 3 } };
const calls = () => vi.mocked(fetch).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  search = "";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
});

describe("inspector panel", () => {
  it("lists interactions newest first with actor, operation, path, status and a summary strip", async () => {
    render(<InspectorPanel />);
    const rows = await screen.findAllByTestId("row");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute("data-op", "create_checkout"); // newest first by default (reverse of the chronological API order)
    expect(within(screen.getByTestId("summary")).getByText("Failures").nextSibling).toHaveTextContent("1");
    expect(rows[0]).toHaveTextContent("POST /api/ucp/v1/checkout-sessions");
  });
  it("starts with filters taken from the URL (deep links from other pages)", async () => {
    search = "op=create_checkout&actor=business,platform&status=client_error&correlation=c3&q=sessions";
    render(<InspectorPanel />);
    await waitFor(() => expect(calls().some((u) => u.includes("op=create_checkout") && u.includes("actor=business%2Cplatform") && u.includes("status=client_error") && u.includes("correlation=c3") && u.includes("q=sessions"))).toBe(true));
    expect(screen.getByLabelText("Operation")).toHaveValue("create_checkout");
    expect(screen.getByLabelText("Status")).toHaveValue("client_error");
  });
  it("toggling an actor chip re-queries with that actor; clearing removes the filter", async () => {
    render(<InspectorPanel />);
    await screen.findAllByTestId("row");
    await userEvent.click(screen.getByTestId("actor-business"));
    await waitFor(() => expect(calls().at(-1)).toContain("actor=business"));
    expect(screen.getByTestId("actor-business")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(calls().at(-1)).not.toContain("actor="));
  });
  it("the operation selector is built from what exists in the log", async () => {
    render(<InspectorPanel />);
    await screen.findAllByTestId("row");
    const options = within(screen.getByLabelText("Operation")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["all operations", "create_checkout (2)", "get_checkout (2)"]);
  });
  it("the export link carries the active filters", async () => {
    render(<InspectorPanel />);
    await screen.findAllByTestId("row");
    expect(screen.getByTestId("export")).toHaveAttribute("href", "/api/playground/inspector/export");
    await userEvent.selectOptions(screen.getByLabelText("Operation"), "get_checkout");
    await waitFor(() => expect(screen.getByTestId("export")).toHaveAttribute("href", "/api/playground/inspector/export?op=get_checkout"));
    expect(screen.getByTestId("export")).toHaveAttribute("download", "ucp-session-log.ndjson");
  });
  it("offers Replay only for read-only platform requests", async () => {
    render(<InspectorPanel />);
    const rows = await screen.findAllByTestId("row");
    const byId = (id: string) => rows.find((r) => r.textContent?.includes(id))!;
    // expand a platform get_checkout (replayable) and a platform create_checkout (not)
    await userEvent.click(within(rows.find((r) => r.getAttribute("data-op") === "get_checkout" && r.getAttribute("data-actor") === "platform")!).getAllByRole("button")[0]!);
    expect(screen.getByTestId("replay")).toBeInTheDocument();
    await userEvent.click(within(rows.find((r) => r.getAttribute("data-op") === "create_checkout" && r.textContent?.includes("201"))!).getAllByRole("button")[0]!);
    expect(screen.getAllByText("replay not offered")).toHaveLength(1);
    void byId;
  });
  it("replay posts the record id and shows the identical / different verdict", async () => {
    const replayed = { ...events[0]!, id: "r1", correlationId: "c9", note: "Replay of e1" };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => (init?.method === "POST" ? { replayed, original: { status: 200 }, identical: false, differences: ["$.status"] } : payload) })));
    render(<InspectorPanel />);
    const rows = await screen.findAllByTestId("row");
    await userEvent.click(within(rows.find((r) => r.getAttribute("data-op") === "get_checkout" && r.getAttribute("data-actor") === "platform")!).getAllByRole("button")[0]!);
    await userEvent.click(screen.getByTestId("replay"));
    const r = await screen.findByTestId("replay-result");
    expect(r).toHaveTextContent("Different from the original");
    expect(r).toHaveTextContent("changed: $.status");
    const post = vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toBe("/api/playground/inspector/replay");
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ id: "e1" });
  });
  it("shows an empty state, and a different one when filters hide everything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...payload, events: [], summary: { ...payload.summary, total: 0 } }) })));
    render(<InspectorPanel />);
    expect(await screen.findByText(/Nothing recorded yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("actor-platform"));
    expect(await screen.findByText(/No interaction matches these filters/)).toBeInTheDocument();
  });
  it("surfaces a load failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { kind: "internal", message: "Unexpected error" } }) })));
    render(<InspectorPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unexpected error");
  });
  it("'Show both ends' filters to one correlation id", async () => {
    render(<InspectorPanel />);
    const rows = await screen.findAllByTestId("row");
    await userEvent.click(within(rows.find((r) => r.getAttribute("data-op") === "get_checkout" && r.getAttribute("data-actor") === "platform")!).getAllByRole("button")[0]!);
    await userEvent.click(screen.getByRole("button", { name: /Show both ends/ }));
    await waitFor(() => expect(calls().at(-1)).toContain("correlation=c1"));
    expect(screen.getByText(/Showing both ends of/)).toBeInTheDocument();
  });
});
