// Reads device tilt and turns it into a normalized steering value in [-1, 1], using the same
// pipeline mobile racing games (Real Racing, Asphalt, CSR, ...) use for tilt controls:
//
//   raw sensor angle -> center offset -> dead zone -> response curve -> time-based smoothing
//
// DeviceOrientation's beta/gamma are reported relative to the device's own portrait frame,
// not the screen's current orientation. When the tablet is held in landscape "like a wheel",
// the rolling motion the user feels shows up on a different raw axis depending on which way
// landscape is rotated, so we read screen.orientation.angle to pick the right one and sign it
// consistently.
//
// The sensor callback only ever *records* the latest raw angle — all the shaping (dead zone,
// curve, smoothing) runs in a requestAnimationFrame loop instead, decoupled from however often
// deviceorientation actually fires (it varies a lot: ~60Hz on some devices, ~15-20Hz on
// others). That keeps the steering feel — and the smoothing time-constant specifically —
// identical across devices, the same way a game's update loop is decoupled from its input
// polling.
export class MotionInput {
  constructor() {
    this.maxTiltDeg = 35;
    this.deadZoneDeg = 2.5; // ignore micro-jitter right around dead-ahead
    this.curve = 1.6; // >1 = gentler near center, full lock still reachable at max tilt
    this.smoothingTauSec = 0.06; // exponential smoothing time-constant, frame-rate independent

    this._raw = 0;
    this._smoothed = 0;
    this._offset = 0;
    this._callback = null;
    this._rafId = null;
    this._lastTickMs = 0;

    this._handler = this._handler.bind(this);
    this._tick = this._tick.bind(this);
  }

  static get needsExplicitPermission() {
    return typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function";
  }

  static async requestPermission() {
    if (!MotionInput.needsExplicitPermission) return true;
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      return result === "granted";
    } catch {
      return false;
    }
  }

  start(callback) {
    this._callback = callback;
    this._smoothed = 0;
    this._lastTickMs = performance.now();
    window.addEventListener("deviceorientation", this._handler, true);
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    window.removeEventListener("deviceorientation", this._handler, true);
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._callback = null;
  }

  calibrate() {
    this._offset = this._raw;
  }

  setMaxTilt(deg) {
    this.maxTiltDeg = Math.max(5, deg);
  }

  _handler(event) {
    const angle = (screen.orientation && typeof screen.orientation.angle === "number")
      ? screen.orientation.angle
      : (window.orientation || 0);

    let roll;
    if (angle === 90) {
      roll = -(event.beta ?? 0);
    } else if (angle === -90 || angle === 270) {
      roll = (event.beta ?? 0);
    } else {
      // Portrait fallback (shouldn't normally happen — wheel screen requires landscape).
      roll = (event.gamma ?? 0);
    }

    this._raw = roll;
  }

  _tick(nowMs) {
    const dt = Math.min(0.05, Math.max(0, (nowMs - this._lastTickMs) / 1000));
    this._lastTickMs = nowMs;

    const centered = this._raw - this._offset;

    // Dead zone: shave the first couple of degrees off both sides so hand tremor and sensor
    // noise near dead-ahead don't creep into the steering, then rescale the remaining travel
    // back to the full tilt range.
    const deadZoned = Math.abs(centered) <= this.deadZoneDeg
      ? 0
      : centered - Math.sign(centered) * this.deadZoneDeg;
    const usableRange = Math.max(1, this.maxTiltDeg - this.deadZoneDeg);
    const linear = Math.max(-1, Math.min(1, deadZoned / usableRange));

    // Response curve: a light power curve makes small corrections near center less twitchy
    // while still reaching full lock at max tilt — the same shape mobile racing games use
    // instead of a flat linear tilt-to-steering mapping.
    const curved = Math.sign(linear) * Math.pow(Math.abs(linear), this.curve);

    // Frame-rate-independent exponential smoothing: alpha is derived from elapsed time, not
    // "per event", so the feel stays consistent whether deviceorientation fires at 15Hz or
    // 60Hz on a given device.
    const alpha = 1 - Math.exp(-dt / this.smoothingTauSec);
    this._smoothed += (curved - this._smoothed) * alpha;

    if (this._callback) this._callback(this._smoothed);
    this._rafId = requestAnimationFrame(this._tick);
  }
}
