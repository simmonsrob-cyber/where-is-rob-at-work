/* Where Is Rob At Work? — "Chatter & Radio" engine (v1)
 * Context-aware Airplane! one-liners, passenger/pilot banter, fake ATC calls and
 * "thinking of home" thoughts. One line at a time — never overlapping. */
(function () {
  'use strict';

  var AIRPLANE = [
    "Surely you can't be serious. — I am serious… and don't call me Shirley.",
    "Looks like I picked the wrong week to quit smoking.",
    "Roger, Roger. What's our vector, Victor?",
    "We have clearance, Clarence.",
    "I just want to tell you both good luck. We're all counting on you.",
    "The white zone is for immediate loading and unloading of passengers only.",
    "Excuse me, I speak jive.",
    "Nervous? — Yes. — First time? — No, I've been nervous lots of times.",
    "What is it? — It's a big building with patients, but that's not important right now.",
    "Can you fly this plane and land it? — Surely you can't be serious."
  ];

  var POOLS = {
    AT_HOME: [
      ['rob', "Off duty. Dogs walked, cats fed, wife happy ❤️"],
      ['rob', "No uniform today — just flip-flops and Charleston sunshine."],
      ['rob', "Porch weather: {temp}. The palmettos approve."],
      ['thought', "Day off plan: coffee, couch, dogs, repeat. 🐕"],
      ['rob', "The cats have been informed I'm home. They are unimpressed. 🐈"]
    ],
    TRAVELING_TO_WORK: [
      ['rob', "Commuting {home} → {base}. Jumpseat gods, be kind."],
      ['rob', "Kissed the wife, hugged the dogs, saluted the cats — off to work!"],
      ['thought', "Report at {report}. Coffee first, then airplanes. ☕"],
      ['atc', "Charleston Ground, commuter pilot requesting a smooth day, over."]
    ],
    PREFLIGHT: [
      ['rob', "Walkaround time — tires kicked, lights checked, coffee secured."],
      ['rob', "Checklist complete. Coffee: also complete."],
      ['atc', "{originCity} Clearance, Delta {num}, cleared to {dest} as filed."]
    ],
    BOARDING: [
      ['pax', "Group 6? That's basically the parking lot."],
      ['pax', "Is this the flight to {destCity}? Phew."],
      ['pax', "Biscoff or pretzels… the eternal question."],
      ['rob', "Welcome aboard, folks — smooth ride to {destCity} today."],
      ['atc', "{originCity} Ground, Delta {num}, push approved, tail east."],
      ['airplane']
    ],
    DEADHEAD: [
      ['rob', "Deadheading in {seat}. Contactable & chilling in the back of the plane. 📱"],
      ['rob', "Somebody else is flying — text me! 😎"],
      ['pax', "Is that a pilot… in the back… with the snacks?"]
    ],
    IN_FLIGHT: [
      ['rob', "Folks, from the flight deck: we're level at {fl}. Enjoy the view."],
      ['rob', "Little bumps ahead — nothing a ginger ale can't fix."],
      ['atc', "Delta {num}, contact Center one-two-eight point one, good day."],
      ['atc', "Delta {num}, descend and maintain one-one thousand."],
      ['atc', "Delta {num}, traffic twelve o'clock, five miles, a Boeing — he's probably also thinking about snacks."],
      ['pax', "Is the captain the one with the good landings? I hope so."],
      ['airplane']
    ],
    DEPLANING: [
      ['rob', "Welcome to {destCity}! Local time is {local}."],
      ['pax', "Thanks for the smooth landing, captain!"],
      ['atc', "Delta {num}, welcome to {destCity}, taxi to the gate."],
      ['airplane']
    ],
    SHORTENED_TURN: [
      ['rob', "Quick turn! Clean, cater, coffee, go."],
      ['rob', "{turn} on the ground — that's a sprint, not a layover."],
      ['pax', "Wait, we're leaving already? I just got my bag down."],
      ['atc', "{originCity} Ground, Delta {num}, ready to push in about twenty."]
    ],
    LONG_TURN_HANGOUT: [
      ['rob', "Terminal food tour: today's special is airport tacos."],
      ['rob', "Found the one outlet in this terminal that works. Victory."],
      ['thought', "Should I text home? Yes. Yes I should. 📱"],
      ['rob', "{turn} until boarding. Time for a walk… and a cookie."]
    ],
    DRIVING_TO_HOTEL: [
      ['pax', "Van driver: 'You folks with the crew?' — Every time."],
      ['rob', "{hotel}, here we come. Pillows await."],
      ['rob', "Crew van radio is playing smooth jazz. Living the dream."]
    ],
    AT_HOTEL: [
      ['rob', "Room service? Nah — vending machine gourmet tonight."],
      ['thought', "Missing the wife, the dogs, and the cats. 🐕🐈❤️"],
      ['rob', "Hotel gym, hotel coffee, hotel nap. In that order."],
      ['thought', "{early}"]
    ],
    DRIVING_TO_AIRPORT: [
      ['rob', "Van to the airport. The sun isn't even on duty yet."],
      ['pax', "Driver: 'Which terminal?' — Rob: 'The one with the coffee.'"],
      ['rob', "Leaving {hotel} — back to work!"]
    ],
    RUNNING_FOR_STANDBY_HOME: [
      ['rob', "Excuse me! Pardon! Pilot on a mission!"],
      ['rob', "Standby list: Rob. Fingers crossed for a seat to Charleston!"],
      ['atc', "Gate agent: 'Final call for Charleston — standby passengers to the podium.'"],
      ['thought', "Run, Rob, run! Home is one flight away. 🏃"]
    ],
    COMMUTING_HOME: [
      ['thought', "Can't wait to see my wife ❤️"],
      ['thought', "Wonder if the dogs ate the couch again 🐕"],
      ['thought', "The cats are definitely plotting something 🐈"],
      ['thought', "Home soon — Charleston, here I come 🌴"],
      ['thought', "Who's walking the dogs tonight? Me. Happily."],
      ['thought', "Dinner at home > airport dinner. Every time. 🏠"]
    ]
  };

  var NAMES = { rob: 'Rob', pax: 'Passenger', thought: 'Rob is thinking…', atc: 'Radio' };
  var muted = false, timer = null, hideTimer = null, recent = [], getCtx = null, anchorFn = null;
  var bubbleEl, radioEl;

  function fill(tpl, c) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) { return c[k] != null && c[k] !== '' ? c[k] : '—'; });
  }
  function poolFor(c) {
    if (c.isDeadhead && (c.state === 'BOARDING' || c.state === 'IN_FLIGHT')) return POOLS.DEADHEAD.concat(POOLS[c.state].filter(function (x) { return x[0] !== 'rob'; }));
    if (c.state === 'LONG_TURN_HANGOUT' && c.sub === 'preflight') return POOLS.PREFLIGHT;
    return POOLS[c.state] || POOLS.AT_HOME;
  }
  function pick(c) {
    var pool = poolFor(c);
    for (var tries = 0; tries < 8; tries++) {
      var item = pool[Math.floor(Math.random() * pool.length)];
      var kind = item[0], text;
      if (kind === 'airplane') { kind = Math.random() < 0.5 ? 'pax' : 'rob'; text = AIRPLANE[Math.floor(Math.random() * AIRPLANE.length)]; }
      else text = fill(item[1], c);
      if (/—$|^—$/.test(text.trim())) continue;
      if (recent.indexOf(text) === -1) { recent.push(text); if (recent.length > 8) recent.shift(); return { kind: kind, text: text }; }
    }
    return null;
  }

  function show(line) {
    if (!line) return;
    clearTimeout(hideTimer);
    if (line.kind === 'atc') {
      bubbleEl.hidden = true;
      radioEl.textContent = line.text;
      radioEl.hidden = false;
    } else {
      radioEl.hidden = true;
      var who = line.kind === 'pax' ? 'pax' : (line.kind === 'thought' ? 'thought' : 'pilot');
      var a = anchorFn ? anchorFn(who) : { x: 0.5, y: 0.5 };
      bubbleEl.className = 'bubble' + (line.kind === 'thought' ? ' thought' : '');
      bubbleEl.innerHTML = '';
      var w = document.createElement('span'); w.className = 'who'; w.textContent = NAMES[line.kind] || 'Rob';
      bubbleEl.appendChild(w);
      bubbleEl.appendChild(document.createTextNode(line.text));
      bubbleEl.style.left = Math.max(18, Math.min(82, a.x * 100)) + '%';
      bubbleEl.style.top = Math.max(26, Math.min(92, a.y * 100)) + '%';
      bubbleEl.hidden = false;
    }
    hideTimer = setTimeout(function () { bubbleEl.hidden = true; radioEl.hidden = true; }, 6500);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!muted && getCtx) show(pick(getCtx()));
      schedule();
    }, 10000 + Math.random() * 7000);
  }

  window.Chatter = {
    init: function (opts) {
      bubbleEl = opts.bubble; radioEl = opts.radio; getCtx = opts.context; anchorFn = opts.anchor;
      muted = !!opts.muted;
      schedule();
      setTimeout(function () { if (!muted) show(pick(getCtx())); }, 2500);
    },
    say: function () { if (getCtx) show(pick(getCtx())); },
    setMuted: function (m) { muted = !!m; if (muted) { bubbleEl.hidden = true; radioEl.hidden = true; } },
    isMuted: function () { return muted; },
    stateChanged: function () { recent = []; if (!muted) setTimeout(function () { show(pick(getCtx())); }, 1200); }
  };
})();
