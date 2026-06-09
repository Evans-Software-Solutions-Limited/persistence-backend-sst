import { NotificationsListContainer } from "@/ui/containers/NotificationsListContainer";

/**
 * Notifications list route — pushed over the tab bar from the Home bell
 * (09.5) and from notification deep-links (09.6).
 *
 * Spec: specs/09-notifications-social/requirements.md STORY-002 AC 2.1
 */
export default function NotificationsScreen() {
  return <NotificationsListContainer />;
}
