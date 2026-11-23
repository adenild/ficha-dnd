'use strict';
// Servidor dos mapas: editor e visualizador de mapas 2D com os tokens das fichas. Sem dependências: só Node.js 18+.
//
// Não tem contas próprias. Quem chega com o cookie de sessão do app de fichas (o navegador manda o cookie
// para qualquer porta do mesmo endereço) ou com um token de conta é identificado pela API do app de fichas.
// As mesas, quem é mestre e as fichas que cada um pode ver vêm de lá, então as regras de acesso são as mesmas:
//   - o mestre da mesa cria, edita, mostra e apaga os mapas dela;
//   - os jogadores veem só os mapas que o mestre mostrou, sem os tokens ocultos, e movem os tokens das próprias fichas;
//   - de uma ficha que o jogador não pode ler, o mapa mostra só o nome do token e se está ileso, ferido ou caído.

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_JSON = 256 * 1024;
const MAX_IMG = 8 * 1024 * 1024;
const MAX_LADO = 120; // quadrados por lado
const MAX_TOKENS = 300;
const TERRENOS = '.cmgtaplor'; // vazio, pedra, madeira, grama, terra, água, parede, lava, porta, rocha
const TIPOS = ['pj', 'aliado', 'inimigo', 'objeto'];
const CORES = { pj: '#2f6fb3', aliado: '#3f8f4f', inimigo: '#b3262d', objeto: '#7a6a55' };
const IMG = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const STATE_TTL = 1500; // ms que a resposta do app de fichas vale para as rotas de escrita

