/** @jest-environment node */
import { requireOptionalNativeModule } from "expo";
jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));
function load() {
  let result: typeof import("../index");
  jest.isolateModules(() => {
    result = jest.requireActual("../index");
  });
  return result!;
}
it.each([null, { available: false }])(
  "remains unavailable without a compatible adapter",
  (native) => {
    jest.mocked(requireOptionalNativeModule).mockReturnValue(native as never);
    expect(load().togetherNearby).toBeNull();
  },
);
it("initializes no transport on import and forwards host start only when explicitly called", async () => {
  const native = { available: true, startHost: jest.fn(async () => {}) };
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native as never);
  const result = load();
  expect(native.startHost).not.toHaveBeenCalled();
  await result.togetherNearby!.startHost("lobby");
  expect(native.startHost).toHaveBeenCalledWith("lobby");
});
