// @vitest-environment jsdom
import "../setup-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "@/app/(dashboard)/agent/agent-panel";
import { ValidatorPanel } from "@/app/(dashboard)/validator/validator-panel";
import { emptyRun, type AgentRun } from "@/platform/agent/types";

// Next returns a stable object from useSearchParams; a mock that returns a new one each render would re-trigger effects forever.
const stableParams = new URLSearchParams("");
vi.mock("next/navigation", () => ({ useSearchParams: () => stableParams, usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const json = (data: unknown, ok = true, status = 200) => ({ ok, status, json: async () => data });

describe("validator panel", () => {
  const targets = {
    ucpVersion: "2026-08-25",
    scope: "This checks JSON shape against the official schemas. It does NOT test protocol behavior.",
    opTargets: { create_checkout: { request: "checkout_create_request" } },
    targets: [{ id: "checkout_create_request", label: "Create Checkout request", direction: "request", description: "POST body", zodName: "CheckoutCreateRequestSchema", docFile: "shopping/checkout.json", docUrl: "https://ucp.dev/x", hasRules: false, examples: { valid: { title: "Valid", payload: { line_items: [{ item: { id: "a" }, quantity: 1 }] } }, invalid: [{ title: "quantity 0", why: "min 1", payload: { line_items: [{ item: { id: "a" }, quantity: 0 }] } }] } }],
  };
  const okReport = { target: { id: "checkout_create_request", label: "x", zodName: "CheckoutCreateRequestSchema", docFile: "shopping/checkout.json", docUrl: "https://ucp.dev/x" }, parse: { ok: true }, schema: { ok: true, issues: [] }, rules: [], scope: targets.scope };
  const badReport = { ...okReport, schema: { ok: false, issues: [{ path: "$.line_items[0].quantity", message: "Number must be greater than or equal to 1", code: "too_small", expected: "at least 1", actual: "0" }] }, rules: [{ id: "r", level: "heuristic", ok: false, statement: "total adds up", source: "Not stated by the spec", detail: "x" }] };

  beforeEach(() => {
    let report: unknown = okReport;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/validator/targets")) return json(targets);
      if (url.includes("/validator/schema/")) return json({ schema: { title: "Checkout" } });
      if (url.includes("/inspector/events")) return json({ events: [] });
      if (url.includes("/validator/validate")) {
        const body = JSON.parse(String(init?.body));
        report = body.payload.includes('"quantity": 0') ? badReport : body.payload.trim().startsWith("{ not") ? { ...okReport, parse: { ok: false, message: "Expected property name at position 2" }, schema: undefined } : okReport;
        return json(report);
      }
      return json({});
    }));
  });

  it("validates the valid example on load and states plainly that this is not conformance", async () => {
    render(<ValidatorPanel />);
    expect(await screen.findByText("schema-valid")).toBeInTheDocument();
    expect(screen.getByTestId("scope")).toHaveTextContent(/does NOT test protocol behavior/);
    expect(screen.getByText(/Official conformance suite:/)).toBeInTheDocument();
    expect(screen.getByText(/not run/)).toBeInTheDocument();
  });
  it("an invalid example shows the path, the problem, expected and the actual value, and a separate rules section", async () => {
    render(<ValidatorPanel />);
    await screen.findByText("schema-valid");
    await userEvent.click(screen.getByTestId("ex-invalid-0"));
    const issue = await screen.findByTestId("issue");
    expect(issue).toHaveTextContent("$.line_items[0].quantity");
    expect(issue).toHaveTextContent("Number must be greater than or equal to 1");
    expect(issue).toHaveTextContent("at least 1");
    expect((screen.getByTestId("payload") as HTMLTextAreaElement).value).toContain('"quantity": 0');
    const rule = within(screen.getByTestId("rules-result")).getByTestId("rule");
    expect(rule).toHaveTextContent(/heuristic \(not a spec rule\)/);
  });
  it("broken JSON is reported as a syntax problem, not a schema result", async () => {
    render(<ValidatorPanel />);
    await screen.findByText("schema-valid");
    const ta = screen.getByTestId("payload");
    await userEvent.clear(ta);
    await userEvent.click(ta);
    await userEvent.paste("{ not json");
    await userEvent.click(screen.getByTestId("validate"));
    expect(await screen.findByTestId("parse-error")).toHaveTextContent("position 2");
    expect(screen.getByText("not valid JSON")).toBeInTheDocument();
  });
  it("shows the expected (official) schema next to the result", async () => {
    render(<ValidatorPanel />);
    await waitFor(() => expect(screen.getByText("Expected schema")).toBeInTheDocument());
    await waitFor(() => expect(document.body.textContent).toContain('"title": "Checkout"')); // JSON is tokenized into spans, so check the text content
    expect(screen.getByRole("link", { name: "shopping/checkout.json" })).toHaveAttribute("href", "https://ucp.dev/x");
  });
});