function createMapas({ dataFile, fichaUrl, fichaPublica = null, fichaPorta = 3000 }) {
  fichaUrl = String(fichaUrl).replace(/\/+$/, '');
  const imgDir = path.join(path.dirname(dataFile), 'mapas-img');
  let db = { mapas: {} };
  try {
    db = Object.assign(db, JSON.parse(fs.readFileSync(dataFile, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Não foi possível ler ${dataFile}: ${e.message}`);
  }

  // ---------- persistência ----------
  let saveTimer = null;
  function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const tmp = dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, dataFile);
  }
  function persist() { if (!saveTimer) saveTimer = setTimeout(flush, 250); }

  // ---------- utilidades ----------
  const id = (p) => p + crypto.randomBytes(6).toString('hex');
  const now = () => Date.now();
  const int = (v, d = 0) => (Number.isFinite(+v) ? Math.round(+v) : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const fail = (status, msg) => { throw new HttpError(status, msg); };
  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  // ---------- identidade pelo app de fichas ----------
  // repassa só a credencial (o cookie sid ou o token), nunca os outros cookies do navegador
  function credencial(req) {
    const a = String(req.headers.authorization || '');
    if (/^Bearer\s+\S/i.test(a)) return { authorization: a };
    const sid = parseCookies(req).sid;
    return sid ? { cookie: 'sid=' + encodeURIComponent(sid) } : null;
  }
  // tokens errados contam por IP aqui também: o app de fichas vê todas as chamadas vindo deste servidor
  const attempts = new Map();
  function throttle(req) {
    const a = attempts.get(req.socket.remoteAddress || '');
    if (a && now() - a.t < 10 * 60e3 && a.n >= 10) fail(429, 'Muitas tentativas. Espere alguns minutos.');
  }
  function failedAttempt(req) {
    const ip = req.socket.remoteAddress || '';
    const a = attempts.get(ip);
    if (!a || now() - a.t > 10 * 60e3) attempts.set(ip, { n: 1, t: now() }); else a.n++;
  }
  const cache = new Map(); // credencial -> { t, p }
  function fichaState(req, fresh = false) {
    const cred = credencial(req);
    if (!cred) fail(401, 'Entre na sua conta no app de fichas.');
    if (cred.authorization) throttle(req);
    const key = cred.authorization || cred.cookie;
    const hit = cache.get(key);
    if (!fresh && hit && now() - hit.t < STATE_TTL) return hit.p;
    const p = (async () => {
      let r;
      try { r = await fetch(fichaUrl + '/api/state', { headers: cred }); } catch { fail(502, `O app de fichas não respondeu em ${fichaUrl}. Ele está ligado?`); }
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { if (cred.authorization) failedAttempt(req); fail(401, j.error || 'Entre na sua conta no app de fichas.'); }
      if (r.status !== 200) fail([403, 429].includes(r.status) ? r.status : 502, j.error || `O app de fichas respondeu ${r.status}.`);
      return j;
    })();
    cache.set(key, { t: now(), p });
    p.catch(() => cache.delete(key));
    if (cache.size > 300) for (const [k, v] of cache) if (now() - v.t > STATE_TTL) cache.delete(k);
    return p;
  }
  const mesaDe = (st, mid) => st.mesas.find((m) => m.id === mid) || null;
  const souMestre = (st, mid) => { const m = mesaDe(st, mid); return !!m && m.mestre === st.me.id; };
  function fichaResumo(st, c) {
    const d = c.data || {}, hp = d.hp || {};
    return {
      id: c.id, owner: c.owner, ownerName: c.ownerName, mesa: c.mesa, lib: !!c.lib, minha: c.owner === st.me.id,
      nome: String(d.name || 'Sem nome'), cls: String(d.cls || ''), level: +d.level || 1, ac: d.ac ?? null,
      hp: { max: +hp.max || 0, cur: +hp.cur || 0, tmp: +hp.tmp || 0 }, cond: Array.isArray(d.cond) ? d.cond.map(String) : [],
    };
  }

  // ---------- eventos ao vivo (SSE) ----------
  const streams = new Set(); // { res, mesas: Set }
  function notify(mesa, msg) {
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const s of streams) if (s.mesas.has(mesa)) s.res.write(line);
  }
  const heartbeat = setInterval(() => { for (const s of streams) s.res.write(': ping\n\n'); }, 25000);
  heartbeat.unref();
  function pipeFichas(req, res) {
    const cred = credencial(req);
    if (!cred) fail(401, 'Entre na sua conta no app de fichas.');
    const u = new URL(fichaUrl + '/api/events');
    const up = (u.protocol === 'https:' ? https : http).get(u, { headers: cred }, (r) => {
      if (r.statusCode !== 200) {
        r.resume();
        if (!res.headersSent) res.writeHead(r.statusCode === 401 ? 401 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'O app de fichas recusou os eventos ao vivo.' }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('close', () => up.destroy());
  }

  // ---------- mapas ----------
  // saúde aproximada: o que os jogadores veem de uma ficha que não podem ler
  function saudeDe(hp) {
    const max = +(hp && hp.max) || 0, cur = +(hp && hp.cur) || 0;
    if (cur <= 0 && max > 0) return 'caído';
    if (!max || cur >= max) return 'ileso';
    return cur * 2 <= max ? 'muito ferido' : 'ferido';
  }
  // o mestre enxerga todas as fichas da mesa: quando ele consulta, o nome e a saúde dos tokens ficam em dia
  function sincronizar(st) {
    const fichas = new Map(st.chars.map((c) => [c.id, c]));
    for (const mp of Object.values(db.mapas)) {
      if (!souMestre(st, mp.mesa)) continue;
      let mudou = false;
      for (const t of mp.tokens) {
        const c = t.ficha && fichas.get(t.ficha);
        if (!c) continue;
        const nome = String((c.data && c.data.name) || '').trim().slice(0, 40) || t.nome;
        const saude = saudeDe(c.data && c.data.hp);
        if (t.fnome !== nome) { if (t.nome === t.fnome) t.nome = nome; t.fnome = nome; mudou = true; }
        if (t.saude !== saude) { t.saude = saude; mudou = true; }
      }
      if (mudou) { persist(); notify(mp.mesa, { mapa: mp.id }); }
    }
  }
  function getMapa(st, mid) {
    const mp = db.mapas[mid];
    if (!mp || !mesaDe(st, mp.mesa)) fail(404, 'Mapa não encontrado.');
    const mestre = souMestre(st, mp.mesa);
    if (!mestre && !mp.visivel) fail(404, 'Mapa não encontrado.');
    return { mp, mestre };
  }
  const resumo = (mp) => ({ id: mp.id, mesa: mp.mesa, nome: mp.nome, cols: mp.cols, rows: mp.rows, visivel: !!mp.visivel, mostrado: mp.mostrado || 0, upd: mp.upd });
  function view(mp, mestre) {
    return {
      ...resumo(mp), tiles: mp.tiles, grade: mp.grade !== false,
      fundo: mp.fundo ? { v: mp.fundo.v } : null,
      tokens: mp.tokens.filter((t) => mestre || !t.oculto).map((t) => {
        const o = { id: t.id, ficha: t.ficha || '', nome: t.nome, cor: t.cor, tipo: t.tipo, x: t.x, y: t.y, tam: t.tam, oculto: !!t.oculto, saude: t.saude || null };
        if (mestre && t.fnome) o.fnome = t.fnome; // o nome real da ficha não vaza quando o mestre rebatiza o token
        return o;
      }),
    };
  }
  function cleanNome(n, padrao) { return String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) || padrao; }
  function lado(v, padrao) { return clamp(int(v, padrao), 1, MAX_LADO); }
  function encaixa(mp, t) {
    t.x = clamp(t.x, 0, Math.max(0, mp.cols - t.tam));
    t.y = clamp(t.y, 0, Math.max(0, mp.rows - t.tam));
  }
  function redimensiona(mp, cols, rows) {
    if (cols === mp.cols && rows === mp.rows) return;
    let tiles = '';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) tiles += x < mp.cols && y < mp.rows ? mp.tiles[y * mp.cols + x] : '.';
    Object.assign(mp, { cols, rows, tiles });
    for (const t of mp.tokens) encaixa(mp, t);
  }
  function aplicaToken(t, b, mestre) {
    if (b.x !== undefined) t.x = int(b.x, t.x);
    if (b.y !== undefined) t.y = int(b.y, t.y);
    if (!mestre) return t;
    if (b.nome !== undefined) t.nome = cleanNome(b.nome, t.nome || 'Token').slice(0, 40);
    if (b.cor !== undefined && /^#[0-9a-f]{6}$/i.test(String(b.cor))) t.cor = String(b.cor).toLowerCase();
    if (b.tipo !== undefined && TIPOS.includes(b.tipo) && b.tipo !== t.tipo) {
      if (b.cor === undefined && t.cor === CORES[t.tipo]) t.cor = CORES[b.tipo]; // a cor padrão acompanha o tipo
      t.tipo = b.tipo;
    }
    if (b.tam !== undefined) t.tam = clamp(int(b.tam, 1), 1, 4);
    if (b.oculto !== undefined) t.oculto = !!b.oculto;
    return t;
  }
  function tocar(mp) { mp.upd = now(); persist(); notify(mp.mesa, { mapa: mp.id }); }

  // ---------- imagem de fundo ----------
  function tipoDaImagem(buf) {
    if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
    return null;
  }
  function apagaFundo(mp) {
    if (mp.fundo) fs.rm(path.join(imgDir, mp.fundo.arq), { force: true }, () => {});
    mp.fundo = null;
  }

  // ---------- rotas ----------
  async function api(req, res, url) {
    const m = req.method;
    const p = url.pathname;

    // pública: a tela precisa saber onde fica o app de fichas antes de a pessoa entrar
    if (p === '/api/config' && m === 'GET') return { fichaApp: { url: fichaPublica, porta: fichaPorta } };
    if (p === '/api/events' && m === 'GET') {
      const st = await fichaState(req, true);
      const s = { res, mesas: new Set(st.mesas.map((x) => x.id)) };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      streams.add(s);
      req.on('close', () => streams.delete(s));
      return undefined;
    }
    if (p === '/api/fichas/events' && m === 'GET') { pipeFichas(req, res); return undefined; }

    let mm = p.match(/^\/api\/mapas\/([\w-]+)\/fundo$/);
    if (mm && m === 'GET') {
      const { mp } = getMapa(await fichaState(req), mm[1]);
      if (!mp.fundo) fail(404, 'Este mapa não tem imagem de fundo.');
      const file = path.join(imgDir, mp.fundo.arq);
      const st = await fs.promises.stat(file).catch(() => fail(404, 'Imagem não encontrada.'));
      res.writeHead(200, { 'Content-Type': mp.fundo.tipo, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
      fs.createReadStream(file).pipe(res);
      return undefined;
    }
    if (mm && m === 'PUT') {
      const st = await fichaState(req);
      const { mp, mestre } = getMapa(st, mm[1]);
      if (!mestre) fail(403, 'Só o mestre muda o mapa.');
      const buf = await readBody(req, MAX_IMG, 'Imagem grande demais: o limite é 8 MB.');
      const tipo = tipoDaImagem(buf);
      if (!tipo) fail(400, 'Use uma imagem PNG, JPEG, WebP ou GIF.');
      fs.mkdirSync(imgDir, { recursive: true });
      apagaFundo(mp);
      const v = crypto.randomBytes(4).toString('hex');
      const arq = `${mp.id}-${v}.${IMG[tipo]}`;
      await fs.promises.writeFile(path.join(imgDir, arq), buf);
      mp.fundo = { arq, tipo, v };
      tocar(mp);
      return view(mp, true);
    }
    if (mm && m === 'DELETE') {
      const { mp, mestre } = getMapa(await fichaState(req), mm[1]);
      if (!mestre) fail(403, 'Só o mestre muda o mapa.');
      apagaFundo(mp);
      tocar(mp);
      return view(mp, true);
    }

    const body = m === 'GET' || m === 'DELETE' ? {} : JSON.parse((await readBody(req, MAX_JSON, 'Pedido grande demais.')).toString('utf8') || '{}');

    if (p === '/api/state' && m === 'GET') {
      const st = await fichaState(req, true);
      sincronizar(st);
      return {
        me: { id: st.me.id, name: st.me.name, tema: (st.me.prefs && st.me.prefs.tema) || 'auto' },
        mesas: st.mesas.map((x) => ({ id: x.id, nome: x.nome, mestre: x.mestre, souMestre: x.mestre === st.me.id, mestreNome: ((x.membros || []).find((y) => y.id === x.mestre) || {}).name || '' })),
        fichas: st.chars.filter((c) => c.mesa || c.owner === st.me.id).map((c) => fichaResumo(st, c)),
        mapas: Object.values(db.mapas).filter((mp) => mesaDe(st, mp.mesa) && (mp.visivel || souMestre(st, mp.mesa))).sort((a, b) => a.criado - b.criado).map(resumo),
        fichaApp: { url: fichaPublica, porta: fichaPorta },
      };
    }

    if (p === '/api/mapas' && m === 'POST') {
      const st = await fichaState(req);
      if (!mesaDe(st, body.mesa)) fail(404, 'Mesa não encontrada.');
      if (!souMestre(st, body.mesa)) fail(403, 'Só o mestre da mesa cria mapas.');
      if (Object.values(db.mapas).filter((x) => x.mesa === body.mesa).length >= 100) fail(400, 'Limite de 100 mapas por mesa: apague algum antes.');
      const cols = lado(body.cols, 24), rows = lado(body.rows, 18);
      const mid = id('p');
      db.mapas[mid] = { id: mid, mesa: body.mesa, nome: cleanNome(body.nome, 'Mapa sem nome'), cols, rows, tiles: '.'.repeat(cols * rows), grade: true, fundo: null, tokens: [], visivel: false, mostrado: 0, criado: now(), upd: now() };
      persist();
      return view(db.mapas[mid], true);
    }

    mm = p.match(/^\/api\/mapas\/([\w-]+)(?:\/tokens(?:\/([\w-]+))?)?$/);
    if (!mm) fail(404, 'Rota desconhecida.');
    const tokensRota = p.includes('/tokens');
    if (!tokensRota && m === 'GET') {
      const st = await fichaState(req);
      const { mp, mestre } = getMapa(st, mm[1]);
      if (mestre) sincronizar(st);
      return view(mp, mestre);
    }
    const st = await fichaState(req);
    const { mp, mestre } = getMapa(st, mm[1]);

    if (!tokensRota) {
      if (!mestre) fail(403, 'Só o mestre muda o mapa.');
      if (m === 'DELETE') {
        apagaFundo(mp);
        delete db.mapas[mp.id];
        persist();
        notify(mp.mesa, { mapa: mp.id, apagado: true });
        return { ok: true };
      }
      if (m !== 'PATCH') fail(405, 'Método não permitido.');
      if (body.nome !== undefined) mp.nome = cleanNome(body.nome, mp.nome);
      if (body.cols !== undefined || body.rows !== undefined) redimensiona(mp, lado(body.cols ?? mp.cols, mp.cols), lado(body.rows ?? mp.rows, mp.rows));
      if (body.tiles !== undefined) {
        const s = String(body.tiles);
        if (s.length !== mp.cols * mp.rows || [...s].some((ch) => !TERRENOS.includes(ch))) fail(400, 'Terreno inválido: atualize a página e tente de novo.');
        mp.tiles = s;
      }
      if (body.grade !== undefined) mp.grade = !!body.grade;
      if (body.visivel !== undefined) { mp.visivel = !!body.visivel; if (mp.visivel) mp.mostrado = now(); }
      if (body.mostrar) { mp.visivel = true; mp.mostrado = now(); }
      tocar(mp);
      return view(mp, true);
    }

    const fichas = new Map(st.chars.map((c) => [c.id, c]));
    const minhaFicha = (cid) => { const c = fichas.get(cid); return !!c && c.owner === st.me.id && c.mesa === mp.mesa; };

    if (!mm[2]) {
      if (m !== 'POST') fail(405, 'Método não permitido.');
      if (mp.tokens.length >= MAX_TOKENS) fail(400, `Limite de ${MAX_TOKENS} tokens por mapa.`);
      const t = { id: id('k'), ficha: '', nome: 'Token', cor: CORES.objeto, tipo: 'objeto', x: 0, y: 0, tam: 1, oculto: false };
      if (body.ficha) {
        const c = fichas.get(String(body.ficha));
        if (!c) fail(404, 'Ficha não encontrada.');
        if (mestre) { if (c.mesa !== mp.mesa && c.owner !== st.me.id) fail(400, 'Essa ficha não é desta mesa.'); }
        else if (!minhaFicha(c.id)) fail(403, 'Você só coloca no mapa as suas fichas desta mesa.');
        if (!mestre && mp.tokens.some((x) => x.ficha === c.id)) fail(409, 'Essa ficha já está no mapa.');
        const tipo = c.owner === mesaDe(st, mp.mesa).mestre ? 'inimigo' : 'pj';
        Object.assign(t, { ficha: c.id, nome: String((c.data && c.data.name) || 'Sem nome').slice(0, 40), tipo, cor: CORES[tipo], saude: saudeDe(c.data && c.data.hp) });
        t.fnome = t.nome;
      } else if (!mestre) fail(403, 'Só o mestre coloca tokens livres.');
      aplicaToken(t, body, mestre);
      encaixa(mp, t);
      mp.tokens.push(t);
      tocar(mp);
      return view(mp, mestre);
    }

    const t = mp.tokens.find((x) => x.id === mm[2]);
    if (!t || (!mestre && t.oculto)) fail(404, 'Token não encontrado.');
    if (!mestre && !(t.ficha && minhaFicha(t.ficha))) fail(403, 'Você só mexe nos tokens das suas fichas.');
    if (m === 'PATCH') {
      aplicaToken(t, body, mestre);
      encaixa(mp, t);
    } else if (m === 'DELETE') {
      mp.tokens = mp.tokens.filter((x) => x !== t);
    } else fail(405, 'Método não permitido.');
    tocar(mp);
    return view(mp, mestre);
  }

  function readBody(req, max, msg) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (ch) => {
        size += ch.length;
        if (size > max) { reject(new HttpError(413, msg)); req.destroy(); return; }
        chunks.push(ch);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    try {
      const out = await api(req, res, url);
      if (out === undefined) return; // stream
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
    } catch (e) {
      const status = e instanceof SyntaxError ? 400 : e.status || 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? 'Erro no servidor.' : status === 400 && e instanceof SyntaxError ? 'JSON inválido.' : e.message }));
    }
  });

  return { server, flush, db: () => db };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}

if (require.main === module) {
  const fichaUrl = (process.env.FICHA_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const app = createMapas({
    dataFile: process.env.MAPAS_DATA || path.join(__dirname, '..', 'data', 'mapas.json'),
    fichaUrl,
    fichaPublica: process.env.FICHA_PUBLICA || null,
    fichaPorta: +process.env.FICHA_PORTA || +new URL(fichaUrl).port || 3000,
  });
  const port = +process.env.MAPAS_PORT || 3001;
  app.server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`Mapas D&D rodando na porta ${port}, usando o app de fichas em ${fichaUrl}.`);
    const shown = +process.env.PUBLIC_PORT || port;
    console.log(`Neste computador: http://localhost:${shown}`);
    if (process.env.IN_DOCKER) console.log(`No celular (mesma Wi-Fi): http://<IP deste computador na rede>:${shown}`);
    else for (const ip of lanAddresses()) console.log(`No celular (mesma Wi-Fi): http://${ip}:${shown}`);
  });
  const stop = () => { app.flush(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { createMapas, TERRENOS };
