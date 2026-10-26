// evaluate.js — Structural + frequency evaluation of chase-and-intercept routing
// over the real TransLink GTFS feed. Produces honest, reproducible numbers for the
// research paper:
//   (A) Prevalence: fraction of O-D pairs with a feasible intercept structure.
//   (B) Frequency advantage: connector headway vs target headway at the junction.
//   (C) Catch-probability model (analytic, from headways).
//
// Usage: node src/evaluate.js [N] [date YYYYMMDD] [seed]
// Output: eval-pairs.csv (per-pair rows) + prints a summary block.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB = path.join(__dirname, "..", "data", "gtfs.db");
const db = new Database(DB, { readonly: true });

// ---- params ----
const N = parseInt(process.argv[2] || "400", 10);
const DATE = process.argv[3] || "20261007";          // a Wednesday in feed range
const SEED = parseInt(process.argv[4] || "42", 10);
const WIN_START = 7 * 3600;                            // 07:00
const WIN_END = 10 * 3600;                             // 10:00 (AM peak)
const ORIGIN_R = 500;    // m: stops walkable from origin
const DEST_R = 500;      // m: stops counting as "at destination"
const JUNC_R = 200;      // m: connector stop near a target-route stop = junction
const MIN_KM = 1.5, MAX_KM = 9.0; // sampled trip straight-line length
const ADV_MIN = 1.5;     // connector must be >=1.5x more frequent to count as a genuine intercept

// ---- rng (reproducible) ----
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rng = mulberry32(SEED);

