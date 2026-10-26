// Generate intercept.docx from the paper content using the `docx` library.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ExternalHyperlink,
  ImageRun, SectionType
} = require("docx");
const { prevalenceChart, reliabilityChart } = require("./charts");

const FIG1 = prevalenceChart();
const FIG2 = reliabilityChart();

const OUT = path.join(__dirname, "..", "intercept.docx");

// ---------- helpers ----------
const FONT = "Times New Roman";
function runs(parts) {
  // parts: array of {t, b, i} or string
  return parts.map(p => typeof p === "string"
    ? new TextRun({ text: p, font: FONT, size: 22 })
    : new TextRun({ text: p.t, bold: !!p.b, italics: !!p.i, font: FONT, size: 22 }));
}
function para(parts, opts = {}) {
  return new Paragraph({
    children: Array.isArray(parts) ? runs(parts) : runs([parts]),
    spacing: { after: 160, line: 276 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
    ...opts.extra
  });
}
function h1(num, text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text: `${num}. ${text}`, bold: true, font: FONT, size: 26 })]
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, bold: true, italics: true, font: FONT, size: 23 })]
  });
}
function bullet(parts) {
  return new Paragraph({ children: runs(Array.isArray(parts) ? parts : [parts]), bullet: { level: 0 }, spacing: { after: 80 } });
}
function cell(text, { b = false, w } = {}) {
  return new TableCell({
    width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold: b, font: FONT, size: 20 })] })]
  });
}
function table(headers, rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const headRow = new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { b: true, w: widths && widths[i] })) });
  const bodyRows = rows.map(r => new TableRow({ children: r.map((c, i) => cell(String(c), { w: widths && widths[i] })) }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows: [headRow, ...bodyRows] });
}
function caption(text) {
  return new Paragraph({ spacing: { before: 60, after: 160 }, children: [new TextRun({ text, italics: true, font: FONT, size: 18 })] });
}
function figure(buf, cap, w = 300, h = 173) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 120, after: 20 },
      children: [new ImageRun({ data: buf, transformation: { width: w, height: h } })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 160 },
      children: [new TextRun({ text: cap, italics: true, font: FONT, size: 18 })]
    })
  ];
}

// ---------- document body ----------
const children = [];

// Title
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [new TextRun({ text: "Intercept Routing for Public Transit: Boarding Connections via High-Frequency Services", bold: true, font: FONT, size: 32 })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 40 },
  children: [new TextRun({ text: "Pratik Bashyal", font: FONT, size: 24 })]
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 240 },
  children: [new TextRun({ text: "Department of Computer Science, Fairleigh Dickinson University, Vancouver, BC, Canada — bashyalpratik26@gmail.com", italics: true, font: FONT, size: 20 })]
}));

// Abstract
children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "Abstract", bold: true, font: FONT, size: 22 })] }));
children.push(para([
  "Conventional transit trip planners (Google Maps, the Transit app, agency apps) optimize an itinerary under the implicit assumption that a rider boards the chosen route at the stop nearest the origin. This assumption silently discards a class of itineraries that experienced riders use intuitively: riding a ",
  { t: "high-frequency connector", i: true },
  " to a ",
  { t: "downstream junction", i: true },
  " on a target route and boarding the target vehicle there—catching a bus the rider would otherwise miss while walking to the nearest stop. We call this ",
  { t: "chase-and-intercept", i: true },
  " routing. We formalize the intercept structure, implement a dependency-free planner over the live Metro Vancouver (TransLink) feed—239 routes, 8,916 stops, and 1.84 million stop-time events—and automatically detect intercept junctions with no hand-coding. On a reproducible sample of 1,500 transit-servable origin–destination (O–D) pairs during the morning peak, a direct single-route itinerary exists for only 13.2% of pairs, whereas an intercept structure exists for 57.3%. Crucially, when a direct route does exist, a more-frequent connector to a downstream junction is also available 43.4% of the time, with a median connector-to-target frequency advantage of 3.1× (median target headway 17.9 min vs. connector 6.0 min). A simple headway-based reliability model shows the intercept reduces expected boarding wait by 66% in these cases. We corroborate the structural findings with a real, lived trip in East Vancouver. The results indicate that intercept routing is common, mechanically well-defined, and best realized with real-time vehicle positions; we release the planner and evaluation harness as an open prototype."
]));
children.push(para([{ t: "Keywords—", b: true }, "public transit, trip planning, journey planning, GTFS, real-time, routing algorithms, Metro Vancouver, reliability"]));

