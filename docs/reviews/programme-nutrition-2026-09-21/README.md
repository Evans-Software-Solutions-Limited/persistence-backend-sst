# Programme and nutrition review — 21 September 2026

## Implemented scope

- Nutrition target profile tiles open quick entry for DOB, calculation sex, height and weight. Missing inputs are marked required; successful edits update the profile/body measurement commands and calculation. Existing manual calorie entry remains available.
- Recipe URL extraction handles nested JSON-LD and grouped instructions. Unreadable pages offer source-preserving paste or manual entry into the existing review flow; ingredient quantities, nutrition and allergens are not invented.
- PER-5/W1 has an isolated executable programme revision/schedule/offline-reconciliation model. It is not connected to production routes. Coach recipe/meal-plan sharing is specified in Spec 38, not enabled.

## Visual evidence

Actual React Native presenters rendered through react-native-web with the application theme and bundled Geist fonts, synthetic data and fixture callbacks. The native slider was substituted with an HTML range and the unused logo loader omitted. This checks layout and interactions, not native keyboard behaviour or authenticated API integration.

Screenshots are local review artifacts and are not committed to the PR. The original inline editor has been replaced by the shared quick-fill drawer and date picker. No native or EAS build was initiated.

## Verification

- Full core suite: 376 files / 5,047 tests passed, with coverage (two workers).
- Other workspace test tasks: 17 successful (16 cached).
- Focused profile/cache regression suite: 9 suites / 183 tests passed before final broad run. Includes delayed GET completion after edits, then offline remount.
- Initial unbounded root test run saturated local workers and reported unrelated mobile timeouts; simultaneous coverage writes also interrupted core coverage output. Bounded package runs replace that unsuccessful attempt.
- Final formatting, typecheck and lint passed (existing lint warnings only). The explicit non-mobile workspace build and mobile TypeScript check also passed after the measurement changes.
- Final local Inspector Brad full-diff review: clean. Review fixes cover writes made during a GET and writes already pending/in flight when it starts, including acknowledgement before the stale response arrives. Four timing regressions verify persistence after offline remount; final focused run passed 94 tests.
- Final full mobile suite: 535 suites / 6,953 tests passed with coverage (two workers).

Brad’s failing recipe URL was not supplied, so that exact page has not been reproduced. The paste fallback does not require a supported recipe site.

Drawer correction: 102 focused tests and the full mobile suite passed. The actual shared BottomSheet and web date picker were inspected at phone width; the native date selector is covered by component tests, not a native build. Screenshots remain local only.

Measurement formats: phone preview checked shared weight view in kg and stone/pounds, including a typed precise weight rounding to one decimal on blur and body-fat percentage containment. Explicit Geist fonts replace implicit/fallback typography. Height m+cm and ft+in split fields fit within the drawer. All new visual artifacts remain outside the repository.

Measurement validation: all 6,953 mobile tests passed with coverage; formatting, typecheck, lint and the non-mobile build passed. Local Inspector Brad reviewed the final measurement changes with no actionable findings. Weight formats are kg, lb and stone/pounds only; displayed and saved entries round to one decimal, including Health-prefilled values.

Date-picker follow-up: calendar icon opens the existing shared picker; past dates flow into the measurement and Health write. Browser fixture verified opening the calendar and selecting 15 September; native subdrawer confirmation and dismissal are covered by tests. 55 focused tests passed, mobile typecheck and targeted lint passed, and local Inspector review is clean. No native build or screenshot committed.
