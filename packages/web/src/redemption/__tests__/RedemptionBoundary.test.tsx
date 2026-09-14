import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RedemptionBoundary } from "../RedemptionBoundary";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows sensitive inputs directly in a clean document", () => {
  render(
    <RedemptionBoundary>
      <input aria-label="Private voucher" />
    </RedemptionBoundary>,
  );
  expect(screen.getByLabelText("Private voucher")).toBeTruthy();
});
it("never mounts sensitive inputs in a document with an already-loaded pixel", () => {
  const reload = vi.fn();
  const original = window;
  vi.stubGlobal("window", {
    ...original,
    fbq: vi.fn(),
    location: { href: "https://example.com/redeem#private", replace: reload },
  });
  render(
    <RedemptionBoundary>
      <input aria-label="Private voucher" />
    </RedemptionBoundary>,
  );
  expect(screen.queryByLabelText("Private voucher")).toBeNull();
  expect(screen.getByText("Opening secure redemption…")).toBeTruthy();
  expect(reload).toHaveBeenCalledWith("https://example.com/redeem#private");
});
