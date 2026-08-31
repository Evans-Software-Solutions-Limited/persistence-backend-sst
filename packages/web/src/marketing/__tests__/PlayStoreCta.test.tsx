import { fireEvent, render, screen } from "@testing-library/react";
import * as storeClick from "@/lib/storeClick";
import { PlayStoreCta } from "../PlayStoreCta";

vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>(
    "../config",
  );
  return { ...actual, playStoreUrl: vi.fn(() => null) };
});

import { playStoreUrl } from "../config";

describe("PlayStoreCta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(playStoreUrl).mockReturnValue(null);
  });

  it.each(["hero", "store"] as const)(
    "renders plain disabled copy when the listing is unavailable for variant=%s",
    (variant) => {
      const { container } = render(<PlayStoreCta variant={variant} />);

      expect(container.querySelector("a")).toBeNull();
      expect(container.querySelector("span[aria-disabled='true']")).not.toBeNull();
      expect(container.querySelector("img, svg")).toBeNull();
    },
  );

  it.each(["hero", "store"] as const)(
    "uses Google's official badge as the live link for variant=%s",
    (variant) => {
      vi.mocked(playStoreUrl).mockReturnValue(
        "https://play.google.com/store/apps/details?id=com.example.app",
      );
      render(<PlayStoreCta variant={variant} />);

      const link = screen.getByRole("link", { name: "Get it on Google Play" });
      expect(link.getAttribute("href")).toContain("id=com.example.app");
      expect(link.querySelector("img")?.getAttribute("src")).toBe(
        "/google-play-badge.svg",
      );
      expect(link.querySelector("svg")).toBeNull();
    },
  );

  it("reports Android attribution without blocking the store link", () => {
    vi.mocked(playStoreUrl).mockReturnValue(
      "https://play.google.com/store/apps/details?id=com.example.app",
    );
    const reportStoreClick = vi
      .spyOn(storeClick, "reportStoreClick")
      .mockReturnValue("evt_1");
    render(<PlayStoreCta variant="hero" />);

    fireEvent.click(screen.getByRole("link", { name: "Get it on Google Play" }));
    expect(reportStoreClick).toHaveBeenCalledWith("android");
  });
});
