// Web server for the Bus Intercept Planner.
// Built-in http only (no extra deps). Reuses the Planner + GTFS-RT engine.
//
// Routes:
//   GET  /                      -> public/index.html (map UI)
//   GET  /api/routes            -> all routes [{short,long,type}]
//   POST /api/plan              -> schedule plan: {direct, intercept, verdict}
//   POST /api/live              -> live intercept analysis for a target route
//   GET  /api/vehicles?target=  -> live vehicle positions (for the map)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Planner, hhmm } = require("./intercept");
const { vehiclePositions, tripUpdates } = require("./realtime");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "..", "public");
const BOARD_BUFFER = 60;

// One shared planner (loads all stops/grid once).
const p = new Planner();

// route_type -> label/icon
const TYPES = { 0: "Tram", 1: "SkyTrain", 2: "WCE", 3: "Bus", 4: "SeaBus" };

function nowDateSec() {
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  return { dateStr, sec };
}

// GTFS "service day" aware clock. After midnight (before ~4am), tonight's trips
// belong to the PREVIOUS calendar day with times encoded as 24h+ (e.g. 01:53 = 92000s).
// We align to that frame so live comparisons work past midnight.
const SERVICE_DAY_END_HOUR = 4;
function serviceNow() {
  const d = new Date();
  const rollover = d.getHours() < SERVICE_DAY_END_HOUR;
  const base = new Date(d);
  if (rollover) base.setDate(base.getDate() - 1);
  const dateStr = `${base.getFullYear()}${String(base.getMonth() + 1).padStart(2, "0")}${String(base.getDate()).padStart(2, "0")}`;
  let sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  if (rollover) sec += 86400;
  return { dateStr, sec, rollover, liveOffset: rollover ? 86400 : 0 };
}

function stopInfo(id) {
  const s = p.stopById.get(id);
  if (!s) return { id, name: id, code: null, lat: null, lon: null };
  return { id, name: s.stop_name, code: s.stop_code, lat: s.lat, lon: s.lon };
}

// Road-following geometry for a bus leg: find a trip of this route serving
// both stops in order, take its shape, and slice it between the two stops.
const _shapeCache = new Map();
function legShape(routeId, fromId, toId) {
  const key = routeId + "|" + fromId + "|" + toId;
  if (_shapeCache.has(key)) return _shapeCache.get(key);
  let result = null;
  try {
    const t = p.db.prepare(`
      SELECT t.shape_id FROM trips t
      JOIN stop_times s1 ON s1.trip_id = t.trip_id AND s1.stop_id = ?
      JOIN stop_times s2 ON s2.trip_id = t.trip_id AND s2.stop_id = ?
      WHERE t.route_id = ? AND s1.stop_seq < s2.stop_seq AND t.shape_id IS NOT NULL
      LIMIT 1
    `).get(fromId, toId, routeId);
    if (t && t.shape_id) {
      const pts = p.db.prepare("SELECT lat, lon FROM shapes WHERE shape_id = ? ORDER BY seq").all(t.shape_id);
      if (pts.length > 1) {
        const a = stopInfo(fromId), b = stopInfo(toId);
        const near = (lat, lon) => {
          let bi = 0, bd = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const dx = pts[i].lat - lat, dy = pts[i].lon - lon, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; bi = i; }
          }
          return bi;
        };
        if (a.lat != null && b.lat != null) {
          let i1 = near(a.lat, a.lon), i2 = near(b.lat, b.lon);
          if (i1 > i2) { const t2 = i1; i1 = i2; i2 = t2; }
          result = pts.slice(i1, i2 + 1).map((pt) => [pt.lat, pt.lon]);
          if (result.length < 2) result = null;
        }
      }
    }
  } catch (e) { result = null; }
  _shapeCache.set(key, result);
  return result;
}

