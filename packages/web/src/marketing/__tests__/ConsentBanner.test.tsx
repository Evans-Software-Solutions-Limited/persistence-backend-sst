import { act, fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { ConsentBanner, CONSENT_REOPEN_EVENT } from "../ConsentBanner";
import { getConsent, setConsent } from "@/lib/consent";

const BANNER = /one Meta \(Facebook\) cookie/;

describe("ConsentBanner", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders on first visit (consent unset)", () => {
    renderPage(<ConsentBanner />);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("does not render once a choice has been made", () => {
    setConsent("granted");
    renderPage(<ConsentBanner />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Accept persists granted and dismisses the banner", () => {
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(getConsent()).toBe("granted");
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Reject persists denied and dismisses the banner", () => {
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(getConsent()).toBe("denied");
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("exposes both choices as native buttons, Reject before Accept in DOM order", () => {
    renderPage(<ConsentBanner />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Reject", "Accept"]);
    // native <button> ⇒ keyboard-reachable / tabbable by default
    buttons.forEach((b) => expect(b.tagName).toBe("BUTTON"));
  });

  it("re-opens on the consent-reopen event so a prior choice can be changed", () => {
    setConsent("denied");
    renderPage(<ConsentBanner />);
    expect(screen.queryByText(BANNER)).toBeNull();
    act(() => {
      window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT));
    });
    expect(screen.getByText(BANNER)).toBeTruthy();
  });
});
