/**
 * Where Is Rob At Work? — Cloudflare Worker "rob-flight-tracker-worker" (v1)
 *
 * GET /api/status → normalized schedule JSON for the dashboard:
 *   • fetches the iCloud calendar in the CALENDAR_WEBCAL_URL secret (webcal:// → https://)
 *   • parses MiCrew + Flighty events with the shared /js/parser.js
 *   • keeps the last good schedule (memory + optional SCHEDULE_KV) and serves it with
 *     staleCache:true when the feed is unreachable or times out
 *   • current-location weather in °F from free Open-Meteo (no key)
 *   • best-effort live altitude/groundspeed (free ADS-B APIs) + gate/parking text from Flighty
 * GET /health → liveness.  All responses carry CORS headers.
 *
 * Free tier only. Deploy:  cd worker && npx wrangler deploy
 */
import '../js/parser.js'; // sets globalThis.RobParser (Wrangler bundles it)

const P = globalThis.RobParser;
const VERSION = 'v1';
const HOME = 'CHS', BASE = 'ATL', HOME_TZ = 'America/New_York';
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const CAL_TTL = 4 * MIN, CAL_RETRY = 60 * 1000, WX_TTL = 10 * MIN, LIVE_TTL = 45 * 1000;
const KV_KEY = 'schedule:last:v1';
const CFG = { preHours: 4, commuteHomeHours: 8, home: HOME };

