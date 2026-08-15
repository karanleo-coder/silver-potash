// Thin WebSocket wrapper: connect, JSON send/receive, keepalive ping + latency.
export class WheelSocket {
  constructor() {
    this.ws = null;
    this.pingTimer = null;
    this.onMessage = () => {};
    this.onOpen = () => {};
    this.onClose = () => {};
    this.onLatency = () => {};
    this._pingSentAt = 0;
  }

  connect(url) {
    this.close();
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.onOpen();
    };

    this.ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (msg.type === "pong") {
        this.onLatency(Date.now() - msg.t);
        return;
      }
      this.onMessage(msg);
    };

    this.ws.onclose = () => {
      this._stopPing();
      this.onClose();
    };

    this.ws.onerror = () => {
      // onclose fires right after; nothing extra to do here.
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // Callers must invoke this only after the join handshake completes (server "welcome") —
  // the server requires the very first frame it receives to be the join message, so pinging
  // can't start until after that.
  startPing() {
    this._startPing();
  }

  close() {
    this._stopPing();
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      try { this.ws.close(); } catch { /* already closed */ }
      this.ws = null;
    }
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping", t: Date.now() });
    }, 2000);
    this.send({ type: "ping", t: Date.now() });
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
