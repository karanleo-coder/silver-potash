// Thin wrapper around the Vibration API. Feature-detected and silently a no-op where
// unsupported — notably Safari on iOS/iPadOS, which has never implemented navigator.vibrate
// (Apple's own restriction, not something a web page can work around). Still worth wiring up
// for any Android device used as the controller instead.
const supported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

function vibrate(pattern) {
  if (supported) navigator.vibrate(pattern);
}

export const haptics = {
  supported,
  tap: () => vibrate(12),
  joined: () => vibrate([20, 40, 20]),
  error: () => vibrate([15, 60, 15, 60, 15]),
};
