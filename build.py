#!/usr/bin/env python3
"""Inject the tablet + transport layers into the original 788T controller.

Writes dist/788T_Controller_tablet.html: a single standalone file that still
opens from file:// and is also what the Raspberry Pi bridge serves.
The original in original/ is never modified.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "original" / "788T_Web_Controller_multiunit_v18.html"
out = ROOT / "dist" / "788T_Controller_tablet.html"

html = src.read_text(encoding="utf-8")
anchor = '<meta charset="UTF-8">'
if anchor not in html:
    sys.exit(f"Could not find {anchor!r} in {src}; the original layout has changed.")

def read(name):
    return (ROOT / "web" / name).read_text(encoding="utf-8")

# Old-browser notice (written in ES5 so it runs everywhere): the app needs
# Safari 14.5 / iOS 14.5 or later (class static fields, ?? and ?., WritableStream).
# On anything older, say so instead of failing silently.
OLD_BROWSER_CHECK = """<script>(function(){var ok=true;try{new Function("class A{static x=1};var a=null;return a?.b??1;")();if(typeof WritableStream==="undefined")ok=false;}catch(e){ok=false;}
if(ok)return;var m=/OS (\\d+)_(\\d+)/.exec(navigator.userAgent);var v=m?(" (this one is on iOS "+m[1]+"."+m[2]+")"):"";
document.addEventListener("DOMContentLoaded",function(){var d=document.createElement("div");d.style.cssText="position:fixed;left:0;top:0;right:0;bottom:0;z-index:999999;background:#111;color:#fff;font:22px Arial,sans-serif;padding:8%;text-align:center";
d.innerHTML="<h2 style='color:#f80'>This browser is too old for 788T Remote</h2><p>It needs Safari on iOS / iPadOS 14.5 or later, or Chrome on Android"+v+".</p><p>Update the device in Settings, General, Software Update, or use another tablet or phone.</p>";document.body.appendChild(d);});})();</script>"""

inject = "\n".join([
    anchor,
    OLD_BROWSER_CHECK,
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    f"<style>\n{read('tablet.css')}</style>",
    f"<script>\n{read('transport-shim.js')}</script>",
    f"<script>\n{read('tablet.js')}</script>",
])
# Read-only settings scan (SCAN button), off unless needed. Used on a real 788T
# to find Record Media (74, not 73) and to confirm Timecode Mode (52) on 2026-11-26.
SCAN = False
html = html.replace(anchor, inject, 1)

# Take Start TC: the 788T sends plain binary bytes (FF SS MM HH), not packed BCD.
# Verified on a real 788T: 00-0F-39-00 is shown on the recorder as 00:57:15:00.
fn_start = html.index("function decodePackedTcByte(value) {")
fn_end = html.index("\n}\n", fn_start) + 3
html = html[:fn_start] + "function decodePackedTcByte(value) {\n  return Number(value) & 0xff; // binary, verified on 788T\n}\n" + html[fn_end:]

# Track arming: the original toggles arm when the meter is touched, which is
# too easy to hit by accident. Remove that, and give each track its own ARM
# button between the meter and the name (like Sound Devices' remote apps).
def patch(old, new, what):
    global html
    if html.count(old) != 1:
        sys.exit(f"Could not patch {what}: the original layout has changed.")
    html = html.replace(old, new)

patch("""  well.onclick = async () => {
    await toggleTrackArmFromPeakForUnit(unitId, trackNumber);
  };
""", "", "meter-tap arming")
patch("""  channel.appendChild(well);
  channel.appendChild(button);
  return channel;""", """  const armButton = document.createElement("button");
  armButton.id = meterDomId("armButton", unitId, trackNumber);
  armButton.className = "armButton";
  armButton.type = "button";
  armButton.textContent = "ARM";
  armButton.onclick = async () => {
    await toggleTrackArmFromPeakForUnit(unitId, trackNumber);
  };

  channel.appendChild(well);
  channel.appendChild(armButton);
  channel.appendChild(button);
  return channel;""", "arm buttons")
# The static meters shown before connecting get the same (inactive) buttons, so
# the layout doesn't jump; on connect rebuildMeterView() replaces them.
import re
html, n_static = re.subn(r'(\n\s*)(<button id="trackButton(\d+)" class="trackButton")',
                         r'\1<button id="armButton\3" class="armButton" type="button">ARM</button>\1\2', html)
if n_static != 12:
    sys.exit(f"Expected 12 static track buttons, found {n_static}; the original layout has changed.")
patch("""    el.onclick = async () => {
      await toggleTrackArmFromPeak(trackNumber);
    };""", """    el.onclick = null; // arming is on the ARM buttons now""", "static meter arming")
