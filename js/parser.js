/*!
 * Where Is Rob At Work? — shared calendar parser (v1)
 *
 * One file, two homes:
 *   • Browser  → window.RobParser   (used by the Test Preview sample trip)
 *   • Worker   → globalThis.RobParser (bundled into rob-flight-tracker-worker)
 *
 * Understands an iCloud .ics feed that mixes:
 *   • MiCrew trip blocks  — "Rpt- 0545 26NOV", "DL1234 ATL-CHS 07:15-08:45 717",
 *                           ": D DL1737 : ATL - CHA" / "D DL1737 ATL-CHA" (deadheads),
 *                           "LAYOVER 30:40/MSY", "HOTEL <NAME>: <PHONE>"
 *   • Flighty flight events — timezone-aware DTSTART/DTEND, used as the
 *                           authoritative UTC times and enriched with MiCrew data.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.RobParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  var MON_RE = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';

  // ───────────────────────── time-zone helpers ─────────────────────────
  var dtfCache = {};
  function dtf(tz) {
    if (!dtfCache[tz]) {
      dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    return dtfCache[tz];
  }
  function validTz(tz) {
    if (!tz) return false;
    try { dtf(tz); return true; } catch (e) { return false; }
  }
  function cleanTzid(t) {
    if (validTz(t)) return t;
    var m = /([A-Za-z]+\/[A-Za-z_\-]+(?:\/[A-Za-z_\-]+)?)$/.exec(String(t || ''));
    return m && validTz(m[1]) ? m[1] : '';
  }
  function localParts(ms, tz) {
    var o = {};
    dtf(tz).formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month - 1, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: o.weekday };
  }
  function tzOffset(tz, ms) {
    var p = localParts(ms, tz);
    return (Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / MIN;
  }
  /** Wall-clock time in `tz` → UTC epoch ms. */
  function zonedToUtc(y, mo, d, h, mi, tz) {
    var guess = Date.UTC(y, mo, d, h, mi);
    if (!tz || tz === 'UTC') return guess;
    var off = tzOffset(tz, guess);
    var t = guess - off * MIN;
    var off2 = tzOffset(tz, t);
    return off2 === off ? t : guess - off2 * MIN;
  }
  function localDate(ms, tz) { var p = localParts(ms, tz); return { y: p.y, mo: p.mo, d: p.d }; }
  function addDays(date, k) {
    var t = new Date(Date.UTC(date.y, date.mo, date.d + k));
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate() };
  }
  function dayKey(ms, tz) { var p = localParts(ms, tz); return p.y * 10000 + (p.mo + 1) * 100 + p.d; }
  function timeOnDate(date, t, tz) {
    return t.z ? Date.UTC(date.y, date.mo, date.d, t.h, t.mi) : zonedToUtc(date.y, date.mo, date.d, t.h, t.mi, tz);
  }

  // ───────────────────────── raw .ics parsing ─────────────────────────
  function unfold(text) { return String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, ''); }
  function unescapeText(v) { return String(v).replace(/\\n/gi, '\n').replace(/\\([,;:\\])/g, '$1'); }
  function parseProp(line) {
    var inQ = false, i;
    for (i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') inQ = !inQ;
      else if (c === ':' && !inQ) break;
    }
    if (i >= line.length) return null;
    var parts = line.slice(0, i).split(';');
    var params = {};
    for (var k = 1; k < parts.length; k++) {
      var eq = parts[k].indexOf('=');
      if (eq > 0) params[parts[k].slice(0, eq).toUpperCase()] = parts[k].slice(eq + 1).replace(/^"|"$/g, '');
    }
    return { name: parts[0].toUpperCase(), params: params, value: line.slice(i + 1) };
  }
  function dtProp(p) {
    if (!p) return null;
    var v = String(p.value || '').trim();
    return { value: v, tzid: p.params.TZID || '', isDate: p.params.VALUE === 'DATE' || /^\d{8}$/.test(v) };
  }
  /** Parse an .ics string into plain VEVENT objects. */
  function parseICS(text) {
    var out = [], cur = null, nest = 0;
    unfold(text).split('\n').forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line) return;
      var up = line.toUpperCase();
      if (up === 'BEGIN:VEVENT') { cur = {}; nest = 0; return; }
      if (!cur) return;
      if (up === 'END:VEVENT') {
        var txt = function (n) { return cur[n] ? unescapeText(cur[n].value) : ''; };
        out.push({
          uid: txt('UID'), summary: txt('SUMMARY'), description: txt('DESCRIPTION'),
          location: txt('LOCATION'), url: txt('URL'),
          start: dtProp(cur.DTSTART), end: dtProp(cur.DTEND), status: txt('STATUS')
        });
        cur = null;
        return;
      }
      if (up.indexOf('BEGIN:') === 0) { nest++; return; }
      if (up.indexOf('END:') === 0) { nest = Math.max(0, nest - 1); return; }
      if (nest) return;
      var p = parseProp(line);
      if (p && !cur[p.name]) cur[p.name] = p;
    });
    return out;
  }
  /** DTSTART/DTEND → UTC ms. Floating & all-day values use `fallbackTz`. */
  function icsTime(dt, fallbackTz) {
    if (!dt) return null;
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(dt.value);
    if (!m) { var t = Date.parse(dt.value); return isNaN(t) ? null : t; }
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (!m[4]) return zonedToUtc(y, mo, d, 0, 0, fallbackTz);
    var s = +(m[6] || 0) * 1000;
    if (m[7]) return Date.UTC(y, mo, d, +m[4], +m[5]) + s;
    return zonedToUtc(y, mo, d, +m[4], +m[5], cleanTzid(dt.tzid) || fallbackTz) + s;
  }

  // ───────────────────────── line patterns ─────────────────────────
  var RE_FLIGHT = /(?:^|[\s:(\[|•,;])(?:(DH|DHD|DEADHEAD|Deadhead|D)[\s:]+)?([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b[\s:·•|,\-]*([A-Z]{3})\s*(?:-|–|—|→|->|>|to)\s*([A-Z]{3})\b(.*)$/;
  var RE_TIMES = /(\d{1,2}):?(\d{2})\s*([LZ])?\s*(?:-|–|—|→|to)\s*(\d{1,2}):?(\d{2})\s*([LZ])?/;
  var RE_EQUIP = /\b(B?717|71Y|A?3(?:19|20|21|2N|3N|N1)|A?2(?:21|23)|7(?:38|39|3H|3J|52|53|57|63|64|6[A-Z])|A?3(?:32|33|39|59|51))\b/;
  var RE_RPT = new RegExp('\\b(?:Rpt|RPT|Report|REPORT)\\b\\.?[ \\t]*-?[ \\t]*:?[ \\t]*(\\d{1,2}):?(\\d{2})[ \\t]*([LZ])?(?:[ \\t]+(\\d{1,2})[ \\t]?(' + MON_RE + ')(\\d{2,4})?)?', 'i');
  var RE_DATE = new RegExp('\\b(\\d{1,2})\\s?(' + MON_RE + ')(?:\\s?(\\d{4}|\\d{2}))?\\b', 'i');
  var RE_LAYOVER = /\bLAY(?:OVER)?\b\s*:?\s*(\d{1,3}):?(\d{2})\s*\/\s*([A-Z]{3})\b/i;
  var RE_LAYOVER2 = /\bLAY(?:OVER)?\b\s*:?\s*([A-Z]{3})\s+(\d{1,3}):(\d{2})/i;
  var PHONE = '(\\+?1?[\\s.\\-]?\\(?\\d{3}\\)?[\\s.\\-]?\\d{3}[\\s.\\-]?\\d{4}(?:\\s*(?:x|ext\\.?)\\s*\\d+)?)';
  // MiCrew hotel line: "BEAU RIVAGE RESORT AND CASINO:<tab>228-386-7407" (also "HOTEL <NAME>: <PHONE>")
  var RE_HOTEL_LINE = new RegExp('^([A-Za-z0-9&\'’.,/()\\- ]{3,80}?)\\s*:\\s*' + PHONE + '\\s*$');
  var RE_HOTEL = /\bHOTEL\b\s*:?\s*(.+)$/i;
  var RE_PHONE = new RegExp('^(.*?)[\\s:,\\-–]*' + PHONE + '\\s*$', 'i');
  var RE_EQP = /\bEqp(?:\/Ship)?\s*-?\s*:?\s*([A-Z0-9]{2,4})(?:\s*\/\s*([A-Z0-9]{2,6}))?/i;
  var RE_DEPGATE = /\bDep\b.*?\bGate\s*-?\s*:?\s*([A-Z0-9]{1,5})\b/i;
  var RE_ARRGATE = /\bArr\b.*?\bGate\s*-?\s*:?\s*([A-Z0-9]{1,5})\b/i;
  var RE_ROT = /\bRotation\s+Report\b\s*([A-Z]{3})?\s*([A-Z0-9]{2,6})?/i;
  var RE_RLS = new RegExp('\\b(?:Rls|Release)\\b[ \\t]*-?[ \\t]*:?[ \\t]*(\\d{1,2}):?(\\d{2})[ \\t]*(?:(\\d{1,2})[ \\t]?(' + MON_RE + '))?', 'i');
  var RE_DAYS = /\b(\d{1,2})\s+Days?\b/i;
  var RE_LAYLIST = /\bLayover-\s*([A-Z]{3}(?:\s*,\s*[A-Z]{3})*)/;

  function parseFlightLine(line) {
    var m = RE_FLIGHT.exec(line);
    if (!m) return null;
    var rest = m[6] || '';
    var f = {
      type: 'flight', airline: m[2].toUpperCase(), number: String(+m[3]),
      origin: m[4], dest: m[5], depT: null, arrT: null, equipment: '',
      isDeadhead: !!m[1] || /\b(DH|DHD|DEADHEAD)\b/i.test(line) || /^\s*:?\s*D\s*:/.test(line)
    };
    f.flightNumber = f.airline + f.number;
    var t = RE_TIMES.exec(rest);
    if (t) {
      f.depT = { h: +t[1], mi: +t[2], z: (t[3] || '').toUpperCase() === 'Z' };
      f.arrT = { h: +t[4], mi: +t[5], z: (t[6] || t[3] || '').toUpperCase() === 'Z' };
      rest = rest.replace(t[0], ' ');
    }
    var e = RE_EQUIP.exec(rest.toUpperCase());
    if (e) f.equipment = e[1].replace(/^B(?=7)/, '');
    return f;
  }
  function parseDate(m) { return m ? { d: +m[1], mo: MONTHS[m[2].toUpperCase()], y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null } : null; }
  function resolveYear(dt, refMs) {
    if (dt.y) return { y: dt.y, mo: dt.mo, d: dt.d };
    var ry = new Date(refMs).getUTCFullYear(), best = null;
    [ry - 1, ry, ry + 1].forEach(function (y) {
      var diff = Math.abs(Date.UTC(y, dt.mo, dt.d) - refMs);
      if (!best || diff < best.diff) best = { y: y, diff: diff };
    });
    return { y: best.y, mo: dt.mo, d: dt.d };
  }
  function parseGateInfo(text) {
    var info = {};
    var gates = [], g, re = /\bGate\s*:?\s*([A-Z]{0,2}\s?\d{1,3}[A-Z]?)\b/gi;
    while ((g = re.exec(text))) gates.push(g[1].replace(/\s+/g, '').toUpperCase());
    if (gates[0]) info.depGate = gates[0];
    if (gates[1]) info.arrGate = gates[1];
    var t = /\bTerminal\s*:?\s*([A-Z0-9]{1,3})\b/i.exec(text);
    if (t) info.terminal = t[1].toUpperCase();
    var pk = /\b(Parking|Ramp|Stand|Spot|Hardstand)\b\s*:?\s*([A-Z0-9\-]{1,8})\b/i.exec(text);
    if (pk) info[pk[1].toLowerCase() === 'ramp' ? 'ramp' : 'parking'] = pk[2].toUpperCase();
    return info;
  }

  /** Break one VEVENT into ordered work items (flights, reports, layovers, hotels, date headers). */
  function analyzeEvent(ev) {
    var text = [ev.summary, ev.description, ev.location].filter(Boolean).join('\n');
    var isFlighty = /flighty/i.test(text + ' ' + (ev.url || '') + ' ' + (ev.uid || ''));
    var items = [], seen = {}, meta = {};
    var rot = RE_ROT.exec(ev.summary || '');
    if (rot) {
      meta.rotation = { base: rot[1] ? rot[1].toUpperCase() : '', pairing: rot[2] || '' };
      var dd = RE_DAYS.exec(text); if (dd) meta.rotation.days = +dd[1];
      var rl = RE_RLS.exec(text);
      if (rl) meta.rotation.rls = { t: { h: +rl[1], mi: +rl[2] }, date: rl[4] ? parseDate([0, rl[3], rl[4]]) : null };
      var ll = RE_LAYLIST.exec(text);
      if (ll) meta.rotation.layoverStations = ll[1].split(/\s*,\s*/);
      var rr = RE_RPT.exec(text);
      if (rr) meta.rotation.rpt = { t: { h: +rr[1], mi: +rr[2] }, date: rr[5] ? parseDate([0, rr[4], rr[5], rr[6]]) : null };
      return { items: [], isFlighty: false, gate: {}, meta: meta };
    }
    text.split('\n').forEach(function (raw) {
      var line = raw.replace(/ /g, ' ').replace(/\t+/g, '  ').trim();
      if (!line) return;
      var eq = RE_EQP.exec(line);
      if (eq) { meta.eqp = eq[1].toUpperCase(); if (eq[2]) meta.ship = eq[2].toUpperCase(); }
      var dg = RE_DEPGATE.exec(line); if (dg) meta.depGate = dg[1].toUpperCase();
      var ag = RE_ARRGATE.exec(line); if (ag) meta.arrGate = ag[1].toUpperCase();
      var dm = RE_DATE.exec(line);
      var r = RE_RPT.exec(line);
      if (r) {
        items.push({ type: 'report', t: { h: +r[1], mi: +r[2], z: (r[3] || '').toUpperCase() === 'Z' },
          date: r[5] ? parseDate([0, r[4], r[5], r[6]]) : null });
        return;
      }
      var f = parseFlightLine(line);
      if (f) {
        var key = f.flightNumber + f.origin + f.dest;
        if (seen[key]) { if (f.depT && !seen[key].depT) { seen[key].depT = f.depT; seen[key].arrT = f.arrT; } return; }
        seen[key] = f;
        f.date = parseDate(dm);
        items.push(f);
        return;
      }
      var l = RE_LAYOVER.exec(line), l2 = !l && RE_LAYOVER2.exec(line);
      if (l) items.push({ type: 'layover', minutes: +l[1] * 60 + +l[2], station: l[3].toUpperCase() });
      else if (l2) items.push({ type: 'layover', minutes: +l2[2] * 60 + +l2[3], station: l2[1].toUpperCase() });
      var hl = !l && !l2 && RE_HOTEL_LINE.exec(line);
      if (hl && !/\b(Blk|Credit|TAFB|Dep|Arr|Rls)\b/i.test(hl[1])) {
        items.push({ type: 'hotel', name: hl[1].trim(), phone: hl[2].trim() });
        return;
      }
      var h = RE_HOTEL.exec(line);
      if (h) {
        var body = h[1].trim(), ph = RE_PHONE.exec(body);
        items.push({ type: 'hotel', name: (ph ? ph[1] : body).replace(/[\s:,\-–]+$/, '').trim(), phone: ph ? ph[2].trim() : '' });
        return;
      }
      if (!l && !l2 && dm && line.length <= 28) items.push({ type: 'date', date: parseDate(dm) });
    });
    var gate = parseGateInfo(text);
    if (meta.depGate) gate.depGate = meta.depGate;
    if (meta.arrGate) gate.arrGate = meta.arrGate;
    return { items: items, isFlighty: isFlighty, gate: gate, meta: meta };
  }

  // ───────────────────────── schedule building ─────────────────────────
  function legId(l) { return l.flightNumber + '_' + l.origin + l.dest + '_' + Math.round(l.dep / MIN); }
  function haversineNm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    var R = 3440.065, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /**
   * Turn parsed VEVENTs into legs + rotations.
   * opts: { airport(code) → {tz,lat,lon}, base:'ATL', home:'CHS', homeTz, layoverMinHours }
   */
  function buildSchedule(events, opts) {
    opts = opts || {};
    var BASE = opts.base || 'ATL', HOME = opts.home || 'CHS';
    var homeTz = opts.homeTz || 'America/New_York';
    var airport = opts.airport || function () { return null; };
    var layMin = (opts.layoverMinHours || 9) * HOUR;
    function tzFor(code) { var a = airport(code); return (a && a.tz) || homeTz; }
    function estimateMinutes(o, d) { var nm = haversineNm(airport(o), airport(d)); return nm ? Math.round(nm / 7.2 + 25) : 90; }

    var crew = [], flighty = [], calendarTimed = [], reports = [], rotDefs = [];
    var notes = { events: events.length, blocks: 0, timedFlights: 0, flighty: 0, reports: 0, rotationReports: 0 };

    events.forEach(function (ev) {
      if (/cancel/i.test(ev.status || '')) return;
      var a = analyzeEvent(ev);
      var start = icsTime(ev.start, homeTz), end = icsTime(ev.end, homeTz);
      var allDay = !!(ev.start && ev.start.isDate);

      // MiCrew "Rotation Report ATL 0443": report time + release time of a whole trip.
      if (a.meta.rotation) {
        var R = a.meta.rotation, base = R.base || BASE, btz = tzFor(base), ref = start != null ? start : Date.now();
        var rStart = start;
        if (R.rpt && R.rpt.date) rStart = timeOnDate(resolveYear(R.rpt.date, ref), R.rpt.t, btz);
        var rEnd = null;
        if (R.rls) {
          rEnd = timeOnDate(R.rls.date ? resolveYear(R.rls.date, ref) : localDate(ref, btz), R.rls.t, btz);
          if (rEnd < rStart) rEnd += DAY;
        }
        if (rStart != null) {
          rotDefs.push({ start: rStart, release: rEnd, pairing: R.pairing, base: base, days: R.days || null, layoverStations: R.layoverStations || [] });
          notes.rotationReports++;
        }
        return;
      }

      var flights = a.items.filter(function (i) { return i.type === 'flight'; });
      var hasWork = flights.length || a.items.some(function (i) { return i.type === 'report' || i.type === 'layover' || i.type === 'hotel'; });
      if (!hasWork) return;
      var hasLineTimes = flights.some(function (f) { return f.depT; });

      if (flights.length === 1 && !allDay && start != null && end != null && end > start &&
          end - start <= 20 * HOUR && (a.isFlighty || !hasLineTimes)) {
        var f = flights[0];
        var leg = mkLeg(f, start, end, a.isFlighty ? 'flighty' : 'micrew');
        leg.gate = a.gate;
        if (!leg.equipment && a.meta.eqp) leg.equipment = a.meta.eqp;
        if (a.meta.ship) leg.ship = a.meta.ship;
        // Per-leg extras MiCrew puts in the description: report, layover, hotel.
        var oTz = tzFor(f.origin);
        a.items.forEach(function (it) {
          if (it.type === 'report') {
            var t = timeOnDate(it.date ? resolveYear(it.date, start) : localDate(start, oTz), it.t, oTz);
            if (!it.date) { while (t > start) t -= DAY; }
            if (t <= start && start - t < 14 * HOUR) { reports.push({ t: t, station: f.origin }); notes.reports++; }
          } else if (it.type === 'layover') {
            leg.layover = Object.assign(leg.layover || {}, { minutes: it.minutes, station: it.station || f.dest });
          } else if (it.type === 'hotel') {
            leg.layover = Object.assign(leg.layover || { station: f.dest }, { hotelName: it.name, hotelPhone: it.phone });
          }
        });
        (a.isFlighty ? flighty : calendarTimed).push(leg);
        notes[a.isFlighty ? 'flighty' : 'timedFlights']++;
        return;
      }
      notes.blocks++;
      processBlock(a.items, start != null ? start : Date.now(), a.gate);
    });

    function mkLeg(f, dep, arr, source) {
      return {
        flightNumber: f.flightNumber, airline: f.airline, number: f.number,
        origin: f.origin, dest: f.dest, dep: dep, arr: arr,
        equipment: f.equipment || '', isDeadhead: !!f.isDeadhead, source: source,
        estimated: false, gate: {}, layover: null
      };
    }

    function processBlock(items, refMs, gate) {
      var ctx = localDate(refMs, tzFor(BASE)), fresh = true;
      var prev = null, pendingLayover = null, pendingReports = [];
      items.forEach(function (it) {
        if (it.type === 'date') { ctx = resolveYear(it.date, refMs); fresh = true; return; }
        if (it.type === 'report') {
          pendingReports.push({ t: it.t, date: it.date ? resolveYear(it.date, refMs) : (fresh ? ctx : null) });
          return;
        }
        if (it.type === 'layover') {
          if (prev && (!it.station || it.station === prev.dest)) prev.layover = Object.assign(prev.layover || {}, { minutes: it.minutes, station: it.station || prev.dest });
          pendingLayover = it.minutes;
          return;
        }
        if (it.type === 'hotel') {
          if (prev) prev.layover = Object.assign(prev.layover || { station: prev.dest }, { hotelName: it.name, hotelPhone: it.phone });
          return;
        }
        if (it.type !== 'flight') return;
        var oTz = tzFor(it.origin), dTz = tzFor(it.dest);
        var dateC = it.date ? resolveYear(it.date, refMs) : (fresh ? ctx : null);
        var dep, arr, estimated = false;
        if (it.depT) {
          if (dateC) {
            dep = timeOnDate(dateC, it.depT, oTz);
            if (prev && !it.date && dep < prev.arr) dep = nextAfter(prev.arr + 20 * MIN, it.depT, oTz, null);
          } else if (prev) {
            dep = nextAfter(prev.arr + 20 * MIN, it.depT, oTz, pendingLayover != null ? prev.arr + pendingLayover * MIN : null);
          } else {
            dep = timeOnDate(ctx, it.depT, oTz);
          }
          arr = timeOnDate(localDate(dep, dTz), it.arrT, dTz);
          while (arr <= dep) arr += DAY;
          while (arr - dep > 20 * HOUR) arr -= DAY;
        } else {
          estimated = true;
          dep = prev ? prev.arr + (pendingLayover != null ? pendingLayover * MIN : 60 * MIN)
                     : timeOnDate(dateC || ctx, { h: 12, mi: 0 }, oTz);
          arr = dep + estimateMinutes(it.origin, it.dest) * MIN;
        }
        var leg = mkLeg(it, dep, arr, 'micrew');
        leg.estimated = estimated;
        pendingReports.forEach(function (r) {
          var day = r.date || localDate(dep, oTz);
          var t = timeOnDate(day, r.t, oTz);
          if (!r.date) { while (t > dep) t -= DAY; while (dep - t > 14 * HOUR) t += DAY; }
          if (t <= dep && dep - t < 14 * HOUR) reports.push({ t: t, station: it.origin });
        });
        notes.reports += pendingReports.length;
        pendingReports = []; pendingLayover = null; fresh = false;
        prev = leg;
        crew.push(leg);
      });
    }

    function nextAfter(minMs, t, tz, target) {
      var base = localDate(minMs, tz), cands = [];
      for (var k = -1; k <= 3; k++) {
        var c = timeOnDate(addDays(base, k), t, tz);
        if (c >= minMs) cands.push(c);
      }
      if (!cands.length) return minMs;
      if (target == null) return Math.min.apply(null, cands);
      cands.sort(function (a, b) { return Math.abs(a - target) - Math.abs(b - target); });
      return cands[0];
    }

    // Merge: Flighty/calendar-timed legs give authoritative UTC times to MiCrew legs.
    var crewLegs = crew.concat(calendarTimed);
    var unmatched = [];
    flighty.forEach(function (t) {
      var m = null;
      crewLegs.forEach(function (l) {
        if (!m && !l._m && l.number === t.number && l.origin === t.origin && l.dest === t.dest && Math.abs(l.dep - t.dep) < 18 * HOUR) m = l;
      });
      if (m) {
        m._m = true; m.dep = t.dep; m.arr = t.arr; m.estimated = false; m.source = m.source + '+flighty';
        m.gate = Object.assign({}, m.gate, t.gate);
        if (t.isDeadhead) m.isDeadhead = true;
        if (!m.equipment) m.equipment = t.equipment;
      } else unmatched.push(t);
    });
    var work = crewLegs.length ? crewLegs : unmatched;
    var personal = crewLegs.length ? unmatched : [];

    function dedupe(list) {
      var out = [];
      list.sort(function (a, b) { return a.dep - b.dep; }).forEach(function (l) {
        var dup = out.some(function (o) { return o.flightNumber === l.flightNumber && o.origin === l.origin && o.dest === l.dest && Math.abs(o.dep - l.dep) < 3 * HOUR; });
        if (!dup) out.push(l);
      });
      out.forEach(function (l) { delete l._m; l.id = legId(l); });
      return out;
    }
    work = dedupe(work);
    personal = dedupe(personal);

    // Group legs into rotations: MiCrew "Rotation Report" windows first, then a
    // base-to-base heuristic for anything left over.
    rotDefs.sort(function (a, b) { return a.start - b.start; });
    rotDefs.forEach(function (d, i) {
      var nextStart = rotDefs[i + 1] ? rotDefs[i + 1].start : Infinity;
      var until = Math.min(d.release != null ? d.release + 2 * HOUR : d.start + 10 * DAY, nextStart - MIN);
      d.legs = work.filter(function (l) { return !l._rot && l.dep >= d.start - 30 * MIN && l.dep <= until; });
      d.legs.forEach(function (l) { l._rot = true; });
    });
    var groups = rotDefs.filter(function (d) { return d.legs.length; }).map(function (d) { var g = d.legs.slice(); g.def = d; return g; });
    var cur = null, loose = work.filter(function (l) { return !l._rot; });
    loose.forEach(function (l, i) {
      var p = i ? loose[i - 1] : null, gap = p ? l.dep - p.arr : Infinity;
      var brk = !p || ((p.dest === BASE || p.dest === HOME) && gap > 8 * HOUR) || gap > 60 * HOUR || (p.dest !== l.origin && gap > 20 * HOUR);
      if (brk) { cur = []; groups.push(cur); }
      cur.push(l);
    });
    work.forEach(function (l) { delete l._rot; });
    groups.sort(function (a, b) { return a[0].dep - b[0].dep; });
    reports.sort(function (a, b) { return a.t - b.t; });
    var rotations = groups.map(function (legs) {
      var first = legs[0], last = legs[legs.length - 1], def = legs.def || null;
      var rpts = reports.filter(function (r) { return r.t <= first.dep && r.t >= first.dep - 6 * HOUR; });
      var start = def ? Math.min(def.start, first.dep) : (rpts.length ? rpts[0].t : first.dep - 60 * MIN);
      var layovers = [];
      for (var i = 0; i < legs.length - 1; i++) {
        var L = legs[i], N = legs[i + 1], ground = N.dep - L.arr;
        if (ground >= layMin || (L.layover && ground >= 4 * HOUR)) {
          layovers.push({
            station: L.dest, arr: L.arr, dep: N.dep, afterLeg: L.id, beforeLeg: N.id,
            minutes: (L.layover && L.layover.minutes) || Math.round(ground / MIN),
            hotelName: (L.layover && L.layover.hotelName) || '', hotelPhone: (L.layover && L.layover.hotelPhone) || ''
          });
        }
      }
      return {
        id: first.flightNumber + '_' + Math.round(first.dep / MIN),
        pairing: def ? def.pairing : '', days: def ? def.days : null,
        release: def && def.release != null ? def.release : null,
        start: start, firstDep: first.dep, lastArr: last.arr,
        finalStation: last.dest,
        legIds: legs.map(function (l) { return l.id; }),
        reports: reports.filter(function (r) { return r.t >= start - MIN && r.t <= last.arr; }),
        layovers: layovers
      };
    });

    return { legs: work, personal: personal, rotations: rotations, notes: notes, builtAt: Date.now() };
  }

  /** Airport Rob is at (or headed to) right now — used for weather. */
  function currentStation(sched, now, cfg) {
    cfg = cfg || {};
    var pre = (cfg.preHours || 4) * HOUR, post = (cfg.commuteHomeHours || 8) * HOUR;
    var byId = {};
    (sched.legs || []).forEach(function (l) { byId[l.id] = l; });
    var rot = (sched.rotations || []).filter(function (r) { return now >= r.start - pre && now < r.lastArr + post; })[0];
    if (!rot) return cfg.home || 'CHS';
    var legs = rot.legIds.map(function (id) { return byId[id]; }).filter(Boolean);
    if (!legs.length) return cfg.home || 'CHS';
    var station = legs[0].origin;
    legs.forEach(function (l) { if (now >= l.dep) station = l.dest; });
    return station;
  }

  var EQUIP = {
    '717': 'Boeing 717', '71Y': 'Boeing 717', '319': 'Airbus A319', '320': 'Airbus A320', '321': 'Airbus A321',
    '32N': 'Airbus A321neo', '3N1': 'Airbus A321neo', '221': 'Airbus A220-100', '223': 'Airbus A220-300',
    '738': 'Boeing 737-800', '73H': 'Boeing 737-800', '739': 'Boeing 737-900ER', '73J': 'Boeing 737-900ER',
    '752': 'Boeing 757-200', '753': 'Boeing 757-300', '757': 'Boeing 757', '763': 'Boeing 767-300ER',
    '764': 'Boeing 767-400ER', '332': 'Airbus A330-200', '333': 'Airbus A330-300', '339': 'Airbus A330-900neo',
    '359': 'Airbus A350-900', '351': 'Airbus A350-1000'
  };
  function equipmentName(eq) {
    if (!eq) return '';
    var e = String(eq).toUpperCase().replace(/^B(?=7)/, '').replace(/^A(?=\d)/, '');
    return EQUIP[e] || String(eq).toUpperCase();
  }
  function fleetShort(eq) {
    if (!eq) return '';
    var e = String(eq).toUpperCase().replace(/^B(?=7)/, '').replace(/^A(?=\d)/, '');
    if (/^(717|71Y)$/.test(e)) return '717';
    if (/^3\d\d$|^3\dN$|^3N1$/.test(e)) return 'A' + e.replace('N1', '21N');
    if (/^22\d$/.test(e)) return 'A' + e;
    return e;
  }

  return {
    VERSION: 'v1', MIN: MIN, HOUR: HOUR, DAY: DAY,
    parseICS: parseICS, analyzeEvent: analyzeEvent, parseFlightLine: parseFlightLine,
    buildSchedule: buildSchedule, currentStation: currentStation, icsTime: icsTime,
    zonedToUtc: zonedToUtc, localParts: localParts, localDate: localDate, addDays: addDays,
    dayKey: dayKey, tzOffset: tzOffset, validTz: validTz, haversineNm: haversineNm,
    equipmentName: equipmentName, fleetShort: fleetShort
  };
});
