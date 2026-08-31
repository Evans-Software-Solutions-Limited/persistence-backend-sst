import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { AppBanner } from "../AppBanner";
import { appStore, playStore } from "../config";

const STORAGE_KEY = "mkt.appBanner.dismissed";

/** Captured before any test mutates the shared config module. */
const SHIPPED = { appStore: { ...appStore }, playStore: { ...playStore } };

describe("AppBanner", () => {
  afterEach(() => {
    Object.assign(appStore, SHIPPED.appStore);
    Object.assign(playStore, SHIPPED.playStore);
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders nothing when neither store is live", () => {
    appStore.available = false;
    appStore.url = null;
    playStore.available = false;
    playStore.url = null;
    renderPage(<AppBanner />);
    expect(
      screen.queryByRole("region", { name: /Get the Persistence app/i }),
    ).toBeNull();
  });

  it("renders when the store is live and not previously dismissed", () => {
    appStore.available = true;
    appStore.url = "https://apps.apple.com/app/apple-store/id6755091280";
    renderPage(<AppBanner />);
    expect(
      screen.getByRole("region", { name: /Get the Persistence app/i }),
    ).toBeTruthy();
    expect(screen.getByText("Persistence")).toBeTruthy();
    expect(
      screen.getByText(/Coach & Train — now on iPhone and Android/),
    ).toBeTruthy();
  });

  it("renders nothing when previously dismissed", () => {
    appStore.available = true;
    appStore.url = "https://apps.apple.com/app/apple-store/id6755091280";
    window.localStorage.setItem(STORAGE_KEY, "1");
    renderPage(<AppBanner />);
    expect(
      screen.queryByRole("region", { name: /Get the Persistence app/i }),
    ).toBeNull();
  });

  it("dismiss button hides the banner and persists the dismissal", () => {
    appStore.available = true;
    appStore.url = "https://apps.apple.com/app/apple-store/id6755091280";
    renderPage(<AppBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.queryByRole("region", { name: /Get the Persistence app/i }),
    ).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("CTA takes visitors to the cross-platform download section", () => {
    appStore.available = true;
    appStore.url = "https://apps.apple.com/app/apple-store/id6755091280";
    renderPage(<AppBanner />);
    const link = screen.getByRole("link", { name: "Get" });
    expect(link.getAttribute("href")).toBe("/#download");
  });

  it("keeps campaign visitors on the attributed route", () => {
    appStore.available = true;
    appStore.url = "https://apps.apple.com/app/apple-store/id6755091280";
    renderPage(<AppBanner />, { route: "/flyer" });
    expect(screen.getByRole("link", { name: "Get" }).getAttribute("href")).toBe(
      "/flyer#download",
    );
  });
});
