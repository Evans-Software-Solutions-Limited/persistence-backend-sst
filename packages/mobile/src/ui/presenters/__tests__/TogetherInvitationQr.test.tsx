import React from "react";
import { render } from "@testing-library/react-native";
import { useWindowDimensions } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { TogetherInvitationQr } from "../TogetherInvitationQr";

jest.mock("react-native-qrcode-svg", () => jest.fn(() => null));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));
it.each([
  [390, 304],
  [320, 240],
  [280, 200],
  [20, 1],
])(
  "keeps the code and white quiet zone inside a %spx screen",
  (width, size) => {
    (useWindowDimensions as jest.Mock).mockReturnValue({
      width,
      height: 844,
      scale: 1,
      fontScale: 1,
    });
    render(
      <TogetherInvitationQr value="persistencemobile://together/join?invitation=test" />,
    );
    const props = (QRCode as unknown as jest.Mock).mock.calls.at(-1)![0];
    expect(props).toEqual(
      expect.objectContaining({
        size,
        quietZone: 28,
        ecl: "M",
        color: "black",
        backgroundColor: "white",
      }),
    );
    expect(props.logo).toBeUndefined();
  },
);
