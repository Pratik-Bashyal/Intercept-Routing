// Explore: find stops of a route (representative trip), and find geographic
// junctions where a target route's stops are near a connector route's stops.
const path = require("path");
const Database = require("better-sqlite3");
const db = new Database(path.join(__dirname, "..", "data", "gtfs.db"), { readonly: true });

function routeId(shortName) {
  const r = db.prepare("SELECT route_id, long_name FROM routes WHERE short_name=?").get(shortName);
  return r;
}

// Get an ordered stop list for a representative trip (longest trip) of a route+direction.
function routeStops(shortName, direction) {
  const r = routeId(shortName);
  if (!r) return [];
  const trip = db.prepare(`
    SELECT t.trip_id, COUNT(*) n FROM trips t
    JOIN stop_times st ON st.trip_id = t.trip_id
    WHERE t.route_id = ? AND (? IS NULL OR t.direction_id = ?)
    GROUP BY t.trip_id ORDER BY n DESC LIMIT 1
  `).get(r.route_id, direction, direction);
  if (!trip) return [];
  return db.prepare(`
    SELECT st.stop_seq, s.stop_id, s.stop_code, s.stop_name, s.lat, s.lon
    FROM stop_times st JOIN stops s ON s.stop_id = st.stop_id
    WHERE st.trip_id = ? ORDER BY st.stop_seq
  `).all(trip.trip_id);
}

function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const la1 = a.lat * toR, la2 = b.lat * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const target = routeStops("026", null);
console.log(`\n#26 (${routeId("026").long_name}) representative trip: ${target.length} stops`);

for (const conn of ["041", "R4"]) {
  const r = routeId(conn);
  if (!r) { console.log(`\n${conn}: not found`); continue; }
  const cStops = routeStops(conn, null);
  console.log(`\n=== Junctions where #26 meets ${conn} (${r.long_name}) within 200m ===`);
  const seen = new Set();
  for (const ts of target) {
    for (const cs of cStops) {
      const d = haversine(ts, cs);
      if (d <= 200) {
        const key = ts.stop_name + "|" + cs.stop_name;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`  #26 "${ts.stop_name}" (${ts.stop_code}) <-> ${conn} "${cs.stop_name}" (${cs.stop_code})  ${Math.round(d)}m`);
      }
    }
  }
}
db.close();
