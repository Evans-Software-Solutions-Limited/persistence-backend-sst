import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderPage } from "@/test-utils";
import AuthCallback from "../AuthCallback";

/** Point the browser fragment at a value, render, then restore it. */
function withHash(hash: string, run: () => void) {
  const original = window.location.hash;
  window.location.hash = hash;
  try {
    run();
  } finally {
    window.location.hash = original;
  }
}

describe("AuthCallback", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  afterEach(() => {
    window.location.hash = "";
    document.head.querySelector('meta[name="robots"]')?.remove();
  });

  it("shows the confirmation and a deep link carrying the fragment", () => {
    withHash("#access_token=abc123&refresh_token=def456&type=signup", () => {
      renderPage(<AuthCallback />);
      expect(screen.getByText(/Email confirmed/i)).toBeDefined();
      const open = screen
        .getAllByRole("link")
        .find((a) => a.textContent === "Open the app");
      expect(open?.getAttribute("href")).toBe(
        "persistencemobile://auth/callback#access_token=abc123&refresh_token=def456&type=signup",
      );
    });
  });

  it("surfaces an error fragment instead of a false confirmation", () => {
    withHash(
      "#error=access_denied&error_description=Email+link+is+invalid",
      () => {
        renderPage(<AuthCallback />);
        expect(screen.getByText(/Link didn't work/i)).toBeDefined();
        expect(screen.getByText(/Email link is invalid/i)).toBeDefined();
        expect(
          screen.queryByText((_, el) => el?.textContent === "Open the app"),
        ).toBeNull();
        expect(document.title).toMatch(/Link didn't work/);
      },
    );
  });

  it("marks the route noindex so the token URL isn't crawled", () => {
    renderPage(<AuthCallback />);
    const robots = document.head.querySelector('meta[name="robots"]');
    expect(robots?.getAttribute("content")).toContain("noindex");
  });
});
