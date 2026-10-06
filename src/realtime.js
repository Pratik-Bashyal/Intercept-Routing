// GTFS-Realtime client for TransLink (v3). Needs a free API key from
// https://developer.translink.ca . Set it via env var TRANSLINK_API_KEY
// or a .env file (KEY=value) in the project root.
//
// Endpoints:
//   positions:   https://gtfsapi.translink.ca/v3/gtfsposition?apikey=KEY
//   tripupdates: https://gtfsapi.translink.ca/v3/gtfsrealtime?apikey=KEY
//   alerts:      https://gtfsapi.translink.ca/v3/gtfsalerts?apikey=KEY
const fs = require("fs");
const path = require("path");
const GtfsRt = require("gtfs-realtime-bindings").transit_realtime;

function loadKey() {
  if (process.env.TRANSLINK_API_KEY) return process.env.TRANSLINK_API_KEY.trim();
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(TRANSLINK_API_KEY|KEY|apikey)\s*=\s*(.+?)\s*$/i);
      if (m) return m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return null;
}

const BASE = "https://gtfsapi.translink.ca/v3";

async function fetchFeed(kind) {
  const key = loadKey();
  if (!key) throw new Error("No API key. Set TRANSLINK_API_KEY env var or add KEY=... to .env");
  const url = `${BASE}/${kind}?apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${kind} HTTP ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return GtfsRt.FeedMessage.decode(buf);
}

// Live vehicle positions -> [{tripId, routeId, lat, lon, bearing, stopId, ts}]
async function vehiclePositions() {
  const feed = await fetchFeed("gtfsposition");
  const out = [];
  for (const e of feed.entity) {
    if (!e.vehicle) continue;
    const v = e.vehicle;
    out.push({
      tripId: v.trip && v.trip.tripId,
      routeId: v.trip && v.trip.routeId,
      lat: v.position && v.position.latitude,
      lon: v.position && v.position.longitude,
      bearing: v.position && v.position.bearing,
      stopId: v.stopId,
      currentStopSequence: v.currentStopSequence != null ? Number(v.currentStopSequence) : null,
      ts: v.timestamp ? Number(v.timestamp) : null,
    });
  }
  return out;
}

// Predicted arrivals -> Map "tripId|stopId" -> predictedArrivalSec (today, seconds after midnight)
async function tripUpdates() {
  const feed = await fetchFeed("gtfsrealtime");
  const map = new Map();
  for (const e of feed.entity) {
    if (!e.tripUpdate) continue;
    const tripId = e.tripUpdate.trip && e.tripUpdate.trip.tripId;
    for (const stu of e.tripUpdate.stopTimeUpdate || []) {
      const t = (stu.arrival && stu.arrival.time) || (stu.departure && stu.departure.time);
      if (t == null) continue;
      const d = new Date(Number(t) * 1000);
      const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      map.set(`${tripId}|${stu.stopId}`, sec);
    }
  }
  return map;
}

module.exports = { loadKey, vehiclePositions, tripUpdates, fetchFeed };

// CLI self-test: node src/realtime.js
if (require.main === module) {
  (async () => {
    const key = loadKey();
    if (!key) { console.log("No API key found. Add it to .env (KEY=yourkey) or set TRANSLINK_API_KEY."); return; }
    console.log("Fetching live vehicle positions...");
    const v = await vehiclePositions();
    console.log(`Got ${v.length} vehicles. Sample:`, v.slice(0, 3));
    console.log("Fetching trip updates...");
    const t = await tripUpdates();
    console.log(`Got ${t.size} predicted stop arrivals.`);
  })().catch((e) => console.error("ERROR:", e.message));
}
