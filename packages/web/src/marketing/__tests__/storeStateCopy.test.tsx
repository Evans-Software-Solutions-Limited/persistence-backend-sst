import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { Home } from "@/pages/Home";
import Support from "@/pages/Support";
import Login from "@/pages/Login";
import { appStore, playStore } from "../config";

/**
 * The gap this file exists to close.
 *
 * For five days after the 15 Aug App Store launch, production served
 * "Coming to iPhone — the App Store link lands here the day it goes live"
 * directly beneath an "Available on iPhone" kicker and above a WORKING Download
 * button, and a /support answer claiming Persistence was "launching on Google
 * Play alongside the iPhone release … both are coming soon" — wrong in both
 * halves, since iPhone had shipped and Play had not.
 *
 * Every existing test passed throughout. `AppStoreCta.test.tsx` proves the CTA
 * flips on `appStore.available`, and it always did; nothing asserted that the
 * PROSE around it agreed with the button. Copy that contradicts a live store
 * link is not a cosmetic defect — it tells a visitor the app they can download
 * right now does not exist yet.
 *
 * So these tests assert the rendered prose against both store flags, in both
 * states, on the two pages that talk about store availability.
 */

/**
 * Flip a store flag for one assertion, always restoring it.
 *
 * `assert` is typed to return `void` specifically so that passing an `async`
 * callback is a type error. TypeScript would otherwise accept a
 * `() => Promise<void>` where `() => void` is expected, and because nothing
 * here awaits it, `finally` would restore both flags BEFORE the assertions ran —
 * leaking the flipped state into every later test in the file and quietly
 * asserting against the wrong config. Returning the callback's value keeps an
 * accidental promise visible rather than silently discarded.
 */
function withStores<T>(
  next: { ios?: boolean; play?: boolean },
  assert: () => T extends Promise<unknown> ? never : T,
): T {
  const beforeIos = appStore.available;
  const beforePlay = playStore.available;
  try {
    if (next.ios !== undefined) appStore.available = next.ios;
    if (next.play !== undefined) playStore.available = next.play;
    return assert() as T;
  } finally {
    appStore.available = beforeIos;
    playStore.available = beforePlay;
  }
}

/**
 * Matches the whole rendered document rather than a single element: the defect
 * was one clause inside a paragraph that also carried unrelated copy, so an
 * element-scoped query on the wrong node would have missed it.
 */
const bodyText = () => document.body.textContent ?? "";

describe("store-availability copy tracks the store flags", () => {
  it("does not tell visitors the app is coming while it is live", () => {
    // The literal string that shipped. Guarding the phrase, not the sentence,
    // so a reworded variant of the same mistake still fails.
    expect(appStore.available).toBe(true);
    renderPage(<Home />);
    expect(bodyText()).not.toMatch(/coming to iphone/i);
    expect(bodyText()).toMatch(/out now on the app store/i);
  });

  it("says the App Store is live on /support while it is live", () => {
    renderPage(<Support />);
    expect(bodyText()).toMatch(/on the app store now/i);
    // The exact wrong claim that shipped: Play arriving WITH the iPhone release.
    expect(bodyText()).not.toMatch(/alongside the iphone release/i);
    expect(bodyText()).not.toMatch(/both are coming soon/i);
  });

  it("reverts to pre-launch copy if the App Store listing is ever pulled", () => {
    // Symmetry, and the reason this is flag-driven rather than a one-off string
    // edit: an app pulled from sale must not keep claiming to be downloadable.
    withStores({ ios: false }, () => {
      renderPage(<Home />);
      expect(bodyText()).toMatch(/coming to iphone/i);
      expect(bodyText()).not.toMatch(/out now on the app store/i);
    });
  });

  it("offers the Android notify list only while Play is not live", () => {
    expect(playStore.available).toBe(false);
    renderPage(<Home />);
    expect(bodyText()).toMatch(/android is next/i);
    expect(screen.getByText("Notify me at launch")).toBeDefined();
  });

  it("removes the Android notify list once Play goes live", () => {
    // Otherwise this becomes the same defect a third time: a form inviting
    // people to wait for something that already shipped.
    withStores({ play: true }, () => {
      renderPage(<Home />);
      expect(bodyText()).not.toMatch(/android is next/i);
      expect(screen.queryByText("Notify me at launch")).toBeNull();
    });
  });

  it("stops promising a future Play link on /support once Play is live", () => {
    withStores({ play: true }, () => {
      renderPage(<Support />);
      expect(bodyText()).toMatch(/on google play/i);
      // Targets the MEANING, not the current string. An earlier version of this
      // pinned /lands here the day it goes live/ — which never matched the copy
      // that actually shipped ("the store links land here the day EACH goes
      // live"), so it passed happily against the defect it was meant to catch.
      expect(bodyText()).not.toMatch(/lands? here the day/i);
      expect(bodyText()).not.toMatch(/on its way to google play/i);
    });
  });

  it("does not claim iPhone availability it just denied, when only Play is live", () => {
    // The combination neither flag covers alone. With the App Store pulled and
    // Play live, "It's on Google Play TOO" would assert the iPhone availability
    // the preceding clause denies.
    withStores({ ios: false, play: true }, () => {
      renderPage(<Support />);
      expect(bodyText()).toMatch(/coming to iphone/i);
      expect(bodyText()).not.toMatch(/google play too/i);
    });
  });

  it("does not name a Google review stage the flag cannot back", () => {
    // `playStore.available` is live/not-live only — it cannot represent
    // rejected, withdrawn or not-yet-submitted, so asserting "in review" would
    // become a stale factual claim the moment Play rejects a build, with every
    // test still green.
    renderPage(<Support />);
    expect(bodyText()).not.toMatch(/in review/i);
  });

  it("does not tell a /login visitor to wait for a launch that happened", () => {
    // Nothing links to /login and it is absent from sitemap.xml, so this is
    // reached by a typed URL or a stale link — i.e. by someone whose
    // information is already out of date.
    renderPage(<Login />);
    expect(bodyText()).not.toMatch(/once it's live/i);
    expect(bodyText()).toMatch(/sign in from the app/i);
  });

  it("restores both flags after the flips above", () => {
    expect(appStore.available).toBe(true);
    expect(playStore.available).toBe(false);
  });
});
