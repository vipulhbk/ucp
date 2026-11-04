// @vitest-environment jsdom
import "../setup-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerFlow } from "@/components/trips/planner-flow";
import { TripCard } from "@/components/trips/trip-card";
import { MockTripPlanner } from "@/trips/planner";
import { TRIPS } from "@/trips/samples";
import type { PlanRequest } from "@/trips/types";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const json = (data: unknown, ok = true, status = 200) => ({ ok, status, json: async () => data });
let lastBody: PlanRequest | undefined;

beforeEach(() => {
  lastBody = undefined;
  // The route is a thin wrapper over the mock planner, so the component test uses the real planner behind a stubbed fetch.
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    lastBody = JSON.parse(String(init?.body));
    return json(await new MockTripPlanner().plan(lastBody!));
  }));
});

describe("planner flow", () => {
  it("walks where → about you → result, sends exactly what was entered, and labels the planner a mock", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow />);
    const dest = screen.getByLabelText(/where do you want to go/i);
    await u.clear(dest);
    await u.type(dest, "Goa");
    await u.click(screen.getByRole("button", { name: /continue/i }));

    await u.click(screen.getByRole("checkbox", { name: /beaches/i }));
    await u.click(screen.getByRole("radio", { name: "₹₹" }));
    await u.type(screen.getByLabelText(/anything else/i), "avoid night life");
    await u.click(screen.getByTestId("plan-submit"));

    await waitFor(() => expect(screen.getByTestId("plan-result")).toBeInTheDocument());
    expect(lastBody).toEqual({ destination: "Goa", interests: ["beaches"], budgetTier: 2, notes: "avoid night life" });
    expect(screen.getByText(/no AI model/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see the itinerary/i })).toHaveAttribute("href", "/trips/goa");
  });

  it("allows at most three interests and explains why a fourth cannot be picked", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow />);
    await u.click(screen.getByRole("button", { name: /continue/i }));
    for (const name of [/^art/i, /^kids/i, /^sports/i]) await u.click(screen.getByRole("checkbox", { name }));
    expect(screen.getByRole("checkbox", { name: /shopping/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/deselect one/i);
    await u.click(screen.getByRole("checkbox", { name: /^art/i }));
    expect(screen.getByRole("checkbox", { name: /shopping/i })).toBeEnabled();
  });

  it("shows the planner's caveats instead of hiding them (a destination it has no trip for)", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow />);
    const dest = screen.getByLabelText(/where do you want to go/i);
    await u.clear(dest);
    await u.type(dest, "Reykjavik");
    await u.click(screen.getByRole("button", { name: /continue/i }));
    await u.click(screen.getByTestId("plan-submit"));
    await waitFor(() => expect(screen.getByTestId("plan-caveats")).toBeInTheDocument());
    expect(screen.getByTestId("plan-caveats")).toHaveTextContent(/no ready-made trip for "Reykjavik"/);
  });

  it("surfaces a server error and lets the traveller go back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { kind: "bad_request", message: "invalid plan request" } }, false, 400)));
    const u = userEvent.setup();
    render(<PlannerFlow />);
    await u.click(screen.getByRole("button", { name: /continue/i }));
    await u.click(screen.getByTestId("plan-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid plan request/);
    await u.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByLabelText(/where do you want to go/i)).toBeInTheDocument();
  });

  it("start over returns to the first step", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow />);
    await u.click(screen.getByRole("button", { name: /continue/i }));
    await u.click(screen.getByTestId("plan-submit"));
    await waitFor(() => screen.getByTestId("plan-result"));
    await u.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByLabelText(/where do you want to go/i)).toBeInTheDocument();
  });
});

describe("trip card", () => {
  it("links to the trip and shows what the merchant would charge, with a decorative cover", () => {
    const t = TRIPS[0]!;
    render(<TripCard trip={{ ...t, packageTotal: 3923500 }} />);
    const card = screen.getByTestId("trip-card");
    expect(card).toHaveAttribute("href", `/trips/${t.id}`);
    expect(card).toHaveTextContent("₹39,235.00");
    expect(card.querySelector("img")).toHaveAttribute("alt", "");
  });
});
