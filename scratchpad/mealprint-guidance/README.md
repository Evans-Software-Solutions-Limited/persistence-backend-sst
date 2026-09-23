# Live Mealprint guidance smoke

This runs two real model requests using synthetic food rows. It does not query
customer data, create plans, consume app quota or deploy anything. Provider
inference charges still apply. The installed app and actual catalogue require a
separate authenticated walkthrough.

After refreshing the development AWS login:

```sh
AWS_PROFILE=ess-dev AWS_REGION=eu-west-2 bun run scratchpad/mealprint-guidance/live-smoke.ts --live
```

Without `--live`, the script only checks that its imports load and prints usage.
Both cases ask for “something quick and chicken based”; one also dislikes fish.
The fixture includes tempting high-protein prawns and sea bass. Success requires
at least one verified meal and no rejected model results. Output records the
model, latency, meal names and resolved ingredients. Preparation speed is still
qualitative prompt guidance, not a verified time estimate.

23 September: local import check passed. Live execution was not run: `ess-dev`
SSO token expired and refresh failed. Do not count this as live-model evidence.
