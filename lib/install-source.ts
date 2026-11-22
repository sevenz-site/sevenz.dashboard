// Where this tab of Sevenz was opened from: the Play Store app, an app installed from the
// browser, or a plain browser tab. PL-48, docs PLAY-STORE-PLAN.md §7 (steps 1.4, 1.6, 1.8).
//
// The Play Store app is a Trusted Web Activity: Chrome opening app.sevenz.site full
// screen. To the page it is the same web, so the only tell is the referrer Android hands
// over on launch, `android-app://<package>`. That referrer belongs to the FIRST document
// only: a full reload (a redirect to /login and back, a form that reloads) replaces it
// with the previous page. So the first sighting is written to sessionStorage, which lives
// as long as the TWA's tab does and dies with it.
//
// What this does NOT cover, said so nobody counts on it:
// - Blocked sessionStorage: "play" holds until the first full reload, then reads as
//   "pwa" (a TWA still matches display-mode standalone). Never as "browser".
// - A store-app link opened from WhatsApp into the TWA arrives with the same referrer;
//   it is still the store app, so that is correct.
// - Only this package name counts. Another app's android-app:// referrer (say, Gmail
//   opening the site in a Custom Tab) is not ours and falls through to the other checks.

export type InstallSource = "play" | "pwa" | "browser";

// The package name can never change once published (decision D5, 2026-11-18).
export const PLAY_PACKAGE = "site.sevenz.app";

const PLAY_KEY = "sevenz:install-source:play";

function openedFromPlayApp(): boolean {
  const fromReferrer = document.referrer.startsWith(`android-app://${PLAY_PACKAGE}`);
  try {
    if (fromReferrer) {
      window.sessionStorage.setItem(PLAY_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(PLAY_KEY) === "1";
  } catch {
    return fromReferrer;
  }
}

export function installSource(): InstallSource {
  if (typeof window === "undefined") return "browser";
  if (openedFromPlayApp()) return "play";
  // Bare `navigator.standalone` is Safari on iPhone, which does not implement display-mode.
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return standalone ? "pwa" : "browser";
}
