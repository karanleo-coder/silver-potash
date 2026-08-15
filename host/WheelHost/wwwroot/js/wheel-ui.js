// Wheel graphic rotation, button press handling, remap UI, and
// localStorage-backed persistence for mapping + sensitivity.

const STORAGE_KEY = "wheelControllerSettings.v1";
const MAX_VISUAL_ANGLE_DEG = 90;

export const SLOTS = [
  { id: "gearDown", name: "Left Paddle" },
  { id: "gearUp", name: "Right Paddle" },
  { id: "extra1", name: "Top-Left Button" },
  { id: "extra2", name: "Top-Right Button" },
  { id: "brake", name: "Left Pedal" },
  { id: "accelerate", name: "Right Pedal" },
  { id: "handbrake", name: "Handbrake Button" },
];

export const ACTIONS = [
  { id: "accelerate", label: "Accelerate" },
  { id: "brake", label: "Brake" },
  { id: "gearUp", label: "Gear Up" },
  { id: "gearDown", label: "Gear Down" },
  { id: "handbrake", label: "Handbrake" },
  { id: "extra1", label: "Extra 1" },
  { id: "extra2", label: "Extra 2" },
];

const DEFAULT_MAPPING = Object.fromEntries(SLOTS.map((s) => [s.id, s.id]));
const DEFAULT_SENSITIVITY = 35;

function actionLabel(actionId) {
  return ACTIONS.find((a) => a.id === actionId)?.label ?? actionId;
}

export class WheelUI {
  constructor() {
    this.mapping = { ...DEFAULT_MAPPING };
    this.sensitivity = DEFAULT_SENSITIVITY;
    this._load();
    this._wheelSvg = document.getElementById("wheel-svg");
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.mapping) this.mapping = { ...DEFAULT_MAPPING, ...parsed.mapping };
      if (typeof parsed.sensitivity === "number") this.sensitivity = parsed.sensitivity;
    } catch {
      // corrupted/old data — fall back to defaults
    }
  }

  _save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mapping: this.mapping, sensitivity: this.sensitivity })
    );
  }

  setSlotAction(slotId, actionId) {
    this.mapping[slotId] = actionId;
    this._save();
    this.renderLabels();
  }

  setSensitivity(deg) {
    this.sensitivity = deg;
    this._save();
  }

  renderLabels() {
    document.querySelectorAll("[data-label-for]").forEach((el) => {
      const slotId = el.getAttribute("data-label-for");
      el.textContent = actionLabel(this.mapping[slotId]);
    });
  }

  setWheelAngle(normalizedSteer) {
    const deg = normalizedSteer * MAX_VISUAL_ANGLE_DEG;
    if (this._wheelSvg) {
      this._wheelSvg.style.transform = `rotate(${deg}deg)`;
    }
  }

  // Lets the driver grab the wheel graphic and rotate it directly with a finger — a
  // touch-drag steering input that works on every device regardless of whether tilt
  // sensors (DeviceOrientation) are available or granted. Runs alongside tilt; whichever
  // fires most recently wins, since both just report a normalized [-1, 1] steer value.
  bindWheelDrag(onSteerChange) {
    const wrap = document.querySelector(".wheel-wrap");
    if (!wrap) return;

    let dragging = false;
    let startAngle = 0;
    let startDeg = this._dragDeg ?? 0;

    const angleAt = (evt) => {
      const rect = wrap.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return Math.atan2(evt.clientY - cy, evt.clientX - cx) * (180 / Math.PI);
    };

    wrap.addEventListener("pointerdown", (evt) => {
      dragging = true;
      wrap.setPointerCapture(evt.pointerId);
      startAngle = angleAt(evt);
      startDeg = this._dragDeg ?? 0;
    });

    wrap.addEventListener("pointermove", (evt) => {
      if (!dragging) return;
      const delta = angleAt(evt) - startAngle;
      const deg = Math.max(-MAX_VISUAL_ANGLE_DEG, Math.min(MAX_VISUAL_ANGLE_DEG, startDeg + delta));
      this._dragDeg = deg;
      const normalized = deg / MAX_VISUAL_ANGLE_DEG;
      this.setWheelAngle(normalized);
      onSteerChange(normalized);
    });

    const endDrag = (evt) => {
      dragging = false;
      try { wrap.releasePointerCapture(evt.pointerId); } catch { /* already released */ }
    };
    wrap.addEventListener("pointerup", endDrag);
    wrap.addEventListener("pointercancel", endDrag);
  }

  resetWheelDrag(onSteerChange) {
    this._dragDeg = 0;
    this.setWheelAngle(0);
    onSteerChange(0);
  }

  bindButtons(onAction) {
    document.querySelectorAll("[data-slot]").forEach((el) => {
      const slotId = el.getAttribute("data-slot");

      const press = (evt) => {
        evt.preventDefault();
        el.classList.add("active");
        onAction(this.mapping[slotId], "down");
      };
      const release = (evt) => {
        evt.preventDefault();
        el.classList.remove("active");
        onAction(this.mapping[slotId], "up");
      };

      el.addEventListener("pointerdown", press);
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("pointerleave", (evt) => {
        if (el.classList.contains("active")) release(evt);
      });
    });
  }

  renderMappingList(container, onChangeExtra) {
    container.innerHTML = "";
    for (const slot of SLOTS) {
      const row = document.createElement("div");
      row.className = "mapping-row";

      const label = document.createElement("span");
      label.className = "slot-name";
      label.textContent = slot.name;

      const select = document.createElement("select");
      for (const action of ACTIONS) {
        const opt = document.createElement("option");
        opt.value = action.id;
        opt.textContent = action.label;
        if (this.mapping[slot.id] === action.id) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener("change", () => {
        this.setSlotAction(slot.id, select.value);
        if (onChangeExtra) onChangeExtra();
      });

      row.appendChild(label);
      row.appendChild(select);
      container.appendChild(row);
    }
  }
}
