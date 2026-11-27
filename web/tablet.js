/* Android's address bar eats into the 100vh the layout relies on, so on touch
   devices go fullscreen on the first tap. Leave and re-enter with the browser's
   own controls. */
(function () {
  if (!matchMedia("(pointer: coarse)").matches) return;
  const goFull = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    }
    try { screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape").catch(() => {}); } catch (_) {}
  };
  document.addEventListener("pointerdown", goFull, { once: true, capture: true });
  // Keep the screen awake while the controller is open (needs https or the Pi page on localhost; ignored otherwise).
  async function wake() { try { await navigator.wakeLock.request("screen"); } catch (_) {} }
  if ("wakeLock" in navigator) { wake(); document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && wake()); }
})();

/* Fit to the screen. The layout is sized in vh (percent of the full screen
   height), but on Android the real visible area can be shorter: taskbar, nav
   bar, Chrome's address bar. Then the bottom status bar covers the track names.
   Scale the whole page so 100vh fits the visible height exactly.
   Testing: ?fit=0.85 forces a scale. */
(function () {
  const forced = parseFloat(new URLSearchParams(location.search).get("fit"));
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none";

  function fit() {
    if (!document.body) return;
    if (!probe.isConnected) document.documentElement.appendChild(probe);
    const vhPx = probe.getBoundingClientRect().height;          // what the layout thinks 100vh is
    const visH = window.visualViewport ? visualViewport.height : innerHeight;
    const visW = window.visualViewport ? visualViewport.width : innerWidth;
    let scale = forced || visH / vhPx;
    const b = document.body.style;
    if (!forced && Math.abs(1 - scale) < 0.01) {
      b.transform = b.transformOrigin = b.width = b.height = "";
      document.documentElement.style.overflow = "";
      return;
    }
    // body becomes the containing block for the fixed status bar, so it scales too.
    b.transformOrigin = "0 0";
    b.transform = `scale(${scale})`;
    b.width = visW / scale + "px";
    b.height = vhPx + "px";
    document.documentElement.style.overflow = "hidden";
  }

  const refit = () => requestAnimationFrame(fit);
  window.addEventListener("resize", refit);
  window.addEventListener("orientationchange", () => setTimeout(fit, 300));
  document.addEventListener("fullscreenchange", () => setTimeout(fit, 300));
  if (window.visualViewport) visualViewport.addEventListener("resize", refit);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fit);
  else fit();
  setTimeout(fit, 1000);
})();

/* SD Remote-style home page. Many people use both the 788T and Sound Devices'
   newer recorders, so the layout follows SD Remote's meter view:
     [Current take] [S.Rate Bits fps / big timecode / A. Time] [Next take]
     [L / R meters, horizontal]
     [track meters]                                     + transport column
   Only existing elements are moved (ids, handlers and live updates unchanged);
   Previous Take and RXTC (same as the big timecode) are hidden. */
