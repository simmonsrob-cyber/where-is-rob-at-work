# ▲ Where Is Rob At Work? (v1)

A Delta-themed, landscape iPad / widescreen dashboard that shows where Rob is during his
work trips — from his MiCrew calendar — with a live runway → clouds → runway animation,
trip telemetry, today's itinerary, an early-show bedtime cue and "what's next".

| Piece | Where it lives | Cost |
|---|---|---|
| Dashboard (static) | GitHub Pages — `https://simmonsrob-cyber.github.io/where-is-rob-at-work/` | Free |
| API | Cloudflare Worker — `https://rob-flight-tracker-worker.simmons-rob.workers.dev/api/status` | Free tier |
| Last-good schedule cache | Workers KV namespace `rob-schedule-cache` (binding `SCHEDULE_KV`) | Free tier |
| Weather (°F) | Open-Meteo, no key | Free |
| Live altitude / groundspeed | airplanes.live → adsb.lol by callsign, best-effort | Free |

```
iCloud MiCrew calendar ──► Worker (parse + cache + weather + ADS-B) ──► /api/status ──► GitHub Pages dashboard
   (CALENDAR_WEBCAL_URL secret)                                            (polls every 60 s)
```

## Files

```
index.html               Dashboard shell (PWA-capable, Wake Lock)
css/styles.css           Delta navy / crimson theme, three-zone landscape layout
js/config.js             WORKER_URL + home/base/timing settings
js/app.js                State machine, rendering, polling, Settings drawer, Test Preview
js/parser.js             Shared .ics parser (browser + Worker) for MiCrew & Flighty events
js/animation.js          Canvas panorama: commute, boarding, flight arc, turns, taxi to hotel, standby sprint, gate
js/chatter.js            Airplane! one-liners, passenger/pilot banter, fake ATC, thoughts of home
worker/worker.js         Cloudflare Worker (GET /api/status, /health) with CORS
worker/wrangler.toml     Worker config (name, KV binding)
.github/workflows/deploy.yml   Pages deploy on push; Worker deploy when Cloudflare secrets exist
deploy.sh                CLI deploy: Worker → wire URL → push
```

## What the calendar looks like (MiCrew → iCloud)

One event per leg, timed in `America/New_York`, plus one "Rotation Report" event per trip:

```
SUMMARY: Rotation Report ATL 0443        DESCRIPTION: 2 Days | Rpt- 1300 07NOV | Rls- 0919 08NOV | Layover- GPT
SUMMARY: DL2718 : ATL - GPT              DESCRIPTION: Dep- 1350 07NOV Gate- A15 | Arr- 1402 07NOV -1hr Gate- 05
                                                      Blk- 1:12 Eqp/Ship- 717/9570 | LAYOVER 14:54/GPT
                                                      BEAU RIVAGE RESORT AND CASINO: 228-386-7407
SUMMARY: D DL1737 : ATL - CHA            (deadhead — "D DL1737 ATL-CHA" also accepted)
SUMMARY: DL3155 : GPT - ATL              DESCRIPTION: Rpt- 0526 08NOV …
```

Flighty events (timezone-aware `DTSTART`/`DTEND`) in the same calendar are matched by flight
number + route + date and used as the authoritative times; unmatched Flighty CHS⇄ATL flights
around a trip show up as Rob's commute.

## State machine (active trip only; 30-minute hotel drives)

| State | When |
|---|---|
| `TRAVELING_TO_WORK` | Report − 4 h → report (commuting CHS → ATL) |
| `LONG_TURN_HANGOUT` (preflight) | Report → first boarding; and arrive-at-airport → boarding after a hotel |
| `BOARDING` | Takeoff − 40 min → takeoff (deadhead: "Contactable & chilling in the back of the plane") |
| `IN_FLIGHT` | Takeoff → landing, 0–100 % |
| `DEPLANING` | Landing → +10 min |
| `SHORTENED_TURN` | Ground ≤ 45 min: after deplaning, until takeoff |
| `LONG_TURN_HANGOUT` | Ground > 45 min: after deplaning, until takeoff − 40 min |
| `DRIVING_TO_HOTEL` | Landing + 10 → +40 min (layover ≥ 9 h or a LAYOVER line) |
| `AT_HOTEL` | Until next takeoff − 90 min (zero-flight ~30 h days stay here) |
| `DRIVING_TO_AIRPORT` | Next takeoff − 90 → − 60 min |
| `RUNNING_FOR_STANDBY_HOME` | Final landing + 10 → +40 min |
| `COMMUTING_HOME` | Final landing + 40 min → home (8 h cap, or until a listed CHS commute flight lands) |
| `AT_HOME` | No active trip |

Tunables live in `js/config.js` (`COMMUTE_HOME_HOURS`, `LAYOVER_MIN_HOURS`, `EARLY_WAKEUP_CUTOFF_HOUR`, …).
"Tomorrow" shows an **Early Bedtime / Early Wake-Up** cue whenever the next day's first takeoff is before 07:00 local.

## Using the dashboard

* **iPad:** open the Pages URL in Safari → Share → *Add to Home Screen*. Landscape, full screen; the screen stays awake (Wake Lock, iPadOS 16.4+).
* **⚙︎ Settings:** paste a different Worker URL (saved in that browser's `localStorage`), test the connection, toggle keep-awake and chatter.
* **Test Preview (Sped-Up):** walks a sample trip through every state in ~2 minutes (uses the real parser on a sample MiCrew calendar). Tap **Exit Test** to return to live data.
* A banner explains anything wrong: Worker URL missing/unreachable, or the calendar feed down (then the last cached schedule is shown and marked *Cached*).

## Deploying / updating

**GitHub Pages** deploys automatically on every push to `main` (Actions → *Deploy*).

**Worker** — any one of:
1. `./deploy.sh` (Wrangler CLI; logs in through the browser the first time).
2. Add repo secrets `CLOUDFLARE_API_TOKEN` (Workers edit permission) and `CLOUDFLARE_ACCOUNT_ID`; every push then redeploys the Worker too.
3. Cloudflare dashboard → Workers & Pages → `rob-flight-tracker-worker` → *Edit code* → paste `js/parser.js` followed by `worker/worker.js` (minus its first `import` line) → Deploy.

**Change the calendar link:** dashboard → Worker → Settings → Variables and Secrets → `CALENDAR_WEBCAL_URL` → Rotate,
or `cd worker && npx wrangler secret put CALENDAR_WEBCAL_URL`. `webcal://` links are fine — the Worker switches them to `https://`.

## API

`GET /api/status` → `{ ok, generatedAt, staleCache, calendar{source,fetchedAt,error,eventCount}, currentStation,
airports{}, legs[], rotations[], commuteLegs[], weather{CODE:{tempF,…}}, live{legId:{altFt,gsKts,…}} }`
(all with `Access-Control-Allow-Origin: *`). `GET /health` → liveness.

## Troubleshooting

* **Banner says the calendar is unreachable** — check the iCloud calendar is still *Public Calendar* in Calendar → Share settings; if the link changed, rotate the secret.
* **Altitude says "est."** — no free ADS-B fix for that callsign right now; values are estimated from the schedule.
* **Times look off** — legs use the calendar's own timezones; airport local times come from the table in `worker/worker.js`.

## Privacy

The dashboard and `/api/status` are public URLs: anyone with the link can see trip times, cities and hotel names.
The calendar link itself stays secret inside the Worker and is never sent to the browser.
