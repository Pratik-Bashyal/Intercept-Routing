// Intercept — Google-Maps-style frontend.
const map = L.map("map", { zoomControl: true }).setView([49.246, -123.08], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "© OpenStreetMap contributors",
}).addTo(map);
map.zoomControl.setPosition("bottomright");

const $ = (id) => document.getElementById(id);
const statusEl = $("status"), resultsEl = $("results");

let origin = null, dest = null;
let oMarker = null, dMarker = null;
let lastField = "origin";
let mode = "catch";
const routeLayer = L.layerGroup().addTo(map);
const busLayer = L.layerGroup().addTo(map);

function pinIcon(which) {
  return L.divIcon({ className: "", iconSize: [20, 20], iconAnchor: [10, 18], html: `<div class="pin ${which}"></div>` });
}
function busIcon(bearing) {
  return L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="busmark" style="transform:rotate(${bearing != null ? bearing : 0}deg)">🚌</div>` });
}
function routeBadge(latlng, label, color) {
  if (!latlng || latlng[0] == null) return;
  const icon = L.divIcon({ className: "", iconSize: [1, 1], iconAnchor: [0, 0],
    html: `<span class="route-badge" style="background:${color};transform:translate(-50%,-50%)">#${label}</span>` });
  L.marker(latlng, { icon, interactive: false, zIndexOffset: 600 }).addTo(routeLayer);
}
function midPoint(line) {
  if (!line || line.length < 2) return null;
  return line[Math.floor(line.length / 2)];
}

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
function setStatus(txt, spin) { statusEl.innerHTML = txt ? (spin ? `<span class="spin"></span>` : "") + txt : ""; }

// ---- point setters ----
function setOriginPoint(lat, lon, label) {
  origin = { lat, lon };
  const ll = [lat, lon];
  if (oMarker) oMarker.setLatLng(ll); else oMarker = L.marker(ll, { icon: pinIcon("o"), zIndexOffset: 500 }).addTo(map);
  if (label) $("oAddr").value = label;
  fitIfBoth(lat, lon);
}
function setDestPoint(lat, lon, label) {
  dest = { lat, lon };
  const ll = [lat, lon];
  if (dMarker) dMarker.setLatLng(ll); else dMarker = L.marker(ll, { icon: pinIcon("d"), zIndexOffset: 500 }).addTo(map);
  if (label) $("dAddr").value = label;
  fitIfBoth(lat, lon);
}
function fitIfBoth(lat, lon) {
  if (origin && dest) map.fitBounds([[origin.lat, origin.lon], [dest.lat, dest.lon]], { padding: [80, 80], maxZoom: 15 });
  else map.flyTo([lat, lon], 15);
}

// ---- map click places the active field ----
map.on("click", (e) => {
  const { lat, lng } = e.latlng;
  const coord = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (lastField === "origin" || !origin) { setOriginPoint(lat, lng, coord); lastField = "dest"; }
  else { setDestPoint(lat, lng, coord); }
});
$("oAddr").addEventListener("focus", () => (lastField = "origin"));
$("dAddr").addEventListener("focus", () => (lastField = "dest"));

// ---- geocoding autocomplete ----
function wireGeocode(inputId, resultsId, which) {
  const input = $(inputId), box = $(resultsId);
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { box.classList.remove("show"); return; }
    timer = setTimeout(async () => {
      try {
        const list = await (await fetch("/api/geocode?q=" + encodeURIComponent(q))).json();
        box.innerHTML = "";
        if (!list.length) { box.classList.remove("show"); return; }
        for (const m of list) {
          const short = m.label.split(",").slice(0, 3).join(",");
          const d = document.createElement("div");
          d.textContent = short;
          d.onclick = () => {
            if (which === "origin") setOriginPoint(m.lat, m.lon, short);
            else setDestPoint(m.lat, m.lon, short);
            box.classList.remove("show");
          };
          box.appendChild(d);
        }
        box.classList.add("show");
      } catch { box.classList.remove("show"); }
    }, 320);
  });
  input.addEventListener("blur", () => setTimeout(() => box.classList.remove("show"), 180));
}
wireGeocode("oAddr", "oResults", "origin");
wireGeocode("dAddr", "dResults", "destination");

