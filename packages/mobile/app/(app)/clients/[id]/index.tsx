import { ComingSoon } from "../../../../src/ui/components/ComingSoon";

/**
 * `/clients/[id]` — per-client detail stub.
 *
 * The Clients roster (M8 / 10-trainer-features Clients-list slice) pushes here
 * on a row tap so the navigation resolves. The real 5-tab Client Detail screen
 * is the NEXT slice (10.9.3); until then this renders an intentional
 * "Coming Soon" placeholder.
 *
 * Spec: specs/milestones/M8-coach/CLIENTS_LIST_BRIEF.md (Frontend slice §4).
 */
export default function ClientDetailScreen() {
  return (
    <ComingSoon
      icon="person-outline"
      title="Client"
      description="The full client detail screen arrives in the next slice."
      testID="client-detail-coming-soon"
    />
  );
}
