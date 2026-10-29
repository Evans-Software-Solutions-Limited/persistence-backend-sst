import { act, fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { ConsentBanner, CONSENT_REOPEN_EVENT } from "../ConsentBanner";
import { hasConsent, isConsentDecided, setConsent } from "@/lib/consent";

const BANNER = /optional cookies to measure whether our ads/;

describe("ConsentBanner", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders on first visit (undecided)", () => {
    renderPage(<ConsentBanner />);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage" })).toBeTruthy();
  });

  it("does not render once a choice has been made", () => {
    setConsent({ advertising: true });
    renderPage(<ConsentBanner />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Accept all grants advertising and dismisses the banner", () => {
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    expect(isConsentDecided()).toBe(true);
    expect(hasConsent("advertising")).toBe(true);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Reject all denies advertising (still a decision) and dismisses", () => {
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(isConsentDecided()).toBe(true);
    expect(hasConsent("advertising")).toBe(false);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Manage reveals per-category toggles; the advertising toggle is off by default", () => {
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    const advertising = screen.getByRole("checkbox", { name: /Advertising/i });
    expect((advertising as HTMLInputElement).checked).toBe(false);
    // "Strictly necessary" is shown as always-on, not a toggle.
    expect(screen.getByText("Always on")).toBeTruthy();
    expect(screen.getByText("Strictly necessary")).toBeTruthy();
  });

  it("Manage → tick Advertising → Save persists just that category", () => {
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Advertising/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
    expect(hasConsent("advertising")).toBe(true);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Accept all / Reject all are equal-weight native buttons", () => {
    renderPage(<ConsentBanner />);
    const accept = screen.getByRole("button", { name: "Accept all" });
    const reject = screen.getByRole("button", { name: "Reject all" });
    expect(accept.tagName).toBe("BUTTON");
    expect(reject.tagName).toBe("BUTTON");
    // Same styling class ⇒ equal prominence (no dark-pattern emphasis).
    expect(accept.className).toBe(reject.className);
  });

  it("re-opens on the consent-reopen event so a prior choice can be changed", () => {
    setConsent({ advertising: false });
    renderPage(<ConsentBanner />);
    expect(screen.queryByText(BANNER)).toBeNull();
    act(() => {
      window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT));
    });
    expect(screen.getByText(BANNER)).toBeTruthy();
  });
});