// 1 Introduction
children.push(h1(1, "Introduction"));
children.push(para("Public-transit trip planners have converged on a familiar interaction model: the rider enters an origin and destination, and the planner returns a small set of itineraries ranked by arrival time, number of transfers, and walking distance. Behind this interface, modern planners solve a well-studied earliest-arrival or Pareto-optimal journey problem over a timetable graph [1], [2], [3]. These systems are fast, correct, and widely used."));
children.push(para("Yet riders in the field routinely perform a maneuver that mainstream planners do not surface. Consider a rider near a major arterial who wants to board an infrequent cross-town route. The planner directs them to walk to that route's nearest stop. But by the time the rider arrives on foot, the target bus—which was already in motion—has passed. An experienced rider instead boards a different, high-frequency route going the same general direction, rides it to a downstream point where the two routes meet, and boards the same target vehicle there. The frequent connector acts as a faster \u201ccarrier\u201d to a junction the target has not yet reached."));
children.push(para([
  "We call this ", { t: "chase-and-intercept", b: true }, " routing. It is not a shortcut in graph-distance terms—on a static timetable it often ties the direct itinerary—but it is a decisive improvement in ", { t: "reliability", i: true }, " and in the real-time ability to ", { t: "catch a specific moving vehicle", i: true }, ". Standard planners discard it precisely because it looks like \u201can extra transfer for no scheduled time savings,\u201d so their ranking heuristics prune it."
]));
children.push(para("This paper makes the following contributions:"));
children.push(bullet([{ t: "We formalize", b: true }, " the chase-and-intercept structure and distinguish a genuine intercept (a more-frequent connector reaching a junction downstream of where the rider could have boarded directly) from an ordinary two-leg transfer (Section 3)."]));
children.push(bullet([{ t: "We build a dependency-free prototype", b: true }, " (Node.js + SQLite) that loads the full live TransLink GTFS feed and automatically detects intercept junctions with no per-route hand-coding, together with a RAPTOR-lite multi-leg search and a real-time (GTFS-RT) rescue evaluator (Section 4)."]));
children.push(bullet([{ t: "We provide a reproducible quantitative evaluation", b: true }, " over 1,500 sampled O–D pairs showing that intercept opportunities are common and measurably improve expected waiting time, plus a two-seed robustness check (Section 5)."]));
children.push(bullet([{ t: "We corroborate the analysis with a validated real-world case study", b: true }, " in East Vancouver and discuss why the headline feature fundamentally requires real-time data (Sections 5 and 6)."]));

