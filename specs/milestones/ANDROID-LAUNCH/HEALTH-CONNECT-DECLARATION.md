# Android launch — Health Connect declaration

Code status: ready for an Android development build. Console approval and
physical-device verification are still required before production submission.

## Play Console claim

In **App content → Health apps**, declare Persistence as a health/fitness app.
Choose the categories that cover activity tracking, sleep management, and
nutrition/weight management. The manifest and Console declaration must match.

| Health Connect type    | Access       | User-facing purpose in Persistence                                              |
| ---------------------- | ------------ | ------------------------------------------------------------------------------- |
| Steps                  | Read         | Populate today's activity ring and seven-day step history.                      |
| Active calories burned | Read         | Populate today's activity/progress energy.                                      |
| Basal metabolic rate   | Read         | Populate today's resting-energy progress.                                       |
| Weight                 | Read + write | Prefill weigh-ins from a connected scale and mirror confirmed in-app weigh-ins. |
| Body fat               | Read + write | Prefill body-composition values and mirror confirmed in-app weigh-ins.          |
| Heart rate             | Read         | Show the latest sample on Health & integrations.                                |
| Sleep session          | Read + write | Prefill the sleep quick-log and mirror a confirmed in-app sleep log.            |

Suggested declaration wording:

> Persistence is a fitness and wellbeing tracking app. With explicit,
> revocable Health Connect permission, it reads steps and energy to populate
> the user's activity progress; reads weight and body fat to prefill body
> measurements; reads the latest heart-rate sample on the integrations screen;
> and reads sleep to prefill the sleep log. It writes weight, body fat and sleep
> only after the user confirms the corresponding log in Persistence. Health
> data is used for app functionality, is not used for advertising, and raw
> Health Connect data is not shared with a connected coach.

Demonstration path for review:

1. Sign in, open **Profile → Health & integrations** and tap **Connect Health Connect**.
2. Grant the requested categories; show today's steps and latest heart rate on that screen.
3. Open a weigh-in, demonstrate Health Connect prefill, save, and show the Weight and Body Fat records written back.
4. Open the sleep quick-log, demonstrate prefill, save, and show the Sleep Session record written back.
5. Reopen **Health & integrations** to show the per-category permission state and the route to Android Health Connect settings.

## Console and release checklist

- [ ] Create the Play Console app with package `com.bradleyevans96.persistence`.
- [ ] Publish the public privacy policy update before submitting the Health apps declaration.
- [ ] Submit the Health apps declaration with the table and wording above.
- [ ] Ensure the production app is allow-listed for all declared Health Connect types; allow several business days for review.
- [ ] Upload a closed-testing AAB before testing Health Connect permissions.
- [ ] Test on Android 13 with the Play-installed Health Connect provider.
- [ ] Test on Android 14+ with system Health Connect.
- [ ] Verify permission denial, partial grants, later revocation, and missing/outdated-provider recovery.
- [ ] Verify weight, body-fat and sleep write-back does not occur until the user saves a log.
- [ ] Complete the broader Data safety declaration consistently with the public privacy policy.

References: [Health Connect permissions](https://developer.android.com/health-and-fitness/health-connect/ui/permissions), [Play Health Connect policy](https://support.google.com/googleplay/android-developer/answer/14738291), and [`react-native-health-connect` setup](https://matinzd.github.io/react-native-health-connect/docs/get-started/).