// Exact geometry for a specific trip between two of its stops.
function tripShape(tripId, fromId, toId) {
  try {
    const t = p.db.prepare("SELECT shape_id FROM trips WHERE trip_id = ?").get(tripId);
    if (!t || !t.shape_id) return null;
    const pts = p.db.prepare("SELECT lat, lon FROM shapes WHERE shape_id = ? ORDER BY seq").all(t.shape_id);
    if (pts.length < 2) return null;
    const a = stopInfo(fromId), b = stopInfo(toId);
    if (a.lat == null || b.lat == null) return null;
    const near = (lat, lon) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].lat - lat, dy = pts[i].lon - lon, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = i; }
      }
      return bi;
    };
    let i1 = near(a.lat, a.lon), i2 = near(b.lat, b.lon);
    if (i1 > i2) { const t2 = i1; i1 = i2; i2 = t2; }
    const slice = pts.slice(i1, i2 + 1).map((pt) => [pt.lat, pt.lon]);
    return slice.length > 1 ? slice : null;
  } catch (e) { return null; }
}

// Convert a describe() result into map-friendly JSON.
function describeToJson(d) {
  const legs = d.legs.map((leg) => {
    if (leg.type === "ride") {
      return { type: "ride", route: leg.route, trip_id: leg.trip_id, from: stopInfo(leg.from), to: stopInfo(leg.to), dep: hhmm(leg.dep), arr: hhmm(leg.arr), depSec: leg.dep, arrSec: leg.arr, shape: leg.route_id ? legShape(leg.route_id, leg.from, leg.to) : null };
    }
    if (leg.type === "walk-origin") return { type: "walk-origin", to: stopInfo(leg.to), dist: Math.round(leg.dist), arr: hhmm(leg.arr) };
    return { type: "walk", from: stopInfo(leg.from), to: stopInfo(leg.to), dist: Math.round(leg.dist), arr: hhmm(leg.arr) };
  });
  return { arrive: hhmm(d.arrive), arriveSec: d.arrive, rides: d.rides, legs };
}

function getRoutes() {
  const rows = p.db.prepare("SELECT short_name, long_name, route_type FROM routes ORDER BY route_type, short_name").all();
  return rows.map((r) => ({ short: r.short_name, long: r.long_name, type: r.route_type, typeName: TYPES[r.route_type] || String(r.route_type) }));
}

async function planJourney({ oLat, oLon, dLat, dLon, dateStr, startSec, liveOffset = 0 }) {
  const { tau, parent, candByK } = p.plan({ lat: oLat, lon: oLon }, { lat: dLat, lon: dLon }, dateStr, startSec);
  const best1 = candByK[1] && candByK[1][0];
  const best2 = candByK[2] && candByK[2][0];
  const direct = best1 ? describeToJson(p.describe(tau, parent, best1)) : null;
  const intercept = best2 ? describeToJson(p.describe(tau, parent, best2)) : null;

  // Google/Transit-style: several distinct itineraries ranked by arrival.
  const itineraries = planOptions({ oLat, oLon, dLat, dLon, dateStr, startSec });

  // Fold in live GTFS-RT: annotate each ride leg with live times/delay.
  try {
    const updates = await tripUpdates();
    for (const it of itineraries) annotateLive(it, updates, liveOffset);
  } catch (e) { /* schedule-only if feed unavailable */ }

  // "You can beat this by intercepting": compare the fastest scheduled option
  // against the best live connector-chase arriving now.
  let interceptHint = null;
  try {
    const fastest = itineraries.reduce((m, it) => {
      const a = it.liveArriveSec || it.arriveSec;
      return a < m.a ? { a, it } : m;
    }, { a: Infinity, it: null });
    if (fastest.it) {
      const live = await suggestLive({ oLat, oLon, dLat, dLon });
      const chase = (live.buses || []).find((b) => b.verdict === "rescue" || b.verdict === "earlier");
      if (chase && chase.destArriveSec < fastest.a - 120) {
        interceptHint = {
          route: chase.route,
          via: chase.via,
          board: chase.board.stop,
          arrive: chase.destArrive,
          saveMin: Math.round((fastest.a - chase.destArriveSec) / 60),
          text: `⚡ Catch ${chase.via ? chase.via + "→" : ""}#${chase.route} now (board ${chase.board.stop.name}) — arrive ${chase.destArrive}, ${Math.round((fastest.a - chase.destArriveSec) / 60)} min sooner than any scheduled plan.`,
        };
      }
    }
  } catch (e) { /* intercept hint is best-effort */ }

  let verdict = { kind: "none", text: "No route found." };
  if (direct && intercept) {
    const save = direct.arriveSec - intercept.arriveSec;
    if (intercept.rides.length >= 2 && save > 0) {
      verdict = { kind: "intercept", saveMin: Math.round(save / 60), text: `Intercept (${intercept.rides.join("+")}) arrives ${intercept.arrive} vs direct ${direct.arrive} — saves ${Math.round(save / 60)} min.` };
    } else if (save > 0) {
      verdict = { kind: "faster", text: `Fastest arrives ${intercept.arrive} (${intercept.rides.join("+")}).` };
    } else {
      verdict = { kind: "direct", text: `Direct is fastest here (${direct.arrive}). Intercept helps most when you'd miss the direct bus.` };
    }
  } else if (direct) {
    verdict = { kind: "direct", text: `Only a direct route found (arrive ${direct.arrive}).` };
  }
  return { direct, intercept, itineraries, verdict, interceptHint };
}

