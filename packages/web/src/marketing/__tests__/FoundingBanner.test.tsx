import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { FoundingBanner } from "../FoundingBanner";
import { FOUNDING_OFFER_CLOSES } from "../foundingOffer";

const banner = () => screen.queryByRole("region", { name: "Founding offer" });

describe("FoundingBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("points at the offer from an ordinary marketing page", () => {
    renderPage(<FoundingBanner />, { route: "/" });
    expect(banner()).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /see the plans/i }).getAttribute("href"),
    ).toBe("/founding");
  });

  it("stays off /founding, which it would only advertise to itself", () => {
    renderPage(<FoundingBanner />, { route: "/founding" });
    expect(banner()).toBeNull();
  });

  it("stays off the thanks page too", () => {
    renderPage(<FoundingBanner />, { route: "/founding/thanks" });
    expect(banner()).toBeNull();
  });

  it("disappears on its own after the close date, with no deploy", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FOUNDING_OFFER_CLOSES.getTime() + 1000));
    renderPage(<FoundingBanner />, { route: "/" });
    expect(banner()).toBeNull();
  });

  it("is dismissible, and stays dismissed on the next visit", () => {
    renderPage(<FoundingBanner />, { route: "/" });
    fireEvent.click(
      screen.getByRole("button", { name: /dismiss the founding offer/i }),
    );
    expect(banner()).toBeNull();

    renderPage(<FoundingBanner />, { route: "/" });
    expect(banner()).toBeNull();
  });

  describe("the room it reserves", () => {
    /**
     * The nav is fixed at `top: var(--m-topbar-h, 0px)` and `.mkt` carries the
     * matching padding, so this variable is the whole of what keeps the strip
     * and the nav out of one another's band.
     */
    const topbar = () =>
      document.documentElement.style.getPropertyValue("--m-topbar-h");

    it("reserves its own height, and gives the room back when dismissed", () => {
      const height = vi
        .spyOn(HTMLElement.prototype, "offsetHeight", "get")
        .mockReturnValue(44);
      renderPage(<FoundingBanner />, { route: "/" });
      expect(topbar()).toBe("44px");

      fireEvent.click(
        screen.getByRole("button", { name: /dismiss the founding offer/i }),
      );
      expect(topbar()).toBe("");
      height.mockRestore();
    });

    it("reserves nothing on the page it points at", () => {
      renderPage(<FoundingBanner />, { route: "/founding" });
      expect(topbar()).toBe("");
    });

    it("re-measures when the strip changes height", () => {
      // Copy wraps to a second line on a narrow viewport and shifts again when
      // the display font swaps in, so a height read once at mount goes stale.
      let notify: (() => void) | undefined;
      const observe = vi.fn();
      const disconnect = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(cb: () => void) {
            notify = cb;
          }
          observe = observe;
          disconnect = disconnect;
        },
      );
      const height = vi
        .spyOn(HTMLElement.prototype, "offsetHeight", "get")
        .mockReturnValue(44);

      renderPage(<FoundingBanner />, { route: "/" });
      expect(observe).toHaveBeenCalledTimes(1);
      expect(topbar()).toBe("44px");

      height.mockReturnValue(72);
      notify?.();
      expect(topbar()).toBe("72px");

      height.mockRestore();
      vi.unstubAllGlobals();
    });
  });

  it("still renders when the browser refuses storage", () => {
    // A locked-down browser should lose the dismissal, not the page.
    // Scoped to this banner's own key: the theme provider above it uses
    // localStorage too, and breaking that would test the harness, not this.
    const blocked = (key: string) => {
      if (key.startsWith("persistence.founding")) throw new Error("blocked");
      return null;
    };
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(blocked);
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((key) => {
        blocked(key);
      });
    renderPage(<FoundingBanner />, { route: "/" });
    expect(banner()).not.toBeNull();
    expect(() =>
      fireEvent.click(
        screen.getByRole("button", { name: /dismiss the founding offer/i }),
      ),
    ).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
