import { WheelSocket } from "./ws.js";
import { MotionInput } from "./motion.js";
import { WheelUI } from "./wheel-ui.js";
import { initTheme } from "./theme.js";
import { haptics } from "./haptics.js";

const $ = (id) => document.getElementById(id);

initTheme($("theme-toggle-btn"));

const joinScreen = $("join-screen");
const motionGate = $("motion-gate");
const rotateGate = $("rotate-gate");
const wheelScreen = $("wheel-screen");
const settingsPanel = $("settings-panel");

const joinForm = $("join-form");
const codeInput = $("code-input");
const codeBoxes = Array.from(document.querySelectorAll(".code-box"));
const nameInput = $("name-input");
const joinStatus = $("join-status");
const connectBtn = $("connect-btn");

const connDot = $("conn-dot");
const connLabel = $("conn-label");
const pingLabel = $("ping-label");

const gyroBtn = $("gyro-btn");
const gyroDesc = $("gyro-desc");

const socket = new WheelSocket();
const motion = new MotionInput();
const ui = new WheelUI();

let steerLoopHandle = null;
let latestSteer = 0;
let wheelScreenActive = false;

// --- gyroscope permission: explicit, user-initiated, requested from the join screen ---
// "granted" / "denied" / "unnecessary" (no permission prompt exists on this browser) /
// "unknown" (needs a prompt but the driver hasn't tapped the button yet).
let gyroState = "unknown";

function setGyroBtn(state, label) {
  gyroState = state;
  gyroBtn.classList.remove("granted", "denied", "unnecessary");
  if (state !== "unknown") gyroBtn.classList.add(state);
  gyroBtn.textContent = label;
  gyroBtn.disabled = state === "granted" || state === "unnecessary";
}

if (!MotionInput.needsExplicitPermission) {
  gyroDesc.textContent = "This browser doesn't need a permission prompt — tilt steering is ready to go.";
  setGyroBtn("unnecessary", "Ready");
} else {
  gyroBtn.addEventListener("click", async () => {
    gyroBtn.disabled = true;
    gyroBtn.textContent = "Asking…";
    const granted = await MotionInput.requestPermission();
    if (granted) {
      gyroDesc.textContent = "Tilt sensor access granted — you're clear to race.";
      setGyroBtn("granted", "Enabled");
      haptics.tap();
    } else {
      gyroDesc.textContent = "Permission denied — no worries, you can still drag the on-screen wheel to steer.";
      setGyroBtn("denied", "Denied");
      haptics.error();
    }
  });
}

function showOnly(el) {
  [joinScreen, motionGate, rotateGate, wheelScreen].forEach((s) => s.classList.add("hidden"));
  el.classList.remove("hidden");
}

function wsUrlFromLocation() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

// --- segmented code entry ---
function getCodeValue() {
  return codeBoxes.map((b) => b.value).join("");
}

function setCodeValue(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 6).split("");
  codeBoxes.forEach((box, i) => {
    box.value = digits[i] || "";
    box.classList.toggle("filled", !!box.value);
  });
  codeInput.value = getCodeValue();
}

codeBoxes.forEach((box, i) => {
  box.addEventListener("input", () => {
    box.value = box.value.replace(/\D/g, "").slice(-1);
    box.classList.toggle("filled", !!box.value);
    codeInput.value = getCodeValue();
    if (box.value && i < codeBoxes.length - 1) codeBoxes[i + 1].focus();
  });

  box.addEventListener("keydown", (evt) => {
    if (evt.key === "Backspace" && !box.value && i > 0) {
      codeBoxes[i - 1].focus();
    }
  });

  box.addEventListener("paste", (evt) => {
    evt.preventDefault();
    const text = (evt.clipboardData || window.clipboardData).getData("text");
    setCodeValue(text);
    const filledCount = getCodeValue().length;
    codeBoxes[Math.min(filledCount, codeBoxes.length - 1)].focus();
  });
});

// --- prefill code from ?code= query param ---
(function prefillCode() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (code) setCodeValue(code);
})();

function setConnecting(isConnecting) {
  connectBtn.disabled = isConnecting;
  connectBtn.classList.toggle("loading", isConnecting);
}

// --- socket lifecycle wiring (set once; join flow only stashes what to send on open) ---
let pendingJoin = null;

socket.onOpen = () => {
  connDot.classList.remove("bad");
  connLabel.textContent = "Connected";
  if (pendingJoin) {
    socket.send({ type: "join", ...pendingJoin });
    pendingJoin = null;
  }
};

socket.onMessage = (msg) => handleHostMessage(msg);

socket.onClose = () => {
  setConnecting(false);
  connLabel.textContent = "Disconnected";
  connDot.classList.add("bad");
  if (wheelScreenActive) {
    // We were on the wheel screen — connection dropped after a successful join.
    wheelScreenActive = false;
    stopSteerLoop();
    motion.stop();
    showOnly(joinScreen);
    joinStatus.textContent = "Connection lost.";
  }
};

// --- join flow ---
joinForm.addEventListener("submit", (evt) => {
  evt.preventDefault();
  const code = getCodeValue();
  if (code.length !== 6) {
    joinStatus.textContent = "Enter the 6-digit code shown on the host.";
    codeBoxes.find((b) => !b.value)?.focus();
    return;
  }
  setConnecting(true);
  joinStatus.textContent = "";

  pendingJoin = { code, name: nameInput.value.trim() || "Driver" };
  socket.connect(wsUrlFromLocation());
});

