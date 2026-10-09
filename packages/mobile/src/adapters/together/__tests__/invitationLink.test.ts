import Constants from "expo-constants";
import { togetherInvitationLink } from "../invitationLink";
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { scheme: "persistencemobile-staging" } },
}));
const value = { connection: "online" as const, invitation: "token" };
it("links to the installed staging distribution", () => {
  expect(togetherInvitationLink(value)).toBe(
    "persistencemobile-staging://together/join?connection=online&invitation=token",
  );
});
it("supports scheme arrays and the production fallback", () => {
  (Constants.expoConfig as any).scheme = ["persistencemobile-play-test"];
  expect(togetherInvitationLink(value)).toContain(
    "persistencemobile-play-test://",
  );
  (Constants.expoConfig as any).scheme = undefined;
  expect(togetherInvitationLink(value)).toContain("persistencemobile://");
});
