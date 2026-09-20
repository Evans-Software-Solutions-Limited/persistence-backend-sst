import { CampaignContext } from "../campaign";
import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { FoundingPlans } from "../FoundingPlans";
import { FOUNDING_COPY } from "../foundingOffer";
const assign = vi.fn();
beforeEach(() => {
  assign.mockClear();
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => vi.unstubAllGlobals());
it.each([
  ["Premium, Six months — £30", "premium", 6],
  ["Premium+, One year — £100", "premium_plus", 12],
])("takes %s to a fresh secure sign-in document", (label, tier, months) => {
  renderPage(<FoundingPlans />);
  fireEvent.click(screen.getByRole("button", { name: label as string }));
  expect(assign).toHaveBeenCalledWith(
    `/founding/access?tier=${tier}&months=${months}`,
  );
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("offers web activation for existing purchases", () => {
  renderPage(<FoundingPlans />);
  expect(
    screen
      .getByRole("link", { name: /Already purchased/ })
      .getAttribute("href"),
  ).toBe("/founding/access");
  expect(screen.getByText(FOUNDING_COPY.plansCaption)).toBeDefined();
});
it("does not open checkout when sold out", () => {
  renderPage(<FoundingPlans soldOut />);
  fireEvent.click(
    screen.getByRole("button", { name: "Premium, Six months — £30" }),
  );
  expect(assign).not.toHaveBeenCalled();
});

it("preserves the campaign when entering secure checkout", () => {
  renderPage(
    <CampaignContext.Provider value="meta">
      <FoundingPlans />
    </CampaignContext.Provider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Premium, Six months — £30" }),
  );
  expect(assign).toHaveBeenCalledWith(
    "/founding/access?tier=premium&months=6&campaign=meta",
  );
});