function haversine(aLat,aLon,bLat,bLon){const R=6371000,toR=Math.PI/180;const dLat=(bLat-aLat)*toR,dLon=(bLon-aLon)*toR;const la1=aLat*toR,la2=bLat*toR;const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
const median = (arr)=>{if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

console.log(`Loading stops, routes, memberships … (date=${DATE}, N=${N}, seed=${SEED})`);

// ---- stops + spatial grid ----
const stops = db.prepare("SELECT stop_id, stop_code, stop_name, lat, lon FROM stops WHERE lat IS NOT NULL").all();
const stopById = new Map(stops.map(s=>[s.stop_id,s]));
const CELL = 0.004;
const grid = new Map();
const key=(la,lo)=>Math.floor(la/CELL)+":"+Math.floor(lo/CELL);
for(const s of stops){const k=key(s.lat,s.lon);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(s);}
function within(lat,lon,r){const out=[];const cLa=Math.floor(lat/CELL),cLo=Math.floor(lon/CELL);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const arr=grid.get((cLa+i)+":"+(cLo+j));if(!arr)continue;for(const s of arr){const d=haversine(lat,lon,s.lat,s.lon);if(d<=r)out.push({stop:s,dist:d});}}return out;}

// ---- stop -> set(route_id) and route -> short name ----
console.log("Building stop→routes index …");
const stopRoutes = new Map(); // stop_id -> Set(route_id)
for(const r of db.prepare("SELECT DISTINCT st.stop_id s, t.route_id r FROM stop_times st JOIN trips t ON t.trip_id=st.trip_id").iterate()){
  if(!stopRoutes.has(r.s)) stopRoutes.set(r.s,new Set());
  stopRoutes.get(r.s).add(r.r);
}
const routeShort = new Map(db.prepare("SELECT route_id, short_name, long_name FROM routes").all().map(r=>[r.route_id,(r.short_name&&r.short_name.trim())?r.short_name:(r.long_name||r.route_id)]));

// ---- active services for the date ----
function activeServiceIds(dateStr){
  const y=+dateStr.slice(0,4),m=+dateStr.slice(4,6),d=+dateStr.slice(6,8);
  const dow=new Date(Date.UTC(y,m-1,d)).getUTCDay();
  const col=["sun","mon","tue","wed","thu","fri","sat"][dow];
  const active=new Set();
  for(const r of db.prepare(`SELECT service_id FROM calendar WHERE ${col}=1 AND start_date<=? AND end_date>=?`).all(dateStr,dateStr)) active.add(r.service_id);
  for(const e of db.prepare("SELECT service_id, exception_type FROM calendar_dates WHERE date=?").all(dateStr)){if(e.exception_type===1)active.add(e.service_id);else active.delete(e.service_id);}
  return active;
}
const activeSet = activeServiceIds(DATE);
const activePlaceholders = [...activeSet].map(()=>"?").join(",");
console.log(`Active services on ${DATE}: ${activeSet.size}`);

// representative (longest) trip per route that is active, with ordered stops cached lazily
const repTripCache = new Map();
function repTrip(routeId){
  if(repTripCache.has(routeId)) return repTripCache.get(routeId);
  const trip = db.prepare(`
    SELECT t.trip_id, COUNT(*) n FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id
    WHERE t.route_id=? AND t.service_id IN (${activePlaceholders})
    GROUP BY t.trip_id ORDER BY n DESC LIMIT 1`).get(routeId, ...activeSet);
  let seq=[];
  if(trip){
    seq = db.prepare("SELECT st.stop_seq seq, st.stop_id FROM stop_times st WHERE st.trip_id=? ORDER BY st.stop_seq").all(trip.trip_id);
  }
  repTripCache.set(routeId, seq);
  return seq;
}

// headway (seconds) of a route at a stop in the window; null if <2 departures
const headwayStmt = db.prepare(`
  SELECT st.dep_sec d FROM stop_times st JOIN trips t ON t.trip_id=st.trip_id
  WHERE st.stop_id=? AND t.route_id=? AND st.dep_sec BETWEEN ? AND ?
    AND t.service_id IN (${activePlaceholders}) ORDER BY st.dep_sec`);
const headwayCache = new Map();
function headway(routeId, stopId){
  const ck = routeId+"|"+stopId;
  if(headwayCache.has(ck)) return headwayCache.get(ck);
  const deps = headwayStmt.all(stopId, routeId, WIN_START, WIN_END, ...activeSet).map(r=>r.d);
  let hw=null, count=deps.length;
  if(deps.length>=2){const gaps=[];for(let i=1;i<deps.length;i++)gaps.push(deps[i]-deps[i-1]);hw=Math.max(30, median(gaps));}
  const res={hw,count};
  headwayCache.set(ck,res);
  return res;
}

// ---- sample O-D pairs ----
function randStop(){return stops[Math.floor(rng()*stops.length)];}
function samplePair(){for(let tries=0;tries<200;tries++){const o=randStop(),d=randStop();const km=haversine(o.lat,o.lon,d.lat,d.lon)/1000;if(km>=MIN_KM&&km<=MAX_KM)return{o,d,km};}return null;}

// ---- core per-pair evaluation ----
function evalPair(o,d){
  const originStops = within(o.lat,o.lon,ORIGIN_R);
  const destStops = within(d.lat,d.lon,DEST_R);
  if(!originStops.length || !destStops.length) return {servable:false};

  // routes serving origin (connectors candidates) with their nearest origin stop
  const originRouteStop = new Map(); // route_id -> {stopId,dist}
  for(const {stop,dist} of originStops){const rs=stopRoutes.get(stop.stop_id);if(!rs)continue;for(const rid of rs){const cur=originRouteStop.get(rid);if(!cur||dist<cur.dist)originRouteStop.set(rid,{stopId:stop.stop_id,dist});}}

  // target routes = routes serving dest
  const targetRoutes = new Set();
  for(const {stop} of destStops){const rs=stopRoutes.get(stop.stop_id);if(rs)for(const rid of rs)targetRoutes.add(rid);}

  let hasDirect=false, hasIntercept=false, genuine=false, bestAdv=0, bestRec=null, bestGenuineAdv=0, bestGenuineRec=null;

  for(const T of targetRoutes){
    const seq = repTrip(T);
    if(seq.length<3) continue;
    const posById = new Map(seq.map((r,i)=>[r.stop_id,i]));
    // dest stop on T (nearest to dest among T's stops)
    let destPos=-1,destD=1e9;
    for(const r of seq){const s=stopById.get(r.stop_id);if(!s)continue;const dd=haversine(d.lat,d.lon,s.lat,s.lon);if(dd<=DEST_R&&dd<destD){destD=dd;destPos=posById.get(r.stop_id);}}
    if(destPos<0) continue;
    // direct boarding stop on T (nearest to origin, within ORIGIN_R) -> apps' choice
    let dirPos=-1,dirD=1e9,dirStop=null;
    for(const r of seq){const s=stopById.get(r.stop_id);if(!s)continue;const dd=haversine(o.lat,o.lon,s.lat,s.lon);if(dd<=ORIGIN_R&&dd<dirD){dirD=dd;dirPos=posById.get(r.stop_id);dirStop=r.stop_id;}}
    const directBoardable = dirPos>=0 && dirPos<destPos;
    if(directBoardable) hasDirect=true;

    // junction search: T-stops strictly downstream of direct boarding (or of origin projection),
    // within JUNC_R of a connector stop whose route serves origin (connector != T).
    const fromPos = dirPos>=0 ? dirPos : 0;
    for(let i=fromPos+1;i<=destPos;i++){
      const jStopId = seq[i].stop_id;
      const js = stopById.get(jStopId);
      if(!js) continue;
      // connectors near this junction that also serve origin
      for(const {stop:cstop,dist:cjd} of within(js.lat,js.lon,JUNC_R)){
        const crs = stopRoutes.get(cstop.stop_id); if(!crs) continue;
        for(const cR of crs){
          if(cR===T) continue;
          const oref = originRouteStop.get(cR); if(!oref) continue; // connector must serve origin
          // we have an intercept structure: origin --cR--> junction(i) --board T--> dest
          const hT = headway(T, jStopId);
          const hC = headway(cR, oref.stopId);
          if(hT.hw==null || hC.hw==null) continue; // need both frequencies in window
          const adv = hT.hw / hC.hw; // >1 means connector more frequent than target
          hasIntercept=true;
          if(adv>bestAdv){bestAdv=adv;bestRec={target:routeShort.get(T),connector:routeShort.get(cR),junction:js.stop_name,hT:hT.hw,hC:hC.hw,directBoardable};}
          // genuine intercept: direct boarding exists AND connector is >=ADV_MIN more frequent
          if(directBoardable && adv>=ADV_MIN){
            genuine=true;
            if(adv>bestGenuineAdv){bestGenuineAdv=adv;bestGenuineRec={target:routeShort.get(T),connector:routeShort.get(cR),junction:js.stop_name,hT:hT.hw,hC:hC.hw};}
          }
        }
      }
    }
  }
  return {servable:true, hasDirect, hasIntercept, genuine, bestAdv, bestRec, bestGenuineAdv, bestGenuineRec};
}

// ---- run ----
const rows=[]; let servable=0, withDirect=0, withIntercept=0, genuineCount=0, genuineGivenDirect=0;
const advList=[]; const hTList=[]; const hCList=[]; const gAdvList=[];
const t0=Date.now();
for(let n=0;n<N;n++){
  const p=samplePair(); if(!p){continue;}
  const r=evalPair(p.o,p.d);
  if(!r.servable) continue;
  servable++;
  if(r.hasDirect) withDirect++;
  if(r.hasIntercept){
    withIntercept++;
    if(r.bestRec){advList.push(r.bestAdv);hTList.push(r.bestRec.hT);hCList.push(r.bestRec.hC);}
  }
  if(r.genuine){genuineCount++; if(r.bestGenuineRec)gAdvList.push(r.bestGenuineAdv);}
  if(r.hasDirect && r.genuine) genuineGivenDirect++;
  rows.push([n,p.o.stop_code,p.d.stop_code,p.km.toFixed(2),r.hasDirect?1:0,r.hasIntercept?1:0,r.genuine?1:0,
    r.bestGenuineRec?r.bestGenuineRec.target:(r.bestRec?r.bestRec.target:""),
    r.bestGenuineRec?r.bestGenuineRec.connector:(r.bestRec?r.bestRec.connector:""),
    r.bestGenuineRec?Math.round(r.bestGenuineRec.hT):(r.bestRec?Math.round(r.bestRec.hT):""),
    r.bestGenuineRec?Math.round(r.bestGenuineRec.hC):(r.bestRec?Math.round(r.bestRec.hC):""),
    r.genuine?r.bestGenuineAdv.toFixed(2):(r.bestRec?r.bestAdv.toFixed(2):"")].join(","));
  if((n+1)%50===0) process.stdout.write(`  …${n+1}/${N}\r`);
}
const secs=((Date.now()-t0)/1000).toFixed(1);

fs.writeFileSync("eval-pairs.csv",
  "idx,origin_code,dest_code,km,has_direct,has_intercept,genuine_intercept,target,connector,target_headway_s,connector_headway_s,freq_advantage\n"+rows.join("\n")+"\n");

// Reliability model (analytic, from scheduled headways).
//   Expected boarding wait  = h/2 (uniform arrival within a headway).
//   Mistiming penalty       = h   (wait incurred if you just miss the vehicle).
// Intercept rides a frequent connector, so its exposure is the connector headway h_C
// instead of the sparse target headway h_T.
const pairedDirectH=[], pairedInterceptH=[];
for(const line of rows){
  const c=line.split(",");
  if(c[6]==="1"){ // genuine
    const hT=+c[9], hC=+c[10];
    if(hT>0&&hC>0){pairedDirectH.push(hT);pairedInterceptH.push(hC);}
  }
}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0;}
const mDirect=median(pairedDirectH)||0, mInt=median(pairedInterceptH)||0;