patch("""  if (scale) scale.classList.toggle("meterScaleDimmed", !armed);
""", """  if (scale) scale.classList.toggle("meterScaleDimmed", !armed);
  const armButton = getMeterElement("armButton", unitId, trackNumber);
  if (armButton) armButton.classList.toggle("armed", !!armed);
""", "arm button colour")

# Record Media and File Marker Mode are swapped in the original. A read-only
# scan on a real 788T (2026-11-26) showed Record Media in setting 74
# (INT only = 0, CF only = 1, INT + CF = 3), while setting 73 never changed.
patch("getEnumSetting(73, Media_Select)", "getEnumSetting(74, Media_Select)", "Record Media get")
# The 788T only acts on a new Record Media after Stop is pressed, so send Stop
# afterwards, but only when the transport is already stopped (never while
# recording, playing or paused).
patch("async Set_Media_Select(desired) { return await this.setEnumSetting(73, Media_Select, desired); }",
      """async Set_Media_Select(desired) {
    const result = await this.setEnumSetting(74, Media_Select, desired);
    try {
      if ((await this.Get_Transport_State()) === "Stop") await this.Set_Transport_State("Stop");
    } catch (_) {}
    return result;
  }""", "Record Media set")
patch("getEnumSetting(74, File_Marker_Mode)", "getEnumSetting(73, File_Marker_Mode)", "File Marker Mode get")
patch("setEnumSetting(74, File_Marker_Mode, desired)", "setEnumSetting(73, File_Marker_Mode, desired)", "File Marker Mode set")
patch("verified Media Select setting 73", "Media Select setting 74", "media status tooltip")

# L/R meters on the SD Remote-style home page: tracks 1 and 2 are the 788T's
# L and R tracks, so hand unit 0's track meters to tablet.js (no extra reads).
patch("""      if (meters && recorder.isConnected()) {
        drawTrackMeters(meters, unitId);
      }
""", """      if (meters && recorder.isConnected()) {
        drawTrackMeters(meters, unitId);
        if (unitId === 0 && window.drawMixMeters) window.drawMixMeters(meters);
      }
""", "L/R meters")

# Playback timecode. The original showed elapsed file time ("A. Time") in the
# big reader while playing. Logging on a real 788T (2026-11-26) showed that
# during playback the "received" TC in TIMECODE_GET is the playing file's own
# timecode, correct for any take (an older take read 11:44:10:00 while the
# newest started 15:22:33:00). So show that, run smoothly on the tablet's clock
# (the 788T is polled twice a second) and re-synced when it drifts. No extra
# C.Link reads. (The elapsed time's last field is hundredths, not frames.)
patch("""async function uiTick() {
""", """let pbBaseFrames = null, pbBaseAt = 0, pbTimer = null;
function tcToFrames(t, fps) {
  return (((Number(t.hours) || 0) * 60 + (Number(t.minutes) || 0)) * 60 + (Number(t.seconds) || 0)) * fps + (Number(t.frames) || 0);
}
function playbackFramesNow() {
  const rate = Number(currentFrameRateNumber) || 30;   // real frames per second (23.976 runs slow)
  return pbBaseFrames == null ? null : pbBaseFrames + (performance.now() - pbBaseAt) / 1000 * rate;
}
function renderPlaybackTc() {
  const tcEl = document.getElementById("tc");
  const f = playbackFramesNow();
  if (!tcEl || currentTransportState !== "Play" || f == null) return;
  const fps = Math.max(1, Math.round(Number(currentFrameRateNumber) || 30));
  let n = Math.floor(f) % (24 * 3600 * fps);
  const fr = n % fps; n = Math.floor(n / fps);
  const p = (x) => String(x).padStart(2, "0");
  tcEl.innerText = p(Math.floor(n / 3600)) + ":" + p(Math.floor(n / 60) % 60) + ":" + p(n % 60) + ":" + p(fr);
}
function stopPlaybackTc() {
  pbBaseFrames = null;
  if (pbTimer) { clearInterval(pbTimer); pbTimer = null; }
}

async function uiTick() {
""", "playback TC helper")
patch("""      lastRealTc = null;

      if (tcEl) {
        tcEl.innerText = formatTcParts(tc.fileTime);""", """      lastRealTc = null;

      if (tcEl) {
        const fps = Math.max(1, Math.round(Number(currentFrameRateNumber) || 30));
        const rxFrames = tcToFrames(tc.received, fps);
        const est = playbackFramesNow();
        if (est == null || Math.abs(est - rxFrames) > fps * 0.6) { pbBaseFrames = rxFrames; pbBaseAt = performance.now(); }
        if (!pbTimer) pbTimer = setInterval(renderPlaybackTc, 40);
        renderPlaybackTc();""", "playback TC")
