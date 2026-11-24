'use strict';
// Mapas D&D 5e: editor e visualizador. Fala só com mapas/server.js, que confere a conta no app de fichas.

const CELL = 56; // tamanho de um quadrado em unidades do mapa
const METROS = 1.5; // cada quadrado vale 1,5 m
const ZMIN = 0.12, ZMAX = 4;
const TAU = Math.PI * 2;
const TER = { '.': ['Vazio', null], c: ['Pedra', '#8b857c'], m: ['Madeira', '#9a6b3d'], g: ['Grama', '#5c8a3c'], t: ['Terra', '#a3845a'], a: ['Água', '#3a74a6'], p: ['Parede', '#2d292c'], l: ['Lava', '#c64a1e'], o: ['Porta', '#6b4220'], r: ['Rocha', '#625c55'] };
const TIPOS = { pj: 'Personagem', aliado: 'Aliado', inimigo: 'Inimigo', objeto: 'Objeto' };
const TAM = { 1: 'Médio (1×1)', 2: 'Grande (2×2)', 3: 'Enorme (3×3)', 4: 'Imenso (4×4)' };
const SAUDE = { ileso: 1, ferido: 0.7, 'muito ferido': 0.35, 'caído': 0 };

const $ = (id) => document.getElementById(id);
// dentro da aba de mapas do app de fichas: os links para as fichas trocam a página de cima, sem abrir outra aba
const EMBUTIDO = window.top !== window;
if (EMBUTIDO) document.documentElement.classList.add('embutido');
const alvoFichas = EMBUTIDO ? '_top' : 'fichas';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem('mapas.' + k); localStorage.setItem('mapas.' + k, v); } catch { return null; } };

const S = { me: null, mesas: [], fichas: new Map(), mapas: [], app: null, mapa: null, img: null, imgV: null, tool: 'mover', ter: 'c', pincel: 1, sel: null, painel: null, online: true, undo: [], ruler: null, hover: null, falta: null, vistos: 0, pend: 0, arm: null };
const V = { z: 1, ox: 0, oy: 0, fit: null, auto: false }; // auto: a câmera ainda está no enquadramento automático

