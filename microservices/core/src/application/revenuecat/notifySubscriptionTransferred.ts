import { NotificationDispatcher } from "../notifications/push/notificationDispatcher";

/**
 * Best-effort, never-throws notice to an app account that LOST its subscription
 * because RevenueCat transferred it to another account.
 *
 * Why this exists. Apple binds a subscription to the APPLE ID, not to our app
 * account, and "Restore Purchases" re-attaches it to whichever app account is
 * signed in — Apple's designed behaviour, and not something we can gate on our
 * own account's email (StoreKit never exposes the Apple ID's address). RevenueCat
 * is configured to TRANSFER rather than share, which is the industry norm and the
 * property that matters: exactly one app account holds a given transaction at a
 * time, so one payment can't entitle two accounts.
 *
 * The residual sting is that the loss is SILENT. Since the move is reversible in
 * one tap — the legitimate Apple ID holder taps Restore and it comes straight
 * back — telling the losing account IS the mitigation: it turns a confusing
 * disappearance into something they can immediately undo. The realistic triggers
 * are mundane (a shared family device, an Apple ID used by someone else) rather
 * than malicious.
 *
 * ⚠ Fired POST-SYNC and swallowed. A delivery failure must never propagate into
 * `handleRevenueCatWebhook`'s try block: that would mark the event failed and
 * RevenueCat would retry the ENTIRE sync — re-notifying on every retry, and
 * re-running writes that already succeeded.
 *
 * No deep link. Restore lives on the subscription screen, but sending users
 * straight there presumes the transfer was unwanted; plenty are the user's own
 * deliberate account switch. The copy names the action instead.
 */
export async function notifySubscriptionTransferred(
  userId: string,
): Promise<void> {
  try {
    await new NotificationDispatcher().createAndDispatch(userId, {
      type: "subscription_transferred",
      title: "Your subscription moved",
      message:
        "Your subscription is now active on a different Persistence account. If that wasn't you, tap Restore Purchases on this account to bring it back.",
      data: {},
    });
  } catch (err) {
    console.error(
      `[revenuecat:transfer] failed to notify ${userId} of a subscription transfer`,
      err,
    );
  }
}