// ---- use my location ----
$("locBtn").onclick = () => {
  if (!navigator.geolocation) return toast("Geolocation not supported");
  setStatus("Locating…", true);
  navigator.geolocation.getCurrentPosition(
    (pos) => { setStatus(""); setOriginPoint(pos.coords.latitude, pos.coords.longitude, "My location"); },
    () => { setStatus(""); toast("Couldn't get your location"); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
};

// ---- swap ----
$("swapBtn").onclick = () => {
  const o = origin, d = dest;
  const ov = $("oAddr").value, dv = $("dAddr").value;
  origin = dest = null; if (oMarker) { map.removeLayer(oMarker); oMarker = null; } if (dMarker) { map.removeLayer(dMarker); dMarker = null; }
  $("oAddr").value = dv; $("dAddr").value = ov;
  if (d) setOriginPoint(d.lat, d.lon); if (o) setDestPoint(o.lat, o.lon);
};

// ---- mode toggle ----
document.querySelectorAll(".mode").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".mode").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    mode = btn.dataset.mode;
    if (mode !== "plan" && typeof stopPlanRefresh === "function") stopPlanRefresh();
    $("goBtn").textContent = mode === "catch" ? "🎯 Find buses I can catch"
      : mode === "plan" ? "🗓️ Plan trip" : "🕒 Show next departures";
  };
});
$("goBtn").textContent = "🎯 Find buses I can catch";

// ---- advanced ----
$("advToggle").onclick = () => {
  const a = $("advanced"); a.classList.toggle("hidden");
  $("advToggle").textContent = a.classList.contains("hidden") ? "Advanced ▾" : "Advanced ▴";
};

// ---- load routes for datalist ----
fetch("/api/routes").then((r) => r.json()).then((routes) => {
  const dl = $("routeList");
  for (const r of routes) {
    const o = document.createElement("option");
    o.value = r.short || r.long; o.label = `${r.typeName}: ${r.long || r.short}`;
    dl.appendChild(o);
  }
});

function need() {
  if (!origin) { toast("Set a starting point"); $("oAddr").focus(); return false; }
  if (!dest) { toast("Set a destination"); $("dAddr").focus(); return false; }
  return true;
}

// ---- run current mode ----
$("goBtn").onclick = () => {
  if (mode === "catch") runCatch();
  else if (mode === "plan") runPlan();
  else runDepartures();
};

function clearMap() { routeLayer.clearLayers(); busLayer.clearLayers(); if (typeof stopLiveTrack === "function") stopLiveTrack(); }
function stopDot(stop, color) {
  if (stop.lat == null) return;
  L.circleMarker([stop.lat, stop.lon], { radius: 6, color, fillColor: color, fillOpacity: .9, weight: 2 })
    .bindPopup(`${stop.name}${stop.code ? " (" + stop.code + ")" : ""}`).addTo(routeLayer);
}
function legHtml(leg) {
  if (leg.type === "ride") {
    let live = "";
    if (leg.live) {
      const d = leg.live.delayMin;
      const lbl = d > 0 ? `${d} min late` : d < 0 ? `${-d} min early` : "on time";
      const cls = d > 1 ? "lv-late" : d < -0 ? "lv-early" : "lv-ontime";
      const t = leg.live.dep ? ` · live ${leg.live.dep}` : "";
      live = ` <span class="livechip ${cls}">● ${lbl}${t}</span>`;
    }
    return `<div class="leg"><span class="badge b-bus">#${leg.route}</span><span>board <b>${leg.from.name}</b> @ ${leg.dep} → <b>${leg.to.name}</b> @ ${leg.arr}${live}</span></div>`;
  }
  return `<div class="leg"><span class="badge b-walk">walk</span><span>${leg.dist}m to ${leg.to.name} — ${leg.arr}</span></div>`;
}

