import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import OrganisationAdmin from "../OrganisationAdmin";

describe("OrganisationAdmin", () => {
  it("shows aggregate metrics without member health data", () => {
    const { container } = renderPage(<OrganisationAdmin />);
    expect(screen.getByText("41")).toBeDefined();
    expect(screen.getByText("1,842")).toBeDefined();
    expect(container.textContent).not.toMatch(/weight|calories|body fat/i);
  });

  it("suppresses engagement below a five-member cohort", () => {
    renderPage(<OrganisationAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "suppressed" }));

    expect(screen.getByTestId("suppressed-metrics")).toBeDefined();
    expect(screen.queryByText("1,842")).toBeNull();
    expect(screen.getByText(/at least five activated members/i)).toBeDefined();
  });

  it("disables invites when the seat limit is reached", () => {
    renderPage(<OrganisationAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "limit" }));

    expect(
      (
        screen.getByRole("button", {
          name: /invite members/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/seat limit reached/i)).toBeDefined();
  });
});