// ── Airports: IATA lat lon tz city  (E/C/M/A/P… = US zones, else IANA) ──
const TZ = {
  E: 'America/New_York', C: 'America/Chicago', M: 'America/Denver', A: 'America/Phoenix',
  P: 'America/Los_Angeles', K: 'America/Anchorage', H: 'Pacific/Honolulu', D: 'America/Detroit',
  I: 'America/Indiana/Indianapolis', L: 'America/Kentucky/Louisville', R: 'America/Puerto_Rico'
};
const AIRPORT_DATA = `
ATL 33.64 -84.43 E Atlanta
CHS 32.90 -80.04 E Charleston
SAV 32.13 -81.20 E Savannah
HHH 32.22 -80.70 E Hilton Head
JAX 30.49 -81.69 E Jacksonville
MCO 28.43 -81.31 E Orlando
TPA 27.98 -82.53 E Tampa
MIA 25.79 -80.29 E Miami
FLL 26.07 -80.15 E Fort Lauderdale
PBI 26.68 -80.10 E West Palm Beach
RSW 26.54 -81.76 E Fort Myers
SRQ 27.40 -82.55 E Sarasota
PIE 27.91 -82.69 E St. Petersburg
DAB 29.18 -81.06 E Daytona Beach
MLB 28.10 -80.65 E Melbourne
GNV 29.69 -82.27 E Gainesville
TLH 30.40 -84.35 E Tallahassee
EYW 24.56 -81.76 E Key West
PNS 30.47 -87.19 C Pensacola
VPS 30.48 -86.53 C Destin–Fort Walton Beach
ECP 30.36 -85.80 C Panama City Beach
MYR 33.68 -78.93 E Myrtle Beach
CAE 33.94 -81.12 E Columbia
GSP 34.90 -82.22 E Greenville–Spartanburg
AGS 33.37 -81.96 E Augusta
CSG 32.52 -84.94 E Columbus GA
VLD 30.78 -83.28 E Valdosta
CLT 35.21 -80.94 E Charlotte
RDU 35.88 -78.79 E Raleigh–Durham
GSO 36.10 -79.94 E Greensboro
AVL 35.44 -82.54 E Asheville
ILM 34.27 -77.90 E Wilmington
FAY 34.99 -78.88 E Fayetteville
ORF 36.89 -76.20 E Norfolk
RIC 37.51 -77.32 E Richmond
ROA 37.33 -79.98 E Roanoke
DCA 38.85 -77.04 E Washington National
IAD 38.95 -77.46 E Washington Dulles
BWI 39.18 -76.67 E Baltimore
PHL 39.87 -75.24 E Philadelphia
EWR 40.69 -74.17 E Newark
LGA 40.78 -73.87 E New York LaGuardia
JFK 40.64 -73.78 E New York JFK
HPN 41.07 -73.71 E White Plains
BOS 42.36 -71.01 E Boston
PVD 41.73 -71.43 E Providence
BDL 41.94 -72.68 E Hartford
ALB 42.75 -73.80 E Albany
SYR 43.11 -76.11 E Syracuse
ROC 43.12 -77.67 E Rochester
BUF 42.94 -78.73 E Buffalo
PWM 43.65 -70.31 E Portland ME
BTV 44.47 -73.15 E Burlington
MHT 42.93 -71.44 E Manchester
PIT 40.49 -80.23 E Pittsburgh
CLE 41.41 -81.85 E Cleveland
CMH 40.00 -82.89 E Columbus
CAK 40.92 -81.44 E Akron–Canton
DAY 39.90 -84.22 E Dayton
CVG 39.05 -84.67 E Cincinnati
SDF 38.17 -85.74 L Louisville
LEX 38.04 -84.61 E Lexington
IND 39.72 -86.29 I Indianapolis
DTW 42.21 -83.35 D Detroit
GRR 42.88 -85.52 D Grand Rapids
CHA 35.04 -85.20 E Chattanooga
TYS 35.81 -83.99 E Knoxville
TRI 36.48 -82.41 E Tri-Cities
BNA 36.12 -86.68 C Nashville
MEM 35.04 -89.98 C Memphis
BHM 33.56 -86.75 C Birmingham
HSV 34.64 -86.77 C Huntsville
MGM 32.30 -86.39 C Montgomery
MOB 30.69 -88.24 C Mobile
GPT 30.41 -89.07 C Gulfport–Biloxi
MSY 29.99 -90.26 C New Orleans
BTR 30.53 -91.15 C Baton Rouge
LFT 30.21 -91.99 C Lafayette
JAN 32.31 -90.08 C Jackson
LIT 34.73 -92.22 C Little Rock
XNA 36.28 -94.31 C Northwest Arkansas
SHV 32.45 -93.83 C Shreveport
ORD 41.98 -87.90 C Chicago O'Hare
MDW 41.79 -87.75 C Chicago Midway
MKE 42.95 -87.90 C Milwaukee
MSN 43.14 -89.34 C Madison
MSP 44.88 -93.22 C Minneapolis
DSM 41.53 -93.66 C Des Moines
CID 41.88 -91.71 C Cedar Rapids
OMA 41.30 -95.89 C Omaha
MCI 39.30 -94.71 C Kansas City
STL 38.75 -90.37 C St. Louis
SGF 37.25 -93.39 C Springfield
FSD 43.58 -96.74 C Sioux Falls
FAR 46.92 -96.82 C Fargo
DFW 32.90 -97.04 C Dallas–Fort Worth
DAL 32.85 -96.85 C Dallas Love
IAH 29.99 -95.34 C Houston
HOU 29.65 -95.28 C Houston Hobby
AUS 30.19 -97.67 C Austin
SAT 29.53 -98.47 C San Antonio
OKC 35.39 -97.60 C Oklahoma City
TUL 36.20 -95.89 C Tulsa
ICT 37.65 -97.43 C Wichita
DEN 39.86 -104.67 M Denver
COS 38.81 -104.70 M Colorado Springs
EGE 39.64 -106.92 M Vail
ABQ 35.04 -106.61 M Albuquerque
ELP 31.81 -106.38 M El Paso
SLC 40.79 -111.98 M Salt Lake City
BOI 43.56 -116.22 M Boise
BZN 45.78 -111.15 M Bozeman
JAC 43.61 -110.74 M Jackson Hole
PHX 33.43 -112.01 A Phoenix
TUS 32.12 -110.94 A Tucson
LAS 36.08 -115.15 P Las Vegas
LAX 33.94 -118.41 P Los Angeles
LGB 33.82 -118.15 P Long Beach
BUR 34.20 -118.36 P Burbank
ONT 34.06 -117.60 P Ontario
SNA 33.68 -117.87 P Orange County
SAN 32.73 -117.19 P San Diego
PSP 33.83 -116.51 P Palm Springs
SFO 37.62 -122.38 P San Francisco
OAK 37.72 -122.22 P Oakland
SJC 37.36 -121.93 P San Jose
SMF 38.70 -121.59 P Sacramento
RNO 39.50 -119.77 P Reno
SEA 47.45 -122.31 P Seattle
PDX 45.59 -122.60 P Portland
GEG 47.62 -117.53 P Spokane
ANC 61.17 -150.00 K Anchorage
HNL 21.32 -157.92 H Honolulu
OGG 20.90 -156.43 H Maui
KOA 19.74 -156.05 H Kona
SJU 18.44 -66.00 R San Juan
STT 18.34 -64.97 America/St_Thomas St. Thomas
STX 17.70 -64.80 America/St_Thomas St. Croix
NAS 25.04 -77.47 America/Nassau Nassau
CUN 21.04 -86.87 America/Cancun Cancún
CZM 20.52 -86.93 America/Cancun Cozumel
MEX 19.44 -99.07 America/Mexico_City Mexico City
GDL 20.52 -103.31 America/Mexico_City Guadalajara
PVR 20.68 -105.25 America/Bahia_Banderas Puerto Vallarta
SJD 23.15 -109.72 America/Mazatlan Los Cabos
MBJ 18.50 -77.91 America/Jamaica Montego Bay
PUJ 18.57 -68.36 America/Santo_Domingo Punta Cana
SDQ 18.43 -69.67 America/Santo_Domingo Santo Domingo
AUA 12.50 -70.02 America/Aruba Aruba
SXM 18.04 -63.11 America/Lower_Princes St. Maarten
GCM 19.29 -81.36 America/Cayman Grand Cayman
BZE 17.54 -88.31 America/Belize Belize City
LIR 10.59 -85.54 America/Costa_Rica Liberia
SJO 9.99 -84.20 America/Costa_Rica San José
BDA 32.36 -64.68 Atlantic/Bermuda Bermuda
YYZ 43.68 -79.63 America/Toronto Toronto
YUL 45.47 -73.74 America/Toronto Montréal
YVR 49.19 -123.18 America/Vancouver Vancouver
`;
const AIRPORTS = {};
AIRPORT_DATA.trim().split('\n').forEach((line) => {
  const [code, lat, lon, tz, ...city] = line.trim().split(/\s+/);
  AIRPORTS[code] = { code, lat: +lat, lon: +lon, tz: TZ[tz] || tz, city: city.join(' ') };
});
const airportInfo = (c) => AIRPORTS[c] || null;

