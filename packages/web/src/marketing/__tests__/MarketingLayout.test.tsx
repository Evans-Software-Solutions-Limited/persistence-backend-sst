import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { MarketingLayout } from "../MarketingLayout";
import { REFERRAL_STORAGE_KEY } from "../referral";

describe("MarketingLayout referral capture", () => {
  afterEach(() => window.sessionStorage.clear());

  it("normalises a valid ref, stores it and renders a dismissible banner", async () => {
    renderPage(
      <MarketingLayout>
        <p>Page</p>
      </MarketingLayout>,
      { route: "/pricing?ref= ab-cd-12 " },
    );

    expect((await screen.findByRole("status")).textContent).toContain(
      "Referral code ABCD12 noted — enter it in the app after you sign up.",
    );
    expect(window.sessionStorage.getItem(REFERRAL_STORAGE_KEY)).toBe("ABCD12");

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss referral code notice" }),
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(window.sessionStorage.getItem(REFERRAL_STORAGE_KEY)).toBe("ABCD12");
  });

  it("does not persist or render an invalid ref", () => {
    renderPage(
      <MarketingLayout>
        <p>Page</p>
      </MarketingLayout>,
      { route: "/support?ref=bad!" },
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(window.sessionStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });

  it("renders a previously captured ref on the next marketing route", () => {
    window.sessionStorage.setItem(REFERRAL_STORAGE_KEY, "EVENT24");

    renderPage(
      <MarketingLayout>
        <p>Page</p>
      </MarketingLayout>,
      { route: "/terms" },
    );

    expect(screen.getByRole("status").textContent).toContain("EVENT24");
  });

  it("scrolls a marketing hash target into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderPage(
      <MarketingLayout>
        <p id="details">Details</p>
      </MarketingLayout>,
      { route: "/pricing#details" },
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });
});