patch("""    currentTransportState = state;
""", """    currentTransportState = state;
    if (state !== "Play") stopPlaybackTc();
""", "playback TC stop")

# Take cards showing ERR after False take / Slate up / Letter up: the 788T
# answers "Busy" for a moment after changing a take, and the original catches
# that per card and shows ERR straight away, so its outer retry never fires.
# Retry each card's read while the 788T is busy (up to ~4 s).
patch("""    try {
      rows.push(await readTakeSceneTakeForUnit(unitId, takeIndex));
    } catch (e) {""", """    try {
      let row = null;
      for (let attempt = 1; ; attempt += 1) {
        try {
          row = await readTakeSceneTakeForUnit(unitId, takeIndex);
          break;
        } catch (busyError) {
          const busyMsg = String(busyError && busyError.message ? busyError.message : busyError);
          if (attempt >= 10 || !/Busy|ACK error 3|Timeout/i.test(busyMsg)) throw busyError;
          await recorder.sleep(400);
        }
      }
      rows.push(row);
    } catch (e) {""", "take card busy retry")

# Credit: keep Joe Origlieri's line as is and add one underneath for the
# changes made here.
patch("""I have no rights to any of it.<br>I feel the need!
""", """I have no rights to any of it.<br>I feel the need!
<br><br>Tablet (WebUSB), Raspberry Pi Wi-Fi bridge, SD Remote-style layout and Sound Report added by Keith Tunney, 2026.
""", "credit line")

# Playback HP mode (setting 149) is off by one in the original: it sent the mode
# number minus 1 and read it back plus 1, so picking "Track L,R" (5) set the
# 788T to "Input 7,8" (4) while the app still showed L,R. Confirmed on a real
# 788T 2026-11-26: the 788T stores the mode number itself (0 = Disabled).
patch("""    const value = await this.getByteSetting(149);
    if (value === 0) return "Disabled";
    return HP_MONITOR_MODE_NAMES[value + 1] ?? String(value);""", """    const value = await this.getByteSetting(149);
    if (value === 0) return "Disabled";
    return HP_MONITOR_MODE_NAMES[value] ?? String(value);""", "playback HP mode read")
patch("""    (displayValue) => Number(displayValue) === 0 ? 0 : Number(displayValue) - 1""",
      """    (displayValue) => Number(displayValue)""", "playback HP mode write")

# Current HP selection (setting 119) is also off by one in the original: it
# treats the value as 0-based. On a real 788T (2026-11-26), with the headphones
# on slot 1 (L,R) the app showed "Slot 2", and choosing "Slot 1" sent 0, which
# put the headphones on a wrong mode. The 788T's value is the slot number itself.
patch("""function getCurrentHpSelectionDisplayValueFromDevice(rawValue) {
  // C.Link setting 119 reads/writes 0-based monitor-selection index.
  // UI displays 1-based slot numbers.
  return (Number(rawValue) || 0) + 1;
}

function getCurrentHpSelectionDeviceValueFromDisplay(displayValue) {
  return Math.max(0, (Number(displayValue) || 1) - 1);
}""", """function getCurrentHpSelectionDisplayValueFromDevice(rawValue) {
  // Setting 119 is the 1-based slot number (verified on a real 788T).
  return Number(rawValue) || 0;
}

function getCurrentHpSelectionDeviceValueFromDisplay(displayValue) {
  return Math.max(1, Number(displayValue) || 1);
}""", "current HP selection")