// ── Per-isolate memory cache ──
const mem = { cal: null, lastFail: 0, failMsg: '', kvHash: '', wx: {}, live: {} };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ ok: false, error: 'Method not allowed' }, 405);
    try {
      if (url.pathname === '/' || url.pathname === '') {
        return json({ name: 'rob-flight-tracker-worker', version: VERSION, endpoints: ['/api/status', '/health'] });
      }
      if (url.pathname === '/health') return json({ ok: true, version: VERSION, now: Date.now() });
      if (url.pathname === '/api/status') return json(await buildStatus(env, ctx, url), 200, { 'Cache-Control': 'no-store' });
      return json({ ok: false, error: 'Not found' }, 404);
    } catch (err) {
      return json({ ok: false, version: VERSION, generatedAt: Date.now(), error: String((err && err.message) || err) }, 500);
    }
  }
};

// ───────────────────────── status ─────────────────────────
async function buildStatus(env, ctx, url) {
  const now = Date.now();
  const cal = await getSchedule(env, ctx, now);
  const sch = cal.schedule;

  const rotations = sch.rotations.filter((r) => r.lastArr >= now - 5 * DAY && r.start <= now + 90 * DAY);
  const keepIds = new Set();
  rotations.forEach((r) => r.legIds.forEach((id) => keepIds.add(id)));
  const legs = sch.legs.filter((l) => keepIds.has(l.id));

  // Only commute flights (CHS⇄ATL around a trip) are shared from personal Flighty events.
  const commuteLegs = [];
  (sch.personal || []).forEach((l) => {
    rotations.forEach((r) => {
      if (l.origin === HOME && l.dep >= r.start - 12 * HOUR && l.arr <= r.firstDep) commuteLegs.push({ ...l, rotationId: r.id, direction: 'to-work' });
      if (l.dest === HOME && l.dep >= r.lastArr && l.dep <= r.lastArr + 20 * HOUR) commuteLegs.push({ ...l, rotationId: r.id, direction: 'home' });
    });
  });

  const station = P.currentStation({ legs: sch.legs, rotations: sch.rotations }, now, CFG);
  const active = sch.rotations.find((r) => now >= r.start - 4 * HOUR && now < r.lastArr + 8 * HOUR);

  const codes = new Set([HOME, BASE, station]);
  legs.forEach((l) => { codes.add(l.origin); codes.add(l.dest); });
  commuteLegs.forEach((l) => { codes.add(l.origin); codes.add(l.dest); });
  const airports = {};
  codes.forEach((c) => { airports[c] = AIRPORTS[c] || { code: c, city: c, tz: null, lat: null, lon: null }; });

  // Weather for where Rob is, plus the stops of the active trip so the page
  // always has current-location weather as he moves between polls.
  const wxCodes = new Set([station]);
  if (active) {
    const byId = Object.fromEntries(sch.legs.map((l) => [l.id, l]));
    active.legIds.forEach((id) => { const l = byId[id]; if (l) { wxCodes.add(l.origin); wxCodes.add(l.dest); } });
  } else wxCodes.add(HOME);
  const weather = await getWeather([...wxCodes].filter((c) => AIRPORTS[c]));

  const live = {};
  const airborne = legs.filter((l) => now >= l.dep - 15 * MIN && now <= l.arr + 20 * MIN).slice(0, 2);
  await Promise.all(airborne.map(async (l) => { const d = await getLive(l); if (d) live[l.id] = d; }));

  const out = {
    ok: true, version: VERSION, generatedAt: now,
    staleCache: !!cal.stale,
    calendar: {
      configured: !!env.CALENDAR_WEBCAL_URL, source: cal.source, fetchedAt: cal.fetchedAt,
      error: cal.error || null, eventCount: cal.eventCount || 0, kv: !!env.SCHEDULE_KV
    },
    config: { home: HOME, base: BASE, homeTz: HOME_TZ },
    currentStation: station,
    airports, legs, rotations, commuteLegs, weather, live,
    notes: sch.notes || {}
  };

  // Debug view of raw events — only for someone who already knows the feed URL.
  const token = calToken(env);
  if (token && url.searchParams.get('debug') === token && cal.events) {
    out.rawEvents = cal.events
      .filter((e) => { const t = P.icsTime(e.start, HOME_TZ); return t && t > now - 25 * DAY && t < now + 45 * DAY; })
      .slice(0, 120);
  }
  return out;
}

