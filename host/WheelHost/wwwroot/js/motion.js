// Reads device tilt and turns it into a normalized steering value in [-1, 1], using the same
// pipeline mobile racing games (Real Racing, Asphalt, CSR, ...) use for tilt controls:
//
//   raw sensor angles -> screen-orientation compensation -> center offset -> dead zone
//   -> response curve -> time-based smoothing -> optional invert
//
// DeviceOrientation's beta/gamma are reported relative to the device's own physical (portrait)
// frame, not the screen's current visual orientation. Rather than hand-picking one raw axis per
// landscape rotation (easy to get an asymmetric sign wrong for one of the two rotations, which
// is exactly what produces "steers correctly in one physical orientation, backwards in the
// other"), this rotates the (gamma, beta) tilt vector by -screen.orientation.angle — the same
// transform the standard "screen-adjusted orientation" compensation from the W3C
// DeviceOrientation spec examples (and libraries built on it, e.g. gyronorm.js) use, specialized
// to the four 90-degree-step cases so it stays exact (no floating-point cos/sin residue mixing
// the two axes together). See _compensatedRoll below for the derivation.
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

  // Rotates the device's own (gamma, beta) tilt vector into the current screen's frame by
  // -angle, so "roll" always means the same physical motion (tilting the visible left edge
  // down = negative) no matter which way the device is physically rotated. Derivation: gamma is
  // the device's natural left-right tilt, beta its natural front-back tilt; treating those as a
  // 2D vector (gamma, beta) and rotating it clockwise by `angle` degrees (the same rotation
  // screen.orientation.angle says content was rotated, to stay upright) gives, at the four
  // 90-degree steps: 0 -> gamma, 90 -> beta, 180 -> -gamma, 270 -> -beta. Written out exactly
  // instead of via Math.cos/sin so 90/270 don't leak a tiny fraction of the other axis in.
  _compensatedRoll() {
    const angle = (screen.orientation && typeof screen.orientation.angle === "number")
      ? screen.orientation.angle
      : (window.orientation || 0);
    const normalized = ((angle % 360) + 360) % 360;

    switch (normalized) {
      case 90: return this._rawBeta;
      case 180: return -this._rawGamma;
      case 270: return -this._rawBeta;
      default: return this._rawGamma; // 0 — portrait fallback, shouldn't normally happen
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