const pct=(a,b)=>b?(100*a/b).toFixed(1):"0.0";
console.log("\n\n================ EVALUATION SUMMARY ================");
console.log(`Date ${DATE}  window ${WIN_START/3600}:00–${WIN_END/3600}:00  seed ${SEED}  N=${N}  (${secs}s)`);
console.log(`Sampled transit-servable O-D pairs:        ${servable}`);
console.log(`  with a direct target route:              ${withDirect}  (${pct(withDirect,servable)}%)`);
console.log(`  with any intercept structure:            ${withIntercept}  (${pct(withIntercept,servable)}%)`);
console.log(`  with a GENUINE intercept (adv≥${ADV_MIN}×):      ${genuineCount}  (${pct(genuineCount,servable)}%)`);
console.log(`Conditional P(genuine intercept | direct): ${pct(genuineGivenDirect,withDirect)}%  (${genuineGivenDirect}/${withDirect})`);
console.log(`\nFrequency advantage of connector vs target (genuine subset):`);
console.log(`  median ${gAdvList.length?median(gAdvList).toFixed(2):"-"}×   mean ${gAdvList.length?avg(gAdvList).toFixed(2):"-"}×`);
console.log(`  share ≥ 3×:                               ${pct(gAdvList.filter(a=>a>=3).length,gAdvList.length)}%`);
console.log(`\nHeadways (genuine subset, medians):`);
console.log(`  target at junction:    ${(mDirect/60).toFixed(1)} min`);
console.log(`  connector near origin: ${(mInt/60).toFixed(1)} min`);
console.log(`\nReliability model (medians):`);
console.log(`  expected boarding wait (h/2) — direct ${(mDirect/120).toFixed(1)} min  vs  intercept ${(mInt/120).toFixed(1)} min`);
console.log(`  mistiming penalty      (h)   — direct ${(mDirect/60).toFixed(1)} min  vs  intercept ${(mInt/60).toFixed(1)} min`);
console.log(`  wait reduction: ${mDirect?(100*(1-mInt/mDirect)).toFixed(0):"-"}%`);
console.log(`\nWrote eval-pairs.csv (${rows.length} rows)`);
console.log("===================================================");
db.close();
