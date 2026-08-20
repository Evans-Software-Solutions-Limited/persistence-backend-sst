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

/** Stand-in Play URL for the flag-flipped cases. Shape only; never requested. */
const PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.evanssoftware.persistence";

/**
 * The store state as SHIPPED, captured at module load — before any test has had
 * a chance to flip a flag. The restore check at the bottom compares against
 * this rather than against literal `true`/`false`, so it tests what it claims
 * to test (that `withStores` puts things back) instead of quietly doubling as a
 * tripwire that fails the day Android launches under a title about restoration.
 */
const SHIPPED = {
  ios: appStore.available,
  play: playStore.available,
  playUrl: playStore.url,
};

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
  const beforePlayUrl = playStore.url;
  try {
    if (next.ios !== undefined) appStore.available = next.ios;
    if (next.play !== undefined) {
      playStore.available = next.play;
      // `available` alone is not enough to make a Play CTA render: PlayStoreCta
      // requires a non-null URL too, the same gate AppStoreCta uses. Supplying
      // one here is what makes "Play is live" mean the thing it means in
      // production, rather than a half-state no deploy would ever produce.
      playStore.url = next.play ? PLAY_URL : null;
    }
    return assert() as T;
  } finally {
    appStore.available = beforeIos;
    playStore.available = beforePlay;
    playStore.url = beforePlayUrl;
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

  it("reverts to pre-launch copy AND kills every store link if the listing is pulled", () => {
    // Symmetry, and the reason this is flag-driven rather than a one-off string
    // edit: an app pulled from sale must not keep claiming to be downloadable.
    //
    // The link assertion is the load-bearing half. Asserting only the prose,
    // as this originally did, passed against a page that said "Coming to
    // iPhone" above three live apps.apple.com CTAs reading "Get it on the App
    // Store" — because AppStoreCta gated on `appStore.url` and never read
    // `appStore.available`. Copy and CTA have to agree, so test both.
    withStores({ ios: false }, () => {
      const { container } = renderPage(<Home />);
      expect(bodyText()).toMatch(/coming to iphone/i);
      expect(bodyText()).not.toMatch(/out now on the app store/i);
      expect(container.querySelectorAll('a[href*="apps.apple.com"]')).toHaveLength(
        0,
      );
    });
  });

  it("offers the Android notify list only while Play is not live", () => {
    expect(playStore.available).toBe(false);
    renderPage(<Home />);
    expect(bodyText()).toMatch(/android is next/i);
    expect(screen.getByText("Notify me at launch")).toBeDefined();
  });

  it("swaps the Android notify list for a real Play link once Play goes live", () => {
    // Removing the notify list is only half of it, and on its own it strands
    // the visitor: the Play button used to be a hardcoded permanently-disabled
    // span, so flipping the flag would have deleted the notify list, left the
    // button reading "Coming soon", and had /support say the app was on Play —
    // no way to reach it from anywhere. A flag flip has to leave a coherent
    // page, so assert what APPEARS, not just what goes.
    withStores({ play: true }, () => {
      const { container } = renderPage(<Home />);
      expect(bodyText()).not.toMatch(/android is next/i);
      expect(screen.queryByText("Notify me at launch")).toBeNull();
      expect(bodyText()).not.toMatch(/coming soon to/i);
      expect(
        container.querySelectorAll('a[href*="play.google.com"]').length,
      ).toBeGreaterThan(0);
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

  /**
   * The half-states: `available` flipped, `url` left behind. These are not
   * hypothetical — flipping the flag is a one-line edit, and Home's own comment
   * used to invite exactly that. The rule is that a visitor always has SOMEWHERE
   * to go: a live store link, or the notify list. Never neither.
   */
  describe("a half-configured store never strands the visitor", () => {
    it("treats Play as not-live when the flag is on but no URL is set", () => {
      withStores({ play: true }, () => {
        // Undo half of what withStores did, reproducing the one-line edit.
        playStore.url = null;
        const { container } = renderPage(<Home />);
        const hasPlayLink =
          container.querySelectorAll('a[href*="play.google.com"]').length > 0;
        const hasNotifyList = /android is next/i.test(bodyText());
        expect(hasPlayLink || hasNotifyList).toBe(true);
      });
    });

    it("does not claim the App Store is live with no URL to send anyone to", () => {
      withStores({ ios: true }, () => {
        const beforeUrl = appStore.url;
        appStore.url = null;
        try {
          const { container } = renderPage(<Support />);
          const claimsLive = /on the app store now/i.test(bodyText());
          const hasLink =
            container.querySelectorAll('a[href*="apps.apple.com"]').length > 0;
          expect(claimsLive && !hasLink).toBe(false);
        } finally {
          appStore.url = beforeUrl;
        }
      });
    });
  });

  it("leaves the store config exactly as it found it", () => {
    expect(appStore.available).toBe(SHIPPED.ios);
    expect(playStore.available).toBe(SHIPPED.play);
    expect(playStore.url).toBe(SHIPPED.playUrl);
  });
});