// ===== CATCH (auto-suggest live buses) =====
const VERDICT_LABEL = {
  rescue: { tag: "⚡ Intercept", txt: "You'd miss it on foot — a connector catches it!" },
  earlier: { tag: "⚡ Board earlier", txt: "A connector lets you board earlier." },
  walkok: { tag: "🚶 Walk & catch", txt: "You can walk to this one in time." },
};
async function runCatch() {
  if (!need()) return;
  resultsEl.innerHTML = ""; clearMap();
  setStatus("Scanning live buses heading your way…", true);
  try {
    const data = await (await fetch("/api/suggest", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oLat: origin.lat, oLon: origin.lon, dLat: dest.lat, dLon: dest.lon }),
    })).json();
    if (data.error) return setStatus("⚠️ " + data.error);
    setStatus(`${data.count} catchable bus${data.count === 1 ? "" : "es"} · ${data.time}`);
    if (!data.buses.length) { resultsEl.innerHTML = banner("none", "No catchable live buses toward your destination right now (service may be sparse)."); return showDepartures(); }
    window._buses = data.buses;
    resultsEl.innerHTML = data.buses.map(busCard).join("");
    bindCards(selectBus); selectBus(0);
  } catch (e) { setStatus("⚠️ " + e.message); }
}
function busCard(b, i) {
  const vl = VERDICT_LABEL[b.verdict] || VERDICT_LABEL.walkok;
  const smart = b.verdict !== "walkok";
  const via = smart && b.connector ? ` <span class="meta">via ${b.connector.via}</span>` : "";
  return `<div class="card ${smart ? "smart" : ""}" data-i="${i}">
    <div class="top"><div class="chips"><span class="chip c-bus">#${b.route}</span>
      <span class="tag ${smart ? "tag-smart" : "tag-rec"}">${vl.tag}</span></div>
      <div class="eta">${b.destArrive}<small>arrive</small></div></div>
    <div class="meta">→ ${b.headsign || "toward destination"}</div>
    <div class="detail">
      <div class="leg">🚏 <span>Board <b>${b.board.stop.name}</b>${via}</span></div>
      <div class="leg">⏱️ <span>Be there by <b>${b.board.bus}</b> · you can arrive ${b.board.you}${b.board.live ? " (live)" : ""}</span></div>
      <div class="leg">🎯 <span>${vl.txt}</span></div>
      <div class="leg">🏁 <span>Arrive ~<b>${b.destArrive}</b></span></div>
    </div></div>`;
}
function selectBus(i) {
  markSel(i); clearMap();
  const b = window._buses[i];
  const c = b.verdict === "walkok" ? "#f29900" : "#1a73e8";
  const bounds = [];
  // bus route geometry (board -> alight), solid with white casing
  if (b.shape && b.shape.length > 1) {
    L.polyline(b.shape, { color: "#fff", weight: 9, opacity: .9, lineCap: "round", lineJoin: "round" }).addTo(routeLayer);
    L.polyline(b.shape, { color: c, weight: 6, opacity: .95, lineCap: "round", lineJoin: "round" }).addTo(routeLayer);
    routeBadge(midPoint(b.shape), b.route, c);
    b.shape.forEach((pt) => bounds.push(pt));
  } else if (b.board.stop.lat != null && b.alight && b.alight.lat != null) {
    L.polyline([[b.board.stop.lat, b.board.stop.lon], [b.alight.lat, b.alight.lon]], { color: c, weight: 6, opacity: .9 }).addTo(routeLayer);
  }
  // dotted walk: your start -> board stop
  if (origin && b.board.stop.lat != null) {
    drawWalk([origin.lat, origin.lon], [b.board.stop.lat, b.board.stop.lon]);
    bounds.push([origin.lat, origin.lon]);
  }
  // dotted walk: alight -> destination
  if (dest && b.alight && b.alight.lat != null) {
    drawWalk([b.alight.lat, b.alight.lon], [dest.lat, dest.lon]);
    bounds.push([dest.lat, dest.lon]);
  }
  if (b.board.stop.lat != null) {
    stopDot(b.board.stop, c);
    L.marker([b.board.stop.lat, b.board.stop.lon]).bindPopup(`Board here: ${b.board.stop.name}`).addTo(routeLayer);
  }
  if (b.alight && b.alight.lat != null) stopDot(b.alight, c);
  if (b.lat != null) { L.marker([b.lat, b.lon], { icon: busIcon(b.bearing) }).bindPopup(`#${b.route} → ${b.headsign}`).addTo(busLayer); bounds.push([b.lat, b.lon]); }
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
  trackLiveBus(b);
}

