// Local stand-in for WheelHost.exe's GameServer, for testing the phone/tablet web client
// (wwwroot) from a Mac without building/installing the real Windows host. Serves wwwroot
// and speaks the same join/motion/button/ping WebSocket protocol GameServer.cs implements —
// but does NOT drive a real virtual Xbox controller (ViGEm is Windows-only). Steering and
// button events are just printed live to the console so you can confirm the client is
// actually sending sane values.
//
// Served over HTTPS (self-signed cert) rather than plain HTTP: modern mobile browsers
// (iOS Safari, Chrome) silently refuse to fire deviceorientation/devicemotion events on a
// non-secure origin at all — no error, the permission prompt can even say "granted" and
// still nothing happens. A LAN IP like http://192.168.x.x is never "secure" by browser
// rules (only https: or localhost qualify), so gyro steering cannot work without this.
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wwwroot = path.resolve(__dirname, "../../host/WheelHost/wwwroot");
const certDir = path.join(__dirname, "certs");
const PORT = Number(process.argv[2]) || 7890;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function generateJoinCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getLanIPv4() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

function steerBar(value) {
  const width = 21;
  const pos = Math.max(0, Math.min(width - 1, Math.round(((value + 1) / 2) * (width - 1))));
  return "[" + "-".repeat(pos) + "●" + "-".repeat(width - 1 - pos) + "]";
}

// --- self-signed TLS cert, regenerated whenever the LAN IP or expiry changes ---
function ensureCert(lanIp) {
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  const metaPath = path.join(certDir, "meta.json");
  const wantedSans = ["localhost", "127.0.0.1", ...(lanIp ? [lanIp] : [])];

  let needsRegen = true;
  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const sameSans = JSON.stringify(meta.sans) === JSON.stringify(wantedSans);
      const stillValid = new Date(meta.notAfter) > new Date();
      needsRegen = !sameSans || !stillValid;
    } catch {
      needsRegen = true;
    }
  }

  if (needsRegen) {
    fs.mkdirSync(certDir, { recursive: true });
    const altNames = wantedSans
      .map((san, i) => {
        const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(san);
        return `${isIp ? "IP" : "DNS"}.${i + 1} = ${san}`;
      })
      .join("\n");

    const configPath = path.join(certDir, "openssl.cnf");
    fs.writeFileSync(
      configPath,
      [
        "[req]",
        "distinguished_name = dn",
        "x509_extensions = v3_req",
        "prompt = no",
        "[dn]",
        "CN = WheelHost Local Test Server",
        "[v3_req]",
        "subjectAltName = @alt_names",
        "[alt_names]",
        altNames,
        "",
      ].join("\n")
    );

    execFileSync(
      "openssl",
      [
        "req", "-x509", "-nodes",
        "-newkey", "rsa:2048",
        "-keyout", keyPath,
        "-out", certPath,
        "-days", "825",
        "-config", configPath,
      ],
      { stdio: "ignore" }
    );

    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        sans: wantedSans,
        notAfter: new Date(Date.now() + 820 * 24 * 3600 * 1000).toISOString(),
      })
    );
    console.log(`Generated a new self-signed TLS certificate for: ${wantedSans.join(", ")}`);
  }

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

const joinCode = generateJoinCode();
let activeSocket = null;
const lanIp = getLanIPv4();
const tls = ensureCert(lanIp);

const server = https.createServer(tls, (req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath.includes("..")) {
    res.writeHead(400).end("Bad request");
    return;
  }
  const filePath = path.join(wwwroot, urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
      // Same as the real GameServer: force revalidation so a test device never keeps
      // rendering from a stale/truncated cached copy of the CSS/JS.
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
});

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  let joined = false;
  const joinTimer = setTimeout(() => {
    if (!joined) ws.close(1002, "join timeout");
  }, 5000);

  ws.once("message", (raw) => {
    clearTimeout(joinTimer);
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.close(1002, "expected join message");
      return;
    }
    if (msg.type !== "join") {
      send(ws, { type: "error", message: "Expected join message" });
      ws.close(1002, "protocol error");
      return;
    }
    if (msg.code !== joinCode) {
      send(ws, { type: "error", message: "Invalid code" });
      ws.close(1002, "invalid code");
      return;
    }
    if (activeSocket) {
      send(ws, { type: "error", message: "Host already has a connected controller" });
      ws.close(1002, "busy");
      return;
    }

    joined = true;
    activeSocket = ws;
    console.log(`\n\u{1F7E2} ${msg.name || "Driver"} connected\n`);
    send(ws, { type: "welcome" });

    ws.on("message", (raw2) => {
      let m;
      try {
        m = JSON.parse(raw2.toString());
      } catch {
        return;
      }
      if (m.type === "motion" && typeof m.steer === "number") {
        process.stdout.write(`\rsteer ${m.steer.toFixed(2).padStart(5)}  ${steerBar(m.steer)}   `);
      } else if (m.type === "button") {
        console.log(`\n${m.state === "down" ? "▼" : "▲"} ${m.action}`);
      } else if (m.type === "ping" && typeof m.t === "number") {
        send(ws, { type: "pong", t: m.t });
      }
    });

    ws.on("close", () => {
      if (activeSocket === ws) {
        activeSocket = null;
        console.log(`\n\u{1F534} disconnected\n`);
      }
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("WheelHost mock test server (HTTPS) — client/UI testing only, no virtual controller");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Join code: ${joinCode}`);
  console.log(`On this Mac: https://localhost:${PORT}/?code=${joinCode}`);
  console.log(lanIp
    ? `On your iPad/phone (same Wi-Fi as this Mac): https://${lanIp}:${PORT}/?code=${joinCode}`
    : "Could not detect a LAN IPv4 address — check your Wi-Fi connection.");
  console.log("--------------------------------------------------------------------------------");
  console.log("The cert is self-signed, so the browser will show a privacy warning the first");
  console.log("time each device visits — this is expected for a LAN-only app with no public");
  console.log("domain. On iOS Safari: tap 'Show Details' -> 'visit this website' -> 'Visit");
  console.log("Website'. On Chrome/Android: tap 'Advanced' -> 'Proceed'. Needed once per device");
  console.log("(until the cert is regenerated, e.g. if your LAN IP changes).");
  console.log("--------------------------------------------------------------------------------\n");
});
