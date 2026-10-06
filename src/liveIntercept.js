// LIVE intercept analyzer — the core real-time feature.
// For a target route heading toward your destination, decide whether you can catch
// a currently-moving bus by WALKING to its nearest stop vs by taking a CONNECTOR
// to a downstream junction. Surfaces the "you'd miss it walking, but R4 rescues it" move.
//
// Usage: node src/liveIntercept.js <oLat> <oLon> <targetShortName> <dLat> <dLon>
const { Planner, hhmm } = require("./intercept");
const { vehiclePositions, tripUpdates } = require("./realtime");

const BOARD_BUFFER = 60; // s you need to be at the stop before the bus

function nowDateSec() {
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  return { dateStr, sec };
}

async function main() {
  const a = process.argv.slice(2);
  if (a.length < 5) {
    console.log("Usage: node src/liveIntercept.js <oLat> <oLon> <targetShortName> <dLat> <dLon>");
    process.exit(1);
  }
  const origin = { lat: +a[0], lon: +a[1] };
  const target = a[2];
  const dest = { lat: +a[3], lon: +a[4] };

  const p = new Planner();
  const targetRouteId = p.routeIdByShort(target);
  if (!targetRouteId) { console.log(`Route ${target} not found.`); return; }

  const { dateStr, sec } = nowDateSec();
  console.log(`\nLIVE @ ${dateStr} ${hhmm(sec)}  origin(${origin.lat},${origin.lon}) target #${target} -> dest(${dest.lat},${dest.lon})\n`);

  // Reachability from origin: tau[0]=walk only, tau[1]=one connector ride, tau[2]=two rides.
  const { tau, parent } = p.search(origin, dateStr, sec);
  const reachWalk = tau[0];
  const reachConn = tau[1];

  // Destination stop set (to confirm a vehicle actually serves the destination).
  const destStops = new Map(p.stopsWithin(dest.lat, dest.lon, 600).map((x) => [x.stop.stop_id, x.dist]));

  // Live data.
  const [vehicles, updates] = await Promise.all([vehiclePositions(), tripUpdates()]);
  const mine = vehicles.filter((v) => v.routeId === targetRouteId && v.tripId);
  console.log(`Live #${target} vehicles: ${mine.length}\n`);
  if (mine.length === 0) { console.log("None running right now — try during service hours."); return; }

  const nm = (id) => { const s = p.stopById.get(id); return s ? `${s.stop_name} (${s.stop_code})` : id; };
  const predArr = (tripId, stopId, schedArr) => {
    const v = updates.get(`${tripId}|${stopId}`);
    return v != null ? { t: v, live: true } : { t: schedArr, live: false };
  };

  for (const v of mine) {
    const stops = p.tripStops(v.tripId);
    if (stops.length === 0) continue;
    // Upcoming stops = those at/after the vehicle's current sequence.
    const curSeq = v.currentStopSequence != null ? v.currentStopSequence : -1;
    const upcoming = stops.filter((s) => s.stop_seq >= curSeq);

    // Does this vehicle reach the destination downstream?
    const destLeg = upcoming.find((s) => destStops.has(s.stop_id));
    const servesDest = !!destLeg;

    // Earliest boarding stop reachable by walking vs by connector.
    let walkBoard = null, connBoard = null;
    for (const s of upcoming) {
      const { t: busT, live } = predArr(v.tripId, s.stop_id, s.arr_sec);
      if (busT == null) continue;
      const rw = reachWalk.get(s.stop_id);
      const rc = reachConn.get(s.stop_id);
      if (!walkBoard && rw != null && rw + BOARD_BUFFER <= busT) walkBoard = { s, you: rw, bus: busT, live };
      if (!connBoard && rc != null && rc + BOARD_BUFFER <= busT) connBoard = { s, you: rc, bus: busT, live };
      if (walkBoard && connBoard) break;
    }

    console.log(`— Bus trip ${v.tripId}  at (${v.lat?.toFixed(4)},${v.lon?.toFixed(4)}) seq ${curSeq}  servesDest=${servesDest}`);
    if (walkBoard) {
      console.log(`   WALK:      board ${nm(walkBoard.s.stop_id)} — you ${hhmm(walkBoard.you)}, bus ${hhmm(walkBoard.bus)}${walkBoard.live ? " (live)" : ""}`);
    } else {
      console.log(`   WALK:      cannot catch this bus on foot (you'd miss it).`);
    }
    if (connBoard) {
      const legs = p.reconstruct(tau, parent, 1, connBoard.s.stop_id);
      const via = legs.filter((l) => l.type === "ride").map((l) => "#" + l.route).join(">") || "walk";
      console.log(`   CONNECTOR: board ${nm(connBoard.s.stop_id)} via ${via} — you ${hhmm(connBoard.you)}, bus ${hhmm(connBoard.bus)}${connBoard.live ? " (live)" : ""}`);
    } else {
      console.log(`   CONNECTOR: no connector gets you to this bus in time.`);
    }
    if (connBoard && !walkBoard) {
      console.log(`   >>> RESCUE: you'd MISS this #${target} on foot, but the connector catches it. (Your exact maneuver!)`);
    } else if (connBoard && walkBoard && connBoard.s.stop_seq < walkBoard.s.stop_seq) {
      console.log(`   >>> Connector lets you board earlier in the run.`);
    }
    console.log("");
  }
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
