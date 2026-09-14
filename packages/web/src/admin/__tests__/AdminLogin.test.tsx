import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { AdminLogin } from "../pages/AdminLogin";
import { sendMagicLink, supabaseConfig } from "../adminAuth";

vi.mock("../adminAuth", () => ({
  sendMagicLink: vi.fn(),
  supabaseConfig: vi.fn(),
}));

describe("AdminLogin", () => {
  afterEach(() => {
    vi.mocked(sendMagicLink).mockReset();
    vi.mocked(supabaseConfig).mockReset();
  });

  it("sends the admin callback and announces the email confirmation", async () => {
    vi.mocked(supabaseConfig).mockReturnValue({
      url: "https://example.com",
      anonKey: "public",
    });
    vi.mocked(sendMagicLink).mockResolvedValue(undefined);
    renderPage(<AdminLogin />);
    fireEvent.change(screen.getByLabelText("Admin email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(sendMagicLink).toHaveBeenCalledWith(
      "admin@example.com",
      `${window.location.origin}/admin/callback`,
    );
    expect(screen.getByText("admin@example.com")).toBeTruthy();
  });

  it("retains an actionable error state after sending fails", async () => {
    vi.mocked(supabaseConfig).mockReturnValue({
      url: "https://example.com",
      anonKey: "public",
    });
    vi.mocked(sendMagicLink).mockRejectedValue(new Error("Please try again"));
    renderPage(<AdminLogin />);
    fireEvent.change(screen.getByLabelText("Admin email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Please try again",
    );
    expect(
      screen
        .getByRole("button", { name: "Send sign-in link" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
  it("disables sign-in when site configuration is absent", () => {
    vi.mocked(supabaseConfig).mockReturnValue(null);
    renderPage(<AdminLogin />);
    expect(screen.getByRole("alert").textContent).toContain("isn't configured");
    expect(screen.getByLabelText("Admin email").hasAttribute("disabled")).toBe(
      true,
    );
    expect(
      screen
        .getByRole("button", { name: "Send sign-in link" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  it("offers retry for an unknown sending error", async () => {
    vi.mocked(supabaseConfig).mockReturnValue({
      url: "https://example.com",
      anonKey: "public",
    });
    vi.mocked(sendMagicLink).mockRejectedValue("network unavailable");
    renderPage(<AdminLogin />);
    fireEvent.change(screen.getByLabelText("Admin email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sign-in failed",
    );
  });
});
