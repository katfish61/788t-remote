#!/usr/bin/env python3
"""
788T Wi-Fi bridge for Raspberry Pi
==================================
The Pi sits on the 788T, plugged into its USB port (Connection Mode:
USB/WaveAgent). It serves the controller page over Wi-Fi and passes bytes
both ways between the browser (WebSocket) and the 788T (USB serial).

  http://<pi>:8788/      -> the controller page (any browser: Android, iPad, laptop)
  ws://<pi>:8788/ws      -> serial bridge

WebSocket protocol (used by web/transport-shim.js):
  binary frames          raw serial bytes, both directions
  text JSON from client  {"id":n,"op":"open","baudRate":112500}
                         {"id":n,"op":"close"}
                         {"id":n,"op":"break","on":true|false}
  text JSON to client    {"id":n,"ok":true} / {"id":n,"ok":false,"error":"..."}
                         {"event":"serial_lost","error":"..."}
                         {"event":"kicked"}

Only one browser controls the recorder at a time, because C.Link is
request/response and two controllers would mix up each other's replies. A newly
connected device takes over, and the previous one is told it was "kicked".
"""
import argparse
import asyncio
import glob
import json
import logging
import threading
from pathlib import Path

import serial  # pyserial
from aiohttp import WSMsgType, web

log = logging.getLogger("788t-bridge")
HERE = Path(__file__).resolve().parent


def find_device(explicit=None):
    if explicit:
        return explicit
    candidates = sorted(glob.glob("/dev/serial/by-id/*CP210*")) or \
                 sorted(glob.glob("/dev/serial/by-id/*")) or \
                 sorted(glob.glob("/dev/ttyUSB*"))
    return candidates[0] if candidates else None


class SerialLink:
    """Owns the serial port and a reader thread that forwards bytes to the active socket."""

    def __init__(self, device_arg, loop):
        self.device_arg = device_arg
        self.loop = loop
        self.ser = None
        self.reader = None
        self.on_bytes = None  # async callable(bytes)
        self.on_lost = None   # async callable(str)
        self.lock = threading.Lock()

    def open(self, baud):
        self.close()
        dev = find_device(self.device_arg)
        if not dev:
            raise RuntimeError("No 788T found on USB. Check the cable, and set Connection Mode to USB/WaveAgent.")
        ser = serial.Serial(dev, baudrate=baud, bytesize=8, parity="N", stopbits=1,
                            timeout=0.05, write_timeout=1, rtscts=False, dsrdtr=False, xonxoff=False)
        with self.lock:
            self.ser = ser
        self.reader = threading.Thread(target=self._read_loop, args=(ser,), daemon=True)
        self.reader.start()
        log.info("opened %s @ %d", dev, baud)

    def _read_loop(self, ser):
        try:
            while True:
                with self.lock:
                    if self.ser is not ser:
                        return
                data = ser.read(ser.in_waiting or 1)
                if data and self.on_bytes:
                    asyncio.run_coroutine_threadsafe(self.on_bytes(data), self.loop)
        except (serial.SerialException, OSError, TypeError) as e:
            with self.lock:
                still_current = self.ser is ser
                if still_current:
                    self.ser = None
            if still_current:
                log.warning("serial lost: %s", e)
                if self.on_lost:
                    asyncio.run_coroutine_threadsafe(self.on_lost(str(e)), self.loop)

    def write(self, data):
        with self.lock:
            ser = self.ser
        if not ser:
            raise RuntimeError("Serial not open")
        ser.write(data)

    def set_break(self, on):
        with self.lock:
            ser = self.ser
        if not ser:
            raise RuntimeError("Serial not open")
        ser.break_condition = bool(on)

    def close(self):
        with self.lock:
            ser, self.ser = self.ser, None
        if ser:
            try:
                ser.close()
            except Exception:
                pass
            log.info("closed serial")