# Inline take cards (SD Remote / CL-WIFI style): Current and Next take show
# Scene, Take and Notes as fields edited in place, no popup. tablet.js builds
# the cards; these hooks feed them and write changes with the app's own
# verified write (all C.Link units, unit prefixes handled).
patch("""function setTakeButtonTextForUnits(buttonId, labelText, unitRows) {
  const el = document.getElementById(buttonId);
  if (!el) return;
""", """function setTakeButtonTextForUnits(buttonId, labelText, unitRows) {
  try { if (window.sdTakeCardRender) window.sdTakeCardRender(buttonId, unitRows); } catch (_) {}
  const el = document.getElementById(buttonId);
  if (!el) return;
""", "take card render hook")
patch("""    const sep = await getSceneTakeSeparator();
    const st = await readTakeSceneTake(takeIndex);
    return {
      unitId: unitId,
      scene: st.scene,
      take: st.take,
      sep: sep,
      error: null
    };""", """    const sep = await getSceneTakeSeparator();
    const st = await readTakeSceneTake(takeIndex);
    let notes = "";
    if (unitId === 0 && (takeIndex === 0 || takeIndex === 1)) {
      try { notes = await safeCommand(() => recorder.Get_Take_Notes(takeIndex)); } catch (_) { notes = ""; }
    }
    return {
      unitId: unitId,
      scene: st.scene,
      take: st.take,
      notes: notes,
      sep: sep,
      error: null
    };""", "take card notes read")
patch("""async function editTakeSceneTake(takeIndex) {""", """// Inline write from the take cards. field: "sceneTake" (scene + take) or "notes".
async function sdWriteTakeFields(takeIndex, field, values) {
  if (!recorder.isConnected()) { setText("statusText", "Connect first."); return false; }
  let ok = false;
  try {
    await runExclusiveOperation("Writing take metadata...", async () => {
      if (field === "notes") {
        await runForAllCLinkUnits("Take notes", async (unitId) => recorder.withUnitId(unitId, async () => {
          const okNotes = await setTakeTextParameterVerified(takeIndex, 3, String(values.notes ?? ""));
          if (!okNotes) throw new Error("notes write did not verify");
          return true;
        }));
      } else {
        await setTakeSceneTakeOnAllCLinkUnits(takeIndex, String(values.scene ?? ""), String(values.take ?? ""),
          String(values.originalScene ?? ""), String(values.originalTake ?? ""));
      }
      ok = true;
      await updateOneTakeButtonFromDeviceWithRetry(takeIndex);
      setText("statusText", (takeIndex === 1 ? "Next" : "Current") + " take updated.");
    });
  } catch (e) {
    const msg = e.message || e;
    log("Inline take edit failed:", msg);
    setText("statusText", (ok ? "Take updated, refresh failed: " : "Take update failed: ") + msg);
    try { await updateOneTakeButtonFromDeviceWithRetry(takeIndex); } catch (_) {}
  }
  return ok;
}
window.sdWriteTakeFields = sdWriteTakeFields;

async function editTakeSceneTake(takeIndex) {""", "inline take write")

