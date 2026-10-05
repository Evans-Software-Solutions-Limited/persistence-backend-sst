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

Approved differences remain deliberate: local audiences are Private or bounded
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