class Bridge:
    def __init__(self, args):
        self.args = args
        self.active_ws = None
        self.link = None

    async def on_startup(self, app):
        self.link = SerialLink(self.args.device, asyncio.get_running_loop())
        self.link.on_bytes = self._to_client
        self.link.on_lost = self._serial_lost

    async def _to_client(self, data):
        ws = self.active_ws
        if ws is not None and not ws.closed:
            await ws.send_bytes(data)

    async def _serial_lost(self, err):
        ws = self.active_ws
        if ws is not None and not ws.closed:
            await ws.send_str(json.dumps({"event": "serial_lost", "error": err}))

    async def index(self, request):
        page = Path(self.args.app) / "index.html"
        if not page.exists():
            return web.Response(status=500, text=f"Controller page not found at {page}. Run build.py and copy the pi/ folder to the Pi.")
        html = page.read_text(encoding="utf-8")
        # Tell the shim it's being served by the bridge.
        html = html.replace("<head>", "<head><script>window.CL788_BRIDGE=true;</script>"
                            # iPhone/iPad home screen: icon, name and a black status bar.
                            '<link rel="apple-touch-icon" href="icon-192.png">'
                            '<meta name="apple-mobile-web-app-title" content="788T Remote">'
                            '<meta name="apple-mobile-web-app-status-bar-style" content="black">', 1)
        return web.Response(text=html, content_type="text/html",
                            headers={"Cache-Control": "no-store"})

    async def status(self, request):
        return web.json_response({
            "device": find_device(self.args.device),
            "serial_open": bool(self.link and self.link.ser),
            "client_connected": self.active_ws is not None,
        })

    async def ws_handler(self, request):
        ws = web.WebSocketResponse(heartbeat=5)
        await ws.prepare(request)
        peer = request.remote
        old = self.active_ws
        if old is not None and not old.closed:
            log.info("%s taking over from previous client", peer)
            try:
                await old.send_str(json.dumps({"event": "kicked"}))
                await old.close()
            except Exception:
                pass
            self.link.close()
        self.active_ws = ws
        log.info("client connected: %s", peer)
        loop = asyncio.get_running_loop()
        try:
            async for msg in ws:
                if msg.type == WSMsgType.BINARY:
                    try:
                        await loop.run_in_executor(None, self.link.write, msg.data)
                    except Exception as e:
                        await ws.send_str(json.dumps({"event": "serial_lost", "error": str(e)}))
                elif msg.type == WSMsgType.TEXT:
                    await self._handle_control(ws, msg.data, loop)
        finally:
            if self.active_ws is ws:
                self.active_ws = None
                self.link.close()
            log.info("client gone: %s", peer)
        return ws

    async def _handle_control(self, ws, text, loop):
        try:
            req = json.loads(text)
        except ValueError:
            return
        rid, op = req.get("id"), req.get("op")
        try:
            if op == "open":
                baud = self.args.baud or int(req.get("baudRate", 112500))
                await loop.run_in_executor(None, self.link.open, baud)
            elif op == "close":
                await loop.run_in_executor(None, self.link.close)
            elif op == "break":
                await loop.run_in_executor(None, self.link.set_break, req.get("on"))
            else:
                raise RuntimeError(f"unknown op {op}")
            await ws.send_str(json.dumps({"id": rid, "ok": True}))
        except Exception as e:
            log.warning("%s failed: %s", op, e)
            await ws.send_str(json.dumps({"id": rid, "ok": False, "error": str(e)}))


def main():
    p = argparse.ArgumentParser(description="788T USB-serial to Wi-Fi bridge")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8788)
    p.add_argument("--device", help="serial device (default: auto-detect CP210x)")
    p.add_argument("--baud", type=int, help="force a baud rate instead of what the page asks for (testing only)")
    p.add_argument("--app", default=str(HERE / "app"),
                   help="folder with the built tablet app (index.html, manifest, icons)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    bridge = Bridge(args)
    app = web.Application()
    app.on_startup.append(bridge.on_startup)
    app.router.add_get("/", bridge.index)
    app.router.add_get("/index.html", bridge.index)
    # Manifest and icons, so the page can be installed as an app from the Pi.
    for name in ("icon-192.png", "icon-512.png"):
        app.router.add_get("/" + name, lambda r, n=name: web.FileResponse(Path(args.app) / n))

    async def service_worker(request):
        # Offline cache, so the installed app also opens (and works over USB)
        # away from the Pi. Never cached itself, so updates are picked up.
        sw = Path(args.app) / "sw.js"
        if not sw.exists():
            return web.Response(status=404)
        return web.Response(text=sw.read_text(encoding="utf-8"), content_type="application/javascript",
                            headers={"Cache-Control": "no-cache"})
    app.router.add_get("/sw.js", service_worker)

    async def manifest(request):
        # One app for USB and Wi-Fi (switch next to Connect), installed from the Pi.
        m = json.loads((Path(args.app) / "manifest.webmanifest").read_text(encoding="utf-8"))
        m["name"], m["short_name"] = "788T Remote", "788T Remote"
        return web.json_response(m, content_type="application/manifest+json")
    app.router.add_get("/manifest.webmanifest", manifest)
    app.router.add_get("/status", bridge.status)

    async def clientlog(request):
        # The page's console messages (sent by tablet.js in bridge mode), so
        # problems on a tablet or iPad show up in the Pi's journal.
        text = (await request.text())[:20000]
        for line in text.splitlines()[:100]:
            log.info("page %s: %s", request.remote, line[:400])
        return web.Response(text="ok")
    app.router.add_post("/clientlog", clientlog)
    app.router.add_get("/ws", bridge.ws_handler)
    web.run_app(app, host=args.host, port=args.port, print=lambda *_: log.info("listening on :%d", args.port))


if __name__ == "__main__":
    main()
