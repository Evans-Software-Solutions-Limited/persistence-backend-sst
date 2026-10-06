import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherConnectionChoice } from "../TogetherConnectionChoice";

it("separates online opt-in from a default local connection", () => {
  const change = jest.fn();
  const r = renderWithTheme(
    <TogetherConnectionChoice
      value="local"
      onChange={change}
      onlineAvailable
      transport="nearby"
    />,
  );
  expect(r.getByText(/No internet needed/)).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
  expect(
    r.getByRole("radio", { name: "Nearby phones", checked: true }),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Online · internet required"));
  expect(change).toHaveBeenLastCalledWith("online");
  r.rerender(
    <TogetherConnectionChoice
      value="online"
      onChange={change}
      onlineAvailable
      transport="nearby"
    />,
  );
  expect(
    r.getByText("Your training partners can find this session online."),
  ).toBeTruthy();
  expect(
    r.getByRole("radio", { name: "Online · internet required", checked: true }),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Nearby phones"));
  expect(change).toHaveBeenLastCalledWith("local");
});
it("shows information without a dead button when local is the only connection", () => {
  const change = jest.fn();
  const r = renderWithTheme(
    <TogetherConnectionChoice
      value="local"
      onChange={change}
      onlineAvailable={false}
    />,
  );
  expect(r.queryByText("Online · internet required")).toBeNull();
  fireEvent.press(r.getByText("Same Wi-Fi or hotspot"));
  expect(change).not.toHaveBeenCalled();
  expect(r.queryAllByRole("button")).toHaveLength(0);
  expect(r.queryAllByRole("radio")).toHaveLength(0);
  expect(r.getByText(/Connect both phones to the same Wi-Fi/)).toBeTruthy();
});