// 2 Related Work
children.push(h1(2, "Related Work"));
children.push(para([{ t: "Journey planning algorithms. ", b: true }, "Earliest-arrival and multi-criteria journey planning on timetables is mature. RAPTOR [1] organizes the search into rounds, each adding one additional trip, and is naturally suited to bounding the number of transfers. The Connection Scan Algorithm [2] reduces routing to a single linear scan over time-sorted connections. Transfer Patterns [3] precompute the small set of optimal transfer sequences to answer continental-scale queries in milliseconds. Our prototype uses a RAPTOR-style round-based search but differs in objective: rather than ranking solely by arrival time and transfer count, we explicitly surface intercept itineraries that these objectives would prune."]));
children.push(para([{ t: "Production planners. ", b: true }, "General-purpose engines such as OpenTripPlanner [10] and the planners inside consumer apps produce Pareto-optimal itineraries over GTFS [7] and, increasingly, GTFS-Realtime [8]. These systems do consider transfers, but their ranking penalizes additional boardings and they assume boarding at the nearest stop of each route. The intercept maneuver is thus systematically down-ranked or omitted. Our contribution is complementary: an intercept-aware ranking layer that can sit on top of such an engine."]));
children.push(para([{ t: "Frequency and reliability. ", b: true }, "The waiting-time consequences of service frequency are classical. For uniformly random passenger arrivals the expected wait is half the headway; with headway variance it is larger, a result tracing to Welding [4] and formalized in urban operations research [5], [6]. Our reliability model applies these results to quantify why riding a frequent connector to a junction is more robust than waiting for an infrequent target."]));

// 3 Problem Formulation
children.push(h1(3, "Problem Formulation"));
children.push(h2("A. Timetable model"));
children.push(para("Let the transit network be a set of stops S, routes R, and trips T. Each trip \u03C4 belongs to a route r(\u03C4) and visits an ordered sequence of stops with scheduled departure times. A service calendar maps each trip to the dates on which it operates. For a stop s and route r within a time window [w0, w1], the headway h(r, s) is the median gap between consecutive scheduled departures of r at s."));
children.push(h2("B. Direct boarding (the baseline)"));
children.push(para("Given an origin o and destination g (both as geographic points), a route r is a target if some stop of r lies within a destination radius \u03C1g of g. For a target r, the direct boarding stop b*(r) is the stop of r nearest to o within an origin radius \u03C1o. If such a stop exists and precedes the destination stop along the route, the trip is directly boardable—this is the itinerary mainstream planners return."));
children.push(h2("C. The intercept structure"));
children.push(para("A connector is any route c \u2260 r that serves a stop within \u03C1o of the origin. Let the target r have a representative trip with the destination stop at position p_g and the direct boarding stop (if any) at position p_b. A stop at position j with p_b < j \u2264 p_g is an intercept junction for connector c if some stop of c lies within a junction radius \u03C1J of it. Intuitively: the rider boards c near the origin, rides it to the junction—which is downstream of where they could have boarded r directly—and boards r there."));
children.push(para("We call the structure a genuine intercept when two conditions hold: (1) the target is directly boardable (so a na\u00EFve planner would simply tell the rider to walk to b*(r)); and (2) the connector is substantially more frequent than the target, i.e. the frequency advantage \u03B1 = h(r, junction) / h(c, origin stop) \u2265 \u03B1_min, with \u03B1_min = 1.5. Condition (1) ensures we are not merely describing an ordinary transfer; condition (2) captures the mechanism that makes the maneuver worthwhile—the connector arrives often enough that the rider is far less exposed to just-missing the target."));
children.push(h2("D. Why schedule time alone understates the value"));
children.push(para("On a static timetable, boarding r at b*(r) and boarding the same vehicle of r at the downstream junction yield identical arrival times: it is one vehicle. The intercept's value is therefore not scheduled travel time but reliability and realizability: (i) the frequent connector reduces the chance the rider mistimes the single infrequent target, and (ii) with real-time positions, the connector can catch a target the rider provably cannot reach on foot. We quantify (i) analytically in Section 5 and demonstrate (ii) in the case study."));

