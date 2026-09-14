import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router";
import { renderPage } from "@/test-utils";
import { AdminCallback } from "../pages/AdminCallback";
import * as auth from "../adminAuth";
describe("admin callback branding and routing", () => {
  afterEach(() => vi.restoreAllMocks());
  it("keeps an invalid link actionable", () => {
    vi.spyOn(auth, "parseCallbackHash").mockReturnValue({
      session: null,
      error: "Expired link",
    });
    renderPage(<AdminCallback />);
    expect(screen.getByText("Persistence")).toBeTruthy();
    expect(screen.getByText("Expired link")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Request a new one" })
        .getAttribute("href"),
    ).toBe("/admin/login");
  });
  it("saves the callback session and removes tokens before routing", async () => {
    const session = {
      accessToken: "test",
      refreshToken: null,
      expiresAt: 9999999999,
      email: "a@example.com",
      isAdmin: true,
    };
    vi.spyOn(auth, "parseCallbackHash").mockReturnValue({
      session,
      error: null,
    });
    const save = vi.spyOn(auth, "saveSession").mockImplementation(() => {});
    const history = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {});
    renderPage(
      <Routes>
        <Route path="/admin/callback" element={<AdminCallback />} />
        <Route path="/admin" element={<p>Dashboard reached</p>} />
      </Routes>,
      { route: "/admin/callback" },
    );
    expect(await screen.findByText("Dashboard reached")).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledWith(session));
    expect(history).toHaveBeenCalledWith(null, "", "/admin/callback");
  });
});
