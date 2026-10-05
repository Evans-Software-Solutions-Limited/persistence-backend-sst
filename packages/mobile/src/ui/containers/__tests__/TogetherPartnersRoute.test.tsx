import TogetherPartnersRoute from "../../../../app/(app)/together/partners";
import { TogetherPartnersContainer } from "../TogetherPartnersContainer";
jest.mock("../TogetherPartnersContainer", () => ({
  TogetherPartnersContainer: jest.fn(),
}));
it("uses the shared partner container without route-specific version or development gates", () => {
  expect(TogetherPartnersRoute).toBe(TogetherPartnersContainer);
});
