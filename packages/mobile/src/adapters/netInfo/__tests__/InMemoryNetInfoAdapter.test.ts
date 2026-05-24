import { InMemoryNetInfoAdapter } from "./InMemoryNetInfoAdapter";

describe("InMemoryNetInfoAdapter", () => {
  it("defaults to connected:true when no initial value is supplied", async () => {
    const adapter = new InMemoryNetInfoAdapter();
    await expect(adapter.isConnected()).resolves.toBe(true);
  });

  it("honours the initialConnected ctor arg", async () => {
    const adapter = new InMemoryNetInfoAdapter(false);
    await expect(adapter.isConnected()).resolves.toBe(false);
  });

  it("setConnected(false) flips isConnected to false", async () => {
    const adapter = new InMemoryNetInfoAdapter(true);
    adapter.setConnected(false);
    await expect(adapter.isConnected()).resolves.toBe(false);
  });

  it("subscribers fire on transitions only (no idempotent re-emits)", () => {
    const adapter = new InMemoryNetInfoAdapter(true);
    const listener = jest.fn();
    adapter.subscribe(listener);

    // Same state — should not fire.
    adapter.setConnected(true);
    expect(listener).not.toHaveBeenCalled();

    // Transition online → offline.
    adapter.setConnected(false);
    expect(listener).toHaveBeenCalledWith(false);
    expect(listener).toHaveBeenCalledTimes(1);

    // Same offline — should not fire.
    adapter.setConnected(false);
    expect(listener).toHaveBeenCalledTimes(1);

    // Back online.
    adapter.setConnected(true);
    expect(listener).toHaveBeenLastCalledWith(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("multiple subscribers all fire on a transition", () => {
    const adapter = new InMemoryNetInfoAdapter(true);
    const a = jest.fn();
    const b = jest.fn();
    adapter.subscribe(a);
    adapter.subscribe(b);

    adapter.setConnected(false);

    expect(a).toHaveBeenCalledWith(false);
    expect(b).toHaveBeenCalledWith(false);
  });

  it("unsubscribe stops the listener from firing on further transitions", () => {
    const adapter = new InMemoryNetInfoAdapter(true);
    const listener = jest.fn();
    const unsub = adapter.subscribe(listener);
    unsub();
    adapter.setConnected(false);
    expect(listener).not.toHaveBeenCalled();
    expect(adapter.subscriberCount).toBe(0);
  });

  it("subscriberCount reflects active subscriptions", () => {
    const adapter = new InMemoryNetInfoAdapter();
    expect(adapter.subscriberCount).toBe(0);

    const unsubA = adapter.subscribe(() => {});
    const unsubB = adapter.subscribe(() => {});
    expect(adapter.subscriberCount).toBe(2);

    unsubA();
    expect(adapter.subscriberCount).toBe(1);

    unsubB();
    expect(adapter.subscriberCount).toBe(0);
  });
});
