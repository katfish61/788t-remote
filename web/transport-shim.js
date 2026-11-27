/*
 * 788T transport shim
 * --------------------
 * The 788T Web Controller only talks to the recorder through
 * navigator.serial.requestPort() and the returned port's
 * open / readable / writable / setSignals / close. This file swaps in a
 * different port object behind that same interface, so the original app
 * code runs unchanged.
 *
 *   ws     : Raspberry Pi bridge (serial <-> WebSocket). Works in any browser,
 *            including iPad and Android, over Wi-Fi.
 *   usb    : WebUSB driver for the 788T's CP210x USB-UART. For Android Chrome,
 *            where Web Serial is missing or doesn't support CP210x.
 *   serial : the browser's own Web Serial (desktop Chrome/Edge). The default on desktop.
 *
 * One app, two links (like SD Remote): when the page can use both WebUSB and
 * the Pi bridge (Android Chrome, page served by the Pi), the user picks USB or
 * Wi-Fi with the switch next to Connect; the choice is remembered. iPad/iPhone
 * only get Wi-Fi (no WebUSB in Safari).
 *
 * How the starting link is picked:
 *   ?transport=ws|usb|serial   in the URL forces a mode
 *   ?bridge=HOST[:PORT]        uses the Pi bridge at that address
 *   the last choice saved on this device (localStorage), if still possible
 *   page served by the Pi      -> ws (the server sets window.CL788_BRIDGE)
 *   Android                    -> usb
 *   otherwise                  -> native serial
 */
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const hasNativeSerial = "serial" in navigator;
  const hasWebUSB = "usb" in navigator && window.isSecureContext !== false;
  const servedByPi = !!(params.get("bridge") || window.CL788_BRIDGE);
  const LINK_KEY = "cl788.link";

  // Links this page can offer.
  const links = [];
  if (hasWebUSB) links.push("usb");
  if (servedByPi || (!hasWebUSB && !hasNativeSerial && location.protocol.startsWith("http"))) links.push("ws");

  function pickMode() {
    const forced = (params.get("transport") || "").toLowerCase();
    if (forced) return forced;
    let saved = null;
    try { saved = localStorage.getItem(LINK_KEY); } catch (_) {}
    if (saved && links.includes(saved)) return saved;
    if (servedByPi) return "ws";
    if (isAndroid && hasWebUSB) return "usb";
    if (hasNativeSerial) return "serial";
    if (hasWebUSB) return "usb";
    // Opened over http with no Web Serial or WebUSB (e.g. iPad): assume the
    // server it came from is a bridge.
    if (location.protocol.startsWith("http")) return "ws";
    return "none";
  }

  let mode = pickMode();
  window.CL788_TRANSPORT = mode;
  window.CL788_LINKS = links.slice();
  console.log("[788T shim] transport =", mode, "available:", links.join(",") || "-");
  if ((mode === "serial" || mode === "none") && links.length < 2) return; // leave native behaviour alone

  // ---------------------------------------------------------------------------
  // Generic port: wraps a backend {open(opts), write(u8), close(), setBreak(b)}
  // and gives it the SerialPort-shaped surface the app expects.
  // ---------------------------------------------------------------------------
  class ShimPort extends EventTarget {
    constructor(backend) {
      super();
      this._backend = backend;
      this._ctrl = null;
      this.readable = null;
      this.writable = null;
      backend.onData = (bytes) => {
        if (!this._ctrl) return;
        try { this._ctrl.enqueue(bytes); } catch (_) {}
      };
      backend.onLost = (reason) => {
        console.warn("[788T shim] connection lost:", reason);
        // Say so plainly (the status text pops up), instead of the app just looking stuck.
        setTimeout(() => {
          const st = document.getElementById("statusText");
          if (st) st.textContent = "Connection lost (" + reason + "). Tap CONNECT to reconnect.";
        }, 600);
        try { this._ctrl && this._ctrl.error(new Error("Connection lost: " + reason)); } catch (_) {}
        this._ctrl = null;
        this.dispatchEvent(new Event("disconnect"));
      };
    }

    async open(options) {
      if (this.readable) throw new Error("Port is already open.");
      await this._backend.open(options || {});
      const self = this;
      this.readable = new ReadableStream({
        start(c) { self._ctrl = c; },
        cancel() { self._ctrl = null; },
      });
      this.writable = new WritableStream({
        write(chunk) { return self._backend.write(new Uint8Array(chunk)); },
      });
    }

    async setSignals(signals) {
      if (signals && "break" in signals) await this._backend.setBreak(!!signals.break);
    }

    async close() {
      try { this._ctrl && this._ctrl.close(); } catch (_) {}
      this._ctrl = null;
      this.readable = null;
      this.writable = null;
      await this._backend.close();
    }

    getInfo() { return this._backend.info || {}; }
  }

  // ---------------------------------------------------------------------------
  // WebSocket backend (Raspberry Pi bridge)
  // ---------------------------------------------------------------------------
  class WsBackend {
    constructor(url) {
      this.url = url;
      this.ws = null;
      this.pending = new Map();
      this.seq = 0;
      this.info = { transport: "ws", url };
    }

    _connect() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(this.url);
        ws.binaryType = "arraybuffer";
        const timer = setTimeout(() => { ws.close(); reject(new Error("Bridge not reachable at " + this.url)); }, 5000);
        ws.onopen = () => { clearTimeout(timer); this.ws = ws; resolve(); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error("Bridge not reachable at " + this.url)); };
        ws.onclose = () => {
          if (this.ws === ws) {
            this.ws = null;
            for (const p of this.pending.values()) p.reject(new Error("Bridge disconnected"));
            this.pending.clear();
            this.onLost && this.onLost("bridge WebSocket closed");
          }
        };
        ws.onmessage = (ev) => {
          if (typeof ev.data !== "string") {
            this.onData && this.onData(new Uint8Array(ev.data));
            return;
          }
          let msg;
          try { msg = JSON.parse(ev.data); } catch (_) { return; }
          if (msg.id != null && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error || "Bridge error"));
          } else if (msg.event === "serial_lost") {
            this.onLost && this.onLost(msg.error || "serial device lost on Pi");
          } else if (msg.event === "kicked") {
            console.warn("[788T shim] another device took control of the bridge");
            this.onLost && this.onLost("another device took control");
          }
        };
      });
    }

    async _call(op, extra) {
      await this._connect();
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.ws.send(JSON.stringify(Object.assign({ id, op }, extra || {})));
        setTimeout(() => {
          if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("Bridge timeout on " + op)); }
        }, 5000);
      });
    }

    async open(opts) { await this._call("open", { baudRate: opts.baudRate || 112500 }); }
    async write(u8) {
      // Same wording as Web Serial, so the app treats it as "not connected"
      // quietly instead of logging an error for every meter poll.
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("Serial port is not connected.");
      this.ws.send(u8);
    }
    async close() { try { await this._call("close"); } catch (_) {} }
    async setBreak(on) { await this._call("break", { on }); }
  }

  function bridgeUrl() {
    const b = params.get("bridge");
    if (b) return "ws://" + (b.includes(":") ? b : b + ":8788") + "/ws";
    const proto = location.protocol === "https:" ? "wss://" : "ws://";
    return proto + location.host + "/ws";
  }

  // ---------------------------------------------------------------------------
  // WebUSB CP210x backend (Android tablets)
  // Silicon Labs CP210x vendor requests (AN571).
  // ---------------------------------------------------------------------------
  const CP210X = {
    IFC_ENABLE: 0x00,
    SET_LINE_CTL: 0x03,
    SET_BREAK: 0x05,
    SET_MHS: 0x07,
    SET_BAUDRATE: 0x1e,
  };

  class Cp210xBackend {
    constructor(device) {
      this.device = device;
      this.iface = 0;
      this.epIn = null;
      this.epOut = null;
      this.isOpen = false;
      this.loopRunning = false;
      this.info = { transport: "webusb", usbVendorId: device.vendorId, usbProductId: device.productId };
      navigator.usb.addEventListener("disconnect", (e) => {
        if (e.device === this.device) { this.isOpen = false; this.onLost && this.onLost("USB unplugged"); }
      });
    }

    _ctl(request, value, data) {
      const setup = { requestType: "vendor", recipient: "interface", request, value, index: this.iface };
      return data ? this.device.controlTransferOut(setup, data) : this.device.controlTransferOut(setup);
    }

    async _ensureClaimed() {
      const d = this.device;
      if (!d.opened) await d.open();
      if (!d.configuration) await d.selectConfiguration(1);
      const intf = d.configuration.interfaces[0];
      this.iface = intf.interfaceNumber;
      if (!intf.claimed) await d.claimInterface(this.iface);
      for (const ep of intf.alternate.endpoints) {
        if (ep.type !== "bulk") continue;
        if (ep.direction === "in") this.epIn = ep;
        else this.epOut = ep;
      }
      if (!this.epIn || !this.epOut) throw new Error("CP210x bulk endpoints not found");
    }

    async open(opts) {
      await this._ensureClaimed();
      await this._ctl(CP210X.IFC_ENABLE, 0x0001);
      const baud = new DataView(new ArrayBuffer(4));
      baud.setUint32(0, opts.baudRate || 112500, true);
      await this._ctl(CP210X.SET_BAUDRATE, 0, baud.buffer);
      await this._ctl(CP210X.SET_LINE_CTL, 0x0800); // 8 data bits, no parity, 1 stop
      await this._ctl(CP210X.SET_MHS, 0x0303);      // DTR + RTS on, like desktop drivers do
      this.isOpen = true;
      this._readLoop();
    }

    async _readLoop() {
      if (this.loopRunning) return;
      this.loopRunning = true;
      const size = this.epIn.packetSize || 64;
      while (this.device.opened) {
        try {
          const r = await this.device.transferIn(this.epIn.endpointNumber, size);
          if (this.isOpen && r.data && r.data.byteLength) {
            this.onData && this.onData(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength).slice());
          }
          if (r.status === "stall") await this.device.clearHalt("in", this.epIn.endpointNumber);
        } catch (e) {
          if (!this.device.opened) break;
          await new Promise((res) => setTimeout(res, 50));
        }
      }
      this.loopRunning = false;
    }

    async write(u8) {
      if (!this.isOpen) throw new Error("USB port not open");
      await this.device.transferOut(this.epOut.endpointNumber, u8);
    }

    async close() {
      this.isOpen = false;
      try { await this._ctl(CP210X.IFC_ENABLE, 0x0000); } catch (_) {}
      // Keep the device claimed so reopening (used by the app's baud recovery)
      // doesn't need another permission prompt.
    }

    async setBreak(on) { await this._ctl(CP210X.SET_BREAK, on ? 1 : 0); }
  }

  // ---------------------------------------------------------------------------
  // Install navigator.serial replacement
  // ---------------------------------------------------------------------------
  let cachedPort = null;

  // Switch link (called by the USB / Wi-Fi switch in tablet.js). Only while
  // disconnected: an open port is never swapped underneath the app.
  window.CL788_setLink = function (newMode) {
    if (!links.includes(newMode)) return false;
    if (newMode === mode) return true;
    if (cachedPort && cachedPort.readable) return false;
    mode = newMode;
    window.CL788_TRANSPORT = mode;
    cachedPort = null;
    try { localStorage.setItem(LINK_KEY, mode); } catch (_) {}
    console.log("[788T shim] link switched to", mode);
    updateLinkBadge();
    return true;
  };

  const shimSerial = {
    async requestPort() {
      if (mode === "ws") {
        if (!cachedPort) cachedPort = new ShimPort(new WsBackend(bridgeUrl()));
        return cachedPort;
      }
      if (mode === "usb") {
        if (!hasWebUSB) throw new Error("WebUSB isn't available. Use Chrome on Android, and open the page from file:// or https://.");
        if (cachedPort) return cachedPort;
        let device = (await navigator.usb.getDevices()).find((d) => d.vendorId === 0x10c4);
        // No filter: list every USB device so a recorder with an unexpected ID still shows up.
        if (!device) device = await navigator.usb.requestDevice({ filters: [] });
        const id = (n) => n.toString(16).padStart(4, "0").toUpperCase();
        const desc = `${device.manufacturerName || "?"} / ${device.productName || "?"} (VID ${id(device.vendorId)}, PID ${id(device.productId)})`;
        console.log("[788T shim] selected USB device:", desc);
        if (device.vendorId !== 0x10c4) {
          usbBadge(desc); // only shown when it's the wrong device
          throw new Error(`Selected USB device is ${desc}, which is not a Silicon Labs CP210x. Send this ID to get the driver adjusted.`);
        }
        cachedPort = new ShimPort(new Cp210xBackend(device));
        return cachedPort;
      }
      throw new Error("Unknown transport: " + mode);
    },
    async getPorts() { return cachedPort ? [cachedPort] : []; },
    addEventListener() {},
    removeEventListener() {},
  };

  try {
    Object.defineProperty(navigator, "serial", { value: shimSerial, configurable: true });
  } catch (e) {
    console.error("[788T shim] could not install navigator.serial shim", e);
  }

  // Large on-screen readout of the chosen USB device (no dev tools on a tablet).
  function usbBadge(text) {
    let el = document.getElementById("cl788-usb-info");
    if (!el) {
      el = document.createElement("div");
      el.id = "cl788-usb-info";
      el.style.cssText = "position:fixed;top:30%;left:10%;right:10%;z-index:30000;background:#222;color:#ff0;border:2px solid #ff0;padding:16px;font:20px Arial;text-align:center";
      el.onclick = () => el.remove();
      document.body.appendChild(el);
    }
    el.textContent = "USB device: " + text + "  (tap to close)";
  }

  // Small badge so you can see which link is in use.
  function updateLinkBadge() {
    if (!document.body) return;
    let tag = document.getElementById("cl788-link-badge");
    if (!tag) {
      tag = document.createElement("div");
      tag.id = "cl788-link-badge";
      tag.style.cssText = "position:fixed;top:2px;right:4px;z-index:20000;font:11px Arial;color:#8f8;opacity:.7;pointer-events:none";
      document.body.appendChild(tag);
    }
    tag.textContent = mode === "ws" ? "Pi bridge (Wi-Fi)" : "USB";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", updateLinkBadge);
  else updateLinkBadge();
})();
