// One-off: import shapes.txt into the existing gtfs.db without a full rebuild.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const Database = require("better-sqlite3");

const GTFS_DIR = path.join(__dirname, "..", "data", "gtfs");
const DB_PATH = path.join(__dirname, "..", "data", "gtfs.db");

function splitCsv(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = OFF");
  db.exec("DROP TABLE IF EXISTS shapes");
  db.exec("CREATE TABLE shapes (shape_id TEXT, seq INT, lat REAL, lon REAL)");

  const insert = db.prepare("INSERT INTO shapes VALUES (?,?,?,?)");
  const insertMany = db.transaction((rows) => { for (const r of rows) insert.run(r); });

  const rl = readline.createInterface({ input: fs.createReadStream(path.join(GTFS_DIR, "shapes.txt")), crlfDelay: Infinity });
  let header = null, idx = null, batch = [], count = 0;
  const cols = ["shape_id", "shape_pt_sequence", "shape_pt_lat", "shape_pt_lon"];
  for await (const line of rl) {
    if (line.trim() === "") continue;
    if (!header) { header = splitCsv(line).map((h) => h.replace(/^\uFEFF/, "").trim()); idx = cols.map((c) => header.indexOf(c)); continue; }
    const f = splitCsv(line);
    batch.push([f[idx[0]], +f[idx[1]], +f[idx[2]], +f[idx[3]]]);
    count++;
    if (batch.length >= 10000) { insertMany(batch); batch = []; }
  }
  if (batch.length) insertMany(batch);
  db.exec("CREATE INDEX idx_shapes_id ON shapes(shape_id, seq)");
  console.log("loaded shapes:", count, "rows; distinct shapes:", db.prepare("SELECT COUNT(DISTINCT shape_id) c FROM shapes").get().c);
  db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
