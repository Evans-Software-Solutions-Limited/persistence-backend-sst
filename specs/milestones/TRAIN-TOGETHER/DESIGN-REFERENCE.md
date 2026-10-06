# Together entry reference — 5 October 2026

Brad supplied `~/Downloads/export/persistence-together`, the source export of
the [reviewed Claude v2 artifact](https://claude.ai/artifact/FPeZDi5As7URgXtT1J5sM1).
The export is design reference, not production React Native code. Its historical
behaviour notes do not override the approved admission, consent and discovery
rules in the requirements and central Linear reference.

This correction preserves the existing workout-detail page and active logger.
`prototype/together/v2/entry.jsx` supplies the Together activation strip above
the detail page's Start workout button. The active workout uses the same strip.
The setup sheet opens before creating a personal workout; cancelling changes no
session. Start carries the account-bound audience choice into the actual lobby.
An existing personal workout is explicitly resumed; an existing Together
checkpoint keeps its authority instead of creating another lobby.

Reference measurements from `entry.jsx`, `v2/sheets.jsx` and
`prototype/persistence-tokens.css`:

| Element            | Reviewed value                                                                       |
| ------------------ | ------------------------------------------------------------------------------------ |
| Entry strip        | Surface background, 1px top border, 8px vertical / 14px horizontal padding, 10px gap |
| Entry icon         | 26px circle, primary-dim background, 14px users icon                                 |
| Entry copy         | 12.5px semibold title, 11.5px muted qualifier                                        |
| Audience card      | Surface 2, 13px padding, 12px radius, 9px between cards                              |
| Selection          | 16px ring, 8px cyan centre, 16px audience icon                                       |
| Choice label       | 14px semibold, white `#F4F4F8`                                                       |
| Choice description | 11.5px, muted `#8A8A98`, 2px top spacing                                             |

Approved differences remain deliberate: the Public label becomes bounded
Open nearby/on this network; accepted friends join deliberately and strangers
require approval. All athletes need qualifying paid access. PREV and delegated
logging remain separate consent. No unrestricted public directory, coached
session or inert default-setting switch is added by this correction.

Visual checks compare the exported first-run screen with real presenter
components rendered through React Native Web, including both selected audience
states. This is simulated component evidence, not native sheet geometry,
radio/network delivery or physical-device acceptance.

Evidence: [Claude reference](./evidence/ui-2026-10-05/claude-reference.png) and
[isolated component preview](./evidence/ui-2026-10-05/component-preview.png).
The preview assembles entry and sheet components for inspection; it is not a
screenshot of the full native screen.

## Full detail-page correction — 6 October

The isolated components above did not verify their placement within the existing
page: its absolute Start workout footer covered the Together row. The complete
presenter now keeps both actions in the same non-shrinking, in-flow footer.
[Before](./evidence/ui-2026-10-06/detail-before.png) reproduces the missing entry;
[after](./evidence/ui-2026-10-06/detail-after.png) shows it above Start workout at
402×874. These render the actual presenter with browser substitutes for native
icons, gradient and safe area; they prove web layout, not native device acceptance.

## Audience omission and personal sync correction — 6 October

The export's Training partners audience was incorrectly omitted by limiting the
shared choice component to local transport audiences. It is restored in detail
setup and active solo setup, and routes to cloud hosting followed by explicit
friends visibility. Add/manage training partners opens the existing social
request/accept/code/QR screen before a workout starts. Internet is required for
that cloud audience, not for authorized local Private/Open sessions. A failure
to confirm hosting or friend visibility is surfaced rather than claiming the
session is discoverable. Existing checkpoints keep their authority.

The exported persistent “Make this my default” preference is still not implemented;
this correction does not add an inert switch or claim complete prototype parity.
[Private](./evidence/ui-2026-10-06/audience-private.png) and
[Training partners selected](./evidence/ui-2026-10-06/training-partners-selected.png)
render the actual setup content, audience cards and buttons at 402×874 with a
browser sheet-shell substitute. They establish component appearance and selection,
not Gorhom/native sheet geometry or physical connection evidence.

## Train entry and offline partners — 6 October follow-up

Partner management moves out of pre-workout setup to **Train → Together →
Training partners**. The reference is `prototype/together/social.jsx`'s Together
segment and compact Friends entry, renamed Training partners in v2. Existing
Workouts/Exercises/Gyms segments remain. The hub restores workout selection and
partner-management entry points; the prototype's full open-session feed is not
implemented by this correction.

The Training partners audience uses online discovery. Private/code/QR and Open
nearby/network already support offline accepted-partner admission with valid cached
credentials and a signed friendship proof; no additional host approval is needed
when that proof is verified. Copy distinguishes these paths. This does not claim
friends-only local discovery, and never maps that audience to public advertising.

[Train entry](./evidence/ui-2026-10-06/train-partners-entry.png) renders the actual
hub/presenter with simulated navigation, account, safe-area and segment state.
[Local partner copy](./evidence/ui-2026-10-06/local-partner-copy.png) uses the actual
setup contents and a browser sheet-shell substitute. Both are 402×874 RN-web
fixtures, not native-device evidence. Earlier screenshots document prior states.

## Local Training partners and connection choice — latest 6 October correction

This supersedes the cloud-only mapping documented above. Training partners is an
audience independent of connection: local is selected by default and Online is an
explicit internet-dependent option. Local partners share the signed session code
or QR and must have valid offline access and verified friendship. These sessions
are not publicly advertised; automatic friends-only nearby discovery is still
absent. Partner management remains in Train → Together.

[Local default](./evidence/ui-2026-10-06/partners-local-connection.png) and
[explicit online choice](./evidence/ui-2026-10-06/partners-online-connection.png)
render the real setup, audience and connection components at 402×874. The new
connection section extends the approved audience cards for the missing state.
A browser shell substitutes for the native sheet; native geometry and device
connections are not verified by these screenshots.

## Start and failed-admission recovery — 6 October owner-testing correction

The workout-detail host intent now survives asynchronous authentication bootstrap.
The selected workout starts Together deliberately instead of reopening personal
setup. Local hosting promotes the existing own draft and publishes its plan before
showing the reviewed invitation; failed plan publication can retry without creating
another lobby or checkpoint. The exported v2 `sheets.jsx` invite view supplies the
QR card, Copy/Share controls, separate settings and pinned Back to my workout action.
A signed invitation replaces the prototype's invented short code. Back dismisses
the sheet and preserves the live session.

An unadmitted cloud draft no longer offers an invalid result review. Confirmed
first-attempt rejection permits explicit Continue personally; uncertain admission
retains the same request for retry to avoid duplicate results. These are approved
missing failure/recovery states, not a claim that the original server rejection is
diagnosed. [Rejected start](./evidence/ui-2026-10-06/cloud-start-rejected.png) and
[pending start](./evidence/ui-2026-10-06/cloud-start-pending.png) render the actual
recovery container/presenter with simulated auth and adapters in RN-web at 402×874.
They do not establish physical-device or native navigation acceptance.

[Local host invitation](./evidence/ui-2026-10-06/local-host-invitation.png) and
[online host invitation](./evidence/ui-2026-10-06/online-host-invitation.png)
use the real shared presenter with a browser sheet shell and sample QR matrix.
Online QR codes are scanned from Online join, which captures the token before
explicit joining. Online invitations are single-use and expire; the view clears
stale tokens and offers regeneration without another session. Local friends-only
invitations enforce signed friendship, while online friends visibility can also
admit explicitly invited non-friends after host approval. Setup copy distinguishes
these policies. No sample token or fabricated short code is used in the app.

## Partner drawer and connection controls — 6 October owner-testing correction

The v2 partners.jsx header/back/QR entry is restored with existing HeaderBar and
IconBtn components. The header is fixed; only the page body scrolls. All drawers
are siblings of the scroll area, and the root workout overlay is hidden on this
route while preserving the draft. Your code centres the QR and keeps New code,
Share and Copy reachable in the shared BottomSheet footer.

A single local connection is information rather than a dead button. Two available
connections use the same radio-card treatment as audience selection:
[local information](./evidence/ui-2026-10-06/connection-local-information.png) and
[radio options](./evidence/ui-2026-10-06/connection-radio-options.png).

[Partner page](./evidence/ui-2026-10-06/partners-page-fixed.png) and
[Your code drawer](./evidence/ui-2026-10-06/partners-code-fixed.png) render the real
presenter, HeaderBar and controls at 402×874 with simulated safe-area/data and a
browser substitute for the native sheet. The fixture QR encodes a sample 32-character
partner code. Browser evidence checks content, typography and pinned layout; it
is not proof of Gorhom native geometry, share-sheet integration or device scanning.