// 4 System Design
children.push(h1(4, "System Design"));
children.push(h2("A. Overview"));
children.push(para("Intercept is a dependency-free web application. The backend is Node.js with a single native dependency, better-sqlite3 [11]; the frontend is a Google-Maps-style Leaflet [12] interface. There is no heavyweight routing engine; the intercept logic is implemented directly so the structure is transparent and auditable."));
children.push(h2("B. Data ingestion"));
children.push(para("We load the complete TransLink static GTFS feed [9], [7] into SQLite: routes, stops, trips, stop_times, calendar, calendar_dates, and shapes. The loaded feed contains 239 routes, 8,916 geolocated stops, and 1.84 million stop-time events. Live data uses the GTFS-Realtime v3 endpoints [8]: vehicle positions and trip updates (predicted arrivals), decoded from Protocol Buffers."));
children.push(h2("C. Automatic junction detection"));
children.push(para("A key design goal was that intercept junctions must be discovered, not configured. For a target route we take its representative (longest active) trip and, for every stop, query a spatial grid for nearby stops of candidate connector routes within \u03C1J. Buckets of \u2248 0.004\u00B0 (~300–440 m) make neighbor lookups O(1) in practice. The detector reproduces, with zero hand-coding, the real junction used in our case study: the #26 stop \u201cRupert St @ E 41 Ave\u201d and the #41/R4 stop \u201cE 41 Ave @ Rupert St\u201d, 63 m apart."));
children.push(h2("D. Multi-leg search"));
children.push(para("Journey planning uses a RAPTOR-lite round-based search [1] with up to two vehicle legs plus foot transfers. Round 0 seeds all stops walkable from the origin; each subsequent round boards the earliest reachable trip per route–direction and relaxes short foot transfers (within \u03C1T = 250 m) to reach nearby stops—exactly the hop that realizes a junction transfer. Per-round earliest-arrival labels let us reconstruct and compare direct versus intercept itineraries for the same O–D pair."));
children.push(h2("E. Real-time rescue evaluation"));
children.push(para("The live module takes each currently moving vehicle of a target route and decides whether the rider can catch it by walking to the direct stop versus by taking a connector to a downstream junction, using predicted arrival times. It emits a RESCUE verdict when the rider would miss the vehicle on foot but the connector catches it—precisely the maneuver this paper studies."));
children.push(h2("F. Parameters"));
children.push(para("Unless noted, we use walking speed 1.3 m/s, origin/destination radii \u03C1o = \u03C1g = 500 m, junction radius \u03C1J = 200 m, transfer radius \u03C1T = 250 m, and a board buffer of 60 s. These are deliberately conservative and match the values in the released code."));

