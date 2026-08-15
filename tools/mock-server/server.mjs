// Local stand-in for WheelHost.exe's GameServer, for testing the phone/tablet web client
// (wwwroot) from a Mac without building/installing the real Windows host. Serves wwwroot
// and speaks the same join/motion/button/ping WebSocket protocol GameServer.cs implements —
// but does NOT drive a real virtual Xbox controller (ViGEm is Windows-only). Steering and
// button events are just printed live to the console so you can confirm the client is
// actually sending sane values.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wwwroot = path.resolve(__dirname, "../../host/WheelHost/wwwroot");
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

const joinCode = generateJoinCode();
let activeSocket = null;

const server = http.createServer((req, res) => {
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
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
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
  const ip = getLanIPv4();
  console.log("WheelHost mock test server — client/UI testing only, no virtual controller");
  console.log("--------------------------------------------------------------------------");
  console.log(`Join code: ${joinCode}`);
  console.log(ip
    ? `On your iPad (same Wi-Fi as this Mac): http://${ip}:${PORT}/?code=${joinCode}`
    : "Could not detect a LAN IPv4 address — check your Wi-Fi connection.");
  console.log("--------------------------------------------------------------------------\n");
});
