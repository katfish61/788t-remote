/*
 * Sound report for the 788T Web Controller.
 * Reads take metadata from the recorder using the app's own take-browser code
 * (exposed by build.py as window.__788). It runs inside the app's
 * runExclusiveOperation, so meter polling is paused while it reads.
 *
 * Output: printable sheet (Print -> Save as PDF), CSV download, or Share (tablet).
 */
(function () {
  "use strict";

  const LS_KEY = "788t-report-header";
  const TRACK_LABELS = ["L", "R", "A", "B", "C", "D", "E", "F", "G", "H", "X1", "X2"];
  const HEADER_FIELDS = [
    ["production", "Production"],
    ["company", "Company / Client"],
    ["director", "Director"],
    ["mixer", "Sound Mixer"],
    ["boom", "Boom Op"],
    ["contact", "Phone / Email"],
    ["roll", "Roll / Card"],
    ["day", "Shoot Day"],
    ["location", "Location"],
    ["general", "General Notes"],
  ];

  let takes = [];         // oldest first
  let meta = {};          // date, sample rate, etc.

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- styles
  const css = `
  #srPanel{display:none;position:fixed;inset:0;z-index:20500;background:#111;color:#eee;font-family:Arial;overflow:auto;padding:2vh 2vw;box-sizing:border-box}
  #srPanel.open{display:block}
  #srPanel h2{margin:0 0 1.5vh;font-size:3.6vh}
  #srPanel .srRow{display:flex;flex-wrap:wrap;gap:1vh 2vw;margin-bottom:1.5vh}
  #srPanel label{display:flex;flex-direction:column;font-size:1.8vh;color:#aaa;min-width:22vw;flex:1}
  #srPanel input,#srPanel select{font-size:2.4vh;padding:.8vh;background:#000;color:#fff;border:2px solid #444;border-radius:6px}
  #srPanel button{font-size:2.6vh;padding:1.2vh 2.4vw;background:#000;color:#fff;border:3px solid #888;border-radius:10px}
  #srPanel button.primary{border-color:lime;color:lime}
  #srPanel .srStatus{font-size:2vh;color:#ff0;margin:1vh 0}
  #srPanel table{border-collapse:collapse;width:100%;font-size:1.8vh}
  #srPanel th,#srPanel td{border:1px solid #444;padding:.5vh .6vw;text-align:left;vertical-align:top}
  #srPanel th{background:#222}
  #srSheet{display:none}
  .srBtn{font-size:2.2vh;margin-right:1vh;background:#000;color:#ff0;border:2px solid #ff0;border-radius:8px;padding:.4vh 1.2vh}
  @media print{
    @page{size:A4 landscape;margin:10mm}
    html,body{overflow:visible!important;height:auto!important;width:auto!important;transform:none!important;background:#fff!important}
    body>*{display:none!important}
    body>#srSheet{display:block!important}
    #srSheet{color:#000;font-family:Arial;font-size:9pt}
    #srSheet h1{font-size:16pt;margin:0 0 4mm}
    #srSheet .hdr{display:grid;grid-template-columns:repeat(4,1fr);gap:1mm 6mm;margin-bottom:4mm}
    #srSheet .hdr div b{display:inline-block;min-width:28mm;color:#444;font-weight:normal}
    #srSheet table{border-collapse:collapse;width:100%}
    #srSheet th,#srSheet td{border:1px solid #888;padding:1mm 1.5mm;text-align:left;vertical-align:top}
    #srSheet th{background:#eee}
    #srSheet tr{page-break-inside:avoid}
    #srSheet td.c{text-align:center;font-weight:bold}
    #srSheet .foot{margin-top:3mm;color:#666;font-size:8pt}
  }`;

  // ---------------------------------------------------------------- UI
  function buildUi() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const btn = document.createElement("button");
    btn.className = "srBtn";
    btn.textContent = "REPORT";
    btn.onclick = openPanel;
    const anchor = $("connectButtons");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
    else document.body.appendChild(btn);

    const saved = loadHeader();
    const panel = document.createElement("div");
    panel.id = "srPanel";
    panel.innerHTML = `
      <h2>Sound Report</h2>
      <div class="srRow">
        ${HEADER_FIELDS.map(([k, l]) => `<label>${l}<input data-k="${k}" value="${esc(saved[k] || "")}"></label>`).join("")}
      </div>
      <div class="srRow" style="align-items:flex-end">
        <label style="flex:0 0 auto;min-width:30vw">Day
          <select id="srDay"><option value="">(read takes first)</option></select></label>
        <label style="flex:0 0 auto;min-width:16vw">Report for
          <select id="srMedia">
            <option value="">(not specified)</option><option value="CF card">CF card</option>
            <option value="Internal drive">Internal drive</option><option value="External drive">External drive</option>
          </select></label>
      </div>
      <div class="srRow" style="align-items:center">
        <button class="primary" id="srRead">Read takes from 788T</button>
        <button class="primary" id="srCardFiles" style="border-color:#4cf;color:#4cf">From card files</button>
        <button id="srCardFolder" style="display:none;border-color:#4cf;color:#4cf">From card folder</button>
        <input type="file" id="srFileIn" multiple accept=".wav,.WAV,audio/wav,audio/x-wav" style="display:none">
        <input type="file" id="srDirIn" webkitdirectory multiple style="display:none">
        <button id="srSharePdf">Share PDF</button>
        <button id="srShareCsv">Share CSV</button>
        <button id="srShareBoth">Share both</button>
        <button id="srClose">Close</button>
      </div>
      <div class="srStatus" id="srStatus">Fill in the header, then tap "Read takes from 788T". Best done between takes, not while recording.</div>
      <div id="srTable"></div>`;
    document.body.appendChild(panel);

    const sheet = document.createElement("div");
    sheet.id = "srSheet";
    document.body.appendChild(sheet);

    panel.addEventListener("input", (e) => { if (e.target.dataset.k) saveHeader(); });
    $("srRead").onclick = readTakes;
    // Diagnostics for the Android pickers: show when we're back from the picker
    // and whether it was cancelled, so a long hand-over is distinguishable.
    let pickerOpenAt = 0;
    const markOpen = () => { pickerOpenAt = Date.now(); };
    window.addEventListener("focus", () => {
      if (!pickerOpenAt) return;
      const t0 = pickerOpenAt;
      status("Back from the picker. Waiting for Chrome to hand over the files...");
      const tick = setInterval(() => {
        if (pickerOpenAt !== t0) return clearInterval(tick);
        status(`Back from the picker. Waiting for Chrome to hand over the files... ${Math.round((Date.now() - t0) / 1000)} s`);
      }, 1000);
    });
    for (const id of ["srFileIn", "srDirIn"]) {
      $(id).addEventListener("cancel", () => { pickerOpenAt = 0; status("Picker closed without choosing anything."); });
      $(id).addEventListener("change", () => { pickerOpenAt = 0; });
    }
    $("srCardFiles").addEventListener("click", markOpen);
    $("srCardFolder").addEventListener("click", markOpen);
    $("srCardFiles").onclick = () => { status("Opening file picker..."); $("srFileIn").value = ""; $("srFileIn").click(); };
    $("srFileIn").onchange = (e) => loadCardFiles([...e.target.files]);
    if ("webkitdirectory" in HTMLInputElement.prototype) {
      // The folder picker works on Android; the file picker drags in camera and
      // microphone prompts there. So show the folder option only.
      $("srCardFiles").style.display = "none";
      $("srCardFolder").textContent = "From card reader";
      $("srCardFolder").style.display = "";
      $("srCardFolder").onclick = () => { status("Opening folder picker..."); $("srDirIn").value = ""; $("srDirIn").click(); };
      $("srDirIn").onchange = (e) => loadCardFiles([...e.target.files]);
    }
    $("srSharePdf").onclick = () => shareOut("pdf");
    $("srShareCsv").onclick = () => shareOut("csv");
    $("srShareBoth").onclick = () => shareOut("both");
    $("srClose").onclick = () => panel.classList.remove("open");
    $("srMedia").value = saved._media || "";
    $("srMedia").onchange = saveHeader;

    $("srDay").onchange = render;
  }

  function openPanel() { $("srPanel").classList.add("open"); }
  function status(t) { $("srStatus").textContent = t; }

  function loadHeader() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { return {}; } }
  function header() {
    const h = {};
    document.querySelectorAll("#srPanel input[data-k]").forEach((i) => { h[i.dataset.k] = i.value.trim(); });
    return h;
  }
  function saveHeader() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(header(), { _media: $("srMedia").value }))); } catch (_) {}
  }

  // ---------------------------------------------------------------- reading
  async function readTakes() {
    const api = window.__788;
    const rec = window.recorder;
    if (!api || !rec) return status("Report support missing from this build.");
    if (!rec.isConnected()) return status("Connect to the 788T first.");

    const read = [];
    status("Reading takes...");
    $("srRead").disabled = true;

    try {
      await api.runExclusiveOperation("Reading takes for sound report...", async () => {
        meta = await readRecorderMeta(api, rec);

        const qty = 50;
        for (let start = 0; start > -5000; start -= qty) {
          const handles = await api.safeCommand(() => rec.Get_Take_List(start, qty));
          for (const h of handles) {
            const info = await api.readTakeBrowserInfoFromHandle(h, start);
            if (!info.fileName) continue;
            read.push(info);
            setLoading(`Reading takes for sound report... ${read.length}`);
          }
          if (handles.length < qty) break;
        }
      });
      takes = read.reverse();
      meta.source = "788T take list";
      buildDays();
      const spec = [meta.fileType, meta.sampleRate, meta.bitDepth, meta.fps && meta.fps + " fps"].filter(Boolean).join(" · ");
      const partial = takes.length >= 90
        ? " The 788T only loads its last 100 files at power-up, so the oldest day may be incomplete." : "";
      status(`Read ${takes.length} takes in ${days.length} day${days.length === 1 ? "" : "s"}${spec ? " (" + spec + ")" : ""}.${partial}`);
      render();
    } catch (e) {
      status("Reading takes failed: " + (e.message || e) + (read.length ? ` (got ${read.length} before the error)` : ""));
      if (read.length) { takes = read.reverse(); buildDays(); render(); }
    } finally {
      $("srRead").disabled = false;
    }
  }

  // ---------------------------------------------------------------- card files
  // Reads the Broadcast WAV headers (fmt, bext, iXML) of files from the CF card.
  // Only small chunks are read; the audio data is skipped.
  async function loadCardFiles(files) {
    status(`Picked ${files.length} file(s)...`);
    try { await loadCardFilesInner(files); }
    catch (e) { status("Reading card files failed: " + (e && (e.message || e))); console.error(e); }
  }

  async function loadCardFilesInner(files) {
    files = files.filter((f) => /\.wav$/i.test(f.name) && !/(^|\/)(FALSETAKES|TRASH|SOUNDDEV)\//i.test(f.webkitRelativePath || "") && !f.name.startsWith("._"));
    if (!files.length) return status("No WAV files selected. Open the daily folder on the card and select its files.");
    status(`Reading ${files.length} files...`);
    const parsed = [];
    const errors = [];
    for (let i = 0; i < files.length; i++) {
      try { parsed.push(await parseWav(files[i])); }
      catch (e) { errors.push(files[i].name + ": " + (e.message || e)); }
      if (i % 10 === 0) status(`Reading files... ${i + 1}/${files.length}`);
    }
    if (!parsed.length) return status("Couldn't read any of the files. " + errors.slice(0, 3).join("; "));

    // Mono WAV: one file per track (NAMET01_1.WAV, _2 ...). Merge siblings into one take.
    const byTake = new Map();
    for (const f of parsed) {
      const m = /^(.*)_([1-9A-C])\.wav$/i.exec(f.fileName);
      const key = (f.folder || "") + "/" + (m && f.channels === 1 ? m[1] + "_X.WAV" : f.fileName);
      if (!byTake.has(key)) byTake.set(key, { ...f, fileName: key.split("/").pop(), cols: [], mono: !!(m && f.channels === 1) });
      const t = byTake.get(key);
      if (t.mono) {
        const n = "123456789ABC".indexOf(m[2].toUpperCase()) + 1;
        t.cols.push({ label: "T" + n, name: f.cols[0] ? f.cols[0].name : "•" });
      } else t.cols = f.cols;
    }
    const list = [...byTake.values()];
    list.sort((a, b) => (a.created || "").localeCompare(b.created || "") || a.fileName.localeCompare(b.fileName));
    for (const t of list) t.cols.sort((a, b) => colOrder(a.label) - colOrder(b.label));

    takes = list;
    const first = list[0];
    meta = {
      source: "Card files",
      recorder: first.originator || "Sound Devices 788T",
      firmware: "",
      date: first.date || new Date().toISOString().slice(0, 10),
      fileType: list.some((t) => t.mono) ? "Mono WAV" : "Poly WAV",
      sampleRate: first.sampleRate ? fmtRate(first.sampleRate) : "",
      bitDepth: first.bits ? first.bits + "-bit" : "",
      fps: first.fps || "",
      recordedTo: "",
    };
    if (!$("srMedia").value) { $("srMedia").value = "CF card"; saveHeader(); }
    buildDays();
    render();
    status(`Read ${list.length} takes from ${parsed.length} files in ${days.length} roll${days.length === 1 ? "" : "s"}.`
      + (errors.length ? ` ${errors.length} file(s) skipped: ${errors.slice(0, 2).join("; ")}` : ""));
  }

  function fmtRate(hz) {
    const k = hz / 1000;
    return (Number.isInteger(k) ? k : +k.toFixed(3)) + " kHz";
  }

  async function readBytes(file, start, len) {
    return new DataView(await file.slice(start, start + len).arrayBuffer());
  }
  const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  const asciiz = (dv, o, n) => {
    let out = "";
    for (let i = 0; i < n && o + i < dv.byteLength; i++) { const c = dv.getUint8(o + i); if (!c) break; out += String.fromCharCode(c); }
    return out.trim();
  };

  async function parseWav(file) {
    const head = await readBytes(file, 0, 12);
    const riff = fourcc(head, 0);
    if ((riff !== "RIFF" && riff !== "RF64") || fourcc(head, 8) !== "WAVE") throw new Error("not a WAV file");
    const t = { fileName: file.name, folder: (file.webkitRelativePath || "").split("/").slice(0, -1).join("/"), cols: [] };
    let fmt = null, bext = null, ixml = null, dataSize = 0;
    let off = 12;
    while (off + 8 <= file.size) {
      const h = await readBytes(file, off, 8);
      const id = fourcc(h, 0);
      const size = h.getUint32(4, true);
      if (id === "fmt ") fmt = await readBytes(file, off + 8, Math.min(size, 40));
      else if (id === "bext") bext = await readBytes(file, off + 8, Math.min(size, 602));
      else if (id === "iXML") ixml = new TextDecoder().decode(await (file.slice(off + 8, off + 8 + Math.min(size, 65536))).arrayBuffer());
      else if (id === "data") dataSize = size === 0xffffffff ? file.size - off - 8 : size;
      off += 8 + size + (size & 1);
      if (size === 0xffffffff) break;
    }
    if (!fmt) throw new Error("no fmt chunk");
    t.channels = fmt.getUint16(2, true);
    t.sampleRate = fmt.getUint32(4, true);
    const blockAlign = fmt.getUint16(12, true);
    t.bits = fmt.getUint16(14, true);
    if (dataSize && blockAlign && t.sampleRate) t.length = fmtDuration(dataSize / blockAlign / t.sampleRate);

    let samples = null, tsRate = t.sampleRate, rate = null, dropFrame = false;
    if (bext) {
      t.originator = asciiz(bext, 256, 32);
      t.date = asciiz(bext, 320, 10).replace(/[:/.]/g, "-");
      t.created = t.date + " " + asciiz(bext, 330, 8);
      samples = bext.getUint32(338, true) + bext.getUint32(342, true) * 4294967296;
      // Sound Devices also writes key=value pairs into the bext description.
      const desc = asciiz(bext, 0, 256);
      const kv = (k) => { const m = new RegExp("(?:^|[\\r\\n])s?" + k + "=([^\\r\\n]*)", "i").exec(desc); return m ? m[1].trim() : ""; };
      t.scene = kv("SCENE"); t.takeNumber = kv("TAKE"); t.notes = kv("NOTE"); t.roll = kv("TAPE");
      for (let n = 1; n <= 12; n++) { const nm = kv("TRK" + n); if (nm) t.cols.push({ label: "T" + n, name: nm }); }
    }
    if (ixml) {
      const doc = new DOMParser().parseFromString(ixml.replace(/\0+$/g, "").trim(), "text/xml");
      const g = (tag, root = doc) => { const el = root.getElementsByTagName(tag)[0]; return el ? el.textContent.trim() : ""; };
      t.scene = g("SCENE") || t.scene;
      t.takeNumber = g("TAKE") || t.takeNumber;
      t.notes = g("NOTE") || t.notes;
      t.roll = g("TAPE") || t.roll;
      t.project = g("PROJECT");
      const r = g("TIMECODE_RATE");
      if (r) { const [n, d] = r.split("/").map(Number); rate = d ? n / d : n; }
      dropFrame = /^DF$/i.test(g("TIMECODE_FLAG"));
      const hi = g("TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI"), lo = g("TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO");
      if (lo !== "") samples = Number(lo) + Number(hi || 0) * 4294967296;
      tsRate = Number(g("TIMESTAMP_SAMPLE_RATE")) || Number(g("FILE_SAMPLE_RATE")) || tsRate;
      const fsr = Number(g("FILE_SAMPLE_RATE"));
      if (fsr) t.sampleRate = fsr;
      const tracks = [...doc.getElementsByTagName("TRACK")];
      if (tracks.length) {
        t.cols = tracks.map((tr) => ({ label: "T" + (g("CHANNEL_INDEX", tr) || g("INTERLEAVE_INDEX", tr)), name: g("NAME", tr) || "•" }));
      }
    }
    if (!t.cols.length) for (let n = 1; n <= t.channels; n++) t.cols.push({ label: "T" + n, name: "•" });
    if (rate) t.fps = (Math.round(rate * 1000) / 1000) + (dropFrame ? " DF" : "");
    t.startTC = samples != null && tsRate ? samplesToTc(samples, tsRate, rate || 25, dropFrame) : "--";
    return t;
  }

  function fmtDuration(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
  }

  // Samples since midnight -> timecode. For 23.976/29.97 the count is in TC frames
  // at the real rate; display uses the nominal frame count (24/30).
  function samplesToTc(samples, sr, rate, df) {
    const nominal = Math.round(rate);
    let frames = Math.round((samples / sr) * rate);
    if (df && nominal === 30) {
      const perMin = 1798, per10 = 17982, d = Math.floor(frames / per10), m = frames % per10;
      frames += 18 * d + (m > 2 ? 2 * Math.floor((m - 2) / perMin) : 0);
    }
    const ff = frames % nominal, tot = Math.floor(frames / nominal);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(Math.floor(tot / 3600) % 24)}:${p(Math.floor(tot / 60) % 60)}:${p(tot % 60)}${df ? ";" : ":"}${p(ff)}`;
  }

  function setLoading(text) { const l = $("loadingOverlayText"); if (l) l.innerText = text; }

  async function readRecorderMeta(api, rec) {
    const m = {
      fileType: "",
      sampleRate: "",
      bitDepth: "",
      fps: "",
      recorder: "Sound Devices 788T",
      firmware: "",
      date: "",
    };
    // Read straight from the recorder; fall back to the home-screen readout.
    const get = async (fn) => { try { return fmtEnum(await api.safeCommand(fn)); } catch (_) { return ""; } };
    m.fileType = await get(() => rec.Get_File_Record_Format());
    try {
      const sel = String(await api.safeCommand(() => rec.Get_Media_Select()) || "");
      const names = { INHDD: "Internal drive", CF: "CF card", EXHDD: "External drive" };
      m.recordedTo = /^\d+$/.test(sel) ? "" : sel.split("_").map((x) => names[x] || x).join(" + ");
    } catch (_) { m.recordedTo = ""; }
    m.sampleRate = (await get(() => rec.Get_SampleRate())) || liveText("liveSRate", "S.Rate");
    m.bitDepth = (await get(() => rec.Get_BitDepth())) || liveText("liveBitDepth", "Bits");
    m.fps = (await get(() => rec.Get_FrameRate())) || liveText("liveFPS", "fps");
    try { m.firmware = String(await api.safeCommand(() => rec.Get_Version_Info("Software_Version")) || ""); } catch (_) {}
    try {
      const d = await api.safeCommand(() => rec.Get_DateTime());
      if (d && d.year > 2000 && d.month >= 1 && d.month <= 12) {
        const p2 = (n) => String(n).padStart(2, "0");
        m.date = `${d.year}-${p2(d.month)}-${p2(d.day)}`;
        // The 788T's <DAILY> folder name, e.g. 14Y01M01, and its clock as seconds since midnight.
        m.todayFolder = `${p2(d.year % 100)}Y${p2(d.month)}M${p2(d.day)}`;
        m.clockSec = d.hours * 3600 + d.minutes * 60 + d.seconds;
      }
    } catch (_) {}
    if (!m.date) m.date = new Date().toISOString().slice(0, 10);
    return m;
  }

  // Library enum names -> readable: "_44_1_kHz" -> "44.1 kHz", "_29o97DF" -> "29.97 DF",
  // "PolyWAV" -> "Poly WAV". A bare number means the value wasn't recognised.
  function fmtEnum(v) {
    let s = String(v ?? "").trim();
    if (!s || /^\d+$/.test(s)) return "";
    if (s === "PolyWAV") return "Poly WAV";
    if (s === "MonoWAV") return "Mono WAV";
    s = s.replace(/^_/, "");
    s = s.replace(/^(\d+)_(\d+)(F?)_k[Hh][Zz]$/, "$1.$2$3 kHz").replace(/^(\d+)(F?)_k[Hh][Zz]$/, "$1$2 kHz");
    s = s.replace(/^(\d+)_Bit(.*)$/, (_, n, rest) => `${n}-bit${rest.replace(/_/g, " ")}`);
    s = s.replace(/^(\d+)o(\d+)/, "$1.$2").replace(/^23\.967/, "23.976"); // library typo for 23.976
    s = s.replace(/(\d)(DF)$/, "$1 DF").replace(/(\d)Plus$/, "$1+").replace(/_/g, " ");
    return s;
  }

  function liveText(id, placeholder) {
    const t = ($(id) && $(id).textContent || "").trim();
    return t && t !== placeholder ? t : "";
  }

  // ---------------------------------------------------------------- days
  // The 788T doesn't send a date or folder per take, but with time-of-day
  // timecode, start TC climbs through a day and jumps back overnight.
  // A backwards jump of more than 2 hours starts a new block. Only the newest
  // block can be dated: if it ended within TODAY_WINDOW_S before the 788T's
  // clock, it was recorded today and gets today's daily folder name.
  // Older blocks are only labelled as blocks, since their dates are unknown.
  let days = [];   // [{index, takes:[], first, last, today}], newest first
  const DAY_GAP_S = 2 * 3600;
  const TODAY_WINDOW_S = 4 * 3600;

  function tcSeconds(tc) {
    const m = /^(\d+):(\d+):(\d+):(\d+)$/.exec(String(tc || ""));
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
  }

  function buildDays() {
    let groups = [];
    let names = null;
    if (meta.source === "Card files") {
      // Card files carry their roll (daily folder) name, so group by that.
      const byRoll = new Map();
      for (const t of takes) {
        const k = t.roll || "(no roll)";
        if (!byRoll.has(k)) byRoll.set(k, []);
        byRoll.get(k).push(t);
      }
      groups = [...byRoll.values()];
      const rollNames = groups.map((g) => g[0].roll || "(no roll)").reverse();
      names = (i) => "Roll " + rollNames[i];
    } else {
      let cur = null, prev = null;
      for (const t of takes) {           // oldest first
        const sec = tcSeconds(t.startTC);
        if (!cur || (sec != null && prev != null && sec < prev - DAY_GAP_S)) { cur = []; groups.push(cur); }
        cur.push(t);
        if (sec != null) prev = sec;
      }
    }
    days = groups.reverse().map((g, i) => ({ index: i, takes: g, first: g[0].startTC, last: g[g.length - 1].startTC, today: false }));
    if (!names) {
      const d0 = days[0], last = d0 && tcSeconds(d0.last), now = meta.clockSec;
      if (d0 && meta.todayFolder && last != null && now != null && last <= now + 300 && now - last <= TODAY_WINDOW_S) d0.today = true;
      names = (i) => (days[i].today ? `${meta.todayFolder} (today)` : i === 0 ? "Most recent block" : `Earlier block ${i}`);
    }
    const short = (tc) => String(tc || "").slice(0, 5);
    $("srDay").innerHTML = days.map((d) =>
      `<option value="${d.index}">${names(d.index)}: ${d.takes.length} takes, ${short(d.first)}–${short(d.last)}</option>`).join("")
      + `<option value="all">All ${takes.length} takes</option>`;
    $("srDay").value = days.length ? "0" : "all";
  }

  function dayTakes() {
    const v = $("srDay").value;
    if (v === "all" || v === "" || !days[+v]) return takes;
    return days[+v].takes;
  }

  function selectedDay() {
    const v = $("srDay").value;
    return v === "all" || v === "" ? null : days[+v] || null;
  }

  function selectedRoll() {
    const d = selectedDay();
    if (d && d.today) return meta.todayFolder;
    const list = dayTakes();
    const rolls = [...new Set(list.map((t) => t.roll).filter(Boolean))];
    return rolls.join(", ");
  }

  function dayRange() {
    const list = dayTakes();
    if (!list.length) return "";
    return `${list[0].startTC} – ${list[list.length - 1].startTC} (${list.length} takes)`;
  }

  // ---------------------------------------------------------------- shaping
  function visibleTakes() {
    const list = dayTakes();
    return list;
  }

  // Track columns. Take-list takes use the 788T's track letters (L, R, A...);
  // card files use file channels (T1, T2...), like the 788T's own report.
  function takeCols(t) {
    if (t.cols) return t.cols;
    return (t.fileTrackEntries || []).filter((e) => e.physicalIndex != null)
      .map((e) => ({ label: TRACK_LABELS[e.physicalIndex], name: e.name || "•" }));
  }
  function colOrder(label) {
    const i = TRACK_LABELS.indexOf(label);
    return i >= 0 ? i : 100 + (parseInt(String(label).replace(/\D/g, ""), 10) || 0);
  }

  function sceneParts(scene) {
    const parts = String(scene ?? "").trim().split("-").map((x) => x.trim());
    return parts.length === 3 && parts.every(Boolean) ? parts : null;
  }

  function rows() {
    const list = visibleTakes();
    const labels = [...new Set(list.flatMap((t) => takeCols(t).map((c) => c.label)))].sort((a, b) => colOrder(a) - colOrder(b));
    const hasLength = list.some((t) => t.length);
    // Scene names like "3-39-X36" (episode-scene-slate) get their own columns.
    // A scene that doesn't have exactly three parts stays whole in Scene.
    const split = list.some((t) => sceneParts(t.scene));
    const sceneHead = split ? ["Episode", "Scene", "Slate"] : ["Scene"];
    const head = ["#", "File", ...sceneHead, "Take", "Start TC", ...(hasLength ? ["Length"] : []), ...labels, "Notes"];
    const body = list.map((t, n) => {
      const cols = takeCols(t);
      const sc = split ? sceneParts(t.scene) || ["", t.scene, ""] : [t.scene];
      return [
        n + 1, t.fileName, ...sc, t.takeNumber, t.startTC, ...(hasLength ? [t.length || ""] : []),
        ...labels.map((l) => (cols.find((c) => c.label === l) || {}).name || ""), t.notes,
      ];
    });
    return { head, body };
  }

  // ---------------------------------------------------------------- output
  function render() {
    const { head, body } = rows();
    if (!takes.length) { $("srTable").innerHTML = ""; return; }
    $("srTable").innerHTML = `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
    }</tbody></table>`;
  }

  function reportDate() {
    const p = headerPairs().find(([k]) => k === "Date");
    return p ? p[1] : "";
  }

  function headerPairs() {
    const h = header();
    const card = meta.source === "Card files";
    const sel = dayTakes();
    // Take-list blocks are only dated when the newest one was recorded today.
    const day = selectedDay();
    const date = card ? (sel[0] && sel[0].date) || meta.date : day && day.today ? meta.date : "";
    const fileType = card && sel.length
      ? (sel.every((t) => t.mono) ? "Mono WAV" : sel.some((t) => t.mono) ? "Poly + Mono WAV" : "Poly WAV") : meta.fileType;
    const auto = [
      ["Date", date], ["Recorder", meta.recorder + (meta.firmware ? " v" + meta.firmware : "")],
      ["Source", meta.source], ["Report For", $("srMedia").value], ["Roll / Folder", selectedRoll()],
      ["Takes (TC)", dayRange()], ["Recorded To", meta.recordedTo],
      ["File Type", fileType], ["Sample Rate", meta.sampleRate], ["Bit Depth", meta.bitDepth], ["Frame Rate", meta.fps],
    ].filter(([, v]) => v);
    return [...HEADER_FIELDS.filter(([k]) => k !== "general").map(([k, l]) => [l, h[k]]), ...auto];
  }

  function printSheet() {
    if (!takes.length) return status("Read takes from the 788T first.");
    const { head, body } = rows();
    const h = header();
    $("srSheet").innerHTML = `
      <h1>Sound Report${h.production ? " – " + esc(h.production) : ""}</h1>
      <div class="hdr">${headerPairs().map(([l, v]) => `<div><b>${esc(l)}</b> ${esc(v || "")}</div>`).join("")}</div>
      ${h.general ? `<p><b>Notes:</b> ${esc(h.general)}</p>` : ""}
      <table><thead><tr>${head.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${
        body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
      }</tbody></table>
      <div class="foot">${body.length} takes · generated ${new Date().toLocaleString()} from 788T metadata</div>`;
    window.print();
  }

  function csvText() {
    const { head, body } = rows();
    const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = headerPairs().map(([l, v]) => q(l) + "," + q(v || ""));
    const g = header().general;
    if (g) lines.push("General Notes," + q(g));
    lines.push("");
    lines.push(head.map(q).join(","));
    for (const r of body) lines.push(r.map(q).join(","));
    return "﻿" + lines.join("\r\n");
  }

  function fileName() {
    const h = header();
    const media = { "CF card": "CF", "Internal drive": "INT", "External drive": "EXT" }[$("srMedia").value];
    const base = ["SoundReport", h.production, h.roll || selectedRoll() || h.day, media, reportDate()].filter(Boolean).join("_");
    return base.replace(/[^\w.-]+/g, "-") + ".csv";
  }

  // ---------------------------------------------------------------- PDF
  // A small PDF writer: A4 landscape, Helvetica, header block + take table,
  // repeated table header on each page, page numbers. No libraries.
  const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,
    278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,
    944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,
    278,556,500,722,500,500,500,334,260,334,584];
  const pdfChar = (ch) => { const c = ch.charCodeAt(0); return c >= 32 && c < 256 ? ch : ch === "–" || ch === "—" ? "-" : ch === "·" ? "\xb7" : "?"; };
  const pdfClean = (v) => String(v ?? "").replace(/[\r\n\t]+/g, " ").split("").map(pdfChar).join("");
  const textW = (t, size, bold) => { let w = 0; for (const ch of t) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : 556; } return w / 1000 * size * (bold ? 1.06 : 1); };
  const pdfEsc = (t) => t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  function fit(t, size, bold, maxW) {
    if (textW(t, size, bold) <= maxW) return t;
    while (t.length > 1 && textW(t + "...", size, bold) > maxW) t = t.slice(0, -1);
    return t + "...";
  }

  function buildPdf() {
    const { head, body } = rows();
    const h = header();
    const W = 842, H = 595, M = 28, pages = [];
    let ops = [], y = 0;
    const txt = (x, yy, size, t, bold) => ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${pdfEsc(t)}) Tj ET`);
    const newPage = () => { if (ops.length) pages.push(ops); ops = []; y = H - M; };
    newPage();
    txt(M, y - 14, 15, pdfClean("Sound Report" + (h.production ? " - " + h.production : "")), true);
    y -= 26;
    // header pairs in 3 columns
    const pairs = headerPairs().filter(([, v]) => v);
    const colW = (W - 2 * M) / 3;
    pairs.forEach(([l, v], k) => {
      const cx = M + (k % 3) * colW, cy = y - Math.floor(k / 3) * 11;
      const lab = pdfClean(l) + ": ";
      txt(cx, cy - 8, 8, lab, true);
      txt(cx + textW(lab, 8, true), cy - 8, 8, fit(pdfClean(v), 8, false, colW - textW(lab, 8, true) - 6), false);
    });
    y -= Math.ceil(pairs.length / 3) * 11 + 4;
    if (h.general) { txt(M, y - 8, 8, "Notes: " + fit(pdfClean(h.general), 8, false, W - 2 * M - 40), false); y -= 13; }
    y -= 6;
    // table column widths, shrinking the font to fit the page width
    const cells = body.map((r) => r.map(pdfClean)), heads = head.map(pdfClean);
    const avail = W - 2 * M;
    let fs = 8, widths;
    for (; fs >= 5.5; fs -= 0.25) {
      widths = heads.map((hd, c) => Math.min(170, Math.max(textW(hd, fs, true), ...cells.map((r) => textW(r[c] || "", fs, false))) + 6));
      if (widths.reduce((a, b) => a + b, 0) <= avail) break;
    }
    let total = widths.reduce((a, b) => a + b, 0);
    if (total > avail) { const k = avail / total; widths = widths.map((w) => w * k); total = avail; }
    const rh = fs * 1.55;
    const drawHead = () => {
      ops.push(`0.86 g ${M} ${(y - rh).toFixed(1)} ${total.toFixed(1)} ${rh.toFixed(1)} re f 0 g`);
      let x = M;
      heads.forEach((hd, c) => { txt(x + 3, y - rh + fs * 0.45, fs, fit(hd, fs, true, widths[c] - 5), true); x += widths[c]; });
      y -= rh;
    };
    drawHead();
    cells.forEach((r, n) => {
      if (y - rh < M + 16) { newPage(); drawHead(); }
      if (n % 2) ops.push(`0.95 g ${M} ${(y - rh).toFixed(1)} ${total.toFixed(1)} ${rh.toFixed(1)} re f 0 g`);
      let x = M;
      r.forEach((cell, c) => { txt(x + 3, y - rh + fs * 0.45, fs, fit(cell, fs, false, widths[c] - 5), false); x += widths[c]; });
      ops.push(`0.7 G 0.3 w ${M} ${(y - rh).toFixed(1)} m ${(M + total).toFixed(1)} ${(y - rh).toFixed(1)} l S 0 G`);
      y -= rh;
    });
    pages.push(ops);
    const stamp = pdfClean(`${body.length} takes - generated ${new Date().toLocaleString()} from 788T metadata`);
    // assemble
    const objs = [];
    const add = (o) => { objs.push(o); return objs.length; };
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add(null); // pages, filled below
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids = [];
    pages.forEach((pg, k) => {
      const foot = `BT /F1 7 Tf ${M} 14 Td (${pdfEsc(stamp + "   page " + (k + 1) + " of " + pages.length)}) Tj ET`;
      const stream = pg.concat(foot).join("\n");
      const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`));
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offs = [];
    objs.forEach((o, k) => { offs.push(out.length); out += `${k + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 0xff;
    return bytes;
  }

  // ---------------------------------------------------------------- ZIP (stored)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let k = 0; k < b.length; k++) c = CRC[(c ^ b[k]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function buildZip(entries) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const { name, data } of entries) {
      const nm = enc.encode(name), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(lh.buffer), nm, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), nm);
      off += 30 + nm.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  // ---------------------------------------------------------------- share
  async function shareOut(what) {
    if (!takes.length) return status("Read takes from the 788T first.");
    const base = fileName().replace(/\.csv$/, "");
    const csvFile = new File([csvText()], base + ".csv", { type: "text/csv" });
    const pdfFile = new File([buildPdf()], base + ".pdf", { type: "application/pdf" });
    let files = what === "pdf" ? [pdfFile] : what === "csv" ? [csvFile] : [pdfFile, csvFile];
    if (what === "both") {
      const zipFile = new File([buildZip([{ name: pdfFile.name, data: new Uint8Array(await pdfFile.arrayBuffer()) },
                                          { name: csvFile.name, data: new Uint8Array(await csvFile.arrayBuffer()) }])], base + ".zip", { type: "application/zip" });
      if (navigator.canShare && navigator.canShare({ files: [zipFile] })) files = [zipFile];
      else if (!(navigator.canShare && navigator.canShare({ files }))) files = [zipFile]; // no share sheet: save the zip instead
    }
    const label = files.map((f) => f.name).join(" + ");
    if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files, title: base }); status("Shared " + label + "."); return; }
      catch (e) { if (e && e.name === "AbortError") return status("Share cancelled."); status("Share failed (" + (e.message || e) + "). Saving instead..."); }
    }
    // No share sheet here (e.g. iPad on the Pi's plain-http address): save / open the file(s) instead.
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const a = document.createElement("a");
      a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      await new Promise((r) => setTimeout(r, 400));
    }
    status("Sharing isn't available here, so " + label + " was saved. Open it from Downloads / Files and share from there.");
  }

  // Test hook: lets the report be checked without a recorder.
  window.__788report = { setTakes(list, m) { takes = list; meta = m || meta; buildDays(); render(); }, csvText, buildPdf, buildZip, openPanel, loadCardFiles };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildUi);
  else buildUi();
})();