// Poll the live feed and keep the selected bus marker moving (~15s).
let _liveTimer = null, _liveTrip = null;
function stopLiveTrack() { if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; } _liveTrip = null; }
function trackLiveBus(b) {
  stopLiveTrack();
  if (!b || !b.tripId) return;
  _liveTrip = b.tripId;
  const tick = async () => {
    if (_liveTrip !== b.tripId) return;
    try {
      const vs = await (await fetch("/api/vehicles")).json();
      const v = vs.find((x) => x.tripId === b.tripId);
      if (v && _liveTrip === b.tripId) {
        busLayer.clearLayers();
        L.marker([v.lat, v.lon], { icon: busIcon(v.bearing) }).bindPopup(`#${b.route} → ${b.headsign} (live)`).addTo(busLayer);
      }
    } catch (e) { /* ignore */ }
  };
  _liveTimer = setInterval(tick, 15000);
}

// ===== PLAN (ranked itineraries) =====
const RIDE_COLORS = ["#1a73e8", "#1e8e3e", "#f29900", "#a142f4", "#e52592"];
async function runPlan() {
  if (!need()) return;
  resultsEl.innerHTML = ""; clearMap();
  setStatus("Planning…", true);
  try {
    const data = await (await fetch("/api/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oLat: origin.lat, oLon: origin.lon, dLat: dest.lat, dLon: dest.lon }),
    })).json();
    if (data.error) return setStatus("⚠️ " + data.error);
    const its = data.itineraries || [];
    if (!its.length) { setStatus(""); resultsEl.innerHTML = banner("none", "No through transit route found right now."); return showDepartures(); }
    setStatus(`${its.length} option${its.length === 1 ? "" : "s"}`);
    window._its = its;
    const hint = data.interceptHint ? `<div class="banner ban-intercept hint-beat">${data.interceptHint.text}</div>` : "";
    resultsEl.innerHTML = banner(data.verdict.kind, data.verdict.text) + `<div id="hintSlot">${hint}</div>` + its.map(itinCard).join("");
    bindCards(selectItin); selectItin(0);
    startPlanRefresh();
  } catch (e) { setStatus("⚠️ " + e.message); }
}

