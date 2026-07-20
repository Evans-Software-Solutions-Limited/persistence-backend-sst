import { SetNewPasswordContainer } from "../../src/ui/containers/SetNewPasswordContainer";

/**
 * /(auth)/set-new-password — where a password-recovery link lands the user
 * after AuthCallbackContainer establishes the session and flags
 * [[password-recovery]]. AuthGate diverts here (instead of the tabs) until the
 * password is changed.
 */
export default function SetNewPassword() {
  return <SetNewPasswordContainer />;
}
