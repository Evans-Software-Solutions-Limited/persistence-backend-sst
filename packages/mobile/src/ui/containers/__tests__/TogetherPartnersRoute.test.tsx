import React from "react";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import TogetherPartnersRoute from "../../../../app/(app)/together/partners";
jest.mock("../TogetherPartnersContainer", () => ({
  TogetherPartnersContainer: () => {
    const { Text } = jest.requireActual("react-native");
    return <Text>Partner management</Text>;
  },
}));
jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));
it("keeps production disabled even when its public test flag is true", () => {
  const original = __DEV__;
  const env = process.env.EXPO_PUBLIC_TOGETHER_TEST;
  try {
    Object.assign(global, { __DEV__: false });
    process.env.EXPO_PUBLIC_TOGETHER_TEST = "true";
    const r = renderWithTheme(<TogetherPartnersRoute />);
    expect(r.getByText(/unavailable in this app version/)).toBeTruthy();
    expect(r.queryByText("Partner management")).toBeNull();
  } finally {
    Object.assign(global, { __DEV__: original });
    if (env === undefined) delete process.env.EXPO_PUBLIC_TOGETHER_TEST;
    else process.env.EXPO_PUBLIC_TOGETHER_TEST = env;
  }
});
it("allows only explicit development test opt-in", () => {
  const original = __DEV__;
  const env = process.env.EXPO_PUBLIC_TOGETHER_TEST;
  try {
    Object.assign(global, { __DEV__: true });
    process.env.EXPO_PUBLIC_TOGETHER_TEST = "true";
    const r = renderWithTheme(<TogetherPartnersRoute />);
    expect(r.getByText("Partner management")).toBeTruthy();
    process.env.EXPO_PUBLIC_TOGETHER_TEST = "false";
    r.rerender(<TogetherPartnersRoute />);
    expect(r.queryByText("Partner management")).toBeNull();
  } finally {
    Object.assign(global, { __DEV__: original });
    if (env === undefined) delete process.env.EXPO_PUBLIC_TOGETHER_TEST;
    else process.env.EXPO_PUBLIC_TOGETHER_TEST = env;
  }
});