// Silently re-evaluate the live "beat this by intercepting" hint every 30s
// while the Plan is on screen — without disturbing the selected route/map.
let _planTimer = null;
function stopPlanRefresh() { if (_planTimer) { clearInterval(_planTimer); _planTimer = null; } }
function startPlanRefresh() {
  stopPlanRefresh();
  _planTimer = setInterval(async () => {
    if (mode !== "plan" || !origin || !dest) return stopPlanRefresh();
    const slot = document.getElementById("hintSlot");
    if (!slot) return stopPlanRefresh();
    try {
      const data = await (await fetch("/api/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oLat: origin.lat, oLon: origin.lon, dLat: dest.lat, dLon: dest.lon }),
      })).json();
      slot.innerHTML = data.interceptHint
        ? `<div class="banner ban-intercept hint-beat">${data.interceptHint.text}</div>` : "";
    } catch (e) { /* keep last */ }
  }, 30000);
}
// ===== DEPARTURES FALLBACK (what's coming from nearby stops) =====
async function runDepartures() {
  if (!origin) { toast("Set a starting point"); $("oAddr").focus(); return; }
  resultsEl.innerHTML = ""; clearMap();
  setStatus("Loading next departures…", true);
  const n = await showDepartures(true);
  setStatus(n ? `${n} route${n === 1 ? "" : "s"} departing nearby` : "No upcoming departures from nearby stops.");
}
async function showDepartures(standalone) {
  if (!origin) return 0;
  try {
    const data = await (await fetch("/api/departures", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oLat: origin.lat, oLon: origin.lon, dLat: dest && dest.lat, dLon: dest && dest.lon }),
    })).json();
    if (data.error || !data.departures || !data.departures.length) return 0;
    const hasDest = !!dest;
    const toward = data.departures.filter((d) => d.toward);
    const note = !hasDest
      ? "Set a destination to see which of these head your way."
      : toward.length
        ? `${toward.length} of these head toward your destination (marked ✓).`
        : "None go directly to your destination — you may need a transfer or a connector bus.";
    const html = `<div class="dep-head">🕒 Next departures from nearby stops · ${data.time}</div>
      <div class="dep-note">${note}</div>` + data.departures.map(depCard).join("");
    if (standalone) resultsEl.innerHTML = html; else resultsEl.innerHTML += html;
    return data.departures.length;
  } catch (e) { return 0; }
}
function depCard(d) {
  const when = d.inMin <= 0 ? "now" : `in ${d.inMin} min`;
  const tw = d.toward === true ? `<span class="tag tag-rec">✓ toward dest</span>` : "";
  return `<div class="card dep">
    <div class="top"><div class="chips"><span class="chip c-bus">#${d.route}</span>${tw}</div>
      <div class="eta">${when}<small>${d.dep}</small></div></div>
    <div class="meta">→ ${d.headsign || ""}</div>
    <div class="leg">🚏 <span>${d.stop.name} · ~${d.walkMin} min walk</span></div></div>`;
}

function itinCard(it, i) {
  const chips = [];
  for (const leg of it.legs) {
    if (leg.type === "ride") chips.push(`<span class="chip c-bus">#${leg.route}</span>`);
    else if (chips.length) chips.push(`<span class="chip c-walk">🚶</span>`);
  }
  const tags = (it.recommended ? `<span class="tag tag-rec">Fastest</span>` : "") +
    (it.isIntercept ? `<span class="tag tag-smart">⚡ Smart</span>` : "") +
    (it.hasLive ? `<span class="tag tag-live">● live</span>` : "");
  const chain = chips.join(`<span class="c-arrow">›</span>`) || `<span class="chip c-walk">🚶 walk</span>`;
  const detail = it.legs.map(legHtml).join("") + `<div class="leg">🏁 <span>walk to destination — <b>arrive ${it.arrive}</b></span></div>`;
  const leave = it.depart ? `<span class="meta">leave ${it.depart}</span> · ` : "";
  const eta = it.hasLive && it.liveArrive
    ? `${it.liveArrive}<small>live arrive</small>`
    : `${it.arrive}<small>arrive</small>`;
  return `<div class="card ${it.isIntercept ? "smart" : ""}" data-i="${i}">
    <div class="top"><div class="chips">${chain} ${tags}</div><div class="eta">${eta}</div></div>
    <div class="meta">${leave}${it.transfers} transfer${it.transfers === 1 ? "" : "s"}</div>
    <div class="detail">${detail}</div></div>`;
}
function drawWalk(from, to) {
  if (!from || !to || from[0] == null || to[0] == null) return;
  L.polyline([from, to], { color: "#5f6368", weight: 4, opacity: .7, dashArray: "1,8", lineCap: "round" }).addTo(routeLayer);
}
function selectItin(i) {
  markSel(i); routeLayer.clearLayers(); stopLiveTrack();
  const it = window._its[i];
  const rideLegs = it.legs.filter((l) => l.type === "ride");
  let prevPt = origin ? [origin.lat, origin.lon] : null;
  const bounds = [];
  it.legs.forEach((leg, idx) => {
    if (leg.type === "ride") {
      const c = RIDE_COLORS[idx % RIDE_COLORS.length];
      const line = (leg.shape && leg.shape.length > 1)
        ? leg.shape
        : (leg.from.lat != null && leg.to.lat != null ? [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]] : null);
      if (line) {
        // walk connector from previous point to this boarding stop
        drawWalk(prevPt, [leg.from.lat, leg.from.lon]);
        L.polyline(line, { color: "#fff", weight: 9, opacity: .9, lineCap: "round", lineJoin: "round" }).addTo(routeLayer);
        L.polyline(line, { color: c, weight: 6, opacity: .95, lineCap: "round", lineJoin: "round" }).addTo(routeLayer);
        routeBadge(midPoint(line), leg.route, c);
        line.forEach((pt) => bounds.push(pt));
      }
      stopDot(leg.from, c); stopDot(leg.to, c);
      prevPt = [leg.to.lat, leg.to.lon];
    } else {
      if (leg.to.lat != null) { stopDot(leg.to, "#9aa0a6"); }
    }
  });
  // final walk to destination
  if (dest) { drawWalk(prevPt, [dest.lat, dest.lon]); bounds.push([dest.lat, dest.lon]); }
  if (origin) bounds.push([origin.lat, origin.lon]);
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
}

