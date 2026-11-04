// @vitest-environment jsdom
import "../setup-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArchitectureExplorer } from "@/components/architecture/explorer";
import { EDGES, PARTICIPANTS, TOUR } from "@/lib/architecture";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ events: [{ op: "create_checkout", actor: "platform" }, { op: "create_checkout", actor: "platform" }, { op: "create_checkout", actor: "business" }, { op: "get_order", actor: "platform" }] }) })));
});

describe("diagram", () => {
  it("draws all six participants and every message, each a keyboard-operable button", () => {
    render(<ArchitectureExplorer />);
    for (const p of PARTICIPANTS) expect(screen.getByTestId(`node-${p.id}`)).toHaveAttribute("role", "button");
    for (const e of EDGES) expect(screen.getByTestId(`edge-${e.id}`)).toHaveAttribute("tabindex", "0");
  });
  it("labels simulated, real and human participants in their accessible names", () => {
    render(<ArchitectureExplorer />);
    expect(screen.getByTestId("node-cp")).toHaveAttribute("aria-label", expect.stringContaining("simulated"));
    expect(screen.getByTestId("node-merchant")).toHaveAttribute("aria-label", expect.stringContaining("real protocol behavior"));
    expect(screen.getByTestId("node-shopper")).toHaveAttribute("aria-label", expect.stringContaining("you"));
  });
  it("clicking a participant shows what it does and what is real, plus links to pages", async () => {
    render(<ArchitectureExplorer />);
    await userEvent.click(screen.getByTestId("node-cp"));
    const d = screen.getByTestId("node-detail");
    expect(within(d).getByRole("heading", { name: "Credential provider" })).toBeInTheDocument();
    expect(d).toHaveTextContent(/SIMULATED/);
    expect(d).toHaveTextContent("/api/mock-psp/tokenize");
    expect(within(d).getByRole("link", { name: /Payment Simulator/ })).toHaveAttribute("href", "/payments");
  });
  it("the shopper's panel says AP2 is not implemented", async () => {
    render(<ArchitectureExplorer />);
    await userEvent.click(screen.getByTestId("node-shopper"));
    expect(screen.getByTestId("node-detail")).toHaveTextContent(/AP2.*NOT implemented/);
  });
  it("Enter and Space open details; Escape closes them", async () => {
    render(<ArchitectureExplorer />);
    screen.getByTestId("node-merchant").focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("node-detail")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("node-detail")).not.toBeInTheDocument();
    screen.getByTestId("edge-agent-merchant").focus();
    await userEvent.keyboard(" ");
    expect(screen.getByTestId("edge-detail")).toBeInTheDocument();
  });
  it("clicking a message shows its operations with how often THIS session did them, linking into the inspector", async () => {
    render(<ArchitectureExplorer />);
    await userEvent.click(screen.getByTestId("edge-agent-merchant"));
    const d = screen.getByTestId("edge-detail");
    await waitFor(() => expect(within(d).getByRole("link", { name: /create_checkout/ })).toHaveTextContent("×2")); // only platform-side requests are counted
    expect(within(d).getByRole("link", { name: /create_checkout/ })).toHaveAttribute("href", "/inspector?op=create_checkout");
    expect(within(d).getByRole("link", { name: /get_order/ })).toHaveTextContent("×1");
    expect(within(d).getByRole("link", { name: /cancel_checkout/ })).toHaveTextContent("×0");
    expect(d).toHaveTextContent("checkout/rest.md");
  });
  it("still works when the inspector has no data or is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<ArchitectureExplorer />);
    await userEvent.click(screen.getByTestId("edge-agent-merchant"));
    expect(within(screen.getByTestId("edge-detail")).getAllByText(/×0/).length).toBeGreaterThan(0);
  });
  it("the participant and message lists open the same details (the small-screen path)", async () => {
    render(<ArchitectureExplorer />);
    await userEvent.click(screen.getByTestId("list-edge-orders-agent"));
    expect(screen.getByTestId("edge-detail")).toHaveTextContent(/signed webhooks/i);
    await userEvent.click(screen.getByTestId("list-node-psp"));
    expect(screen.getByTestId("node-detail")).toHaveTextContent("Payment service provider");
  });
  it("the close button clears the selection", async () => {
    render(<ArchitectureExplorer />);
    await userEvent.click(screen.getByTestId("node-agent"));
    await userEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByTestId("node-detail")).not.toBeInTheDocument();
  });
});

