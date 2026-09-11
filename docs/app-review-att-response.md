# App Review response — ATT startup correction

Submission: `9e5d1d8d-ca34-4d4e-987a-21540dad7c58`  
Feedback: September 11, 2026; version 1.1.2 (50); Guideline 2.1.

## Reply to send with the replacement build and recording

Replace the bracketed fields after the physical-device check. Do not claim a
recording is attached until it has been captured and uploaded.

> Hello App Review Team,
>
> Thank you for reporting this issue. We identified a startup sequencing issue
> in Persistence: notification permission and App Tracking Transparency could
> be requested concurrently, preventing the ATT dialog from appearing.
>
> We have corrected this in version 1.1.2, build [BUILD NUMBER]. Permission
> requests are now coordinated so ATT is requested while the app is active and
> no notification permission request is pending. An unanswered ATT request can
> retry safely; a refusal is respected and never retried automatically.
>
> Meta advertising measurement remains disabled until ATT permission is granted
> and consent is saved. Declining tracking leaves the app fully usable.
>
> The attached recording, captured on [PHYSICAL DEVICE AND OS VERSION], shows
> launching from a fresh install, the system ATT request, and the subsequent
> app flow. We have also included the recording link in App Review Information
> notes: [RECORDING LINK].
>
> Thank you for reviewing the updated build.

## App Review Information notes

Use after verifying the replacement native build on a physical device:

> App Tracking Transparency: On a fresh install, Persistence requests system
> permissions on launch before sign-in. Notification permission and ATT are
> coordinated to avoid overlapping requests. Please complete each system
> permission dialog to continue to the next one. Tracking is optional;
> declining it does not restrict app functionality.
>
> Physical-device recording: [RECORDING LINK]
> Recorded device / OS: [DEVICE AND OS]
> Recorded version / build: 1.1.2 ([BUILD NUMBER])

## Release requirements

- Produce a new **native production iOS build**, not an OTA-only update. Keep
  marketing version 1.1.2; EAS remotely increments the build number.
- Verify the built app contains the Meta configuration and ATT purpose string.
- Capture the required physical-device flow and verify no Meta tracking traffic
  occurs before permission or after refusal.
- Upload the approved build and recording, then submit the reply above. This PR
  does not itself submit a build to App Store Connect or send a review message.
