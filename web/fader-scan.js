/*
 * Fader scan (read-only experiment)
 * ---------------------------------
 * Reads every 788T user setting slot (0..MAX_ID) with C.Link USER_GET and
 * keeps each scan. Run a scan, move a fader on the 788T, scan again: the table
 * shows only slots whose value changed, so an input fader level slot (if the
 * 788T exposes one) shows up. Nothing is ever written to the recorder.
 */
(function () {
  "use strict";

  const MAX_ID = 639;
  const READ_TIMEOUT_MS = 400;
  const scans = [];     // [{label, at, values: Map(id -> hex | null)}]
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Names for slots the library already knows, parsed from its Get_ methods.
  function knownNames() {
    const names = new Map();
    const C = typeof SD788T !== "undefined" ? SD788T : null; // class declaration: global, but not on window
    if (!C) return names;
    for (const key of Object.getOwnPropertyNames(C.prototype)) {
      if (!/^Get_/.test(key)) continue;
      const src = String(C.prototype[key]);
      let m = /channelSettingId\(\s*(\d+)/.exec(src);
      if (m) {
        for (let ch = 1; ch <= 8; ch++) names.set(+m[1] + ch - 1, `${key.slice(4)} (in ${ch})`);
        continue;
      }
      m = /outputSettingId\(\s*(\d+)/.exec(src);
      if (m) {
        for (let o = 1; o <= 8; o++) if (!names.has(+m[1] + o - 1)) names.set(+m[1] + o - 1, `${key.slice(4)} (out ${o}?)`);
        continue;
      }
      m = /Setting\(\s*(\d+)\s*[,)]/.exec(src);
      if (m && !names.has(+m[1])) names.set(+m[1], key.slice(4));
    }
    return names;
  }

  function buildUi() {
    const style = document.createElement("style");
    style.textContent = `
      #fsPanel{display:none;position:fixed;inset:0;z-index:20400;background:#111;color:#eee;font-family:Arial;overflow:auto;padding:2vh 2vw;box-sizing:border-box}
      #fsPanel.open{display:block}
      #fsPanel h2{margin:0 0 1vh;font-size:3.4vh}
      #fsPanel p{font-size:2vh;color:#bbb;margin:.5vh 0 1.5vh}
      #fsPanel button{font-size:2.6vh;padding:1.2vh 2.4vw;margin:0 1vh 1vh 0;background:#000;color:#fff;border:3px solid #888;border-radius:10px}
      #fsPanel button.primary{border-color:#f80;color:#f80}
      #fsStatus{font-size:2vh;color:#ff0;margin:1vh 0}
      #fsPanel table{border-collapse:collapse;font-size:1.9vh}
      #fsPanel th,#fsPanel td{border:1px solid #444;padding:.4vh .7vw;text-align:left;font-family:monospace}
      #fsPanel th{background:#222;font-family:Arial}
      #fsPanel td.chg{background:#3a2a00;color:#fc6}
      .fsBtn{font-size:2.2vh;margin-right:1vh;background:#000;color:#f80;border:2px solid #f80;border-radius:8px;padding:.4vh 1.2vh}`;
    document.head.appendChild(style);

    const btn = document.createElement("button");
    btn.className = "fsBtn";
    btn.textContent = "SCAN";
    btn.onclick = () => $("fsPanel").classList.add("open");
    const anchor = $("connectButtons");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);

    const panel = document.createElement("div");
    panel.id = "fsPanel";
    panel.innerHTML = `
      <h2>Settings scan (read-only)</h2>
      <p>Finds which setting holds <b>Timecode Mode</b>. 1. Note the 788T's current Timecode Mode, then tap <b>Scan</b>.
         2. On the 788T change Timecode Mode to <b>Free Run</b>, tap <b>Scan</b>. 3. Change it to <b>Record Run</b>, tap <b>Scan</b>.
         4. Put it back to how it was, tap <b>Scan</b>. Then tap <b>Copy results</b> (or take a screenshot) and send them.
         This only reads; it never changes the recorder. Do it while not recording, and leave everything else alone. Each scan takes about 20–40 seconds.</p>
      <button class="primary" id="fsScan">Scan</button>
      <button id="fsCopy">Copy results</button>
      <button id="fsReset">Start over</button>
      <button id="fsClose">Close</button>
      <div id="fsStatus">No scans yet.</div>
      <div id="fsTable"></div>`;
    document.body.appendChild(panel);
    $("fsScan").onclick = scan;
    $("fsCopy").onclick = copyResults;
    $("fsReset").onclick = () => { scans.length = 0; render(); status("Cleared. No scans yet."); };
    $("fsClose").onclick = () => panel.classList.remove("open");
  }

  function status(t) { $("fsStatus").textContent = t; }

  async function readSlot(rec, id) {
    const payload = new Uint8Array([id & 0xff, (id >> 8) & 0xff]);
    try {
      const r = await rec.sendCommand(0x0A, payload, READ_TIMEOUT_MS, (x) => x.responseCommand !== 0xF0 || x.ackCode !== 0);
      return rec.hex(r.data) || "(empty)";
    } catch (e) {
      const msg = String(e.message || e);
      if (/ACK error 4|out of range|not supported|ACK error 1/i.test(msg)) return null; // slot doesn't exist
      // Timed out: let any late reply arrive, then drop it so it can't be
      // mistaken for the next slot's answer.
      await rec.sleep(300);
      rec.readBuffer = new Uint8Array(0);
      return "ERR";
    }
  }

  async function scan() {
    const api = window.__788, rec = window.recorder;
    if (!api || !rec || !rec.isConnected()) return status("Connect to the 788T first.");
    $("fsScan").disabled = true;
    const values = new Map();
    const t0 = Date.now();
    try {
      await api.runExclusiveOperation("Scanning settings...", async () => {
        for (let id = 0; id <= MAX_ID; id++) {
          values.set(id, await api.safeCommand(() => readSlot(rec, id)));
          if (id % 20 === 0) {
            const l = $("loadingOverlayText");
            if (l) l.innerText = `Scanning settings... ${id}/${MAX_ID}`;
          }
        }
      });
      scans.push({ label: "Scan " + (scans.length + 1), at: new Date(), values });
      const existing = [...values.values()].filter((v) => v !== null).length;
      status(`Scan ${scans.length} done in ${Math.round((Date.now() - t0) / 1000)} s: ${existing} settings answered.`
        + (scans.length === 1 ? " Now change Timecode Mode on the 788T and scan again." : ""));
      render();
    } catch (e) {
      status("Scan failed: " + (e.message || e));
    } finally {
      $("fsScan").disabled = false;
    }
  }

  function changedIds() {
    if (scans.length < 2) return [];
    const ids = [];
    for (let id = 0; id <= MAX_ID; id++) {
      const vals = scans.map((s) => s.values.get(id));
      if (vals.some((v) => v === "ERR")) continue;
      if (new Set(vals).size > 1) ids.push(id);
    }
    return ids;
  }

  function decode(hex) {
    if (!hex || hex === "(empty)") return "";
    const b = hex.split("-").map((x) => parseInt(x, 16));
    const u16 = (b[0] ?? 0) | ((b[1] ?? 0) << 8);
    const s16 = u16 > 0x7fff ? u16 - 0x10000 : u16;
    return b.length >= 2 ? `${u16} / ${s16}` : String(b[0]);
  }

  function rowsData() {
    const names = knownNames();
    return changedIds().map((id) => ({
      id,
      name: names.get(id) || "? unknown",
      vals: scans.map((s) => s.values.get(id)),
    }));
  }

  function render() {
    const rows = rowsData();
    if (scans.length < 2) { $("fsTable").innerHTML = scans.length ? "<p>One scan saved. Change Timecode Mode on the 788T and scan again.</p>" : ""; return; }
    if (!rows.length) { $("fsTable").innerHTML = "<p>No settings changed between scans.</p>"; return; }
    $("fsTable").innerHTML = `<table><thead><tr><th>Slot</th><th>Known as</th>${scans.map((s) => `<th>${esc(s.label)}</th>`).join("")}</tr></thead><tbody>${
      rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.name)}</td>${r.vals.map((v, i) =>
        `<td class="${i && v !== r.vals[i - 1] ? "chg" : ""}">${esc(v === null ? "–" : v)}<br><small>${esc(decode(v))}</small></td>`).join("")}</tr>`).join("")
    }</tbody></table>`;
  }

  function copyResults() {
    const rows = rowsData();
    const lines = [`Settings scan: ${scans.length} scans, slots 0-${MAX_ID}`];
    for (const r of rows) lines.push(`${r.id}\t${r.name}\t${r.vals.map((v) => (v === null ? "-" : v)).join("\t")}`);
    if (!rows.length) lines.push(scans.length < 2 ? "(need at least 2 scans)" : "(no changes)");
    const text = lines.join("\n");
    const t = document.createElement("textarea");
    t.value = text;
    t.setAttribute("readonly", "");
    $("fsPanel").appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (_) {}
    if (ok) {
      t.remove();
      status("Results copied. Paste them into the chat.");
    } else {
      // Leave the text visible so it can be selected and copied by hand.
      t.style.cssText = "display:block;width:100%;height:30vh;font:1.8vh monospace;background:#000;color:#fff;margin-top:1vh";
      status("Couldn't copy automatically. Select the text in the box below and copy it.");
    }
  }

  window.__788scan = { scans, changedIds, knownNames };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildUi);
  else buildUi();
})();
