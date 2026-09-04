import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Terms from "../Terms";

describe("Terms", () => {
  it("distinguishes renewable subscriptions from administrative grants", () => {
    renderPage(<Terms />, { route: "/terms" });

    expect(
      screen.getByText(/Standard in-app subscriptions.*renew automatically/s),
    ).toBeDefined();
    expect(
      screen.getByText(
        /grant is not a purchase.*does not renew automatically/s,
      ),
    ).toBeDefined();
    expect(
      screen.getByText(/crowdfunding contribution is separate/),
    ).toBeDefined();
  });
});
