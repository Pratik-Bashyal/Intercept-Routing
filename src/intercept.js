// Intercept planner (prototype) — RAPTOR-lite, up to 2 vehicle legs + foot transfers.
// Finds "chase-and-intercept" journeys: ride a connector to a downstream junction
// on the target route and board the target bus there.
//
// Schedule-based (static GTFS). Live GTFS-RT confidence is Phase 2.
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "data", "gtfs.db");

// ---- tunables ----
const WALK_SPEED = 1.3;          // m/s (~4.7 km/h)
const ORIGIN_RADIUS = 600;       // m: stops you can walk to from origin
const DEST_RADIUS = 600;         // m: stops that count as "at destination"
const TRANSFER_RADIUS = 250;     // m: walk between nearby stops (junction transfer)
const BOARD_BUFFER = 60;         // s: time to actually board after arriving ready
const MAX_WAIT = 90 * 60;        // s: ignore trips departing more than this after ready
const MAX_ROUNDS = 2;            // vehicle legs

function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR;
  const la1 = aLat * toR, la2 = bLat * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const walkTime = (m) => Math.round(m / WALK_SPEED);
const hhmm = (s) => {
  if (s == null) return "--:--";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return String(h % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0");
};

class Planner {
  constructor() {
    this.db = new Database(DB_PATH, { readonly: true });
    this.stops = this.db.prepare("SELECT stop_id, stop_code, stop_name, lat, lon FROM stops WHERE lat IS NOT NULL").all();
    this.stopById = new Map(this.stops.map((s) => [s.stop_id, s]));
    // spatial grid (~ 0.004 deg buckets ≈ 300-440m) for neighbor lookups
    this.cell = 0.004;
    this.grid = new Map();
    for (const s of this.stops) {
      const k = this._cellKey(s.lat, s.lon);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(s);
    }
  }
  _cellKey(lat, lon) { return Math.floor(lat / this.cell) + ":" + Math.floor(lon / this.cell); }
  stopsWithin(lat, lon, radius) {
    const out = [];
    const cLat = Math.floor(lat / this.cell), cLon = Math.floor(lon / this.cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = this.grid.get((cLat + i) + ":" + (cLon + j));
      if (!arr) continue;
      for (const s of arr) {
        const d = haversine(lat, lon, s.lat, s.lon);
        if (d <= radius) out.push({ stop: s, dist: d });
      }
    }
    return out;
  }

  activeServiceIds(dateStr) {
    // dateStr = YYYYMMDD
    const y = +dateStr.slice(0, 4), m = +dateStr.slice(4, 6), d = +dateStr.slice(6, 8);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
    const cols = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const col = cols[dow];
    const active = new Set();
    const base = this.db.prepare(
      `SELECT service_id FROM calendar WHERE ${col}=1 AND start_date<=? AND end_date>=?`
    ).all(dateStr, dateStr);
    for (const r of base) active.add(r.service_id);
    const exc = this.db.prepare("SELECT service_id, exception_type FROM calendar_dates WHERE date=?").all(dateStr);
    for (const e of exc) { if (e.exception_type === 1) active.add(e.service_id); else if (e.exception_type === 2) active.delete(e.service_id); }
    return active;
  }

  downstream(tripId, afterSeq) {
    return this.db.prepare(
      "SELECT stop_id, arr_sec, stop_seq FROM stop_times WHERE trip_id=? AND stop_seq>? ORDER BY stop_seq"
    ).all(tripId, afterSeq);
  }

  routeShort(routeId) {
    const r = this.db.prepare("SELECT short_name, long_name FROM routes WHERE route_id=?").get(routeId);
    if (!r) return routeId;
    return (r.short_name && r.short_name.trim()) ? r.short_name : (r.long_name || routeId);
  }

  routeIdByShort(short) {
    let r = this.db.prepare("SELECT route_id FROM routes WHERE short_name=?").get(short);
    if (!r) r = this.db.prepare("SELECT route_id FROM routes WHERE long_name=?").get(short);
    return r ? r.route_id : null;
  }

  tripStops(tripId) {
    return this.db.prepare(
      "SELECT stop_id, stop_seq, arr_sec FROM stop_times WHERE trip_id=? ORDER BY stop_seq"
    ).all(tripId);
  }

  // Core RAPTOR search from origin; returns per-round earliest-arrival labels for ALL stops.
  search(origin, dateStr, startSec) {
    const activeSet = this.activeServiceIds(dateStr);
    const activeTrips = new Set(
      this.db.prepare(
        `SELECT trip_id FROM trips WHERE service_id IN (${[...activeSet].map(() => "?").join(",")})`
      ).all(...activeSet).map((r) => r.trip_id)
    );

    // RAPTOR per-round labels: tau[k][stop] = earliest arrival using <= k trips.
    const K = MAX_ROUNDS;
    const tau = Array.from({ length: K + 1 }, () => new Map());
    const parent = Array.from({ length: K + 1 }, () => new Map());

    const setLabel = (k, stopId, arr, par) => {
      const cur = tau[k].get(stopId);
      if (cur == null || arr < cur) { tau[k].set(stopId, arr); parent[k].set(stopId, par); return true; }
      return false;
    };

    // Round 0: walk from origin, then foot transfers.
    for (const { stop, dist } of this.stopsWithin(origin.lat, origin.lon, ORIGIN_RADIUS)) {
      setLabel(0, stop.stop_id, startSec + walkTime(dist), { type: "walk-origin", dist });
    }
    this._footRelaxK(tau, parent, 0, setLabel, new Set(tau[0].keys()));

    for (let k = 1; k <= K; k++) {
      // Carry forward: <=k includes <=k-1.
      for (const [sId, arr] of tau[k - 1]) {
        if (setLabel(k, sId, arr, parent[k - 1].get(sId))) { /* carried */ }
      }
      // Board the k-th trip from any stop reachable with k-1 trips.
      const ridden = new Set();
      for (const [sId, arrPrev] of tau[k - 1]) {
        const ready = arrPrev + BOARD_BUFFER;
        const trips = this.earliestTripsAtActive(sId, ready, activeTrips);
        for (const t of trips.values()) {
          for (const u of this.downstream(t.trip_id, t.stop_seq)) {
            if (u.arr_sec == null) continue;
            if (setLabel(k, u.stop_id, u.arr_sec, {
              type: "ride", route_id: t.route_id, trip_id: t.trip_id, from: sId, dep: t.dep_sec,
            })) ridden.add(u.stop_id);
          }
        }
      }
      // Foot transfers after riding (same round).
      this._footRelaxK(tau, parent, k, setLabel, ridden);
    }
    return { tau, parent, K };
  }

  plan(origin, dest, dateStr, startSec) {
    const { tau, parent, K } = this.search(origin, dateStr, startSec);

    // Candidates near destination, per round.
    const candByK = [];
    for (let k = 0; k <= K; k++) {
      const cands = [];
      for (const { stop, dist } of this.stopsWithin(dest.lat, dest.lon, DEST_RADIUS)) {
        const arr = tau[k].get(stop.stop_id);
        if (arr == null) continue;
        cands.push({ stopId: stop.stop_id, arrive: arr + walkTime(dist), walkDist: dist, k });
      }
      cands.sort((a, b) => a.arrive - b.arrive);
      candByK.push(cands);
    }
    return { tau, parent, candByK, startSec };
  }

  // like earliestTripsAt but filters by active trip set
  earliestTripsAtActive(stopId, ready, activeTrips) {
    const rows = this.db.prepare(`
      SELECT st.trip_id, st.stop_seq, st.dep_sec, t.route_id, t.direction_id
      FROM stop_times st JOIN trips t ON t.trip_id = st.trip_id
      WHERE st.stop_id = ? AND st.dep_sec >= ? AND st.dep_sec <= ?
      ORDER BY st.dep_sec
    `).all(stopId, ready, ready + MAX_WAIT);
    const best = new Map();
    for (const r of rows) {
      if (!activeTrips.has(r.trip_id)) continue;
      const key = r.route_id + "|" + r.direction_id;
      if (!best.has(key)) best.set(key, r);
    }
    return best;
  }

  _footRelaxK(tau, parent, k, setLabel, fromStops) {
    // Relax foot transfers within round k from the given seed stops (one hop).
    for (const sId of fromStops) {
      const base = tau[k].get(sId);
      if (base == null) continue;
      const s = this.stopById.get(sId);
      for (const { stop, dist } of this.stopsWithin(s.lat, s.lon, TRANSFER_RADIUS)) {
        if (stop.stop_id === sId) continue;
        setLabel(k, stop.stop_id, base + walkTime(dist), { type: "walk", from: sId, dist, sameRound: k });
      }
    }
  }

  reconstruct(tau, parent, k, stopId) {
    const legs = [];
    let cur = stopId;
    let kk = k;
    let guard = 0;
    while (cur && guard++ < 50) {
      const par = parent[kk].get(cur);
      const arr = tau[kk].get(cur);
      if (!par) break;
      if (par.type === "walk-origin") { legs.push({ type: "walk-origin", to: cur, arr, dist: par.dist }); break; }
      if (par.type === "walk") {
        legs.push({ type: "walk", from: par.from, to: cur, arr, dist: par.dist });
        cur = par.from; // same round
        continue;
      }
      if (par.type === "ride") {
        legs.push({ type: "ride", route: this.routeShort(par.route_id), route_id: par.route_id, trip_id: par.trip_id, from: par.from, to: cur, dep: par.dep, arr });
        cur = par.from; kk = kk - 1; // a ride consumes one round
        continue;
      }
      break;
    }
    return legs.reverse();
  }

  describe(tau, parent, cand) {
    const legs = this.reconstruct(tau, parent, cand.k, cand.stopId);
    const nm = (id) => { const s = this.stopById.get(id); return s ? `${s.stop_name} (${s.stop_code})` : id; };
    const lines = [];
    for (const leg of legs) {
      if (leg.type === "walk-origin") lines.push(`  🚶 Walk ${Math.round(leg.dist)}m to ${nm(leg.to)} — arrive ${hhmm(leg.arr)}`);
      else if (leg.type === "walk") lines.push(`  🚶 Walk ${Math.round(leg.dist)}m to ${nm(leg.to)} — arrive ${hhmm(leg.arr)}`);
      else lines.push(`  🚌 Bus #${leg.route}: board ${nm(leg.from)} @ ${hhmm(leg.dep)} → ${nm(leg.to)} @ ${hhmm(leg.arr)}`);
    }
    lines.push(`  🚶 Walk ${Math.round(cand.walkDist)}m to destination — ARRIVE ${hhmm(cand.arrive)}`);
    const rides = legs.filter((l) => l.type === "ride").map((l) => "#" + l.route);
    return { text: lines.join("\n"), arrive: cand.arrive, rides, legs };
  }
}

module.exports = { Planner, hhmm, haversine };
