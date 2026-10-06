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
  fireEvent.press(r.getByText("Nearby phones"));
  expect(change).toHaveBeenLastCalledWith("local");
});
it("keeps local connection available when cloud is absent", () => {
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
  expect(change).toHaveBeenCalledWith("local");
});
