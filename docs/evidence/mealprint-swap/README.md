# Meal swap feedback visual check — 23 September 2026

Screenshots render the actual `MealSwapFeedback` component and `Btn` using
React Native Web, the app's Tamagui config and locally installed Geist fonts.
The surrounding meal heading is a static preview fixture. This is not a native
app build or an authenticated end-to-end generation test.

At a 390 × 844 viewport: chips wrap without clipping; optional multiline text is
readable; Generate and Cancel remain visible; busy state disables controls;
error state retains feedback and exposes retry. Verified the shortcut fills the
input and custom text can replace it. Fixed the error text's missing font family
before final capture. Captures crop out preview-only state controls.

- `feedback.png`: the Quick to make shortcut selected before generation.
- `busy.png`: controls disabled while finding a replacement.
- `error.png`: retained feedback and readable retry error.

Native keyboard/sheet behaviour still requires a device check; no native build
was initiated.
