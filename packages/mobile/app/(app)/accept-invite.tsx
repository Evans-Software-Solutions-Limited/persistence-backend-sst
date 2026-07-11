import { AcceptInviteContainer } from "@/ui/containers/AcceptInviteContainer";

/**
 * /accept-invite — the athlete's invite-code redeem screen (Coach Mode
 * Phase 8 — invite/QR, 10-trainer-features). Target of the
 * `persistencemobile://accept-invite?code=…` deep link (resolved by
 * `resolveNotificationRoute` / `SCHEME_HOSTS["accept-invite"]`), and of the
 * You screen's "Have a coach's code?" entry.
 */
export default function AcceptInviteScreen() {
  return <AcceptInviteContainer />;
}
