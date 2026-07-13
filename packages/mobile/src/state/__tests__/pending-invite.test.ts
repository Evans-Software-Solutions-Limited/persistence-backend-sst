import { usePendingInvite } from "../pending-invite";

/**
 * usePendingInvite slice tests — carries a coach invite code through auth
 * (device-QA #2 follow-up). In-memory (no persistence) so a stale code can't
 * bleed across accounts on a shared device; see the store's header comment.
 */
describe("usePendingInvite", () => {
  beforeEach(() => {
    usePendingInvite.getState().reset();
  });

  it("defaults to no pending code", () => {
    expect(usePendingInvite.getState().pendingCode).toBeNull();
  });

  it("setPendingCode stashes the code", () => {
    usePendingInvite.getState().setPendingCode("AB23CD");
    expect(usePendingInvite.getState().pendingCode).toBe("AB23CD");
  });

  it("clearPendingCode clears the stash", () => {
    usePendingInvite.getState().setPendingCode("AB23CD");
    usePendingInvite.getState().clearPendingCode();
    expect(usePendingInvite.getState().pendingCode).toBeNull();
  });

  it("reset clears the stash (used by signOut)", () => {
    usePendingInvite.getState().setPendingCode("AB23CD");
    usePendingInvite.getState().reset();
    expect(usePendingInvite.getState().pendingCode).toBeNull();
  });

  it("reading pendingCode does NOT clear it (peek — AuthGate relies on this)", () => {
    usePendingInvite.getState().setPendingCode("AB23CD");
    expect(usePendingInvite.getState().pendingCode).toBe("AB23CD");
    // A second read still returns it (no consume-on-read).
    expect(usePendingInvite.getState().pendingCode).toBe("AB23CD");
  });
});