(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, id, cls) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; return e; };

  // The original Letter Up button becomes "slate up" with a clapperboard icon.
  // It still follows the 788T's Scene Increment Mode (letters or numbers).
  const CLAPPER = `<svg viewBox="0 0 48 48" width="74%" height="74%" aria-hidden="true">
  <defs>
    <clipPath id="cbBar"><rect x="6" y="17" width="36" height="6"/></clipPath>
    <clipPath id="cbStick"><rect x="6" y="9" width="36" height="6"/></clipPath>
  </defs>
  <rect x="6" y="23" width="36" height="19" rx="1.5" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="2.2"/>
  <g clip-path="url(#cbBar)">
    <rect x="6" y="17" width="36" height="6" fill="#000"/>
    <path fill="currentColor" d="M6 17h5l-4 6H2z M17 17h5l-4 6h-5z M28 17h5l-4 6h-5z M39 17h5l-4 6h-5z"/>
  </g>
  <rect x="6" y="17" width="36" height="6" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <g transform="rotate(-16 7 16)">
    <g clip-path="url(#cbStick)">
      <rect x="6" y="9" width="36" height="6" fill="#000"/>
      <path fill="currentColor" d="M10 9h5l-4 6H6z M21 9h5l-4 6h-5z M32 9h5l-4 6h-5z M43 9h5l-4 6h-5z"/>
    </g>
    <rect x="6" y="9" width="36" height="6" fill="none" stroke="currentColor" stroke-width="1.6"/>
  </g>
  <circle cx="7.5" cy="16.2" r="1.6" fill="currentColor"/>
  <path d="M24 38.5V27.5 M19 32 L24 27 L29 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  function styleSlateUp() {
    const b = $("letterUpButton");
    if (!b || b.dataset.clapper) return;
    b.dataset.clapper = "1";
    b.innerHTML = CLAPPER;
    b.title = "Slate up (follows the 788T's Scene Increment Mode: letters or numbers)";
  }

  function build() {
    styleSlateUp();
    // ?classic in the address shows the original home layout (for comparing).
    if (new URLSearchParams(location.search).has("classic")) return;
    const home = $("home"), buttons = $("transportButtons");
    if (!home || !buttons || home.classList.contains("sdLayout")) return;

    const top = el("div", "sdTop");
    const centre = el("div", "sdCentre");
    const info = el("div", "sdInfo");
    for (const id of ["liveSRate", "liveBitDepth", "liveFPS"]) if ($(id)) info.appendChild($(id));
    centre.append(info);
    if ($("tc")) centre.appendChild($("tc"));
    if ($("liveATime")) centre.appendChild($("liveATime"));
    // Current / Next take cards with fields edited in place (SD Remote, CL-WIFI).
    // The original buttons stay in the page, hidden, so the app keeps updating them.
    const hidden = el("div", "sdHiddenTakeButtons");
    for (const id of ["currentTakeButton", "nextTakeButton"]) if ($(id)) hidden.appendChild($(id));
    top.appendChild(makeTakeCard(0));
    top.appendChild(centre);
    top.appendChild(makeTakeCard(1));
    top.appendChild(hidden);

    const mix = el("div", "sdMix");
    mix.title = "Tracks L and R (tracks 1 and 2). Tap L or R to arm.";
    for (const side of ["L", "R"]) {
      const row = el("div", null, "sdMixRow");
      row.innerHTML = `<button type="button" class="sdMixLabel" id="sdArm${side}" title="Arm track ${side}">${side}</button><div class="sdMixBar"><div class="sdMixFill" id="sdMix${side}"></div><div class="sdMixPeak" id="sdMixPeak${side}"></div></div>`;
      mix.appendChild(row);
    }
    // The L and R labels arm tracks 1 and 2 (their vertical meters are hidden).
    [["L", 1], ["R", 2]].forEach(([side, track]) => {
      mix.querySelector("#sdArm" + side).onclick = async () => {
        const api = window.__788;
        if (api && api.toggleTrackArmFromPeakForUnit) await api.toggleTrackArmFromPeakForUnit(0, track);
        syncMixArm();
      };
    });
    const scale = el("div", null, "sdMixScale");
    scale.innerHTML = [-50, -40, -30, -20, -12, -6, 0].map((db) => `<span style="left:${pct(-db)}%">${db}</span>`).join("");
    mix.appendChild(scale);

    // Transport column, top to bottom like SD Remote: Record, False take, Stop, Play;
    // then Letter up and Tone at the bottom.
    const col = buttons;
    for (const id of ["recordButton", "falseStartButton", "stopButton", "playButton"]) if ($(id)) col.appendChild($(id));
    col.appendChild(el("div", null, "sdSpacer"));
    for (const id of ["letterUpButton", "toneButton"]) if ($(id)) col.appendChild($(id));
    for (const b of col.querySelectorAll("button")) b.classList.add("sdRound");

    // Top info bar and transport stay on screen on every tab (like SD Remote).
    const header = el("div", "sdHeader");
    header.appendChild(top);
    header.appendChild(mix); // L / R bus stays with the top bar on every tab
    const tabs = document.querySelector(".tabs");
    if (tabs && tabs.parentNode) tabs.parentNode.insertBefore(header, tabs.nextSibling);
    else document.body.insertBefore(header, document.body.firstChild);
    document.body.appendChild(col);

    home.classList.add("sdLayout");
    document.body.classList.add("sdPersistent");
    measureBars();
    window.addEventListener("resize", () => requestAnimationFrame(measureBars));
    setTimeout(measureBars, 1200);
  }

  // Heights of the tab bar and bottom status bar, in vh (the page is laid out
  // in vh and may be scaled to fit), for the fixed transport column and the
  // tab content height.
  function measureBars() {
    // CSS vh in px (measured outside <body>, which may be scaled to fit).
    let probe = document.getElementById("sdVhProbe");
    if (!probe) {
      probe = document.createElement("div");
      probe.id = "sdVhProbe";
      probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none";
      document.documentElement.appendChild(probe);
    }
    const vh = probe.getBoundingClientRect().height / 100 || 1;
    const scale = (() => { const m = /scale\(([\d.]+)\)/.exec(document.body.style.transform || ""); return m ? Number(m[1]) : 1; })();
    const tabs = document.querySelector(".tabs"), bar = $("status");
    const root = document.documentElement.style;
    if (tabs) root.setProperty("--navH", (tabs.getBoundingClientRect().height / scale / vh).toFixed(2) + "vh");
    if (bar) root.setProperty("--barH", (bar.getBoundingClientRect().height / scale / vh).toFixed(2) + "vh");
  }

  // ---- Inline take cards -------------------------------------------------
  const cardState = { 0: { scene: "", take: "", notes: "" }, 1: { scene: "", take: "", notes: "" } };
  const stripScene = (v) => String(v || "").trim().replace(/^\d{2}_/, "");
  const stripTake = (v) => String(v || "").trim().replace(/_\d{2}$/, "");

  function makeTakeCard(idx) {
    const card = el("div", "sdCard" + idx, "sdTakeCard");
    card.innerHTML = `<div class="sdCardTitle">${idx ? "NEXT" : "CURRENT"}</div>` +
      ["scene", "take", "notes"].map((f) =>
        `<label class="sdCardRow"><span>${f === "scene" ? "Scene" : f === "take" ? "Take" : "Notes"}</span>` +
        `<input id="sdCard${idx}_${f}" data-field="${f}" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done"></label>`).join("");
    for (const input of card.querySelectorAll("input")) {
      input.addEventListener("focus", () => { input.dataset.editing = "1"; setTimeout(() => input.select(), 0); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { input.value = cardState[idx][input.dataset.field]; input.dataset.cancel = "1"; input.blur(); }
      });
      input.addEventListener("input", () => {
        // Next take: a new scene starts at take 1 (as the original popup did).
        if (idx === 1 && input.dataset.field === "scene") {
          const takeInput = $("sdCard1_take");
          if (input.value.trim() !== cardState[1].scene) { if (!takeInput.dataset.userSet) takeInput.value = "1"; }
          else if (!takeInput.dataset.userSet) takeInput.value = cardState[1].take;
        }
        if (input.dataset.field === "take") input.dataset.userSet = "1";
      });
      input.addEventListener("blur", () => setTimeout(() => commitCard(idx, input), 0));
    }
    return card;
  }

  async function commitCard(idx, input) {
    const card = $("sdCard" + idx);
    if (card && card.contains(document.activeElement)) return; // moved to another field of the same card
    const inputs = ["scene", "take", "notes"].map((f) => $("sdCard" + idx + "_" + f));
    const cancelled = inputs.some((i) => i.dataset.cancel);
    const vals = Object.fromEntries(inputs.map((i) => [i.dataset.field, i.value.trim()]));
    for (const i of inputs) { delete i.dataset.editing; delete i.dataset.cancel; delete i.dataset.userSet; }
    const st = cardState[idx];
    if (cancelled) { fillCard(idx); return; }
    const sceneTakeChanged = vals.scene !== st.scene || vals.take !== st.take;
    const notesChanged = vals.notes !== st.notes;
    if (!window.sdWriteTakeFields || (!sceneTakeChanged && !notesChanged)) { fillCard(idx); return; }
    card.classList.add("saving");
    if (sceneTakeChanged) await window.sdWriteTakeFields(idx, "sceneTake", { scene: vals.scene, take: vals.take, originalScene: st.scene, originalTake: st.take });
    if (notesChanged) await window.sdWriteTakeFields(idx, "notes", { notes: vals.notes });
    card.classList.remove("saving");
  }

  function fillCard(idx) {
    const st = cardState[idx];
    for (const f of ["scene", "take", "notes"]) {
      const i = $("sdCard" + idx + "_" + f);
      if (i && !i.dataset.editing) i.value = st[f];
    }
  }

  // Called by the app whenever it refreshes the Current / Next take buttons.
  window.sdTakeCardRender = function (buttonId, rows) {
    const idx = buttonId === "currentTakeButton" ? 0 : buttonId === "nextTakeButton" ? 1 : -1;
    if (idx < 0) return;
    const r = (Array.isArray(rows) && rows.find((x) => Number(x.unitId) === 0)) || (rows && rows[0]);
    const card = $("sdCard" + idx);
    if (!r || !card) return;
    card.classList.toggle("error", !!r.error);
    card.title = r.error ? "U" + r.unitId + " " + r.error : "";
    if (r.error) return; // keep the last good values
    cardState[idx] = { scene: stripScene(r.scene), take: stripTake(r.take), notes: String(r.notes ?? cardState[idx].notes ?? "").trim() };
    fillCard(idx);
  };

  // Meter scale: -50 dBFS (left) to 0 dBFS (right), like SD Remote.
  function pct(dbBelow) { return Math.max(0, Math.min(100, (50 - Math.min(50, Number(dbBelow) || 0)) * 2)); }
  // Light the L/R labels from the (hidden) ARM buttons of tracks 1 and 2, which
  // the app keeps up to date with the 788T.
  function syncMixArm() {
    [["L", 1], ["R", 2]].forEach(([side, track]) => {
      const src = $("armButton" + track), lab = $("sdArm" + side);
      if (lab) lab.classList.toggle("armed", !!(src && src.classList.contains("armed")));
    });
  }
  window.drawMixMeters = function (meters) {
    window.__sdTrackMeters = meters;
    const outTab = document.getElementById("outputs");
    if (window.sdDrawOutputMeters && outTab && outTab.classList.contains("active")) window.sdDrawOutputMeters();
    syncMixArm();
    if (!Array.isArray(meters)) return;
    ["L", "R"].forEach((side, i) => {
      const m = meters[i], fill = $("sdMix" + side), peak = $("sdMixPeak" + side);
      if (!m || !fill) return;
      fill.style.clipPath = `inset(0 ${100 - pct(m.vuDbBelowFs)}% 0 0)`;
      if (peak) peak.style.left = `calc(${pct(m.peakDbBelowFs)}% - 2px)`;
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();

/* Bridge mode: send the page's console messages and errors to the Pi, which
   writes them to its journal. Lets problems on an iPad or tablet be read
   afterwards. Batched every 2 s, at most 60 lines per batch. */
(function () {
  if (!window.CL788_BRIDGE || !window.fetch) return;
  const queue = [];
  const fmt = (a) => { try { return typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a); } catch (_) { return String(a); } };
  const add = (level, args) => {
    if (queue.length < 600) queue.push(`${new Date().toISOString().slice(11, 23)} ${level} ${Array.from(args).map(fmt).join(" ").slice(0, 380)}`);
  };
  for (const level of ["log", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = function () { add(level, arguments); return orig.apply(null, arguments); };
  }
  window.addEventListener("error", (e) => add("ERROR", [e.message + " @" + (e.lineno || "?")]));
  window.addEventListener("unhandledrejection", (e) => add("REJECT", [e.reason && e.reason.message ? e.reason.message : String(e.reason)]));
  add("info", ["page loaded: " + navigator.userAgent + " " + innerWidth + "x" + innerHeight]);
  setInterval(() => {
    if (!queue.length) return;
    const dropped = queue.length > 60 ? queue.length - 60 : 0;
    const batch = queue.splice(0, 60);
    if (dropped) { queue.length = 0; batch.push(`(${dropped} more lines dropped)`); }
    fetch("/clientlog", { method: "POST", body: batch.join("\n"), keepalive: true }).catch(() => {});
  }, 2000);
})();

/* USB | Wi-Fi switch next to Connect (one app, two links, like SD Remote).
   Shown only when both links are possible (Android Chrome on the Pi's page).
   Changing it is only allowed while disconnected. */
(function () {
  function build() {
    const links = window.CL788_LINKS || [];
    if (links.length < 2 || !window.CL788_setLink || document.getElementById("linkSwitch")) return;
    const anchor = document.getElementById("connectButtons");
    if (!anchor || !anchor.parentNode) return;
    const wrap = document.createElement("div");
    wrap.id = "linkSwitch";
    const names = { usb: "USB", ws: "Wi-Fi" };
    for (const link of ["usb", "ws"]) {
      if (!links.includes(link)) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.link = link;
      b.textContent = names[link];
      b.onclick = () => {
        if (window.recorder && window.recorder.isConnected && window.recorder.isConnected()) {
          const st = document.getElementById("statusText");
          if (st) st.textContent = "Disconnect first, then switch between USB and Wi-Fi.";
          return;
        }
        if (window.CL788_setLink(link)) refresh();
      };
      wrap.appendChild(b);
    }
    anchor.parentNode.insertBefore(wrap, anchor);
    refresh();
  }
  function refresh() {
    for (const b of document.querySelectorAll("#linkSwitch button")) b.classList.toggle("active", b.dataset.link === window.CL788_TRANSPORT);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();

/* ROUTING tab (SD Remote / CL-WIFI style): one grid, inputs down the side and
   tracks across the top. Tap a cell to route or unroute that input to that
   track. In PRE/POST mode, tapping a routed cell switches it between pre- and
   post-fader. Uses the app's own routing functions (C.Link 81/82/83/84). */
(function () {
  const TRACKS = ["L", "R", "A", "B", "C", "D", "E", "F", "G", "H", "X1", "X2"];
  let mode = "route";
  const $ = (id) => document.getElementById(id);

  function build() {
    const inputsBtn = [...document.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === "INPUTS");
    const inputsTab = $("inputs");
    if (!inputsBtn || !inputsTab || $("routing")) return;
    const btn = document.createElement("button");
    btn.textContent = "ROUTING";
    btn.style.fontSize = "4vh";
    btn.setAttribute("onclick", "showTab('routing')");
    inputsBtn.parentNode.insertBefore(btn, inputsBtn.nextSibling);
    btn.addEventListener("click", () => setTimeout(load, 0));

    const tab = document.createElement("div");
    tab.id = "routing";
    tab.className = "tab";
    tab.innerHTML = `
      <div id="rtBar">
        <span class="rtTitle">Input → track routing</span>
        <div id="rtMode"><button data-mode="route" class="active">ROUTE</button><button data-mode="prepost">PRE / POST</button></div>
        <button id="rtReload" type="button">REFRESH</button>
        <span id="rtHint">Tap a cell to route an input to a track.</span>
      </div>
      <div id="rtGrid"></div>`;
    inputsTab.parentNode.insertBefore(tab, inputsTab.nextSibling);
    for (const b of tab.querySelectorAll("#rtMode button")) b.onclick = () => {
      mode = b.dataset.mode;
      for (const x of tab.querySelectorAll("#rtMode button")) x.classList.toggle("active", x === b);
      $("rtHint").textContent = mode === "route" ? "Tap a cell to route an input to a track." : "Tap a routed cell to switch it between PRE and POST fader.";
      render();
    };
    $("rtReload").onclick = load;
    render();
  }

  function state() {
    try { return window.__788routingState ? window.__788routingState() : null; } catch (_) { return null; }
  }

  function render() {
    const grid = $("rtGrid");
    if (!grid) return;
    const st = state();
    const has = st && Object.keys(st.routes || {}).length;
    let html = `<div class="rtCorner"></div>` + TRACKS.map((t) => `<div class="rtHead">${t}</div>`).join("");
    for (let input = 1; input <= 8; input++) {
      html += `<div class="rtRowHead">IN ${input}</div>`;
      for (let track = 1; track <= TRACKS.length; track++) {
        const on = has && st.routes[input] && !!st.routes[input][track - 1];
        const post = has && st.prePost[input] && !!st.prePost[input][track - 1];
        const cls = !has ? "unknown" : !on ? "off" : post ? "post" : "pre";
        const label = !has ? "" : !on ? "" : post ? "POST" : "PRE";
        html += `<button type="button" class="rtCell ${cls}" data-input="${input}" data-track="${track}">${label}</button>`;
      }
    }
    grid.innerHTML = html;
    if (!has) grid.insertAdjacentHTML("beforeend", `<div class="rtEmpty">Connect, then tap REFRESH to load the routing.</div>`);
    for (const cell of grid.querySelectorAll(".rtCell")) cell.onclick = () => tap(cell);
    if (has && window.sdRefreshStripInputs) window.sdRefreshStripInputs();
  }
  window.sdRenderRouting = render;

  async function tap(cell) {
    const input = Number(cell.dataset.input), track = Number(cell.dataset.track);
    if (!window.recorder || !window.recorder.isConnected()) return;
    if (mode === "prepost" && !cell.classList.contains("pre") && !cell.classList.contains("post")) return;
    cell.classList.add("busy");
    try {
      if (mode === "route") await window.toggleInputRoute(input, track);
      else await window.toggleInputPrePostRoute(input, track);
    } finally {
      render();
    }
  }

  async function load() {
    const api = window.__788;
    if (!api || !window.recorder || !window.recorder.isConnected() || !$("routing").classList.contains("active")) { render(); return; }
    try { await api.runExclusiveOperation("Loading routing...", () => api.refreshInputRoutingMatrix()); }
    catch (e) { console.log("Routing load failed:", e && e.message ? e.message : e); }
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();

/* Home page channel strips (SD Remote style): editable track name at the top,
   meter, ARM, MUTE (tracks A-H = inputs 1-8), channel letter at the bottom.
   Strips are rebuilt by the app on connect, so they're augmented whenever
   #meterView changes. */
(function () {
  const $ = (id) => document.getElementById(id);
  const LABELS = ["L", "R", "A", "B", "C", "D", "E", "F", "G", "H", "X1", "X2"];
  const mutes = {};

  function stripInfo(channel) {
    const m = /^(?:unit(\d+)_)?meter(\d+)$/.exec(channel.id || "");
    return m ? { unit: Number(m[1] || 0), track: Number(m[2]) } : null;
  }

  function augment() {
    const view = $("meterView");
    if (!view || !document.body.classList.contains("sdPersistent")) return;
    for (const ch of view.querySelectorAll(".channel")) {
      const info = stripInfo(ch);
      if (!info || ch.dataset.sdStrip) continue;
      ch.dataset.sdStrip = "1";
      // Name box at the top
      const name = document.createElement("input");
      name.className = "sdTrackName";
      name.type = "text";
      name.maxLength = 16;
      name.placeholder = LABELS[info.track - 1] || "";
      name.autocomplete = "off";
      name.spellcheck = false;
      name.setAttribute("enterkeyhint", "done");
      const btn = ch.querySelector(".trackButton");
      const current = btn ? (btn.querySelector(".trackButtonLine2") || {}).textContent || "" : "";
      name.value = current.trim();
      name.dataset.orig = name.value;
      name.addEventListener("focus", () => { name.dataset.editing = "1"; setTimeout(() => name.select(), 0); });
      name.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); name.blur(); }
        if (e.key === "Escape") { name.value = name.dataset.orig || ""; name.blur(); }
      });
      name.addEventListener("blur", async () => {
        delete name.dataset.editing;
        const v = name.value.trim();
        if (v === (name.dataset.orig || "") || !window.sdWriteTrackName) { name.value = name.dataset.orig || ""; return; }
        name.classList.add("saving");
        const ok = await window.sdWriteTrackName(info.unit, info.track, v);
        name.classList.remove("saving");
        if (!ok) name.value = name.dataset.orig || "";
      });
      ch.insertBefore(name, ch.firstChild);
      // MUTE under ARM, for tracks A-H (inputs 1-8), unit 0 only
      const input = info.track - 2;
      const arm = ch.querySelector(".armButton");
      const mute = document.createElement("button");
      mute.type = "button";
      mute.className = "muteButton";
      mute.textContent = "MUTE";
      if (info.unit === 0 && info.track >= 3) {
        const fed = feederFor(info.track);
        if (fed) { mute.dataset.input = String(fed); mute.title = "Mute input " + fed; } else { mute.classList.add("blank"); mute.disabled = true; }
        mute.classList.toggle("muted", !!mutes[fed]);
        mute.onclick = () => { const n = Number(mute.dataset.input); if (n && window.sdToggleMute) window.sdToggleMute(n, !mute.classList.contains("muted")); };
      } else {
        mute.classList.add("blank");
        mute.disabled = true;
      }
      if (arm && arm.nextSibling) ch.insertBefore(mute, arm.nextSibling);
      else ch.appendChild(mute);
    }
  }

  // Track names from the app (called whenever it relabels a strip).
  window.sdTrackNameRender = function (button, label, name) {
    const ch = button && button.closest ? button.closest(".channel") : null;
    const box = ch && ch.querySelector(".sdTrackName");
    if (!box) return;
    box.dataset.orig = String(name || "").trim() === "OFFLINE" ? "" : String(name || "").trim();
    if (!box.dataset.editing) box.value = box.dataset.orig;
  };
  // Which input feeds each track, from the 788T's routing (falls back to the
  // factory layout, track A = input 1, until the routing has been read).
  function feederFor(track) {
    const st = window.__788routingState ? window.__788routingState() : null;
    const has = st && st.routes && Object.keys(st.routes).length;
    if (!has) return track >= 3 && track <= 10 ? track - 2 : 0;
    const feeders = [];
    for (let n = 1; n <= 8; n++) if (st.routes[n] && st.routes[n][track - 1]) feeders.push(n);
    return feeders.includes(track - 2) ? track - 2 : (feeders[0] || 0);
  }
  window.sdRefreshStripInputs = function () {
    for (const ch of document.querySelectorAll("#meterView .channel")) {
      const info = stripInfo(ch), mute = ch.querySelector(".muteButton");
      if (!info || !mute || info.unit !== 0 || info.track <= 2) continue;
      const input = feederFor(info.track);
      if (input) { mute.dataset.input = String(input); mute.title = "Mute input " + input; mute.classList.remove("blank"); mute.disabled = false; }
      else { delete mute.dataset.input; mute.classList.add("blank"); mute.disabled = true; }
      mute.classList.toggle("muted", !!(input && mutes[input]));
    }
  };
  window.sdMuteRender = function (state) {
    Object.assign(mutes, state || {});
    for (const b of document.querySelectorAll(".muteButton[data-input]")) b.classList.toggle("muted", !!mutes[b.dataset.input]);
  };

  function start() {
    const view = $("meterView");
    if (!view) return;
    augment();
    new MutationObserver(() => augment()).observe(view, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(start, 0));
  else setTimeout(start, 0);
})();


/* Fat channel (SD Remote style). Tap a strip's letter box (L, R, A-H, X1, X2).
   Tracks A-H show input 1-8's settings with sliders and switches: name, mute,
   pan, delay, iso pre/post | source, 48V, low cut (on, frequency, slope),
   phase, limiter | parametric EQ with a live curve. L, R, X1, X2 show the
   track name and which inputs feed it. "All inputs" holds the global input
   settings that used to be at the top of the Inputs tab. Values are sent a
   few times a second while sliding and once on release, then read back. */
(function () {
  const $ = (id) => document.getElementById(id);
  const TR = ["L", "R", "A", "B", "C", "D", "E", "F", "G", "H", "X1", "X2"];
  const api = () => window.__788, rec = () => window.recorder;
  const S = { track: 3, input: 1, name: "", mute: false, pan: 0, delay: 0, src: "Mic", p48: false, lcOn: false, lcHz: 80, slope12: true,
              pol: false, lim: false, eqOn: false, f: 1000, g: 0, q: 1.0, iso: null, feeds: {} };
  const send = {};
  const qF = (v) => { v = Math.max(30, Math.min(20000, v)); return v <= 10000 ? Math.round(v / 10) * 10 : Math.round(v / 100) * 100; };
  const qQ = (v) => Math.round(Math.max(0.1, Math.min(10, v)) * 10) / 10;
  const fmtF = (f) => (f >= 1000 ? (f / 1000).toFixed(2).replace(/\.?0+$/, "") + " kHz" : f + " Hz");
  const panLab = (p) => (p === 0 ? "C" : p < 0 ? "L" + -p : "R" + p);

  // slider defs: key -> [min, max, step(on slider scale), toSlider, fromSlider, fmt, default]
  const SL = {
    pan: [-100, 100, 1, (v) => v, (x) => Math.round(x), panLab, 0],
    delay: [0, 300, 1, (v) => v, (x) => Math.round(x), (v) => (v / 10).toFixed(1) + " ms", 0],
    lcHz: [40, 320, 10, (v) => v, (x) => Math.round(x / 10) * 10, (v) => v + " Hz", 80],
    f: [0, 1000, 1, (v) => Math.round(1000 * Math.log(v / 30) / Math.log(20000 / 30)), (x) => qF(30 * Math.pow(20000 / 30, x / 1000)), fmtF, 1000],
    g: [-12, 12, 1, (v) => v, (x) => Math.round(x), (v) => (v > 0 ? "+" : "") + v + " dB", 0],
    q: [0, 1000, 1, (v) => Math.round(1000 * Math.log(v / 0.1) / Math.log(100)), (x) => qQ(0.1 * Math.pow(100, x / 1000)), (v) => v.toFixed(1), 1.0],
  };

  function row(label, ctl, extra) { return `<div class="fcRow"><span class="fcLab">${label}</span>${ctl}${extra || ""}</div>`; }
  const sw = (id) => `<button class="fcSw" id="fc_${id}" type="button"><span></span></button>`;
  const slider = (k) => `<input class="fcSlider" id="fc_${k}" type="range" min="${SL[k][0]}" max="${SL[k][1]}" step="${SL[k][2]}"><span class="fcVal" id="fcv_${k}"></span>`;

  function build() {
    if ($("fcWin")) return;
    const w = document.createElement("div");
    w.id = "fcWin";
    w.innerHTML = `
      <div class="fcHead">
        <div class="fcTitle" id="fcTitle">A</div>
        <input id="fc_name" class="fcText fcHeadName" type="text" maxlength="16" placeholder="track name" autocomplete="off" spellcheck="false" enterkeyhint="done">
        <span id="fcNote"></span>
        <button class="fcClose" id="fcClose" type="button">✕</button>
      </div>
      <div class="fcFeedRow">
        <span class="fcLab">Fed by</span><div id="fc_feeds" class="fcFeeds"></div>
        <span id="fc_editWrap"><span class="fcLab" style="flex:0 0 auto">Editing</span><div class="fcSeg" id="fc_edit"></div></span>
      </div>
      <div class="fcEmpty" id="fcEmpty">No input is routed to this track. Tap an input above to route it.</div>
      <div class="fcMain" id="fcInputView">
        <div class="fcCol">
          ${row("Mute", sw("mute"))}
          ${row("Pan <i>CL-9</i>", slider("pan"))}
          ${row("Delay", slider("delay"))}
          ${row("Iso", `<button class="fcBtn" id="fc_iso" type="button">–</button>`, `<span class="fcHint" id="fc_isoHint"></span>`)}
        </div>
        <div class="fcCol">
          ${row("Source", `<div class="fcSeg" id="fc_src"><button data-v="Mic">Mic</button><button data-v="Line">Line</button><button data-v="Digital">AES</button></div>`, sw("p48").replace('class="fcSw"', 'class="fcSw fcP48"') + `<span class="fcHint">48V</span>`)}
          ${row("Low cut", slider("lcHz"), sw("lcOn"))}
          ${row("Slope", `<div class="fcSeg" id="fc_slope"><button data-v="6">6 dB</button><button data-v="12">12 dB</button></div>`, `<span class="fcHint">all inputs</span>`)}
          ${row("Phase", sw("pol"))}
          ${row("Limiter", sw("lim"))}
        </div>
        <div class="fcCol fcEq">
          <div class="fcEqHead"><span>EQ <i>CL-9</i></span>${sw("eqOn")}</div>
          <canvas id="fcCurve"></canvas>
          ${row("Freq", slider("f"))}
          ${row("Gain", slider("g"))}
          ${row("Q", slider("q"))}
        </div>
      </div>
      <details class="fcAll" id="fcAll"><summary>All inputs</summary><div id="fcGlobals"></div></details>
      <div class="fcTabs" id="fcTabs">${TR.map((t, i) => `<button type="button" data-track="${i + 1}">${t}</button>`).join("")}</div>`;
    document.body.appendChild(w);

    $("fcClose").onclick = close;
    for (const b of w.querySelectorAll("#fcTabs button")) b.onclick = () => open(Number(b.dataset.track));
    for (const k of Object.keys(SL)) {
      const el = $("fc_" + k);
      el.addEventListener("input", () => { S[k] = SL[k][4](Number(el.value)); paint(); write(k, false); });
      el.addEventListener("change", () => write(k, true));
      el.addEventListener("dblclick", () => { S[k] = SL[k][6]; paint(); write(k, true); });
    }
    for (const k of ["mute", "p48", "lcOn", "pol", "lim", "eqOn"]) $("fc_" + k).onclick = () => { S[k] = !S[k]; paint(); write(k, true); };
    for (const b of w.querySelectorAll("#fc_src button")) b.onclick = () => { S.src = b.dataset.v; paint(); write("src", true); };
    for (const b of w.querySelectorAll("#fc_slope button")) b.onclick = () => { S.slope12 = b.dataset.v === "12"; paint(); write("slope", true); };
    $("fc_iso").onclick = isoToggle;
    for (const id of ["fc_name"]) {
      const el = $(id);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } });
      el.addEventListener("change", async () => { const v = el.value.trim(); if (v !== S.name && window.sdWriteTrackName) { S.name = v; await window.sdWriteTrackName(0, S.track, v); } });
    }
    // Move the Inputs tab's "all inputs" settings here (their handlers come with them).
    const g = document.querySelector("#inputs .inputGlobalSettings");
    if (g) $("fcGlobals").appendChild(g);
    $("fcAll").addEventListener("toggle", loadGlobals);
    window.addEventListener("resize", () => { if (w.classList.contains("open")) drawCurve(); });
  }

  function paint() {
    const isInput = !!S.input;
    $("fcInputView").style.display = isInput ? "" : "none";
    $("fcEmpty").style.display = !isInput && S.routingKnown ? "" : "none";
    $("fcTitle").textContent = TR[S.track - 1] + (S.input ? " · input " + S.input : "");
    const feeders = Object.keys(S.feeds).filter((n) => S.feeds[n]).map(Number);
    const ed = $("fc_edit");
    $("fc_editWrap").style.display = feeders.length > 1 ? "" : "none";
    ed.innerHTML = feeders.map((n) => `<button type="button" data-in="${n}" class="${n === S.input ? "on" : ""}">IN ${n}</button>`).join("");
    for (const b of ed.querySelectorAll("button")) b.onclick = () => { S.input = Number(b.dataset.in); readIso(); paint(); readInput(); };
    for (const k of Object.keys(SL)) {
      const el = $("fc_" + k);
      if (el && document.activeElement !== el) el.value = SL[k][3](S[k]);
      const v = $("fcv_" + k);
      if (v) v.textContent = SL[k][5](S[k]);
    }
    for (const k of ["mute", "p48", "lcOn", "pol", "lim", "eqOn"]) $("fc_" + k).classList.toggle("on", !!S[k]);
    $("fc_mute").classList.toggle("mute", true);
    for (const b of document.querySelectorAll("#fc_src button")) b.classList.toggle("on", b.dataset.v === S.src);
    for (const b of document.querySelectorAll("#fc_slope button")) b.classList.toggle("on", (b.dataset.v === "12") === S.slope12);
    const iso = $("fc_iso");
    iso.textContent = S.iso === "pre" ? "PRE" : S.iso === "post" ? "POST" : "not routed";
    iso.className = "fcBtn " + (S.iso || "none");
    $("fc_isoHint").textContent = S.iso ? `input ${S.input} → track ${TR[S.track - 1]}` : "";
    for (const b of document.querySelectorAll("#fcTabs button")) b.classList.toggle("on", Number(b.dataset.track) === S.track);
    { const el = $("fc_name"); if (document.activeElement !== el) el.value = S.name; }
    const feeds = $("fc_feeds");
    feeds.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button type="button" data-in="${n}" class="${S.feeds[n] ? "on" : ""}">IN ${n}</button>`).join("");
    for (const b of feeds.querySelectorAll("button")) b.onclick = async () => { await window.toggleInputRoute(Number(b.dataset.in), S.track); await readRouting(); if (S.input) readInput(); };
    $("fcWin").classList.toggle("eqOff", !S.eqOn);
    drawCurve();
  }

  function drawCurve() {
    const c = $("fcCurve");
    if (!c || !c.offsetParent) return;
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = Math.max(10, r.width * dpr); c.height = Math.max(10, r.height * dpr);
    const x = c.getContext("2d"), W = c.width, H = c.height, rng = 18;
    x.fillStyle = "#0b0b0b"; x.fillRect(0, 0, W, H);
    const fx = (f) => (Math.log(f / 20) / Math.log(1000)) * W, gy = (db) => H / 2 - (db / rng) * (H / 2) * 0.9;
    x.lineWidth = dpr; x.font = `${10 * dpr}px Arial`; x.fillStyle = "#555";
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { x.strokeStyle = "#222"; x.beginPath(); x.moveTo(fx(f), 0); x.lineTo(fx(f), H); x.stroke(); x.fillText(f >= 1000 ? f / 1000 + "k" : String(f), fx(f) + 2 * dpr, H - 3 * dpr); }
    for (const db of [-12, 0, 12]) { x.strokeStyle = db ? "#222" : "#444"; x.beginPath(); x.moveTo(0, gy(db)); x.lineTo(W, gy(db)); x.stroke(); }
    const fs = 48000, A = Math.pow(10, S.g / 40), w0 = 2 * Math.PI * S.f / fs, al = Math.sin(w0) / (2 * S.q), cw = Math.cos(w0);
    const b = [1 + al * A, -2 * cw, 1 - al * A], a = [1 + al / A, -2 * cw, 1 - al / A];
    const mag = (f) => {
      let db = 0;
      if (S.eqOn) {
        const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
        const nr = b[0] + b[1] * c1 + b[2] * c2, ni = -(b[1] * s1 + b[2] * s2), dr = a[0] + a[1] * c1 + a[2] * c2, di = -(a[1] * s1 + a[2] * s2);
        db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
      }
      if (S.lcOn) { const rr = f / S.lcHz; db += S.slope12 ? 20 * Math.log10((rr * rr) / Math.sqrt(1 + rr ** 4)) : 20 * Math.log10(rr / Math.sqrt(1 + rr * rr)); }
      return Math.max(-rng, db);
    };
    x.beginPath();
    for (let i = 0; i <= W; i += dpr) { const y = gy(mag(20 * Math.pow(1000, i / W))); i ? x.lineTo(i, y) : x.moveTo(i, y); }
    x.lineWidth = 2.5 * dpr; x.strokeStyle = S.eqOn || S.lcOn ? "#3fd27a" : "#666"; x.stroke();
    if (S.eqOn) { x.fillStyle = "#ffd23f"; x.beginPath(); x.arc(fx(S.f), gy(S.g), 5 * dpr, 0, 7); x.fill(); }
  }

  // ---- reads / writes ----
  const cmd = (fn) => api().safeCommand(fn);
  function setter(key) {
    const r = rec(), n = S.input, did = 41 + n - 1;
    return {
      mute: () => window.sdToggleMute(n, S.mute),
      pan: () => cmd(() => r.Set_Input_Pan(n, S.pan === 0 ? 128 : Math.round(128 + (S.pan / 100) * 127))),
      delay: () => cmd(() => r.setUInt16Setting(did, S.delay)),
      src: () => cmd(() => r.Set_Input_Source(n, S.src)),
      p48: () => cmd(() => r.Set_Input_Phantom_Power(n, S.p48)),
      lcOn: () => cmd(() => r.Set_Input_Low_Cut_Enable(n, S.lcOn)),
      lcHz: () => cmd(() => r.Set_Input_Low_Cut_Frequency(n, S.lcHz)),
      slope: () => cmd(() => r.Set_Input_Low_Cut_Slope(S.slope12 ? "_12dB_Per_Oct" : "_6dB_Per_Oct")),
      pol: () => cmd(() => r.Set_Input_Polarity(n, S.pol)),
      lim: () => cmd(() => r.Set_Input_Limiter_Enable(n, S.lim)),
      eqOn: () => cmd(() => r.Set_Input_EQ_Enable(n, S.eqOn)),
      f: () => cmd(() => r.Set_Input_EQ_Frequency(n, S.f)),
      g: () => cmd(() => r.Set_Input_EQ_Gain(n, S.g)),
      q: () => cmd(() => r.Set_Input_EQ_Q(n, S.q)),
    }[key];
  }
  function write(key, final) {
    if (!rec() || !rec().isConnected()) { note("Not connected."); return; }
    const st = send[key] || (send[key] = { t: 0, timer: null }), track = S.track;
    const go = async () => {
      st.t = Date.now(); st.timer = null;
      try { await setter(key)(); note(""); if (final && key !== "mute") setTimeout(() => { if (track === S.track) readInput(); }, 400); }
      catch (e) { note("Write failed: " + (e.message || e)); }
    };
    if (final) { clearTimeout(st.timer); go(); return; }
    if (Date.now() - st.t > 250) go(); else if (!st.timer) st.timer = setTimeout(go, 250);
  }

  async function readInput() {
    const r = rec(), n = S.input, track = S.track;
    if (!r || !r.isConnected()) return;
    try {
      const v = {};
      v.src = String(await cmd(() => r.Get_Input_Source(n)));
      v.p48 = !!(await cmd(() => r.Get_Input_Phantom_Power(n)));
      v.lcOn = !!(await cmd(() => r.Get_Input_Low_Cut_Enable(n)));
      v.lcHz = Math.round(Math.max(40, Math.min(320, Number(await cmd(() => r.Get_Input_Low_Cut_Frequency(n))) || 80)) / 10) * 10;
      v.slope12 = String(await cmd(() => r.Get_Input_Low_Cut_Slope())) !== "_6dB_Per_Oct";
      v.pol = !!(await cmd(() => r.Get_Input_Polarity(n)));
      v.lim = !!(await cmd(() => r.Get_Input_Limiter_Enable(n)));
      v.mute = !!(await cmd(() => r.Get_Input_Mute(n)));
      const raw = Number(await cmd(() => r.Get_Input_Pan(n)));
      v.pan = Math.abs(raw - 128) <= 1 ? 0 : Math.max(-100, Math.min(100, Math.round(((raw - 128) / 127) * 100)));
      v.delay = Math.max(0, Math.min(300, Number(await cmd(() => r.getUInt16Setting(41 + n - 1))) || 0));
      v.eqOn = !!(await cmd(() => r.Get_Input_EQ_Enable(n)));
      v.f = qF(Number(await cmd(() => r.Get_Input_EQ_Frequency(n))) || 1000);
      v.g = Math.max(-12, Math.min(12, Math.round(Number(await cmd(() => r.Get_Input_EQ_Gain(n))) || 0)));
      v.q = qQ(Number(await cmd(() => r.Get_Input_EQ_Q(n))) || 1);
      if (track !== S.track) return;
      Object.assign(S, v);
      note("");
      paint();
    } catch (e) { note("Read failed: " + (e.message || e)); }
  }

  async function readRouting() {
    const a = api(), track = S.track;
    if (!a || !rec() || !rec().isConnected()) return;
    try { await a.runExclusiveOperation("Reading routing...", () => a.refreshInputRoutingMatrix()); } catch (_) {}
    const st = window.__788routingState ? window.__788routingState() : null;
    if (!st || track !== S.track) return;
    const bit = S.track - 1;
    S.feeds = {};
    for (let n = 1; n <= 8; n++) S.feeds[n] = !!(st.routes[n] && st.routes[n][bit]);
    S.routingKnown = true;
    // Show the input that actually feeds this track (keep the current pick if it still does).
    if (!S.input || !S.feeds[S.input]) {
      const feeders = Object.keys(S.feeds).filter((n) => S.feeds[n]).map(Number);
      S.input = feeders.includes(S.track - 2) ? S.track - 2 : (feeders[0] || 0);
    }
    readIso(st);
    if (window.sdRefreshStripInputs) window.sdRefreshStripInputs();
    paint();
  }

  function readIso(st) {
    st = st || (window.__788routingState ? window.__788routingState() : null);
    if (!st || !S.input) { S.iso = null; return; }
    const bit = S.track - 1, on = st.routes[S.input] && st.routes[S.input][bit];
    S.iso = !on ? null : (st.prePost[S.input] && st.prePost[S.input][bit] ? "post" : "pre");
  }

  async function isoToggle() {
    if (!S.iso || !window.toggleInputPrePostRoute) return;
    await window.toggleInputPrePostRoute(S.input, S.track);
    readRouting();
  }

  async function loadGlobals() {
    const a = api();
    if (!$("fcAll").open || !a || !rec() || !rec().isConnected()) return;
    try { a.bindInputGlobalDropdowns(); await a.runExclusiveOperation("Reading input settings...", () => a.refreshInputGlobals()); } catch (_) {}
  }

  function note(t) { const el = $("fcNote"); if (el) el.textContent = t; }

  function open(track) {
    build();
    S.track = track;
    S.input = 0; S.feeds = {}; S.routingKnown = false; S.iso = null;
    const box = document.querySelector(`#meter${track} .sdTrackName`);
    S.name = box ? box.value : "";
    $("fcWin").classList.add("open");
    note(rec() && rec().isConnected() ? "Reading..." : "Not connected.");
    paint();
    if (rec() && rec().isConnected()) (async () => { await readRouting(); if (S.input && track === S.track) await readInput(); else note(""); })();
  }
  function close() { const w = $("fcWin"); if (w) w.classList.remove("open"); }
  window.sdOpenFatChannel = open;

  // Tap a strip's letter box to open it (replaces the old rename popup there).
  function hookStrips() {
    for (const btn of document.querySelectorAll("#meterView .channel > .trackButton")) {
      if (btn.dataset.fc) continue;
      const m = /^(?:unit\d+_)?trackButton(\d+)$/.exec(btn.id || "");
      if (!m || /^unit/.test(btn.id)) continue;
      btn.dataset.fc = "1";
      for (const a of ["onclick", "onpointerdown", "ontouchstart", "onmousedown"]) { btn.removeAttribute(a); btn[a] = null; }
      btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); open(Number(m[1])); });
    }
  }
  function start() {
    const v = $("meterView");
    if (!v || !document.body.classList.contains("sdPersistent")) return;
    hookStrips();
    new MutationObserver(hookStrips).observe(v, { childList: true, subtree: true });
    // The fat channel replaces the INPUTS tab.
    const ib = [...document.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === "INPUTS");
    if (ib) ib.style.display = "none";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(start, 100));
  else setTimeout(start, 100);
})();

