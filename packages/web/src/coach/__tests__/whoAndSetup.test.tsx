import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { SetupContainer } from "../setup/SetupContainer";
import { WhoContainer } from "../who/WhoContainer";
import {
  CLIENT_ID,
  PROFILE_ID,
  apiError,
  currentPath,
  detail,
  fakeApi,
  renderCoach,
  setOnline,
} from "./helpers";

const SETUP = "/coach/clients/invited/:profileId/setup/:section?";
const at = (section = "") =>
  `/coach/clients/invited/${PROFILE_ID}/setup${section ? `/${section}` : ""}`;

beforeEach(() => setOnline(true));
afterEach(() => setOnline(true));

describe("Add client · 1 Who (C11a)", () => {
  it("needs a first name and a real email or mobile", async () => {
    const api = fakeApi();
    renderCoach(<WhoContainer />, {
      route: "/coach/clients/new",
      path: "/coach/clients/new",
      api,
    });
    fireEvent.change(screen.getByLabelText("Email or mobile"), {
      target: { value: "lena@" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    expect(await screen.findByText("Add a first name.")).toBeTruthy();
    expect(
      screen.getByText("Enter an email address or a mobile number."),
    ).toBeTruthy();
    expect(api.createProfile).not.toHaveBeenCalled();
  });

  it("makes the profile once and moves to set up", async () => {
    const api = fakeApi({ createProfile: vi.fn().mockResolvedValue(detail()) });
    renderCoach(<WhoContainer />, {
      route: "/coach/clients/new",
      path: "/coach/clients/new",
      api,
    });
    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Lena" },
    });
    fireEvent.change(screen.getByLabelText("Last name"), {
      target: { value: "Ortiz" },
    });
    fireEvent.change(screen.getByLabelText("Email or mobile"), {
      target: { value: "lena@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Goal, optional"), {
      target: { value: "First pull-up" },
    });
    fireEvent.change(screen.getByLabelText("Private notes, optional"), {
      target: { value: "Shoulder" },
    });
    expect(screen.getByText(/Lena's profile/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    await waitFor(() => expect(currentPath()).toBe(at()));
    expect(api.createProfile).toHaveBeenCalledWith(
      {
        displayName: "Lena Ortiz",
        contactEmail: "lena@example.com",
        contactPhone: null,
        goal: "First pull-up",
        privateNotes: "Shoulder",
      },
      expect.any(String),
    );
  });

  it("can't add a client offline, and Cancel goes back to Clients", async () => {
    setOnline(false);
    renderCoach(<WhoContainer />, {
      route: "/coach/clients/new",
      path: "/coach/clients/new",
      api: fakeApi(),
    });
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Next: set up",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(currentPath()).toBe("/coach/clients");
  });

  it("shows a failed create", async () => {
    const api = fakeApi({
      createProfile: vi.fn().mockRejectedValue(apiError(0, null, true)),
    });
    renderCoach(<WhoContainer />, {
      route: "/coach/clients/new",
      path: "/coach/clients/new",
      api,
    });
    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Lena" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    expect(
      await screen.findByText(
        "You're offline. Adding a client needs a connection.",
      ),
    ).toBeTruthy();
  });

  it("a server 422 lands on the field it names (PER-147)", async () => {
    const api = fakeApi({
      createProfile: vi
        .fn()
        .mockRejectedValueOnce(
          apiError(422, {
            code: "VALIDATION",
            validation: [{ path: "/contactEmail", message: "Expected email" }],
          }),
        )
        .mockRejectedValueOnce(apiError(422, { code: "VALIDATION" })),
    });
    renderCoach(<WhoContainer />, {
      route: "/coach/clients/new",
      path: "/coach/clients/new",
      api,
    });
    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Lena" },
    });
    fireEvent.change(screen.getByLabelText("Email or mobile"), {
      target: { value: "lena@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    const message = await screen.findByText(
      "Enter an email address or a mobile number.",
    );
    expect(message.id).toBe("who-contact-err");
    // A refusal naming no field still shows as before, in the banner; the
    // next press clears the field error.
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    expect(await screen.findByText("Request failed (422)")).toBeTruthy();
    expect(
      screen.queryByText("Enter an email address or a mobile number."),
    ).toBeNull();
  });

  it("going Back edits only what changed, with the revision", async () => {
    const api = fakeApi({
      patchProfile: vi
        .fn()
        .mockResolvedValue({ ...detail(), goal: "Run 5k", revision: 4 }),
    });
    const route = `/coach/clients/invited/${PROFILE_ID}/who`;
    renderCoach(<WhoContainer />, {
      route,
      path: "/coach/clients/invited/:profileId/who",
      api,
    });
    const goal = await screen.findByLabelText("Goal, optional");
    expect(
      (screen.getByLabelText("First name") as HTMLInputElement).value,
    ).toBe("Lena");
    fireEvent.change(goal, { target: { value: "Run 5k" } });
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    await waitFor(() => expect(currentPath()).toBe(at()));
    expect(api.patchProfile).toHaveBeenCalledWith(
      PROFILE_ID,
      { goal: "Run 5k" },
      3,
    );
  });

  it("reopens a long saved name (over 40 in Last name) and still saves", async () => {
    // splitName puts every later word into Last name; the API allows 80.
    const displayName =
      "María de la Cruz Fernández-Rodríguez y Montenegro Villaseñor";
    const api = fakeApi({
      profileDetail: vi
        .fn()
        .mockResolvedValue({ ...detail(), displayName, revision: 3 }),
      patchProfile: vi.fn().mockResolvedValue({
        ...detail(),
        displayName,
        goal: "Run 5k",
        revision: 4,
      }),
    });
    renderCoach(<WhoContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/who`,
      path: "/coach/clients/invited/:profileId/who",
      api,
    });
    const goal = await screen.findByLabelText("Goal, optional");
    expect(
      (screen.getByLabelText("Last name") as HTMLInputElement).value.length,
    ).toBeGreaterThan(40);
    fireEvent.change(goal, { target: { value: "Run 5k" } });
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    await waitFor(() => expect(currentPath()).toBe(at()));
    expect(api.patchProfile).toHaveBeenCalledWith(
      PROFILE_ID,
      { goal: "Run 5k" },
      3,
    );
  });

  it("unchanged: no write; 409: shows the other device's version", async () => {
    const latest = { ...detail(), goal: "From the phone", revision: 5 };
    const api = fakeApi({
      patchProfile: vi
        .fn()
        .mockRejectedValue(
          apiError(409, { code: "revision_conflict", current: latest }),
        ),
    });
    const route = `/coach/clients/invited/${PROFILE_ID}/who`;
    renderCoach(<WhoContainer />, {
      route,
      path: "/coach/clients/invited/:profileId/who",
      api,
    });
    fireEvent.change(await screen.findByLabelText("Goal, optional"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    expect(await screen.findByText(/Updated on another device/)).toBeTruthy();
    expect(
      (screen.getByLabelText("Goal, optional") as HTMLInputElement).value,
    ).toBe("From the phone");
    expect(currentPath()).toBe(route);
  });

  it("an existing profile that won't load can be retried", async () => {
    const profileDetail = vi.fn().mockRejectedValue(apiError(500, null));
    renderCoach(<WhoContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/who`,
      path: "/coach/clients/invited/:profileId/who",
      api: fakeApi({ profileDetail }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(profileDetail).toHaveBeenCalledTimes(2));
  });
});

describe("Add client · 2 Set up (C11b)", () => {
  it("lists only the live sections, with a summary each and the count", async () => {
    const api = fakeApi({
      profileDetail: vi.fn().mockResolvedValue(
        detail({
          setup: {
            welcome_message: [
              { refId: null, config: { text: "Hi Lena" }, sortOrder: 0 },
            ],
          },
        }),
      ),
    });
    renderCoach(<SetupContainer />, { route: at(), path: SETUP, api });
    const nav = await screen.findByRole("navigation", {
      name: "Set up checklist",
    });
    const rows = within(nav)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(rows.slice(0, 5)).toEqual([
      "Starter formsNot added",
      "Repeating check-insNot added",
      "Calorie and macro targetsNot added",
      "Meal planNot added",
      "Welcome message“Hi Lena”",
    ]);
    expect(within(nav).queryByText("Programme")).toBeNull();
    expect(within(nav).queryByText("Resources")).toBeNull();
    expect(within(nav).getByText("1 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Set up Lena" })).toBeTruthy();
  });

  it("moving to another section saves; the checklist updates", async () => {
    const saved = detail({
      revision: 4,
      setup: { starter_form: [{ refId: "f-goals", config: {}, sortOrder: 0 }] },
    });
    const api = fakeApi({ replaceSection: vi.fn().mockResolvedValue(saved) });
    renderCoach(<SetupContainer />, {
      route: at("starter_form"),
      path: SETUP,
      api,
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add a form from your Library",
      }),
    );
    const list = await screen.findByRole("list", {
      name: "Add a form from your Library",
    });
    fireEvent.click(within(list).getAllByRole("button", { name: "Add" })[0]);
    expect(screen.getByText("New client: goals and health")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show questions/ }));
    expect(screen.getByText("What do you want from coaching?")).toBeTruthy();
    expect(screen.getByText("+9 more questions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Meal plan/ }));
    await waitFor(() =>
      expect(api.replaceSection).toHaveBeenCalledWith(
        PROFILE_ID,
        "starter_form",
        [{ refId: "f-goals", config: {}, sortOrder: 0 }],
        3,
      ),
    );
    await waitFor(() => expect(currentPath()).toBe(at("meal_plan")));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(screen.getByText("1 form · sent when Lena joins")).toBeTruthy();
  });

  it("Cancel drops this section's changes without saving", async () => {
    const api = fakeApi();
    renderCoach(<SetupContainer />, {
      route: at("welcome_message"),
      path: SETUP,
      api,
    });
    const box = (await screen.findByLabelText(
      "Message",
    )) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Hello " } });
    fireEvent.click(screen.getByRole("button", { name: "+ First name" }));
    expect(box.value).toBe("Hello Lena");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /Starter forms/ }));
    await waitFor(() => expect(currentPath()).toBe(at("starter_form")));
    expect(api.replaceSection).not.toHaveBeenCalled();
  });

  it("409: replaces the section with the other device's version", async () => {
    const latest = detail({
      revision: 6,
      setup: {
        welcome_message: [
          { refId: null, config: { text: "From the phone" }, sortOrder: 0 },
        ],
      },
    });
    const api = fakeApi({
      replaceSection: vi
        .fn()
        .mockRejectedValue(
          apiError(409, { code: "revision_conflict", current: latest }),
        ),
    });
    renderCoach(<SetupContainer />, {
      route: at("welcome_message"),
      path: SETUP,
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    expect(await screen.findByText(/Updated on another device/)).toBeTruthy();
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe("From the phone");
    expect(currentPath()).toBe(at("welcome_message"));
  });

  it("hides a section the server says isn't available yet, and carries on", async () => {
    const api = fakeApi({
      replaceSection: vi
        .fn()
        .mockRejectedValue(
          apiError(422, { code: "section_unavailable", section: "meal_plan" }),
        ),
    });
    renderCoach(<SetupContainer />, {
      route: at("meal_plan"),
      path: SETUP,
      api,
    });
    const add = await screen.findAllByRole("button", { name: "Add" });
    fireEvent.click(add[0]);
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/invited/${PROFILE_ID}/invite`),
    );
  });

  it("a half-filled target can't be saved", async () => {
    const api = fakeApi();
    renderCoach(<SetupContainer />, {
      route: at("nutrition_target"),
      path: SETUP,
      api,
    });
    fireEvent.click(await screen.findByRole("radio", { name: "You set them" }));
    fireEvent.change(screen.getByLabelText("kcal a day"), {
      target: { value: "2100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip, set up later" }));
    expect(
      await screen.findAllByText(/Enter calories and all three macros/),
    ).toHaveLength(2);
    expect(api.replaceSection).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Protein, g"), {
      target: { value: "150" },
    });
    fireEvent.change(screen.getByLabelText("Carbs, g"), {
      target: { value: "230" },
    });
    fireEvent.change(screen.getByLabelText("Fat, g"), {
      target: { value: "65" },
    });
    api.replaceSection.mockResolvedValue(detail());
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    await waitFor(() =>
      expect(api.replaceSection).toHaveBeenCalledWith(
        PROFILE_ID,
        "nutrition_target",
        [
          {
            refId: null,
            sortOrder: 0,
            config: { dailyKcal: 2100, proteinG: 150, carbsG: 230, fatG: 65 },
          },
        ],
        3,
      ),
    );
  });

  it("shows saved targets and lets the client set their own", async () => {
    const api = fakeApi({
      profileDetail: vi.fn().mockResolvedValue(
        detail({
          setup: {
            nutrition_target: [
              {
                refId: null,
                sortOrder: 0,
                config: {
                  dailyKcal: 2100,
                  proteinG: 150,
                  carbsG: 230,
                  fatG: 65,
                },
              },
            ],
          },
        }),
      ),
      replaceSection: vi.fn().mockResolvedValue(detail()),
    });
    renderCoach(<SetupContainer />, {
      route: at("nutrition_target"),
      path: SETUP,
      api,
    });
    expect(await screen.findByText("2,100")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit numbers" }));
    expect(
      (screen.getByLabelText("kcal a day") as HTMLInputElement).value,
    ).toBe("2100");
    fireEvent.click(screen.getByRole("radio", { name: "Lena sets them" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(api.replaceSection).toHaveBeenCalledWith(
        PROFILE_ID,
        "nutrition_target",
        [],
        3,
      ),
    );
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/invited/${PROFILE_ID}/who`),
    );
  });

  it("edits a repeating check-in's day, time, due and reminders as an override", async () => {
    const api = fakeApi({
      profileDetail: vi.fn().mockResolvedValue(
        detail({
          setup: {
            repeating_form: [{ refId: "s-weekly", config: {}, sortOrder: 0 }],
          },
        }),
      ),
      replaceSection: vi.fn().mockResolvedValue(detail()),
    });
    renderCoach(<SetupContainer />, {
      route: at("repeating_form"),
      path: SETUP,
      api,
    });
    expect(
      await screen.findByText(
        "For Lena only. Starts the first Sunday after Lena accepts.",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", { name: "Weekly" }) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    fireEvent.change(screen.getByLabelText("Due day"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Due time"), {
      target: { value: "12:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove reminder 2" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add reminder" }));
    fireEvent.change(screen.getByLabelText("Reminder 1 time"), {
      target: { value: "20:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    await waitFor(() => expect(api.replaceSection).toHaveBeenCalled());
    const [, section, items] = api.replaceSection.mock.calls[0];
    expect(section).toBe("repeating_form");
    expect(items[0].config.override).toMatchObject({
      weekday: 1,
      dueAfterHours: 51,
    });
    expect(items[0].config.override.reminders).toEqual([
      { afterHours: 11 },
      { afterHours: 21 },
    ]);
  });

  it("adds a check-in from the library and removes it", async () => {
    const api = fakeApi();
    renderCoach(<SetupContainer />, {
      route: at("repeating_form"),
      path: SETUP,
      api,
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add a check-in from your Library",
      }),
    );
    fireEvent.click(
      within(
        await screen.findByRole("list", {
          name: "Add a check-in from your Library",
        }),
      ).getByRole("button", { name: "Add" }),
    );
    expect(
      screen.getByRole("button", { name: "Remove Weekly check-in" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Weekly check-in" }),
    );
    expect(
      screen.queryByRole("button", { name: "Remove Weekly check-in" }),
    ).toBeNull();
  });

  it("offline: banner, editors locked, copy waits", async () => {
    const api = fakeApi();
    renderCoach(<SetupContainer />, {
      route: at("welcome_message"),
      path: SETUP,
      api,
    });
    await screen.findByLabelText("Message");
    setOnline(false);
    expect(
      await screen.findByText(/Offline · showing Lena as of/),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: /Copy setup from a client/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("copies the set-up from an active client", async () => {
    const copied = detail({
      revision: 9,
      setup: { meal_plan: [{ refId: "p-train", config: {}, sortOrder: 0 }] },
    });
    const api = fakeApi({ copyFrom: vi.fn().mockResolvedValue(copied) });
    renderCoach(<SetupContainer />, {
      route: at("meal_plan"),
      path: SETUP,
      api,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /Copy setup from a client/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Copy setup from a client",
    });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Copy" }),
    );
    await waitFor(() =>
      expect(api.copyFrom).toHaveBeenCalledWith(PROFILE_ID, {
        sourceClientId: CLIENT_ID,
      }),
    );
    expect(await screen.findByText("Copied from Sam Patel")).toBeTruthy();
    expect(screen.getAllByText("Training day meals").length).toBeGreaterThan(0);
  });

  it("shows a failed copy in the dialog", async () => {
    const api = fakeApi({
      copyFrom: vi.fn().mockRejectedValue(
        apiError(403, {
          message: "You can only act for your active clients",
        }),
      ),
    });
    renderCoach(<SetupContainer />, { route: at(), path: SETUP, api });
    fireEvent.click(
      await screen.findByRole("button", { name: /Copy setup from a client/ }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Copy" }),
    );
    expect(
      await within(dialog).findByText(
        "You can only act for your active clients",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  });

  it("previews what the client sees (C11b2)", async () => {
    const api = fakeApi({
      profileDetail: vi.fn().mockResolvedValue(
        detail({
          setup: {
            starter_form: [{ refId: "f-goals", config: {}, sortOrder: 0 }],
            nutrition_target: [
              {
                refId: null,
                sortOrder: 0,
                config: {
                  dailyKcal: 2100,
                  proteinG: 150,
                  carbsG: 230,
                  fatG: 65,
                },
              },
            ],
          },
        }),
      ),
      preview: vi.fn().mockResolvedValue({
        sections: [],
        welcomeMessage: "Hi Lena, excited to start.",
        programmes: [],
        plans: [{ name: "Training day meals" }],
        forms: [],
      }),
    });
    renderCoach(<SetupContainer />, { route: at(), path: SETUP, api });
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview as Lena" }),
    );
    const panel = await screen.findByRole("dialog", {
      name: /Preview: what Lena sees/,
    });
    expect(
      await within(panel).findByText("Hi Lena, excited to start."),
    ).toBeTruthy();
    expect(within(panel).getByText("Ellie Hart")).toBeTruthy();
    expect(
      within(panel).getByText("New client: goals and health"),
    ).toBeTruthy();
    expect(within(panel).getByText("Training day meals")).toBeTruthy();
    expect(within(panel).getByText("2,100 kcal · 150 g protein")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("from the invited page: no steps, Back saves and returns there", async () => {
    const api = fakeApi({
      replaceSection: vi.fn().mockResolvedValue(detail()),
    });
    renderCoach(<SetupContainer />, {
      route: `${at("welcome_message")}?from=invited`,
      path: SETUP,
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Welcome!" },
    });
    expect(screen.queryByRole("list", { name: "Steps" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next: invite" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(api.replaceSection).toHaveBeenCalledWith(
        PROFILE_ID,
        "welcome_message",
        [{ refId: null, sortOrder: 0, config: { text: "Welcome!" } }],
        3,
      ),
    );
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/invited/${PROFILE_ID}`),
    );
  });

  it("accepted clients go to their page; missing or uneditable ones explain", async () => {
    renderCoach(<SetupContainer />, {
      route: at(),
      path: SETUP,
      api: fakeApi({
        profileDetail: vi
          .fn()
          .mockResolvedValue(detail({ status: "active", clientId: CLIENT_ID })),
      }),
    });
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/${CLIENT_ID}`),
    );

    renderCoach(<SetupContainer />, {
      route: at(),
      path: SETUP,
      api: fakeApi({
        profileDetail: vi.fn().mockRejectedValue(apiError(404, null)),
      }),
    });
    expect(
      await screen.findByText("This client isn't in your list."),
    ).toBeTruthy();
  });

  it("a profile the server won't change says so", async () => {
    const api = fakeApi({
      replaceSection: vi
        .fn()
        .mockRejectedValue(
          apiError(409, { code: "profile_not_editable", status: "active" }),
        ),
    });
    renderCoach(<SetupContainer />, {
      route: at("welcome_message"),
      path: SETUP,
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    expect(
      await screen.findByText(/already accepted or the invite was cancelled/),
    ).toBeTruthy();
  });

  it("a 422 on the welcome message shows the form's message (PER-147)", async () => {
    const api = fakeApi({
      replaceSection: vi.fn().mockRejectedValue(
        apiError(422, {
          code: "VALIDATION",
          validation: [{ path: "/items/0/config/text", message: "too long" }],
        }),
      ),
    });
    renderCoach(<SetupContainer />, {
      route: at("welcome_message"),
      path: SETUP,
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    expect(
      await screen.findByText("Keep the message under 1,000 characters."),
    ).toBeTruthy();
    expect(currentPath()).toBe(at("welcome_message"));
  });

  it("reports other save failures", async () => {
    const api = fakeApi({
      replaceSection: vi.fn().mockRejectedValue(apiError(0, null, true)),
    });
    renderCoach(<SetupContainer />, {
      route: at("welcome_message"),
      path: SETUP,
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    expect(
      await screen.findByText(
        "You're offline. Your changes save when you're back online.",
      ),
    ).toBeTruthy();
  });
});
