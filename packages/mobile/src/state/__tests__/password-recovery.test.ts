import { usePasswordRecovery } from "../password-recovery";

describe("usePasswordRecovery", () => {
  beforeEach(() => {
    usePasswordRecovery.setState({ pending: false });
  });

  it("starts not pending", () => {
    expect(usePasswordRecovery.getState().pending).toBe(false);
  });

  it("begin() flags a recovery in progress", () => {
    usePasswordRecovery.getState().begin();
    expect(usePasswordRecovery.getState().pending).toBe(true);
  });

  it("clear() drops the flag", () => {
    usePasswordRecovery.getState().begin();
    usePasswordRecovery.getState().clear();
    expect(usePasswordRecovery.getState().pending).toBe(false);
  });

  it("reset() drops the flag (sign-out teardown alias)", () => {
    usePasswordRecovery.getState().begin();
    usePasswordRecovery.getState().reset();
    expect(usePasswordRecovery.getState().pending).toBe(false);
  });
});
