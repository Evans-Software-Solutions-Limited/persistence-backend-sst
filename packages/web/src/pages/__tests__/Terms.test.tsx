import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Terms from "../Terms";

describe("Terms", () => {
  it("distinguishes renewable app-store subscriptions from fixed-term offers", () => {
    renderPage(<Terms />, { route: "/terms" });

    expect(
      screen.getByText(/Standard in-app subscriptions.*renew automatically/s),
    ).toBeDefined();
    expect(
      screen.getByText(/founding offer.*do not renew automatically/s),
    ).toBeDefined();
  });
});