// ---------- servidor ----------
async function api(method, url, body, raw) {
  const headers = raw ? { 'Content-Type': body.type || 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {};
  const r = await fetch(url, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Erro ' + r.status), { status: r.status });
  return j;
}
async function loadState() {
  const st = await api('GET', '/api/state');
  S.me = st.me; S.mesas = st.mesas; S.mapas = st.mapas; S.app = st.fichaApp;
  S.fichas = new Map(st.fichas.map((f) => [f.id, f]));
  S.falta = null;
  const t = st.me.tema;
  if (t === 'claro' || t === 'escuro') document.documentElement.dataset.theme = t === 'claro' ? 'light' : 'dark';
  else delete document.documentElement.dataset.theme;
}
function fichaBase() {
  if (!S.app) return `${location.protocol}//${location.hostname}:3000`;
  return S.app.url ? S.app.url.replace(/\/+$/, '') : `${location.protocol}//${location.hostname}:${S.app.porta}`;
}
const mesaDe = (id) => S.mesas.find((m) => m.id === id);
const mestre = () => !!S.mapa && !!(mesaDe(S.mapa.mesa) || {}).souMestre;
const tokenDe = (id) => S.mapa && S.mapa.tokens.find((t) => t.id === id);
const podeMover = (t) => mestre() || (!!t.ficha && !!(S.fichas.get(t.ficha) || {}).minha);
function erro(e) { if (e.status === 401) return semConta(); toast(`<b>${esc(e.message)}</b>`); }

async function abrir(id, quiet) {
  try {
    const mp = await api('GET', '/api/mapas/' + id);
    setMapa(mp);
    // vindo do app de fichas: escolhe e centraliza o personagem
    if (S.focoTok) { const t = tokenDe(S.focoTok); S.focoTok = null; if (t) foca(t); }
    store('mapa', id);
    if (location.hash !== '#mapa/' + id) history.replaceState(null, '', '#mapa/' + id);
  } catch (e) {
    if (e.status === 404) { S.mapa = null; if (!quiet) toast('<b>Esse mapa não está disponível.</b>'); ui(); return; }
    erro(e);
  }
}
function setMapa(mp) {
  const novo = !S.mapa || S.mapa.id !== mp.id;
  if (!novo && (S.pend || (G && G.kind === 'paint'))) mp._arr = S.mapa._arr; // não desfaz a pintura em andamento
  else mp._arr = [...mp.tiles];
  S.mapa = mp;
  if (novo) { S.sel = null; S.undo = []; S.ruler = null; if (S.painel === 'token' || (S.painel === 'mapa' && !mestre())) S.painel = null; }
  if (S.sel && !tokenDe(S.sel)) { S.sel = null; if (S.painel === 'token') S.painel = null; }
  if (!mestre() && ['pintar', 'preencher'].includes(S.tool)) setTool('mover');
  const v = mp.fundo && mp.fundo.v;
  if (v !== S.imgV) {
    S.imgV = v; S.img = null;
    if (v) { const img = new Image(); img.onload = () => { if (S.imgV === v) { S.img = img; draw(); } }; img.src = `/api/mapas/${mp.id}/fundo?v=${v}`; }
  }
  if (V.fit !== mp.id) fit();
  ui(); draw();
}
function escolher() {
  const h = decodeURIComponent(location.hash.slice(1));
  const m = /^mapa\/([\w-]+)(?:\/token\/([\w-]+))?$/.exec(h);
  if (m && S.mapas.some((x) => x.id === m[1])) { S.focoTok = m[2] || null; return m[1]; }
  const mesa = (/^mesa\/(.+)$/.exec(h) || [])[1];
  if (mesa) S.foco = mesa;
  const last = store('mapa');
  if (!mesa && last && S.mapas.some((x) => x.id === last)) return last;
  const list = S.mapas.filter((x) => !mesa || x.mesa === mesa);
  const vis = list.filter((x) => x.visivel).sort((a, b) => b.mostrado - a.mostrado);
  return (vis[0] || list[0] || {}).id || null;
}

// ---------- ao vivo ----------
let es1, es2, soonT, soonMapa = false;
function listen() {
  if (!window.EventSource) return setInterval(() => soon(true), 8000);
  es1 = new EventSource('/api/events');
  es1.onmessage = (e) => { let m = {}; try { m = JSON.parse(e.data); } catch { /* ping */ } soon(!!S.mapa && m.mapa === S.mapa.id); };
  es1.onopen = () => setConn(true);
  es1.onerror = () => setConn(false);
  es2 = new EventSource('/api/fichas/events');
  es2.onmessage = (e) => { if (e.data !== 'wiki') soon(false); }; // mudanças na wiki não mexem no mapa
}
function soon(mapa) {
  soonMapa = soonMapa || mapa;
  clearTimeout(soonT);
  soonT = setTimeout(refresh, 200);
}
async function refresh() {
  const mapa = soonMapa; soonMapa = false;
  try {
    await loadState();
    setConn(true);
    // jogadores seguem o mapa que o mestre acabou de mostrar
    const atual = S.mapa && S.mapas.find((x) => x.id === S.mapa.id);
    const novo = S.mapas.filter((x) => x.visivel && !(mesaDe(x.mesa) || {}).souMestre).sort((a, b) => b.mostrado - a.mostrado)[0];
    if (novo && novo.mostrado > S.vistos) {
      S.vistos = novo.mostrado;
      if (!S.mapa || novo.id !== S.mapa.id) { toast(`<b>O mestre mostrou o mapa ${esc(novo.nome)}</b>`); return abrir(novo.id, true); }
    }
    if (S.mapa && !atual) { toast('<b>Este mapa saiu da mesa.</b>'); S.mapa = null; const id = escolher(); return id ? abrir(id, true) : ui(); }
    if (S.mapa && mapa) return abrir(S.mapa.id, true);
    if (!S.mapa) { const id = escolher(); if (id) return abrir(id, true); }
    ui(); draw();
  } catch (e) { if (e.status === 401) semConta(); else setConn(false); }
}
function setConn(ok) { S.online = ok; $('conn').hidden = ok; }

// ---------- texturas ----------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => clamp(Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k), 0, 255);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
const TEX = {};
function textura(ch) {
  if (TEX[ch]) return TEX[ch];
  const N = CELL * 2, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), r = rng(ch.charCodeAt(0) * 977), base = TER[ch][1];
  g.fillStyle = base; g.fillRect(0, 0, N, N);
  const speck = (n, a, b, s) => { for (let i = 0; i < n; i++) { g.fillStyle = shade(base, a + r() * (b - a)); g.fillRect(r() * N, r() * N, s, s); } };
  if (ch === 'c') { // lajes
    const q = CELL / 2;
    for (let y = 0; y < N; y += q) for (let x = 0; x < N; x += q) { g.fillStyle = shade(base, (r() - 0.5) * 0.18); g.fillRect(x + 1.5, y + 1.5, q - 3, q - 3); }
    speck(160, -0.25, 0.15, 1.5);
  } else if (ch === 'm') { // tábuas
    const h = CELL / 4;
    for (let y = 0; y < N; y += h) {
      g.fillStyle = shade(base, (r() - 0.5) * 0.2); g.fillRect(0, y + 1, N, h - 2);
      const cut = r() * N; g.fillStyle = shade(base, -0.45); g.fillRect(cut, y, 2, h);
      g.strokeStyle = shade(base, -0.2); g.lineWidth = 0.7;
      for (let k = 0; k < 2; k++) { const yy = y + 3 + r() * (h - 6); g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(N / 3, yy + r() * 2 - 1, (2 * N) / 3, yy + r() * 2 - 1, N, yy); g.stroke(); }
    }
  } else if (ch === 'g') { // grama
    for (let i = 0; i < 420; i++) { const x = r() * N, y = r() * N; g.strokeStyle = shade(base, (r() - 0.5) * 0.5); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + r() * 4 - 2, y - 3 - r() * 4); g.stroke(); }
  } else if (ch === 't') { speck(500, -0.25, 0.2, 2); speck(30, -0.35, -0.2, 4); }
  else if (ch === 'a') { // água
    const gr = g.createLinearGradient(0, 0, N, N); gr.addColorStop(0, shade(base, 0.08)); gr.addColorStop(1, shade(base, -0.12)); g.fillStyle = gr; g.fillRect(0, 0, N, N);
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1.4;
    for (let i = 0; i < 14; i++) { const x = r() * N, y = r() * N, w = 8 + r() * 10; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 3, x + w, y); g.stroke(); }
  } else if (ch === 'p') { // tijolos
    const bw = CELL / 2, bh = CELL / 4;
    g.fillStyle = shade(base, -0.4); g.fillRect(0, 0, N, N);
    for (let y = 0, row = 0; y < N; y += bh, row++) for (let x = -(row % 2) * bw / 2; x < N; x += bw) { g.fillStyle = shade(base, (r() - 0.3) * 0.35); g.fillRect(x + 1, y + 1, bw - 2, bh - 2); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x + 1, y + 1, bw - 2, 2); }
  } else if (ch === 'l') { // lava
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(60,15,5,${0.35 + r() * 0.4})`; g.beginPath(); g.ellipse(r() * N, r() * N, 4 + r() * 10, 3 + r() * 7, r() * 3, 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(255,220,90,.7)'; g.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) { let x = r() * N, y = r() * N; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += r() * 12 - 6; y += r() * 12 - 6; g.lineTo(x, y); } g.stroke(); }
  } else if (ch === 'r') { // rocha de caverna
    for (let i = 0; i < 26; i++) { const x = r() * N, y = r() * N, s = 6 + r() * 12; g.fillStyle = shade(base, (r() - 0.5) * 0.35); g.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + r() * 0.5, d = s * (0.6 + r() * 0.5); g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d); } g.fill(); }
    speck(120, -0.3, 0.1, 1.5);
  } else if (ch === 'o') { // porta: um desenho por quadrado
    c.width = c.height = CELL;
    g.fillStyle = shade(base, -0.35); g.fillRect(0, 0, CELL, CELL);
    for (let x = 6; x < CELL - 6; x += 11) { g.fillStyle = shade(base, (r() - 0.5) * 0.2); g.fillRect(x, 5, 10, CELL - 10); }
    g.fillStyle = '#3a3a3a'; g.fillRect(6, 13, CELL - 12, 4); g.fillRect(6, CELL - 17, CELL - 12, 4);
    g.fillStyle = '#d6a23a'; g.beginPath(); g.arc(CELL - 14, CELL / 2, 3, 0, TAU); g.fill();
  }
  TEX[ch] = c;
  return c;
}
const PAT = new WeakMap();
function padrao(ctx, ch) { const c = textura(ch); if (!PAT.has(c)) PAT.set(c, ctx.createPattern(c, 'repeat')); return PAT.get(c); }

// ---------- desenho ----------
const cv = $('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, raf = 0;
function resize() {
  const r = cv.getBoundingClientRect(); DPR = window.devicePixelRatio || 1; W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  if (S.mapa && (V.fit !== S.mapa.id || V.auto)) fit();
  draw();
}
new ResizeObserver(resize).observe($('stage'));
function draw() { if (!raf) raf = requestAnimationFrame(render); }
const toW = (p) => ({ x: (p.x - V.ox) / V.z, y: (p.y - V.oy) / V.z });
const cellOf = (w) => ({ x: Math.floor(w.x / CELL), y: Math.floor(w.y / CELL) });
const dentro = (c) => !!S.mapa && c.x >= 0 && c.y >= 0 && c.x < S.mapa.cols && c.y < S.mapa.rows;
function iniciais(nome) {
  const w = String(nome || '?').trim().split(/\s+/);
  const last = w[w.length - 1];
  if (w.length > 1 && /^\d+$/.test(last)) return (w[0][0] + last).toUpperCase().slice(0, 3);
  return w.slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
}
function vida(t) {
  const f = t.ficha && S.fichas.get(t.ficha);
  if (f && f.hp.max > 0) return clamp(f.hp.cur / f.hp.max, 0, 1);
  if (t.ficha && t.saude in SAUDE) return SAUDE[t.saude];
  return null;
}
const corVida = (v) => (v > 0.5 ? '#46a35a' : v > 0.25 ? '#d6a23a' : '#d23a3a');

function render() {
  raf = 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  const mp = S.mapa;
  if (!mp) return;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches ? document.documentElement.dataset.theme !== 'light' : document.documentElement.dataset.theme === 'dark';
  ctx.setTransform(DPR * V.z, 0, 0, DPR * V.z, DPR * V.ox, DPR * V.oy);
  const MW = mp.cols * CELL, MH = mp.rows * CELL, px = 1 / V.z;
  // base do mapa
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 30 * V.z * DPR; ctx.fillStyle = dark ? '#26232a' : '#ece5d7'; ctx.fillRect(0, 0, MW, MH); ctx.restore();
  if (S.img) ctx.drawImage(S.img, 0, 0, MW, MH);
  // só os quadrados na tela
  const x0 = clamp(Math.floor(-V.ox / V.z / CELL), 0, mp.cols), x1 = clamp(Math.ceil((W - V.ox) / V.z / CELL), 0, mp.cols);
  const y0 = clamp(Math.floor(-V.oy / V.z / CELL), 0, mp.rows), y1 = clamp(Math.ceil((H - V.oy) / V.z / CELL), 0, mp.rows);
  const arr = mp._arr, at = (x, y) => arr[y * mp.cols + x];
  for (const ch of 'cmgtaplr') {
    ctx.beginPath(); let any = false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (at(x, y) === ch) { ctx.rect(x * CELL, y * CELL, CELL, CELL); any = true; }
    if (any) { ctx.fillStyle = padrao(ctx, ch); ctx.fill(); }
  }
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (at(x, y) === 'o') ctx.drawImage(textura('o'), x * CELL, y * CELL, CELL, CELL);
  // sombra das paredes no chão vizinho
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  const sh = CELL * 0.14;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (at(x, y) === 'p') continue;
    if (y > 0 && at(x, y - 1) === 'p') ctx.fillRect(x * CELL, y * CELL, CELL, sh);
    if (x > 0 && at(x - 1, y) === 'p') ctx.fillRect(x * CELL, y * CELL, sh, CELL);
  }
  // grade
  if (mp.grade && CELL * V.z >= 9) {
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) { ctx.moveTo(x * CELL, y0 * CELL); ctx.lineTo(x * CELL, y1 * CELL); }
    for (let y = y0; y <= y1; y++) { ctx.moveTo(x0 * CELL, y * CELL); ctx.lineTo(x1 * CELL, y * CELL); }
    ctx.strokeStyle = dark && !S.img ? 'rgba(255,255,255,.12)' : 'rgba(25,18,18,.22)'; ctx.lineWidth = px; ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 2 * px; ctx.strokeRect(0, 0, MW, MH);
  // prévia do pincel
  if (S.hover && mestre() && ['pintar', 'preencher'].includes(S.tool) && dentro(S.hover)) {
    const n = S.tool === 'pintar' ? S.pincel : 1, o = n === 3 ? 1 : 0;
    ctx.strokeStyle = '#d6a23a'; ctx.lineWidth = 2 * px; ctx.strokeRect((S.hover.x - o) * CELL, (S.hover.y - o) * CELL, n * CELL, n * CELL);
  }
  // tokens: os grandes por baixo, o escolhido por cima
  const list = [...mp.tokens].sort((a, b) => (a.id === S.sel) - (b.id === S.sel) || b.tam - a.tam);
  for (const t of list) {
    if (G && G.kind === 'drag' && G.id === t.id && G.moved) {
      const n = alvo(t);
      ctx.fillStyle = 'rgba(214,162,58,.25)'; ctx.fillRect(n.x * CELL, n.y * CELL, t.tam * CELL, t.tam * CELL);
      desenhaToken(t, G.wx - G.gx, G.wy - G.gy, px, true);
    } else desenhaToken(t, t.x * CELL, t.y * CELL, px);
  }
  // régua
  if (S.ruler) {
    const { a, b } = S.ruler, ax = (a.x + 0.5) * CELL, ay = (a.y + 0.5) * CELL, bx = (b.x + 0.5) * CELL, by = (b.y + 0.5) * CELL;
    const q = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeStyle = '#d6a23a'; ctx.lineWidth = 4 * px; ctx.setLineDash([10 * px, 6 * px]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
    for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.fillStyle = '#d6a23a'; ctx.beginPath(); ctx.arc(x, y, 6 * px, 0, TAU); ctx.fill(); }
    pilula(`${String(q * METROS).replace('.', ',')} m · ${q} ${q === 1 ? 'quadrado' : 'quadrados'}`, bx, by - 24 * px, px, '#d6a23a', '#1d1716');
  }
}
function pilula(txt, x, y, px, bg, fg) {
  ctx.font = `600 ${13 * px}px Inter, system-ui, sans-serif`;
  const w = ctx.measureText(txt).width + 14 * px, h = 22 * px;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y + 0.5 * px);
}
function desenhaToken(t, x, y, px, erguido) {
  const s = t.tam * CELL, cx = x + s / 2, cy = y + s / 2, r = s / 2 - 6;
  const v = vida(t), f = t.ficha && S.fichas.get(t.ficha), sel = S.sel === t.id;
  ctx.save();
  if (t.oculto) ctx.globalAlpha = 0.55;
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = (erguido ? 18 : 8) * V.z * DPR; ctx.shadowOffsetY = (erguido ? 6 : 2) * V.z * DPR;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fillStyle = t.cor; ctx.fill();
  ctx.shadowColor = 'transparent';
  const gr = ctx.createRadialGradient(cx - r / 3, cy - r / 3, r / 5, cx, cy, r);
  gr.addColorStop(0, 'rgba(255,255,255,.28)'); gr.addColorStop(1, 'rgba(0,0,0,.18)');
  ctx.fillStyle = gr; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ini = iniciais(t.nome);
  ctx.font = `700 ${r * (ini.length > 2 ? 0.62 : 0.78)}px Cinzel, Georgia, serif`;
  ctx.fillText(ini, cx, cy + r * 0.06);
  if (v !== null) {
    ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, TAU); ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 4; ctx.stroke();
    if (v > 0) { ctx.beginPath(); ctx.arc(cx, cy, r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * v); ctx.strokeStyle = corVida(v); ctx.stroke(); }
    if (v === 0) { // caído
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fillStyle = 'rgba(20,10,10,.55)'; ctx.fill();
      ctx.strokeStyle = '#e8d9d9'; ctx.lineWidth = 3; const k = r * 0.45;
      ctx.beginPath(); ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k); ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k); ctx.stroke();
    }
  }
  if (f && f.cond.length) {
    const bx = cx + r * 0.72, by = cy - r * 0.72, br = Math.max(7, r * 0.26);
    ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fillStyle = '#d6a23a'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1d1716'; ctx.stroke();
    ctx.fillStyle = '#1d1716'; ctx.font = `700 ${br * 1.2}px Inter, sans-serif`; ctx.fillText(String(f.cond.length), bx, by + 0.5);
  }
  if (t.oculto) { ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.arc(cx, cy, r + 9, 0, TAU); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
  ctx.globalAlpha = 1;
  if (sel) { ctx.beginPath(); ctx.arc(cx, cy, r + (v !== null ? 10 : 7), 0, TAU); ctx.strokeStyle = '#d6a23a'; ctx.lineWidth = 4; ctx.stroke(); }
  ctx.restore();
  if (sel || erguido || S.sobre === t.id) pilula(t.nome, cx, y + s + 6 * px, px, 'rgba(20,16,18,.82)', '#fff');
}

// ---------- câmera ----------
function fit() {
  const mp = S.mapa; if (!mp || !W) return;
  const baixo = W < 900 ? 90 : 76, MW = mp.cols * CELL, MH = mp.rows * CELL;
  V.z = clamp(Math.min((W - 32) / MW, (H - 32 - baixo) / MH), ZMIN, 1.6);
  V.ox = (W - MW * V.z) / 2; V.oy = (H - baixo - MH * V.z) / 2 + 8;
  V.fit = mp.id; V.auto = true;
  draw();
}
function zoomAt(p, z) {
  z = clamp(z, ZMIN, ZMAX); V.auto = false;
  const w = toW(p);
  V.z = z; V.ox = p.x - w.x * z; V.oy = p.y - w.y * z;
  draw();
}
// escolhe o token e centraliza depois que o painel lateral abrir (ele estreita o mapa)
function foca(t) { seleciona(t.id); setTimeout(() => { const x = tokenDe(t.id); if (x) centraliza(x); }, 60); }
function centraliza(t) {
  const cx = (t.x + t.tam / 2) * CELL, cy = (t.y + t.tam / 2) * CELL;
  V.ox = W / 2 - cx * V.z; V.oy = H / 2 - cy * V.z - (W < 900 ? 80 : 0); V.auto = false; draw();
}

// ---------- gestos ----------
const ptrs = new Map();
let G = null, espaco = false;
const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const panG = (p, tap) => ({ kind: 'pan', sx: p.x, sy: p.y, ox: V.ox, oy: V.oy, moved: false, tap });
function tokenAt(w) {
  const list = [...S.mapa.tokens].filter((t) => mestre() || !t.oculto).sort((a, b) => (b.id === S.sel) - (a.id === S.sel) || a.tam - b.tam);
  return list.find((t) => w.x >= t.x * CELL && w.x < (t.x + t.tam) * CELL && w.y >= t.y * CELL && w.y < (t.y + t.tam) * CELL);
}
function alvo(t) {
  return { x: clamp(Math.round((G.wx - G.gx) / CELL), 0, Math.max(0, S.mapa.cols - t.tam)), y: clamp(Math.round((G.wy - G.gy) / CELL), 0, Math.max(0, S.mapa.rows - t.tam)) };
}
function encerra() { if (G && G.kind === 'paint') salvaTerreno(); G = null; cv.classList.remove('grab'); }

cv.addEventListener('pointerdown', (e) => {
  if (!S.mapa) return;
  cv.focus({ preventScroll: true });
  cv.setPointerCapture(e.pointerId);
  const p = pt(e);
  ptrs.set(e.pointerId, p);
  if (ptrs.size === 2) { encerra(); const [a, b] = [...ptrs.values()]; G = { kind: 'pinch', d: dist(a, b) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z: V.z, ox: V.ox, oy: V.oy }; draw(); return; }
  if (ptrs.size > 2) return;
  const w = toW(p);
  if (e.button === 1 || e.button === 2 || espaco) { G = panG(p, false); return; }
  if (S.tool === 'regua') { const c = cellOf(w); S.ruler = { a: c, b: c }; G = { kind: 'ruler' }; draw(); return; }
  if (S.tool === 'pintar' || S.tool === 'preencher') {
    const c = cellOf(w);
    if (!dentro(c)) { G = panG(p, false); return; }
    guardaDesfazer();
    if (S.tool === 'preencher') { preenche(c); salvaTerreno(); return; }
    G = { kind: 'paint', last: c }; pinta(c); draw(); return;
  }
  const t = tokenAt(w);
  if (t) {
    seleciona(t.id);
    G = podeMover(t) ? { kind: 'drag', id: t.id, gx: w.x - t.x * CELL, gy: w.y - t.y * CELL, wx: w.x, wy: w.y, s: p, moved: false } : panG(p, false);
    return;
  }
  G = panG(p, true);
});
cv.addEventListener('pointermove', (e) => {
  const p = pt(e);
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
  if (!G) {
    if (!S.mapa) return;
    if (['pintar', 'preencher'].includes(S.tool)) { S.hover = cellOf(toW(p)); draw(); }
    else if (e.pointerType === 'mouse') { const t = tokenAt(toW(p)), id = t ? t.id : null; if (id !== S.sobre) { S.sobre = id; draw(); } }
    return;
  }
  if (G.kind === 'pinch') {
    if (ptrs.size < 2) return;
    const [a, b] = [...ptrs.values()], c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = clamp(G.z * dist(a, b) / G.d, ZMIN, ZMAX), wx = (G.c.x - G.ox) / G.z, wy = (G.c.y - G.oy) / G.z;
    V.z = z; V.ox = c.x - wx * z; V.oy = c.y - wy * z; V.auto = false; draw();
  } else if (G.kind === 'pan') {
    if (Math.hypot(p.x - G.sx, p.y - G.sy) > 4) { G.moved = true; cv.classList.add('grab'); }
    if (G.moved) { V.ox = G.ox + p.x - G.sx; V.oy = G.oy + p.y - G.sy; V.auto = false; draw(); }
  } else if (G.kind === 'drag') {
    const w = toW(p); G.wx = w.x; G.wy = w.y;
    if (!G.moved && dist(p, G.s) > 4) { G.moved = true; cv.classList.add('grab'); }
    draw();
  } else if (G.kind === 'ruler') { S.ruler.b = cellOf(toW(p)); draw(); }
  else if (G.kind === 'paint') {
    const c = cellOf(toW(p)); S.hover = c;
    // liga os pontos para não deixar buracos quando o dedo corre
    let { x, y } = G.last; const dx = Math.abs(c.x - x), dy = -Math.abs(c.y - y), sx = x < c.x ? 1 : -1, sy = y < c.y ? 1 : -1; let err = dx + dy;
    for (let i = 0; i < 500; i++) { pinta({ x, y }); if (x === c.x && y === c.y) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } }
    G.last = c; draw();
  }
});
function solta(e) {
  ptrs.delete(e.pointerId);
  if (!G) return;
  if (G.kind === 'pinch') { if (!ptrs.size) G = null; return; }
  if (G.kind === 'drag' && G.moved) {
    const t = tokenDe(G.id);
    if (t) { const n = alvo(t); if (n.x !== t.x || n.y !== t.y) move(t, n.x, n.y); }
  }
  if (G.kind === 'pan' && G.tap && !G.moved) { seleciona(null); S.ruler = null; draw(); }
  encerra(); draw();
}
cv.addEventListener('pointerup', solta);
cv.addEventListener('pointercancel', solta);
cv.addEventListener('pointerleave', () => { if (!G && (S.hover || S.sobre)) { S.hover = null; S.sobre = null; draw(); } });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('wheel', (e) => { e.preventDefault(); if (!S.mapa) return; zoomAt(pt(e), V.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });

// ---------- ações no mapa ----------
async function move(t, x, y) {
  const ox = t.x, oy = t.y;
  t.x = x; t.y = y; draw();
  try { setMapa(await api('PATCH', `/api/mapas/${S.mapa.id}/tokens/${t.id}`, { x, y })); }
  catch (e) { t.x = ox; t.y = oy; draw(); erro(e); }
}
async function token(method, id, body) {
  try { setMapa(await api(method, `/api/mapas/${S.mapa.id}/tokens${id ? '/' + id : ''}`, body)); return true; }
  catch (e) { erro(e); return false; }
}
async function mapa(body) {
  try { setMapa(await api('PATCH', `/api/mapas/${S.mapa.id}`, body)); refreshSoon(); return true; }
  catch (e) { erro(e); return false; }
}
function refreshSoon() { soon(false); }
function seleciona(id) {
  if (S.sel === id) return;
  S.sel = id;
  if (id) S.painel = 'token'; else if (S.painel === 'token') S.painel = null;
  ui(); draw();
}
function lugarLivre(tam) {
  const mp = S.mapa, c = cellOf(toW({ x: W / 2, y: (W < 900 ? H * 0.35 : H / 2) }));
  const ocupado = (x, y) => mp.tokens.some((t) => x < t.x + t.tam && x + tam > t.x && y < t.y + t.tam && y + tam > t.y);
  const cx = clamp(c.x, 0, mp.cols - tam), cy = clamp(c.y, 0, mp.rows - tam);
  for (let r = 0; r < Math.max(mp.cols, mp.rows); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x + tam <= mp.cols && y + tam <= mp.rows && !ocupado(x, y)) return { x, y };
  }
  return { x: cx, y: cy };
}
async function coloca(body) {
  const l = lugarLivre(body.tam || 1);
  if (await token('POST', null, { ...body, ...l })) {
    const t = S.mapa.tokens[S.mapa.tokens.length - 1];
    if (t) { S.sel = t.id; ui(); draw(); toast(`<b>${esc(t.nome)} está no mapa</b><small>Arraste para mover.</small>`); }
  }
}

// terreno
function pinta(c) {
  const n = S.pincel, o = n === 3 ? 1 : 0, mp = S.mapa;
  for (let y = c.y - o; y < c.y - o + n; y++) for (let x = c.x - o; x < c.x - o + n; x++) if (dentro({ x, y })) mp._arr[y * mp.cols + x] = S.ter;
}
function preenche(c) {
  const mp = S.mapa, arr = mp._arr, de = arr[c.y * mp.cols + c.x];
  if (de === S.ter) return;
  const fila = [c.y * mp.cols + c.x];
  while (fila.length) {
    const i = fila.pop();
    if (arr[i] !== de) continue;
    arr[i] = S.ter;
    const x = i % mp.cols, y = (i - x) / mp.cols;
    if (x > 0) fila.push(i - 1); if (x < mp.cols - 1) fila.push(i + 1);
    if (y > 0) fila.push(i - mp.cols); if (y < mp.rows - 1) fila.push(i + mp.cols);
  }
  draw();
}
function guardaDesfazer() { S.undo.push(S.mapa._arr.join('')); if (S.undo.length > 40) S.undo.shift(); }
async function salvaTerreno() {
  const mp = S.mapa, tiles = mp._arr.join('');
  if (tiles === mp.tiles) { if (S.undo[S.undo.length - 1] === tiles) S.undo.pop(); return; }
  mp.tiles = tiles; S.pend++;
  try { const r = await api('PATCH', `/api/mapas/${mp.id}`, { tiles }); S.pend--; if (S.mapa && S.mapa.id === r.id) setMapa(r); }
  catch (e) { S.pend--; erro(e); abrir(mp.id, true); }
  ui();
}
function desfazer() {
  if (!mestre() || !S.undo.length) return;
  S.mapa._arr = [...S.undo.pop()];
  draw(); salvaTerreno();
}

// ---------- interface ----------
function setTool(t) {
  S.tool = t; S.hover = null;
  if (t !== 'regua') S.ruler = null;
  if (t === 'pintar' || t === 'preencher') S.painel = 'terreno';
  else if (S.painel === 'terreno') S.painel = null;
  cv.className = t === 'regua' ? 'ruler' : t === 'pintar' || t === 'preencher' ? 'paint' : '';
}
const ICON = {
  mover: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  regua: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
  pintar: '<path d="M18.4 2.6a2 2 0 0 1 3 3L12 15l-4 1 1-4z"/><path d="M7 21c-2 0-4-1-4-3 2 0 3-1 4-3"/>',
  preencher: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0z"/><path d="M5 2l5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 2-4 2-4s2 2.4 2 4"/>',
  tokens: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><circle cx="18" cy="9" r="3"/><path d="M17 15a5 5 0 0 1 5 5"/>',
  mapa: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
};
const ico = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
let pendUi = false;
const digitando = (el) => el.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'file' && document.activeElement.type !== 'checkbox';

function ui() {
  const mp = S.mapa, m = mp && mesaDe(mp.mesa), ms = mestre();
  document.title = mp ? `${mp.nome} · Mapas D&D` : 'Mapas D&D 5e';
  $('nm').textContent = mp ? mp.nome : 'Mapas';
  $('sub').textContent = !S.me ? '' : !mp ? `Conectado como ${S.me.name}` : `${m ? m.nome : ''} · ${ms ? (mp.visivel ? 'visível para os jogadores' : 'oculto dos jogadores') : 'mestre: ' + (m && m.mestreNome || '?')}`;
  $('fichas').href = fichaBase() + '/';
  $('zoom').hidden = !mp;
  // ferramentas
  const tl = [['mover', 'Mover'], ['regua', 'Régua']];
  if (ms) tl.push(['pintar', 'Pintar'], ['preencher', 'Preencher']);
  const temFicha = mp && [...S.fichas.values()].some((f) => f.minha && f.mesa === mp.mesa);
  $('tools').innerHTML = !mp ? '' : tl.map(([k, t]) => `<button class="${S.tool === k ? 'on' : ''}" data-a="tool" data-v="${k}" aria-pressed="${S.tool === k}">${ico(k)}${t}</button>`).join('')
    + (ms || temFicha ? `<span class="sep"></span><button class="${S.painel === 'tokens' ? 'on' : ''}" data-a="painel" data-v="tokens" aria-pressed="${S.painel === 'tokens'}">${ico('tokens')}Tokens</button>` : '')
    + (ms ? `<button class="${S.painel === 'mapa' ? 'on' : ''}" data-a="painel" data-v="mapa" aria-pressed="${S.painel === 'mapa'}">${ico('mapa')}Mapa</button>` : '');
  vazio();
  if (digitando($('side'))) pendUi = true; else lado();
}
function vazio() {
  const e = $('empty'); let h = '';
  const link = `<a class="btn pri" href="${esc(fichaBase())}/" target="${alvoFichas}">Abrir o app de fichas</a>`;
  if (S.falta === 'conta') h = `<h2>Entre na sua conta</h2><p class="note">Os mapas usam a mesma conta das fichas. Entre no app de fichas por este mesmo endereço (${esc(location.hostname)}) e volte aqui.</p><div class="btns" style="justify-content:center">${link}<button class="btn" data-a="recarregar">Já entrei</button></div>`;
  else if (S.falta === 'servidor') h = `<h2>Sem conexão</h2><p class="note">O servidor dos mapas não respondeu. Ele e o app de fichas estão ligados?</p><div class="btns" style="justify-content:center"><button class="btn pri" data-a="recarregar">Tentar de novo</button></div>`;
  else if (S.me && !S.mesas.length) h = `<h2>Nenhuma mesa ainda</h2><p class="note">Os mapas ficam nas mesas. Crie uma mesa ou entre numa com o código do mestre no app de fichas.</p><div class="btns" style="justify-content:center">${link}</div>`;
  else if (S.me && !S.mapa) {
    const minhas = S.mesas.filter((m) => m.souMestre);
    if (minhas.length) {
      const foco = minhas.find((m) => m.id === S.foco) || minhas[0];
      h = `<h2>Crie um mapa</h2><p class="note">Pinte o terreno ou use uma imagem de fundo, coloque os tokens das fichas e mostre aos jogadores quando quiser.</p>
      ${minhas.length > 1 ? `<div class="field" style="text-align:left"><label for="nmesa">Mesa</label><select id="nmesa">${minhas.map((m) => `<option value="${esc(m.id)}"${m.id === foco.id ? ' selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></div>` : `<input type="hidden" id="nmesa" value="${esc(foco.id)}">`}
      <div class="field" style="text-align:left"><label for="nnome">Nome do mapa</label><input id="nnome" placeholder="Ex.: Entrada da mina"></div>
      <div class="g2 field" style="text-align:left"><div><label for="ncols">Largura (quadrados)</label><input id="ncols" type="number" min="1" max="120" value="24"></div><div><label for="nrows">Altura (quadrados)</label><input id="nrows" type="number" min="1" max="120" value="18"></div></div>
      <button class="btn pri wide" data-a="criar">Criar mapa</button>`;
    } else h = `<h2>Nenhum mapa ainda</h2><p class="note">Quando o mestre mostrar um mapa, ele aparece aqui sozinho.</p><div class="btns" style="justify-content:center"><a class="btn" href="${esc(fichaBase())}/" target="${alvoFichas}">Ver minhas fichas</a></div>`;
  }
  e.classList.toggle('on', !!h);
  if (h && !digitando(e)) e.innerHTML = `<section class="card">${h}</section>`;
}
function lado() {
  pendUi = false;
  const el = $('side'), mp = S.mapa;
  let h = '';
  if (mp) {
    if (S.painel === 'token' && tokenDe(S.sel)) h = painelToken(tokenDe(S.sel));
    else if (S.painel === 'tokens') h = painelTokens();
    else if (S.painel === 'terreno' && mestre()) h = painelTerreno();
    else if (S.painel === 'mapa' && mestre()) h = painelMapa();
  }
  el.classList.toggle('on', !!h);
  el.innerHTML = h;
  if (h) el.scrollTop = el._top || 0;
}
const fechar = '<button class="x" data-a="fechar" aria-label="Fechar">×</button>';
function painelToken(t) {
  const f = t.ficha && S.fichas.get(t.ficha), ms = mestre(), dono = f && f.minha;
  let h = `<div class="tok"><div class="av" style="background:${esc(t.cor)}">${esc(iniciais(t.nome))}</div><div style="flex:1"><b>${esc(t.nome)}</b><span>${esc(TIPOS[t.tipo] || '')} · ${esc((TAM[t.tam] || '').split(' ')[0])}${t.oculto ? ' · oculto dos jogadores' : ''}</span></div>${fechar}</div>`;
  if (f) {
    const v = f.hp.max ? clamp(f.hp.cur / f.hp.max, 0, 1) : 1;
    h += `<div class="stats"><div><b>${esc(f.ac ?? '–')}</b><span>CA</span></div><div><b>${f.hp.cur}${f.hp.tmp ? '+' + f.hp.tmp : ''}</b><span>PV de ${f.hp.max}</span></div><div><b>${f.level}</b><span>Nível</span></div></div>
    <div class="hpbar"><i class="${v <= 0.25 ? 'low' : v <= 0.5 ? 'mid' : ''}" style="width:${v * 100}%"></i></div>`;
    h += f.cond.length ? `<div class="chips" style="margin-bottom:10px">${f.cond.map((c) => `<span class="chip on">${esc(c)}</span>`).join('')}</div>` : '';
    h += `<p class="note">Ficha de ${esc(f.minha ? 'você' : f.ownerName)}${f.cls ? ' · ' + esc(f.cls) : ''}. PV e condições mudam aqui quando mudam na ficha.</p>
    <div class="btns" style="margin-bottom:6px"><a class="btn sm" href="${esc(fichaBase())}/#ficha/${esc(f.id)}" target="${alvoFichas}">Abrir ficha</a><button class="btn sm" data-a="centro">Centralizar</button></div>`;
  } else if (t.ficha) h += `<p class="note">Estado: <b>${esc(t.saude || 'desconhecido')}</b>. A ficha deste token é do mestre.</p><div class="btns"><button class="btn sm" data-a="centro">Centralizar</button></div>`;
  else h += `<div class="btns"><button class="btn sm" data-a="centro">Centralizar</button></div>`;
  if (ms) {
    h += `<h3>Token</h3>
    <div class="field"><label for="tk-nome">Nome no mapa</label><input id="tk-nome" data-tk="nome" value="${esc(t.nome)}" maxlength="40"></div>
    ${t.fnome && t.fnome !== t.nome ? `<p class="note">Na ficha: ${esc(t.fnome)}. Os jogadores veem o nome do mapa.</p>` : ''}
    <div class="g2 field"><div><label for="tk-tipo">Tipo</label><select id="tk-tipo" data-tk="tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${k === t.tipo ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label for="tk-tam">Tamanho</label><select id="tk-tam" data-tk="tam">${Object.entries(TAM).map(([k, v]) => `<option value="${k}"${+k === t.tam ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div>
    <div class="field" style="display:flex;gap:12px;align-items:center"><input type="color" id="tk-cor" data-tk="cor" value="${esc(t.cor)}" aria-label="Cor do token"><label class="check" style="flex:1"><input type="checkbox" data-tk="oculto"${t.oculto ? ' checked' : ''}>Oculto dos jogadores</label></div>
    <div class="btns">${arma('rmtok', 'Remover do mapa', 'Toque de novo para remover')}</div>`;
  } else if (dono) h += `<p class="note">Arraste o seu token para mover, ou use as setas do teclado.</p><div class="btns">${arma('rmtok', 'Tirar do mapa', 'Toque de novo para tirar')}</div>`;
  return h;
}
function linhaFicha(f, ms) {
  const n = S.mapa.tokens.filter((t) => t.ficha === f.id);
  const info = [f.minha ? (ms ? 'sua' : 'você') : f.ownerName, f.cls, 'nível ' + f.level, `${f.hp.cur}/${f.hp.max} PV`].filter(Boolean).join(' · ');
  const cor = f.owner === (mesaDe(S.mapa.mesa) || {}).mestre ? '#b3262d' : '#2f6fb3';
  const btn = n.length && !(ms && f.minha) ? `<button class="btn sm" data-a="seltok" data-v="${esc(n[0].id)}">Ver</button>`
    : `<button class="btn sm pri" data-a="colocar" data-v="${esc(f.id)}">Colocar</button>`;
  return `<div class="row"><span class="dot" style="background:${cor}">${esc(iniciais(f.nome))}</span><div><b>${esc(f.nome)}</b><span>${esc(info)}${n.length ? ` · ${n.length > 1 ? n.length + ' no mapa' : 'no mapa'}` : ''}</span></div>${btn}</div>`;
}
function painelTokens() {
  const mp = S.mapa, ms = mestre(), fs = [...S.fichas.values()];
  let h = `<h2><span class="grow">Tokens</span>${fechar}</h2>`;
  if (ms) {
    const jog = fs.filter((f) => f.mesa === mp.mesa && !f.minha);
    const meus = fs.filter((f) => f.minha && (f.mesa === mp.mesa || !f.mesa));
    h += `<p class="note">Colocar põe o token no centro da tela. Depois é só arrastar.</p>`;
    h += `<h3>Personagens dos jogadores</h3><div class="list">${jog.length ? jog.map((f) => linhaFicha(f, ms)).join('') : '<p class="note">Nenhuma ficha de jogador nesta mesa ainda.</p>'}</div>`;
    h += `<h3>Suas fichas (monstros e NPCs)</h3><div class="list">${meus.length ? meus.map((f) => linhaFicha(f, ms)).join('') : '<p class="note">Crie fichas para os monstros no app de fichas, na mesa, e eles aparecem aqui. Ficam ocultas dos jogadores.</p>'}</div>`;
    h += `<h3>Token livre</h3><p class="note">Sem ficha: um baú, uma armadilha, um figurante.</p>
    <div class="amt" style="margin-bottom:8px"><input id="lv-nome" placeholder="Nome" maxlength="40" aria-label="Nome do token livre"><select id="lv-tipo" aria-label="Tipo do token livre" style="width:auto">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${k === 'objeto' ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <button class="btn wide" data-a="livre">Colocar token livre</button>`;
    if (mp.tokens.length) h += `<h3>No mapa (${mp.tokens.length})</h3><div class="list">${mp.tokens.map((t) => `<div class="row"><span class="dot" style="background:${esc(t.cor)}">${esc(iniciais(t.nome))}</span><div><b>${esc(t.nome)}</b><span>${esc(TIPOS[t.tipo])}${t.oculto ? ' · oculto' : ''}</span></div><button class="btn sm" data-a="seltok" data-v="${esc(t.id)}">Ver</button></div>`).join('')}</div>`;
  } else {
    const meus = fs.filter((f) => f.minha && f.mesa === mp.mesa);
    h += `<p class="note">Coloque o seu personagem no mapa. Você move só os seus tokens.</p><div class="list">${meus.length ? meus.map((f) => linhaFicha(f, false)).join('') : '<p class="note">Nenhuma ficha sua nesta mesa. Escolha a mesa na aba Principal da ficha.</p>'}</div>`;
  }
  return h;
}
function painelTerreno() {
  let h = `<h2><span class="grow">Terreno</span>${fechar}</h2><div class="pal">`;
  for (const [k, [nome, cor]] of Object.entries(TER)) {
    const bg = cor ? `background-image:url(${textura(k).toDataURL()})` : 'background:repeating-conic-gradient(var(--line) 0 25%,transparent 0 50%) 0 0/12px 12px';
    h += `<button class="${S.ter === k ? 'on' : ''}" data-a="ter" data-v="${k}" aria-pressed="${S.ter === k}"><i style="${bg}"></i>${nome === 'Vazio' ? 'Apagar' : nome}</button>`;
  }
  h += '</div>';
  if (S.tool === 'pintar') h += `<h3>Pincel</h3><div class="seg">${[1, 2, 3].map((n) => `<button class="${S.pincel === n ? 'on' : ''}" data-a="pincel" data-v="${n}">${n}×${n}</button>`).join('')}</div>`;
  h += `<p class="foot">${S.tool === 'pintar' ? 'Arraste no mapa para pintar.' : 'Toque numa área para trocar toda a parte ligada da mesma cor.'} Apagar deixa ver a imagem de fundo. Dois dedos movem o mapa.</p>
  <div class="btns" style="margin-top:10px"><button class="btn sm" data-a="desfazer"${S.undo.length ? '' : ' disabled'}>Desfazer (Ctrl+Z)</button></div>`;
  return h;
}
function painelMapa() {
  const mp = S.mapa;
  return `<h2><span class="grow">Mapa</span>${fechar}</h2>
  ${mp.visivel ? `<p class="note"><span class="badge vis">Visível</span> Os jogadores estão vendo este mapa.</p><div class="btns field"><button class="btn sm" data-a="ocultar">Ocultar dos jogadores</button><button class="btn sm" data-a="mostrar" title="Os jogadores que estão em outro mapa vêm para este">Trazer todos para cá</button></div>`
    : `<p class="note"><span class="badge">Oculto</span> Só você vê este mapa.</p><button class="btn pri wide field" data-a="mostrar">Mostrar aos jogadores</button>`}
  <div class="field"><label for="mp-nome">Nome</label><input id="mp-nome" data-mp="nome" value="${esc(mp.nome)}" maxlength="60"></div>
  <div class="g2 field"><div><label for="mp-cols">Largura (quadrados)</label><input id="mp-cols" data-mp="cols" type="number" min="1" max="120" value="${mp.cols}"></div><div><label for="mp-rows">Altura (quadrados)</label><input id="mp-rows" data-mp="rows" type="number" min="1" max="120" value="${mp.rows}"></div></div>
  <label class="check"><input type="checkbox" data-mp="grade"${mp.grade ? ' checked' : ''}>Mostrar a grade</label>
  <h3>Imagem de fundo</h3>
  <p class="note">A imagem cobre o mapa inteiro. Acerte a largura em quadrados e use “Ajustar altura” para a grade casar com a imagem. Até 8 MB.</p>
  <div class="btns"><label class="btn sm">${mp.fundo ? 'Trocar imagem' : 'Escolher imagem'}<input type="file" id="fundo" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
  ${mp.fundo ? `<button class="btn sm" data-a="ajustar">Ajustar altura</button><button class="btn sm warn" data-a="semfundo">Tirar imagem</button>` : ''}</div>
  <div style="border-top:1px solid var(--line);margin-top:16px;padding-top:12px"><div class="btns">${arma('apagar', 'Apagar mapa', 'Toque de novo: apaga para sempre')}</div></div>`;
}
function arma(k, txt, conf) { const on = S.arm === k; return `<button class="btn sm warn"${on ? ' style="background:var(--red);color:#fff;border-color:var(--red)"' : ''} data-a="arm" data-v="${k}">${on ? conf : txt}</button>`; }
function gaveta() {
  let h = `<h2><span class="grow">Mapas</span><button class="x" data-a="close" aria-label="Fechar">×</button></h2>`;
  h += `<p class="note">Conectado como <b>${esc(S.me ? S.me.name : '?')}</b>. <a href="${esc(fichaBase())}/" target="${alvoFichas}" style="color:var(--redt)">Abrir as fichas</a></p>`;
  for (const m of S.mesas) {
    const list = S.mapas.filter((x) => x.mesa === m.id);
    h += `<div class="grp"><h3>${esc(m.nome)}${m.souMestre ? ' <span class="badge">mestre</span>' : ''}</h3>`;
    h += list.length ? list.map((x) => `<button class="pick ${S.mapa && S.mapa.id === x.id ? 'on' : ''}" data-a="abrir" data-v="${esc(x.id)}"><div><b>${esc(x.nome)}</b><span>${x.cols}×${x.rows} quadrados</span></div>${m.souMestre ? `<span class="badge ${x.visivel ? 'vis' : ''}">${x.visivel ? 'visível' : 'oculto'}</span>` : ''}</button>`).join('')
      : `<p class="note">${m.souMestre ? 'Nenhum mapa ainda.' : 'O mestre ainda não mostrou nenhum mapa.'}</p>`;
    if (m.souMestre) h += `<div class="amt"><input id="nm-${esc(m.id)}" placeholder="Nome do mapa novo" aria-label="Nome do mapa novo em ${esc(m.nome)}"><button class="btn" data-a="novo" data-v="${esc(m.id)}">Criar</button></div>`;
    h += '</div>';
  }
  if (!S.mesas.length) h += `<p class="note">Você ainda não está em nenhuma mesa.</p>`;
  $('panel').innerHTML = h;
  $('sheet').classList.add('on');
}
let toastT;
function toast(h) { const t = $('toast'); t.innerHTML = h; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800); }
function semConta() { S.falta = 'conta'; S.mapa = null; ui(); draw(); }

async function criar(mesa, nome, cols, rows) {
  try {
    const mp = await api('POST', '/api/mapas', { mesa, nome, cols, rows });
    await loadState();
    $('sheet').classList.remove('on');
    S.painel = 'mapa'; setMapa(mp); store('mapa', mp.id); history.replaceState(null, '', '#mapa/' + mp.id);
    toast('<b>Mapa criado</b><small>Só você vê até mostrar aos jogadores.</small>');
  } catch (e) { erro(e); }
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a, v = el.dataset.v;
  if (a === 'close' && e.target !== el) return; // clique dentro da gaveta
  if (a !== 'arm') S.arm = null;
  const t = tokenDe(S.sel);
  switch (a) {
    case 'drawer': gaveta(); break;
    case 'close': $('sheet').classList.remove('on'); break;
    case 'recarregar': location.reload(); break;
    case 'zin': zoomAt({ x: W / 2, y: H / 2 }, V.z * 1.25); break;
    case 'zout': zoomAt({ x: W / 2, y: H / 2 }, V.z / 1.25); break;
    case 'fit': fit(); break;
    case 'tool': setTool(v); ui(); draw(); break;
    case 'painel':
      if (['pintar', 'preencher'].includes(S.tool)) setTool('mover');
      S.painel = S.painel === v ? null : v; if (v !== 'token') S.sel = null; ui(); draw(); break;
    case 'fechar': $('side')._top = 0; if (S.painel === 'terreno') setTool('mover'); S.painel = null; S.sel = null; ui(); draw(); break;
    case 'abrir': $('sheet').classList.remove('on'); abrir(v); break;
    case 'novo': { const n = $('nm-' + v); criar(v, n ? n.value : '', 24, 18); break; }
    case 'criar': criar($('nmesa').value, $('nnome').value, +$('ncols').value, +$('nrows').value); break;
    case 'ter': S.ter = v; lado(); break;
    case 'pincel': S.pincel = +v; lado(); break;
    case 'desfazer': desfazer(); break;
    case 'mostrar': if (await mapa({ mostrar: true })) toast('<b>Os jogadores estão vendo este mapa</b>'); break;
    case 'ocultar': if (await mapa({ visivel: false })) toast('<b>Mapa oculto dos jogadores</b>'); break;
    case 'ajustar': if (S.img) mapa({ rows: clamp(Math.round(S.mapa.cols * S.img.naturalHeight / S.img.naturalWidth), 1, 120) }); break;
    case 'semfundo': try { setMapa(await api('DELETE', `/api/mapas/${S.mapa.id}/fundo`)); } catch (err) { erro(err); } break;
    case 'colocar': coloca({ ficha: v }); break;
    case 'livre': { const n = $('lv-nome').value.trim(); if (!n) { $('lv-nome').focus(); return; } coloca({ nome: n, tipo: $('lv-tipo').value }); break; }
    case 'seltok': { const x = tokenDe(v); if (x) { seleciona(v); centraliza(x); } break; }
    case 'centro': if (t) centraliza(t); break;
    case 'arm':
      if (S.arm !== v) { S.arm = v; lado(); setTimeout(() => { if (S.arm === v) { S.arm = null; lado(); } }, 4000); return; }
      S.arm = null;
      if (v === 'rmtok' && t) { if (await token('DELETE', t.id)) seleciona(null); }
      if (v === 'apagar') {
        try { await api('DELETE', '/api/mapas/' + S.mapa.id); toast('<b>Mapa apagado</b>'); S.mapa = null; await loadState(); const id = escolher(); if (id) abrir(id, true); else { ui(); draw(); } } catch (err) { erro(err); }
      }
      break;
  }
});
$('side').addEventListener('scroll', (e) => { e.target._top = e.target.scrollTop; });
document.addEventListener('change', async (e) => {
  const el = e.target, t = tokenDe(S.sel);
  if (el.dataset.tk && t) {
    const k = el.dataset.tk, val = el.type === 'checkbox' ? el.checked : k === 'tam' ? +el.value : el.value;
    token('PATCH', t.id, { [k]: val });
  } else if (el.dataset.mp) {
    const k = el.dataset.mp;
    if (k === 'grade') mapa({ grade: el.checked });
    else if (k === 'nome') mapa({ nome: el.value });
    else { const n = clamp(Math.round(+el.value) || 1, 1, 120); if (n !== S.mapa[k]) mapa({ [k]: n }); }
  } else if (el.id === 'fundo' && el.files[0]) {
    const f = el.files[0];
    if (f.size > 8 * 1024 * 1024) return toast('<b>Imagem grande demais</b><small>O limite é 8 MB.</small>');
    toast('<b>Enviando imagem…</b>');
    try {
      const mp = await api('PUT', `/api/mapas/${S.mapa.id}/fundo`, f, true);
      setMapa(mp);
      // a grade acompanha a proporção da imagem, mantendo a largura
      const img = new Image();
      img.onload = () => { const rows = clamp(Math.round(mp.cols * img.naturalHeight / img.naturalWidth), 1, 120); if (rows !== mp.rows) mapa({ rows }).then(() => fit()); else fit(); };
      img.src = URL.createObjectURL(f);
      toast('<b>Imagem no mapa</b><small>Ajuste a largura em quadrados se a grade não casar.</small>');
    } catch (err) { erro(err); }
  }
});
document.addEventListener('focusout', () => setTimeout(() => { if (pendUi && !digitando($('side'))) lado(); }, 0));
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && e.target === cv) { espaco = true; e.preventDefault(); }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('nm-')) document.querySelector(`[data-a=novo][data-v="${e.target.id.slice(3)}"]`).click(); return; }
  if (!S.mapa) return;
  const t = tokenDe(S.sel);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); desfazer(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (d) {
    e.preventDefault();
    if (t && podeMover(t)) { const x = clamp(t.x + d[0], 0, S.mapa.cols - t.tam), y = clamp(t.y + d[1], 0, S.mapa.rows - t.tam); if (x !== t.x || y !== t.y) move(t, x, y); }
    else { V.ox -= d[0] * 60; V.oy -= d[1] * 60; V.auto = false; draw(); }
    return;
  }
  if (e.key === 'Escape') { seleciona(null); S.ruler = null; $('sheet').classList.remove('on'); draw(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && t && (mestre() || podeMover(t))) { token('DELETE', t.id).then((ok) => ok && seleciona(null)); }
  else if (e.key === '+' || e.key === '=') zoomAt({ x: W / 2, y: H / 2 }, V.z * 1.25);
  else if (e.key === '-') zoomAt({ x: W / 2, y: H / 2 }, V.z / 1.25);
  else if (e.key === '0') fit();
  else if (e.key === 'v') { setTool('mover'); ui(); }
  else if (e.key === 'r') { setTool('regua'); ui(); }
  else if (e.key === 'b' && mestre()) { setTool('pintar'); ui(); }
  else if (e.key === 'g' && mestre()) { setTool('preencher'); ui(); }
});
document.addEventListener('keyup', (e) => { if (e.key === ' ') espaco = false; });
window.addEventListener('hashchange', () => {
  const m = /^#mapa\/([\w-]+)(?:\/token\/([\w-]+))?$/.exec(location.hash);
  if (!m) return;
  if (!S.mapa || S.mapa.id !== m[1]) { S.focoTok = m[2] || null; abrir(m[1]); }
  else if (m[2]) { const t = tokenDe(m[2]); if (t) foca(t); history.replaceState(null, '', '#mapa/' + m[1]); }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

// ---------- início ----------
(async () => {
  try {
    S.app = (await api('GET', '/api/config')).fichaApp;
    await loadState();
    S.vistos = Math.max(0, ...S.mapas.map((x) => x.mostrado || 0));
    const id = escolher();
    if (id) await abrir(id, true); else ui();
    listen();
  } catch (e) {
    S.falta = e.status === 401 ? 'conta' : 'servidor';
    if (e.status && e.status !== 401 && e.status !== 502) { S.falta = 'servidor'; }
    ui();
  }
})();
