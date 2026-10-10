# PER-22 staging follow-up acceptance

The source corrections implement AC23–27. This checklist records the physical
acceptance still required; it does not claim a staging deployment or device pass.
Brad owns the compatible app build. Deploy the matching backend first for partner
request notifications and the non-finalizing `stop-sharing` endpoint.

Use two eligible signed-in iPhones on the same Wi-Fi or a manually enabled
hotspot; repeat without internet using valid cached access. Record binary/runtime,
backend SHA, account fixtures, connection and outcomes. Use the existing
`SMOKE_TEST.md` to expand to four phones, mixed devices and recovery/performance.

1. Train → Together shows available open workouts and partners inline. Pull down
   refreshes both. The page has Join a session and Scan invitation before starting
   a personal workout. No account UUID is used as a partner display name.
2. Want to start your own? → Choose a workout → audience → connection → Start.
   Verify the chosen workout is live and existing logged sets remain intact.
3. Guest selects a discovered open workout without scanning; review then Join.
   A stranger requires host approval. A verified friend joins deliberately.
4. Scan the host session QR in the iPhone Camera app. It opens the matching
   Persistence distribution and invitation review. Admission happens only after
   Join. Test app already open and cold launch. Copy/paste and Share/AirDrop use
   the same actionable link, rather than a text file. Invalid/expired invitations
   show an actionable error and preserve the guest's current workout.
5. In-app Scan invitation: first permission grant shows a bounded camera preview;
   denial allows paste/retry; duplicate QR callbacks admit/request once. Cancel,
   navigate away, switch account and background during permission. A permission
   prompt's temporary inactive transition must not end sharing.
6. Navigate to partners/Train and back during a live session. Sharing must survive
   navigation. Log distinct sets on each phone. Retain logs through disconnection.
   Record any unexpected end with the immediately preceding lifecycle/action;
   true background currently ends local transport, with private work preserved.
7. Stop sharing keeps the athlete's workout active, with no rating, saved history
   or completion stats. Host ends group sharing; a guest leaves only their own
   membership. Both can continue logging privately and later save deliberately.
8. Discard without saving from settings, finish choices, rating and unhappy-path
   recovery asks for confirmation. Confirming removes only that athlete's active
   draft, skips rating, creates no history/stats and does not resurrect after
   force-close/relaunch or reconnect. Keep workout preserves the draft.
9. Finish and save still uses own rating → own result/summary exactly once. Host
   finish-all and guest own finish preserve independent results and privacy.
10. Invite a partner. Verify recipient push receipt and tap navigation, in-app
    request appearance without a manual Refresh button, explicit acceptance and
    named/photo partner details. Test muted preference and missing push permission
    separately; those are not delivery-failure proof. Retry must not duplicate
    request rows or pushes. Set a missing name/photo via Edit my profile.

QR follow-up in PR #489: check both the main invitation card and settings QR.
Use standard and narrow phones, normal brightness, OS Camera and in-app scanner;
verify the entire white margin is visible and the app opens the correct review.
The signed local sample shrinks from 1,137 to 719 URL characters (36.8%);
normal-phone QR canvas grows to 304px, with a white quiet zone and responsive
narrow-screen sizing. Old raw links remain accepted. Native scan reliability
is still a device acceptance check.

10 October / PR #490 additional device checks (matching updated app on both phones):

- Tap an old Profile-linked friend-request push from cold/open app and an inbox
  row: partner requests appear first in Together partners, ready to accept.
- View the partner immediately after admission, before either logs a set. Plan
  exercises and zero progress appear. Share numbers with PREV off; log distinct
  reps/kg and view each other. Enable logging separately and enter a first set
  for the named owner. Toggle/revoke each permission and check private values.
- Check the partner header under the notch, athlete tabs at narrow widths and
  return to own workout without losing rows.
- Discard from a live settings/finish/rating sheet: centred confirmation appears
  above the sheet. Keep returns to the workout; Discard skips rating/history.
- Keep both apps foreground and idle for ten minutes, then log sets. Induce a
  brief network drop: guest attempts one fresh authenticated reconnect, retains
  private draft, and re-sharing values requires current owner authorization.
  Background/account change/cancel stops the retry. Record binary, lifecycle,
  connection type and exact error if a drop recurs. The 09:42 BST / 08:42 UTC event
  remains unattributed; local LAN transport itself does not run through Lambda.