# Change report (C.Link 0x55), found by capturing Sound Devices' CL-WiFi app,
# which polls it about once a second. 8 data bytes: byte 1 = 2 take list
# changed / 1 take edited (bytes 2-5 = handle), byte 6 = settings changed
# (e.g. arming), byte 7 = routing changed. Polled once a second while stopped
# or recording (never during playback), so changes made on the 788T's front
# panel show up: take cards, ARM buttons, and routing on the Inputs tab.
# Gives up after 5 failures so it can't disturb the link.
patch("""async function uiTick() {
""", """let changeReportAt = 0, changeReportFails = 0;
async function pollChangeReport(state) {
  if (state === "Play" || changeReportFails >= 5 || Date.now() - changeReportAt < 1000) return;
  changeReportAt = Date.now();
  let r = null;
  try {
    r = await trySafeCommand(() => recorder.sendCommand(0x55, new Uint8Array(0), recorder.timeoutMs,
      (x) => x.responseCommand === SD788T.CMD_DATA_RESPONSE));
  } catch (e) {
    changeReportFails += 1;
    log("Change report read failed (" + changeReportFails + "/5):", e.message || e);
    await recorder.sleep(300);
    recorder.readBuffer = new Uint8Array(0);
    return;
  }
  if (!r || !r.data || r.data.length < 8) return;
  changeReportFails = 0;
  const d = r.data;
  if (!d[1] && !d[6] && !d[7]) return;
  log("788T change report:", Array.from(d).map((x) => x.toString(16).padStart(2, "0")).join(" "));
  try {
    if (d[1]) await refreshAllTakeButtonsWithBusyRetry();
    if (d[6]) await refreshAllPeakMeterArmColors();
    const inputsTab = document.getElementById("inputs"), routingTab = document.getElementById("routing");
    const routingShown = (inputsTab && inputsTab.classList.contains("active")) || (routingTab && routingTab.classList.contains("active"));
    // Byte 7 is a bitmap: 1 = input-to-track routing changed, 4 = output routing changed (seen on a real 788T).
    if (d[7] & 1) { await refreshInputRoutingMatrix(); if (window.sdRenderRouting) window.sdRenderRouting(); if (window.sdRefreshStripInputs) window.sdRefreshStripInputs(); }
    if ((d[7] & 4) && window.sdReloadOutputs) await window.sdReloadOutputs();
  } catch (e) {
    log("Refresh after change report failed:", e.message || e);
  }
}

async function uiTick() {
""", "change report poll")
patch("""    await checkPhysicalTransportButtonSync(state);
""", """    await checkPhysicalTransportButtonSync(state);
    await pollChangeReport(state);
""", "change report call")

# Home page channel strips (SD Remote style), driven by tablet.js:
#  - track names edited inline in a box at the top of each strip (same write as
#    the rename popup), fed by a hook in setTrackButtonText;
#  - a MUTE button under ARM for tracks A-H = inputs 1-8 (the 788T mutes inputs;
#    setting 247+n, the same as the Inputs tab's mute boxes).
patch("""function setTrackButtonText(button, label, name) {
  if (!button) return;
""", """function setTrackButtonText(button, label, name) {
  if (!button) return;
  try { if (window.sdTrackNameRender) window.sdTrackNameRender(button, label, name); } catch (_) {}
""", "track name render hook")
patch("""async function acceptTrackNameEdit() {""", """async function sdWriteTrackName(unitId, trackNumber, newName) {
  if (!recorder.isConnected()) { setText("statusText", "Connect first."); return false; }
  let ok = false;
  try {
    await runExclusiveOperation("Writing U" + unitId + " track name...", async () => {
      ok = await safeCommandOnExplicitUnit(unitId, () => recorder.Set_Take_TrackName(TRACK_NAME_TAKE_INDEX, trackNumber, newName));
      if (!ok) { setText("statusText", "U" + unitId + " track rename failed."); return; }
      await refreshTrackNameBlobFromDeviceWithRetry(unitId);
      setText("statusText", "Track " + trackLabels[trackNumber - 1] + " renamed.");
    });
  } catch (e) {
    log("Inline track rename failed:", e.message || e);
    setText("statusText", "Track rename failed: " + (e.message || e));
  }
  return ok;
}
window.sdWriteTrackName = sdWriteTrackName;

let sdMutesLoadedAt = 0;
async function sdReadMutes() {
  const out = {};
  const eq = {};
  for (let i = 1; i <= 8; i++) {
    try { out[i] = !!(await safeCommand(() => recorder.Get_Input_Mute(i))); } catch (_) {}
    try { eq[i] = !!(await safeCommand(() => recorder.Get_Input_EQ_Enable(i))); } catch (_) {}
  }
  sdMutesLoadedAt = Date.now();
  if (window.sdMuteRender) window.sdMuteRender(out);
  if (window.sdEqRender) window.sdEqRender(eq);
  return out;
}
async function sdToggleMute(inputNumber, requested) {
  if (!recorder.isConnected()) return;
  try {
    await runExclusiveOperation((requested ? "Muting" : "Unmuting") + " input " + inputNumber + "...", async () => {
      await safeCommand(() => recorder.Set_Input_Mute(inputNumber, !!requested));
      await recorder.sleep(200);
      const actual = !!(await retryRecoverableOperation("Input " + inputNumber + " mute verify",
        () => safeCommand(() => recorder.Get_Input_Mute(inputNumber)), 10, 250));
      setInputMuteCheckState(inputNumber, actual);
      if (window.sdMuteRender) window.sdMuteRender({ [inputNumber]: actual });
      setText("statusText", "Input " + inputNumber + (actual ? " muted." : " unmuted."));
    });
  } catch (e) {
    log("Mute failed:", e.message || e);
    setText("statusText", "Input " + inputNumber + " mute failed: " + (e.message || e));
  }
}
window.sdToggleMute = sdToggleMute;

async function acceptTrackNameEdit() {""", "inline track name + mute")
# load mutes (and refresh on settings change) from the change-report poll
patch("""  if (!r || !r.data || r.data.length < 8) return;
  changeReportFails = 0;""", """  if (!r || !r.data || r.data.length < 8) return;
  changeReportFails = 0;
  if (Date.now() - sdMutesLoadedAt > 30000) {
    try { await sdReadMutes(); } catch (_) {}
    // Routing too, so each strip's MUTE mutes the input that really feeds its track.
    try { await refreshInputRoutingMatrix(); if (window.sdRefreshStripInputs) window.sdRefreshStripInputs(); if (window.sdRenderRouting) window.sdRenderRouting(); } catch (_) {}
  }""", "mute initial load")
