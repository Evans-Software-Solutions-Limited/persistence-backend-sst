import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Support from "../Support";

describe("Support", () => {
  it("renders the contact address and common questions", () => {
    renderPage(<Support />);
    expect(
      screen.getAllByText("admin@evans-software-solutions.com").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/How do I cancel my subscription\?/i),
    ).toBeDefined();
    expect(screen.getByText(/How do I delete my account\?/i)).toBeDefined();
  });

  it("links account deletion detail to the privacy policy", () => {
    renderPage(<Support />);
    const privacyLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/privacy");
    expect(privacyLinks.length).toBeGreaterThan(0);
  });

  it("exposes a mailto contact link", () => {
    renderPage(<Support />);
    const mailtos = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("mailto:"));
    expect(mailtos.length).toBeGreaterThan(0);
  });
});