async function handleHostMessage(msg) {
  if (msg.type === "welcome") {
    setConnecting(false);
    socket.startPing();
    haptics.joined();
    await proceedToWheel();
  } else if (msg.type === "error") {
    setConnecting(false);
    haptics.error();
    joinStatus.textContent = msg.message || "Could not join.";
    setCodeValue("");
    codeBoxes[0].focus();
    socket.close();
  }
}

// --- motion permission + wheel screen ---
async function proceedToWheel() {
  if (gyroState === "granted" || gyroState === "unnecessary") {
    // Already resolved on the join screen — no need to prompt again.
    enterWheelScreen(gyroState === "granted" || !MotionInput.needsExplicitPermission);
  } else if (gyroState === "denied") {
    // iOS only shows the permission dialog once per site; a second prompt is impossible,
    // so go straight in and just fall back to drag-to-steer.
    enterWheelScreen(false);
    flashTiltUnavailable();
  } else if (MotionInput.needsExplicitPermission) {
    showOnly(motionGate);
  } else {
    enterWheelScreen();
  }
}

$("enable-motion-btn").addEventListener("click", async () => {
  const granted = await MotionInput.requestPermission();
  enterWheelScreen(granted);
  if (!granted) {
    // iOS only shows its permission dialog once per site — after a denial, no page can
    // re-trigger it; only Settings can undo it. Tilt just won't move the wheel until then,
    // but dragging the wheel graphic directly always works, so still let them drive.
    flashTiltUnavailable();
  }
});

function flashTiltUnavailable() {
  const original = connLabel.textContent;
  connLabel.textContent = "Tilt unavailable — drag the wheel to steer";
  setTimeout(() => {
    if (connLabel.textContent === "Tilt unavailable — drag the wheel to steer") {
      connLabel.textContent = original;
    }
  }, 4000);
}

function enterWheelScreen(enableTilt = true) {
  ui.renderLabels();
  ui.bindButtons((action, state) => {
    if (state === "down") haptics.tap();
    socket.send({ type: "button", action, state });
  });

  ui.bindWheelDrag((normalized) => {
    latestSteer = normalized;
  });

  // Tilt is an enhancement, not a requirement — dragging the wheel graphic needs no
  // permission at all, so a denied/unavailable/skipped motion permission should never block
  // driving. Only wire up the sensor listener when it's actually usable.
  if (enableTilt) {
    motion.setMaxTilt(ui.sensitivity);
    motion.setInvert(ui.invert);
    motion.start((normalized) => {
      latestSteer = normalized;
      ui.setWheelAngle(normalized);
    });
  }

  wheelScreenActive = true;
  window.addEventListener("resize", applyOrientationGate);
  applyOrientationGate();

  startSteerLoop();
}

function applyOrientationGate() {
  if (!wheelScreenActive) return;
  const portrait = window.innerHeight > window.innerWidth;
  if (portrait) {
    showOnly(rotateGate);
  } else {
    showOnly(wheelScreen);
  }
}
window.addEventListener("orientationchange", () => setTimeout(applyOrientationGate, 200));

function startSteerLoop() {
  stopSteerLoop();
  steerLoopHandle = setInterval(() => {
    socket.send({ type: "motion", steer: latestSteer });
  }, 40);
}
function stopSteerLoop() {
  if (steerLoopHandle) {
    clearInterval(steerLoopHandle);
    steerLoopHandle = null;
  }
}

// --- calibrate ---
let calibrateFabTimer = null;
$("calibrate-btn").addEventListener("click", () => {
  motion.calibrate();
  ui.resetWheelDrag((normalized) => { latestSteer = normalized; });
  flashCalibrateFab();
});
document.addEventListener("touchstart", (evt) => {
  if (!wheelScreenActive) return;
  if (evt.touches.length >= 3) {
    motion.calibrate();
    flashCalibrateFab();
  }
});
function flashCalibrateFab() {
  const fab = $("calibrate-btn");
  fab.textContent = "Calibrated";
  fab.classList.add("flash");
  clearTimeout(calibrateFabTimer);
  calibrateFabTimer = setTimeout(() => {
    fab.classList.remove("flash");
    fab.textContent = "Calibrate center";
  }, 900);
}

// --- latency ---
socket.onLatency = (ms) => {
  pingLabel.textContent = `${ms} ms`;
  connDot.classList.toggle("bad", ms > 250);
};

// --- settings panel ---
$("settings-btn").addEventListener("click", () => {
  ui.renderMappingList($("mapping-list"), () => {});
  settingsPanel.classList.remove("hidden");
});
$("close-settings-btn").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

const sensitivitySlider = $("sensitivity-slider");
const sensitivityValue = $("sensitivity-value");
sensitivitySlider.value = String(ui.sensitivity);
sensitivityValue.textContent = String(ui.sensitivity);
sensitivitySlider.addEventListener("input", () => {
  const deg = Number(sensitivitySlider.value);
  sensitivityValue.textContent = String(deg);
  ui.setSensitivity(deg);
  motion.setMaxTilt(deg);
});

const invertToggle = $("invert-toggle");
invertToggle.checked = ui.invert;
invertToggle.addEventListener("change", () => {
  ui.setInvert(invertToggle.checked);
  motion.setInvert(invertToggle.checked);
});

$("disconnect-btn").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
  wheelScreenActive = false;
  stopSteerLoop();
  motion.stop();
  socket.close();
  showOnly(joinScreen);
  joinStatus.textContent = "";
});
