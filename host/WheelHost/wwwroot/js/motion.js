// Reads device tilt and turns it into a normalized steering value in [-1, 1], using the same
// pipeline mobile racing games (Real Racing, Asphalt, CSR, ...) use for tilt controls:
//
//   raw sensor angles -> screen-orientation compensation -> center offset -> dead zone
//   -> response curve -> time-based smoothing -> optional invert
//
// DeviceOrientation's beta/gamma are reported relative to the device's own physical (portrait)
// frame, not the screen's current visual orientation, and which one tracks "left-right roll"
// depends on both the current screen rotation *and* how upright the device is held (see
// _compensatedRoll's comment — this is held upright in landscape, like a wheel, not flat).
// screen.orientation.angle picks the right raw axis for the current rotation and signs it so
// both landscape rotations agree with each other, instead of the two rotations needing
// independently-guessed signs (which is how a device can end up steering correctly held one way
// and backwards held the other way — the two guesses just don't have to agree with each other
// unless the code forces them to).
//
// The sensor callback only ever *records* the latest raw angles — all the shaping (compensation,
// dead zone, curve, smoothing) runs in a requestAnimationFrame loop instead, decoupled from
// however often deviceorientation actually fires (it varies a lot: ~60Hz on some devices,
// ~15-20Hz on others). That keeps the steering feel — and the smoothing time-constant
// specifically — identical across devices, the same way a game's update loop is decoupled from
// its input polling.
export class MotionInput {
  constructor() {
    this.maxTiltDeg = 35;
    this.deadZoneDeg = 2.5; // ignore micro-jitter right around dead-ahead
    this.curve = 1.6; // >1 = gentler near center, full lock still reachable at max tilt
    this.smoothingTauSec = 0.06; // exponential smoothing time-constant, frame-rate independent
    this.invert = false; // safety-net user preference — see _compensatedRoll's derivation note

    this._rawBeta = 0;
    this._rawGamma = 0;
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
    this._offset = this._compensatedRoll();
  }

  setMaxTilt(deg) {
    this.maxTiltDeg = Math.max(5, deg);
  }

  setInvert(invert) {
    this.invert = !!invert;
  }

  _handler(event) {
    this._rawBeta = event.beta ?? 0;
    this._rawGamma = event.gamma ?? 0;
  }

  // Picks whichever raw axis currently reads the device's left-right roll and signs it so both
  // landscape rotations agree with each other, using screen.orientation.angle.
  //
  // beta/gamma's textbook roles ("beta = front-back, gamma = left-right") only hold near the
  // spec's flat-on-a-table reference pose. This app holds the device roughly *upright*, in
  // landscape, like an actual wheel — a very different attitude — and at that attitude the two
  // axes swap which physical motion they respond to (a well-known quirk of DeviceOrientation's
  // Euler angles: they're only decoupled like their names suggest near beta=gamma=0). Confirmed
  // on real hardware: held upright in landscape, gamma tracks left-right roll and beta tracks
  // forward/backward nod — the opposite of the flat-pose assumption an earlier version of this
  // code made, which is why tilting the device forward/back was steering it instead of rolling
  // it left-right doing nothing.
  _compensatedRoll() {
    const angle = (screen.orientation && typeof screen.orientation.angle === "number")
      ? screen.orientation.angle
      : (window.orientation || 0);
    const normalized = ((angle % 360) + 360) % 360;

    switch (normalized) {
      case 90: return this._rawGamma;
      case 180: return -this._rawBeta;
      case 270: return -this._rawGamma;
      default: return this._rawBeta; // 0 — portrait fallback, shouldn't normally happen
    }
  }

  _tick(nowMs) {
    const dt = Math.min(0.05, Math.max(0, (nowMs - this._lastTickMs) / 1000));
    this._lastTickMs = nowMs;

    const centered = this._compensatedRoll() - this._offset;

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

    if (this._callback) this._callback(this.invert ? -this._smoothed : this._smoothed);
    this._rafId = requestAnimationFrame(this._tick);
  }
}