// Enumerate successive departure "waves" (leave-now, the next one, the one after…)
// like Google Maps, by re-planning just after each option's first boarding time.
function planOptions({ oLat, oLon, dLat, dLon, dateStr, startSec }, n = 6) {
  const O = { lat: oLat, lon: oLon }, D = { lat: dLat, lon: dLon };
  const opts = [];
  const sigs = new Set();
  let cur = startSec;
  let guard = 0;
  while (opts.length < n && guard++ < n * 3) {
    const { tau, parent, candByK } = p.plan(O, D, dateStr, cur);
    const waveCands = [];
    for (let k = 0; k < candByK.length; k++) for (const c of candByK[k]) waveCands.push(c);
    if (!waveCands.length) break;

    let earliestDep = Infinity;
    const added = [];
    for (const c of waveCands) {
      const it = describeToJson(p.describe(tau, parent, c));
      const rides = it.legs.filter((l) => l.type === "ride");
      if (!rides.length) continue;
      const firstDep = rides[0].depSec;
      if (firstDep != null && firstDep < earliestDep) earliestDep = firstDep;
      const sig = rides.map((l) => `${l.route}@${l.from.id}`).join(">");
      if (sigs.has(sig)) continue;
      it.transfers = Math.max(0, rides.length - 1);
      it.isIntercept = rides.length >= 2;
      it.departSec = firstDep;
      it.depart = hhmm(firstDep);
      it.rideCount = rides.length;
      sigs.add(sig);
      added.push(it);
    }
    for (const it of added) opts.push(it);
    if (!isFinite(earliestDep)) break;
    cur = earliestDep + 60; // advance just past this wave's first departure
  }

  opts.sort((a, b) => (a.departSec - b.departSec) || (a.arriveSec - b.arriveSec));
  const fastest = opts.reduce((m, it) => Math.min(m, it.arriveSec), Infinity);
  for (const it of opts) it.recommended = it.arriveSec === fastest;
  return opts.slice(0, n);
}

