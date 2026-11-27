# Android push setup (Firebase / FCM)

Ticket: [PER-149](https://linear.app/evans-software-solutions/issue/PER-149).
Written 25 Nov 2026. These are Brad's steps; agents never run builds.

## Why

Android delivers every push, Expo push included, through Firebase Cloud
Messaging (FCM). Until now the app had no Firebase config, so Android phones
could never get a push token and never registered in `user_devices`
(production: 120 iOS rows, 0 Android). iOS is unaffected: Expo sends iOS
pushes through APNs, not Firebase.

The code change is in `packages/mobile/app.config.ts`. It sets
`android.googleServicesFile` per app variant. The app needs no new package:
`expo-notifications` reads the file at build time. **It needs a new Android
build.** A 1.2.0 Android phone keeps getting no push until it updates.

## Where the files go

| EAS profile    | Android package                          | File in the repo                                           |
| -------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `staging`      | `com.bradleyevans96.persistence.staging` | `packages/mobile/firebase/google-services.staging.json`    |
| `play-testing` | `com.bradleyevans96.persistence`         | `packages/mobile/firebase/google-services.production.json` |
| `production`   | `com.bradleyevans96.persistence`         | `packages/mobile/firebase/google-services.production.json` |

`play-testing` and `production` share a package name, so they share a file.
The dev variant (`.dev`) has no Firebase app and gets no push.

**Recommended: commit both files.** A `google-services.json` holds client
identifiers (project number, app id, and an Android API key that ships inside
every APK anyway), not server secrets. Committing them means local and EAS
builds read the same reviewed file, and staging vs store can't get mixed up.
The secret is the **FCM service-account key** (step 4). It never goes in git.

**Alternative: an EAS file environment variable.** If you'd rather not commit
the files, create a file variable named `GOOGLE_SERVICES_JSON`. It overrides
the committed path. Note that `staging` and `play-testing` both use the EAS
`preview` environment but need different files. So, with this route, either
use one Firebase project whose `google-services.json` lists both Android apps
(see step 2), or set the variable per profile in `eas.json`.

**If the file is missing:**

- An **Android EAS build fails straight away** with
  `Android push is off for this build: packages/mobile/firebase/google-services.<variant>.json is missing …`.
  It fails on purpose: an Android build without the file ships an app that can
  never receive a push.
- iOS builds, `expo start`, OTA updates and tests only print a warning, so
  iOS keeps building before the files exist.

## Steps

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and choose **Create a project**.
2. Name it, for example `Persistence`. Google Analytics isn't needed; turn it
   off.

One project holds both Android apps. One service-account key then covers
staging and production, in both Expo and Stream.

### 2. Add both Android apps

In the project: **Project settings → General → Your apps → Add app → Android**.

1. Package name `com.bradleyevans96.persistence.staging`, nickname
   `Persistence Staging`. Skip the SHA-1 (FCM doesn't need it) and skip the
   SDK steps (Expo handles them).
2. Add a second Android app: package name `com.bradleyevans96.persistence`,
   nickname `Persistence`.

Don't add an iOS app; iOS push doesn't use Firebase here.

### 3. Download each `google-services.json` and put it in place

For each Android app, **Project settings → General → (the app) → download
`google-services.json`**.

- Staging app's file → `packages/mobile/firebase/google-services.staging.json`
- Store app's file → `packages/mobile/firebase/google-services.production.json`

Once both apps exist, Firebase's download includes both apps, so the two files
may be identical. That's fine: the build picks the entry that matches its
package name. Check each file's `client[].client_info.android_client_info.package_name`
contains the package for that variant.

Commit both files on a branch and merge (or use the `GOOGLE_SERVICES_JSON`
alternative above).

### 4. Upload the FCM V1 service-account key to EAS

Expo's push service needs this to send to Android through FCM.

1. Firebase: **Project settings → Service accounts → Generate new private
   key**. This downloads a JSON key. **Keep it out of git.**
2. In `packages/mobile`, run `eas credentials`.
3. Choose **Android**, then the **staging** build profile.
4. Choose **Google Service Account → Manage your Google Service Account Key
   for Push Notifications (FCM V1) → Set up a Google Service Account Key for
   Push Notifications (FCM V1) → Upload a new service account key**, and pick
   the JSON key.
5. Repeat for the **production** profile (`com.bradleyevans96.persistence`;
   `play-testing` uses the same package, so it shares these credentials). You
   can reuse the key you already uploaded.

Check: on expo.dev, **Project → Credentials → Android**, both package names
show an FCM V1 service account key.

### 5. Later, for chat (PER-110): add the key to Stream

When Stream chat push is tested
([PER-110](https://linear.app/evans-software-solutions/issue/PER-110)), in the
Stream dashboard for **both the staging app and the production app**:
**Push Notifications → New configuration → Firebase**, and upload the same
service-account JSON key from step 4. This is not needed for Expo push.

### 6. Make a staging Android build

After the PR and the files are merged, bump the app version as usual for the
release, then build staging for Android (for example
`eas build --profile staging --platform android`) and install it from the
Play internal track.

### 7. What to check on the staging build

1. **Permission prompt.** On first launch on Android 13 or later, Android asks
   to allow notifications. Allow it.
2. **Device registered.** Sign in, then in the staging database:
   `select platform, device_token, is_active, created_at from user_devices where platform = 'android' order by created_at desc;`
   A new `android` row appears with an `ExponentPushToken[…]` token.
3. **Push arrives.** Trigger a real notification (for example a friend request
   from another account), or send a test push from
   <https://expo.dev/notifications> to that token. It shows on the phone, in
   the "Default" channel.
4. **Tap opens the right screen.** Tap it: a friend request opens Together → Partners; a
   notification with a deep link opens that screen.
5. **1.2.0 phone.** An Android phone still on 1.2.0 gets no push and no
   `user_devices` row until it updates. That's expected: the fix is in the
   native build.
6. **No raw tokens.** After the staging deploy has run migration
   `20261125160203_user_devices_drop_non_expo_tokens.sql`, and after signing
   in on the new build (iOS and Android), this returns 0 rows:
   `select platform, device_token from user_devices where device_token not like 'ExponentPushToken[%]' and device_token not like 'ExpoPushToken[%]';`

If step 2 fails, look in the device logs for `[push]` warnings. A
`Default FirebaseApp is not initialized` error means the build didn't get the
right `google-services.json`.

## Raw native tokens (fixed in the same PR)

Before this change the app also registered the raw native push token (APNs on
iOS, FCM on Android) next to the Expo token, because Expo's
`addPushTokenListener` hands back native tokens. Production had 64 such iOS
rows (53 active) next to 56 Expo-token rows. The Expo push path can't deliver
to them. Now:

- **App:** the token listener fetches the Expo token again and registers that,
  never the raw token (`expo-notifications.adapter.ts`). If that fetch fails
  (offline, Expo down), it retries after 30 s, 2 min and 10 min, then each
  time the app comes back to the foreground. It never loops.
- **Backend:** `POST /devices/register` answers 200 to a non-Expo token but
  doesn't store it, so 1.2.0 phones that still send one see no error. It also
  deletes any row the caller already has for that exact token. The deploy
  runs `supabase db push` before `sst deploy`, so the old Lambda can still
  write raw rows after the migration. Those rows go the next time that phone
  registers.
- **Clean-up:** migration `20261125160203_user_devices_drop_non_expo_tokens.sql`
  deletes the existing raw-token rows. It keeps every Expo token
  (`ExponentPushToken[…]`, `ExpoPushToken[…]`, legacy UUID). Its rollback is a
  documented no-op, because deleted junk tokens can't be restored.
