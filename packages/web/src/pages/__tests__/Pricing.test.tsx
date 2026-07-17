import { screen, fireEvent, within } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Pricing from "../Pricing";

describe("Pricing", () => {
  it("renders athlete + coach tiers with monthly prices by default", () => {
    renderPage(<Pricing />);
    expect(screen.getByText("Premium")).toBeDefined();
    expect(screen.getByText("Premium+")).toBeDefined();
    // Monthly Premium price + suffix.
    expect(screen.getAllByText("12.99").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/mo").length).toBeGreaterThan(0);
    expect(screen.getByText("Individual Trainer")).toBeDefined();
    expect(screen.getByText("Enterprise")).toBeDefined();
  });

  it("switches to annual pricing when the toggle is clicked", () => {
    renderPage(<Pricing />);
    fireEvent.click(screen.getByRole("button", { name: "Annual" }));
    // Premium annual price + /yr suffix + "2 months free" note.
    expect(screen.getAllByText("129.99").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/yr").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 months free/i).length).toBeGreaterThan(0);
  });

  it("keeps AnyGym one word and marks Premium+ as coming soon", () => {
    renderPage(<Pricing />);
    const flagship = screen
      .getByText("Premium+")
      .closest(".plan") as HTMLElement;
    expect(
      within(flagship).getAllByText(/coming soon/i).length,
    ).toBeGreaterThan(0);
    expect(within(flagship).getByText(/AnyGym equipment scan/i)).toBeDefined();
  });

  it("does NOT ship founding / waitlist content", () => {
    const { container } = renderPage(<Pricing />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/waitlist/i);
    expect(text).not.toMatch(/founding/i);
    expect(text).not.toMatch(/92%/);
  });
});
