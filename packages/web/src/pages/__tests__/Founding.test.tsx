import { screen, within } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import App from "@/App";
import Founding from "../Founding";
import { FOUNDING_OFFER_CLOSES } from "@/marketing/foundingOffer";

/**
 * `/founding` sells again (FOUNDING-OFFER BRIEF § 2, 2026-09-05 amendment).
 *
 * This file previously asserted the OPPOSITE — that no price and no purchase
 * control appeared — under the 2026-09-04 wording. That decision was reversed,
 * so those assertions are gone rather than weakened, and the ones below hold
 * the new contract: four terms, a real payment step, and a page that closes
 * itself on 30 September without a deploy.
 */
function availability(consumer = { used: 37, cap: 200 }) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: { consumer, coach: { used: 4, cap: 20 } },
        }),
      ),
  );
}

describe("Founding", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", availability());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("offers all four terms while the offer is open", async () => {
    renderPage(<Founding />, { route: "/founding" });
    const plans = await screen.findByLabelText("Founding plans");
    const buttons = within(plans).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Choose Premium · 6 months",
      "Choose Premium · 12 months",
      "Choose Premium+ · 6 months",
      "Choose Premium+ · 12 months",
    ]);
  });

  it("shows each term's price", async () => {
    renderPage(<Founding />, { route: "/founding" });
    const plans = await screen.findByLabelText("Founding plans");
    for (const price of ["£30", "£60", "£50", "£100"]) {
      expect(within(plans).getByText(new RegExp(price))).toBeDefined();
    }
  });

  it("renders live availability", async () => {
    renderPage(<Founding />, { route: "/founding" });
    expect(await screen.findByText(/37 of 200/)).toBeDefined();
    expect(screen.getByText(/4 of 20/)).toBeDefined();
  });

  it("does not invent a count when availability fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    renderPage(<Founding />, { route: "/founding" });
    expect(await screen.findAllByText(/temporarily unavailable/)).toHaveLength(
      2,
    );
  });

  it("still shows the plans while the count is unknown", async () => {
    // A failed availability read must not hide the thing the page is for; the
    // checkout route re-checks the pool under its lock anyway.
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    renderPage(<Founding />, { route: "/founding" });
    expect(await screen.findByLabelText("Founding plans")).toBeDefined();
    const buttons = within(
      screen.getByLabelText("Founding plans"),
    ).getAllByRole("button");
    expect(buttons.every((b) => !b.hasAttribute("disabled"))).toBe(true);
  });

  it("disables every plan once the pool is full", async () => {
    vi.stubGlobal("fetch", availability({ used: 200, cap: 200 }));
    renderPage(<Founding />, { route: "/founding" });
    // Wait for the count to arrive — the page renders the plans first and only
    // learns the pool is full once the availability read lands.
    expect(
      await screen.findByText(/all founding places have been taken/i),
    ).toBeDefined();
    const buttons = within(
      screen.getByLabelText("Founding plans"),
    ).getAllByRole("button");
    expect(buttons.every((b) => b.hasAttribute("disabled"))).toBe(true);
  });

  it("says so when the buyer came back from a cancelled payment", async () => {
    renderPage(<Founding />, { route: "/founding?cancelled=1" });
    expect(await screen.findByText(/nothing has been charged/i)).toBeDefined();
  });

  describe("after 30 September", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FOUNDING_OFFER_CLOSES.getTime() + 1000));
    });

    it("shows the closed state and no way to pay", () => {
      renderPage(<Founding />, { route: "/founding" });
      expect(screen.queryByLabelText("Founding plans")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Choose/ })).toBeNull();
    });

    it("stops asking the API how many places are left", () => {
      // Nothing is on sale, so the read has no purpose.
      renderPage(<Founding />, { route: "/founding" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("still shows the plans on the last second before the close", () => {
      vi.setSystemTime(FOUNDING_OFFER_CLOSES);
      renderPage(<Founding />, { route: "/founding" });
      expect(screen.getByLabelText("Founding plans")).toBeDefined();
    });
  });

  it("routes /founding to the founding page", () => {
    renderPage(<App />, { route: "/founding" });
    expect(screen.getAllByText("Founding offer").length).toBeGreaterThan(0);
  });

  it("routes /founding/thanks to the thanks page", () => {
    renderPage(<App />, { route: "/founding/thanks" });
    expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
  });
});
