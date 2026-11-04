// @vitest-environment jsdom
import "../setup-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmationCard } from "@/components/checkout/confirmation-card";
import * as api from "@/lib/api";

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ucp: vi.fn(), post: vi.fn() }));

const CARDS = [{ id: "visa_ok", label: "Visa · always approved" }, { id: "mc_ok", label: "Mastercard · always approved" }, { id: "visa_declined", label: "Visa · always declined" }];
const checkout = (over: Record<string, unknown> = {}) => ({
  id: "chk_1",
  status: "ready_for_complete",
  currency: "INR",
  line_items: [{ id: "li_1", quantity: 2, item: { id: "var_x", title: "Aurora ANC Headphones" } }],
  totals: [{ type: "subtotal", amount: 899800 }, { type: "items_discount", amount: -89980 }, { type: "fulfillment", amount: 9900 }, { type: "tax", amount: 145767 }, { type: "total", amount: 965487 }],
  fulfillment: { methods: [{ selected_destination_id: "dest_1", destinations: [{ id: "dest_1", street_address: "12 MG Road", address_locality: "Bengaluru", postal_code: "560001" }], groups: [{ selected_option_id: "standard", options: [{ id: "standard", title: "Standard Delivery" }] }] }] },
  ...over,
});
const mockLive = (c = checkout()) => vi.mocked(api.ucp).mockResolvedValue({ body: c } as never);
const props = (over: Partial<React.ComponentProps<typeof ConfirmationCard>> = {}) => ({ checkoutId: "chk_1", expectedTotal: 965487, cards: CARDS, onDone: vi.fn(), ...over });

beforeEach(() => {
  vi.mocked(api.ucp).mockReset();
  vi.mocked(api.post).mockReset();
});

describe("trusted confirmation card", () => {
  it("re-reads the checkout from the merchant and shows everything the buyer is paying for", async () => {
    mockLive();
    render(<ConfirmationCard {...props()} />);
    expect(await screen.findByText(/2 × Aurora ANC Headphones/)).toBeInTheDocument();
    expect(api.ucp).toHaveBeenCalledWith("get_checkout", { id: "chk_1" });
    expect(screen.getByText("₹8,998.00")).toBeInTheDocument(); // subtotal
    expect(screen.getByText("−₹899.80")).toBeInTheDocument(); // discounts
    expect(screen.getByText(/Shipping \(Standard Delivery\)/)).toBeInTheDocument();
    expect(screen.getByTestId("confirm-total")).toHaveTextContent("₹9,654.87");
    expect(screen.getByText(/Deliver to: 12 MG Road, Bengaluru, 560001/)).toBeInTheDocument();
    expect(screen.getByText(/simulated/i, { selector: "strong" })).toBeInTheDocument();
  });
  it("cannot be clicked before the live checkout is loaded", () => {
    vi.mocked(api.ucp).mockReturnValue(new Promise(() => undefined) as never);
    render(<ConfirmationCard {...props()} />);
    expect(screen.getByTestId("authorize")).toBeDisabled();
  });
  it("authorizes exactly the total it displays, with the chosen card, and reports the real exchanges", async () => {
    mockLive();
    const onDone = vi.fn();
    vi.mocked(api.post).mockResolvedValue({ consentExchange: { id: "c" }, tokenize: { exchange: { id: "t" } }, complete: { exchange: { id: "x" }, body: { status: "completed" } } });
    render(<ConfirmationCard {...props({ onDone })} />);
    await screen.findByText(/Aurora/);
    await userEvent.selectOptions(screen.getByLabelText("Payment method"), "mc_ok");
    await userEvent.click(screen.getByTestId("authorize"));
    expect(api.post).toHaveBeenCalledWith("/api/playground/checkout/authorize", { checkoutId: "chk_1", cardId: "mc_ok", expectedTotal: 965487 });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledWith({ cardId: "mc_ok", exchanges: [{ id: "c" }, { id: "t" }, { id: "x" }], completeStatus: "completed" });
  });
  it("the button names the amount and the card, so the click is informed", async () => {
    mockLive();
    render(<ConfirmationCard {...props()} />);
    const b = await screen.findByRole("button", { name: /I authorize this purchase of ₹9,654.87 with Visa/ });
    expect(b).toBeEnabled();
  });
  it("if the total changed since it was presented, it warns and authorizes the amount SHOWN, never the stale one", async () => {
    mockLive(checkout({ totals: [{ type: "subtotal", amount: 1 }, { type: "total", amount: 777700 }] }));
    vi.mocked(api.post).mockResolvedValue({ consentExchange: {}, tokenize: { exchange: {} }, complete: null });
    render(<ConfirmationCard {...props({ expectedTotal: 965487 })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/total changed to ₹7,777.00 .*₹9,654.87/);
    await userEvent.click(screen.getByTestId("authorize"));
    expect(api.post).toHaveBeenCalledWith("/api/playground/checkout/authorize", expect.objectContaining({ expectedTotal: 777700 }));
  });
  it("is disabled unless the merchant says ready_for_complete", async () => {
    mockLive(checkout({ status: "incomplete" }));
    render(<ConfirmationCard {...props()} />);
    await screen.findByText(/Aurora/);
    expect(screen.getByTestId("authorize")).toBeDisabled();
  });
  it("marks the card that just failed and shows the instruction", async () => {
    mockLive();
    render(<ConfirmationCard {...props({ failedCardId: "visa_declined", defaultCardId: "mc_ok", instruction: "Choose an approved card." })} />);
    await screen.findByText(/Aurora/);
    expect(screen.getByRole("option", { name: /always declined \(just failed\)/ })).toBeInTheDocument();
    expect(screen.getByText("Choose an approved card.")).toBeInTheDocument();
    expect(screen.getByLabelText("Payment method")).toHaveValue("mc_ok");
  });
  it("shows the server's refusal and does not report success", async () => {
    mockLive();
    const onDone = vi.fn();
    vi.mocked(api.post).mockRejectedValue(new api.BffError({ kind: "consent", code: "mismatch", message: "The total changed from what you were shown" }, 403));
    render(<ConfirmationCard {...props({ onDone })} />);
    await screen.findByText(/Aurora/);
    await userEvent.click(screen.getByTestId("authorize"));
    expect(await screen.findByRole("alert")).toHaveTextContent("mismatch: The total changed from what you were shown");
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId("authorize")).toBeEnabled(); // can try again
  });
  it("cannot be double-submitted while a request is in flight", async () => {
    mockLive();
    let release!: (v: unknown) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((r) => (release = r)) as never);
    render(<ConfirmationCard {...props()} />);
    await screen.findByText(/Aurora/);
    const btn = screen.getByTestId("authorize");
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    release({ consentExchange: {}, tokenize: { exchange: {} }, complete: null });
  });
  it("shows a loading failure instead of a blank card", async () => {
    vi.mocked(api.ucp).mockRejectedValue(new api.BffError({ kind: "checkout_unavailable", message: "Get Checkout returned HTTP 404" }, 409));
    render(<ConfirmationCard {...props()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Get Checkout returned HTTP 404");
    expect(screen.getByTestId("authorize")).toBeDisabled();
  });
});