// Annotate a plan option with live GTFS-RT times/delays per ride leg.
function annotateLive(it, updates, liveOffset) {
  let anyLive = false, lastLiveArr = null, maxDelay = 0;
  for (const leg of it.legs) {
    if (leg.type !== "ride" || !leg.trip_id) continue;
    const du = updates.get(`${leg.trip_id}|${leg.from.id}`);
    const au = updates.get(`${leg.trip_id}|${leg.to.id}`);
    const liveDep = du != null ? du + liveOffset : null;
    const liveArr = au != null ? au + liveOffset : null;
    if (liveDep != null || liveArr != null) {
      anyLive = true;
      const delay = liveDep != null && leg.depSec != null ? liveDep - leg.depSec
        : (liveArr != null && leg.arrSec != null ? liveArr - leg.arrSec : 0);
      leg.live = {
        dep: liveDep != null ? hhmm(liveDep) : null,
        arr: liveArr != null ? hhmm(liveArr) : null,
        delayMin: Math.round(delay / 60),
      };
      if (liveArr != null) lastLiveArr = liveArr;
      if (Math.abs(delay) > Math.abs(maxDelay)) maxDelay = delay;
    }
  }
  it.hasLive = anyLive;
  if (anyLive) {
    it.liveDelayMin = Math.round(maxDelay / 60);
    if (lastLiveArr != null) { it.liveArriveSec = lastLiveArr; it.liveArrive = hhmm(lastLiveArr); }
  }
  return it;
}

// Collect the best distinct journeys across rounds, ranked by arrival time.
function topItineraries(tau, parent, candByK, limit = 5) {
  const seen = new Map(); // signature -> itinerary
  for (let k = 0; k < candByK.length; k++) {
    for (const cand of candByK[k]) {
      const it = describeToJson(p.describe(tau, parent, cand));
      const rides = it.legs.filter((l) => l.type === "ride");
      if (k > 0 && rides.length === 0) continue; // require transit for k>=1 lists
      const sig = rides.map((l) => `${l.route}@${l.from.id}`).join(">") || "walk-only";
      const cur = seen.get(sig);
      if (!cur || it.arriveSec < cur.arriveSec) {
        it.transfers = Math.max(0, rides.length - 1);
        it.isIntercept = rides.length >= 2;
        seen.set(sig, it);
      }
    }
  }
  const all = [...seen.values()].sort((a, b) => a.arriveSec - b.arriveSec);
  const fastest = all.length ? all[0].arriveSec : null;
  for (const it of all) it.recommended = it.arriveSec === fastest;
  return all.slice(0, limit);
}

