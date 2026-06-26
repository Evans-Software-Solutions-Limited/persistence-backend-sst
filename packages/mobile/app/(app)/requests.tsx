import { RequestsContainer } from "@/ui/containers/RequestsContainer";

/**
 * /requests — incoming coach requests the client can accept or decline
 * (10-trainer-features). Target of the `pt_request` / `physio_request`
 * notification deeplink (persistencemobile://requests → /(app)/requests,
 * resolved by `resolveNotificationRoute`).
 */
export default function RequestsScreen() {
  return <RequestsContainer />;
}
