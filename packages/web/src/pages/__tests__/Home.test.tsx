import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Home from "../Home";

describe("Home", () => {
  it("renders the hero and core sections", () => {
    renderPage(<Home />);
    expect(screen.getByText("Track everything.")).toBeDefined();
    expect(screen.getByText("One loop.")).toBeDefined();
    expect(screen.getByText("Same programme.")).toBeDefined();
    // AnyGym is always one word.
    expect(screen.queryByText(/any gym\.?\s+premium/i)).toBeNull();
  });

  it("shows the App Store CTA as a non-linking 'coming soon' state", () => {
    renderPage(<Home />);
    const cta = screen.getByText("Coming to the App Store");
    expect(cta).toBeDefined();
    expect(cta.closest("a")).toBeNull();
  });

  it("does NOT ship the excluded waitlist / founding content", () => {
    const { container } = renderPage(<Home />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/waitlist/i);
    expect(text).not.toMatch(/founding/i);
    expect(text).not.toMatch(/92%/);
    expect(text).not.toMatch(/early access/i);
    expect(container.querySelector("form")).toBeNull();
  });
});
