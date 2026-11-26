import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const sendMagicLink = vi.fn();
vi.mock("../api/coachAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/coachAuth")>()),
  sendMagicLink: (...args: unknown[]) => sendMagicLink(...args),
}));

const { CoachSignIn } = await import("../shell/CoachSignIn");

function open() {
  render(
    <MemoryRouter>
      <CoachSignIn />
    </MemoryRouter>,
  );
  return {
    email: screen.getByLabelText("Email"),
    send: () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Email me a sign-in link" }),
      ),
  };
}

describe("Coach sign in (react-hook-form, PER-147)", () => {
  it("refuses an address that isn't an email, without sending", async () => {
    const { email } = open();
    fireEvent.change(email, { target: { value: "ellie" } });
    // The browser's own email check stops a click first; submitting the form
    // directly shows the schema still refuses it.
    fireEvent.submit(email.closest("form")!);
    expect(
      await screen.findByText("Enter the email of the account you coach from."),
    ).toBeTruthy();
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  it("sends the trimmed address, then says to check email", async () => {
    sendMagicLink.mockResolvedValueOnce(undefined);
    const { email, send } = open();
    fireEvent.change(email, { target: { value: " ellie@example.com " } });
    send();
    expect(await screen.findByText(/Check your email/)).toBeTruthy();
    expect(sendMagicLink).toHaveBeenCalledWith(
      "ellie@example.com",
      expect.stringMatching(/\/coach\/callback$/),
    );
  });

  it("shows a failed send and lets them try again", async () => {
    sendMagicLink
      .mockRejectedValueOnce(new Error("Rate limited"))
      .mockRejectedValueOnce("x");
    const { email, send } = open();
    fireEvent.change(email, { target: { value: "ellie@example.com" } });
    send();
    expect(await screen.findByText("Rate limited")).toBeTruthy();
    send();
    expect(await screen.findByText("Sign-in failed")).toBeTruthy();
  });
});
