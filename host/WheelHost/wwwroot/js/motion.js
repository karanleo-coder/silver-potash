// Reads device tilt and turns it into a normalized steering value in [-1, 1].
//
// DeviceOrientation's beta/gamma are reported relative to the device's own
// portrait frame, not the screen's current orientation. When the tablet is
// held in landscape "like a wheel", the rolling motion the user feels shows
// up on a different raw axis depending on which way landscape is rotated,
// so we read screen.orientation.angle to pick the right one and sign it
// consistently.
export class MotionInput {
  constructor() {
    this.maxTiltDeg = 35;
    this.smoothing = 0.25; // exponential moving average factor
    this._raw = 0;
    this._smoothed = 0;
    this._offset = 0;
    this._callback = null;
    this._handler = this._handler.bind(this);
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
    window.addEventListener("deviceorientation", this._handler, true);
  }

  stop() {
    window.removeEventListener("deviceorientation", this._handler, true);
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
    const centered = roll - this._offset;
    this._smoothed += (centered - this._smoothed) * this.smoothing;

    const normalized = Math.max(-1, Math.min(1, this._smoothed / this.maxTiltDeg));
    if (this._callback) this._callback(normalized);
  }
}