/* REPORT: moved from the bottom bar into the tab bar, between FILES and
   MONITORING (it still opens the Sound Report panel). */
(function () {
  function move() {
    const btn = document.querySelector(".srBtn");
    const files = [...document.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === "FILES");
    if (!btn || !files) return false;
    btn.className = "srTabBtn";
    btn.style.fontSize = "4vh";
    files.parentNode.insertBefore(btn, files.nextSibling);
    // REPORT behaves like a tab: it lights up while the sheet is open, and any
    // other tab closes the sheet (and the fat channel).
    btn.addEventListener("click", () => {
      for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b === btn);
      const fc = document.getElementById("fcWin");
      if (fc) fc.classList.remove("open");
    });
    for (const b of document.querySelectorAll(".tabs button")) {
      if (b === btn) continue;
      b.addEventListener("click", () => {
        const p = document.getElementById("srPanel");
        if (p) p.classList.remove("open");
        btn.classList.remove("active");
        const fc = document.getElementById("fcWin");
        if (fc) fc.classList.remove("open");
      }, true);
    }
    return true;
  }
  let tries = 0;
  const t = setInterval(() => { if (move() || ++tries > 40) clearInterval(t); }, 100);
})();

/* Failure messages pop up briefly in the middle of the screen (the bottom-bar
   status text is small and easy to miss). */
