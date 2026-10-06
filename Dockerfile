# Intercept — Metro Vancouver transit (cloud image)
# Rebuilds the SQLite GTFS DB at build time from the committed gtfs.zip,
# so the large data/gtfs.db is never committed to git.
FROM node:20-bookworm-slim

# unzip (expand GTFS feed) + build toolchain (better-sqlite3 compiles natively).
RUN apt-get update && apt-get install -y --no-install-recommends \
        unzip python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production deps first (better layer caching).
COPY package*.json ./
RUN npm ci --omit=dev

# App source + committed GTFS feed.
COPY . .

# Expand the GTFS feed and build the query DB (routes, stops, stop_times, shapes…).
RUN mkdir -p data/gtfs \
    && unzip -o data/gtfs.zip -d data/gtfs \
    && node src/loadGtfs.js

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