describe("agent panel", () => {
  const run = (over: Partial<AgentRun> = {}): AgentRun => ({ ...emptyRun("r1"), ...over });
  const sent: unknown[] = [];

  function serve(initial: AgentRun, reply?: (body: Record<string, unknown>) => AgentRun) {
    sent.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/agent") && !init) return json({ run: initial });
      if (url.includes("/agent/message")) {
        const body = JSON.parse(String(init?.body));
        sent.push(body);
        return json({ run: reply ? reply(body) : initial });
      }
      if (url.includes("get_checkout") || url.includes("/ucp/call")) return json({ body: { status: "ready_for_complete", currency: "INR", line_items: [{ id: "l", quantity: 1, item: { id: "v", title: "Aurora" } }], totals: [{ type: "subtotal", amount: 1 }, { type: "total", amount: 530882 }] } });
      return json({});
    }));
  }

  it("shows the transcript and timeline, with a link from each step to its Request-Id", async () => {
    serve(run({ transcript: [{ id: "1", role: "buyer", text: "find headphones", ts: "t" }, { id: "2", role: "agent", text: "I found 2 matches", ts: "t" }], timeline: [{ id: "a", ts: "t", kind: "search", title: "Searched the catalog", status: "ok", op: "search_catalog", httpStatus: 200, correlationId: "abcdef12-0000" }] }));
    render(<AgentPanel />);
    expect(await screen.findByText("I found 2 matches")).toBeInTheDocument();
    expect(screen.getByTestId("timeline")).toHaveTextContent("Searched the catalog");
    expect(screen.getByTestId("timeline")).toHaveTextContent("search_catalog · HTTP 200 · abcdef12…");
  });
  it("shows the shortlist and sends the chosen number when the buyer clicks Choose", async () => {
    serve(run({ state: "proposing", pending: { type: "choose_product" }, candidates: [{ productId: "p1", variantId: "v1", title: "Aurora ANC", price: 449900, rating: 4.4, tags: [], matches: [] }, { productId: "p2", variantId: "v2", title: "Drift ANC", price: 329900, tags: [], matches: [] }] }));
    render(<AgentPanel />);
    await screen.findByTestId("candidates");
    expect(screen.getByTestId("candidates")).toHaveTextContent("₹4,499.00");
    await userEvent.click(screen.getByTestId("pick-2"));
    await waitFor(() => expect(sent).toContainEqual({ text: "2" }));
  });
  it("renders the confirmation card for an authorize request, and tells the agent only that the buyer clicked (no result)", async () => {
    serve(run({ state: "awaiting_consent", pending: { type: "authorize", checkoutId: "chk_1", expectedTotal: 530882, currency: "INR", cards: [{ id: "visa_ok", label: "Visa · always approved" }], defaultCardId: "visa_ok" } }));
    const fetchMock = vi.mocked(fetch);
    render(<AgentPanel />);
    expect(await screen.findByTestId("confirmation")).toBeInTheDocument();
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes("/checkout/authorize")) return json({ consentExchange: {}, tokenize: { exchange: {} }, complete: { exchange: {}, body: { status: "completed" } } }) as never;
      if (String(url).includes("/agent/message")) { sent.push(JSON.parse(String((init as RequestInit).body))); return json({ run: run({ state: "ordered", orderId: "ord_1" }) }) as never; }
      return json({ body: { status: "ready_for_complete", currency: "INR", line_items: [], totals: [{ type: "total", amount: 530882 }] } }) as never;
    });
    await userEvent.click(await screen.findByRole("button", { name: /I authorize this purchase/ }));
    await waitFor(() => expect(sent).toContainEqual({ event: "authorization_attempted", cardId: "visa_ok" }));
    expect(JSON.stringify(sent)).not.toMatch(/completed|order/); // the agent is told nothing about the outcome; it must ask the merchant
    expect(await screen.findByTestId("ordered")).toHaveTextContent("ord_1");
  });
  it("empty input cannot be sent; long input is capped by the field", async () => {
    serve(run());
    render(<AgentPanel />);
    await screen.findByText(/Tell the agent what you want/);
    expect(screen.getByTestId("send")).toBeDisabled();
    expect(screen.getByLabelText("Message the agent")).toHaveAttribute("maxlength", "500");
  });
  it("suggestions send their text", async () => {
    serve(run());
    render(<AgentPanel />);
    await userEvent.click(await screen.findByRole("button", { name: /Find me a wireless headphone under ₹5,000/ }));
    await waitFor(() => expect(sent[0]).toMatchObject({ text: expect.stringContaining("noise cancellation") }));
  });
});
