import { ClientsContainer } from "../../../src/ui/containers/ClientsContainer";

/**
 * Thin route wrapper: this file IS the Clients tab. Real client-
 * management UI lands in milestone M8; M10.5 Wave 2 only wires the
 * feature-gate stub.
 *
 * The tab itself is conditionally registered in `_layout.tsx` —
 * non-trainer users never see the icon in the tab bar. The route file
 * still exists so the M10 post-payment Success screen's "Manage
 * Clients" CTA can `router.replace('/(app)/(tabs)/clients')` after a
 * trainer subscription activates.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Per-screen feature-gate integration (Wave 2)
 * Closes: specs/11-payments-subscriptions/tasks.md Phase 12 (m105-gates-trainer)
 * Satisfies: specs/11-payments-subscriptions/requirements.md AC 4.6, 6.1
 */
export default function ClientsTab() {
  return <ClientsContainer />;
}
