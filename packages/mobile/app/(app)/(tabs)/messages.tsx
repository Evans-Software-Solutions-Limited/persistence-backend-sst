import { CoachMessagesPresenter } from "@/ui/presenters/coachForms/CoachMessagesPresenter";

/**
 * Messages tab — coach mode only (PER-129 K shell). "In development" until
 * chat ships (PER-92). Hidden (href: null) in athlete mode.
 */
export default function MessagesTab() {
  return <CoachMessagesPresenter />;
}