patch("""    if (d[6]) await refreshAllPeakMeterArmColors();""", """    if (d[6]) { await refreshAllPeakMeterArmColors(); await sdReadMutes(); }""", "mute refresh on change")

# The letter box at the bottom of each strip opens the fat channel in the new
# layout (tablet.js); the original's page-level rename handler stands aside
# there (names are edited in the strip's top box). ?classic keeps the popup.
patch("""function handleTrackButtonPointer(event) {
  const target = parseTrackButtonTargetFromElement(event.target);""", """function handleTrackButtonPointer(event) {
  if (document.body && document.body.classList.contains("sdPersistent")) return;
  const target = parseTrackButtonTargetFromElement(event.target);""", "rename popup stands aside")

# Slate up (the original Letter Up button, now shown as a clapperboard) still
# follows the 788T's Scene Increment Mode. Fix for numbers mode: the original
# parsed only the FIRST number, so "3-39-X36" became "4"; step the LAST number
# and keep the rest ("3-39-X36" -> "3-39-X37", "012" -> "013").
patch("""function getNextNumericScene(sceneText) {
  const scene = String(sceneText ?? "").trim();
  const n = parseInt(scene, 10);

  if (!Number.isFinite(n)) {
    return scene;
  }

  return String(n + 1);
}""", """function getNextNumericScene(sceneText) {
  const scene = String(sceneText ?? "").trim();
  const m = /^(.*?)(\\d+)([^\\d]*)$/.exec(scene);
  if (!m) return scene;
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, "0");
}""", "numeric slate up keeps the scene")

# The Letter Up button is called Slate up now (clapperboard icon): rename its
# dialog and messages, and explain the "disabled" case.
for _old, _new in [
    ('showConfirmDialog("Letter up?", doLetterUpConfirmed);', 'showConfirmDialog("Slate up?", doLetterUpConfirmed);'),
    ('await runForAllCLinkUnits("Letter up", async (unitId) => {', 'await runForAllCLinkUnits("Slate up", async (unitId) => {'),
    ('await runExclusiveOperation("Letter up all C.Link units...", async () => {', 'await runExclusiveOperation("Slate up all C.Link units...", async () => {'),
    ('setText("statusText", "Letter up done on all C.Link units.");', 'setText("statusText", "Slate up done on all C.Link units.");'),
    ('log("Letter up succeeded, metadata refresh failed:", msg);', 'log("Slate up succeeded, metadata refresh failed:", msg);'),
    ('setText("statusText", "Letter up succeeded, metadata refresh failed: " + msg);', 'setText("statusText", "Slate up succeeded, metadata refresh failed: " + msg);'),
    ('log("Letter up failed:", msg);', 'log("Slate up failed:", msg);'),
    ('setText("statusText", "Letter up failed: " + msg);', 'setText("statusText", "Slate up failed: " + msg);'),
    ('throw new Error("scene increment disabled");', 'throw new Error("the 788T\'s Scene Increment Mode is Disabled. Set it to Letters or Numbers on the 788T");'),
]:
    patch(_old, _new, "slate up wording")

