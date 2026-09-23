(() => {
  'use strict';

  const { orgs: ORGS = [], events: EVENTS, people: PEOPLE, me: DEFAULT_ME, myEvents: DEFAULT_MY_EVENTS } = window.TXD_DATA;
  const EV = new Map(EVENTS.map(e => [e.id, e]));
  const ORG = new Map(ORGS.map(o => [o.id, o]));
  const STORE_KEY = 'techxdir:acreditacion:v1';
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const TODAY = new Date();
  TODAY.setHours(0, 0, 0, 0);
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CAN_HOVER = matchMedia('(hover: hover)').matches;
  const MOVE_MS = 1200; // el giro se hace siempre, también con "reducir movimiento"
  const LEAN = 12;  // al llegar, la tarjeta queda un poco girada hacia el panel
  // lado al que se desplaza la tarjeta según la zona pulsada
  const SIDE = { bio: 'right', events: 'left', people: 'left' };

  const $ = (sel, root = document) => root.querySelector(sel);
  const stage = $('#stage');
  const tilt = $('#tilt');
  const card = $('#card');
  const front = $('#front');
  const panel = $('#panel');
  const toast = $('#toast');

  let state = load();
  let current = null;   // sección abierta en el panel
  let busy = false;     // evita dobles clics mientras gira
  let turn = 0;         // ángulo acumulado de la tarjeta
  let lean = 0;         // inclinación final actual (0, LEAN o -LEAN)
  let evTab = 'mine';
  let pendingPhoto;     // undefined = sin cambios, null = quitar, string = nueva

  /* ───────── Persistencia ───────── */

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved && saved.me && Array.isArray(saved.myEvents)) return saved;
    } catch { /* sin almacenamiento: usamos los datos de ejemplo */ }
    return { me: { ...DEFAULT_ME }, myEvents: [...DEFAULT_MY_EVENTS] };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  /* ───────── Utilidades ───────── */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function hash(str) {
    let h = 2166136261;
    for (const ch of String(str)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const initials = name =>
    (String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const isPast = e => new Date(`${e.date}T00:00:00`) < TODAY;
  const byDateAsc = (a, b) => a.date.localeCompare(b.date);
  const byDateDesc = (a, b) => b.date.localeCompare(a.date);

  // año en que se sumó a la comunidad (los datos guardados antes no lo traen)
  const joinedYear = me => me.joined || DEFAULT_ME.joined || TODAY.getFullYear();

  function fmtDate(e) {
    const d = new Date(`${e.date}T00:00:00`);
    return { day: d.getDate(), mon: MONTHS[d.getMonth()], year: d.getFullYear() };
  }

  const avatar = p =>
    `<span class="av" style="--l:${70 + (hash(p.name) % 20)}%" aria-hidden="true">${esc(initials(p.name))}</span>`;

  const photoMarkup = (photo, name) => photo
    ? `<img src="${esc(photo)}" alt="Foto de ${esc(name)}">`
    : `<span class="initials" aria-hidden="true">${esc(initials(name))}</span>`;

  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  let toastTimer;
  function notify(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  /* ───────── Datos derivados ───────── */

  function contacts() {
    const mine = new Set(state.myEvents);
    return PEOPLE
      .map(p => ({ ...p, shared: p.events.filter(id => mine.has(id)).map(id => EV.get(id)).sort(byDateDesc) }))
      .filter(p => p.shared.length)
      .sort((a, b) => b.shared.length - a.shared.length || a.name.localeCompare(b.name, 'es'));
  }

  const contactsAt = (eventId, list) => list.filter(p => p.events.includes(eventId)).length;

  function myEventsSplit() {
    const evs = state.myEvents.map(id => EV.get(id)).filter(Boolean);
    return {
      past: evs.filter(isPast).sort(byDateDesc),
      upcoming: evs.filter(e => !isPast(e)).sort(byDateAsc)
    };
  }

  /* Organizaciones: cada evento pertenece a una; la acreditación muestra las tuyas */

  const orgOf = e => ORG.get(e?.org);

  // organizaciones con eventos marcados por ti, de más a menos eventos
  function myOrgs() {
    const count = new Map();
    for (const id of state.myEvents) {
      const o = orgOf(EV.get(id));
      if (o) count.set(o, (count.get(o) || 0) + 1);
    }
    return [...count].sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name, 'es')).map(([o]) => o);
  }

  const ORG_SHAPES = {
    circle: '<circle cx="20" cy="20" r="19"/>',
    square: '<rect x="1" y="1" width="38" height="38" rx="7"/>',
    squircle: '<rect x="1" y="1" width="38" height="38" rx="14"/>',
    hex: '<polygon points="20,1 37,10.5 37,29.5 20,39 3,29.5 3,10.5"/>',
    diamond: '<rect x="7" y="7" width="26" height="26" rx="5" transform="rotate(45 20 20)"/>',
    ring: '<circle cx="20" cy="20" r="17.5" fill="none" stroke="currentColor" stroke-width="3"/>'
  };

  // Logotipo: una imagen si `logo` es una URL, si no un monograma en SVG
  function orgLogo(o, cls = '') {
    if (!o) return '';
    const logo = o.logo || {};
    if (typeof logo === 'string') {
      return `<img class="org-logo ${cls}" src="${esc(logo)}" alt="${esc(o.name)}">`;
    }
    const mark = logo.mark || initials(o.name);
    const shape = ORG_SHAPES[logo.shape] ? logo.shape : 'circle';
    const size = [...mark].length > 1 ? (shape === 'diamond' ? 11 : 14) : 18;
    return `<svg class="org-logo is-${shape} ${cls}" viewBox="0 0 40 40" role="img" aria-label="${esc(o.name)}">
      <g fill="currentColor">${ORG_SHAPES[shape]}</g>
      <text x="20" y="20" dy=".35em" text-anchor="middle" font-size="${size}">${esc(mark)}</text>
    </svg>`;
  }

  /* ───────── Anverso: la acreditación es el menú ───────── */

  function renderFront(me = state.me) {
    const { past, upcoming } = myEventsSplit();
    const people = contacts();
    const shown = people.slice(0, 4);

    let sub = '';
    if (upcoming[0]) {
      const d = fmtDate(upcoming[0]);
      sub = `Próximo<b>${esc(upcoming[0].short)} · ${d.day} ${d.mon}</b>`;
    } else if (past[0]) {
      const d = fmtDate(past[0]);
      sub = `Último<b>${esc(past[0].short)} · ${d.mon} ${d.year}</b>`;
    }

    const stack = shown.map(avatar).join('') +
      (people.length > shown.length ? `<span class="av more">+${people.length - shown.length}</span>` : '');
    const orgs = myOrgs();
    const orgsShown = orgs.slice(0, 4);
    const orgRow = orgsShown.map(o => orgLogo(o)).join('') +
      (orgs.length > orgsShown.length ? `<span class="org-more">+${orgs.length - orgsShown.length}</span>` : '');
    const cardId = `TXD-${String(hash(me.handle) % 10000).padStart(4, '0')}`;
    const act = s => (current === s ? ' active' : '');

    front.innerHTML = `
      <span class="slot" aria-hidden="true"></span>
      <div class="top">
        <span class="wordmark">techx<b>dir</b></span>
        <span class="tier">Attendee</span>
      </div>

      <div class="grid">
        <button class="zone zone-photo${act('bio')}" type="button" data-open="bio" aria-label="Editar foto y bio">
          ${photoMarkup(me.photo, me.name)}
          <span class="photo-tag">Editar</span>
        </button>

        <button class="zone zone-events${act('events')}" type="button" data-open="events" aria-label="Ver mis eventos (${past.length} asistidos)">
          <span class="label">Eventos</span>
          ${orgRow ? `<span class="ev-orgs" title="Organizaciones de tus eventos">${orgRow}</span>` : ''}
          <strong class="num">${past.length}</strong>
          ${sub ? `<span class="sub">${sub}</span>` : ''}
        </button>

        <button class="zone zone-id${act('bio')}" type="button" data-open="bio" aria-label="Editar bio">
          <strong class="name">${esc(me.name || 'Tu nombre')}</strong>
          <span class="role">${esc([me.role, me.company].filter(Boolean).join(' · ')) || '&nbsp;'}</span>
          <span class="handle">@${esc(me.handle)}</span>
        </button>

        <button class="zone zone-people${act('people')}" type="button" data-open="people" aria-label="Ver personas con las que has coincidido (${people.length})">
          <span class="label">Coincidencias</span>
          <span class="people-row">
            <span><strong class="num">${people.length}</strong><span class="unit">${people.length === 1 ? 'persona' : 'personas'}</span></span>
            <span class="stack">${stack}</span>
          </span>
        </button>
      </div>

      <div class="foot">
        <button class="share-btn" type="button" id="shareBtn" aria-haspopup="menu" aria-controls="shareMenu"
          aria-expanded="${!document.getElementById('shareMenu')?.hidden}" title="${cardId}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>
          Compartir
        </button>
        <span class="tier">Desde ${joinedYear(me)}</span>
      </div>`;
  }

  /* ───────── Movimiento de la tarjeta ───────── */

  function ripple(zone, ev) {
    const r = zone.getBoundingClientRect();
    const fromPointer = ev && ev.detail > 0;
    const scale = r.width / zone.offsetWidth || 1; // en móvil la tarjeta está escalada
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.left = `${(fromPointer ? ev.clientX - r.left : r.width / 2) / scale}px`;
    dot.style.top = `${(fromPointer ? ev.clientY - r.top : r.height / 2) / scale}px`;
    zone.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove());
  }

  // Giro sobre el eje vertical (rotateY). Se hace con Web Animations para que
  // ocurra siempre, sin depender de transiciones CSS ni de "reducir movimiento".
  function spin(delta) {
    const from = turn;
    turn += delta;
    card.style.transform = `rotateY(${turn}deg)`;
    card.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${turn}deg)` }],
      { duration: MOVE_MS, easing: 'cubic-bezier(.65, 0, .25, 1)' }
    );
  }

  // Vuelta completa en el sentido del desplazamiento; null = volver al centro.
  function goTo(side) {
    const target = side === 'left' ? LEAN : side === 'right' ? -LEAN : 0;
    const dir = side === 'left' ? 1 : side === 'right' ? -1 : (lean > 0 ? -1 : 1);
    spin(dir * 360 + target - lean);
    lean = target;
  }

  function nudge() {
    if (REDUCED) return;
    tilt.animate(
      [{ rotate: 'y 0deg' }, { rotate: 'y -9deg' }, { rotate: 'y 0deg' }],
      { duration: 550, easing: 'cubic-bezier(.3,0,.2,1)' }
    );
  }

  function resetTilt() {
    tilt.classList.remove('tracking');
    tilt.style.setProperty('--rx', '0deg');
    tilt.style.setProperty('--ry', '0deg');
  }

  if (CAN_HOVER && !REDUCED) {
    tilt.addEventListener('pointermove', e => {
      if (current || busy) return;
      const r = card.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      tilt.classList.add('tracking');
      tilt.style.setProperty('--rx', `${((.5 - y) * 6).toFixed(2)}deg`);
      tilt.style.setProperty('--ry', `${((x - .5) * 8).toFixed(2)}deg`);
    });
    tilt.addEventListener('pointerleave', resetTilt);
  }

  function setActive(section) {
    front.querySelectorAll('[data-open]').forEach(z => z.classList.toggle('active', z.dataset.open === section));
  }

  /* ───────── Abrir / cambiar / cerrar ───────── */

  function open(section, zone, ev) {
    if (busy) return;
    if (current === section) return close();

    ripple(zone, ev);

    const side = SIDE[section];

    if (current) {
      const sameSide = SIDE[current] === side;
      if (current === 'bio') renderFront(); // descarta la vista previa sin guardar
      current = section;
      setActive(section);

      // mismo lado: solo cambia el panel
      if (sameSide) {
        renderPanel(section, 'switch');
        nudge();
        return;
      }

      // otro lado: la tarjeta cruza girando y el panel reaparece en el lado contrario
      busy = true;
      stage.classList.add('swapping');
      stage.classList.toggle('card-right', side === 'right');
      goTo(side);
      setTimeout(() => {
        renderPanel(section, 'initial');
        stage.classList.toggle('panel-left', side === 'right');
        stage.classList.remove('swapping');
      }, 250);
      setTimeout(() => {
        busy = false;
        $('[data-close]', panel)?.focus({ preventScroll: true });
      }, MOVE_MS);
      return;
    }

    busy = true;
    current = section;
    setActive(section);
    renderPanel(section, 'initial');
    resetTilt();

    stage.classList.toggle('card-right', side === 'right');
    stage.classList.toggle('panel-left', side === 'right');
    goTo(side);
    stage.classList.add('open');
    panel.inert = false;

    setTimeout(() => {
      busy = false;
      $('[data-close]', panel)?.focus({ preventScroll: true });
    }, MOVE_MS);
  }

  function close() {
    if (busy || !current) return;
    busy = true;
    const was = current;
    current = null;

    renderFront();
    goTo(null);
    stage.classList.remove('open');
    panel.inert = true;

    setTimeout(() => {
      busy = false;
      $(`[data-open="${was}"]`, front)?.focus({ preventScroll: true });
    }, MOVE_MS);
  }

  /* ───────── Panel ───────── */

  function renderPanel(section, mode) {
    const people = contacts();
    const { past, upcoming } = myEventsSplit();
    const heads = {
      bio: ['Tu bio', 'Los cambios se ven al momento en la acreditación.'],
      events: ['Eventos', `${plural(past.length, 'asistido', 'asistidos')} · ${plural(upcoming.length, 'próximo', 'próximos')}`],
      people: ['Personas', `Has coincidido con ${plural(people.length, 'persona', 'personas')}.`]
    };
    const [title, sub] = heads[section];

    panel.innerHTML = `
      <header class="panel-head">
        <div>
          <span class="label">${section === 'bio' ? 'Editar' : 'Tu acreditación'}</span>
          <h2>${title}</h2>
          <p>${sub}</p>
        </div>
        <button class="close" type="button" data-close aria-label="Cerrar">×</button>
      </header>
      <div class="panel-body" id="panelBody"></div>`;

    if (mode === 'switch') replay(panel, 'swap');
    const body = $('#panelBody', panel);
    body.style.setProperty('--base', mode === 'initial' ? '600ms' : '80ms');
    ({ bio: renderBio, events: renderEvents, people: renderPeople })[section](body);
  }

  /* Organizaciones */

  const orgEvents = o => EVENTS.filter(e => e.org === o.id);

  // Ficha de una organización: sus eventos, a cuáles has ido y tu red en ellos
  function showOrg(id, mode = 'enter') {
    const o = ORG.get(id);
    if (!o) return;
    const body = $('#panelBody', panel);
    const mine = new Set(state.myEvents);
    const people = contacts();
    const evs = orgEvents(o);
    const upcoming = evs.filter(e => !isPast(e)).sort(byDateAsc);
    const past = evs.filter(isPast).sort(byDateDesc);
    const went = past.filter(e => mine.has(e.id)).length;
    const going = upcoming.filter(e => mine.has(e.id)).length;
    const cities = [...new Set(evs.map(e => e.city))].join(' · ');
    const net = people.filter(p => p.events.some(eid => EV.get(eid)?.org === o.id)).length;

    let i = 3;
    const group = (title, list) => list.length
      ? `<h3 class="group-title" style="--i:${i++}">${title}</h3>${list.map(e => evItem(e, mine.has(e.id), contactsAt(e.id, people), i++)).join('')}`
      : '';

    body.style.setProperty('--base', '0ms');
    body.innerHTML = `
      <div class="stagger org-view" data-id="${o.id}">
        <button class="link back-link" type="button" data-view-back style="--i:0">${backLabel()}</button>

        <div class="orgv-head" style="--i:1">
          ${orgLogo(o, 'xl')}
          <div>
            <span class="label">Organización</span>
            <strong>${esc(o.name)}</strong>
            <span class="orgv-cities">${esc(cities)}</span>
          </div>
        </div>

        <dl class="evv-facts" style="--i:2">
          <div><dt>Eventos</dt><dd>${plural(evs.length, 'evento', 'eventos')}<small>${plural(upcoming.length, 'próximo', 'próximos')} · ${plural(past.length, 'celebrado', 'celebrados')}</small></dd></div>
          <div><dt>Tú</dt><dd>${went || going
            ? [went ? `Has ido a ${went}` : '', going ? `vas a ${going}` : ''].filter(Boolean).join(' · ')
            : '<span class="muted">Aún no has ido a ninguno</span>'}</dd></div>
          <div><dt>Tu red</dt><dd>${net ? `${plural(net, 'persona', 'personas')} con las que coincidiste` : '<span class="muted">Nadie de tu red todavía</span>'}</dd></div>
        </dl>

        ${group('Próximos', upcoming)}
        ${group('Anteriores', past)}
      </div>`;

    enterView(body, mode);
  }

  /* Navegación dentro del panel de eventos: lista → evento ⇄ organización → … */

  let evTrail = []; // pila de vistas abiertas: { type: 'event' | 'org', id }

  function backLabel() {
    const prev = evTrail[evTrail.length - 2];
    if (!prev) return '← Eventos';
    return `← ${esc(prev.type === 'org' ? ORG.get(prev.id).name : EV.get(prev.id).name)}`;
  }

  function enterView(body, mode) {
    if (mode === 'enter' || mode === 'back') {
      body.scrollTop = 0;
      replay(body, mode === 'enter' ? 'slide-in' : 'slide-back');
      if (mode === 'enter') $('[data-view-back]', body).focus({ preventScroll: true });
    }
  }

  function renderView(v, mode) {
    if (v.type === 'org') showOrg(v.id, mode);
    else showEvent(v.id, mode);
  }

  function pushView(v) {
    const top = evTrail[evTrail.length - 1];
    if (top && top.type === v.type && top.id === v.id) return;
    evTrail.push(v);
    renderView(v, 'enter');
  }

  function goBack() {
    const from = evTrail.pop();
    const prev = evTrail[evTrail.length - 1];
    if (!prev) return backToEvents(from);
    renderView(prev, 'back');
    const btn = $(`[data-${from.type}="${from.id}"]`, panel);
    if (btn) {
      btn.scrollIntoView({ block: 'center' });
      btn.focus({ preventScroll: true });
    }
  }

  /* Eventos */

  function renderEvents(body, mode = 'initial') {
    evTrail = [];
    body.innerHTML = `
      <div class="tabs" role="tablist">
        <button class="tab" type="button" role="tab" data-tab="mine" aria-selected="${evTab === 'mine'}">Mis eventos<b id="countMine"></b></button>
        <button class="tab" type="button" role="tab" data-tab="discover" aria-selected="${evTab === 'discover'}">Descubrir<b id="countDiscover"></b></button>
      </div>
      <div class="stagger" id="evList" role="tabpanel"></div>`;
    renderEvList(mode);
  }

  function renderEvList(mode) {
    const list = $('#evList', panel);
    if (!list) return;
    if (mode !== 'initial') list.style.setProperty('--base', '0ms');
    list.classList.toggle('quiet', mode === 'quiet');

    $('#countMine', panel).textContent = state.myEvents.length;
    $('#countDiscover', panel).textContent = EVENTS.length - state.myEvents.length;

    const people = contacts();
    const mine = new Set(state.myEvents);
    let groups;
    if (evTab === 'mine') {
      const { past, upcoming } = myEventsSplit();
      groups = [['Próximos', upcoming], ['Asistidos', past]];
    } else {
      const rest = EVENTS.filter(e => !mine.has(e.id));
      groups = [['Próximamente', rest.filter(e => !isPast(e)).sort(byDateAsc)], ['Ya celebrados', rest.filter(isPast).sort(byDateDesc)]];
    }

    let i = 0;
    let html = '';
    for (const [title, evs] of groups) {
      if (!evs.length) continue;
      html += `<h3 class="group-title" style="--i:${i++}">${title}</h3>`;
      for (const e of evs) html += evItem(e, mine.has(e.id), contactsAt(e.id, people), i++);
    }
    list.innerHTML = html || `<p class="empty">${evTab === 'mine'
      ? 'Aún no has marcado ningún evento.'
      : 'Ya tienes todos los eventos en tu acreditación.'}</p>`;
  }

  function evItem(e, on, known, i) {
    const d = fmtDate(e);
    const past = isPast(e);
    const label = on ? (past ? 'Fui ✓' : 'Voy ✓') : (past ? 'Fui' : 'Voy');
    const org = orgOf(e);
    let meta = `${org ? `${esc(org.name)} · ` : ''}${esc(e.city)}`;
    if (known) {
      meta += on
        ? ` · ${past ? 'coincidiste' : 'coincidirás'} con ${known}`
        : ` · ${plural(known, 'contacto', 'contactos')}`;
    }

    return `
      <article class="ev ev-link" style="--i:${i}">
        <button class="ev-open" type="button" data-event="${e.id}" aria-label="Ver ${esc(e.name)}">
          <span class="ev-date">${d.day} ${d.mon}<small>${d.year}</small></span>
          <span class="ev-info">
            <strong>${org ? orgLogo(org, 'xs') : ''}${esc(e.name)}</strong>
            <span>${meta}</span>
          </span>
        </button>
        <button class="pill${on ? ' is-on' : ''}" type="button" data-toggle="${e.id}" aria-pressed="${on}">${label}</button>
      </article>`;
  }

  /* Ficha de un evento: fechas, enlace y quién va */

  function fmtRange(e) {
    const a = new Date(`${e.date}T00:00:00`);
    const b = e.end ? new Date(`${e.end}T00:00:00`) : null;
    const days = b ? Math.round((b - a) / 864e5) + 1 : 1;
    let text;
    if (!b) text = `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
    else if (a.getMonth() === b.getMonth()) text = `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
    else text = `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
    const weekday = a.toLocaleDateString('es-ES', { weekday: 'long' });
    return { text, days, weekday };
  }

  function whenLabel(e) {
    const diff = Math.round((new Date(`${e.date}T00:00:00`) - TODAY) / 864e5);
    const end = e.end ? Math.round((new Date(`${e.end}T00:00:00`) - TODAY) / 864e5) : diff;
    if (diff > 1) return `Dentro de ${diff} días`;
    if (diff === 1) return 'Mañana';
    if (diff <= 0 && end >= 0) return 'Hoy';
    const ago = -end;
    if (ago < 31) return `Hace ${plural(ago, 'día', 'días')}`;
    const months = Math.round(ago / 30.4);
    return months < 12 ? `Hace ${plural(months, 'mes', 'meses')}` : `Hace ${plural(Math.round(months / 12), 'año', 'años')}`;
  }

  function showEvent(id, mode = 'enter') {
    const e = EV.get(id);
    if (!e) return;
    const body = $('#panelBody', panel);
    const past = isPast(e);
    const on = state.myEvents.includes(e.id);
    const r = fmtRange(e);
    const attendees = PEOPLE.filter(p => p.events.includes(e.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const label = on ? (past ? 'Fui ✓' : 'Voy ✓') : (past ? 'Fui' : 'Voy');
    const total = attendees.length + (on ? 1 : 0);

    const you = on ? `
      <li class="att att-you">
        ${state.me.photo ? `<span class="av av-photo"><img src="${esc(state.me.photo)}" alt=""></span>` : avatar(state.me)}
        <span class="p-info"><strong>Tú</strong><span><span class="p-handle">@${esc(state.me.handle)}</span></span></span>
      </li>` : '';
    const rows = attendees.map(p => `
      <li class="att">
        ${avatar(p)}
        <span class="p-info">
          <strong>${esc(p.name)}</strong>
          <span><span class="p-handle">@${esc(p.handle)}</span> · ${esc(p.role)}</span>
        </span>
      </li>`).join('');

    body.style.setProperty('--base', '0ms');
    body.innerHTML = `
      <div class="stagger event-view" data-id="${e.id}">
        <button class="link back-link" type="button" data-view-back style="--i:0">${backLabel()}</button>

        <div class="evv-head" style="--i:1">
          <span class="label">${esc(e.kind)} · ${whenLabel(e)}</span>
          <strong>${esc(e.name)}</strong>
        </div>

        <dl class="evv-facts" style="--i:2">
          <div><dt>Fecha</dt><dd>${r.text}<small>${r.days > 1 ? `${r.days} días · empieza en ${r.weekday}` : `Un día · ${r.weekday}`}</small></dd></div>
          ${orgOf(e) ? `<div><dt>Organiza</dt><dd><button class="evv-org" type="button" data-org="${orgOf(e).id}" aria-label="Ver ${esc(orgOf(e).name)}">${orgLogo(orgOf(e), 'sm')}${esc(orgOf(e).name)}<span aria-hidden="true">→</span></button></dd></div>` : ''}
          <div><dt>Lugar</dt><dd>${esc(e.city)}</dd></div>
          <div><dt>Web</dt><dd>${e.url
            ? `<a class="evv-url" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url.replace(/^https?:\/\/(www\.)?/, ''))} ↗</a>`
            : '<span class="muted">Sin enlace todavía</span>'}</dd></div>
        </dl>

        <div class="evv-actions" style="--i:3">
          <button class="pill${on ? ' is-on' : ''}" type="button" data-ev-toggle="${e.id}" aria-pressed="${on}">${label}</button>
          ${past ? '' : '<button class="link" type="button" data-ev-ics>Añadir al calendario</button>'}
        </div>

        <h3 class="group-title" style="--i:4">${past ? 'Quién fue' : 'Quién va'} · ${total}</h3>
        <ul class="att-list" style="--i:5">
          ${you}${rows || (on ? '' : `<li class="empty">Nadie de tu red ${past ? 'fue' : 'va'} todavía.</li>`)}
        </ul>
      </div>`;

    enterView(body, mode);
  }

  // vuelve a la lista (la pestaña en la que estabas) y enfoca lo que abriste
  function backToEvents(from) {
    const body = $('#panelBody', panel);
    renderEvents(body, 'quiet');
    replay(body, 'slide-back');
    const btn = from && $(`[data-${from.type}="${from.id}"]`, body);
    if (btn) {
      btn.scrollIntoView({ block: 'center' });
      btn.focus({ preventScroll: true });
    }
  }

  function toggleFromDetail(id) {
    const e = EV.get(id);
    const had = state.myEvents.includes(id);
    state.myEvents = had ? state.myEvents.filter(x => x !== id) : [...state.myEvents, id];
    save();
    renderFront();
    notify(had ? `${e.name} quitado` : `${e.name} añadido a tu acreditación`);
    showEvent(id, 'refresh');
    const btn = $('[data-ev-toggle]', panel);
    replay(btn, 'stamp');
    btn.focus({ preventScroll: true });
  }

  function downloadIcs(id) {
    const e = EV.get(id);
    const ymd = s => s.replaceAll('-', '');
    const endExclusive = new Date(`${e.end || e.date}T00:00:00`);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const pad = n => String(n).padStart(2, '0');
    const endStr = `${endExclusive.getFullYear()}${pad(endExclusive.getMonth() + 1)}${pad(endExclusive.getDate())}`;
    const icsText = s => String(s).replace(/[\\,;]/g, m => `\\${m}`);
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//techxdir//ES',
      'BEGIN:VEVENT',
      `UID:${e.id}@techxdir`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${endStr}`,
      `SUMMARY:${icsText(e.name)}`,
      `LOCATION:${icsText(e.city)}`,
      ...(e.url ? [`URL:${e.url}`] : []),
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = `${e.id}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let toggling = false;
  function toggleEvent(id, btn) {
    if (toggling) return;
    toggling = true;
    const e = EV.get(id);
    const had = state.myEvents.includes(id);
    state.myEvents = had ? state.myEvents.filter(x => x !== id) : [...state.myEvents, id];
    save();

    btn.classList.toggle('is-on', !had);
    btn.textContent = had ? (isPast(e) ? 'Fui' : 'Voy') : (isPast(e) ? 'Fui ✓' : 'Voy ✓');
    replay(btn, 'stamp');
    renderFront(); // la acreditación se actualiza a la vez
    notify(had ? `${e.name} quitado` : `${e.name} añadido a tu acreditación`);

    // dentro de la ficha de una organización el evento se queda; solo se refresca la ficha
    const view = evTrail[evTrail.length - 1];
    if (view && view.type === 'org') {
      setTimeout(() => {
        showOrg(view.id, 'refresh');
        $(`[data-toggle="${id}"]`, panel)?.focus({ preventScroll: true });
        toggling = false;
      }, 380);
      return;
    }

    setTimeout(() => btn.closest('.ev')?.classList.add(had ? 'out-right' : 'out-left'), 220);
    setTimeout(() => {
      renderEvList('quiet');
      toggling = false;
    }, 640);
  }

  /* Personas */

  let peopleQuery = '';
  let peopleTab = 'match'; // 'match' = con las que coincidiste · 'others' = el resto

  // personas con las que no has coincidido en ningún evento
  function others() {
    const matched = new Set(contacts().map(p => p.id));
    return PEOPLE
      .filter(p => !matched.has(p.id))
      .map(p => ({ ...p, shared: [] }))
      .sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name, 'es'));
  }

  function renderPeople(body, mode = 'initial') {
    const matchCount = contacts().length;
    body.innerHTML = `
      <div class="seg" role="tablist" aria-label="Filtrar personas">
        <button class="seg-btn" type="button" role="tab" data-ptab="match" aria-selected="${peopleTab === 'match'}">Coincidencias<b>${matchCount}</b></button>
        <span class="seg-sep" aria-hidden="true"></span>
        <button class="seg-btn" type="button" role="tab" data-ptab="others" aria-selected="${peopleTab === 'others'}">Otros<b>${PEOPLE.length - matchCount}</b></button>
      </div>
      <input class="search" id="pSearch" type="search" placeholder="Buscar por nombre, @usuario o evento" aria-label="Buscar personas" autocomplete="off">
      <ul class="stagger" id="pList" role="tabpanel"></ul>`;
    const search = $('#pSearch', panel);
    if (mode === 'initial') peopleQuery = '';
    search.value = peopleQuery;
    renderPeopleList(peopleQuery, mode);
    search.addEventListener('input', ev => {
      peopleQuery = ev.target.value;
      renderPeopleList(peopleQuery, 'quiet');
    });
  }

  function setPeopleTab(tab) {
    if (tab === peopleTab) return;
    peopleTab = tab;
    panel.querySelectorAll('[data-ptab]').forEach(b => b.setAttribute('aria-selected', b.dataset.ptab === tab));
    $('#panelBody', panel).scrollTop = 0;
    renderPeopleList(peopleQuery, 'tab');
  }

  // Perfil de una persona: sus datos y los eventos a los que ha ido o irá
  function showPerson(id) {
    const p = PEOPLE.find(x => x.id === id);
    if (!p) return;
    const body = $('#panelBody', panel);
    const mine = new Set(state.myEvents);
    const evs = p.events.map(eid => EV.get(eid)).filter(Boolean);
    const upcoming = evs.filter(e => !isPast(e)).sort(byDateAsc);
    const past = evs.filter(isPast).sort(byDateDesc);
    const shared = evs.filter(e => mine.has(e.id)).length;

    const row = (e, i) => {
      const d = fmtDate(e);
      return `
        <article class="ev" style="--i:${i}">
          <div class="ev-date">${d.day} ${d.mon}<small>${d.year}</small></div>
          <div class="ev-info">
            <strong>${esc(e.name)}</strong>
            <span>${esc(e.city)} · ${esc(e.kind)}</span>
          </div>
          ${mine.has(e.id) ? '<span class="tag">En común</span>' : '<span></span>'}
        </article>`;
    };

    let i = 3;
    let events = '';
    for (const [title, list] of [['Próximos', upcoming], ['Ha ido a', past]]) {
      if (!list.length) continue;
      events += `<h3 class="group-title" style="--i:${i++}">${title}</h3>`;
      events += list.map(e => row(e, i++)).join('');
    }

    body.style.setProperty('--base', '0ms');
    body.innerHTML = `
      <div class="stagger person-view" data-id="${p.id}">
        <button class="link back-link" type="button" data-people-back style="--i:0">← Todas las personas</button>
        <div class="pv-head" style="--i:1">
          ${avatar(p)}
          <div>
            <strong>${esc(p.name)}</strong>
            <span class="p-handle">@${esc(p.handle)}</span>
            <span>${esc(p.role)}</span>
          </div>
        </div>
        ${p.bio ? `<p class="pv-bio" style="--i:2">${esc(p.bio)}</p>` : ''}
        <div class="pv-stats" style="--i:2">
          <div><strong>${evs.length}</strong><span>${evs.length === 1 ? 'evento' : 'eventos'}</span></div>
          <div><strong>${shared}</strong><span>en común contigo</span></div>
        </div>
        ${events}
      </div>`;
    body.scrollTop = 0;
    replay(body, 'slide-in');
    $('[data-people-back]', body).focus({ preventScroll: true });
  }

  function backToPeople(fromId) {
    const body = $('#panelBody', panel);
    renderPeople(body, 'quiet');
    replay(body, 'slide-back');
    $(`[data-person="${fromId}"]`, body)?.focus({ preventScroll: true });
  }

  function renderPeopleList(query, mode) {
    const list = $('#pList', panel);
    if (mode === 'tab') list.style.setProperty('--base', '0ms');
    list.classList.toggle('quiet', mode === 'quiet');

    const isMatch = peopleTab === 'match';
    const people = isMatch ? contacts() : others();
    const q = query.trim().toLowerCase().replace(/^@/, '');
    const shown = q
      ? people.filter(p => [p.name, p.handle, p.role, ...p.events.map(id => EV.get(id)?.name || '')].some(s => s.toLowerCase().includes(q)))
      : people;
    const count = p => (isMatch
      ? `${p.shared.length} en común`
      : plural(p.events.length, 'evento', 'eventos'));
    const empty = people.length
      ? 'Nadie coincide con esa búsqueda.'
      : (isMatch ? 'Marca eventos para descubrir con quién coincidiste.' : 'Has coincidido con todo el mundo.');

    list.innerHTML = shown.map((p, i) => `
      <li class="person" style="--i:${i}">
        <button class="person-row" type="button" data-person="${p.id}" aria-label="Ver perfil de ${esc(p.name)}">
          ${avatar(p)}
          <span class="p-info">
            <strong>${esc(p.name)}</strong>
            <span><span class="p-handle">@${esc(p.handle)}</span> · ${esc(p.role)}</span>
          </span>
          <span class="p-count">${count(p)}</span>
          <span class="p-chev" aria-hidden="true">→</span>
        </button>
      </li>`).join('') || `<li class="empty">${empty}</li>`;
  }

  /* Bio */

  function renderBio(body) {
    const { me } = state;
    pendingPhoto = undefined;
    body.innerHTML = `
      <form class="stagger" id="bioForm" novalidate>
        <div class="photo-row" style="--i:0">
          <label class="photo-pick" title="Cambiar foto">
            <input class="sr-only" type="file" accept="image/*" id="photoInput">
            <span class="photo-preview" id="photoPreview">${photoMarkup(me.photo, me.name)}</span>
          </label>
          <div class="photo-actions">
            <label class="link" for="photoInput">Cambiar foto</label>
            <button class="link" type="button" id="photoRemove"${me.photo ? '' : ' hidden'}>Quitar foto</button>
            <small>Se recorta en vertical (4:5)</small>
          </div>
        </div>

        <label class="field" style="--i:1"><span>Nombre</span>
          <input name="name" value="${esc(me.name)}" maxlength="40" required autocomplete="name">
        </label>

        <label class="field" style="--i:2"><span>Usuario de X</span>
          <span class="prefixed"><input name="handle" value="${esc(me.handle)}" maxlength="15" required spellcheck="false" autocomplete="off"></span>
        </label>

        <div class="two-col" style="--i:3">
          <label class="field"><span>Rol</span><input name="role" value="${esc(me.role)}" maxlength="40"></label>
          <label class="field"><span>Empresa</span><input name="company" value="${esc(me.company)}" maxlength="30"></label>
        </div>

        <label class="field" style="--i:4"><span>Bio <em id="bioCount"></em></span>
          <textarea name="bio" maxlength="160" rows="3">${esc(me.bio)}</textarea>
        </label>

        <div class="actions" style="--i:5">
          <button class="link" type="button" data-close>Cancelar</button>
          <button class="primary" type="submit">Guardar</button>
        </div>
      </form>`;

    const form = $('#bioForm', panel);
    const preview = $('#photoPreview', panel);
    const removeBtn = $('#photoRemove', panel);
    const counter = $('#bioCount', panel);

    const currentPhoto = () => (pendingPhoto === undefined ? state.me.photo : pendingPhoto);
    const draft = () => {
      const data = Object.fromEntries(new FormData(form));
      return {
        name: data.name.trim(),
        handle: data.handle.trim(),
        role: data.role.trim(),
        company: data.company.trim(),
        bio: data.bio.trim(),
        photo: currentPhoto(),
        joined: joinedYear(state.me)
      };
    };
    // vista previa en vivo sobre la propia acreditación
    const live = () => {
      renderFront(draft());
      preview.innerHTML = photoMarkup(currentPhoto(), form.elements.name.value || '?');
      removeBtn.hidden = !currentPhoto();
      counter.textContent = `${form.elements.bio.value.length}/160`;
    };
    counter.textContent = `${form.elements.bio.value.length}/160`;

    form.elements.handle.addEventListener('input', ev => {
      ev.target.value = ev.target.value.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
    });
    form.addEventListener('input', ev => {
      if (ev.target.type !== 'file') live();
    });

    $('#photoInput', panel).addEventListener('change', async ev => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        pendingPhoto = await cropPhoto(file);
        live();
        replay(preview, 'stamp');
      } catch {
        notify('No se ha podido leer esa imagen');
      }
      ev.target.value = '';
    });

    removeBtn.addEventListener('click', () => {
      pendingPhoto = null;
      live();
    });

    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const me = draft();
      let invalid = false;
      for (const key of ['name', 'handle']) {
        const bad = !me[key];
        form.elements[key].closest('.field').classList.toggle('invalid', bad);
        if (bad) invalid = true;
      }
      if (invalid) return;

      state.me = me;
      pendingPhoto = undefined;
      notify(save() ? 'Acreditación actualizada' : 'Actualizada (no se pudo guardar en este navegador)');
      close();
    });
  }

  function cropPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const W = 400;
        const H = 500;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        let sx = 0;
        let sy = 0;
        if (sw / sh > W / H) { const nw = sh * W / H; sx = (sw - nw) / 2; sw = nw; }
        else { const nh = sw * H / W; sy = (sh - nh) / 2; sh = nh; }
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', .85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('imagen no válida'));
      };
      img.src = url;
    });
  }

  /* ───────── Compartir en redes ───────── */

  // el botón vive en el pie de la acreditación, que se vuelve a pintar: se busca en cada uso
  const shareBtn = () => $('#shareBtn', front);
  const shareMenu = $('#shareMenu');
  const sharePreview = $('#sharePreview');
  const SHARE_URL = `${location.origin}${location.pathname}`;
  let shareBlob = null;
  let previewUrl = null;

  function shareText() {
    const { past, upcoming } = myEventsSplit();
    const n = contacts().length;
    let text = `Mi acreditación en techxdir: ${plural(past.length, 'evento tech', 'eventos tech')} y ${plural(n, 'persona', 'personas')} con las que he coincidido.`;
    if (upcoming[0]) text += ` Próximo: ${upcoming[0].name}. ¿Coincidimos?`;
    return text;
  }

  const shareFileName = () => `techxdir-${state.me.handle || 'acreditacion'}.png`;

  async function openShare() {
    shareMenu.hidden = false;
    shareBtn()?.setAttribute('aria-expanded', 'true');
    placeShareMenu();
    $('[data-share="native"]', shareMenu).hidden = !navigator.share;
    shareMenu.querySelector('[data-share]:not([hidden])').focus({ preventScroll: true });

    // la imagen se regenera cada vez para reflejar los últimos cambios
    shareBlob = null;
    sharePreview.removeAttribute('src');
    try {
      shareBlob = await renderCardImage();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(shareBlob);
      sharePreview.src = previewUrl;
    } catch { /* sin vista previa: el resto de opciones sigue funcionando */ }
  }

  // el menú se abre hacia arriba, alineado a la izquierda del botón
  function placeShareMenu() {
    const btn = shareBtn();
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const w = shareMenu.offsetWidth;
    const left = Math.min(Math.max(12, r.left), innerWidth - w - 12);
    const top = Math.max(12, r.top - shareMenu.offsetHeight - 10);
    shareMenu.style.left = `${left}px`;
    shareMenu.style.top = `${top}px`;
  }

  function closeShare(focusBtn) {
    if (shareMenu.hidden) return;
    shareMenu.hidden = true;
    shareBtn()?.setAttribute('aria-expanded', 'false');
    if (focusBtn) shareBtn()?.focus({ preventScroll: true });
  }

  async function doShare(kind) {
    const text = shareText();
    const enc = encodeURIComponent;
    const popup = url => window.open(url, '_blank', 'noopener,noreferrer,width=620,height=680');

    switch (kind) {
      case 'x':
        popup(`https://x.com/intent/post?text=${enc(text)}&url=${enc(SHARE_URL)}`);
        break;
      case 'linkedin':
        popup(`https://www.linkedin.com/sharing/share-offsite/?url=${enc(SHARE_URL)}`);
        break;
      case 'whatsapp':
        popup(`https://wa.me/?text=${enc(`${text} ${SHARE_URL}`)}`);
        break;
      case 'copy':
        try {
          await navigator.clipboard.writeText(`${text} ${SHARE_URL}`);
          notify('Texto y enlace copiados');
        } catch {
          notify('No se ha podido copiar');
        }
        break;
      case 'image': {
        const blob = shareBlob || await renderCardImage();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = shareFileName();
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        notify('Imagen descargada');
        break;
      }
      case 'native': {
        const data = { title: 'Mi acreditación · techxdir', text, url: SHARE_URL };
        if (shareBlob) {
          const file = new File([shareBlob], shareFileName(), { type: 'image/png' });
          if (navigator.canShare?.({ files: [file] })) data.files = [file];
        }
        try {
          await navigator.share(data);
        } catch (err) {
          if (err.name !== 'AbortError') notify('No se ha podido compartir');
        }
        break;
      }
    }
  }

  // Dibuja la acreditación en un PNG 1080×1350 (formato 4:5, el que mejor encaja en redes)
  async function renderCardImage() {
    await document.fonts.ready;
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');

    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const BG = v('--bg', '#ebeae6');
    const CARD = v('--card', '#fbfbf9');
    const INK = v('--ink', '#111113');
    const MUTED = v('--muted', '#8b8a90');
    const LINE = v('--line', 'rgba(17,17,19,.1)');
    const SANS = '"Space Grotesk", system-ui, sans-serif';
    const MONO = '"JetBrains Mono", ui-monospace, monospace';

    const rr = (x, y, w, h, r) => {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    };
    const text = (str, x, y, font, color, align = 'left', spacing = 0) => {
      g.font = font;
      g.fillStyle = color;
      g.textAlign = align;
      g.textBaseline = 'alphabetic';
      if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
      g.fillText(str, x, y);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
    };
    const fit = (str, font, maxW) => {
      g.font = font;
      if (g.measureText(str).width <= maxW) return str;
      while (str.length > 1 && g.measureText(`${str}…`).width > maxW) str = str.slice(0, -1);
      return `${str.trimEnd()}…`;
    };
    const hr = y => {
      g.fillStyle = LINE;
      g.fillRect(P, y, cw - 2 * P, 1.5);
    };

    const me = state.me;
    const { past, upcoming } = myEventsSplit();
    const people = contacts();
    const orgs = myOrgs();

    // fondo y tarjeta
    g.fillStyle = BG;
    g.fillRect(0, 0, W, H);
    const cw = 740;
    const ch = 1110;
    const cx = (W - cw) / 2;
    const cy = (H - ch) / 2;
    const P = 40;

    g.save();
    g.shadowColor = 'rgba(0, 0, 0, .16)';
    g.shadowBlur = 70;
    g.shadowOffsetY = 34;
    g.fillStyle = CARD;
    rr(cx, cy, cw, ch, 34);
    g.fill();
    g.restore();
    g.strokeStyle = LINE;
    g.lineWidth = 1.5;
    rr(cx, cy, cw, ch, 34);
    g.stroke();

    g.save();
    g.translate(cx, cy);

    // agujero de la cinta
    g.fillStyle = BG;
    rr(cw / 2 - 38, 22, 76, 12, 6);
    g.fill();

    // cabecera
    text('techx', P, 76, `600 30px ${SANS}`, INK);
    const tw = g.measureText('techx').width;
    text('dir', P + tw, 76, `600 30px ${SANS}`, MUTED);
    text('ATTENDEE', cw - P, 74, `500 17px ${MONO}`, MUTED, 'right', 2.5);

    // foto
    const px = P;
    const py = 112;
    const pw = (cw - 2 * P - 14) / 2;
    const ph = pw * 1.25;
    g.save();
    rr(px, py, pw, ph, 24);
    g.clip();
    g.fillStyle = '#e3e2dd';
    g.fillRect(px, py, pw, ph);
    let drewPhoto = false;
    if (me.photo && me.photo.startsWith('data:')) {
      try {
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = me.photo;
        });
        const s = Math.max(pw / img.naturalWidth, ph / img.naturalHeight);
        const iw = img.naturalWidth * s;
        const ih = img.naturalHeight * s;
        g.drawImage(img, px + (pw - iw) / 2, py + (ph - ih) / 2, iw, ih);
        drewPhoto = true;
      } catch { /* sin foto: iniciales */ }
    }
    if (!drewPhoto) {
      g.textBaseline = 'middle';
      g.font = `300 104px ${SANS}`;
      g.fillStyle = INK;
      g.textAlign = 'center';
      g.fillText(initials(me.name), px + pw / 2, py + ph / 2 + 4);
    }
    g.restore();

    // eventos
    const ex = px + pw + 14 + 24;
    const colW = cw - P - ex;
    text('EVENTOS', ex, 152, `500 17px ${MONO}`, MUTED, 'left', 2.5);
    text(String(past.length), ex - 6, 408, `300 172px ${SANS}`, INK, 'left', -8);
    const next = upcoming[0] || past[0];
    if (next) {
      const d = fmtDate(next);
      text(upcoming[0] ? 'Próximo' : 'Último', ex, 458, `400 22px ${SANS}`, MUTED);
      const line = upcoming[0] ? `${next.short} · ${d.day} ${d.mon}` : `${next.short} · ${d.mon} ${d.year}`;
      text(fit(line, `500 24px ${SANS}`, colW), ex, 490, `500 24px ${SANS}`, INK);
    }

    // identidad
    hr(560);
    let size = 64;
    const name = me.name || 'Tu nombre';
    g.font = `500 ${size}px ${SANS}`;
    while (size > 36 && g.measureText(name).width > cw - 2 * P) {
      size -= 2;
      g.font = `500 ${size}px ${SANS}`;
    }
    text(fit(name, `500 ${size}px ${SANS}`, cw - 2 * P), P, 640, `500 ${size}px ${SANS}`, INK, 'left', -1.5);
    const role = [me.role, me.company].filter(Boolean).join(' · ');
    if (role) text(fit(role, `400 25px ${SANS}`, cw - 2 * P), P, 684, `400 25px ${SANS}`, MUTED);
    text(`@${me.handle}`, P, 722, `400 23px ${MONO}`, INK);

    // organizaciones
    hr(762);
    text(`${plural(orgs.length, 'ORGANIZACIÓN', 'ORGANIZACIONES')}`, P, 814, `500 17px ${MONO}`, MUTED, 'left', 2.5);
    const LOGO = 46;
    const shownOrgs = orgs.slice(0, 6);
    shownOrgs.forEach((o, i) => {
      const x = cw - P - (shownOrgs.length - i) * (LOGO + 10) + 10;
      drawOrg(o, x, 808 - LOGO / 2, LOGO);
    });

    // coincidencias
    hr(854);
    text('COINCIDENCIAS', P, 904, `500 17px ${MONO}`, MUTED, 'left', 2.5);
    text(String(people.length), P - 4, 1016, `300 132px ${SANS}`, INK, 'left', -6);
    g.font = `300 132px ${SANS}`;
    if ('letterSpacing' in g) g.letterSpacing = '-6px';
    const nw = g.measureText(String(people.length)).width;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    text(people.length === 1 ? 'persona' : 'personas', P + nw + 10, 1016, `400 28px ${SANS}`, MUTED);

    const AV = 62;
    const avs = people.slice(0, 4).map(p => ({ label: initials(p.name), fill: `hsl(40 6% ${70 + (hash(p.name) % 20)}%)`, color: INK }));
    if (people.length > 4) avs.push({ label: `+${people.length - 4}`, fill: INK, color: CARD });
    avs.forEach((a, i) => {
      const x = cw - P - AV / 2 - (avs.length - 1 - i) * (AV - 14);
      const y = 992;
      g.beginPath();
      g.arc(x, y, AV / 2, 0, Math.PI * 2);
      g.fillStyle = a.fill;
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = CARD;
      g.stroke();
      g.font = `500 21px ${SANS}`;
      g.fillStyle = a.color;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(a.label, x, y + 1);
    });

    // pie
    hr(1046);
    text(`TXD-${String(hash(me.handle) % 10000).padStart(4, '0')}`, P, 1082, `500 17px ${MONO}`, MUTED, 'left', 2.5);
    text(`DESDE ${joinedYear(me)}`, cw - P, 1082, `500 17px ${MONO}`, MUTED, 'right', 2.5);

    g.restore();
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('sin imagen'))), 'image/png'));

    // monograma de la organización (las imágenes externas no se dibujan para no bloquear el canvas)
    function drawOrg(o, x, y, s) {
      const logo = o.logo && typeof o.logo === 'object' ? o.logo : {};
      const mark = logo.mark || initials(o.name);
      const shape = logo.shape || 'circle';
      g.save();
      g.translate(x, y);
      g.scale(s / 40, s / 40);
      g.beginPath();
      if (shape === 'square' || shape === 'squircle') rr(1, 1, 38, 38, shape === 'square' ? 7 : 14);
      else if (shape === 'hex') {
        [[20, 1], [37, 10.5], [37, 29.5], [20, 39], [3, 29.5], [3, 10.5]].forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
        g.closePath();
      } else if (shape === 'diamond') {
        g.translate(20, 20);
        g.rotate(Math.PI / 4);
        rr(-13, -13, 26, 26, 5);
        g.rotate(-Math.PI / 4);
        g.translate(-20, -20);
      } else g.arc(20, 20, shape === 'ring' ? 17.5 : 19, 0, Math.PI * 2);

      if (shape === 'ring') {
        g.lineWidth = 3;
        g.strokeStyle = INK;
        g.stroke();
      } else {
        g.fillStyle = INK;
        g.fill();
      }
      const fs = [...mark].length > 1 ? (shape === 'diamond' ? 11 : 14) : 18;
      g.font = `600 ${fs}px ${SANS}`;
      g.fillStyle = shape === 'ring' ? INK : CARD;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(mark, 20, 21);
      g.restore();
    }
  }

  front.addEventListener('click', ev => {
    if (ev.target.closest('#shareBtn')) shareMenu.hidden ? openShare() : closeShare(true);
  });
  sharePreview.addEventListener('load', placeShareMenu);
  addEventListener('resize', () => { if (!shareMenu.hidden) placeShareMenu(); });
  shareMenu.addEventListener('click', ev => {
    const item = ev.target.closest('[data-share]');
    if (!item) return;
    doShare(item.dataset.share);
    closeShare(true);
  });

  // fuera del menú, el primer clic solo lo cierra; Esc también, y las flechas recorren las opciones
  document.addEventListener('click', ev => {
    if (shareMenu.hidden || ev.target.closest('.share')) return;
    closeShare(false);
    ev.stopPropagation();
    ev.preventDefault();
  }, true);

  document.addEventListener('keydown', ev => {
    if (shareMenu.hidden) return;
    if (ev.key === 'Escape') {
      closeShare(true);
      ev.stopPropagation();
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const items = [...shareMenu.querySelectorAll('[data-share]:not([hidden])')];
      const i = items.indexOf(document.activeElement);
      const next = items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      next.focus();
      ev.preventDefault();
    }
  }, true);

  /* ───────── Eventos de interfaz ───────── */

  document.addEventListener('click', ev => {
    const zone = ev.target.closest('[data-open]');
    if (zone && front.contains(zone)) return open(zone.dataset.open, zone, ev);

    if (ev.target.closest('[data-close]')) return close();

    // clic en un espacio en blanco (fuera de la acreditación y del panel): volver al menú
    if (current && ev.target.isConnected && !ev.target.closest('.mover, .panel, .toast, .credits, .share')) return close();

    const tab = ev.target.closest('[data-tab]');
    if (tab && tab.dataset.tab !== evTab) {
      evTab = tab.dataset.tab;
      tab.parentElement.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', t === tab));
      $('#panelBody', panel).scrollTop = 0;
      return renderEvList('tab');
    }

    const toggle = ev.target.closest('[data-toggle]');
    if (toggle) return toggleEvent(toggle.dataset.toggle, toggle);

    const eventBtn = ev.target.closest('[data-event]');
    if (eventBtn) return pushView({ type: 'event', id: eventBtn.dataset.event });

    const orgBtn = ev.target.closest('[data-org]');
    if (orgBtn) return pushView({ type: 'org', id: orgBtn.dataset.org });

    if (ev.target.closest('[data-view-back]')) return goBack();

    const evView = $('.event-view', panel);
    if (evView) {
      if (ev.target.closest('[data-ev-toggle]')) return toggleFromDetail(evView.dataset.id);
      if (ev.target.closest('[data-ev-ics]')) return downloadIcs(evView.dataset.id);
    }

    const ptab = ev.target.closest('[data-ptab]');
    if (ptab) return setPeopleTab(ptab.dataset.ptab);

    const person = ev.target.closest('[data-person]');
    if (person) return showPerson(person.dataset.person);

    if (ev.target.closest('[data-people-back]')) {
      return backToPeople($('.person-view', panel)?.dataset.id);
    }
  });

  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || !current) return;
    // desde una ficha de evento u organización, Esc vuelve un paso atrás
    if (current === 'events' && evTrail.length && $('.event-view, .org-view', panel)) return goBack();
    close();
  });

  renderFront();
})();
