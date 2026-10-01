import { requireOptionalNativeModule } from "expo";

jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));

const load = () => {
  let bridge: typeof import("../index");
  jest.isolateModules(() => {
    bridge = jest.requireActual("../index");
  });
  return bridge!;
};

describe("Together LAN bridge", () => {
  it("is unavailable without a compatible native binary", () => {
    jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
    expect(load().togetherLan).toBeNull();
    expect(requireOptionalNativeModule).toHaveBeenCalledWith("TogetherLan");
  });

  it("exposes the native transport and removable event subscription", async () => {
    const remove = jest.fn();
    const listener = jest.fn();
    const native = {
      startHost: jest.fn().mockResolvedValue(undefined),
      startDiscovery: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      addListener: jest.fn().mockReturnValue({ remove }),
    };
    jest.mocked(requireOptionalNativeModule).mockReturnValue(native as never);
    const bridge = load().togetherLan!;
    await bridge.startHost("lobby");
    await bridge.startDiscovery();
    await bridge.connect("endpoint");
    await bridge.send("peer", "encrypted");
    await bridge.disconnect("peer");
    await bridge.stop();
    bridge.addListener("onEvent", listener).remove();
    expect(native.startHost).toHaveBeenCalledWith("lobby");
    expect(native.connect).toHaveBeenCalledWith("endpoint");
    expect(native.send).toHaveBeenCalledWith("peer", "encrypted");
    expect(native.disconnect).toHaveBeenCalledWith("peer");
    expect(native.startDiscovery).toHaveBeenCalledTimes(1);
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(native.addListener).toHaveBeenCalledWith("onEvent", listener);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