// 5 Evaluation
children.push(h1(5, "Evaluation"));
children.push(para("We ask three empirical questions: (Q1) How common are intercept structures? (Q2) How large is the frequency advantage they offer? (Q3) How much do they improve boarding reliability? We answer all three with a reproducible batch experiment over the real feed, then ground them in a lived trip."));
children.push(h2("A. Experimental setup"));
children.push(para("We sample O–D pairs by drawing random pairs of stops whose straight-line separation is between 1.5 and 9 km, using a seeded pseudo-random generator for reproducibility. A pair is transit-servable if stops exist within \u03C1o of the origin and \u03C1g of the destination. All headways are computed on a representative weekday (Wednesday, 2026-10-07) in the morning peak window [07:00, 10:00], using only services active on that date per the GTFS calendar. The primary run uses N = 1500 pairs (seed 42); we repeat with seed 7 to check stability. The entire batch runs in under two seconds on a laptop."));
children.push(h2("B. Q1: Prevalence of intercept structures"));
children.push(para("Only 13.2% of servable pairs have a direct single-route itinerary of the kind mainstream planners prefer, confirming that most real trips already require a transfer. An intercept structure—a connector from the origin reaching a downstream junction on a destination-serving route—exists for 57.3% of pairs. A genuine intercept (direct boardable and frequency advantage \u03B1 \u2265 1.5) exists for 5.7% of all pairs."));
children.push(para([ "The most informative statistic is conditional: among pairs that do have a direct route, a more-frequent connector to a downstream junction is also available ", { t: "43.4%", b: true }, " of the time. In other words, nearly half the time a planner tells a Metro Vancouver rider to \u201cwalk to the stop and wait,\u201d there exists a frequent-connector intercept that the planner never shows." ]));
children.push(table(
  ["Structure", "Pairs", "Share"],
  [
    ["Transit-servable (denominator)", "1500", "100.0%"],
    ["Direct single-route itinerary", "198", "13.2%"],
    ["Any intercept structure", "860", "57.3%"],
    ["Genuine intercept (\u03B1 \u2265 1.5)", "86", "5.7%"],
    ["P(genuine intercept | direct)", "86/198", "43.4%"],
  ], [60, 20, 20]
));
children.push(caption("Table I. Prevalence over N = 1500 servable O–D pairs (seed 42)."));
figure(FIG1, "Fig. 1. Prevalence of itinerary structures. A direct single-route trip is rare (13.2%); intercept structures are common (57.3%).").forEach(p => children.push(p));
children.push(h2("C. Q2: Frequency advantage"));
children.push(para("Among genuine intercepts, the connector-to-target frequency advantage has median 3.1× and mean 3.8×; 52.3% of cases exceed 3×. The median target headway at the junction is 17.9 min against a median connector headway of 6.0 min near the origin (Table II). This is the structural reason the maneuver works: riders swap a sparse route for a frequent one over the first, timing-critical leg."));
children.push(table(
  ["Quantity", "Value"],
  [
    ["Target headway at junction", "17.9 min"],
    ["Connector headway near origin", "6.0 min"],
    ["Frequency advantage \u03B1 (median)", "3.1×"],
    ["Frequency advantage \u03B1 (mean)", "3.8×"],
    ["Share with \u03B1 \u2265 3×", "52.3%"],
  ], [70, 30]
));
children.push(caption("Table II. Headways and advantage, genuine-intercept subset (medians)."));
children.push(h2("D. Q3: Reliability model"));
children.push(para("For uniformly random passenger arrivals, expected boarding wait is half the headway, E[W] = h/2, and the penalty for mistiming (just missing a vehicle) is a full headway h [4], [6]. Because the intercept rider is exposed to the connector's headway on the timing-critical first leg rather than the target's, we compare E[W] under the two strategies using the measured median headways. The intercept reduces expected boarding wait from 9.0 min (direct) to 3.0 min, a 66% reduction, and cuts the mistiming penalty from 17.9 min to 6.0 min (Fig. 2). We emphasize this is a reliability gain, not a scheduled travel-time gain."));
figure(FIG2, "Fig. 2. Boarding reliability under the headway model. Riding a frequent connector over the timing-critical leg cuts expected wait by 66%.").forEach(p => children.push(p));
children.push(h2("E. Robustness"));
children.push(para("Repeating the batch with a different random seed yields consistent results (Table III): direct-route prevalence 13–16%, intercept-structure prevalence 57.3% in both runs, and the key conditional P(genuine | direct) between 41% and 43%. The findings are not an artifact of a particular sample."));
children.push(table(
  ["Metric", "Seed 42", "Seed 7"],
  [
    ["Direct prevalence", "13.2%", "15.5%"],
    ["Any intercept structure", "57.3%", "57.3%"],
    ["Genuine intercept", "5.7%", "6.4%"],
    ["P(genuine | direct)", "43.4%", "41.2%"],
    ["Median advantage \u03B1", "3.1×", "2.6×"],
  ], [52, 24, 24]
));
children.push(caption("Table III. Two-seed robustness (N = 1500 each)."));
children.push(h2("F. Case study: a validated real-world intercept"));
children.push(para("The project was motivated by a real trip in East Vancouver. The rider travelled from near Kingsway & Rupert (postal area V5R 5J9) to the V5S 1Y5 area. The natural target is route #26, which runs toward the destination and passes 41st & Rupert midway. Both Google Maps and the Transit app advised walking to a #26 stop and boarding there. In practice the #26—already moving—would be missed on the walk. Instead the rider boarded the high-frequency #41/R4 nearby, rode to 41st & Rupert, and boarded the same #26 downstream, successfully catching it."));
children.push(para("Our prototype reconstructs this exactly. It auto-detects the junction (stops 51605 \u2194 51181, 63 m apart), confirms the R4/41 run every 2–4 min at the junction versus the #26 every ~8–14 min, and—critically—shows that on schedule the direct and intercept boardings catch the same vehicle (trip 15456609: Earles 08:10 \u2192 Rupert & 41 08:13 \u2192 Kerr & 54 08:18). The maneuver's value is therefore real-time: the frequent connector lets the rider catch a specific moving bus that walking would miss. We also observed that not every #26 trip serves the junction (some early trips take a different branch), which is exactly why a frequent connector improves reliability. With the live GTFS-RT feed, the prototype pulled 181 vehicle positions and 4,020 predicted arrivals and correctly evaluated walk-versus-connector feasibility for the live #26."));