// ===== manual live (advanced) =====
$("liveBtn").onclick = async () => {
  if (!need()) return;
  const target = $("target").value.trim();
  if (!target) return toast("Enter a target route");
  resultsEl.innerHTML = ""; clearMap();
  setStatus(`Fetching live #${target}…`, true);
  try {
    const data = await (await fetch("/api/live", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oLat: origin.lat, oLon: origin.lon, dLat: dest.lat, dLon: dest.lon, target }),
    })).json();
    if (data.error) return setStatus("⚠️ " + data.error);
    setStatus(`${data.count} live #${target} · ${data.time}`);
    if (!data.vehicles.length) { resultsEl.innerHTML = banner("none", `No live #${target} running right now.`); return; }
    let html = "";
    for (const v of data.vehicles) {
      const smart = v.verdict === "rescue" || v.verdict === "earlier";
      let txt = v.verdict === "rescue" ? "🎯 You'd miss it on foot — connector catches it!" :
        v.verdict === "earlier" ? "Connector lets you board earlier." :
        v.verdict === "walkok" ? "You can catch this on foot." : "Can't catch this one.";
      html += `<div class="card ${smart ? "smart" : ""}">
        <div class="top"><div class="chips"><span class="chip c-bus">#${target}</span>${v.servesDest ? '<span class="tag tag-rec">serves dest</span>' : ""}</div></div>
        ${v.walk ? `<div class="leg">🚶 <span>Walk: board <b>${v.walk.stop.name}</b> — you ${v.walk.you}, bus ${v.walk.bus}</span></div>` : `<div class="leg">🚶 <span>Walk: would miss it</span></div>`}
        ${v.connector ? `<div class="leg">🔗 <span>${v.connector.via}: board <b>${v.connector.stop.name}</b> — you ${v.connector.you}, bus ${v.connector.bus}</span></div>` : `<div class="leg">🔗 <span>No connector in time</span></div>`}
        <div class="meta">${txt}</div></div>`;
      if (v.lat != null) L.marker([v.lat, v.lon], { icon: busIcon(v.bearing) }).bindPopup(`#${target} bus`).addTo(busLayer);
      if (v.connector && v.connector.stop.lat != null) stopDot(v.connector.stop, "#1e8e3e");
      if (v.walk && v.walk.stop.lat != null) stopDot(v.walk.stop, "#f29900");
    }
    resultsEl.innerHTML = html;
  } catch (e) { setStatus("⚠️ " + e.message); }
};

// ---- shared helpers ----
function banner(kind, text) { return `<div class="banner ban-${kind}">${text}</div>`; }
function bindCards(fn) { document.querySelectorAll(".card").forEach((el) => { if (el.dataset.i != null) el.onclick = () => fn(+el.dataset.i); }); }
function markSel(i) { document.querySelectorAll(".card").forEach((el) => el.classList.toggle("sel", +el.dataset.i === i)); }
