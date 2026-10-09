# PER-22 staging correction layout evidence — 9 October 2026

Actual `TogetherHubPresenter`, `TogetherPartnersPresenter` and
`TogetherScannerPresenter` rendered through React Native Web with the repository's
Tamagui dark theme, real Geist font files and simulated public partner/session
state. Compare with the reviewed Together export and Brad's 9 October amendments
in `DESIGN-REFERENCE.md` and Linear PER-22.

- `together-hub-390.png`: joinable workouts, explicit Join/Scan, guided-start entry
  and partner section in one scrolling body at 390 × 844.
- `partners-390.png`: the same scroll after moving down, showing readable partner
  spacing, neutral unnamed identity and profile setup.
- `together-hub-320.png`: narrow 320 × 740 view, without horizontal clipping.
- `scanner-320.png`: fixed 240-point preview bounds and Cancel at 320 × 740.

The preview replaces native sheet/animation infrastructure; no sheet is opened
in these views. The camera is a labelled placeholder within the actual scanner
presenter. The preview drops an unused broken LucideProvider re-export from the
installed web icon package solely to bundle the existing icon components. This
is visual layout evidence, **not** proof of native camera permission/rendering,
QR decoding, AirDrop/deep-link routing, pull gestures, notifications or transport
on physical devices. Native builds and device acceptance remain Brad-owned.