describe("guided tour", () => {
  it("starts on step 1, highlights only that step's participants and message, and dims the rest", async () => {
    render(<ArchitectureExplorer />);
    expect(screen.queryByTestId("tour-card")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("start-tour"));
    expect(screen.getByTestId("tour-title")).toHaveTextContent(TOUR[0]!.title);
    expect(screen.getByTestId("node-agent")).toHaveAttribute("data-active");
    expect(screen.getByTestId("node-merchant")).toHaveAttribute("data-active");
    expect(screen.getByTestId("node-cp")).not.toHaveAttribute("data-active");
    expect(screen.getByTestId("node-cp")).toHaveClass("opacity-30");
    expect(document.querySelector('[data-edge="agent-merchant"]')).toHaveAttribute("data-active");
  });
  it("steps forward and back through all twelve steps, with Back disabled at the start and Next at the end", async () => {
    render(<ArchitectureExplorer startTour />);
    expect(screen.getByTestId("tour-prev")).toBeDisabled();
    for (let i = 1; i < TOUR.length; i++) {
      await userEvent.click(screen.getByTestId("tour-next"));
      expect(screen.getByTestId("tour-title")).toHaveTextContent(TOUR[i]!.title);
    }
    expect(screen.getByTestId("tour-next")).toBeDisabled();
    expect(screen.getByTestId("tour-card")).toHaveTextContent(`step ${TOUR.length} of ${TOUR.length}`);
    await userEvent.click(screen.getByTestId("tour-prev"));
    expect(screen.getByTestId("tour-title")).toHaveTextContent(TOUR[TOUR.length - 2]!.title);
  });
  it("each step links to the place where you can run it for real", async () => {
    render(<ArchitectureExplorer startTour />);
    expect(within(screen.getByTestId("tour-card")).getByRole("link", { name: TOUR[0]!.tryIt.label })).toHaveAttribute("href", TOUR[0]!.tryIt.href);
    await userEvent.click(screen.getByTestId("tour-next"));
    await userEvent.click(screen.getByTestId("tour-next"));
    await userEvent.click(screen.getByTestId("tour-next"));
    expect(within(screen.getByTestId("tour-card")).getByRole("link")).toHaveAttribute("href", TOUR[3]!.tryIt.href);
  });
  it("auto-play advances every six seconds and stops at the last step", () => {
    vi.useFakeTimers();
    render(<ArchitectureExplorer startTour />);
    fireEvent.click(screen.getByTestId("tour-play"));
    expect(screen.getByTestId("tour-play")).toHaveTextContent("Pause");
    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.getByTestId("tour-title")).toHaveTextContent(TOUR[1]!.title);
    act(() => void vi.advanceTimersByTime(6000 * (TOUR.length + 3)));
    expect(screen.getByTestId("tour-title")).toHaveTextContent(TOUR[TOUR.length - 1]!.title);
    expect(screen.getByTestId("tour-play")).toHaveTextContent("Auto-play"); // stopped by itself
  });
  it("pausing stops auto-play", () => {
    vi.useFakeTimers();
    render(<ArchitectureExplorer startTour />);
    fireEvent.click(screen.getByTestId("tour-play"));
    fireEvent.click(screen.getByTestId("tour-play"));
    act(() => void vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId("tour-title")).toHaveTextContent(TOUR[0]!.title);
  });
  it("ending the tour removes the highlighting", async () => {
    render(<ArchitectureExplorer startTour />);
    await userEvent.click(screen.getByTestId("stop-tour"));
    expect(screen.queryByTestId("tour-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("node-cp")).not.toHaveClass("opacity-30");
  });
  it("selecting something while touring is allowed and does not break the tour", async () => {
    render(<ArchitectureExplorer startTour />);
    await userEvent.click(screen.getByTestId("node-psp"));
    expect(screen.getByTestId("node-detail")).toBeInTheDocument();
    expect(screen.getByTestId("tour-card")).toBeInTheDocument();
  });
});