# Outputs tab, SD Remote style (tablet.js): the original Outputs page isn't
# shown in the new layout, so skip its (slow) population there. (Output meters
# are worked out in tablet.js from the track meters: on a real 788T every
# GetMeters group returned the track meters, so there are no real input or
# output meters to read.)
patch("""async function PopulateOutputsTab() {
  if (!recorder.isConnected()) return;
""", """async function PopulateOutputsTab() {
  if (!recorder.isConnected()) return;
  if (document.body && document.body.classList.contains("sdPersistent")) return; // tablet.js draws its own Outputs view
""", "outputs tab skipped in new layout")
patch("""        if (unitId === 0 && window.drawMixMeters) window.drawMixMeters(meters);
""", """        if (unitId === 0 && window.drawMixMeters) window.drawMixMeters(meters);
""", "output meters")

# Read-only probe for rewind/fast-forward: the library only knows transport
# states Stop/Play/Record/Pause. If the 788T reports any other state (e.g. while
# REW or FF is held on the front panel), show its number in the status bar.
patch("""    currentTransportState = state;
""", """    currentTransportState = state;
    if (!["Stop", "Play", "Record", "Pause"].includes(state)) setText("statusText", "Transport state " + state + " (unknown to the app)");
    if (state !== window.__lastLoggedTransport) { log("Transport state:", state); window.__lastLoggedTransport = state; }
""", "transport state probe")

# Expose a few of the app's own module functions to the sound report, by
# appending one line at the end of its <script type="module">.
expose = ["runExclusiveOperation", "safeCommand", "readTakeBrowserInfoFromHandle", "takeParam", "toggleTrackArmFromPeakForUnit", "refreshInputRoutingMatrix", "bindInputGlobalDropdowns", "refreshInputGlobals"]
for name in expose:
    if f"function {name}(" not in html:
        sys.exit(f"{name}() not found in the original; the sound report needs updating for this version.")
mod_start = html.index('<script type="module">')
mod_end = html.index("</script>", mod_start)
hook = ("\nwindow.__788 = { " + ", ".join(expose) + " };\n"
        # Routing tab (tablet.js) reads the app's own routing state.
        "window.__788routingState = () => ({ routes: inputRoutingByInput, prePost: inputPrePostRoutingByInput });\n")
html = html[:mod_end] + hook + html[mod_end:]
body_end = html.rindex("</body>")
html = html[:body_end] + f"<script>\n{read('sound-report.js')}</script>\n" + html[body_end:]
if SCAN:
    body_end = html.rindex("</body>")
    html = html[:body_end] + f"<script>\n{read('fader-scan.js')}</script>\n" + html[body_end:]
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")

# Installable offline app folder for Android (serve it from localhost on the tablet once, then install).
import shutil, struct, zlib
# web/fader-scan.js (read-only settings scan) is kept but not built in:
# a 2026-11-25 scan of slots 0-639 on a real 788T showed no input fader level setting.
app = ROOT / "dist" / "tablet-app"
app.mkdir(parents=True, exist_ok=True)
pwa_head = "\n".join([
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icon-192.png">',
    "<script>if('serviceWorker' in navigator && isSecureContext)"
    "navigator.serviceWorker.register('sw.js').catch(console.warn);</script>",
])
(app / "index.html").write_text(html.replace(anchor, anchor + "\n" + pwa_head, 1), encoding="utf-8")
for f in ("sw.js", "manifest.webmanifest"):
    shutil.copy(ROOT / "web" / f, app / f)

def png(size):
    # Black square with a red "record" dot.
    r2 = (size * 0.3) ** 2
    c = size / 2
    rows = b"".join(
        b"\x00" + b"".join(
            (b"\xe0\x10\x10" if (x - c) ** 2 + (y - c) ** 2 < r2 else b"\x11\x11\x11") for x in range(size))
        for y in range(size))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))
for n in (192, 512):
    (app / f"icon-{n}.png").write_bytes(png(n))
# The Pi bridge serves the same app folder, service worker included.
pi_app = ROOT / "pi" / "app"
if pi_app.exists():
    shutil.rmtree(pi_app)
shutil.copytree(app, pi_app)  # includes sw.js: the Pi's app also works offline (USB without the Pi)
print(f"Built {app}/ (installable app) and copied it to pi/app/")
print(f"Built {out} ({out.stat().st_size // 1024} KB) from {src.name}")
