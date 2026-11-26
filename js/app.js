/* Where Is Rob At Work? — app controller (v1)
 * State-machine evaluator · flicker-free rendering · Worker polling · Settings drawer
 * (WORKER_URL in localStorage) · Wake Lock · sped-up Test Preview. */
(function () {
  'use strict';
  var CFG = window.ROB_CONFIG || {};
  var P = window.RobParser;
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var HOME = CFG.HOME_AIRPORT || 'CHS', BASE = CFG.BASE_AIRPORT || 'ATL', HOME_TZ = CFG.HOME_TIMEZONE || 'America/New_York';
  var LS = { url: 'rob.workerUrl', mute: 'rob.chatterMuted', wake: 'rob.keepAwake', cache: 'rob.lastStatus.v1' };
  var $ = function (id) { return document.getElementById(id); };
  var app = { status: null, lastOk: 0, error: null, inflight: false, pollTimer: null, test: null, lastState: '', sigs: {}, wake: null, restored: false };

  // ───────────── storage & small helpers ─────────────
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function workerUrl() { return String(lsGet(LS.url) || CFG.WORKER_URL || '').trim().replace(/\/+$/, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function setText(id, v) { var el = $(id); v = v == null ? '' : String(v); if (el && el.textContent !== v) el.textContent = v; }
  function setHTML(id, v) { var el = $(id); if (el && app.sigs[id] !== v) { app.sigs[id] = v; el.innerHTML = v; return true; } return false; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function title(s) { return window.Anim ? window.Anim.titleCase(s || '') : s; }

  var fmtCache = {};
  function fmt(tz, o) { var k = tz + JSON.stringify(o); if (!fmtCache[k]) { try { fmtCache[k] = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, o)); } catch (e) { fmtCache[k] = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: HOME_TZ }, o)); } } return fmtCache[k]; }
  function tTime(ms, tz) { return fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(ms); }
  function tZone(ms, tz) { var p = fmt(tz, { timeZoneName: 'short' }).formatToParts(ms).filter(function (x) { return x.type === 'timeZoneName'; })[0]; return p ? p.value : ''; }
  function tTimeZ(ms, tz) { return tTime(ms, tz) + ' ' + tZone(ms, tz); }
  function tDay(ms, tz) { return fmt(tz, { weekday: 'short', month: 'short', day: 'numeric' }).format(ms); }
  function tDayLong(ms, tz) { return fmt(tz, { weekday: 'long', month: 'long', day: 'numeric' }).format(ms); }
  function hourIn(ms, tz) { return P.localParts(ms, tz).h; }
  function dayKey(ms, tz) { return P.dayKey(ms, tz); }
  function dayDiff(a, b, tz) { var x = P.localDate(a, tz), y = P.localDate(b, tz); return Math.round((Date.UTC(y.y, y.mo, y.d) - Date.UTC(x.y, x.mo, x.d)) / DAY); }
  function dur(ms) { var m = Math.max(0, Math.round(ms / MIN)); if (m < 60) return m + ' min'; var h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + String(r).padStart(2, '0') + ' m' : ''); }
  function ago(ms) { var s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; return Math.round(s / 3600) + 'h ago'; }

  function status() { return app.test ? app.test.status : app.status; }
  function now() { return app.test ? testClock() : Date.now(); }
  function ap(code) {
    var S = status(), a = S && S.airports && S.airports[code];
    return { code: code, city: (a && a.city) || code, tz: (a && a.tz) || HOME_TZ, lat: a && a.lat, lon: a && a.lon };
  }

  // ───────────── state machine ─────────────
  function buildTimeline(r) {
    var M = MIN, legs = r.legs, seg = [], last = -Infinity;
    var board = CFG.BOARDING_MINUTES * M, depl = CFG.DEPLANING_MINUTES * M, shortT = CFG.SHORT_TURN_MAX_MINUTES * M;
    var drive = CFG.STANDARD_HOTEL_DRIVE_MINUTES * M, early = CFG.ARRIVE_BEFORE_TAKEOFF_MINUTES * M, run = CFG.STANDBY_RUN_MINUTES * M;
    var layMin = CFG.LAYOVER_MIN_HOURS * HOUR, pre = CFG.PRE_WORK_COMMUTE_HOURS * HOUR;
    function push(state, a, b, x) { a = Math.max(a, last); if (!(b > a)) return; seg.push(Object.assign({ state: state, start: a, end: b }, x || {})); last = b; }
    var start = Math.min(r.start, legs[0].dep - board);
    push('TRAVELING_TO_WORK', start - pre, start, { next: 0 });
    push('LONG_TURN_HANGOUT', start, legs[0].dep - board, { sub: 'preflight', next: 0 });
    legs.forEach(function (L, i) {
      var prevShort = i > 0 && (L.dep - legs[i - 1].arr) <= shortT;
      if (!prevShort) push('BOARDING', L.dep - board, L.dep, { leg: i });
      push('IN_FLIGHT', L.dep, L.arr, { leg: i });
      var N = legs[i + 1];
      if (!N) {
        push('DEPLANING', L.arr, L.arr + depl, { leg: i, final: true });
        if (L.dest === HOME) return;
        push('RUNNING_FOR_STANDBY_HOME', L.arr + depl, L.arr + depl + run, { leg: i, final: true });
        var endC = r.commuteHome ? Math.max(r.commuteHome.arr, L.arr + depl + run + M) : L.arr + CFG.COMMUTE_HOME_HOURS * HOUR;
        push('COMMUTING_HOME', L.arr + depl + run, endC, { leg: i, final: true });
        return;
      }
      var ground = N.dep - L.arr;
      var lay = (r.layovers || []).filter(function (x) { return x.afterLeg === L.id; })[0];
      push('DEPLANING', L.arr, L.arr + depl, { leg: i, next: i + 1 });
      if (ground <= shortT) {
        push('SHORTENED_TURN', L.arr + depl, N.dep, { leg: i, next: i + 1 });
      } else if (lay || ground >= layMin) {
        push('DRIVING_TO_HOTEL', L.arr + depl, L.arr + depl + drive, { leg: i, next: i + 1, layover: lay });
        push('AT_HOTEL', L.arr + depl + drive, N.dep - early - drive, { leg: i, next: i + 1, layover: lay });
        push('DRIVING_TO_AIRPORT', N.dep - early - drive, N.dep - early, { leg: i, next: i + 1, layover: lay });
        push('LONG_TURN_HANGOUT', N.dep - early, N.dep - board, { leg: i, next: i + 1, sub: 'preflight' });
      } else {
        push('LONG_TURN_HANGOUT', L.arr + depl, N.dep - board, { leg: i, next: i + 1 });
      }
    });
    return seg;
  }

  function prepare(S) {
    var byId = {};
    (S.legs || []).forEach(function (l) { byId[l.id] = l; });
    var rots = (S.rotations || []).map(function (r) {
      var o = Object.assign({}, r);
      o.legs = (r.legIds || []).map(function (id) { return byId[id]; }).filter(Boolean).sort(function (a, b) { return a.dep - b.dep; });
      return o;
    }).filter(function (r) { return r.legs.length; }).sort(function (a, b) { return a.start - b.start; });
    rots.forEach(function (r) {
      (S.commuteLegs || []).forEach(function (c) {
        if (c.rotationId === r.id && c.direction === 'home') r.commuteHome = c;
        if (c.rotationId === r.id && c.direction === 'to-work') r.commuteToWork = c;
      });
      r.tl = buildTimeline(r);
      r.ws = r.tl.length ? r.tl[0].start : r.start;
      r.we = r.tl.length ? r.tl[r.tl.length - 1].end : r.lastArr;
    });
    return rots;
  }

  function evaluate(S, t) {
    var rots = prepare(S || {});
    var active = rots.filter(function (r) { return t >= r.ws && t < r.we; })[0] || null;
    var upcoming = rots.filter(function (r) { return r.ws > t && r !== active; });
    var E = { now: t, rots: rots, active: active, next: upcoming[0] || null, state: 'AT_HOME', station: HOME, wx: HOME, progress: 0 };
    if (!active) { E.tz = HOME_TZ; return E; }
    var seg = active.tl.filter(function (s) { return t >= s.start && t < s.end; })[0] || active.tl[active.tl.length - 1];
    var legs = active.legs;
    E.seg = seg; E.state = seg.state; E.sub = seg.sub || '';
    E.leg = seg.leg != null ? legs[seg.leg] : null;
    E.nextLeg = seg.next != null ? legs[seg.next] : null;
    E.flightLeg = (seg.state === 'BOARDING' || seg.state === 'IN_FLIGHT') ? E.leg : (E.nextLeg || E.leg);
    E.isDeadhead = !!(E.flightLeg && E.flightLeg.isDeadhead && (seg.state === 'BOARDING' || seg.state === 'IN_FLIGHT'));
    E.progress = clamp((t - seg.start) / Math.max(1, seg.end - seg.start), 0, 1);
    E.layover = seg.layover || null;
    if (seg.state === 'TRAVELING_TO_WORK') { E.station = HOME; E.wx = legs[0].origin; E.tz = ap(HOME).tz; }
    else if (seg.state === 'BOARDING') { E.station = E.leg.origin; E.wx = E.leg.origin; }
    else if (seg.state === 'IN_FLIGHT') { E.station = E.leg.dest; E.wx = E.leg.dest; E.flightProgress = E.progress; }
    else if (E.leg) { E.station = E.leg.dest; E.wx = E.leg.dest; }
    else if (E.nextLeg) { E.station = E.nextLeg.origin; E.wx = E.nextLeg.origin; }
    if (!E.tz) E.tz = ap(E.station).tz;
    E.tripProgress = clamp((t - active.start) / Math.max(1, active.lastArr - active.start), 0, 1);
    return E;
  }

  // ───────────── wording ─────────────
  var BADGES = {
    AT_HOME: ['At Home', 'home'], TRAVELING_TO_WORK: ['Traveling to work', 'commute'], BOARDING: ['Boarding', 'ground'],
    IN_FLIGHT: ['In Flight', 'air'], DEPLANING: ['Deplaning', 'ground'], SHORTENED_TURN: ['Quick Turn', 'ground'],
    LONG_TURN_HANGOUT: ['Hanging Out', 'ground'], DRIVING_TO_HOTEL: ['Driving to Hotel', 'drive'], AT_HOTEL: ['At Hotel', 'hotel'],
    DRIVING_TO_AIRPORT: ['Driving to Airport', 'drive'], RUNNING_FOR_STANDBY_HOME: ['Running for Standby', 'rush'], COMMUTING_HOME: ['Commuting home', 'commute']
  };
  function badgeFor(E) {
    var b = BADGES[E.state] || BADGES.AT_HOME;
    if (E.state === 'LONG_TURN_HANGOUT' && E.sub === 'preflight') return ['Preflight', 'ground'];
    if (E.isDeadhead) return [E.state === 'IN_FLIGHT' ? 'Deadheading' : 'Deadhead · Boarding', 'air'];
    return b;
  }
  function city(code) { return ap(code).city; }
  function fnum(l) { return l ? l.airline + ' ' + l.number : ''; }
  function summaryFor(E) {
    var L = E.leg, N = E.nextLeg, F = E.flightLeg, S = status();
    switch (E.state) {
      case 'AT_HOME': return 'Rob is off duty and at home in ' + (CFG.HOME_CITY || 'Charleston') + '.' + (E.next ? ' Next trip starts ' + tDay(E.next.start, ap(E.next.legs[0].origin).tz) + '.' : '');
      case 'TRAVELING_TO_WORK': {
        var c = E.active.commuteToWork, tw = c && E.now >= c.dep && E.now < c.arr ? ' — in the air on ' + fnum(c) + ' (' + c.origin + ' → ' + c.dest + ')' : '';
        return 'Rob is commuting from Charleston to ' + city(E.active.legs[0].origin) + tw + '. He reports for duty at ' + tTimeZ(E.active.start, ap(E.active.legs[0].origin).tz) + '.';
      }
      case 'BOARDING': return E.isDeadhead
        ? 'Rob is boarding ' + fnum(L) + ' to ' + city(L.dest) + ' as a passenger (deadhead) — contactable & chilling in the back of the plane.'
        : 'Boarding ' + fnum(L) + ' to ' + city(L.dest) + ' (' + L.dest + ') — wheels up at ' + tTimeZ(L.dep, ap(L.origin).tz) + '.';
      case 'IN_FLIGHT': return E.isDeadhead
        ? 'Rob is deadheading on ' + fnum(L) + ' to ' + city(L.dest) + ' — contactable & chilling in the back of the plane. Lands ≈ ' + tTimeZ(L.arr, ap(L.dest).tz) + '.'
        : 'Rob is flying ' + fnum(L) + ' from ' + city(L.origin) + ' to ' + city(L.dest) + ' — ' + Math.round(E.progress * 100) + '% of the way, landing ≈ ' + tTimeZ(L.arr, ap(L.dest).tz) + '.';
      case 'DEPLANING': return E.seg.final
        ? fnum(L) + ' is on the ground in ' + city(L.dest) + ' — last leg of the trip done! Passengers are deplaning.'
        : fnum(L) + ' has landed in ' + city(L.dest) + ' — passengers are deplaning.';
      case 'SHORTENED_TURN': return 'Quick turn in ' + city(L.dest) + ' — ' + dur(N.dep - L.arr) + ' on the ground before ' + fnum(N) + ' to ' + city(N.dest) + ' (' + tTimeZ(N.dep, ap(N.origin).tz) + ').';
      case 'LONG_TURN_HANGOUT':
        if (E.sub === 'preflight') return 'Rob is at the airport in ' + city(N.origin) + ' getting ' + fnum(N) + ' ready — departs ' + tTimeZ(N.dep, ap(N.origin).tz) + (N.isDeadhead ? ' (riding as a passenger).' : '.');
        return 'Rob has ' + dur(N.dep - E.now) + ' to hang out in ' + city(L.dest) + ' before ' + fnum(N) + ' to ' + city(N.dest) + '.';
      case 'DRIVING_TO_HOTEL': return 'Off duty in ' + city(L.dest) + ' — riding to ' + (E.layover && E.layover.hotelName ? title(E.layover.hotelName) : 'the hotel') + ' (about ' + CFG.STANDARD_HOTEL_DRIVE_MINUTES + ' min).';
      case 'AT_HOTEL': {
        var leave = N.dep - (CFG.ARRIVE_BEFORE_TAKEOFF_MINUTES + CFG.STANDARD_HOTEL_DRIVE_MINUTES) * MIN;
        return 'Rob is at ' + (E.layover && E.layover.hotelName ? title(E.layover.hotelName) : 'the hotel') + ' in ' + city(L.dest) + ' — leaves for the airport ' + tDay(leave, E.tz) + ' at ' + tTimeZ(leave, E.tz) + '.';
      }
      case 'DRIVING_TO_AIRPORT': return 'Crew van to the airport in ' + city(N.origin) + ' — ' + fnum(N) + ' departs ' + tTimeZ(N.dep, ap(N.origin).tz) + '.';
      case 'RUNNING_FOR_STANDBY_HOME': return 'Trip done! Rob is hustling through ' + city(L.dest) + ' trying to catch a standby flight home to Charleston.';
      case 'COMMUTING_HOME': {
        var ch = E.active.commuteHome;
        if (ch) return E.now >= ch.dep ? 'Rob is flying home on ' + fnum(ch) + ' — lands in Charleston ≈ ' + tTimeZ(ch.arr, HOME_TZ) + '.' : 'Rob is at the ' + city(L.dest) + ' gate, listed on ' + fnum(ch) + ' home at ' + tTimeZ(ch.dep, ap(ch.origin).tz) + '.';
        return 'Rob is at the ' + city(L.dest) + ' gate waiting to get home to Charleston (no travel listed yet).';
      }
    }
    return '';
  }
  function reachFor(E) {
    if (E.isDeadhead) return ['📱 Contactable', 'ok'];
    switch (E.state) {
      case 'IN_FLIGHT': return ['✈︎ Flying — not reachable', 'busy'];
      case 'BOARDING': case 'SHORTENED_TURN': return ['🧑‍✈️ On duty — busy', 'busy'];
      case 'LONG_TURN_HANGOUT': return E.sub === 'preflight' ? ['🧑‍✈️ On duty — busy', 'busy'] : ['📱 Reachable', 'ok'];
      case 'AT_HOTEL': { var h = hourIn(E.now, E.tz); return (h >= 21 || h < 6) ? ['😴 Probably sleeping', 'busy'] : ['📱 Reachable', 'ok']; }
      default: return ['📱 Reachable', 'ok'];
    }
  }

  // ───────────── telemetry estimates ─────────────
  function estimateAltGs(L, t) {
    var nm = P.haversineNm(ap(L.origin), ap(L.dest)) || 300, T = (L.arr - L.dep) / MIN, m = (t - L.dep) / MIN;
    var cruise = nm < 150 ? 200 : nm < 300 ? 280 : nm < 500 ? 330 : nm < 900 ? 350 : 370;
    var climb = Math.min(22, T * 0.3), desc = Math.min(28, T * 0.35), alt, gs;
    var sm = function (x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    if (m < climb) { alt = cruise * 100 * sm(m / climb); gs = 160 + 260 * (m / climb); }
    else if (m > T - desc) { var f = (T - m) / desc; alt = cruise * 100 * sm(f); gs = 150 + 270 * f; }
    else { alt = cruise * 100; gs = 430 + (nm > 600 ? 40 : 15); }
    return { altFt: Math.round(alt / 100) * 100, gsKts: Math.round(gs) };
  }

  // ───────────── render ─────────────
  function render() {
    var S = status(), t = now();
    renderClocks(t);
    if (!S) { renderSync(); renderBanner(); return; }
    var E = evaluate(S, t);
    app.E = E;
    var b = badgeFor(E);
    var badge = $('status-badge');
    if (badge.textContent !== b[0]) badge.textContent = b[0];
    if (badge.getAttribute('data-tone') !== b[1]) badge.setAttribute('data-tone', b[1]);
    var rc = reachFor(E), chip = $('reach-chip');
    chip.hidden = false; setText('reach-chip', rc[0]); if (chip.getAttribute('data-tone') !== rc[1]) chip.setAttribute('data-tone', rc[1]);
    var pc = $('pairing-chip');
    if (E.active && E.active.pairing) { pc.hidden = false; setText('pairing-chip', 'Trip ' + E.active.pairing + (E.active.days ? ' · ' + E.active.days + '-day' : '')); } else pc.hidden = true;
    setText('summary', summaryFor(E));
    renderRobClock(E);
    renderTelemetry(E, S);
    renderToday(E);
    renderTomorrow(E);
    renderNext(E);
    renderSync(); renderBanner();
    if (E.state + E.sub + (E.isDeadhead ? 'dh' : '') !== app.lastState) {
      app.lastState = E.state + E.sub + (E.isDeadhead ? 'dh' : '');
      if (window.Chatter) window.Chatter.stateChanged();
    }
    setText('stage-caption', captionFor(E));
    if (window.Anim) window.Anim.setScene(sceneFor(E, S));
  }
  function captionFor(E) {
    var L = E.leg, N = E.nextLeg, b = badgeFor(E)[0];
    if (E.state === 'AT_HOME') return '🏡 ' + b + ' · ' + (CFG.HOME_CITY || 'Charleston');
    if (E.state === 'TRAVELING_TO_WORK') return '🚗 ' + b + ' · ' + HOME + ' → ' + E.active.legs[0].origin;
    if ((E.state === 'BOARDING' || E.state === 'IN_FLIGHT') && L) return (E.isDeadhead ? '🪑 ' : '✈️ ') + b + ' · ' + fnum(L) + ' ' + L.origin + ' → ' + L.dest;
    if (E.state === 'LONG_TURN_HANGOUT' && E.sub === 'preflight' && N) return '🧑‍✈️ Preflight · ' + fnum(N) + ' ' + N.origin + ' → ' + N.dest;
    return '📍 ' + b + ' · ' + E.station;
  }

  function renderClocks(t) {
    setText('clock-home', tTime(t, HOME_TZ));
    setText('clock-home-date', tDay(t, HOME_TZ) + ' · ' + tZone(t, HOME_TZ));
  }
  function renderRobClock(E) {
    var t = E.now, a = ap(E.station);
    var label = E.state === 'AT_HOME' ? 'Rob · Home' : E.state === 'IN_FLIGHT' ? 'Rob · landing in ' + a.city : E.state === 'TRAVELING_TO_WORK' ? 'Rob · en route' : 'Rob · ' + a.city;
    setText('clock-rob-label', label);
    setText('clock-rob', tTime(t, E.tz));
    var diff = (P.tzOffset(E.tz, t) - P.tzOffset(HOME_TZ, t)) / 60;
    setText('clock-rob-sub', tZone(t, E.tz) + (diff ? ' · ' + (diff > 0 ? '+' : '') + diff + 'h vs home' : ' · same as home'));
  }

  function renderTelemetry(E, S) {
    var t = E.now, F = E.flightLeg, L = E.leg;
    // progress
    if (E.state === 'IN_FLIGHT') {
      setText('t-progress', Math.round(E.progress * 100) + '% · ' + fnum(L) + ' ' + L.origin + ' → ' + L.dest);
      setText('t-progress-sub', 'Departed ' + tTime(L.dep, ap(L.origin).tz) + ' · lands ≈ ' + tTimeZ(L.arr, ap(L.dest).tz) + ' · ' + dur(L.arr - t) + ' to go');
      $('t-progress-bar').style.width = (E.progress * 100).toFixed(1) + '%';
    } else if (E.active) {
      var legsDone = E.active.legs.filter(function (l) { return l.arr <= t; }).length;
      setText('t-progress', 'Trip ' + Math.round(E.tripProgress * 100) + '% · ' + legsDone + '/' + E.active.legs.length + ' legs');
      var dayN = dayDiff(E.active.start, t, ap(E.active.legs[0].origin).tz) + 1;
      setText('t-progress-sub', (E.active.pairing ? 'Trip ' + E.active.pairing + ' · ' : '') + 'day ' + Math.max(1, dayN) + (E.active.days ? ' of ' + E.active.days : '') + ' · ends ' + tDay(E.active.lastArr, ap(E.active.finalStation).tz));
      $('t-progress-bar').style.width = (E.tripProgress * 100).toFixed(1) + '%';
    } else {
      setText('t-progress', 'Off duty');
      setText('t-progress-sub', E.next ? 'Next trip ' + tDay(E.next.start, HOME_TZ) : 'No trips on the calendar');
      $('t-progress-bar').style.width = '0%';
    }
    // altitude / groundspeed
    if (E.state === 'IN_FLIGHT') {
      var live = S.live && S.live[L.id], fresh = live && live.altFt != null && (Date.now() - (live.seenAt || 0) < 3 * MIN) && !app.test;
      var v = fresh ? live : estimateAltGs(L, t);
      setText('t-alt', (v.altFt || 0).toLocaleString('en-US') + ' ft');
      setText('t-alt-sub', (v.altFt >= 18000 ? 'FL' + String(Math.round(v.altFt / 100)).padStart(3, '0') : 'Below FL180') + (fresh ? ' · live' : ' · est.'));
      setText('t-gs', (v.gsKts != null ? v.gsKts : '—') + ' kts');
      setText('t-gs-sub', fresh ? 'Live · ' + (live.source || 'ADS-B') : 'Estimated from schedule');
    } else {
      var onGround = E.active && E.state !== 'TRAVELING_TO_WORK';
      setText('t-alt', onGround ? '0 ft' : '—'); setText('t-alt-sub', onGround ? 'On the ground' : '');
      setText('t-gs', onGround ? '0 kts' : '—'); setText('t-gs-sub', '');
    }
    // aircraft
    if (F && E.active) {
      setText('t-ac', P.fleetShort(F.equipment) || '—');
      setText('t-ac-sub', [P.equipmentName(F.equipment), F.ship ? 'Ship #' + F.ship : '', F.isDeadhead ? 'deadhead' : ''].filter(Boolean).join(' · ') + (E.state === 'IN_FLIGHT' || E.state === 'BOARDING' ? '' : ' (next: ' + fnum(F) + ')'));
    } else { setText('t-ac', '—'); setText('t-ac-sub', ''); }
    // location
    var a = ap(E.station);
    if (E.state === 'IN_FLIGHT') { setText('t-loc', 'Airborne'); setText('t-loc-sub', L.origin + ' → ' + L.dest + ' · ' + a.city); }
    else if (E.state === 'TRAVELING_TO_WORK') { setText('t-loc', HOME + ' → ' + E.active.legs[0].origin); setText('t-loc-sub', 'Commuting to ' + city(E.active.legs[0].origin)); }
    else { setText('t-loc', E.station); setText('t-loc-sub', a.city + ' · ' + tTimeZ(t, a.tz)); }
    // weather
    var w = S.weather && (S.weather[E.wx] || S.weather[S.currentStation]);
    if (w && Number.isFinite(w.tempF)) {
      setText('t-wx', w.tempF + '°F ' + (w.icon || ''));
      setText('t-wx-sub', (w.airport || E.wx) + ' · ' + (w.text || '') + ' · feels ' + w.feelsF + '°F · wind ' + w.windKts + ' kt' + (E.state === 'IN_FLIGHT' ? ' (destination)' : ''));
    } else { setText('t-wx', '—'); setText('t-wx-sub', 'Weather unavailable'); }
    // hotel + leave time
    var lay = E.layover || currentOrNextLayover(E);
    if (lay && lay.hotelName) {
      setText('t-hotel', title(lay.hotelName));
      setHTML('t-hotel-sub', lay.hotelPhone ? '<a href="tel:' + esc(lay.hotelPhone.replace(/[^\d+]/g, '')) + '">📞 ' + esc(lay.hotelPhone) + '</a> · ' + esc(lay.station) : esc(lay.station));
    } else if (lay) { setText('t-hotel', 'Layover · ' + lay.station); setHTML('t-hotel-sub', 'Hotel not listed'); }
    else { setText('t-hotel', '—'); setHTML('t-hotel-sub', E.active ? 'No layover today' : ''); }
    if (lay) {
      var leave = lay.dep - (CFG.ARRIVE_BEFORE_TAKEOFF_MINUTES + CFG.STANDARD_HOTEL_DRIVE_MINUTES) * MIN, ltz = ap(lay.station).tz;
      setText('t-leave', tTime(leave, ltz));
      setText('t-leave-sub', tDay(leave, ltz) + ' · ' + (leave > t ? 'in ' + dur(leave - t) : 'departed hotel'));
    } else { setText('t-leave', '—'); setText('t-leave-sub', ''); }
    // gate / ramp (best effort)
    var g = '', gs = '';
    if (F && F.gate) {
      if (E.state === 'IN_FLIGHT' || E.state === 'DEPLANING') { g = F.gate.arrGate ? 'Gate ' + F.gate.arrGate : ''; gs = F.gate.arrGate ? 'arrival at ' + F.dest : ''; }
      else if (E.active) { g = F.gate.depGate ? 'Gate ' + F.gate.depGate : ''; gs = F.gate.depGate ? 'departure from ' + F.origin : ''; }
      if (F.gate.terminal) gs = (gs ? gs + ' · ' : '') + 'Terminal ' + F.gate.terminal;
      if (F.gate.ramp || F.gate.parking) gs = (gs ? gs + ' · ' : '') + (F.gate.ramp ? 'Ramp ' + F.gate.ramp : 'Parking ' + F.gate.parking);
    }
    setText('t-gate', g || '—'); setText('t-gate-sub', gs || (E.active ? 'Not published yet' : ''));
  }
  function currentOrNextLayover(E) {
    if (!E.active) return null;
    var t = E.now, tz = E.tz;
    return (E.active.layovers || []).filter(function (l) { return l.dep > t && (l.arr <= t || dayKey(l.arr, ap(l.station).tz) === dayKey(t, tz)); })[0] || null;
  }

  // ── Zone 3: today's itinerary ──
  function itinItems(r) {
    var items = [], legs = r.legs;
    var oTz = ap(legs[0].origin).tz;
    items.push({ t: r.start, end: legs[0].dep, tz: oTz, icon: '🕘', html: '<b>Report</b> at ' + esc(legs[0].origin) + (r.pairing ? ' <small>· Trip ' + esc(r.pairing) + '</small>' : '') });
    (r.reports || []).forEach(function (rp) {
      if (Math.abs(rp.t - r.start) < 5 * MIN) return;
      var nl = legs.filter(function (l) { return l.dep >= rp.t; })[0];
      items.push({ t: rp.t, end: nl ? nl.dep : rp.t + HOUR, tz: ap(rp.station).tz, icon: '🕘', html: '<b>Report</b> at ' + esc(rp.station) });
    });
    legs.forEach(function (L, i) {
      var tzO = ap(L.origin).tz, tzD = ap(L.dest).tz;
      items.push({ t: L.dep, end: L.arr, tz: tzO, timeStr: tTime(L.dep, tzO), icon: L.isDeadhead ? '🪑' : '✈️',
        html: (L.isDeadhead ? '<b>Deadhead</b> ' : '') + '<b>' + esc(fnum(L)) + '</b> ' + esc(L.origin) + ' → ' + esc(L.dest) +
          ' <small>· lands ' + esc(tTimeZ(L.arr, tzD)) + (L.equipment ? ' · ' + esc(P.fleetShort(L.equipment)) : '') + (L.gate && L.gate.depGate ? ' · gate ' + esc(L.gate.depGate) : '') + '</small>' });
      var N = legs[i + 1];
      if (!N) return;
      var ground = N.dep - L.arr, lay = (r.layovers || []).filter(function (x) { return x.afterLeg === L.id; })[0];
      if (lay) {
        var sTz = ap(lay.station).tz, hours = Math.round((lay.dep - lay.arr) / HOUR);
        var phone = lay.hotelPhone ? ' · <a href="tel:' + esc(lay.hotelPhone.replace(/[^\d+]/g, '')) + '">' + esc(lay.hotelPhone) + '</a>' : '';
        items.push({ t: L.arr + (CFG.DEPLANING_MINUTES + CFG.STANDARD_HOTEL_DRIVE_MINUTES) * MIN, end: N.dep - (CFG.ARRIVE_BEFORE_TAKEOFF_MINUTES + CFG.STANDARD_HOTEL_DRIVE_MINUTES) * MIN, tz: sTz, icon: '🏨',
          html: '<b>' + esc(lay.hotelName ? title(lay.hotelName) : 'Hotel') + '</b>' + phone + ' <small>· ' + dur(lay.dep - lay.arr) + ' layover in ' + esc(lay.station) + '</small>' });
        // zero-flight days in the middle of a layover
        var d = P.addDays(P.localDate(lay.arr, sTz), 1), endKey = dayKey(lay.dep, sTz), guard = 0;
        while (guard++ < 5) {
          var dms = P.zonedToUtc(d.y, d.mo, d.d, 12, 0, sTz);
          if (dayKey(dms, sTz) >= endKey) break;
          items.push({ t: P.zonedToUtc(d.y, d.mo, d.d, 0, 0, sTz), sort: P.zonedToUtc(d.y, d.mo, d.d, 12, 0, sTz), end: P.zonedToUtc(d.y, d.mo, d.d, 23, 59, sTz), tz: sTz, timeStr: 'All day', icon: '🛏️',
            html: '<b>At Hotel All Day — ' + hours + '-Hour Layover</b> <small>· ' + esc(city(lay.station)) + '</small>' });
          d = P.addDays(d, 1);
        }
      } else {
        items.push({ t: L.arr, end: N.dep, tz: ap(L.dest).tz, icon: ground <= CFG.SHORT_TURN_MAX_MINUTES * MIN ? '⏱️' : '☕',
          html: (ground <= CFG.SHORT_TURN_MAX_MINUTES * MIN ? '<b>' + dur(ground) + ' quick turn</b>' : '<b>' + dur(ground) + ' turn</b>') + ' at ' + esc(L.dest) });
      }
    });
    var last = legs[legs.length - 1];
    if (r.release) items.push({ t: r.release, end: r.release + MIN, tz: ap(last.dest).tz, icon: '🏁', html: '<b>Released</b> at ' + esc(last.dest) + ' <small>· trip complete</small>' });
    if (last.dest !== HOME) items.push({ t: last.arr + (CFG.DEPLANING_MINUTES + CFG.STANDBY_RUN_MINUTES) * MIN, end: last.arr + CFG.COMMUTE_HOME_HOURS * HOUR, tz: ap(last.dest).tz, icon: '🏠',
      html: '<b>Commute home</b> to ' + esc(HOME) + ' <small>· ' + (r.commuteHome ? 'listed on ' + esc(fnum(r.commuteHome)) : 'standby, no travel listed') + '</small>' });
    items.sort(function (a, b) { return (a.sort || a.t) - (b.sort || b.t); });
    return items;
  }
  function renderToday(E) {
    var t = E.now, html = '', title2 = "Today's Schedule";
    if (!E.active) {
      html = '<li class="now"><span class="time">' + esc(tDay(t, HOME_TZ)) + '</span><span>🏡</span><span class="what"><b>Off Duty — At Home in Charleston</b></span></li>';
      if (E.next) html += '<li><span class="time">' + esc(tDay(E.next.start, HOME_TZ)) + '</span><span>🧳</span><span class="what">Next trip' + (E.next.pairing ? ' ' + esc(E.next.pairing) : '') + ' · report ' + esc(tTimeZ(E.next.start, ap(E.next.legs[0].origin).tz)) + '</span></li>';
    } else {
      title2 = 'Today · ' + (E.active.pairing ? 'Trip ' + E.active.pairing : 'Current trip') + (E.active.days ? ' (' + E.active.days + ' days)' : '');
      var items = itinItems(E.active), lastDay = null, todayKey = dayKey(t, E.tz);
      items.forEach(function (it) {
        var dk = dayKey(it.t, it.tz);
        if (dk !== lastDay) { lastDay = dk; html += '<li class="day' + (dk === todayKey ? ' today' : '') + '">' + esc(tDay(it.t, it.tz)) + (dk === todayKey ? ' · Today' : '') + '</li>'; }
        var cls = it.end <= t ? 'done' : (it.t <= t ? 'now' : '');
        html += '<li class="' + cls + '"><span class="time">' + esc(it.timeStr || tTime(it.t, it.tz)) + '</span><span>' + it.icon + '</span><span class="what">' + it.html + '</span></li>';
      });
    }
    setText('today-title', title2);
    if (setHTML('today-list', html)) {
      var cur = $('today-list').querySelector('li.now') || $('today-list').querySelector('li:not(.done):not(.day)');
      if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { cur.scrollIntoView(); } }
    }
  }
  function renderTomorrow(E) {
    var t = E.now, tz = E.tz, tom = P.addDays(P.localDate(t, tz), 1);
    var tomKey = tom.y * 10000 + (tom.mo + 1) * 100 + tom.d, html = '';
    var first = null, firstRot = null;
    E.rots.forEach(function (r) { r.legs.forEach(function (l) { if (!first && dayKey(l.dep, ap(l.origin).tz) === tomKey && l.dep > t) { first = l; firstRot = r; } }); });
    var tomLabel = fmt(tz, { weekday: 'long', month: 'short', day: 'numeric' }).format(P.zonedToUtc(tom.y, tom.mo, tom.d, 12, 0, tz));
    if (first) {
      var oTz = ap(first.origin).tz, h = hourIn(first.dep, oTz), early = h < CFG.EARLY_WAKEUP_CUTOFF_HOUR;
      var isTripStart = firstRot.legs[0] === first;
      var leave = isTripStart ? firstRot.start - CFG.PRE_WORK_COMMUTE_HOURS * HOUR : first.dep - (CFG.ARRIVE_BEFORE_TAKEOFF_MINUTES + CFG.STANDARD_HOTEL_DRIVE_MINUTES) * MIN;
      var wake = leave - 45 * MIN, bed = wake - 8 * HOUR, wTz = isTripStart ? HOME_TZ : oTz;
      html += early
        ? '<div class="cue early"><span class="big">🌙⏰</span><span>Early Bedtime / Early Wake-Up<br><small>Early show — takeoff before ' + CFG.EARLY_WAKEUP_CUTOFF_HOUR + ':00 local</small></span></div>'
        : '<div class="cue normal"><span class="big">☀️</span><span>Normal / later start<br><small>First takeoff after ' + CFG.EARLY_WAKEUP_CUTOFF_HOUR + ':00 local</small></span></div>';
      html += '<dl class="kv"><dt>' + esc(tomLabel) + '</dt><dd>' + esc(fnum(first)) + ' ' + esc(first.origin) + ' → ' + esc(first.dest) + '</dd>' +
        '<dt>First takeoff</dt><dd>' + esc(tTimeZ(first.dep, oTz)) + '</dd>' +
        '<dt>' + (isTripStart ? 'Leave home' : 'Leave hotel') + '</dt><dd>≈ ' + esc(tTimeZ(leave, wTz)) + '</dd>' +
        (hourIn(wake, wTz) < 9 ? '<dt>Wake-up</dt><dd>≈ ' + esc(tTimeZ(wake, wTz)) + '</dd>' +
        '<dt>Bedtime</dt><dd>≈ ' + esc(tTimeZ(bed, wTz)) + '</dd>' : '<dt>Wake-up</dt><dd>Sleep in 😴</dd>') + '</dl>';
    } else {
      var tomNoon = P.zonedToUtc(tom.y, tom.mo, tom.d, 12, 0, tz);
      var inTrip = E.active && E.active.lastArr > P.zonedToUtc(tom.y, tom.mo, tom.d, 23, 59, tz);
      var restLay = E.active && (E.active.layovers || []).filter(function (l) { return l.arr < tomNoon && l.dep > tomNoon; })[0];
      html += inTrip
        ? '<div class="cue off"><span class="big">🛏️</span><span>No flights tomorrow<br><small>Hotel / rest day in ' + esc(city(restLay ? restLay.station : E.station)) + '</small></span></div>'
        : '<div class="cue normal"><span class="big">🏡</span><span>Day off tomorrow<br><small>' + esc(tomLabel) + '</small></span></div>';
      if (E.next) html += '<p class="muted">Next report: ' + esc(tDay(E.next.start, ap(E.next.legs[0].origin).tz)) + ' at ' + esc(tTimeZ(E.next.start, ap(E.next.legs[0].origin).tz)) + '</p>';
    }
    setHTML('tomorrow', html);
  }
  function renderNext(E) {
    var t = E.now, html = '', nxt = E.active ? E.rots.filter(function (r) { return r.start > E.active.lastArr; })[0] : E.next;
    if (E.active) {
      var end = E.active.release || E.active.lastArr, eTz = ap(E.active.finalStation).tz;
      html += '<p class="muted">This trip ends ' + esc(tDay(end, eTz)) + ' ≈ ' + esc(tTimeZ(end, eTz)) + '</p>';
      if (nxt) {
        var off = Math.max(0, dayDiff(end, nxt.start, HOME_TZ) - 1);
        html += '<div class="next-big"><em>' + off + ' day' + (off === 1 ? '' : 's') + ' off</em> — back to work on ' + esc(tDayLong(nxt.start, HOME_TZ)) + '</div>';
      } else html += '<div class="next-big">Then home 🏡</div><p class="muted">No later trips on the calendar yet.</p>';
    } else if (nxt) {
      var offN = Math.max(0, dayDiff(t, nxt.start, HOME_TZ));
      html += '<div class="next-big"><em>' + offN + ' day' + (offN === 1 ? '' : 's') + ' off</em> — back to work on ' + esc(tDayLong(nxt.start, HOME_TZ)) + '</div>';
    } else html += '<div class="next-big">No upcoming trips</div><p class="muted">Nothing on the calendar yet — enjoy it!</p>';
    var later = E.rots.filter(function (r) { return r.start > t && r !== E.active; }).slice(0, 3);
    if (later.length) {
      html += '<dl class="kv">';
      later.forEach(function (r) {
        var stops = r.layovers.map(function (l) { return l.station; }).join(', ');
        html += '<dt>' + esc(tDay(r.start, HOME_TZ)) + '</dt><dd>' + (r.pairing ? 'Trip ' + esc(r.pairing) + ' · ' : '') + (r.days || dayDiff(r.start, r.lastArr, HOME_TZ) + 1) + 'd' + (stops ? ' · ' + esc(stops) : ' · day trip') + '</dd>';
      });
      html += '</dl>';
    }
    setHTML('next', html);
  }

  function sceneFor(E, S) {
    var L = E.leg, N = E.nextLeg, F = E.flightLeg, sc = { state: E.state, sub: E.sub, progress: E.progress, flightProgress: E.flightProgress, isDeadhead: E.isDeadhead, homeCode: HOME, baseCode: BASE };
    if (E.state === 'TRAVELING_TO_WORK') { sc.origin = HOME; sc.dest = E.active.legs[0].origin; }
    else if (E.state === 'BOARDING' || E.state === 'IN_FLIGHT') { sc.origin = L.origin; sc.dest = L.dest; }
    else if (E.state === 'LONG_TURN_HANGOUT' && E.sub === 'preflight' && N) { sc.origin = N.origin; sc.dest = N.dest; }
    else if (L) { sc.origin = L.origin; sc.dest = L.dest; }
    sc.fleet = F ? P.fleetShort(F.equipment) : '';
    sc.flightNumber = F ? fnum(F) : '';
    sc.hotelName = E.layover ? E.layover.hotelName : '';
    var w = S.weather && S.weather[E.wx];
    var h = hourIn(E.now, E.tz);
    sc.night = (w && !app.test && Math.abs(Date.now() - E.now) < HOUR) ? !w.isDay : (h < 6 || h >= 19);
    sc.earlyShow = E.state === 'AT_HOTEL' && N && hourIn(N.dep, ap(N.origin).tz) < CFG.EARLY_WAKEUP_CUTOFF_HOUR;
    sc.commuteNote = E.active && E.active.commuteHome ? 'listed on ' + fnum(E.active.commuteHome) : 'no travel listed';
    return sc;
  }

  function chatterContext() {
    var E = app.E || { state: 'AT_HOME' }, S = status() || {}, L = E.leg, F = E.flightLeg, N = E.nextLeg;
    var w = S.weather && S.weather[E.wx];
    var alt = E.state === 'IN_FLIGHT' && L ? estimateAltGs(L, E.now).altFt : 0;
    return {
      state: E.state, sub: E.sub, isDeadhead: E.isDeadhead,
      num: F ? F.number : '', flightNumber: F ? fnum(F) : '',
      home: HOME, base: BASE, report: E.active ? tTimeZ(E.active.start, ap(E.active.legs[0].origin).tz) : '',
      originCity: F ? city(F.origin) : '', dest: F ? F.dest : '', destCity: F ? city(F.dest) : '',
      temp: w ? w.tempF + '°F' : '', fl: alt >= 18000 ? 'flight level ' + Math.round(alt / 1000) * 10 : 'cruise',
      turn: L && N ? dur(N.dep - L.arr) : '', hotel: E.layover && E.layover.hotelName ? title(E.layover.hotelName) : 'the hotel',
      early: E.state === 'AT_HOTEL' && N && hourIn(N.dep, ap(N.origin).tz) < CFG.EARLY_WAKEUP_CUTOFF_HOUR ? 'Early show tomorrow — lights out early! ⏰' : 'Thinking of home… say hi to the dogs and cats! 🐕🐈',
      local: tTime(E.now, E.tz || HOME_TZ), seat: 'the back row'
    };
  }

  // ───────────── sync, banner, polling ─────────────
  function renderSync() {
    var dot = $('sync-dot'), S = app.status, txt, cls;
    if (app.test) { txt = 'Test preview'; cls = 'warn'; }
    else if (!workerUrl()) { txt = 'Not connected'; cls = 'err'; }
    else if (app.lastOk) {
      txt = 'Updated ' + ago(Date.now() - app.lastOk) + (S && S.staleCache ? ' · Cached' : '');
      cls = app.error || (S && S.staleCache) ? 'warn' : 'ok';
    } else if (app.error) { txt = 'Offline — retrying'; cls = 'err'; }
    else { txt = app.restored ? 'Last known data · reconnecting' : 'Connecting…'; cls = 'warn'; }
    setText('sync-text', txt); setText('updated', txt);
    if (dot.className !== 'dot ' + cls) dot.className = 'dot ' + cls;
  }
  function renderBanner() {
    var b = $('banner'), S = app.status, msg = '', tone = 'warn';
    if (app.test) {
      var step = app.test.steps[app.test.i];
      msg = '🧪 TEST PREVIEW (sped-up sample trip) — step ' + (app.test.i + 1) + ' of ' + app.test.steps.length + ': ' + step.label + '. Live data resumes when you tap Exit Test.';
      tone = 'test';
    } else if (!workerUrl()) { msg = '⚠️ Tracker not connected — open ⚙︎ Settings and paste the Worker URL.'; tone = 'err'; }
    else if (app.error && !S) { msg = '⚠️ Can’t reach the tracker (' + app.error + '). Retrying every ' + CFG.POLL_SECONDS + 's…'; tone = 'err'; }
    else if (app.error && S) { msg = '⚠️ Connection hiccup (' + app.error + ') — showing data from ' + ago(Date.now() - app.lastOk) + '.'; }
    else if (S && S.calendar && S.calendar.configured === false) { msg = '⚠️ The Worker has no CALENDAR_WEBCAL_URL secret yet — schedule unavailable.'; tone = 'err'; }
    else if (S && S.staleCache) {
      var fa = S.calendar && S.calendar.fetchedAt;
      msg = fa ? '🗂️ Calendar feed unreachable — showing the cached schedule from ' + ago(Date.now() - fa) + '.' : '⚠️ Calendar feed unreachable (' + ((S.calendar && S.calendar.error) || 'unknown error') + ') and nothing cached yet.';
      if (!fa) tone = 'err';
    }
    if (!msg) { if (!b.hidden) b.hidden = true; return; }
    b.hidden = false;
    if (b.getAttribute('data-tone') !== tone) b.setAttribute('data-tone', tone);
    setText('banner', msg);
  }

  function fetchStatus(url, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 15000);
    return fetch(url + '/api/status', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { clearTimeout(timer); if (!j || j.ok === false) throw new Error((j && j.error) || 'bad response'); return j; },
            function (e) { clearTimeout(timer); throw (e && e.name === 'AbortError') ? new Error('timed out') : e; });
  }
  function poll() {
    clearTimeout(app.pollTimer);
    var url = workerUrl();
    if (!url) { app.error = null; renderSync(); renderBanner(); return; }
    if (app.inflight) return;
    app.inflight = true;
    fetchStatus(url).then(function (j) {
      app.status = j; app.lastOk = Date.now(); app.error = null; app.restored = false;
      try { lsSet(LS.cache, JSON.stringify(j)); } catch (e) { /* quota */ }
    }).catch(function (e) {
      app.error = (e && e.message) || 'network error';
    }).then(function () {
      app.inflight = false;
      render(); renderDiag();
      app.pollTimer = setTimeout(poll, (app.error ? Math.min(CFG.POLL_SECONDS, 30) : CFG.POLL_SECONDS) * 1000);
    });
  }

  // ───────────── settings drawer ─────────────
  function openSettings(open) {
    var d = $('settings');
    d.classList.toggle('open', open); d.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) { $('worker-url').value = lsGet(LS.url) || CFG.WORKER_URL || ''; renderDiag(); }
  }
  function renderDiag() {
    var S = app.status, c = S && S.calendar;
    var lines = [
      'Version: ' + CFG.VERSION,
      'Worker: ' + (workerUrl() || '(none)') + (lsGet(LS.url) ? '  [saved in this browser]' : '  [js/config.js]'),
      'Last update: ' + (app.lastOk ? new Date(app.lastOk).toLocaleString() : '—'),
      'Calendar: ' + (c ? (c.source + ' · ' + c.eventCount + ' events' + (c.fetchedAt ? ' · fetched ' + ago(Date.now() - c.fetchedAt) : '') + (c.error ? ' · ' + c.error : '')) : '—'),
      'Trips loaded: ' + (S ? (S.rotations || []).length + ' · legs ' + (S.legs || []).length : '—'),
      'Wake lock: ' + (app.wake ? 'on' : ('wakeLock' in navigator ? 'off' : 'not supported on this browser'))
    ];
    setText('diag', lines.join('\n'));
  }
  function bindSettings() {
    $('settings-btn').onclick = function () { openSettings(true); };
    $('settings-close').onclick = function () { openSettings(false); };
    $('settings').addEventListener('click', function (e) { if (e.target === $('settings')) openSettings(false); });
    $('worker-save').onclick = function () {
      var v = $('worker-url').value.trim().replace(/\/+$/, '');
      if (v && !/^https:\/\//i.test(v)) { setText('worker-result', 'Please paste a full https:// URL.'); return; }
      lsSet(LS.url, v || null); setText('worker-result', v ? 'Saved — connecting…' : 'Cleared — using js/config.js');
      app.status = null; app.lastOk = 0; app.error = null; poll();
    };
    $('worker-reset').onclick = function () { lsSet(LS.url, null); $('worker-url').value = CFG.WORKER_URL || ''; setText('worker-result', 'Using the default URL from js/config.js'); app.status = null; app.lastOk = 0; poll(); };
    $('worker-test').onclick = function () {
      var v = ($('worker-url').value || workerUrl()).trim().replace(/\/+$/, '');
      setText('worker-result', 'Testing ' + v + ' …');
      fetchStatus(v, 12000).then(function (j) {
        setText('worker-result', '✅ Connected · ' + (j.rotations || []).length + ' trips · calendar ' + (j.calendar ? j.calendar.source : '?') + (j.staleCache ? ' (cached)' : ''));
      }).catch(function (e) { setText('worker-result', '❌ ' + e.message); });
    };
    var wt = $('wake-toggle'); wt.checked = lsGet(LS.wake) !== '0';
    wt.onchange = function () { lsSet(LS.wake, wt.checked ? '1' : '0'); if (wt.checked) requestWake(); else releaseWake(); };
    var mt = $('mute-toggle'); mt.checked = lsGet(LS.mute) === '1';
    mt.onchange = function () { setMute(mt.checked); };
  }

  // ───────────── wake lock ─────────────
  function requestWake() {
    if (lsGet(LS.wake) === '0' || !('wakeLock' in navigator) || app.wake || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (l) {
      app.wake = l; l.addEventListener('release', function () { app.wake = null; });
    }).catch(function () { /* needs a tap on some browsers */ });
  }
  function releaseWake() { if (app.wake) { app.wake.release().catch(function () {}); app.wake = null; } }

  // ───────────── chatter controls ─────────────
  function setMute(m) {
    lsSet(LS.mute, m ? '1' : '0');
    if (window.Chatter) window.Chatter.setMuted(m);
    setText('chatter-mute', m ? '🔇 Chatter off' : '🔊 Chatter');
    $('mute-toggle').checked = m;
  }

  // ───────────── Test Preview (sped-up) ─────────────
  var SAMPLE_AIRPORTS = {
    ATL: { code: 'ATL', city: 'Atlanta', tz: 'America/New_York', lat: 33.64, lon: -84.43 },
    MCO: { code: 'MCO', city: 'Orlando', tz: 'America/New_York', lat: 28.43, lon: -81.31 },
    CHA: { code: 'CHA', city: 'Chattanooga', tz: 'America/New_York', lat: 35.04, lon: -85.2 },
    MSY: { code: 'MSY', city: 'New Orleans', tz: 'America/Chicago', lat: 29.99, lon: -90.26 },
    TPA: { code: 'TPA', city: 'Tampa', tz: 'America/New_York', lat: 27.98, lon: -82.53 },
    CHS: { code: 'CHS', city: 'Charleston', tz: 'America/New_York', lat: 32.9, lon: -80.04 }
  };
  function buildSample() {
    var base = P.addDays(P.localDate(Date.now(), HOME_TZ), 1), D = function (k) { return P.addDays(base, k); };
    var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var ymd = function (d) { return d.y + String(d.mo + 1).padStart(2, '0') + String(d.d).padStart(2, '0'); };
    var dd = function (d) { return String(d.d).padStart(2, '0') + MON[d.mo]; };
    var ev = function (d0, s, d1, e, sum, desc) {
      return 'BEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:' + ymd(d0) + 'T' + s + '00\r\nDTEND;TZID=America/New_York:' + ymd(d1) + 'T' + e + '00\r\nSUMMARY:' + sum + '\r\nDESCRIPTION:' + desc + '\r\nEND:VEVENT\r\n';
    };
    var ics = 'BEGIN:VCALENDAR\r\n' +
      ev(D(0), '1215', D(0), '1315', 'Rotation Report ATL 0443 ', 'Apr Rpt- \\n\\n3 Days\t\t\tCredit- 16:40\\nRpt- 1215 ' + dd(D(0)) + '\t\t\tTAFB- 44:50\\nRls- 0905 ' + dd(D(2)) + '\t\t\tLayover- MSY') +
      ev(D(0), '1315', D(0), '1450', 'DL1001 : ATL - MCO', 'Dep- 1315 ' + dd(D(0)) + '\t\t\tGate- A15\\n\\nArr- 1450 ' + dd(D(0)) + '\t\t\tGate- 72\\n\\nBlk- 1:35\t\t\tEqp/Ship- 717/9570') +
      ev(D(0), '1530', D(0), '1700', 'DL1002 : MCO - ATL', 'Dep- 1530 ' + dd(D(0)) + '\t\t\tGate- 72\\n\\nArr- 1700 ' + dd(D(0)) + '\t\t\tGate- B13\\n\\nBlk- 1:30\t\t\tEqp/Ship- 717/9570') +
      ev(D(0), '1750', D(0), '1840', 'D DL1737 : ATL - CHA', 'Dep- 1750 ' + dd(D(0)) + '\t\t\tGate- B13\\n\\nArr- 1840 ' + dd(D(0)) + '\t\t\tGate- 08\\n\\nBlk- 0:50\t\t\tEqp/Ship- 717/9533') +
      ev(D(0), '1945', D(0), '2040', 'DL1740 : CHA - ATL', 'Dep- 1945 ' + dd(D(0)) + '\t\t\tGate- 08\\n\\nArr- 2040 ' + dd(D(0)) + '\t\t\tGate- A21\\n\\nBlk- 0:55\t\t\tEqp/Ship- 717/9533') +
      ev(D(0), '2235', D(1), '0030', 'DL2210 : ATL - MSY', 'Dep- 2235 ' + dd(D(0)) + '\t\t\tGate- A21\\n\\nArr- 2330 ' + dd(D(0)) + ' -1hr\t\t\tGate- B5\\n\\nBlk- 1:55\t\t\tEqp/Ship- 320/3201\\n\\nLAYOVER   30:40/MSY\\nHOTEL MONTELEONE:\t\t\t504-555-0137') +
      ev(D(2), '0710', D(2), '0835', 'DL2211 : MSY - ATL', 'Rpt- 0510 ' + dd(D(2)) + '\t\t\tApr Rpt- \\n\\nDep- 0610 ' + dd(D(2)) + '\t\t\tGate- B5\\n\\nArr- 0835 ' + dd(D(2)) + ' +1hr\t\t\tGate- A9\\n\\nBlk- 1:25\t\t\tEqp/Ship- 320/3201') +
      ev(D(11), '0600', D(11), '0700', 'Rotation Report ATL 2210 ', 'Apr Rpt- \\n\\n1 Day\t\t\tCredit- 05:30\\nRpt- 0600 ' + dd(D(11)) + '\\nRls- 1120 ' + dd(D(11))) +
      ev(D(11), '0700', D(11), '0835', 'DL1500 : ATL - TPA', 'Dep- 0700 ' + dd(D(11)) + '\\n\\nArr- 0835 ' + dd(D(11)) + '\\n\\nBlk- 1:35\t\t\tEqp/Ship- 717') +
      ev(D(11), '0920', D(11), '1050', 'DL1501 : TPA - ATL', 'Dep- 0920 ' + dd(D(11)) + '\\n\\nArr- 1050 ' + dd(D(11)) + '\\n\\nBlk- 1:30\t\t\tEqp/Ship- 717') +
      'END:VCALENDAR\r\n';
    var sched = P.buildSchedule(P.parseICS(ics), { airport: function (c) { return SAMPLE_AIRPORTS[c]; }, base: BASE, home: HOME, homeTz: HOME_TZ, layoverMinHours: CFG.LAYOVER_MIN_HOURS });
    var wx = function (c, f, i, txt, day) { return { airport: c, tempF: f, feelsF: f - 2, icon: i, text: txt, windKts: 8, windDir: 220, isDay: day, unit: '°F' }; };
    var S = {
      ok: true, test: true, staleCache: false, calendar: { configured: true, source: 'sample', eventCount: 10 },
      airports: SAMPLE_AIRPORTS, legs: sched.legs, rotations: sched.rotations, commuteLegs: [], live: {},
      weather: { ATL: wx('ATL', 61, '⛅', 'Partly cloudy', true), MCO: wx('MCO', 79, '☀️', 'Clear', true), CHA: wx('CHA', 55, '☁️', 'Overcast', true), MSY: wx('MSY', 68, '🌙', 'Clear', false), CHS: wx('CHS', 64, '☀️', 'Clear', true) }
    };
    var rot = prepare(S)[0], tl = rot.tl;
    function seg(state, pred) { return tl.filter(function (s) { return s.state === state && (!pred || pred(s)); })[0]; }
    var steps = [];
    function add(label, s, ms, from, to) {
      if (!s && from == null) return;
      var a = from != null ? from : s.start + 30 * 1000, b = to != null ? to : s.end - 30 * 1000;
      steps.push({ label: label, from: a, to: Math.max(a + MIN, b), ms: ms });
    }
    var deadIdx = rot.legs.map(function (l) { return l.isDeadhead; }).indexOf(true);
    var finalI = rot.legs.length - 1;
    add('At home (off duty)', null, 6000, rot.ws - 20 * HOUR, rot.ws - 19 * HOUR);
    add('Traveling to work (CHS → ATL)', seg('TRAVELING_TO_WORK'), 8000);
    add('Boarding', seg('BOARDING', function (s) { return s.leg === 0; }), 7000);
    add('In flight', seg('IN_FLIGHT', function (s) { return s.leg === 0; }), 10000);
    add('Deplaning', seg('DEPLANING', function (s) { return s.leg === 0; }), 6000);
    add('Shortened turn (≤ 45 min)', seg('SHORTENED_TURN'), 7000);
    add('Deadhead DL1737 ATL → CHA — boarding', seg('BOARDING', function (s) { return s.leg === deadIdx; }), 6000);
    add('Deadhead DL1737 — contactable & chilling in the back', seg('IN_FLIGHT', function (s) { return s.leg === deadIdx; }), 8000);
    add('Long turn hangout (> 45 min)', seg('LONG_TURN_HANGOUT', function (s) { return s.sub !== 'preflight' && s.leg === deadIdx; }), 7000);
    add('Driving to hotel', seg('DRIVING_TO_HOTEL'), 8000);
    var hs = seg('AT_HOTEL');
    if (hs) add('At hotel — zero-flight ~30-hour layover, early show tomorrow', hs, 9000, hs.start + 10 * HOUR, hs.start + 20 * HOUR);
    add('Driving to airport', seg('DRIVING_TO_AIRPORT'), 7000);
    add('Final leg landed at ATL — deplaning (10 min)', seg('DEPLANING', function (s) { return s.leg === finalI; }), 6000);
    add('Running for standby home (30 min)', seg('RUNNING_FOR_STANDBY_HOME'), 8000);
    add('Commuting home — at the ATL gate thinking of home', seg('COMMUTING_HOME'), 10000, null, null);
    var last = steps[steps.length - 1]; if (last) last.to = last.from + 2 * HOUR;
    return { status: S, steps: steps };
  }
  function testClock() {
    var T = app.test, step = T.steps[T.i], el = performance.now() - T.stepStart;
    if (el >= step.ms) { T.i = (T.i + 1) % T.steps.length; T.stepStart = performance.now(); step = T.steps[T.i]; el = 0; }
    return step.from + (step.to - step.from) * (el / step.ms);
  }
  function toggleTest() {
    if (app.test) {
      app.test = null; document.body.classList.remove('testing'); setText('test-btn', 'Test Preview (Sped-Up)');
      app.sigs = {}; app.lastState = '';
    } else {
      try {
        var smp = buildSample();
        app.test = { status: smp.status, steps: smp.steps, i: 0, stepStart: performance.now() };
        document.body.classList.add('testing'); setText('test-btn', 'Exit Test'); app.sigs = {};
      } catch (e) { setText('summary', 'Test preview failed: ' + e.message); }
    }
    render();
  }

  // ───────────── misc ─────────────
  function makeTouchIcon() {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 180; var x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, '#003366'); g.addColorStop(1, '#0A192F');
      x.fillStyle = g; x.fillRect(0, 0, 180, 180);
      x.fillStyle = '#E01933'; x.beginPath(); x.moveTo(90, 30); x.lineTo(140, 120); x.lineTo(40, 120); x.closePath(); x.fill();
      x.fillStyle = '#fff'; x.font = '900 34px -apple-system, sans-serif'; x.textAlign = 'center'; x.fillText('ROB', 90, 160);
      $('touch-icon').href = c.toDataURL('image/png');
    } catch (e) { /* ignore */ }
  }
  function restoreCache() {
    try {
      var c = JSON.parse(lsGet(LS.cache) || 'null');
      if (c && c.ok) { app.status = c; app.restored = true; }
    } catch (e) { /* ignore */ }
  }

  function start() {
    setText('version-badge', CFG.VERSION || 'v1');
    makeTouchIcon();
    restoreCache();
    window.Anim.init($('stage-canvas'));
    window.Chatter.init({ bubble: $('bubble'), radio: $('radio'), context: chatterContext, anchor: window.Anim.getAnchor, muted: lsGet(LS.mute) === '1' });
    setMute(lsGet(LS.mute) === '1');
    bindSettings();
    $('test-btn').onclick = toggleTest;
    $('chatter-mute').onclick = function () { setMute(!window.Chatter.isMuted()); };
    $('chatter-say').onclick = function () { window.Chatter.say(); };
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { requestWake(); if (Date.now() - app.lastOk > 20000) poll(); } });
    document.addEventListener('click', requestWake, { passive: true });
    requestWake();
    render();
    poll();
    setInterval(render, 1000);
  }

  window.RobApp = { testStep: function (i) { if (!app.test) toggleTest(); app.test.i = i % app.test.steps.length; app.test.stepStart = performance.now() - app.test.steps[app.test.i].ms * 0.5; render(); return app.test.steps[app.test.i].label; }, evaluate: evaluate, buildTimeline: buildTimeline, buildSample: buildSample, prepare: prepare };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
