import { act, fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { ConsentBanner, CONSENT_REOPEN_EVENT } from "../ConsentBanner";
import { hasConsent, isConsentDecided, setConsent } from "@/lib/consent";
import * as tradedoubler from "@/lib/tradedoubler";

const BANNER = /optional cookies to measure whether our ads/;

describe("ConsentBanner", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders on first visit (undecided)", () => {
    renderPage(<ConsentBanner />);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage" })).toBeTruthy();
  });

  it("does not render once a choice has been made", () => {
    setConsent({ advertising: true, affiliate: true });
    renderPage(<ConsentBanner />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Accept all grants BOTH categories and dismisses the banner", () => {
    const capture = vi.spyOn(tradedoubler, "captureTduid");
    const init = vi.spyOn(tradedoubler, "initTradedoubler");
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    expect(isConsentDecided()).toBe(true);
    expect(hasConsent("advertising")).toBe(true);
    expect(hasConsent("affiliate")).toBe(true);
    // The affiliate click id is kept and the tag loaded the moment consent
    // lands, not on the next page.
    expect(capture).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Reject all denies BOTH categories (still a decision) and dismisses", () => {
    const teardown = vi.spyOn(tradedoubler, "teardownTradedoubler");
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(isConsentDecided()).toBe(true);
    expect(hasConsent("advertising")).toBe(false);
    expect(hasConsent("affiliate")).toBe(false);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Manage reveals per-category toggles; the advertising toggle is off by default", () => {
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    const advertising = screen.getByRole("checkbox", { name: /Advertising/i });
    expect((advertising as HTMLInputElement).checked).toBe(false);
    const affiliate = screen.getByRole("checkbox", {
      name: /Affiliate measurement/i,
    });
    expect((affiliate as HTMLInputElement).checked).toBe(false);
    expect(
      screen.getByText(/Blue Light Card and our affiliate network/),
    ).toBeTruthy();
    expect(screen.getByText(/\(Tradedoubler\)/)).toBeTruthy();
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
    expect(hasConsent("affiliate")).toBe(false);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("Manage → tick Affiliate measurement → Save persists just that category", () => {
    const init = vi.spyOn(tradedoubler, "initTradedoubler");
    renderPage(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Affiliate measurement/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
    expect(hasConsent("affiliate")).toBe(true);
    expect(hasConsent("advertising")).toBe(false);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("re-seeds the affiliate toggle from the stored choice on re-open", () => {
    setConsent({ advertising: false, affiliate: true });
    renderPage(<ConsentBanner />);
    act(() => {
      window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT));
    });
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    const affiliate = screen.getByRole("checkbox", {
      name: /Affiliate measurement/i,
    });
    expect((affiliate as HTMLInputElement).checked).toBe(true);
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
    setConsent({ advertising: false, affiliate: false });
    renderPage(<ConsentBanner />);
    expect(screen.queryByText(BANNER)).toBeNull();
    act(() => {
      window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT));
    });
    expect(screen.getByText(BANNER)).toBeTruthy();
  });
});
