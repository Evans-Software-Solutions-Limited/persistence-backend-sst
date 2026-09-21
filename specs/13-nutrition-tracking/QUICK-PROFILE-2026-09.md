# Fuel calculator quick profile completion

Authorised by Brad on 21 September 2026. This amends the target editor's
settings-only profile completion flow.

- Age, sex, height and weight tiles open the shared bottom drawer over the target screen,
  including onboarding. Opening, cancelling and saving preserve target drafts.
- Missing values display Required and a line explains that these inputs are
  needed for calculation. Manual calorie entry remains available.
- Age uses the shared DatePickerField to edit date of birth, never a stored age. Sex retains the existing male,
  female and other choices/calculation. Height and weight honour profile units.
- Valid profile edits use the existing offline profile command. Weight records
  today's measurement through the existing offline measurement command, feeding
  profile progress and the calculator from the same source.
- Accepted edits update the preview immediately without waiting for connectivity.
  Invalid values remain editable and never enter the sync queue.
- Tests cover tile actions, missing signals, persistence/queue payloads, unit
  conversion, validation, cancellation, manual mode and onboarding. Visual QA
  checks narrow layouts and the expanded editor with the existing Fuel styling.

## Measurement formats

- Height entry switches between cm, metres + centimetres, inches, and feet + inches. Switching converts the draft without rounding the stored centimetres; saved metric/imperial display preference updates immediately.
- Weight quick-fill opens the existing shared weight-log view, including during onboarding, retaining its date, history, optional body-fat and Health integration. Accepted logs refresh the calculator without losing target drafts.
- The shared weight-log view accepts kg, lb, and stone + pounds. The pounds remainder must be below 14. Decimal commas are accepted. Existing profile/API unit values remain compatible; measurements are stored in kg.
- Blank/invalid entries cannot submit a previous value. Unit switches preserve the measurement; conversion tests cover compound boundaries. On save, body weight is rounded to one decimal place in the selected entry format, including Health-prefilled values.
