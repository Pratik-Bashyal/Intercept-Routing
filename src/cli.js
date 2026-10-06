// CLI: plan a journey, compare fastest DIRECT (1 bus) vs fastest INTERCEPT (<=2 buses).
// Usage: node src/cli.js <oLat> <oLon> <dLat> <dLon> [YYYYMMDD] [HH:MM]
const { Planner, hhmm } = require("./intercept");

const args = process.argv.slice(2);
if (args.length < 4) {
  console.log("Usage: node src/cli.js <oLat> <oLon> <dLat> <dLon> [YYYYMMDD] [HH:MM]");
  process.exit(1);
}
const [oLat, oLon, dLat, dLon] = args.slice(0, 4).map(Number);
const dateStr = args[4] || "20261006";
const [hh, mm] = (args[5] || "08:00").split(":").map(Number);
const startSec = hh * 3600 + mm * 60;

const p = new Planner();
console.log(`\nPlanning ${dateStr} ${hhmm(startSec)}  origin(${oLat},${oLon}) -> dest(${dLat},${dLon})\n`);
const { tau, parent, candByK } = p.plan({ lat: oLat, lon: oLon }, { lat: dLat, lon: dLon }, dateStr, startSec);

const best1 = candByK[1][0];
const best2 = candByK[2] && candByK[2][0];

function show(label, cand) {
  if (!cand) { console.log(`${label}: none`); return null; }
  const d = p.describe(tau, parent, cand);
  console.log(`\n${label}  —  ${d.rides.join(" + ") || "walk"}  (arrive ${hhmm(d.arrive)})`);
  console.log(d.text);
  return d;
}

const d1 = show("DIRECT (what Google/Transit show, <=1 bus)", best1);
const d2 = show("INTERCEPT (<=2 buses, our planner)", best2);

console.log("\n================ VERDICT ================");
if (d1 && d2) {
  const save = d1.arrive - d2.arrive;
  if (d2.rides.length >= 2 && save > 0) {
    console.log(`INTERCEPT (${d2.rides.join("+")}) arrives ${hhmm(d2.arrive)} vs direct ${hhmm(d1.arrive)}`);
    console.log(`   >>> SAVES ${Math.round(save / 60)} min by catching the target bus at a downstream junction.`);
  } else if (save > 0) {
    console.log(`Fastest overall arrives ${hhmm(d2.arrive)} (${d2.rides.join("+")}).`);
  } else {
    console.log(`Direct is fastest here (${hhmm(d1.arrive)}). Intercept helps most when you'd miss the direct bus.`);
  }
} else if (d1) {
  console.log(`Only a direct route found (arrive ${hhmm(d1.arrive)}).`);
}