(function () {
  const BAD = /failed|did not verify|disabled|refused|can't|cannot|not connected|connect first|disconnect first|already at|connection lost/i;
  let last = "", timer = null;
  function toast(text) {
    let el = document.getElementById("sdToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "sdToast";
      el.onclick = () => el.classList.remove("show");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove("show"), 5000);
  }
  function start() {
    const st = document.getElementById("statusText");
    if (!st) return;
    new MutationObserver(() => {
      const t = st.textContent.trim();
      if (t && t !== last && BAD.test(t)) toast(t);
      last = t;
    }).observe(st, { childList: true, characterData: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

/* OUTPUTS tab, SD Remote style: six output strips (OUT 1-6) with a meter,
   level, source and MUTE, and a fat output opened from the strip's bottom box.
   788T facts: outputs 1-4 analog TA3, 5-6 3.5 mm, AES 1-6 carry the same
   signals. Level = setting 82+ (attenuation in dB). Source = ONE group at a
   time: inputs 1-8, or tracks L..X2, or headphone L/R (several from the same
   group are summed). Output mute (366) only works with a CL-9. */
(function () {
  const $ = (id) => document.getElementById(id);
  const TR = ["L", "R", "A", "B", "C", "D", "E", "F", "G", "H", "X1", "X2"];
  const api = () => window.__788, rec = () => window.recorder;
  const O = {}; // per output: { level, type, inputs[], tracks[], hp[] }
  let mutes = [], cur = 1, levelSend = { t: 0, timer: null };
  for (let n = 1; n <= 6; n++) O[n] = { level: 0, type: "None", inputs: [], tracks: [], hp: [] };
  const cmd = (fn) => api().safeCommand(fn);

  function srcLabel(o) {
    if (o.type === "Input") return o.inputs.map((on, i) => (on ? "In " + (i + 1) : null)).filter(Boolean).join("+");
    if (o.type === "Track") return o.tracks.map((on, i) => (on && i < 12 ? TR[i] : null)).filter(Boolean).join("+");
    if (o.type === "HP") return ["HP L", "HP R"].filter((_, i) => o.hp[i]).join("+") + (hpName ? " (" + hpName + ")" : "");
    return "—";
  }

  function build() {
    const tab = $("outputs");
    if (!tab || $("sdOutputs") || !document.body.classList.contains("sdPersistent")) return;
    for (const c of tab.children) c.style.display = "none";
    const v = document.createElement("div");
    v.id = "sdOutputs";
    v.innerHTML = `<div class="soStrips">${[1, 2, 3, 4, 5, 6].map((n) => `
      <div class="soStrip" data-out="${n}">
        <div class="soTop">OUT ${n}</div>
        <div class="soMeter"><div class="soFill" id="soFill${n}"></div><div class="soPeak" id="soPeak${n}"></div></div>
        <div class="soLevel" id="soLevel${n}">–</div>
        <div class="soSrc" id="soSrc${n}">–</div>
        <button class="soMute" id="soMute${n}" type="button">MUTE</button>
        <button class="soOpen" type="button" data-out="${n}">OUT ${n}<small>${n <= 4 ? "TA3" : "3.5 mm"}</small></button>
      </div>`).join("")}</div>`;
    tab.appendChild(v);
    for (const b of v.querySelectorAll(".soOpen")) b.onclick = () => openFat(Number(b.dataset.out));
    for (let n = 1; n <= 6; n++) $("soMute" + n).onclick = () => toggleMute(n);
    buildFat();
    const ob = [...document.querySelectorAll(".tabs button")].find((b) => b.textContent.trim() === "OUTPUTS");
    if (ob) ob.addEventListener("click", () => setTimeout(loadAll, 0));
  }

  function paintStrips() {
    for (let n = 1; n <= 6; n++) {
      const o = O[n];
      $("soLevel" + n).textContent = (o.level ? "-" + o.level : "0") + " dB";
      $("soSrc" + n).textContent = srcLabel(o);
      $("soMute" + n).classList.toggle("muted", !!mutes[n - 1]);
    }
  }

  // Output meters (group 2): dB below full scale -> height on a -50..0 scale.
  // Each output's meter is worked out from what's routed to it (inputs from the
  // input meters, tracks from the track meters, summed in power), minus the
  // output's level setting. Off or headphones: no meter.
  // Output meters from the TRACK meters (the only real meters the 788T reports:
  // every GetMeters group returned the track levels). A track source uses that
  // track's meter. An input source uses the iso track it feeds (prefer A-X2, which
  // are pre-fader by default; L/R only if that's all it feeds). Summed in power,
  // minus the output's level. Off, headphones, or an input feeding no track: none.
  function isoTrackFor(input) {
    const st = window.__788routingState ? window.__788routingState() : null;
    const r = st && st.routes && st.routes[input];
    if (!r) return input + 2 <= 12 ? input + 1 : -1; // factory layout until routing is read: input n -> track A+n-1
    for (let k = 2; k < 12; k++) if (r[k]) return k;
    for (let k = 0; k < 2; k++) if (r[k]) return k;
    return -1;
  }
  // Headphone mix: what the HP selector is on (e.g. "Track L,R", "Input 1,2",
  // "Tracks LRAB,LRAB", "... (MS)"), as track indices per ear.
  let hpEars = [[], []], hpName = "";
  function parseHpMode(name) {
    hpName = String(name || "");
    const toks = (str, isInput) => {
      if (isInput) return str.split(/\D+/).filter(Boolean).map((n) => isoTrackFor(Number(n))).filter((k) => k >= 0);
      const out = [];
      const t = str.replace(/Aux1/g, "X1").replace(/Aux2/g, "X2");
      const re = /X1|X2|[LRA-H]/g; let m;
      while ((m = re.exec(t))) out.push(TR.indexOf(m[0]));
      return out.filter((k) => k >= 0);
    };
    const bf = /^(Input|Track) B-Fmt/.exec(hpName);
    if (bf) { const both = bf[1] === "Input" ? toks("1,2,3,4", true) : [2, 3, 4, 5]; hpEars = [both, both]; return; }
    const m = /^(Tracks?|Input) (.+?),(.+?)( \(MS\))?$/.exec(hpName);
    if (!m) { hpEars = [[], []]; return; }
    const isIn = m[1] === "Input";
    let l = toks(m[2], isIn), r = toks(m[3], isIn);
    if (m[4]) { const both = [...new Set([...l, ...r])]; l = both; r = both; }
    hpEars = [l, r];
  }
  async function readHp() {
    const r = rec();
    if (!r || !r.isConnected()) return;
    try {
      const raw = await cmd(() => r.Get_Current_HP_Monitor_Selection());
      const slot = Number(raw) || 1;
      const mode = await cmd(() => r.Get_HP_Monitor_Mode(slot));
      const before = hpName;
      parseHpMode(mode);
      if (hpName !== before) console.log("HP for outputs: selection=" + raw + " slot=" + slot + " mode='" + mode + "' ears=" + JSON.stringify(hpEars.map((e) => e.map((k) => TR[k]))));
    } catch (e) { console.log("HP for outputs read failed: " + (e && e.message ? e.message : e)); }
  }
  setInterval(() => { const t = $("outputs"); if (t && t.classList.contains("active")) readHp(); }, 5000);

  window.sdDrawOutputMeters = function () {
    const tracks = window.__sdTrackMeters || [];
    const pct = (db) => Math.max(0, Math.min(100, (60 - Math.min(60, db)) * 100 / 60));
    const sum = (list) => {
      const p = list.filter((x) => x != null && x < 200).reduce((a, x) => a + Math.pow(10, -x / 10), 0);
      return p > 0 ? -10 * Math.log10(p) : 255;
    };
    for (let n = 1; n <= 6; n++) {
      const o = O[n];
      const idx = [];
      if (o.type === "Track") o.tracks.forEach((on, k) => { if (on) idx.push(k); });
      if (o.type === "Input") o.inputs.forEach((on, k) => { if (on) { const t = isoTrackFor(k + 1); if (t >= 0) idx.push(t); } });
      if (o.type === "HP") { if (o.hp[0]) idx.push(...hpEars[0]); if (o.hp[1]) idx.push(...hpEars[1]); }
      const v = sum(idx.map((k) => tracks[k] && tracks[k].vuDbBelowFs)) + o.level;
      const p = sum(idx.map((k) => tracks[k] && tracks[k].peakDbBelowFs)) + o.level;
      $("soFill" + n).style.clipPath = `inset(${100 - pct(v)}% 0 0 0)`;
      $("soPeak" + n).style.bottom = pct(p) + "%";
      $("soPeak" + n).style.display = p < 200 ? "" : "none";
    }
  };

  async function readOut(n) {
    const r = rec();
    const o = O[n];
    o.level = Math.max(0, Math.min(40, Number(await cmd(() => r.Get_Output_Attenuation(n))) || 0));
    o.inputs = (await cmd(() => r.Get_Output_InputSources(n))).slice(0, 8);
    o.tracks = (await cmd(() => r.Get_Output_TrackSources(n))).slice(0, 12);
    o.hp = await cmd(() => r.Get_Output_HeadphoneSources(n));
    o.type = o.inputs.some(Boolean) ? "Input" : o.tracks.some(Boolean) ? "Track" : o.hp.some(Boolean) ? "HP" : "None";
  }

  async function loadAll() {
    const a = api();
    if (!a || !rec() || !rec().isConnected() || !$("outputs").classList.contains("active")) return;
    try {
      await a.runExclusiveOperation("Reading outputs...", async () => {
        for (let n = 1; n <= 6; n++) await readOut(n);
        try { mutes = await cmd(() => rec().Get_Output_Mutes()); } catch (_) {}
        await readHp();
      });
    } catch (e) { console.log("Outputs read failed:", e && e.message ? e.message : e); }
    paintStrips();
    if ($("foWin").classList.contains("open")) paintFat();
  }

  window.sdReloadOutputs = loadAll;

  async function toggleMute(n) {
    if (!rec() || !rec().isConnected()) return;
    try {
      await api().runExclusiveOperation("Output " + n + " mute...", async () => {
        const m = await cmd(() => rec().Get_Output_Mutes());
        m[n - 1] = !m[n - 1];
        await cmd(() => rec().Set_Output_Mutes(m));
        mutes = await cmd(() => rec().Get_Output_Mutes());
      });
      const st = $("statusText");
      if (st) st.textContent = "Output " + n + (mutes[n - 1] ? " muted" : " unmuted") + " (output mute only acts with a CL-9).";
    } catch (e) { const st = $("statusText"); if (st) st.textContent = "Output mute failed: " + (e.message || e); }
    paintStrips(); paintFat();
  }

  // ---- fat output ----
  function buildFat() {
    if ($("foWin")) return;
    const w = document.createElement("div");
    w.id = "foWin";
    w.innerHTML = `
      <div class="fcHead"><div class="fcTitle" id="foTitle">OUT 1</div><span id="foNote"></span><button class="fcClose" id="foClose" type="button">✕</button></div>
      <div class="foBody">
        <div class="fcCol">
          <div class="fcRow"><span class="fcLab">Level</span><input class="fcSlider" id="fo_level" type="range" min="-40" max="0" step="1"><span class="fcVal" id="fov_level"></span></div>
          <div class="fcRow"><span class="fcLab">Mute <i>CL-9</i></span><button class="fcSw mute" id="fo_mute" type="button"><span></span></button></div>
          <div class="fcHint" style="margin-top:1vh">Analog TA3 on outputs 1–4, 3.5 mm on 5–6; AES 1–6 carry the same signals.<br>
            Output mute needs a CL-9, and never mutes a Headphones source.<br>
            Delay (outputs 1–2 only, 0–10 frames) is set on the 788T.<br>
            Factory setting: Out 1–6 = tracks L, R, A, B, C, D, gain −4 dB.</div>
        </div>
        <div class="fcCol foSrcCol">
          <div class="fcRow"><span class="fcLab">Source</span><span class="fcHint" id="fo_srcNow"></span><button class="fcBtn" id="fo_off" type="button" style="margin-left:auto">OFF</button></div>
          <div class="foGroupLab">Inputs</div><div class="foGrid" id="fo_gIn"></div>
          <div class="foGroupLab">Tracks</div><div class="foGrid" id="fo_gTr"></div>
          <div class="foGroupLab">Headphones</div><div class="foGrid" id="fo_gHp"></div>
          <div class="fcHint">Lit = routed to this output. The 788T allows one group per output (inputs, tracks or
            headphones): tapping a source in another group switches the output to it. Within a group several are summed.
            Inputs keep playing whatever the transport does; tracks follow record / playback.</div>
        </div>
      </div>
      <div class="fcTabs" id="foTabs">${[1, 2, 3, 4, 5, 6].map((n) => `<button type="button" data-out="${n}">OUT ${n}</button>`).join("")}</div>`;
    document.body.appendChild(w);
    $("foClose").onclick = () => w.classList.remove("open");
    for (const b of w.querySelectorAll("#foTabs button")) b.onclick = () => openFat(Number(b.dataset.out));
    const lv = $("fo_level");
    lv.addEventListener("input", () => { O[cur].level = -Number(lv.value); paintFat(); paintStrips(); sendLevel(false); });
    lv.addEventListener("change", () => sendLevel(true));
    $("fo_mute").onclick = () => toggleMute(cur);
    $("fo_off").onclick = () => setType("None");
  }

  function paintFat() {
    const w = $("foWin");
    if (!w) return;
    const o = O[cur];
    $("foTitle").textContent = "OUT " + cur + " · " + srcLabel(o);
    const lv = $("fo_level");
    if (document.activeElement !== lv) lv.value = -o.level;
    $("fov_level").textContent = (o.level ? "-" + o.level : "0") + " dB";
    $("fo_mute").classList.toggle("on", !!mutes[cur - 1]);
    for (const b of w.querySelectorAll("#foTabs button")) b.classList.toggle("on", Number(b.dataset.out) === cur);
    $("fo_srcNow").textContent = o.type === "None" ? "Off (silent)" : srcLabel(o);
    $("fo_off").classList.toggle("on", o.type === "None");
    const groups = [
      ["fo_gIn", "Input", [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ["In " + n, n - 1]), o.inputs],
      ["fo_gTr", "Track", TR.map((t, k) => [t, k]), o.tracks],
      ["fo_gHp", "HP", [["HP L", 0], ["HP R", 1]], o.hp],
    ];
    for (const [id, type, items, list] of groups) {
      const g = $(id);
      g.innerHTML = items.map(([lab, k]) => `<button type="button" data-k="${k}" class="${o.type === type && list[k] ? "on" : ""}">${lab}</button>`).join("");
      for (const b of g.querySelectorAll("button")) b.onclick = () => tapSrc(type, Number(b.dataset.k));
    }
  }

  function openFat(n) {
    cur = n;
    $("foWin").classList.add("open");
    paintFat();
    (async () => {
      if (!rec() || !rec().isConnected()) { $("foNote").textContent = "Not connected."; return; }
      $("foNote").textContent = "Reading...";
      try { await readOut(n); mutes = await cmd(() => rec().Get_Output_Mutes()); $("foNote").textContent = ""; }
      catch (e) { $("foNote").textContent = "Read failed: " + (e.message || e); }
      if (n === cur) { paintFat(); paintStrips(); }
    })();
  }

  function sendLevel(final) {
    if (!rec() || !rec().isConnected()) return;
    const n = cur, go = async () => {
      levelSend.t = Date.now(); levelSend.timer = null;
      try { await cmd(() => rec().Set_Output_Attenuation(n, O[n].level)); $("foNote").textContent = ""; if (final) setTimeout(() => openFat(n), 400); }
      catch (e) { reportErr("Output " + n + " level write failed: " + (e.message || e)); }
    };
    if (final) { clearTimeout(levelSend.timer); go(); return; }
    if (Date.now() - levelSend.t > 250) go(); else if (!levelSend.timer) levelSend.timer = setTimeout(go, 250);
  }

  function reportErr(msg) {
    console.log(msg);
    $("foNote").textContent = msg;
    const st = $("statusText");
    if (st) st.textContent = msg;
  }

  async function writeRouting(n) {
    const o = O[n], r = rec();
    const pad = (arr, len) => { const a = new Array(len).fill(false); arr.forEach((v, i) => { if (i < len) a[i] = !!v; }); return a; };
    await api().runExclusiveOperation("Setting output " + n + " source...", async () => {
      if (o.type === "Input") await cmd(() => r.Set_Output_Routing(n, "Input", pad(o.inputs, 32)));
      else if (o.type === "Track") await cmd(() => r.Set_Output_Routing(n, "Track", pad(o.tracks, 32)));
      else if (o.type === "HP") await cmd(() => r.Set_Output_Routing(n, "HP", pad(o.hp, 2)));
      else await cmd(() => r.Clear_Output_Routing(n));
      await readOut(n);
    });
  }

  async function setType(t) {
    const o = O[cur];
    if (t === o.type) return;
    o.type = t;
    // A new group starts with one obvious source selected, so the output isn't silent.
    if (t === "Input") { o.inputs = new Array(8).fill(false); o.inputs[0] = true; }
    if (t === "Track") { o.tracks = new Array(12).fill(false); o.tracks[Math.min(cur - 1, 11)] = true; }
    if (t === "HP") o.hp = [true, true];
    paintFat();
    try { await writeRouting(cur); } catch (e) { reportErr("Output " + cur + " source change failed: " + (e.message || e)); }
    paintFat(); paintStrips();
  }

  async function tapSrc(type, k) {
    const o = O[cur];
    if (o.type !== type) {
      // Switching group: the 788T clears the other group.
      o.type = type;
      o.inputs = new Array(8).fill(false); o.tracks = new Array(12).fill(false); o.hp = [false, false];
      (type === "Input" ? o.inputs : type === "Track" ? o.tracks : o.hp)[k] = true;
      const st = $("statusText");
      if (st) st.textContent = "OUT " + cur + " switched to " + (type === "Input" ? "inputs" : type === "Track" ? "tracks" : "headphones") + " (the 788T allows one group per output).";
    } else {
      const list = type === "Input" ? o.inputs : type === "Track" ? o.tracks : o.hp;
      list[k] = !list[k];
      if (!list.some(Boolean)) o.type = "None";
    }
    paintFat();
    try { await writeRouting(cur); } catch (e) { reportErr("Output " + cur + " source change failed: " + (e.message || e)); }
    paintFat(); paintStrips();
  }

  function start() { build(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(start, 120));
  else setTimeout(start, 120);
})();
