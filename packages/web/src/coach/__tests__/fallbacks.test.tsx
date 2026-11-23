import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { inviteErrorMessage } from "../invite/useInviteActions";
import { InviteContainer } from "../invite/InviteContainer";
import {
  MealPlanEditor,
  RepeatingCheckinsEditor,
  StarterFormsEditor,
  WelcomeEditor,
} from "../setup/SectionEditors";
import { SetupContainer } from "../setup/SetupContainer";
import {
  FORMS,
  PLANS,
  PROFILE_ID,
  SCHEDULES,
  apiError,
  detail,
  fakeApi,
  renderCoach,
  setOnline,
} from "./helpers";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QR") },
}));

beforeEach(() => setOnline(true));
afterEach(() => setOnline(true));

const SETUP = "/coach/clients/invited/:profileId/setup/:section?";
const at = (s: string) => `/coach/clients/invited/${PROFILE_ID}/setup/${s}`;

describe("invite error messages", () => {
  it("maps each failure to plain words", () => {
    expect(inviteErrorMessage(apiError(0, null, true))).toMatch(/offline/);
    expect(
      inviteErrorMessage(apiError(409, { code: "profile_not_editable" })),
    ).toMatch(/already accepted/);
    expect(inviteErrorMessage(apiError(402, { message: "No seats" }))).toBe(
      "No seats",
    );
    expect(inviteErrorMessage(new Error("x"))).toBe(
      "Something went wrong. Try again.",
    );
  });
});

describe("when the library or roster can't load", () => {
  const failing = () =>
    fakeApi({
      forms: vi.fn().mockRejectedValue(apiError(500, null)),
      formSchedules: vi.fn().mockRejectedValue(apiError(500, null)),
      mealPlans: vi.fn().mockRejectedValue(apiError(500, null)),
      roster: vi.fn().mockRejectedValue(apiError(500, null)),
      profileDetail: vi.fn().mockResolvedValue(
        detail({
          setup: {
            starter_form: [{ refId: "f-goals", config: {}, sortOrder: 0 }],
            repeating_form: [{ refId: "s-weekly", config: {}, sortOrder: 0 }],
            meal_plan: [{ refId: "p-train", config: {}, sortOrder: 0 }],
          },
        }),
      ),
    });

  it.each(["starter_form", "repeating_form", "meal_plan"])(
    "%s still opens",
    async (section) => {
      renderCoach(<SetupContainer />, {
        route: at(section),
        path: SETUP,
        api: failing(),
      });
      expect(
        await screen.findByRole("navigation", { name: "Set up checklist" }),
      ).toBeTruthy();
      expect(
        screen.getAllByRole("button", { name: /Remove/ }).length,
      ).toBeGreaterThan(0);
    },
  );

  it("copy-from shows no sources", async () => {
    renderCoach(<SetupContainer />, {
      route: at("meal_plan"),
      path: SETUP,
      api: failing(),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /Copy setup from a client/ }),
    );
    expect(
      await screen.findByText("No other clients to copy from yet."),
    ).toBeTruthy();
  });

  it("an unknown section in the address opens the first one", async () => {
    renderCoach(<SetupContainer />, {
      route: at("programme"),
      path: SETUP,
      api: fakeApi(),
    });
    expect(
      await screen.findByRole("heading", { name: "Starter forms" }),
    ).toBeTruthy();
  });

  it("the invite step without a coach name or library still works", async () => {
    const api = fakeApi({
      profile: vi.fn().mockRejectedValue(apiError(500, null)),
      forms: vi.fn().mockRejectedValue(apiError(500, null)),
      profileDetail: vi.fn().mockResolvedValue(
        detail({
          contactEmail: null,
          contactPhone: "07700 900123",
          invite: {
            code: "AB12CD",
            link: "l",
            expiresAt: new Date(Date.now() + 86_400_000 - 1000).toISOString(),
            status: "active",
          },
        }),
      ),
    });
    renderCoach(<InviteContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/invite`,
      path: "/coach/clients/invited/:profileId/invite",
      api,
    });
    expect(await screen.findByText("AB12CD")).toBeTruthy();
    expect(screen.getByText(/expires in 1 day/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Email/ })).toBeNull();
    expect(
      screen.getByText("Your general code still works for anyone else."),
    ).toBeTruthy();
    expect(screen.getByText(/Nothing set up yet/)).toBeTruthy();
    await waitFor(() => expect(api.issueInvite).not.toHaveBeenCalled());
  });
});

describe("editors when locked", () => {
  it("disable every control", () => {
    const base = { disabled: true, clientFirst: "Lena", onChange: vi.fn() };
    const { container, unmount } = render(
      <StarterFormsEditor
        {...base}
        items={[{ refId: "f-goals", config: {}, sortOrder: 0 }]}
        forms={FORMS}
      />,
    );
    expect(container.querySelector("section")?.getAttribute("draggable")).toBe(
      "false",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Add a form from your Library",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    unmount();
    render(
      <RepeatingCheckinsEditor
        {...base}
        items={[{ refId: "s-weekly", config: {}, sortOrder: 0 }]}
        forms={FORMS}
        schedules={SCHEDULES}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Monday" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    render(<MealPlanEditor {...base} items={[]} plans={PLANS} />);
    expect(
      (screen.getByRole("button", { name: "Add" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    render(<WelcomeEditor {...base} items={[]} />);
    expect(
      (
        screen.getByRole("button", {
          name: "+ First name",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
