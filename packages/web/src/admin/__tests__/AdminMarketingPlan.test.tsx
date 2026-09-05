import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import type { MarketingPlanDetail } from "../adminApi";

const api = vi.hoisted(() => ({
  marketingPlan: vi.fn(),
  campaignSlugs: vi.fn(),
  updateMarketingPlan: vi.fn(),
  addPlanChannel: vi.fn(),
  removePlanChannel: vi.fn(),
  linkPlanCode: vi.fn(),
  unlinkPlanCode: vi.fn(),
  addPlanStoreOffer: vi.fn(),
  removePlanStoreOffer: vi.fn(),
  upsertPlanMetric: vi.fn(),
  codes: vi.fn(),
}));
vi.mock("../adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adminApi")>();
  return { ...actual, adminApi: { ...actual.adminApi, ...api } };
});

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useParams: () => ({ id: "p1" }) };
});

import { AdminMarketingPlan } from "../pages/AdminMarketingPlan";

const detail: MarketingPlanDetail = {
  plan: {
    id: "p1",
    name: "Founders' offer — Sep 2026",
    slug: "founders-sep-2026",
    status: "draft",
    objective: "Test the Meta rail",
    hypothesis: "Cold traffic redeems",
    decisionRule: "Stop at £210",
    offerLanes: ["founding_access", "store_offer"],
    budgetCapMinor: 21000,
    currency: "GBP",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    briefMd: "# Founders' brief\n\nRun the founders' offer.",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  },
  channels: [
    {
      id: "c1",
      campaignSlug: "meta",
      label: "Meta ads",
      placement: "Reels",
      notes: null,
    },
  ],
  codes: [
    {
      linkId: "l1",
      codeId: "code-1",
      code: "METAFOUND",
      displayCode: "METAFOUND",
      label: "Meta launch",
      partnerName: null,
      campaignSlug: "meta",
    },
  ],
  storeOffers: [
    {
      id: "o1",
      platform: "ios",
      code: "FOUNDERS6",
      tierName: "premium",
      durationMonths: 6,
      priceMinor: 3000,
      currency: "GBP",
      maxRedemptions: 100,
      expiresOn: "2026-10-31",
      campaignSlug: "meta",
      redemptionUrl: null,
      notes: null,
    },
  ],
  metrics: [
    {
      id: "m1",
      campaignSlug: "meta",
      metricDate: "2026-09-12",
      spendMinor: 1000,
      impressions: 5000,
      clicks: 90,
      landingViews: 70,
      storeRedemptions: 4,
      notes: null,
    },
  ],
  attribution: {
    // Plain days, as the API returns them. Instants here would exercise only
    // `formatDay`'s fallback branch and quietly stop guarding the fix.
    window: { from: "2026-09-01", to: "2026-09-30" },
    channels: [
      {
        campaignSlug: "meta",
        storeClicks: 20,
        storeClicksIos: 18,
        storeClicksAndroid: 2,
        storeClicksWithCode: 5,
      },
    ],
    codes: [
      {
        codeId: "code-1",
        referralClaims: 6,
        referralClaimsLocked: 2,
        grantsFounding: 3,
        grantsComplimentary: 1,
        grantsPending: 1,
        grantsApplied: 3,
        contributionMinor: 9000,
      },
    ],
    registrationsAllSources: 42,
  },
};

/** The rendered panel with this title, once the plan detail has loaded. */
async function panel(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name: title });
  return heading.closest("section")!;
}

