// @vitest-environment jsdom
import "../setup-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerFlow } from "@/components/trips/planner-flow";
import { TripCard, type TripSummary } from "@/components/trips/trip-card";
import { rankTrips } from "@/trips/rank";
import { MockTripPlanner } from "@/trips/planner";
import { TRIPS } from "@/trips/samples";
import type { PlanRequest } from "@/trips/types";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const json = (data: unknown, ok = true, status = 200) => ({ ok, status, json: async () => data });
let lastBody: PlanRequest | undefined;
let info: unknown = { mode: "mock" };
let planOverride: ((body: PlanRequest) => unknown) | undefined;

const SUMMARIES: TripSummary[] = TRIPS.map((t) => ({ id: t.id, destination: t.destination, country: t.country, aliases: t.aliases, days: t.days, budgetTier: t.budgetTier, tagline: t.tagline, interests: t.interests, cover: t.cover, packageTotal: 1_000_000 + t.days * 100_000 }));

beforeEach(() => {
  lastBody = undefined;
  info = { mode: "mock" };
  planOverride = undefined;
  // The plan route is a thin wrapper over the planner, so the component test uses the real mock planner behind a stubbed fetch.
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/trips/planner")) return json(info);
    lastBody = JSON.parse(String(init?.body));
    return json(planOverride ? planOverride(lastBody!) : await new MockTripPlanner().plan(lastBody!));
  }));
});

describe("planner flow", () => {
  it("walks where → about you → result, sends exactly what was entered, and labels the planner a mock", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow trips={SUMMARIES} />);
    const dest = screen.getByLabelText(/where do you want to go/i);
    await u.clear(dest);
    await u.type(dest, "Goa");
    await u.type(screen.getByLabelText(/travelling from/i), "Mumbai");
    await u.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText(/planning for/i)).toHaveTextContent("Goa from Mumbai");

    await u.click(screen.getByRole("checkbox", { name: /beaches/i }));
    await u.click(screen.getByRole("radio", { name: "₹₹" }));
    await u.type(screen.getByLabelText(/anything else/i), "avoid night life");
    await u.click(screen.getByTestId("plan-submit"));

    await waitFor(() => expect(screen.getByTestId("plan-result")).toBeInTheDocument());
    expect(lastBody).toEqual({ destination: "Goa", origin: "Mumbai", interests: ["beaches"], budgetTier: 2, notes: "avoid night life" });
    expect(screen.getByText(/no AI model/i)).toBeInTheDocument();
    expect(screen.getByTestId("plan-caveats")).toHaveTextContent(/travelling from Mumbai/i);
    expect(screen.getByRole("link", { name: /see the itinerary/i })).toHaveAttribute("href", "/trips/goa");
  });

  it("allows at most three interests and explains why a fourth cannot be picked", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow trips={SUMMARIES} />);
    await u.click(screen.getByRole("button", { name: /continue/i }));
    for (const name of [/^art/i, /^kids/i, /^sports/i]) await u.click(screen.getByRole("checkbox", { name }));
    expect(screen.getByRole("checkbox", { name: /shopping/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/deselect one/i);
    await u.click(screen.getByRole("checkbox", { name: /^art/i }));
    expect(screen.getByRole("checkbox", { name: /shopping/i })).toBeEnabled();
  });

  it("shows the planner's caveats instead of hiding them (a destination it has no trip for)", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow trips={SUMMARIES} />);
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
    render(<PlannerFlow trips={SUMMARIES} />);
    await u.click(screen.getByRole("button", { name: /continue/i }));
    await u.click(screen.getByTestId("plan-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid plan request/);
    await u.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByLabelText(/where do you want to go/i)).toBeInTheDocument();
  });

  it("start over returns to the first step", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow trips={SUMMARIES} />);
    await u.click(screen.getByRole("button", { name: /continue/i }));
    await u.click(screen.getByTestId("plan-submit"));
    await waitFor(() => screen.getByTestId("plan-result"));
    await u.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByLabelText(/where do you want to go/i)).toBeInTheDocument();
  });
});

