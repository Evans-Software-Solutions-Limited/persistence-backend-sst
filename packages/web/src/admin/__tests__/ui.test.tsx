import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorState, Meter, Table } from "../ui";

describe("admin shared UI", () => {
  it("shows a useful alert when the API throws an unknown value", () => {
    render(<ErrorState error={null} />);
    expect(screen.getByRole("alert").textContent).toBe("Something went wrong");
  });

  it("keeps a zero-capacity meter finite and labelled", () => {
    const { container } = render(<Meter used={0} cap={0} />);
    expect(screen.getByLabelText("0 of 0 used")).toBeTruthy();
    expect(container.querySelector<HTMLElement>("[style]")?.style.width).toBe(
      "0%",
    );
  });

  it("makes wide data tables keyboard reachable with labelled column headers", () => {
    render(
      <Table head={["Email", "Status"]}>
        <tr>
          <td>member@example.com</td>
          <td>active</td>
        </tr>
      </Table>,
    );
    expect(screen.getByRole("region", { name: "Email, Status" }).tabIndex).toBe(
      0,
    );
    expect(
      screen.getByRole("columnheader", { name: "Email" }).getAttribute("scope"),
    ).toBe("col");
  });
});
