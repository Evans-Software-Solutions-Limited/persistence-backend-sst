# PR #490 — partner workout and discard layout evidence (10 October 2026)

Actual TogetherPartnerPresenter / TogetherWorkoutRow / EndConfirmDialogPresenter
rendered with RN Web, the real Tamagui theme and Geist fonts. Four athlete fixture,
320×740 and 390×844 viewports; safe-area context top 54px / bottom 34px. Exercise
names/permissions/execution are mock read models; PREV is disabled in every view.

- `partner-320.png` / `partner-390.png`: current numeric workout without PREV.
- `private-390.png`: known plan with zero progress and no numeric grant.
- `discard-320.png`: existing centred workout confirmation in discard mode.

Reviewed header boundaries, horizontal athlete tabs, readable owner/workout names,
column alignment and narrow-screen confirmation labels. Browser evidence does not
prove native Modal stacking, gestures, push receipt or two-phone transport.
Native animation/sheet modules are preview stubs. Physical acceptance is pending.
