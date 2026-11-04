// @vitest-environment jsdom
import "../setup-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DashboardError from "@/app/(dashboard)/error";
import Loading from "@/app/(dashboard)/loading";
import DashboardNotFound from "@/app/(dashboard)/not-found";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

describe("loading, error and not-found states", () => {
  it("the error boundary explains, offers retry, and never shows a stack trace or the raw message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reset = vi.fn();
    const err = Object.assign(new Error("secret internal detail: db password"), { digest: "abc123", stack: "Error: x\n    at secret.ts:1" });
    render(<DashboardError error={err} reset={reset} />);
    const box = screen.getByRole("alert");
    expect(box).toHaveTextContent(/unexpected error/i);
    expect(box).toHaveTextContent("reference abc123");
    expect(box.textContent).not.toMatch(/secret|stack|password/);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/");
  });
  it("the loading state is announced to assistive technology", () => {
    render(<Loading />);
    expect(screen.getByRole("status", { name: "Loading page" })).toBeInTheDocument();
  });
  it("not-found points somewhere useful", () => {
    render(<DashboardNotFound />);
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute("href", "/docs");
  });
});
