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

const socket = new WheelSocket();
const motion = new MotionInput();
const ui = new WheelUI();

let steerLoopHandle = null;
let latestSteer = 0;
let wheelScreenActive = false;

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
  if (MotionInput.needsExplicitPermission) {
    showOnly(motionGate);
  } else {
    enterWheelScreen();
  }
}

$("enable-motion-btn").addEventListener("click", async () => {
  const granted = await MotionInput.requestPermission();
  if (!granted) {
    joinStatus.textContent = "Motion permission is required to use the wheel.";
    showOnly(joinScreen);
    socket.close();
    return;
  }
  enterWheelScreen();
});

function enterWheelScreen() {
  ui.renderLabels();
  ui.bindButtons((action, state) => {
    if (state === "down") haptics.tap();
    socket.send({ type: "button", action, state });
  });

  motion.setMaxTilt(ui.sensitivity);
  motion.start((normalized) => {
    latestSteer = normalized;
    ui.setWheelAngle(normalized);
  });

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

$("disconnect-btn").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
  wheelScreenActive = false;
  stopSteerLoop();
  motion.stop();
  socket.close();
  showOnly(joinScreen);
  joinStatus.textContent = "";
});

