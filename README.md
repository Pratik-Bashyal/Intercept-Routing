# Bus Intercept Planner (prototype)

Finds "chase-and-intercept" transit journeys for Metro Vancouver (TransLink):
ride a frequent connector bus to a downstream junction and board the target bus
there — the clever move Google Maps / Transit don't surface.

Validated real example: Kingsway/Rupert → V5S 1Y5 via #41/R4 → #26 at 41st & Rupert.

## Setup
```
npm install
# Download static GTFS (already in data/gtfs.zip if present), then:
node src/loadGtfs.js        # builds data/gtfs.db from data/gtfs/*.txt
```

## Plan a trip (schedule-based)
```
node src/cli.js <oLat> <oLon> <dLat> <dLon> [YYYYMMDD] [HH:MM]
# example:
node src/cli.js 49.2326 -123.0520 49.2199 -123.0414 20261006 08:00
```
Compares the fastest DIRECT (1 bus) vs fastest INTERCEPT (<=2 buses).

## Find junctions where two routes meet
```
node src/explore.js
```

## Real-time (needs free TransLink API key)
1. Register at https://developer.translink.ca and copy your key.
2. Create a `.env` file in this folder:
   ```
   KEY=your_api_key_here
   ```
3. Test:
   ```
   node src/realtime.js
   ```

## Files
- `src/loadGtfs.js` — load static GTFS into SQLite
- `src/intercept.js` — RAPTOR-lite planner (junctions, direct vs intercept)
- `src/cli.js` — command-line trip comparison
- `src/explore.js` — junction finder between routes
- `src/realtime.js` — GTFS-RT v3 client (vehicle positions, trip updates)

## Key finding
On schedule alone, the intercept usually catches the *same* vehicle as the direct
route (same arrival). Its real value is **real-time**: catching a moving bus you'd
otherwise miss. That feature needs the live GTFS-RT feed (API key).

## Run the web app (Intercept)
```
npm run web            # serves http://localhost:3000
```
Use it on your phone over the same WiFi at `http://<your-pc-ip>:3000` (GPS needs HTTPS;
over plain http, tap the map or type addresses).

## Install on your phone (PWA)
Intercept is a Progressive Web App. Once it's on an **https** URL (see deploy below):
- **Android/Chrome:** menu → *Add to Home screen* / *Install app*.
- **iOS/Safari:** Share → *Add to Home Screen*.
It then opens fullscreen with its own icon, and GPS works.

## Deploy free (so it works on cellular, PC off)
The repo ships a `Dockerfile` + `render.yaml`. The image rebuilds the GTFS DB at
build time from the committed `data/gtfs.zip`, so the 125 MB `gtfs.db` is never committed.

1. Push this folder to a **GitHub** repo (the `.env` stays ignored; `data/gtfs.zip` is committed).
2. On **Render.com**: *New → Blueprint* → pick the repo (it reads `render.yaml`).
3. Set the env var **`TRANSLINK_API_KEY`** to your TransLink key (kept secret).
4. Deploy → you get `https://intercept-xxxx.onrender.com`. Open it on your phone and install.

Other hosts (Railway, Fly.io) work the same way via the `Dockerfile`.
Note: free tiers sleep when idle → first open after a while has a ~30 s cold start.

### Later: build an APK
The PWA can be wrapped into an installable `.apk` with **Capacitor** or a **TWA
(Bubblewrap)** pointing at your deployed URL — no rewrite needed.

