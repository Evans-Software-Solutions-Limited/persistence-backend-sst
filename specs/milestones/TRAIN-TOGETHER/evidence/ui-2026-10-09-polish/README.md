# TestFlight hub correction — 9 October 2026

Owner feedback follows merged PR #489 / `49d5ede5`. The previous implementation
is visible in `../ui-2026-10-09/together-hub-390.png`. This review applies Brad's
new amendments to the established dark surfaces, Geist typography, cyan actions,
44px partner avatars and existing setup/admission flow.

The previous layout made information look actionable: boxed discovery status,
two equal Join/Scan buttons, verbose own-start card, profile card and duplicate
partner status. This correction uses plain Sessions/empty text, one Join entry,
a short unboxed start row, separated session/partner rows and no profile card.
The workout picker uses whole-row selection, exercise count, available duration
and a truncated preview of joined exercise names. The first visual pass exposed
centred workout metadata and duplicate dividers; both were corrected before
these captures. Missing-name partners retain an honest fallback without a
second identical subtitle. Accepted outgoing partners show Training partner.

`empty-*`, `populated-*` and `workouts-*` capture actual presenters at 320×740
and 390×844 through React Native Web/Tamagui, with synthetic workout/partner
state. Safe area is fixed; native sheets/animation are stubbed as documented in
the prior evidence README. The images show the content body, not native Train
navigation chrome. They prove layout and affordances, not TestFlight/device
scrolling, gestures, battery use, transport or push delivery.

Refresh regression checks cover no 20-second polling, automatic reads not
owning the pull indicator, explicit pull completion, and request reconciliation.
The hub never starts discovery. Join owns explicit Browse and cancels only its
browsing phase on blur; selected/joined/active work remains intact.

After merging and Brad's staging build, review: empty hub at rest for >60s,
user pull indicator, accepted partner after returning from another screen,
My QR, whole-row workout selection, Join → browse or scan, and leaving browse
without disrupting an active workout. No native build is authorized by this work.
