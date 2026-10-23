import {
  pendingTogetherJoinRoute,
  usePendingTogetherJoin,
} from "../pending-together-join";

/** Carries a Together join link through sign-in (PER-60 cold start). In memory only. */
describe("usePendingTogetherJoin", () => {
  beforeEach(() => usePendingTogetherJoin.getState().reset());

  it("defaults to nothing pending", () => {
    expect(usePendingTogetherJoin.getState().pending).toBeNull();
  });

  it("stashes a link, peeks without clearing, and clears on demand", () => {
    const link = {
      connection: "local" as const,
      invitation: "z1.abc",
      transport: "nearby" as const,
    };
    usePendingTogetherJoin.getState().setPending(link);
    expect(usePendingTogetherJoin.getState().pending).toEqual(link);
    expect(usePendingTogetherJoin.getState().pending).toEqual(link);
    usePendingTogetherJoin.getState().clear();
    expect(usePendingTogetherJoin.getState().pending).toBeNull();
    usePendingTogetherJoin.getState().setPending(link);
    usePendingTogetherJoin.getState().reset();
    expect(usePendingTogetherJoin.getState().pending).toBeNull();
  });

  it("builds the join route with the invitation encoded and the transport only when present", () => {
    expect(
      pendingTogetherJoinRoute({ connection: "online", invitation: "a b&c" }),
    ).toBe("/(app)/together/join?connection=online&invitation=a%20b%26c");
    expect(
      pendingTogetherJoinRoute({
        connection: "local",
        invitation: "x",
        transport: "lan",
      }),
    ).toBe("/(app)/together/join?connection=local&invitation=x&transport=lan");
  });
});