// Geocode an address/place within Metro Vancouver via Nominatim (OSM).
async function geocode(q) {
  if (!q || !q.trim()) return [];
  const params = new URLSearchParams({
    q: q.trim(), format: "json", addressdetails: "1", limit: "6",
    countrycodes: "ca", viewbox: "-123.30,49.35,-122.50,49.00", bounded: "1",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": "transit-intercept-planner/1.0 (FDU student project)" },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r) => ({ label: r.display_name, lat: +r.lat, lon: +r.lon }));
}

async function liveIntercept({ oLat, oLon, dLat, dLon, target }) {
  const targetRouteId = p.routeIdByShort(target);
  if (!targetRouteId) return { error: `Route ${target} not found.` };
  const { dateStr, sec, liveOffset } = serviceNow();
  const { tau, parent } = p.search({ lat: oLat, lon: oLon }, dateStr, sec);
  const reachWalk = tau[0], reachConn = tau[1];
  const destStops = new Map(p.stopsWithin(dLat, dLon, 600).map((x) => [x.stop.stop_id, x.dist]));

  const [vehicles, updates] = await Promise.all([vehiclePositions(), tripUpdates()]);
  const mine = vehicles.filter((v) => v.routeId === targetRouteId && v.tripId);

  const predArr = (tripId, stopId, schedArr) => {
    const v = updates.get(`${tripId}|${stopId}`);
    return v != null ? { t: v + liveOffset, live: true } : { t: schedArr, live: false };
  };

  const results = [];
  for (const v of mine) {
    const stops = p.tripStops(v.tripId);
    if (stops.length === 0) continue;
    const curSeq = v.currentStopSequence != null ? v.currentStopSequence : -1;
    const upcoming = stops.filter((s) => s.stop_seq >= curSeq);
    const servesDest = upcoming.some((s) => destStops.has(s.stop_id));

    let walkBoard = null, connBoard = null;
    for (const s of upcoming) {
      const { t: busT, live } = predArr(v.tripId, s.stop_id, s.arr_sec);
      if (busT == null) continue;
      const rw = reachWalk.get(s.stop_id), rc = reachConn.get(s.stop_id);
      if (!walkBoard && rw != null && rw + BOARD_BUFFER <= busT) walkBoard = { s, you: rw, bus: busT, live };
      if (!connBoard && rc != null && rc + BOARD_BUFFER <= busT) connBoard = { s, you: rc, bus: busT, live };
      if (walkBoard && connBoard) break;
    }

    let verdict = "none", via = null;
    if (connBoard) {
      const legs = p.reconstruct(tau, parent, 1, connBoard.s.stop_id);
      via = legs.filter((l) => l.type === "ride").map((l) => "#" + l.route).join(">") || "walk";
    }
    if (connBoard && !walkBoard) verdict = "rescue";
    else if (connBoard && walkBoard && connBoard.s.stop_seq < walkBoard.s.stop_seq) verdict = "earlier";
    else if (walkBoard) verdict = "walkok";

    results.push({
      tripId: v.tripId,
      lat: v.lat, lon: v.lon, bearing: v.bearing != null ? v.bearing : null,
      seq: curSeq, servesDest,
      walk: walkBoard ? { stop: stopInfo(walkBoard.s.stop_id), you: hhmm(walkBoard.you), bus: hhmm(walkBoard.bus), live: walkBoard.live } : null,
      connector: connBoard ? { stop: stopInfo(connBoard.s.stop_id), via, you: hhmm(connBoard.you), bus: hhmm(connBoard.bus), live: connBoard.live } : null,
      verdict,
    });
  }
  return { target, time: hhmm(sec), count: mine.length, vehicles: results };
}

async function liveVehicles(target) {
  const targetRouteId = target ? p.routeIdByShort(target) : null;
  const vehicles = await vehiclePositions();
  const list = targetRouteId ? vehicles.filter((v) => v.routeId === targetRouteId) : vehicles;
  return list.map((v) => ({ tripId: v.tripId, routeId: v.routeId, lat: v.lat, lon: v.lon, bearing: v.bearing, seq: v.currentStopSequence }));
}

// Auto-discover ALL live buses heading toward the destination that the user can
// still catch — by walking or by an intercept — without naming a route.
async function suggestLive({ oLat, oLon, dLat, dLon }) {
  const { dateStr, sec, liveOffset } = serviceNow();
  const { tau, parent } = p.search({ lat: oLat, lon: oLon }, dateStr, sec);
  const reachWalk = tau[0], reachConn = tau[1];
  const destStops = new Map(p.stopsWithin(dLat, dLon, 600).map((x) => [x.stop.stop_id, x.dist]));

  const [vehicles, updates] = await Promise.all([vehiclePositions(), tripUpdates()]);
  const predArr = (tripId, stopId, schedArr) => {
    const v = updates.get(`${tripId}|${stopId}`);
    return v != null ? { t: v + liveOffset, live: true } : { t: schedArr, live: false };
  };

  const out = [];
  for (const v of vehicles) {
    if (!v.tripId) continue;
    const stops = p.tripStops(v.tripId);
    if (!stops.length) continue;
    const curSeq = v.currentStopSequence != null ? v.currentStopSequence : -1;
    const upcoming = stops.filter((s) => s.stop_seq >= curSeq);

    // Must still be heading toward the destination.
    const destLeg = upcoming.find((s) => destStops.has(s.stop_id));
    if (!destLeg) continue;
    const destWalk = destStops.get(destLeg.stop_id) || 0;
    const { t: destT } = predArr(v.tripId, destLeg.stop_id, destLeg.arr_sec);
    if (destT == null) continue;

    // Earliest boarding stop (before it reaches dest) reachable on foot vs via connector.
    let walkBoard = null, connBoard = null;
    for (const s of upcoming) {
      if (s.stop_seq >= destLeg.stop_seq) break; // must board before alighting
      const { t: busT, live } = predArr(v.tripId, s.stop_id, s.arr_sec);
      if (busT == null) continue;
      const rw = reachWalk.get(s.stop_id), rc = reachConn.get(s.stop_id);
      if (!walkBoard && rw != null && rw + BOARD_BUFFER <= busT) walkBoard = { s, you: rw, bus: busT, live };
      if (!connBoard && rc != null && rc + BOARD_BUFFER <= busT) connBoard = { s, you: rc, bus: busT, live };
      if (walkBoard && connBoard) break;
    }
    if (!walkBoard && !connBoard) continue; // can't catch this one at all

    let verdict = "walkok", via = null, board = walkBoard;
    if (connBoard) {
      const legs = p.reconstruct(tau, parent, 1, connBoard.s.stop_id);
      via = legs.filter((l) => l.type === "ride").map((l) => "#" + l.route).join(">") || "walk";
    }
    if (connBoard && !walkBoard) { verdict = "rescue"; board = connBoard; }
    else if (connBoard && walkBoard && connBoard.s.stop_seq < walkBoard.s.stop_seq) { verdict = "earlier"; board = connBoard; }

    out.push({
      tripId: v.tripId,
      route: p.routeShort(v.routeId),
      headsign: tripHeadsign(v.tripId),
      lat: v.lat, lon: v.lon, bearing: v.bearing != null ? v.bearing : null, seq: curSeq,
      verdict, via,
      board: { stop: stopInfo(board.s.stop_id), you: hhmm(board.you), bus: hhmm(board.bus), live: board.live },
      alight: stopInfo(destLeg.stop_id),
      shape: tripShape(v.tripId, board.s.stop_id, destLeg.stop_id),
      walk: walkBoard ? { stop: stopInfo(walkBoard.s.stop_id), you: hhmm(walkBoard.you), bus: hhmm(walkBoard.bus) } : null,
      connector: connBoard ? { stop: stopInfo(connBoard.s.stop_id), via, you: hhmm(connBoard.you), bus: hhmm(connBoard.bus) } : null,
      destArrive: hhmm(destT + walkTimeSec(destWalk)),
      destArriveSec: destT + walkTimeSec(destWalk),
    });
  }

  const rank = { rescue: 0, earlier: 1, walkok: 2 };
  out.sort((a, b) => (rank[a.verdict] - rank[b.verdict]) || (a.destArriveSec - b.destArriveSec));
  return { time: hhmm(sec), count: out.length, buses: out.slice(0, 15) };
}

// Next scheduled departures from stops near the origin — a "what's coming" board
// for a waiting rider (includes night buses, no trip-planning window cap).
function departuresBoard({ oLat, oLon, dLat, dLon }) {
  const { dateStr, sec } = serviceNow();
  const active = p.activeServiceIds(dateStr);
  if (!active.size) return { time: hhmm(sec), departures: [] };
  const activeTrips = new Set(
    p.db.prepare(`SELECT trip_id FROM trips WHERE service_id IN (${[...active].map(() => "?").join(",")})`)
      .all(...active).map((r) => r.trip_id)
  );

  const nearby = p.stopsWithin(oLat, oLon, 700);
  if (!nearby.length) return { time: hhmm(sec), departures: [] };
  const stopDist = new Map(nearby.map((x) => [x.stop.stop_id, x.dist]));
  const ids = [...stopDist.keys()];

  const destStops = (dLat != null && dLon != null)
    ? new Set(p.stopsWithin(dLat, dLon, 600).map((x) => x.stop.stop_id)) : null;

  const WINDOW = 3 * 3600; // look ahead up to 3h (covers sparse night gaps)
  const rows = p.db.prepare(`
    SELECT st.trip_id, st.stop_id, st.stop_seq, st.dep_sec, t.route_id, t.direction_id, t.headsign
    FROM stop_times st JOIN trips t ON t.trip_id = st.trip_id
    WHERE st.stop_id IN (${ids.map(() => "?").join(",")})
      AND st.dep_sec >= ? AND st.dep_sec <= ?
    ORDER BY st.dep_sec
  `).all(...ids, sec, sec + WINDOW);

  const bestByKey = new Map(); // route|direction -> first upcoming departure
  for (const r of rows) {
    if (!activeTrips.has(r.trip_id)) continue;
    const key = r.route_id + "|" + r.direction_id;
    if (bestByKey.has(key)) continue;
    let toward = null;
    if (destStops) {
      const ahead = p.db.prepare("SELECT stop_id FROM stop_times WHERE trip_id=? AND stop_seq>?").all(r.trip_id, r.stop_seq);
      toward = ahead.some((x) => destStops.has(x.stop_id));
    }
    bestByKey.set(key, {
      route: p.routeShort(r.route_id),
      headsign: r.headsign || "",
      stop: stopInfo(r.stop_id),
      walkMin: Math.round((stopDist.get(r.stop_id) || 0) / 1.3 / 60),
      dep: hhmm(r.dep_sec),
      inMin: Math.max(0, Math.round((r.dep_sec - sec) / 60)),
      toward,
    });
  }
  let departures = [...bestByKey.values()].sort((a, b) => a.inMin - b.inMin);
  if (destStops) departures.sort((a, b) => (Number(b.toward) - Number(a.toward)) || (a.inMin - b.inMin));
  return { time: hhmm(sec), departures: departures.slice(0, 20) };
}

const WALK_SPEED = 1.3;
const walkTimeSec = (m) => Math.round(m / WALK_SPEED);

function tripHeadsign(tripId) {
  const r = p.db.prepare("SELECT headsign FROM trips WHERE trip_id=?").get(tripId);
  return r && r.headsign ? r.headsign : "";
}

// ---- tiny http plumbing ----
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
function serveStatic(res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && u.pathname === "/api/routes") return sendJson(res, 200, getRoutes());
    if (req.method === "GET" && u.pathname === "/api/geocode") {
      const data = await geocode(u.searchParams.get("q"));
      return sendJson(res, 200, data);
    }
    if (req.method === "GET" && u.pathname === "/api/vehicles") {
      const data = await liveVehicles(u.searchParams.get("target"));
      return sendJson(res, 200, data);
    }
    if (req.method === "POST" && u.pathname === "/api/plan") {
      const b = await readBody(req);
      const sn = serviceNow();
      const out = await planJourney({
        oLat: +b.oLat, oLon: +b.oLon, dLat: +b.dLat, dLon: +b.dLon,
        dateStr: b.dateStr || sn.dateStr, startSec: b.startSec != null ? +b.startSec : sn.sec,
        liveOffset: sn.liveOffset || 0,
      });
      return sendJson(res, 200, out);
    }
    if (req.method === "POST" && u.pathname === "/api/live") {
      const b = await readBody(req);
      const out = await liveIntercept({ oLat: +b.oLat, oLon: +b.oLon, dLat: +b.dLat, dLon: +b.dLon, target: b.target });
      return sendJson(res, 200, out);
    }
    if (req.method === "POST" && u.pathname === "/api/suggest") {
      const b = await readBody(req);
      const out = await suggestLive({ oLat: +b.oLat, oLon: +b.oLon, dLat: +b.dLat, dLon: +b.dLon });
      return sendJson(res, 200, out);
    }
    if (req.method === "POST" && u.pathname === "/api/departures") {
      const b = await readBody(req);
      const out = departuresBoard({
        oLat: +b.oLat, oLon: +b.oLon,
        dLat: b.dLat != null && b.dLat !== "" ? +b.dLat : null,
        dLon: b.dLon != null && b.dLon !== "" ? +b.dLon : null,
      });
      return sendJson(res, 200, out);
    }
    if (req.method === "GET") return serveStatic(res, u.pathname);
    res.writeHead(405); res.end("method not allowed");
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Intercept web UI on http://localhost:${PORT}`));
