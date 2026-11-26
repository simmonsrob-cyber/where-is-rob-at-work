/* Where Is Rob At Work? — panoramic Runway → Clouds → Runway animation (v1)
 * Pure HTML5 canvas, no assets. App calls Anim.setScene({...}) every second;
 * the engine animates continuously at display refresh rate. */
(function () {
  'use strict';
  var C = { navy: '#0A192F', navy2: '#003366', red: '#E01933', red2: '#C8102E', white: '#FFFFFF', ice: '#D8E4F2', slate: '#8FA3BF' };
  var canvas, ctx, W = 0, H = 0, S = 1, dpr = 1, scene = { state: 'AT_HOME' }, anchors = {}, clouds = [], stars = [];
  var t0 = performance.now(), lastT = 0, smoothP = null;

  function init(el) {
    canvas = el; ctx = el.getContext('2d');
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(el);
    else window.addEventListener('resize', resize);
    for (var i = 0; i < 9; i++) clouds.push({ x: Math.random(), y: 0.1 + Math.random() * 0.36, r: 0.6 + Math.random() * 0.9, v: 0.4 + Math.random() * 0.8 });
    for (var j = 0; j < 70; j++) stars.push({ x: Math.random(), y: Math.random() * 0.6, a: Math.random() });
    requestAnimationFrame(frame);
  }
  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = Math.min(W / 900, H / 340);
  }
  function setScene(s) {
    if (!s) return;
    if (s.state !== scene.state) smoothP = null;
    scene = s;
  }
  function getAnchor(who) { return anchors[who] || anchors.pilot || { x: 0.5, y: 0.45 }; }

  // ── primitives ──
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function txt(s, x, y, size, color, align, weight) {
    ctx.font = (weight || 700) + ' ' + size + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
  }
  function emoji(e, x, y, size) { ctx.font = size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e, x, y); }
  function setAnchor(k, x, y) { anchors[k] = { x: x / W, y: y / H }; }

  function sky(night, t) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    if (night) { g.addColorStop(0, '#040c1a'); g.addColorStop(0.7, '#0d2547'); g.addColorStop(1, '#16365f'); }
    else { g.addColorStop(0, '#5f9ad8'); g.addColorStop(0.65, '#a9c9ec'); g.addColorStop(1, '#d8e4f2'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (night) {
      stars.forEach(function (s) { ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.8 + s.a * 9)); ctx.fillStyle = '#fff'; ctx.fillRect(s.x * W, s.y * H, 1.6, 1.6); });
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f4f1de'; ctx.beginPath(); ctx.arc(W * 0.86, H * 0.16, 16 * S, 0, 7); ctx.fill();
      ctx.fillStyle = night ? '#0b1f3d' : '#fff'; ctx.beginPath(); ctx.arc(W * 0.86 + 7 * S, H * 0.16 - 4 * S, 14 * S, 0, 7); ctx.fill();
    } else {
      var sg = ctx.createRadialGradient(W * 0.88, H * 0.15, 4, W * 0.88, H * 0.15, 46 * S);
      sg.addColorStop(0, 'rgba(255,244,200,1)'); sg.addColorStop(0.35, 'rgba(255,230,150,0.9)'); sg.addColorStop(1, 'rgba(255,230,150,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(W * 0.88, H * 0.15, 46 * S, 0, 7); ctx.fill();
    }
  }
  function drawClouds(dt, speed, night) {
    clouds.forEach(function (c) {
      c.x -= dt * 0.012 * c.v * speed;
      if (c.x < -0.2) { c.x = 1.15; c.y = 0.08 + Math.random() * 0.38; }
      var x = c.x * W, y = c.y * H, r = 18 * S * c.r;
      ctx.fillStyle = night ? 'rgba(190,205,230,0.18)' : 'rgba(255,255,255,0.88)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.arc(x + r * 1.1, y - r * 0.4, r * 1.2, 0, 7); ctx.arc(x + r * 2.2, y, r * 0.95, 0, 7); ctx.arc(x + r * 1.1, y + r * 0.3, r, 0, 7); ctx.fill();
    });
  }
  function ground(gy, night, home) {
    var g = ctx.createLinearGradient(0, gy, 0, H);
    if (home) { g.addColorStop(0, night ? '#1d3b2a' : '#5f9b55'); g.addColorStop(1, night ? '#0f2418' : '#3d6e38'); }
    else { g.addColorStop(0, night ? '#1a2a3d' : '#7d8f75'); g.addColorStop(1, night ? '#0d1828' : '#5a6b55'); }
    ctx.fillStyle = g; ctx.fillRect(0, gy, W, H - gy);
  }
  function runway(x0, x1, y, code, night, active) {
    var h = 15 * S;
    ctx.fillStyle = night ? '#1e2733' : '#3a4048'; ctx.fillRect(x0, y, x1 - x0, h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (var x = x0 + 26 * S; x < x1 - 30 * S; x += 26 * S) ctx.fillRect(x, y + h / 2 - 1, 13 * S, 2);
    for (var k = 0; k < 4; k++) { ctx.fillRect(x0 + 4 * S, y + 2 + k * 3.2 * S, 10 * S, 1.6 * S); ctx.fillRect(x1 - 14 * S, y + 2 + k * 3.2 * S, 10 * S, 1.6 * S); }
    if (night) { for (var e = x0; e <= x1; e += 18 * S) { ctx.fillStyle = active ? '#ffe28a' : '#5fa8ff'; ctx.fillRect(e, y - 2, 2, 2); ctx.fillRect(e, y + h, 2, 2); } }
    txt(code || '', (x0 + x1) / 2, y + h + 13 * S, Math.max(12, 15 * S), night ? C.ice : '#fff', 'center', 900);
  }
  function terminal(x0, x1, gy, code, night, tower) {
    var h = 58 * S, w = x1 - x0;
    ctx.fillStyle = night ? '#24364f' : '#c7d3e3'; ctx.fillRect(x0, gy - h, w, h);
    ctx.fillStyle = C.navy2; ctx.fillRect(x0, gy - h, w, 7 * S);
    for (var x = x0 + 6 * S; x < x1 - 8 * S; x += 13 * S) for (var y = gy - h + 13 * S; y < gy - 10 * S; y += 14 * S) {
      ctx.fillStyle = night ? (Math.sin(x * 7 + y) > -0.3 ? '#ffd37a' : '#31465f') : '#7fa7d4'; ctx.fillRect(x, y, 8 * S, 9 * S);
    }
    if (tower) {
      var tx = x0 + w * 0.15;
      ctx.fillStyle = night ? '#2c405c' : '#b5c3d6'; ctx.fillRect(tx, gy - h - 40 * S, 9 * S, 40 * S);
      ctx.fillStyle = C.navy2; ctx.fillRect(tx - 7 * S, gy - h - 52 * S, 23 * S, 13 * S);
      ctx.fillStyle = night ? '#9fe0ff' : '#cfe9ff'; ctx.fillRect(tx - 5 * S, gy - h - 50 * S, 19 * S, 6 * S);
    }
    rr(x0 + w / 2 - 22 * S, gy - h - 16 * S, 44 * S, 15 * S, 4 * S); ctx.fillStyle = C.red; ctx.fill();
    txt(code || '', x0 + w / 2, gy - h - 8.5 * S, Math.max(10, 11 * S), '#fff', 'center', 900);
  }
  function plane(x, y, ang, sc, opts) {
    opts = opts || {};
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang || 0); ctx.scale(sc, sc);
    var rear = opts.fleet === '717';
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; if (opts.shadow) { ctx.beginPath(); ctx.ellipse(0, 16, 58, 5, 0, 0, 7); ctx.fill(); }
    // wing (far)
    ctx.fillStyle = '#aebbd0'; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-24, -14); ctx.lineTo(-15, -14); ctx.lineTo(8, 0); ctx.fill();
    // tail fin
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.moveTo(-52, -6); ctx.lineTo(-66, -32); ctx.lineTo(-52, -32); ctx.lineTo(-36, -6); ctx.fill();
    ctx.fillStyle = C.navy2; ctx.beginPath(); ctx.moveTo(-60, -20); ctx.lineTo(-66, -32); ctx.lineTo(-56, -32); ctx.lineTo(-48, -20); ctx.fill();
    if (rear) { ctx.fillStyle = '#e9eef5'; ctx.fillRect(-72, -34, 26, 3.5); }
    // fuselage
    ctx.fillStyle = '#fff'; rr(-62, -8, 118, 17, 8); ctx.fill();
    ctx.beginPath(); ctx.ellipse(55, 0.5, 11, 8.3, 0, -Math.PI / 2, Math.PI / 2); ctx.fill();
    ctx.fillStyle = C.navy2; rr(-60, 3, 112, 6, 3); ctx.fill();
    ctx.fillStyle = C.red2; ctx.fillRect(-58, 1.2, 108, 1.6);
    ctx.fillStyle = '#2d4f7c'; for (var i = -44; i < 40; i += 6.5) { ctx.beginPath(); ctx.arc(i, -2.5, 1.5, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#0d2342'; ctx.beginPath(); ctx.moveTo(56, -6); ctx.lineTo(63, -3); ctx.lineTo(56, -2); ctx.fill();
    if (!rear) { ctx.fillStyle = C.navy2; rr(-8, 7, 18, 7, 3.5); ctx.fill(); }
    else { ctx.fillStyle = C.navy2; rr(-50, -12, 18, 7, 3.5); ctx.fill(); }
    // wing (near)
    ctx.fillStyle = '#d5deea'; ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(-30, 22); ctx.lineTo(-19, 22); ctx.lineTo(12, 4); ctx.fill();
    if (opts.lights) { ctx.fillStyle = (Math.floor(performance.now() / 600) % 2) ? '#ff3b3b' : 'rgba(255,59,59,0.2)'; ctx.beginPath(); ctx.arc(-6, -11, 2, 0, 7); ctx.fill(); }
    if (opts.gearDown) { ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(40, 13, 2.6, 0, 7); ctx.arc(-6, 13, 3, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  function person(x, y, sc, color, phase, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    var sw = Math.sin(phase) * (o.run ? 9 : 5);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    if (o.sit) { ctx.moveTo(0, -10); ctx.lineTo(8, -10); ctx.lineTo(8, 0); }
    else { ctx.moveTo(0, -10); ctx.lineTo(sw * 0.6, 0); ctx.moveTo(0, -10); ctx.lineTo(-sw * 0.6, 0); }
    ctx.moveTo(0, -10); ctx.lineTo(0, -22);
    ctx.moveTo(0, -19); ctx.lineTo(-sw * 0.5 + (o.wave ? 6 : 0), o.wave ? -30 : -12);
    ctx.moveTo(0, -19); ctx.lineTo(sw * 0.5, -12);
    ctx.stroke();
    ctx.fillStyle = '#f1c9a5'; ctx.beginPath(); ctx.arc(0, -26, 4.2, 0, 7); ctx.fill();
    if (o.hat) { ctx.fillStyle = C.navy; ctx.fillRect(-5, -32, 10, 3.6); ctx.fillStyle = '#d4af37'; ctx.fillRect(-5, -29.4, 10, 1); }
    if (o.bag) { ctx.fillStyle = o.bagColor || '#222'; rr(o.bagSide > 0 ? 3 : -11, -11, 8, 10, 1.5); ctx.fill(); }
    ctx.restore();
  }
  function car(x, y, sc, color, label) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.fillStyle = color; rr(-22, -12, 44, 10, 4); ctx.fill(); rr(-13, -19, 25, 9, 4); ctx.fill();
    ctx.fillStyle = '#bfe3ff'; ctx.fillRect(-10, -17, 9, 6); ctx.fillRect(1, -17, 9, 6);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-12, -2, 4, 0, 7); ctx.arc(12, -2, 4, 0, 7); ctx.fill();
    if (label) { ctx.fillStyle = '#111'; ctx.fillRect(-8, -24, 16, 5); txt(label, 0, -21.4, 4.2, '#ffd400', 'center', 900); }
    ctx.restore();
  }
  function hotel(x, gy, sc, name, night, t) {
    var w = 74 * sc, h = 120 * sc, x0 = x - w / 2;
    ctx.fillStyle = night ? '#2b2547' : '#d9cfe8'; ctx.fillRect(x0, gy - h, w, h);
    ctx.fillStyle = night ? '#3c3466' : '#b9a9d6'; ctx.fillRect(x0, gy - h, w, 6 * sc);
    for (var r = 0; r < 7; r++) for (var c = 0; c < 4; c++) {
      var lit = night ? (Math.sin(r * 3.1 + c * 7.7) > 0.1) : false;
      ctx.fillStyle = lit ? '#ffd37a' : (night ? '#1c1836' : '#8fa7cf');
      ctx.fillRect(x0 + 8 * sc + c * 16 * sc, gy - h + 14 * sc + r * 14.5 * sc, 9 * sc, 9 * sc);
    }
    rr(x - 26 * sc, gy - h - 16 * sc, 52 * sc, 14 * sc, 3 * sc); ctx.fillStyle = C.red; ctx.fill();
    txt('HOTEL', x, gy - h - 9 * sc, 9 * sc, '#fff', 'center', 900);
    ctx.fillStyle = '#5a3d1e'; ctx.fillRect(x - 7 * sc, gy - 15 * sc, 14 * sc, 15 * sc);
    if (name) txt(name.length > 26 ? name.slice(0, 25) + '…' : name, x, gy + 12 * sc, Math.max(10, 9.5 * sc), '#fff', 'center', 700);
    if (night) { var zt = (t % 3) / 3; ctx.globalAlpha = 1 - zt; txt('z Z z', x + 18 * sc + zt * 20 * sc, gy - h + 30 * sc - zt * 40 * sc, 11 * sc, '#fff', 'center', 900); ctx.globalAlpha = 1; }
  }
  function house(x, gy, sc, night) {
    ctx.fillStyle = night ? '#e7d9c2' : '#fff6e6'; ctx.fillRect(x - 60 * sc, gy - 70 * sc, 120 * sc, 70 * sc);
    ctx.fillStyle = C.navy2; ctx.beginPath(); ctx.moveTo(x - 72 * sc, gy - 68 * sc); ctx.lineTo(x, gy - 112 * sc); ctx.lineTo(x + 72 * sc, gy - 68 * sc); ctx.fill();
    ctx.fillStyle = '#3a6b9a'; ctx.fillRect(x - 60 * sc, gy - 46 * sc, 120 * sc, 4 * sc);
    ctx.fillStyle = C.red2; ctx.fillRect(x - 9 * sc, gy - 34 * sc, 18 * sc, 34 * sc);
    ctx.fillStyle = night ? '#ffd37a' : '#9cc4ea'; ctx.fillRect(x - 45 * sc, gy - 36 * sc, 22 * sc, 18 * sc); ctx.fillRect(x + 23 * sc, gy - 36 * sc, 22 * sc, 18 * sc);
    ctx.fillRect(x - 10 * sc, gy - 92 * sc, 20 * sc, 14 * sc);
    palm(x - 110 * sc, gy, sc); palm(x + 118 * sc, gy, sc * 0.85);
  }
  function palm(x, gy, sc) {
    ctx.strokeStyle = '#7a5a33'; ctx.lineWidth = 7 * sc; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.quadraticCurveTo(x + 8 * sc, gy - 50 * sc, x + 2 * sc, gy - 92 * sc); ctx.stroke();
    ctx.strokeStyle = '#2f7a3c'; ctx.lineWidth = 5 * sc;
    for (var a = 0; a < 7; a++) { var an = -Math.PI + a * (Math.PI / 6); ctx.beginPath(); ctx.moveTo(x + 2 * sc, gy - 92 * sc); ctx.quadraticCurveTo(x + Math.cos(an) * 22 * sc, gy - 104 * sc + Math.sin(an) * 8 * sc, x + Math.cos(an) * 40 * sc, gy - 88 * sc + Math.abs(Math.sin(an)) * 6 * sc); ctx.stroke(); }
  }
  function board(x, y, w, lines, t) {
    rr(x - w / 2, y, w, 22 + lines.length * 16 * S, 6); ctx.fillStyle = '#0b0f14'; ctx.fill();
    ctx.strokeStyle = '#2a3442'; ctx.lineWidth = 2; ctx.stroke();
    txt('DEPARTURES', x, y + 11, Math.max(10, 10 * S), '#ffd400', 'center', 900);
    lines.forEach(function (l, i) { var blink = l.blink && Math.floor(t * 2) % 2; txt(l.text, x, y + 26 + i * 16 * S, Math.max(10, 11 * S), blink ? '#ff5a5a' : (l.color || '#e6f0ff'), 'center', 800); });
  }
  function bezier(p0, c, p1, t) {
    var u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
      dx: 2 * u * (c.x - p0.x) + 2 * t * (p1.x - c.x), dy: 2 * u * (c.y - p0.y) + 2 * t * (p1.y - c.y) };
  }
  function crowd(x0, x1, y, t, n, speed, dir, palette) {
    var out = null;
    for (var i = 0; i < n; i++) {
      var f = ((t * speed * 0.11) + i / n) % 1;
      var x = dir > 0 ? x0 + (x1 - x0) * f : x1 - (x1 - x0) * f;
      ctx.globalAlpha = Math.min(1, f * 6, (1 - f) * 6);
      person(x, y, S * 0.95, palette[i % palette.length], t * 9 + i, { bag: i % 2 === 0, bagSide: -dir, bagColor: ['#333', '#7b2d26', '#1f4f8f'][i % 3] });
      if (i === Math.floor(n / 2)) out = { x: x, y: y - 30 * S };
    }
    ctx.globalAlpha = 1;
    return out;
  }

  // ── frame ──
  function frame(now) {
    var t = (now - t0) / 1000, dt = Math.min(0.1, t - lastT); lastT = t;
    if (W < 2) { requestAnimationFrame(frame); return; }
    try { draw(t, dt); } catch (e) { /* keep animating */ }
    requestAnimationFrame(frame);
  }

  function draw(t, dt) {
    var s = scene, st = s.state || 'AT_HOME', night = !!s.night;
    var gy = H * 0.78, rwY = gy + (H - gy) * 0.28;
    var L = { term0: W * 0.03, term1: W * 0.19, park: W * 0.30, rw0: W * 0.04, rw1: W * 0.33 };
    var R = { term0: W * 0.69, term1: W * 0.84, park: W * 0.60, rw0: W * 0.56, rw1: W * 0.86 };
    var hotelX = W * 0.935;
    var p = s.progress == null ? 0 : s.progress;
    if (smoothP == null) smoothP = p; smoothP += (p - smoothP) * Math.min(1, dt * 3);
    var fleet = s.fleet || '';
    var cruiseSpeed = st === 'IN_FLIGHT' ? 5 : 1;
    anchors = {};
    ctx.clearRect(0, 0, W, H);
    sky(night, t);
    drawClouds(dt, cruiseSpeed, night);

    if (st === 'AT_HOME') {
      ground(gy, night, true);
      house(W * 0.42, gy, S, night);
      var dogX = W * 0.62 + Math.sin(t * 0.7) * W * 0.08, catX = W * 0.22 + Math.sin(t * 0.45 + 2) * W * 0.05;
      emoji('🐕', dogX, gy - 12 * S, 26 * S); emoji('🐕', dogX + 34 * S, gy - 10 * S, 20 * S); emoji('🐈', catX, gy - 10 * S, 22 * S); emoji('🐈‍⬛', W * 0.53, gy - 78 * S, 18 * S);
      person(W * 0.47, gy, S * 1.2, '#2b5d9c', 0, { wave: Math.floor(t) % 4 === 0 });
      emoji('❤️', W * 0.47, gy - 54 * S - (t % 2) * 6 * S, 14 * S);
      txt('HOME · ' + (s.homeCode || 'CHS'), W * 0.42, gy + 22 * S, Math.max(12, 15 * S), '#fff', 'center', 900);
      setAnchor('pilot', W * 0.47, gy - 46 * S); setAnchor('thought', W * 0.47, gy - 50 * S); setAnchor('pax', W * 0.62, gy - 30 * S);
      return;
    }

    ground(gy, night, false);
    var leftCode = s.origin || '', rightCode = s.dest || '';
    var showRight = true;
    runway(L.rw0, L.rw1, rwY, leftCode, night, st === 'BOARDING' || st === 'IN_FLIGHT');
    if (showRight) runway(R.rw0, R.rw1, rwY, rightCode, night, st === 'IN_FLIGHT');
    terminal(L.term0, L.term1, gy, leftCode, night, true);
    terminal(R.term0, R.term1, gy, rightCode, night, false);

    var hotelScene = { DRIVING_TO_HOTEL: 1, AT_HOTEL: 1, DRIVING_TO_AIRPORT: 1 }[st];
    if (hotelScene) {
      ctx.fillStyle = night ? '#2a3240' : '#4b5157'; ctx.fillRect(R.term1, gy - 4 * S, hotelX - R.term1, 6 * S);
      hotel(hotelX, gy, S * (st === 'AT_HOTEL' ? 1.08 : 0.9), s.hotelName ? titleCase(s.hotelName) : '', night, t);
    }
    var palette = ['#e05a47', '#3f7cc4', '#2bb673', '#f5a623', '#8e5bd1', '#e0e0e0'];
    var planeSc = S * 0.95, parkY = gy - 15 * S;

    switch (st) {
      case 'TRAVELING_TO_WORK': {
        var p0 = { x: L.rw1 - 20 * S, y: gy - 12 * S }, p1 = { x: R.rw0 + 20 * S, y: gy - 12 * S }, cc = { x: W * 0.45, y: H * 0.04 };
        if (smoothP < 0.2) {
          var cx = L.term0 + (L.park - L.term0) * (smoothP / 0.2);
          car(cx, gy + 2 * S, S * 1.1, '#2b5d9c'); setAnchor('pilot', cx, gy - 30 * S);
          plane(L.park + 40 * S, parkY, 0, planeSc * 0.85, { shadow: true });
        } else if (smoothP < 0.8) {
          var b = bezier(p0, cc, p1, (smoothP - 0.2) / 0.6);
          plane(b.x, b.y, Math.atan2(b.dy, b.dx) * 0.45, planeSc * 0.8, { lights: true });
          setAnchor('pilot', b.x, b.y - 18 * S);
        } else {
          plane(R.park, parkY, 0, planeSc * 0.85, { shadow: true });
          var wx = R.park + 30 * S + (R.term0 + 10 * S - R.park - 30 * S) * ((smoothP - 0.8) / 0.2);
          person(wx, gy, S * 1.1, C.navy, t * 9, { hat: true, bag: true, bagSide: -1 }); setAnchor('pilot', wx, gy - 40 * S);
        }
        txt('COMMUTE  ' + (s.homeCode || 'CHS') + ' → ' + (s.baseCode || 'ATL'), W * 0.45, H * 0.53, Math.max(12, 13 * S), night ? C.ice : C.navy, 'center', 900);
        break;
      }
      case 'BOARDING': {
        plane(L.park + 40 * S, parkY, 0, planeSc, { shadow: true, fleet: fleet, lights: true });
        var a1 = crowd(L.term1, L.park, gy, t, 6, s.isDeadhead ? 1 : 1.2, 1, palette);
        person(L.park + 82 * S, gy, S * 1.1, C.navy, 0, { hat: true, wave: Math.floor(t * 1.5) % 3 === 0 });
        if (s.isDeadhead) { emoji('📱', L.park + 88 * S, gy - 44 * S, 16 * S); }
        setAnchor('pilot', L.park + 82 * S, gy - 44 * S); if (a1) setAnchor('pax', a1.x, a1.y);
        board(W * 0.47, H * 0.08, 170 * S, [{ text: (s.flightNumber || '') + '  ' + (s.dest || ''), color: '#fff' }, { text: s.isDeadhead ? 'DEADHEAD · BOARDING' : 'BOARDING', blink: true }], t);
        break;
      }
      case 'IN_FLIGHT': {
        var fp = s.flightProgress == null ? smoothP : s.flightProgress;
        var q0 = { x: L.rw1 - 14 * S, y: gy - 12 * S }, q1 = { x: R.rw0 + 14 * S, y: gy - 12 * S }, qc = { x: W * 0.45, y: H * 0.02 };
        var ease = fp < 0.5 ? 2 * fp * fp : 1 - Math.pow(-2 * fp + 2, 2) / 2;
        var bb = bezier(q0, qc, q1, Math.max(0, Math.min(1, 0.1 + ease * 0.8 + (fp - ease) * 0.1)));
        ctx.setLineDash([6 * S, 8 * S]); ctx.strokeStyle = night ? 'rgba(216,228,242,0.35)' : 'rgba(10,25,47,0.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.quadraticCurveTo(qc.x, qc.y, q1.x, q1.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3 * S; ctx.beginPath(); ctx.moveTo(bb.x - 55 * S, bb.y + 2); ctx.lineTo(bb.x - 150 * S, bb.y + 6 * S); ctx.stroke();
        plane(bb.x, bb.y, Math.atan2(bb.dy, bb.dx) * 0.45, planeSc * 0.95, { fleet: fleet, lights: true, gearDown: fp < 0.06 || fp > 0.94 });
        if (s.isDeadhead) emoji('📱', bb.x - 40 * S, bb.y - 26 * S, 16 * S);
        setAnchor('pilot', bb.x + 30 * S, bb.y - 16 * S); setAnchor('pax', bb.x - 20 * S, bb.y - 16 * S);
        txt(Math.round(fp * 100) + '%', bb.x, bb.y + 34 * S, Math.max(11, 12 * S), night ? '#fff' : C.navy, 'center', 900);
        break;
      }
      case 'DEPLANING':
      case 'SHORTENED_TURN': {
        var quick = st === 'SHORTENED_TURN';
        plane(R.park, parkY, 0, planeSc, { shadow: true, fleet: fleet });
        var dA = crowd(R.park + 40 * S, R.term0 - 4 * S, gy, t, quick ? 4 : 6, quick ? 2.2 : 1.2, 1, palette);
        if (quick) crowd(R.park + 40 * S, R.term0 - 4 * S, gy + 8 * S, t + 3, 4, 2.2, -1, palette.slice().reverse());
        person(R.park - 52 * S, gy, S * 1.1, C.navy, 0, { hat: true, wave: Math.floor(t) % 3 === 0 });
        setAnchor('pilot', R.park - 52 * S, gy - 44 * S); if (dA) setAnchor('pax', dA.x, dA.y);
        if (quick) {
          var cxq = W * 0.47, cyq = H * 0.2, rq = 24 * S;
          ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 6 * S; ctx.beginPath(); ctx.arc(cxq, cyq, rq, 0, 7); ctx.stroke();
          ctx.strokeStyle = C.red; ctx.beginPath(); ctx.arc(cxq, cyq, rq, -Math.PI / 2, -Math.PI / 2 + smoothP * Math.PI * 2); ctx.stroke();
          txt('QUICK TURN', cxq, cyq + rq + 14 * S, Math.max(11, 12 * S), night ? '#fff' : C.navy, 'center', 900);
        }
        break;
      }
      case 'LONG_TURN_HANGOUT': {
        var pre = s.sub === 'preflight';
        if (pre) {
          plane(L.park + 40 * S, parkY, 0, planeSc, { shadow: true, fleet: fleet });
          var wk = L.park - 20 * S + (Math.sin(t * 0.5) * 0.5 + 0.5) * 130 * S;
          person(wk, gy, S * 1.1, C.navy, t * 7, { hat: true });
          emoji('🔦', wk + 10 * S, gy - 20 * S, 12 * S);
          setAnchor('pilot', wk, gy - 44 * S);
        } else {
          plane(R.park, parkY, 0, planeSc, { shadow: true, fleet: fleet });
          ctx.fillStyle = '#6b4a2b'; ctx.fillRect(R.term0 - 60 * S, gy - 12 * S, 44 * S, 4 * S);
          person(R.term0 - 46 * S, gy - 2 * S, S * 1.1, C.navy, 0, { hat: true, sit: true });
          emoji('☕', R.term0 - 28 * S, gy - 22 * S - Math.abs(Math.sin(t)) * 2, 14 * S);
          if (Math.floor(t / 4) % 2) emoji('📱', R.term0 - 54 * S, gy - 30 * S, 12 * S);
          setAnchor('pilot', R.term0 - 46 * S, gy - 44 * S); setAnchor('thought', R.term0 - 46 * S, gy - 50 * S);
        }
        break;
      }
      case 'DRIVING_TO_HOTEL':
      case 'DRIVING_TO_AIRPORT': {
        var toHotel = st === 'DRIVING_TO_HOTEL';
        plane(R.park, parkY, 0, planeSc, { shadow: true, fleet: fleet });
        var walkPart = toHotel ? smoothP < 0.25 : smoothP > 0.8;
        var curb = R.term1 + 20 * S;
        if (walkPart) {
          var wf = toHotel ? smoothP / 0.25 : (smoothP - 0.8) / 0.2;
          var px0 = toHotel ? R.park + 50 * S : curb - 20 * S, px1 = toHotel ? curb - 20 * S : R.park + 50 * S;
          var pxx = px0 + (px1 - px0) * wf;
          person(pxx, gy, S * 1.05, C.navy, t * 9, { hat: true, bag: true, bagSide: toHotel ? -1 : 1 });
          person(pxx - 16 * S, gy, S * 1.05, '#2b5d9c', t * 9 + 1, { hat: true, bag: true, bagSide: toHotel ? -1 : 1 });
          car(curb + 10 * S, gy + 2 * S, S * 1.1, '#f2c200', 'TAXI');
          setAnchor('pilot', pxx, gy - 44 * S);
        } else {
          var df = toHotel ? (smoothP - 0.25) / 0.75 : smoothP / 0.8;
          var c0 = toHotel ? curb + 10 * S : hotelX - 50 * S, c1 = toHotel ? hotelX - 50 * S : curb + 10 * S;
          var cxx = c0 + (c1 - c0) * Math.max(0, Math.min(1, df));
          car(cxx, gy + 2 * S, S * 1.1, '#f2c200', 'TAXI');
          setAnchor('pilot', cxx, gy - 34 * S); setAnchor('pax', cxx, gy - 34 * S);
        }
        break;
      }
      case 'AT_HOTEL': {
        plane(R.park - 20 * S, parkY, 0, planeSc * 0.9, { shadow: true, fleet: fleet });
        car(hotelX - 62 * S, gy + 2 * S, S, '#f2c200', 'TAXI');
        var wy = gy - 120 * S * 1.08 + 20 * S;
        setAnchor('pilot', hotelX - 12 * S, wy); setAnchor('thought', hotelX - 12 * S, wy);
        if (s.earlyShow) txt('⏰ EARLY SHOW', hotelX - 10 * S, gy - 152 * S, Math.max(10, 10 * S), '#ffd400', 'center', 900);
        break;
      }
      case 'RUNNING_FOR_STANDBY_HOME': {
        plane(R.park, parkY, 0, planeSc, { shadow: true, fleet: fleet });
        board(W * 0.43, H * 0.06, 200 * S, [{ text: 'DL ····  ' + (s.homeCode || 'CHS') + '  CHARLESTON', color: '#fff' }, { text: 'STANDBY · FINAL CALL', blink: true }], t);
        var span = W * 0.42, rx = W * 0.2 + (Math.sin(t * 1.3) * 0.5 + 0.5) * span, dir = Math.cos(t * 1.3) >= 0 ? 1 : -1;
        person(rx, gy, S * 1.15, C.navy, t * 16, { hat: true, run: true, bag: true, bagSide: -dir });
        emoji('💦', rx - dir * 12 * S, gy - 34 * S, 10 * S);
        crowd(W * 0.1, W * 0.55, gy + 10 * S, t, 3, 0.8, -1, palette);
        setAnchor('pilot', rx, gy - 46 * S); setAnchor('thought', rx, gy - 50 * S);
        break;
      }
      case 'COMMUTING_HOME': {
        plane(R.park, parkY, 0, planeSc, { shadow: true });
        rr(W * 0.33, H * 0.06, 220 * S, 40 * S, 6); ctx.fillStyle = C.navy2; ctx.fill();
        txt('GATE · DESTINATION: HOME', W * 0.33 + 110 * S, H * 0.06 + 13 * S, Math.max(10, 11 * S), '#fff', 'center', 900);
        txt((s.homeCode || 'CHS') + ' · ' + (s.commuteNote || 'no travel listed'), W * 0.33 + 110 * S, H * 0.06 + 29 * S, Math.max(9, 10 * S), C.ice, 'center', 700);
        ctx.fillStyle = '#6b4a2b'; ctx.fillRect(W * 0.38, gy - 12 * S, 70 * S, 4 * S);
        person(W * 0.40, gy - 2 * S, S * 1.15, C.navy, 0, { hat: true, sit: true });
        person(W * 0.46, gy - 2 * S, S * 1.0, '#8e5bd1', 0, { sit: true });
        var icons = ['❤️', '🐕', '🐈', '🏠', '🌴'], ic = icons[Math.floor(t / 2.2) % icons.length];
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.arc(W * 0.40 + 6 * S, gy - 52 * S, 3 * S, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(W * 0.40 + 14 * S, gy - 64 * S, 5 * S, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(W * 0.40 + 34 * S, gy - 88 * S, 24 * S, 17 * S, 0, 0, 7); ctx.fill();
        emoji(ic, W * 0.40 + 34 * S, gy - 88 * S, 20 * S);
        setAnchor('pilot', W * 0.40, gy - 46 * S); setAnchor('thought', W * 0.52, gy - 70 * S);
        break;
      }
      default:
        plane(L.park + 40 * S, parkY, 0, planeSc, { shadow: true });
        setAnchor('pilot', L.park, gy - 40 * S);
    }
  }
  function titleCase(s) {
    return String(s).toLowerCase().replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
  }

  window.Anim = { init: init, setScene: setScene, getAnchor: getAnchor, titleCase: titleCase };
})();