describe("AdminMarketingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.marketingPlan.mockResolvedValue(detail);
    api.campaignSlugs.mockResolvedValue(["meta", "ig", "flyer"]);
    api.codes.mockResolvedValue([
      {
        id: "code-1",
        code: "METAFOUND",
        displayCode: "METAFOUND",
        label: "Meta launch",
      },
      {
        id: "code-2",
        code: "UONFAIR",
        displayCode: "UONFAIR",
        label: "UoN fair",
      },
    ]);
    api.updateMarketingPlan.mockResolvedValue(detail.plan);
    api.addPlanChannel.mockResolvedValue(detail.channels[0]);
    api.removePlanChannel.mockResolvedValue({ data: {} });
    api.linkPlanCode.mockResolvedValue({ id: "l2", code: "UONFAIR" });
    api.unlinkPlanCode.mockResolvedValue({ data: {} });
    api.addPlanStoreOffer.mockResolvedValue(detail.storeOffers[0]);
    api.removePlanStoreOffer.mockResolvedValue({ data: {} });
    api.upsertPlanMetric.mockResolvedValue(detail.metrics[0]);
  });

  it("renders the plan header and its stated decision rule", async () => {
    renderPage(<AdminMarketingPlan />);
    expect(await screen.findByText("Founders' offer — Sep 2026")).toBeDefined();
    expect(screen.getByText("Stop at £210")).toBeDefined();
  });

  describe("status", () => {
    it("offers only the transitions the current status allows", async () => {
      renderPage(<AdminMarketingPlan />);
      expect(
        await screen.findByRole("button", { name: "Activate" }),
      ).toBeDefined();
      expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    });

    it("offers no transition at all once a plan is complete", async () => {
      api.marketingPlan.mockResolvedValue({
        ...detail,
        plan: { ...detail.plan, status: "complete" },
      });
      renderPage(<AdminMarketingPlan />);
      await screen.findByText("Founders' offer — Sep 2026");
      expect(
        screen.queryByRole("button", { name: /Activate|Pause/ }),
      ).toBeNull();
    });

    it("sends the new status", async () => {
      renderPage(<AdminMarketingPlan />);
      fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
      await waitFor(() =>
        expect(api.updateMarketingPlan).toHaveBeenCalledWith("p1", {
          status: "active",
        }),
      );
    });
  });

  describe("attribution", () => {
    it("shows store clicks split by store and how many carried a code", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Attribution"));
      const row = await section.findByRole("row", { name: /^meta / });
      const cells = within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent);
      // channel, clicks, iOS, Android, with-code, then the hand-entered block.
      expect(cells.slice(0, 5)).toEqual(["meta", "20", "18", "2", "5"]);
    });

    it("labels the money as contributions, never as revenue", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = await panel("Attribution");
      await waitFor(() =>
        expect(
          within(section).getAllByText("Contributions").length,
        ).toBeGreaterThan(0),
      );
      expect(within(section).getByText(/Not revenue/)).toBeDefined();
      expect(section.textContent).not.toMatch(/revenue(?!\.)/i);
    });

    it("renders the window's own days, without shifting either end", async () => {
      // The API sends plain days; reading them as instants moved the end date
      // a day forward for any viewer east of UTC and a day back for the west.
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Attribution"));
      await waitFor(() =>
        expect(
          section.getByText(/1 Sept? 2026 to 30 Sept? 2026/),
        ).toBeDefined(),
      );
    });

    it("shows the panel's money in the plan's own currency", async () => {
      api.marketingPlan.mockResolvedValue({
        ...detail,
        plan: { ...detail.plan, currency: "USD" },
      });
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Attribution"));
      // Cost per click: 10.00 spend over 20 store clicks. `en-GB` disambiguates
      // the dollar, which is the point — the reader must not read it as GBP.
      await waitFor(() => section.getByText("US$0.50"));
    });

    it("labels registrations as all sources rather than attributing them", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Attribution"));
      await waitFor(() => section.getByText("42"));
      expect(section.getByText(/All sources/)).toBeDefined();
    });

    it("derives a cost per store click from the hand-entered spend", async () => {
      // £10.00 spend over 20 clicks.
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Attribution"));
      await waitFor(() => section.getByText("£0.50"));
    });

    it("shows a dash, not a zero, when there is no spend to divide", async () => {
      api.marketingPlan.mockResolvedValue({ ...detail, metrics: [] });
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Attribution"));
      const row = await section.findByRole("row", { name: /^meta / });
      expect(
        within(row)
          .getAllByRole("cell")
          .map((c) => c.textContent)
          .at(-1),
      ).toBe("—");
    });
  });

  describe("channels", () => {
    it("adds a channel from the slug list the API returned", async () => {
      renderPage(<AdminMarketingPlan />);
      const form = await screen.findByLabelText("Add channel");
      fireEvent.change(screen.getByLabelText("Campaign slug"), {
        target: { value: "ig" },
      });
      fireEvent.change(screen.getByLabelText("Label"), {
        target: { value: "IG bio" },
      });
      fireEvent.submit(form);
      await waitFor(() =>
        expect(api.addPlanChannel).toHaveBeenCalledWith("p1", {
          campaignSlug: "ig",
          label: "IG bio",
          placement: null,
        }),
      );
    });

    it("offers only slugs the marketing site knows", async () => {
      renderPage(<AdminMarketingPlan />);
      const select = await screen.findByLabelText("Campaign slug");
      const options = [...select.querySelectorAll("option")].map((o) =>
        o.getAttribute("value"),
      );
      expect(options).toEqual(["", "meta", "ig", "flyer"]);
    });

    it("removes a channel", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Channels"));
      fireEvent.click(await section.findByRole("button", { name: "Remove" }));
      await waitFor(() =>
        expect(api.removePlanChannel).toHaveBeenCalledWith("p1", "c1"),
      );
    });
  });

  describe("referral codes", () => {
    it("says codes are created elsewhere and only offers linking", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = await panel("Referral codes");
      await waitFor(() =>
        within(section).getByText(/created on the Referral codes page/),
      );
      expect(
        within(section).queryByRole("button", { name: /create/i }),
      ).toBeNull();
    });

    it("hides codes already linked to this plan from the picker", async () => {
      renderPage(<AdminMarketingPlan />);
      const select = await screen.findByLabelText("Code");
      await waitFor(() =>
        expect(select.querySelectorAll("option")).toHaveLength(2),
      );
      const values = [...select.querySelectorAll("option")].map((o) =>
        o.getAttribute("value"),
      );
      expect(values).toEqual(["", "code-2"]);
    });

    it("links the chosen code, optionally pinned to a channel", async () => {
      renderPage(<AdminMarketingPlan />);
      const form = await screen.findByLabelText("Link referral code");
      const picker = screen.getByLabelText("Code");
      // The picker is populated by its own query — choosing before it resolves
      // silently leaves the select on its placeholder.
      await waitFor(() =>
        expect(picker.querySelectorAll("option")).toHaveLength(2),
      );
      fireEvent.change(picker, { target: { value: "code-2" } });
      fireEvent.change(screen.getByLabelText("Pin to channel (optional)"), {
        target: { value: "meta" },
      });
      fireEvent.submit(form);
      await waitFor(() =>
        expect(api.linkPlanCode).toHaveBeenCalledWith("p1", {
          referralCodeId: "code-2",
          campaignSlug: "meta",
        }),
      );
    });

    it("unlinks a code", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Referral codes"));
      fireEvent.click(await section.findByRole("button", { name: "Unlink" }));
      await waitFor(() =>
        expect(api.unlinkPlanCode).toHaveBeenCalledWith("p1", "l1"),
      );
    });
  });

  describe("store offers", () => {
    it("says the row is a record, not a control", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = await panel("Store offers");
      await waitFor(() =>
        within(section).getByText(/this is a record, not a control/i),
      );
      expect(
        within(section).getByText(/App Store Connect \/ Play Console/),
      ).toBeDefined();
    });

    it("shows redemptions to date against the recorded cap", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Store offers"));
      expect(await section.findByText("4 / 100")).toBeDefined();
    });

    it("shows a dash, not a zero, for an offer pinned to no channel", async () => {
      // Redemptions are entered per channel, so an unpinned offer genuinely
      // has nothing attributable — a 0 would read as "nobody redeemed it".
      api.marketingPlan.mockResolvedValue({
        ...detail,
        storeOffers: [{ ...detail.storeOffers[0]!, campaignSlug: null }],
      });
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Store offers"));
      expect(await section.findByText("— / 100")).toBeDefined();
    });

    it("upper-cases a typed offer code and sends the price in minor units", async () => {
      renderPage(<AdminMarketingPlan />);
      const form = await screen.findByLabelText("Record store offer");
      fireEvent.change(screen.getByLabelText("Offer code"), {
        target: { value: "founders-12" },
      });
      expect(screen.getByLabelText("Offer code")).toHaveProperty(
        "value",
        "FOUNDERS12",
      );
      fireEvent.change(screen.getByLabelText("Price charged (£)"), {
        target: { value: "60" },
      });
      fireEvent.submit(form);
      await waitFor(() => expect(api.addPlanStoreOffer).toHaveBeenCalled());
      expect(api.addPlanStoreOffer.mock.calls[0]![1]).toMatchObject({
        code: "FOUNDERS12",
        priceMinor: 6000,
      });
    });

    it("removes an offer", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Store offers"));
      fireEvent.click(await section.findByRole("button", { name: "Remove" }));
      await waitFor(() =>
        expect(api.removePlanStoreOffer).toHaveBeenCalledWith("p1", "o1"),
      );
    });
  });

  describe("weekly numbers", () => {
    it("defaults to the whole plan and sends a null slug for it", async () => {
      renderPage(<AdminMarketingPlan />);
      const form = await screen.findByLabelText("Record weekly numbers");
      fireEvent.change(screen.getByLabelText("Spend (£)"), {
        target: { value: "12.50" },
      });
      fireEvent.submit(form);
      await waitFor(() => expect(api.upsertPlanMetric).toHaveBeenCalled());
      expect(api.upsertPlanMetric.mock.calls[0]![1]).toMatchObject({
        campaignSlug: null,
        spendMinor: 1250,
      });
    });

    it("sends the chosen channel's slug when one is picked", async () => {
      renderPage(<AdminMarketingPlan />);
      const form = await screen.findByLabelText("Record weekly numbers");
      fireEvent.change(screen.getByLabelText("Channel"), {
        target: { value: "meta" },
      });
      fireEvent.submit(form);
      await waitFor(() => expect(api.upsertPlanMetric).toHaveBeenCalled());
      expect(api.upsertPlanMetric.mock.calls[0]![1]).toMatchObject({
        campaignSlug: "meta",
      });
    });

    it("sends null, not zero, for a field left blank", async () => {
      renderPage(<AdminMarketingPlan />);
      fireEvent.submit(await screen.findByLabelText("Record weekly numbers"));
      await waitFor(() => expect(api.upsertPlanMetric).toHaveBeenCalled());
      expect(api.upsertPlanMetric.mock.calls[0]![1]).toMatchObject({
        spendMinor: null,
        impressions: null,
        clicks: null,
        landingViews: null,
        storeRedemptions: null,
        notes: null,
      });
    });

    it("says re-saving a date replaces that row", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = await panel("Weekly numbers");
      await waitFor(() => within(section).getByText(/replaces that row/));
    });
  });

  describe("brief", () => {
    it("renders the pasted markdown", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = await panel("Brief");
      await waitFor(() =>
        within(section).getByRole("heading", {
          name: "Founders' brief",
          level: 2,
        }),
      );
      expect(
        within(section).getByText("Run the founders' offer."),
      ).toBeDefined();
    });

    it("prompts for one when the plan has no brief", async () => {
      api.marketingPlan.mockResolvedValue({
        ...detail,
        plan: { ...detail.plan, briefMd: null },
      });
      renderPage(<AdminMarketingPlan />);
      expect(await screen.findByText(/No brief pasted yet/)).toBeDefined();
    });
  });

  describe("empty states", () => {
    beforeEach(() => {
      api.marketingPlan.mockResolvedValue({
        ...detail,
        channels: [],
        codes: [],
        storeOffers: [],
        metrics: [],
        attribution: {
          ...detail.attribution,
          channels: [],
          codes: [],
        },
      });
    });

    it.each([
      ["Channels", /No channels yet/],
      ["Referral codes", /No codes linked/],
      ["Store offers", /No store offers recorded/],
      ["Weekly numbers", /Nothing recorded yet/],
    ])("prompts on the empty %s panel", async (title, copy) => {
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel(title));
      expect(await section.findByText(copy)).toBeDefined();
    });

    it("asks for a channel before showing per-channel attribution", async () => {
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel("Attribution"));
      expect(
        await section.findByText(/Add a channel to see its attribution/),
      ).toBeDefined();
      expect(
        section.getByText(/Link a code to see its claims and grants/),
      ).toBeDefined();
    });

    it("shows a dash for a plan with no dates or budget cap", async () => {
      api.marketingPlan.mockResolvedValue({
        ...detail,
        plan: {
          ...detail.plan,
          startsOn: null,
          endsOn: null,
          budgetCapMinor: null,
          objective: null,
          hypothesis: null,
          decisionRule: null,
        },
      });
      renderPage(<AdminMarketingPlan />);
      await screen.findByText("Founders' offer — Sep 2026");
      expect(screen.getAllByText("—").length).toBeGreaterThan(3);
    });
  });

  describe("mutation failures are surfaced, not swallowed", () => {
    it.each([
      ["addPlanChannel", "Add channel"],
      ["linkPlanCode", "Link referral code"],
      ["addPlanStoreOffer", "Record store offer"],
      ["upsertPlanMetric", "Record weekly numbers"],
    ])("shows the API message when %s fails", async (key, formLabel) => {
      (
        api as unknown as Record<
          string,
          { mockRejectedValue: (e: Error) => void }
        >
      )[key]!.mockRejectedValue(new Error("Refused"));
      renderPage(<AdminMarketingPlan />);
      const form = await screen.findByLabelText(formLabel);
      if (formLabel === "Add channel") {
        fireEvent.change(screen.getByLabelText("Campaign slug"), {
          target: { value: "ig" },
        });
        fireEvent.change(screen.getByLabelText("Label"), {
          target: { value: "IG" },
        });
      }
      fireEvent.submit(form);
      expect(await screen.findByText("Refused")).toBeDefined();
    });

    it.each([
      ["removePlanChannel", "Channels", "Remove"],
      ["unlinkPlanCode", "Referral codes", "Unlink"],
      ["removePlanStoreOffer", "Store offers", "Remove"],
    ])("shows the API message when %s fails", async (key, title, button) => {
      (
        api as unknown as Record<
          string,
          { mockRejectedValue: (e: Error) => void }
        >
      )[key]!.mockRejectedValue(new Error("Refused"));
      renderPage(<AdminMarketingPlan />);
      const section = within(await panel(title));
      fireEvent.click(await section.findByRole("button", { name: button }));
      expect(await section.findByText("Refused")).toBeDefined();
    });

    it("shows the API message when a status change is refused", async () => {
      api.updateMarketingPlan.mockRejectedValue(new Error("Refused"));
      renderPage(<AdminMarketingPlan />);
      fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
      expect(await screen.findByText("Refused")).toBeDefined();
    });
  });

  it("carries every store-offer field the form offers", async () => {
    renderPage(<AdminMarketingPlan />);
    const form = await screen.findByLabelText("Record store offer");
    const set = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    set("Platform", "android");
    set("Offer code", "FOUNDERS12");
    set("Tier", "premium_plus");
    set("Duration (months)", "12");
    set("Price charged (£)", "100");
    set("Max redemptions", "50");
    set("Expires", "2026-12-31");
    set("Offer channel", "meta");
    set("Redemption URL", "  https://play.google.com/redeem?code=X  ");
    fireEvent.submit(form);
    await waitFor(() => expect(api.addPlanStoreOffer).toHaveBeenCalled());
    expect(api.addPlanStoreOffer.mock.calls[0]![1]).toEqual({
      platform: "android",
      code: "FOUNDERS12",
      tierName: "premium_plus",
      durationMonths: 12,
      priceMinor: 10000,
      maxRedemptions: 50,
      expiresOn: "2026-12-31",
      campaignSlug: "meta",
      redemptionUrl: "https://play.google.com/redeem?code=X",
      notes: null,
    });
  });

  it("carries every weekly-numbers field the form offers", async () => {
    renderPage(<AdminMarketingPlan />);
    const form = await screen.findByLabelText("Record weekly numbers");
    const set = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    set("Date", "2026-09-19");
    set("Spend (£)", "10");
    set("Impressions", "4000");
    set("Clicks", "80");
    set("Landing views", "60");
    set("Store redemptions", "2");
    set("Notes", "  Week two  ");
    fireEvent.submit(form);
    await waitFor(() => expect(api.upsertPlanMetric).toHaveBeenCalled());
    expect(api.upsertPlanMetric.mock.calls[0]![1]).toEqual({
      campaignSlug: null,
      metricDate: "2026-09-19",
      spendMinor: 1000,
      impressions: 4000,
      clicks: 80,
      landingViews: 60,
      storeRedemptions: 2,
      notes: "Week two",
    });
  });

  it("shows a dash for each metric field left empty", async () => {
    api.marketingPlan.mockResolvedValue({
      ...detail,
      metrics: [
        {
          id: "m2",
          campaignSlug: null,
          metricDate: "2026-09-12",
          spendMinor: null,
          impressions: null,
          clicks: null,
          landingViews: null,
          storeRedemptions: null,
          notes: null,
        },
      ],
    });
    renderPage(<AdminMarketingPlan />);
    const section = within(await panel("Weekly numbers"));
    expect(await section.findByText("whole plan")).toBeDefined();
    expect(section.getAllByText("—").length).toBeGreaterThanOrEqual(6);
  });

  it("shows a dash for a channel with no placement recorded", async () => {
    api.marketingPlan.mockResolvedValue({
      ...detail,
      channels: [{ ...detail.channels[0]!, placement: null }],
      codes: [{ ...detail.codes[0]!, campaignSlug: null, partnerName: null }],
    });
    renderPage(<AdminMarketingPlan />);
    const section = within(await panel("Channels"));
    expect(await section.findByText("—")).toBeDefined();
  });

  it("shows zeroes for a code linked before it has produced anything", async () => {
    // The link and the attribution are separate reads; a code with no rows yet
    // must render as zero rather than as a blank row.
    api.marketingPlan.mockResolvedValue({
      ...detail,
      attribution: { ...detail.attribution, codes: [] },
    });
    renderPage(<AdminMarketingPlan />);
    const section = within(await panel("Attribution"));
    const row = await section.findByRole("row", { name: /^METAFOUND / });
    expect(
      within(row)
        .getAllByRole("cell")
        .slice(1)
        .map((c) => c.textContent),
    ).toEqual(["0", "0", "0", "0", "0", "0", "£0.00"]);
  });

  it("names the Play store for an Android offer", async () => {
    api.marketingPlan.mockResolvedValue({
      ...detail,
      storeOffers: [{ ...detail.storeOffers[0]!, platform: "android" }],
    });
    renderPage(<AdminMarketingPlan />);
    const section = within(await panel("Store offers"));
    const row = await section.findByRole("row", { name: /FOUNDERS6/ });
    expect(within(row).getAllByRole("cell")[0]!.textContent).toBe("Play");
  });

  it("still renders while the campaign slug list is loading", async () => {
    // The slug list is its own query; the page must not blank out waiting for
    // it, or every panel would flash empty on each navigation.
    api.campaignSlugs.mockReturnValue(new Promise(() => {}));
    renderPage(<AdminMarketingPlan />);
    expect(await screen.findByText("Founders' offer — Sep 2026")).toBeDefined();
    const select = screen.getByLabelText("Campaign slug");
    expect(select.querySelectorAll("option")).toHaveLength(1);
  });

  it("surfaces a load failure instead of rendering an empty plan", async () => {
    api.marketingPlan.mockRejectedValue(new Error("Not found"));
    renderPage(<AdminMarketingPlan />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Not found",
    );
  });
});
