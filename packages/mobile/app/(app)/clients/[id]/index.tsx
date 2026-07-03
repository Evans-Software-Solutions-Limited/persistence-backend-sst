import { ClientDetailContainer } from "../../../../src/ui/containers/ClientDetailContainer";

/**
 * `/clients/[id]` — per-client detail.
 *
 * Interim slice (10-trainer-features 10.9.3): body trend + Log weight. The
 * full 5-tab Client Detail screen is a later slice; see
 * <ClientDetailPresenter> for what's deliberately deferred.
 */
export default function ClientDetailScreen() {
  return <ClientDetailContainer />;
}
