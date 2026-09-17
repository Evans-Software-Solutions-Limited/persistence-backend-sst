# Coach discovery — mobile agent

## Spec alignment

Implement [design D6](../../35-coach-discovery/design.md#d6-mobile-implementation-and-evidence) against D5 HTTP contracts; satisfy [AC1–11](../../35-coach-discovery/requirements.md), complete T7 and mobile evidence for T8. Parent spec wins.

## Ownership and work

Own directory models/ports, application commands/queries, HTTP/in-memory adapters and coach-directory containers/presenters under `packages/mobile/src/`; thin navigation routes only. Coordinate shared navigation and profile entry points with integration owner. Preserve other agents' edits.

Deliver coach listing editor/preview, hidden/public and availability controls; athlete online/local search, pagination, detail, enquiries and fresh consent-to-pending relationship journey. Use existing consent/request UI and theme conventions. Distinguish a client-origin request awaiting coach acceptance from accepting an existing trainer-origin invitation; test correct pending/active results and fresh consent in both directions. Pure presenters have no fetching or side effects.

Build against D5 fixtures for free athlete, eligible/expired coach, hidden/blocked listing, unavailable coach, empty page, version conflict, duplicate enquiry and full-capacity connection. Reuse Train Together's place, safety and permission/location adapters. Manual fallback always works. GPS is foreground/optional; no permission prompt until explicit action. Refresh stale availability; never claim connected when only enquiry acceptance or pending relationship exists. Publication/contact/consent must await online server acknowledgement; local drafts are allowed.

## Required evidence

Run relevant formatting/typecheck/lint/unit/container-adapter tests and screenshot review. Verify loading/empty/offline/error and denied/revoked permission states plus accessible controls. Complete smoke with real backend after fixtures. Report any missing provider/native binary as an external gate; Brad must explicitly authorize the specific build. No native/EAS builds or outreach.