// 6 Discussion
children.push(h1(6, "Discussion"));
children.push(para([{ t: "Why mainstream planners miss this. ", b: true }, "Pareto ranking by (arrival time, transfers, walking) treats the intercept as a dominated solution: it adds a boarding without improving scheduled arrival. Our results show that dominance is an artifact of ignoring reliability and real-time realizability. An intercept-aware planner can re-admit these itineraries by scoring an extra, reliability-oriented criterion—e.g. exposure to headway on the timing-critical leg."]));
children.push(para([{ t: "Schedule vs. real time. ", b: true }, "The clearest lesson is that the headline feature—\u201ccatch a bus you would otherwise miss\u201d—is fundamentally a real-time phenomenon. Static analysis establishes that the opportunity is common (Q1–Q3), but only live vehicle positions turn it into a trustworthy \u201cgo now, you will make it\u201d instruction. This matches the case study and motivates treating GTFS-RT as a first-class input rather than an optional enhancement."]));
children.push(para([{ t: "Practicality. ", b: true }, "The entire system is dependency-free and runs the full regional feed on a laptop, with the batch evaluation completing in under two seconds. The approach is thus deployable by a single developer and portable to any GTFS/GTFS-RT agency."]));

// 7 Limitations
children.push(h1(7, "Limitations and Threats to Validity"));
children.push(para("Our evaluation is structural and schedule-based. (1) Headways are medians over a single morning-peak window on one representative weekday; off-peak and weekend behavior will differ and generally favors intercepts even more (sparser targets). (2) We approximate \u201cwhat mainstream apps do\u201d by nearest-stop direct boarding; we did not instrument the commercial apps directly. (3) The reliability model assumes uniform passenger arrivals and uses headway as the exposure proxy; it does not yet incorporate measured headway variance or walking-time uncertainty, both of which would widen the gap in the intercept's favor. (4) Representative-trip stop sequences can under-represent branches; we mitigate this by using the longest active trip. (5) The strongest claim—catching specific moving vehicles—was validated on one real trip and in live feed pulls, not yet in a large real-time field study. Addressing (5) is the central item of future work."));

// 8 Future Work
children.push(h1(8, "Future Work"));
children.push(para("We plan a longitudinal real-time study: log, across many O–D pairs and times of day, how often an intercept catches a target that walking provably could not, and by how much. This yields the definitive empirical claim the static analysis can only motivate. We also intend to (i) integrate the intercept criterion into a full engine such as OpenTripPlanner [10] as a re-ranking layer, (ii) replace nearest-stop baselines with the actual itineraries returned by commercial planners for a head-to-head comparison, (iii) incorporate headway-variance and walk-time distributions into the reliability model, and (iv) add address geocoding and a mobile (PWA/native) client for field use."));