describe("planner flow interactions", () => {
  it("when an AI planner is active it discloses that text is sent to an AI service, without naming the provider or model", async () => {
    const u = userEvent.setup();
    info = { mode: "gemini", model: "gemini-test" };
    const { container, unmount } = render(<PlannerFlow trips={SUMMARIES} />);
    await u.click(screen.getByRole("button", { name: /continue/i }));
    const note = await screen.findByTestId("ai-disclosure");
    expect(note).toHaveTextContent(/sent to an AI service/i);
    expect(note).toHaveTextContent(/improve its products/i);
    expect(container.textContent ?? "").not.toMatch(/gemini|google|powered by/i);
    unmount();

    info = { mode: "mock" };
    render(<PlannerFlow trips={SUMMARIES} />);
    await u.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.queryByTestId("ai-disclosure")).not.toBeInTheDocument();
  });

  it("shows an AI-written itinerary as plain text, names it an AI-written plan and links the closest bookable trip", async () => {
    const u = userEvent.setup();
    info = { mode: "gemini", model: "gemini-test" };
    planOverride = () => ({
      trip: TRIPS.find((t) => t.id === "kyoto")!,
      generated: {
        title: "Tokyo in four days", destination: "Tokyo", country: "Japan", tagline: "Neon and noodles.", bestSeason: "March to May",
        highlights: ["Shibuya"], tips: ["<img src=x onerror=alert(1)> Get a transit card."],
        gettingThere: "Fly direct from Mumbai, about nine hours.",
        stays: [
          { name: "Asakusa guesthouse", kind: "guesthouse", area: "Asakusa", nightlyInr: 6200, why: "Quiet streets." },
          { name: "Shinjuku hotel", kind: "hotel", area: "Shinjuku", nightlyInr: 11000, why: "Central." },
        ],
        itinerary: [
          { title: "Arrive", items: [{ slot: "morning", title: "Senso-ji", detail: "Go early.", area: "Asakusa", costInr: 500 }] },
          { title: "Food day", items: [{ slot: "evening", title: "Izakaya", detail: "Small plates.", area: "Shinjuku", costInr: 0 }] },
        ],
      },
      reasons: ["Written by an AI model for what you entered."],
      caveats: ["AI-written plan. It used no live search."],
      source: { kind: "model", name: "AI-written plan" },
    });
    const { container } = render(<PlannerFlow trips={SUMMARIES} />);
    await u.type(screen.getByLabelText(/where do you want to go/i), "Tokyo");
    await u.click(screen.getByRole("button", { name: /continue/i }));
    await u.click(screen.getByTestId("plan-submit"));

    await waitFor(() => expect(screen.getByTestId("generated-plan")).toBeInTheDocument());
    expect(screen.getByText("AI-written plan")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tokyo in four days" })).toBeInTheDocument();
    expect(screen.getAllByTestId("generated-day")).toHaveLength(2);
    expect(screen.getByTestId("getting-there")).toHaveTextContent(/from Mumbai/);
    expect(screen.getAllByTestId("stay-option")).toHaveLength(2);
    expect(screen.getByTestId("stays")).toHaveTextContent(/not checked against live availability/i);
    expect(screen.getByTestId("generated-plan").querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /closest ready-made trip: Kyoto/i })).toHaveAttribute("href", "/trips/kyoto");
    expect(container.textContent ?? "").not.toMatch(/gemini|google|powered by/i);
  });

  it("a popular pick fills the destination and moves on to the next step", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow trips={SUMMARIES} />);
    await u.click(screen.getByRole("button", { name: "Kyoto" }));
    expect(screen.getByText(/planning for/i)).toHaveTextContent("Kyoto");
    expect(screen.getByTestId("live-match")).toHaveTextContent("Kyoto");
  });

  it("surprise me picks one of the trips", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow trips={SUMMARIES} />);
    await u.click(screen.getByTestId("surprise"));
    expect(screen.getByTestId("live-match")).toBeInTheDocument();
    expect(SUMMARIES.some((t) => screen.getByText(/planning for/i).textContent?.includes(t.destination))).toBe(true);
  });

  it("previews the best match as interests and budget change", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow trips={SUMMARIES} />);
    await u.click(screen.getByRole("button", { name: /continue/i }));
    await u.click(screen.getByRole("checkbox", { name: /beaches/i }));
    await u.click(screen.getByRole("radio", { name: "₹₹" }));
    const expected = rankTrips({ destination: "", interests: ["beaches"], budgetTier: 2, notes: "" }, SUMMARIES)[0]!.trip;
    expect(screen.getByTestId("live-match")).toHaveTextContent(expected.destination);
  });

  it("the result shows the price, the days at a glance and two other trips", async () => {
    const u = userEvent.setup();
    render(<PlannerFlow trips={SUMMARIES} />);
    const dest = screen.getByLabelText(/where do you want to go/i);
    await u.type(dest, "Goa");
    await u.click(screen.getByRole("button", { name: /continue/i }));
    await u.click(screen.getByTestId("plan-submit"));
    await waitFor(() => screen.getByTestId("plan-result"));
    const goa = TRIPS.find((t) => t.id === "goa")!;
    expect(screen.getByTestId("day-glance").querySelectorAll("li")).toHaveLength(goa.itinerary.length);
    expect(screen.getByText(/^From ₹/)).toBeInTheDocument();
    expect(screen.getAllByTestId("also-consider")).toHaveLength(2);
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
