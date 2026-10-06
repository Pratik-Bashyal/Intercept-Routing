// Load TransLink GTFS (static) text files into a SQLite DB for fast querying.
// Usage: node src/loadGtfs.js
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const Database = require("better-sqlite3");

const GTFS_DIR = path.join(__dirname, "..", "data", "gtfs");
const DB_PATH = path.join(__dirname, "..", "data", "gtfs.db");

// Minimal CSV line splitter that respects double quotes (GTFS is simple CSV).
function splitCsv(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function loadTable(db, file, table, columns, transform) {
  const filePath = path.join(GTFS_DIR, file);
  if (!fs.existsSync(filePath)) { console.log(`skip ${file} (missing)`); return; }
  const placeholders = columns.map(() => "?").join(",");
  const insert = db.prepare(`INSERT INTO ${table} VALUES (${placeholders})`);
  const insertMany = db.transaction((rows) => { for (const r of rows) insert.run(r); });

  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let header = null;
  let idx = null;
  let batch = [];
  let count = 0;
  for await (const line of rl) {
    if (line.trim() === "") continue;
    if (!header) {
      header = splitCsv(line).map((h) => h.replace(/^\uFEFF/, "").trim());
      idx = columns.map((c) => header.indexOf(c.split(" ")[0]));
      continue;
    }
    const f = splitCsv(line);
    let row = columns.map((c, i) => (idx[i] >= 0 ? f[idx[i]] : null));
    if (transform) row = transform(row, header, f);
    if (!row) continue;
    batch.push(row);
    count++;
    if (batch.length >= 5000) { insertMany(batch); batch = []; }
  }
  if (batch.length) insertMany(batch);
  console.log(`loaded ${table}: ${count} rows`);
}

// Convert "HH:MM:SS" (GTFS allows >24h) to seconds after midnight.
function toSeconds(hms) {
  if (!hms) return null;
  const p = hms.split(":");
  if (p.length !== 3) return null;
  return (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]);
}

async function main() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = OFF");

  db.exec(`
    CREATE TABLE routes (route_id TEXT PRIMARY KEY, short_name TEXT, long_name TEXT, route_type INT);
    CREATE TABLE stops (stop_id TEXT PRIMARY KEY, stop_code TEXT, stop_name TEXT, lat REAL, lon REAL);
    CREATE TABLE trips (trip_id TEXT PRIMARY KEY, route_id TEXT, service_id TEXT, headsign TEXT, direction_id INT, shape_id TEXT);
    CREATE TABLE stop_times (trip_id TEXT, stop_id TEXT, stop_seq INT, arr_sec INT, dep_sec INT);
    CREATE TABLE calendar (service_id TEXT PRIMARY KEY, mon INT, tue INT, wed INT, thu INT, fri INT, sat INT, sun INT, start_date TEXT, end_date TEXT);
    CREATE TABLE calendar_dates (service_id TEXT, date TEXT, exception_type INT);
    CREATE TABLE shapes (shape_id TEXT, seq INT, lat REAL, lon REAL);
  `);

  await loadTable(db, "routes.txt", "routes",
    ["route_id", "route_short_name", "route_long_name", "route_type"],
    (r) => [r[0], r[1], r[2], r[3] ? +r[3] : null]);

  await loadTable(db, "stops.txt", "stops",
    ["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon"],
    (r) => [r[0], r[1], r[2], r[3] ? +r[3] : null, r[4] ? +r[4] : null]);

  await loadTable(db, "trips.txt", "trips",
    ["trip_id", "route_id", "service_id", "trip_headsign", "direction_id", "shape_id"],
    (r) => [r[0], r[1], r[2], r[3], r[4] !== "" && r[4] != null ? +r[4] : null, r[5]]);

  await loadTable(db, "stop_times.txt", "stop_times",
    ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"],
    (r) => [r[0], r[1], r[2] ? +r[2] : null, toSeconds(r[3]), toSeconds(r[4])]);

  await loadTable(db, "calendar.txt", "calendar",
    ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
    (r) => [r[0], +r[1], +r[2], +r[3], +r[4], +r[5], +r[6], +r[7], r[8], r[9]]);

  await loadTable(db, "calendar_dates.txt", "calendar_dates",
    ["service_id", "date", "exception_type"],
    (r) => [r[0], r[1], r[2] ? +r[2] : null]);

  await loadTable(db, "shapes.txt", "shapes",
    ["shape_id", "shape_pt_sequence", "shape_pt_lat", "shape_pt_lon"],
    (r) => [r[0], r[1] ? +r[1] : null, r[2] ? +r[2] : null, r[3] ? +r[3] : null]);

  console.log("creating indexes...");
  db.exec(`
    CREATE INDEX idx_st_trip ON stop_times(trip_id);
    CREATE INDEX idx_st_stop ON stop_times(stop_id);
    CREATE INDEX idx_trips_route ON trips(route_id);
    CREATE INDEX idx_routes_short ON routes(short_name);
    CREATE INDEX idx_stops_name ON stops(stop_name);
    CREATE INDEX idx_shapes_id ON shapes(shape_id, seq);
  `);
  db.close();
  console.log("done -> " + DB_PATH);
}

main().catch((e) => { console.error(e); process.exit(1); });
