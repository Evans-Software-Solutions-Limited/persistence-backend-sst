import { render, screen, fireEvent } from "@testing-library/react";
import { AppStoreCta } from "../AppStoreCta";
import * as storeClick from "@/lib/storeClick";

vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>(
    "../config",
  );
  return { ...actual, appStoreUrl: vi.fn(() => null) };
});

import { appStoreUrl } from "../config";

describe("AppStoreCta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(appStoreUrl).mockReturnValue(null);
  });

  describe("when the store isn't live (appStoreUrl returns null)", () => {
    it.each(["hero", "store", "nav"] as const)(
      "renders a disabled span, not a link, for variant=%s",
      (variant) => {
        const { container } = render(<AppStoreCta variant={variant} />);
        expect(container.querySelector("a")).toBeNull();
        const span = container.querySelector("span[aria-disabled='true']");
        expect(span).not.toBeNull();
      },
    );

    it("does not call reportStoreClick when clicked", () => {
      const spy = vi.spyOn(storeClick, "reportStoreClick");
      const { container } = render(<AppStoreCta variant="hero" />);
      fireEvent.click(container.querySelector("span")!);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("when the store is live (appStoreUrl returns a URL)", () => {
    beforeEach(() => {
      vi.mocked(appStoreUrl).mockReturnValue("https://apps.apple.com/app/id123");
    });

    it.each(["hero", "store", "nav"] as const)(
      "renders an <a href> for variant=%s",
      (variant) => {
        render(<AppStoreCta variant={variant} />);
        const link = screen.getByRole("link");
        expect(link.getAttribute("href")).toBe(
          "https://apps.apple.com/app/id123",
        );
      },
    );

    it("calls reportStoreClick on click without preventing navigation", () => {
      const spy = vi
        .spyOn(storeClick, "reportStoreClick")
        .mockReturnValue("evt_1");
      render(<AppStoreCta variant="hero" />);
      const link = screen.getByRole("link");
      fireEvent.click(link);
      expect(spy).toHaveBeenCalledWith("ios");
    });
  });
});
