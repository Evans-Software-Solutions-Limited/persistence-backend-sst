import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { renderPage } from "@/test-utils";
import { MarketingFooter } from "@/marketing/MarketingFooter";
import App from "@/App";
import DeleteAccount from "../DeleteAccount";
import Support from "../Support";

describe("DeleteAccount", () => {
  it("renders the public account-deletion instructions", () => {
    renderPage(<DeleteAccount />);

    expect(
      screen.getByRole("heading", { name: "Delete your account" }),
    ).toBeTruthy();
    expect(screen.getByText(/permanent deletion 30 days later/)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "If you cannot sign in" }),
    ).toBeTruthy();
  });

  it("provides the email route for users who cannot sign in", () => {
    renderPage(<DeleteAccount />);

    expect(
      screen
        .getByRole("link", {
          name: "admin@evans-software-solutions.com",
        })
        .getAttribute("href"),
    ).toBe("mailto:admin@evans-software-solutions.com");
  });

  it("links to the privacy policy for deletion details", () => {
    renderPage(<DeleteAccount />);

    expect(
      screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href"),
    ).toBe("/privacy");
  });

  it("is registered at the public account-deletion URL", () => {
    render(
      <MemoryRouter initialEntries={["/delete-account"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Delete your account" }),
    ).toBeTruthy();
  });

  it("is discoverable from the deletion FAQ and marketing footer", () => {
    const { unmount } = renderPage(<Support />);
    const faqHeading = screen.getByRole("heading", {
      name: "How do I delete my account?",
    });
    const faqItem = faqHeading.closest(".faq-item");
    expect(faqItem).not.toBeNull();
    expect(
      within(faqItem as HTMLElement)
        .getByRole("link", { name: "Delete account page" })
        .getAttribute("href"),
    ).toBe("/delete-account");

    unmount();
    renderPage(<MarketingFooter />);
    expect(
      screen.getByRole("link", { name: "Delete account" }).getAttribute("href"),
    ).toBe("/delete-account");
  });
});