// ───────────────────────── calendar ─────────────────────────
function normalizeCalUrl(u) { return String(u || '').trim().replace(/^webcals?:\/\//i, 'https://'); }
function calToken(env) { const u = normalizeCalUrl(env.CALENDAR_WEBCAL_URL); return u ? u.split('/').pop().slice(0, 12) : ''; }
function emptySchedule() { return { legs: [], personal: [], rotations: [], notes: {} }; }

async function getSchedule(env, ctx, now) {
  if (mem.cal && !mem.cal.stale && now - mem.cal.fetchedAt < CAL_TTL) return mem.cal;
  if (mem.lastFail && now - mem.lastFail < CAL_RETRY) return fallback(env, mem.failMsg);
  const src = normalizeCalUrl(env.CALENDAR_WEBCAL_URL);
  if (!src) return fallback(env, 'CALENDAR_WEBCAL_URL secret is not set on the Worker');
  try {
    const res = await fetchWithTimeout(src, { headers: { Accept: 'text/calendar, */*' } }, 10000);
    if (!res.ok) throw new Error('Calendar feed returned HTTP ' + res.status);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Calendar feed did not return .ics data');
    const events = P.parseICS(text);
    const schedule = P.buildSchedule(events, { airport: airportInfo, base: BASE, home: HOME, homeTz: HOME_TZ, layoverMinHours: 9 });
    const rec = { schedule, fetchedAt: now, stale: false, source: 'live', error: null, eventCount: events.length, events };
    mem.cal = rec; mem.lastFail = 0; mem.failMsg = '';
    if (env.SCHEDULE_KV) ctx.waitUntil(saveKv(env, schedule, now));
    return rec;
  } catch (err) {
    mem.lastFail = now;
    mem.failMsg = (err && err.name === 'AbortError') ? 'Calendar feed timed out' : String((err && err.message) || err);
    return fallback(env, mem.failMsg);
  }
}

async function fallback(env, msg) {
  if (mem.cal) return { ...mem.cal, stale: true, source: 'memory-cache', error: msg };
  if (env.SCHEDULE_KV) {
    try {
      const saved = await env.SCHEDULE_KV.get(KV_KEY, 'json');
      if (saved && saved.schedule) return { schedule: saved.schedule, fetchedAt: saved.fetchedAt, stale: true, source: 'kv-cache', error: msg, eventCount: saved.eventCount || 0 };
    } catch (e) { /* ignore */ }
  }
  return { schedule: emptySchedule(), fetchedAt: null, stale: true, source: 'none', error: msg, eventCount: 0 };
}

async function saveKv(env, schedule, now) {
  try {
    const body = JSON.stringify({ legs: schedule.legs, personal: schedule.personal, rotations: schedule.rotations });
    const hash = await sha1(body);
    if (hash === mem.kvHash) return;
    const prev = await env.SCHEDULE_KV.get(KV_KEY + ':hash');
    mem.kvHash = hash;
    if (prev === hash) return; // unchanged → no KV write (free tier friendly)
    await env.SCHEDULE_KV.put(KV_KEY, JSON.stringify({ schedule, fetchedAt: now }));
    await env.SCHEDULE_KV.put(KV_KEY + ':hash', hash);
  } catch (e) { /* best effort */ }
}

async function sha1(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────────────────────── weather (Open-Meteo, °F) ─────────────────────────
const WMO = {
  0: ['Clear', '☀️', '🌙'], 1: ['Mostly clear', '🌤️', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Freezing fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'], 61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'], 71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'],
  77: ['Snow grains', '🌨️'], 80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Heavy showers', '⛈️'], 85: ['Snow showers', '🌨️'],
  86: ['Snow showers', '❄️'], 95: ['Thunderstorms', '⛈️'], 96: ['Thunderstorms & hail', '⛈️'], 99: ['Thunderstorms & hail', '⛈️']
};

async function getWeather(codes) {
  const now = Date.now(), out = {}, need = [];
  codes.forEach((c) => { const m = mem.wx[c]; if (m && now - m.at < WX_TTL) out[c] = m; else need.push(c); });
  if (!need.length) return out;
  const lat = need.map((c) => AIRPORTS[c].lat).join(','), lon = need.map((c) => AIRPORTS[c].lon).join(',');
  const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day' +
    '&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=auto';
  try {
    const r = await fetchWithTimeout(u, {}, 6000);
    if (!r.ok) throw new Error('weather HTTP ' + r.status);
    const j = await r.json();
    (Array.isArray(j) ? j : [j]).forEach((w, i) => {
      const c = need[i], cur = (w && w.current) || {};
      const meta = WMO[cur.weather_code] || ['—', '🌡️'];
      const rec = {
        airport: c, tempF: Math.round(cur.temperature_2m), feelsF: Math.round(cur.apparent_temperature),
        code: cur.weather_code, text: meta[0], icon: (!cur.is_day && meta[2]) || meta[1],
        windKts: Math.round(cur.wind_speed_10m), windDir: cur.wind_direction_10m, isDay: !!cur.is_day, unit: '°F', at: now
      };
      if (Number.isFinite(rec.tempF)) { mem.wx[c] = rec; out[c] = rec; }
    });
  } catch (e) {
    need.forEach((c) => { if (mem.wx[c]) out[c] = { ...mem.wx[c], stale: true }; });
  }
  return out;
}

// ───────────────────────── live flight (best effort, free) ─────────────────────────
const ICAO = { DL: 'DAL', AA: 'AAL', UA: 'UAL', WN: 'SWA', B6: 'JBU', AS: 'ASA', NK: 'NKS', F9: 'FFT', '9E': 'EDV', OO: 'SKW', YX: 'RPA', MQ: 'ENY', HA: 'HAL' };

async function getLive(leg) {
  const prefix = ICAO[leg.airline];
  if (!prefix) return null;
  const cs = prefix + leg.number;
  const m = mem.live[cs];
  if (m && Date.now() - m.at < LIVE_TTL) return m.data;
  let data = null;
  for (const base of ['https://api.airplanes.live/v2/callsign/', 'https://api.adsb.lol/v2/callsign/']) {
    try {
      const r = await fetchWithTimeout(base + cs, { headers: { Accept: 'application/json' } }, 4000);
      if (!r.ok) continue;
      const j = await r.json();
      const ac = (j.ac || j.aircraft || [])[0];
      if (!ac) continue;
      const onGround = ac.alt_baro === 'ground';
      data = {
        source: new URL(base).hostname, callsign: cs, onGround,
        altFt: onGround ? 0 : (typeof ac.alt_baro === 'number' ? ac.alt_baro : (ac.alt_geom ?? null)),
        gsKts: typeof ac.gs === 'number' ? Math.round(ac.gs) : null,
        lat: ac.lat ?? null, lon: ac.lon ?? null, track: ac.track ?? null,
        reg: ac.r || null, type: ac.t || null, seenAt: Date.now() - Math.round((ac.seen || 0) * 1000)
      };
      break;
    } catch (e) { /* try next source */ }
  }
  mem.live[cs] = { at: Date.now(), data };
  return data;
}

// ───────────────────────── helpers ─────────────────────────
async function fetchWithTimeout(resource, init, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(resource, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(timer); }
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(), ...extra } });
}
