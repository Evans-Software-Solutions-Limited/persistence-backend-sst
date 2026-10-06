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