// 9 Conclusion
children.push(h1(9, "Conclusion"));
children.push(para("Experienced transit riders know a trick that trip planners do not show: ride a frequent connector to a downstream junction and board the target bus there. We formalized this chase-and-intercept structure, built a transparent prototype over the full live Metro Vancouver feed that discovers intercept junctions automatically, and measured the phenomenon. Intercept structures are common (57.3% of servable O–D pairs), and when a direct route exists a more-frequent connector intercept is also available 43.4% of the time, cutting expected boarding wait by 66% under a standard headway model. A validated real trip shows why the feature's full power is realized with real-time data. Intercept routing is common, well-defined, and worth surfacing—and standard planners are leaving it on the table."));

// Reproducibility
children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: "Reproducibility", bold: true, font: FONT, size: 26 })] }));
children.push(para("The planner, automatic junction detector, real-time evaluator, and the evaluation harness (src/evaluate.js, which emits the per-pair CSV and all summary statistics reported here) are released with the project. All numbers in Section 5 are regenerated by: node src/evaluate.js 1500 20261007 42"));

// References
children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: "References", bold: true, font: FONT, size: 26 })] }));
const refs = [
  "D. Delling, T. Pajor, and R. F. Werneck, \u201cRound-Based Public Transit Routing,\u201d Transportation Science, vol. 49, no. 3, pp. 591–604, 2015.",
  "J. Dibbelt, T. Pajor, B. Strasser, and D. Wagner, \u201cIntriguingly Simple and Fast Transit Routing,\u201d in Proc. 12th Int. Symp. Experimental Algorithms (SEA), 2013, pp. 43–54.",
  "H. Bast et al., \u201cFast Routing in Very Large Public Transportation Networks Using Transfer Patterns,\u201d in Proc. 18th European Symp. Algorithms (ESA), 2010, pp. 290–301.",
  "P. I. Welding, \u201cThe Instability of a Close-Interval Service,\u201d Operational Research Quarterly, vol. 8, no. 3, pp. 133–142, 1957.",
  "E. E. Osuna and G. F. Newell, \u201cControl Strategies for an Idealized Public Transportation System,\u201d Transportation Science, vol. 6, no. 1, pp. 52–72, 1972.",
  "R. C. Larson and A. R. Odoni, Urban Operations Research. Prentice-Hall, 1981.",
  "MobilityData, \u201cGeneral Transit Feed Specification (GTFS) Reference,\u201d 2024. [Online]. Available: https://gtfs.org/schedule/reference/",
  "MobilityData, \u201cGTFS Realtime Reference,\u201d 2024. [Online]. Available: https://gtfs.org/realtime/reference/",
  "TransLink, \u201cTransLink Open API and GTFS Data,\u201d 2026. [Online]. Available: https://developer.translink.ca",
  "OpenTripPlanner Community, \u201cOpenTripPlanner,\u201d 2024. [Online]. Available: https://www.opentripplanner.org",
  "J. Wheeler, \u201cbetter-sqlite3,\u201d 2024. [Online]. Available: https://github.com/WiseLibs/better-sqlite3",
  "V. Agafonkin, \u201cLeaflet: an open-source JavaScript library for interactive maps,\u201d 2024. [Online]. Available: https://leafletjs.com",
];
refs.forEach((r, i) => children.push(new Paragraph({
  spacing: { after: 60 },
  children: [new TextRun({ text: `[${i + 1}] ${r}`, font: FONT, size: 20 })]
})));

// ---------- build ----------
const PAGE = { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } };
const headBlock = children.slice(0, 3);   // title, author, affiliation
const bodyBlock = children.slice(3).filter(Boolean);

const doc = new Document({
  creator: "Pratik Bashyal",
  title: "Intercept Routing for Public Transit",
  sections: [
    { properties: { type: SectionType.CONTINUOUS, page: PAGE, column: { count: 1 } }, children: headBlock },
    { properties: { type: SectionType.CONTINUOUS, page: PAGE, column: { count: 2, space: 400 } }, children: bodyBlock },
  ]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("Wrote", OUT, "(" + (buf.length / 1024).toFixed(0) + " KB)");
});
