import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherConnectionChoice } from "../TogetherConnectionChoice";

it("offers exactly Nearby and Online, with Nearby the default", () => {
  const change = jest.fn();
  const r = renderWithTheme(
    <TogetherConnectionChoice
      value="local"
      onChange={change}
      onlineAvailable
    />,
  );
  expect(r.getByText(/No internet needed/)).toBeTruthy();
  expect(r.queryByText(/Wi-Fi|hotspot/)).toBeNull();
  expect(r.queryAllByRole("radio")).toHaveLength(2);
  expect(change).not.toHaveBeenCalled();
  expect(
    r.getByRole("radio", {
      name: "Nearby · no internet needed",
      checked: true,
    }),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Online · internet required"));
  expect(change).toHaveBeenLastCalledWith("online");
  r.rerender(
    <TogetherConnectionChoice
      value="online"
      onChange={change}
      onlineAvailable
    />,
  );
  expect(
    r.getByText(/Partners join online through your invitation/),
  ).toBeTruthy();
  expect(
    r.getByRole("radio", { name: "Online · internet required", checked: true }),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Nearby · no internet needed"));
  expect(change).toHaveBeenLastCalledWith("local");
});
it("shows information without a dead button when Nearby is the only connection", () => {
  const change = jest.fn();
  const r = renderWithTheme(
    <TogetherConnectionChoice
      value="local"
      onChange={change}
      onlineAvailable={false}
    />,
  );
  expect(r.queryByText("Online · internet required")).toBeNull();
  fireEvent.press(r.getByText("Nearby · no internet needed"));
  expect(change).not.toHaveBeenCalled();
  expect(r.queryAllByRole("button")).toHaveLength(0);
  expect(r.queryAllByRole("radio")).toHaveLength(0);
  expect(r.getByText(/Keep the phones close together/)).toBeTruthy();
});
