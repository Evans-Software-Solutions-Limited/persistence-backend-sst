import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";

const api = vi.hoisted(() => ({
  marketingPlans: vi.fn(),
  createMarketingPlan: vi.fn(),
}));
vi.mock("../adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adminApi")>();
  return { ...actual, adminApi: { ...actual.adminApi, ...api } };
});

import { AdminMarketing } from "../pages/AdminMarketing";

const basePlan = {
  id: "p1",
  name: "Founders' offer — Sep 2026",
  slug: "founders-sep-2026",
  status: "active" as const,
  objective: null,
  hypothesis: null,
  decisionRule: null,
  offerLanes: ["founding_access", "store_offer"],
  budgetCapMinor: 21000,
  currency: "GBP",
  startsOn: "2026-09-01",
  endsOn: "2026-09-30",
  briefMd: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  channelsCount: 2,
  spendMinor: 4200,
  storeClicks: 31,
  grants: 4,
};

describe("AdminMarketing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.marketingPlans.mockResolvedValue([basePlan]);
  });

  it("lists a plan with its roll-ups", async () => {
    renderPage(<AdminMarketing />);
    expect(await screen.findByText("Founders' offer — Sep 2026")).toBeDefined();
    expect(screen.getByText("founders-sep-2026")).toBeDefined();
    expect(screen.getByText("31")).toBeDefined();
    expect(screen.getByText(/£42\.00 \/ £210\.00/)).toBeDefined();
  });

  it("shows a plan's money in the plan's own currency", async () => {
    // Every fixture being GBP — which is also `formatMinor`'s default — is
    // what let the currency go missing here unnoticed in the first place.
    api.marketingPlans.mockResolvedValue([{ ...basePlan, currency: "USD" }]);
    renderPage(<AdminMarketing />);
    expect(await screen.findByText(/US\$42\.00 \/ US\$210\.00/)).toBeDefined();
  });

  it("names the lanes rather than showing their raw keys", async () => {
    renderPage(<AdminMarketing />);
    expect(
      await screen.findByText("Founding access, Store offer"),
    ).toBeDefined();
  });

  it("shows spend alone when the plan has no budget cap", async () => {
    api.marketingPlans.mockResolvedValue([
      { ...basePlan, budgetCapMinor: null },
    ]);
    renderPage(<AdminMarketing />);
    expect(await screen.findByText("£42.00")).toBeDefined();
  });

  it("shows nothing about revenue, CAC or ROAS", async () => {
    // Grants are access, not sales. There is no price to build these from and
    // presenting one would misdescribe the offer.
    const { container } = renderPage(<AdminMarketing />);
    await screen.findByText("Founders' offer — Sep 2026");
    expect(container.textContent).not.toMatch(/revenue|ROAS|CAC/i);
  });

  it("shows a dash when a plan runs no lane at all", async () => {
    api.marketingPlans.mockResolvedValue([{ ...basePlan, offerLanes: [] }]);
    renderPage(<AdminMarketing />);
    await screen.findByText("Founders' offer — Sep 2026");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows an unrecognised lane key as itself rather than blank", async () => {
    api.marketingPlans.mockResolvedValue([
      { ...basePlan, offerLanes: ["future_lane"] },
    ]);
    renderPage(<AdminMarketing />);
    expect(await screen.findByText("future_lane")).toBeDefined();
  });

  it("opens the new plan form from the header button", async () => {
    renderPage(<AdminMarketing />);
    fireEvent.click(await screen.findByRole("button", { name: "New plan" }));
    expect(await screen.findByLabelText("New marketing plan")).toBeDefined();
  });

  it("prompts for a first plan when there are none", async () => {
    api.marketingPlans.mockResolvedValue([]);
    renderPage(<AdminMarketing />);
    expect(await screen.findByText(/No plans yet/)).toBeDefined();
  });

  it("surfaces a load failure", async () => {
    api.marketingPlans.mockRejectedValue(new Error("Nope"));
    renderPage(<AdminMarketing />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Nope",
    );
  });

  it("refetches when the status filter changes", async () => {
    renderPage(<AdminMarketing />);
    await screen.findByText("Founders' offer — Sep 2026");
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "paused" },
    });
    await waitFor(() =>
      expect(api.marketingPlans).toHaveBeenCalledWith("paused"),
    );
  });

  describe("the new plan form", () => {
    beforeEach(() => {
      api.createMarketingPlan.mockResolvedValue({ ...basePlan, id: "p2" });
    });

    async function openForm() {
      renderPage(<AdminMarketing />, { route: "/admin/marketing?new=1" });
      return screen.findByLabelText("New marketing plan");
    }

    it("suggests a slug from the name until the slug is edited by hand", async () => {
      await openForm();
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Founders' offer — Sep 2026" },
      });
      expect(screen.getByLabelText("Slug")).toHaveProperty(
        "value",
        "founders-offer-sep-2026",
      );
      fireEvent.change(screen.getByLabelText("Slug"), {
        target: { value: "custom" },
      });
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Renamed" },
      });
      expect(screen.getByLabelText("Slug")).toHaveProperty("value", "custom");
    });

    it("sends the budget cap in minor units and the lanes as chosen", async () => {
      await openForm();
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Founders" },
      });
      fireEvent.change(screen.getByLabelText("Budget cap (£, optional)"), {
        target: { value: "210" },
      });
      fireEvent.click(screen.getByLabelText("Store offer"));
      fireEvent.submit(screen.getByLabelText("New marketing plan"));
      await waitFor(() => expect(api.createMarketingPlan).toHaveBeenCalled());
      expect(api.createMarketingPlan.mock.calls[0]![0]).toMatchObject({
        name: "Founders",
        slug: "founders",
        budgetCapMinor: 21000,
        offerLanes: ["founding_access", "store_offer"],
      });
    });

    it("sends null rather than a blank for every untouched optional field", async () => {
      await openForm();
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Founders" },
      });
      fireEvent.submit(screen.getByLabelText("New marketing plan"));
      await waitFor(() => expect(api.createMarketingPlan).toHaveBeenCalled());
      expect(api.createMarketingPlan.mock.calls[0]![0]).toMatchObject({
        budgetCapMinor: null,
        startsOn: null,
        endsOn: null,
        objective: null,
        hypothesis: null,
        decisionRule: null,
        briefMd: null,
      });
    });

    it("shows the API's message when creation is refused", async () => {
      api.createMarketingPlan.mockRejectedValue(
        new Error("A plan with that slug already exists"),
      );
      await openForm();
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Founders" },
      });
      fireEvent.submit(screen.getByLabelText("New marketing plan"));
      expect(
        await screen.findByText("A plan with that slug already exists"),
      ).toBeDefined();
    });

    it("carries every field the form offers through to the API", async () => {
      await openForm();
      const set = (label: string, value: string) =>
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      set("Name", "Founders");
      set("Starts", "2026-09-01");
      set("Ends", "2026-09-30");
      set("Objective", "  Test the Meta rail  ");
      set("Hypothesis", "  Cold traffic redeems  ");
      set("Decision rule", "  Stop at £210  ");
      set("Brief (markdown)", "  # Brief  ");
      fireEvent.submit(screen.getByLabelText("New marketing plan"));
      await waitFor(() => expect(api.createMarketingPlan).toHaveBeenCalled());
      expect(api.createMarketingPlan.mock.calls[0]![0]).toMatchObject({
        startsOn: "2026-09-01",
        endsOn: "2026-09-30",
        objective: "Test the Meta rail",
        hypothesis: "Cold traffic redeems",
        decisionRule: "Stop at £210",
        briefMd: "# Brief",
      });
    });

    it("drops a lane when its box is unticked", async () => {
      await openForm();
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Founders" },
      });
      fireEvent.click(screen.getByLabelText("Founding access"));
      fireEvent.submit(screen.getByLabelText("New marketing plan"));
      await waitFor(() => expect(api.createMarketingPlan).toHaveBeenCalled());
      expect(api.createMarketingPlan.mock.calls[0]![0]!.offerLanes).toEqual([]);
    });

    it("strips characters a slug may not contain as they are typed", async () => {
      await openForm();
      fireEvent.change(screen.getByLabelText("Slug"), {
        target: { value: "Founders Sep_2026!" },
      });
      expect(screen.getByLabelText("Slug")).toHaveProperty(
        "value",
        "founderssep2026",
      );
    });

    it("closes the form again", async () => {
      await openForm();
      fireEvent.click(screen.getByRole("button", { name: "Close form" }));
      await waitFor(() =>
        expect(screen.queryByLabelText("New marketing plan")).toBeNull(),
      );
    });

    it("never offers to create a referral or offer code", async () => {
      // Code words are Brad's. The plan form must not be a place one appears.
      const { container } = await openForm().then(() => ({
        container: document.body,
      }));
      expect(container.textContent).not.toMatch(/referral code|offer code/i);
    });
  });
});
