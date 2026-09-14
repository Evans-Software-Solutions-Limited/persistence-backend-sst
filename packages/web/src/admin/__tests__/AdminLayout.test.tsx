import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { renderPage } from "@/test-utils";
import { AdminLayout } from "../AdminLayout";
import { saveSession } from "../adminAuth";

describe("AdminLayout", () => {
  afterEach(() => {
    saveSession(null);
    vi.unstubAllGlobals();
  });

  it("keeps navigation, nested active states and keyboard content target available", () => {
    renderPage(
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin/marketing/plan" element={<h1>Plan content</h1>} />
        </Route>
      </Routes>,
      { route: "/admin/marketing/plan" },
    );
    expect(screen.getByRole("navigation", { name: "Admin" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Marketing" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Dashboard" })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Skip to content" })
        .getAttribute("href"),
    ).toBe("#admin-content");
    expect(screen.getByRole("main").id).toBe("admin-content");
    expect(screen.getByText("Plan content")).toBeTruthy();
  });

  it("shows the signed-in email and returns to login on sign out", async () => {
    saveSession({
      accessToken: "test",
      refreshToken: null,
      expiresAt: 9999999999,
      email: "admin@example.com",
      isAdmin: true,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    renderPage(
      <Routes>
        <Route path="/admin/login" element={<h1>Sign in again</h1>} />
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<h1>Dashboard content</h1>} />
        </Route>
      </Routes>,
      { route: "/admin" },
    );
    expect(screen.getByText("admin@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Sign in again")).toBeTruthy();
    expect(sessionStorage.getItem("persistence.admin.session")).toBeNull();
  });
});
