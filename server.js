'use strict';
// Servidor das fichas de D&D 5e. Sem dependências: só Node.js 18+.
// Guarda tudo em data/db.json e serve o app de public/.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 512 * 1024;
const SESSION_DAYS = 90;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const TOKEN_PREFIX = 'fdnd_';
const AUDIT_MAX = 5000; // registros de auditoria guardados no total (os mais antigos saem)
const TEMAS = ['auto', 'claro', 'escuro'];
const ABAS = ['principal', 'combate', 'magias', 'itens', 'notas'];

function createApp({ dataFile }) {
  let db = { users: {}, sessions: {}, mesas: {}, chars: {}, tokens: {}, audit: [] };
  try {
    db = Object.assign(db, JSON.parse(fs.readFileSync(dataFile, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Não foi possível ler ${dataFile}: ${e.message}`);
  }
  // bancos antigos não têm tokens nem auditoria
  db.tokens = db.tokens || {};
  db.audit = Array.isArray(db.audit) ? db.audit : [];

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
  const nameKey = (n) => n.trim().toLowerCase();
  function newCode() {
    let c;
    do { c = Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''); }
    while (Object.values(db.mesas).some((m) => m.code === c));
    return c;
  }
  function hashPass(pass, salt = crypto.randomBytes(16).toString('hex')) {
    return { salt, hash: crypto.scryptSync(pass, salt, 64).toString('hex') };
  }
  function checkPass(user, pass) {
    const h = crypto.scryptSync(pass, user.salt, 64);
    return crypto.timingSafeEqual(h, Buffer.from(user.hash, 'hex'));
  }
  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const fail = (status, msg) => { throw new HttpError(status, msg); };

  // ---------- regras de acesso ----------
  const isMestre = (m, u) => !!m && m.mestre === u;
  const isMember = (m, u) => !!m && (m.mestre === u || m.membros.includes(u));
  function canRead(c, u) {
    if (c.owner === u) return true;
    const m = db.mesas[c.mesa];
    if (isMestre(m, u)) return true;
    return !!c.lib && isMember(m, u);
  }
  function canWrite(c, u) { return c.owner === u || isMestre(db.mesas[c.mesa], u); }

  // ---------- eventos ao vivo (SSE) ----------
  const streams = new Map(); // uid -> Set(res)
  function notify(uids) {
    for (const u of new Set(uids)) for (const res of streams.get(u) || []) res.write('data: changed\n\n');
  }
  const mesaPeople = (m) => (m ? [m.mestre, ...m.membros] : []);
  const charPeople = (c, extraMesa) => [c.owner, ...mesaPeople(db.mesas[c.mesa]), ...mesaPeople(db.mesas[extraMesa])];
  const heartbeat = setInterval(() => { for (const set of streams.values()) for (const res of set) res.write(': ping\n\n'); }, 25000);
  heartbeat.unref();

  // ---------- visão de estado de um usuário ----------
  const userName = (u) => (db.users[u] ? db.users[u].name : 'Alguém');
  function stateFor(u) {
    const mesas = Object.values(db.mesas).filter((m) => isMember(m, u)).sort((a, b) => a.created - b.created).map((m) => ({
      id: m.id, nome: m.nome, mestre: m.mestre, descricao: m.descricao || '',
      ...(isMestre(m, u) ? { code: m.code, convites: m.convites !== false, libAuto: !!m.libAuto } : {}),
      membros: mesaPeople(m).map((x) => ({ id: x, name: userName(x) })),
    }));
    const chars = Object.values(db.chars).filter((c) => canRead(c, u)).map((c) => ({
      id: c.id, owner: c.owner, ownerName: userName(c.owner), mesa: c.mesa, lib: !!c.lib, upd: c.upd, data: c.data,
    }));
    return { me: { id: u, name: userName(u), prefs: prefsOf(u) }, mesas, chars };
  }
  function prefsOf(u) {
    const p = (db.users[u] && db.users[u].prefs) || {};
    return { tema: TEMAS.includes(p.tema) ? p.tema : 'auto', abrirTravada: p.abrirTravada !== false, abaInicial: ABAS.includes(p.abaInicial) ? p.abaInicial : 'principal' };
  }

  // ---------- tokens de conta e auditoria ----------
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const tokenView = (t) => ({ id: t.id, nome: t.nome, inicio: t.inicio, criado: t.criado, usado: t.usado || null, pausado: !!t.pausado });
  function tokenUser(req) {
    const h = String(req.headers.authorization || '');
    if (!/^Bearer\s+/i.test(h)) return null;
    throttle(req);
    const raw = h.replace(/^Bearer\s+/i, '').trim();
    const hash = sha(raw);
    const t = raw.startsWith(TOKEN_PREFIX) && Object.values(db.tokens).find((x) => x.hash === hash);
    if (!t || !db.users[t.uid]) { failedAttempt(req); fail(401, 'Token inválido ou removido.'); }
    if (!t.pausado) t.usado = now(); // pausado: a rota recusa depois de registrar a tentativa
    return t;
  }
  function audit(entry) {
    db.audit.push({ t: now(), ...entry });
    if (db.audit.length > AUDIT_MAX) db.audit.splice(0, db.audit.length - AUDIT_MAX);
    persist();
  }
  // descreve uma chamada em português para o registro de auditoria, com o nome do alvo quando der
  function describe(m, p, body) {
    const ch = (cid) => (db.chars[cid] && db.chars[cid].data && db.chars[cid].data.name) || cid;
    const me = (mid) => (db.mesas[mid] && db.mesas[mid].nome) || mid;
    let x;
    if (p === '/api/state') return 'Consultou fichas e mesas';
    if (p === '/api/events') return 'Acompanhou mudanças ao vivo';
    if (p === '/api/chars' && m === 'POST') return `Criou a ficha ${(body.data && body.data.name) || ''}`.trim();
    if ((x = p.match(/^\/api\/chars\/([\w-]+)(\/lib)?$/))) {
      if (x[2]) return `${body.lib ? 'Liberou' : 'Ocultou'} a ficha ${ch(x[1])}`;
      return m === 'DELETE' ? `Apagou a ficha ${ch(x[1])}` : `Alterou a ficha ${ch(x[1])}`;
    }
    if (p === '/api/mesas' && m === 'POST') return `Criou a mesa ${body.nome || ''}`.trim();
    if (p === '/api/mesas/join') return 'Entrou numa mesa com código';
    if ((x = p.match(/^\/api\/mesas\/([\w-]+)(?:\/(\w+))?$/))) {
      const verb = { leave: 'Saiu da mesa', kick: 'Removeu um jogador da mesa', code: 'Trocou o código da mesa', lib: 'Mudou a visibilidade das fichas da mesa' }[x[2]]
        || (m === 'DELETE' ? 'Apagou a mesa' : 'Alterou a mesa');
      return `${verb} ${me(x[1])}`;
    }
    return `${m} ${p}`;
  }

  // ---------- sessão ----------
  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }
  function sessionUser(req) {
    const t = parseCookies(req).sid;
    const s = t && db.sessions[t];
    if (!s) return null;
    if (s.exp < now() || !db.users[s.uid]) { delete db.sessions[t]; persist(); return null; }
    return s.uid;
  }
  function startSession(res, uid) {
    const t = crypto.randomBytes(32).toString('hex');
    db.sessions[t] = { uid, exp: now() + SESSION_DAYS * 864e5 };
    persist();
    res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
  }
  const attempts = new Map(); // ip -> {n, t}
  function throttle(req) {
    const ip = req.socket.remoteAddress || '';
    const a = attempts.get(ip);
    if (a && now() - a.t < 10 * 60e3 && a.n >= 10) fail(429, 'Muitas tentativas. Espere alguns minutos.');
  }
  function failedAttempt(req) {
    const ip = req.socket.remoteAddress || '';
    const a = attempts.get(ip);
    if (!a || now() - a.t > 10 * 60e3) attempts.set(ip, { n: 1, t: now() }); else a.n++;
  }

  // ---------- validação ----------
  function cleanName(n) {
    n = String(n || '').trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 30) fail(400, 'O nome precisa ter de 2 a 30 caracteres.');
    return n;
  }
  function cleanPass(p) {
    p = String(p || '');
    if (p.length < 6 || p.length > 200) fail(400, 'A senha precisa ter pelo menos 6 caracteres.');
    return p;
  }
  function cleanData(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) fail(400, 'Ficha inválida.');
    const copy = { ...d };
    for (const k of ['id', 'mesa', 'lib', 'owner', 'upd']) delete copy[k];
    for (const k of Object.keys(copy)) if (k.startsWith('_')) delete copy[k];
    return copy;
  }
  function getChar(cid) { return db.chars[cid] || fail(404, 'Ficha não encontrada.'); }
  function getMesa(mid) { return db.mesas[mid] || fail(404, 'Mesa não encontrada.'); }
  function checkMesaFor(owner, mesa) {
    if (!mesa) return '';
    if (!isMember(db.mesas[mesa], owner)) fail(403, 'O dono da ficha não participa dessa mesa.');
    return mesa;
  }
  const libAuto = (mid) => !!(mid && db.mesas[mid] && db.mesas[mid].libAuto);
  function detachFromMesa(mid, uid) {
    for (const c of Object.values(db.chars)) if (c.mesa === mid && (!uid || c.owner === uid)) { c.mesa = ''; c.lib = false; c.upd = now(); }
  }

  // ---------- rotas ----------
  async function api(req, res, url) {
    const m = req.method;
    const p = url.pathname;
    const body = m === 'GET' || m === 'DELETE' ? {} : await readJson(req);

    if (p === '/api/register' && m === 'POST') {
      throttle(req);
      const name = cleanName(body.name), pass = cleanPass(body.pass);
      if (Object.values(db.users).some((x) => x.key === nameKey(name))) fail(409, 'Esse nome já está em uso.');
      const uid = id('u');
      db.users[uid] = { id: uid, name, key: nameKey(name), ...hashPass(pass), created: now() };
      startSession(res, uid);
      return stateFor(uid);
    }
    if (p === '/api/login' && m === 'POST') {
      throttle(req);
      const key = nameKey(String(body.name || ''));
      const user = Object.values(db.users).find((x) => x.key === key);
      if (!user || !checkPass(user, String(body.pass || ''))) { failedAttempt(req); fail(401, 'Nome ou senha incorretos.'); }
      startSession(res, user.id);
      return stateFor(user.id);
    }
    if (p === '/api/logout' && m === 'POST') {
      const t = parseCookies(req).sid;
      if (t) { delete db.sessions[t]; persist(); }
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      return { ok: true };
    }

    // um token de conta (assistentes, scripts) ou a sessão do navegador
    const tok = tokenUser(req);
    const u = tok ? tok.uid : sessionUser(req);
    if (!u) fail(401, 'Entre na sua conta.');
    if (tok) {
      req.audit = { uid: u, token: tok.id, tokenNome: tok.nome, acao: describe(m, p, body) };
      if (tok.pausado) fail(403, `O token "${tok.nome}" está pausado. Retome-o em Configurações › Conta.`);
      if (/^\/api\/(password|tokens|audit|me|sessions)(\/|$)/.test(p)) fail(403, 'Um token não mexe nas configurações da conta: entre com nome e senha no app.');
    }
    const gestao = (acao) => audit({ uid: u, acao, status: 200, via: 'conta' });

    if (p === '/api/state' && m === 'GET') return stateFor(u);
    if (p === '/api/info' && m === 'GET') return { docker: !!process.env.IN_DOCKER, pasta: process.env.IN_DOCKER ? null : __dirname };

    // conta: nome e preferências
    if (p === '/api/me' && m === 'PATCH') {
      const user = db.users[u];
      if (body.name !== undefined) {
        const name = cleanName(body.name);
        if (Object.values(db.users).some((x) => x.id !== u && x.key === nameKey(name))) fail(409, 'Esse nome já está em uso.');
        user.name = name; user.key = nameKey(name);
      }
      if (body.prefs && typeof body.prefs === 'object') {
        const cur = prefsOf(u), np = body.prefs;
        user.prefs = {
          tema: TEMAS.includes(np.tema) ? np.tema : cur.tema,
          abrirTravada: np.abrirTravada === undefined ? cur.abrirTravada : !!np.abrirTravada,
          abaInicial: ABAS.includes(np.abaInicial) ? np.abaInicial : cur.abaInicial,
        };
      }
      persist();
      notify(Object.values(db.mesas).filter((x) => isMember(x, u)).flatMap(mesaPeople).concat(u));
      return stateFor(u);
    }
    if (p === '/api/sessions/sair-outras' && m === 'POST') {
      const cur = parseCookies(req).sid; let n = 0;
      for (const [t, s] of Object.entries(db.sessions)) if (s.uid === u && t !== cur) { delete db.sessions[t]; n++; }
      gestao(`Encerrou ${n} ${n === 1 ? 'sessão' : 'sessões'} em outros aparelhos`);
      return { encerradas: n };
    }

    // tokens de conta
    if (p === '/api/tokens' && m === 'GET') {
      return { tokens: Object.values(db.tokens).filter((t) => t.uid === u).sort((a, b) => b.criado - a.criado).map(tokenView) };
    }
    if (p === '/api/tokens' && m === 'POST') {
      const nome = String(body.nome || '').trim().replace(/\s+/g, ' ').slice(0, 40) || 'Token sem nome';
      if (Object.values(db.tokens).filter((t) => t.uid === u).length >= 20) fail(400, 'Limite de 20 tokens por conta: remova algum antes.');
      const raw = TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
      const tid = id('t');
      db.tokens[tid] = { id: tid, uid: u, nome, hash: sha(raw), inicio: raw.slice(0, TOKEN_PREFIX.length + 4), criado: now(), usado: null, pausado: false };
      gestao(`Criou o token ${nome}`);
      return { ...tokenView(db.tokens[tid]), token: raw };
    }
    let mt = p.match(/^\/api\/tokens\/([\w-]+)$/);
    if (mt) {
      const t = db.tokens[mt[1]];
      if (!t || t.uid !== u) fail(404, 'Token não encontrado.');
      if (m === 'PATCH') {
        t.pausado = !!body.pausado;
        gestao(`${t.pausado ? 'Pausou' : 'Retomou'} o token ${t.nome}`);
        return tokenView(t);
      }
      if (m === 'DELETE') {
        delete db.tokens[t.id];
        gestao(`Removeu o token ${t.nome}`);
        return { ok: true };
      }
      fail(405, 'Método não permitido.');
    }
    if (p === '/api/audit' && m === 'GET') {
      const only = url.searchParams.get('token');
      const lim = Math.min(Math.max(1, +url.searchParams.get('limite') || 200), 1000);
      const list = db.audit.filter((e) => e.uid === u && (!only || e.token === only)).slice(-lim).reverse();
      return { registros: list.map((e) => ({ t: e.t, acao: e.acao, status: e.status, via: e.via || 'token', token: e.tokenNome || null, tokenId: e.token || null })) };
    }

    if (p === '/api/events' && m === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      if (!streams.has(u)) streams.set(u, new Set());
      streams.get(u).add(res);
      req.on('close', () => { const s = streams.get(u); if (s) { s.delete(res); if (!s.size) streams.delete(u); } });
      return undefined;
    }

    if (p === '/api/password' && m === 'POST') {
      const user = db.users[u];
      if (!checkPass(user, String(body.old || ''))) fail(401, 'Senha atual incorreta.');
      Object.assign(user, hashPass(cleanPass(body.pass)));
      persist();
      return { ok: true };
    }

    // mesas
    if (p === '/api/mesas' && m === 'POST') {
      const nome = String(body.nome || '').trim().slice(0, 60) || 'Mesa sem nome';
      const mid = id('m');
      db.mesas[mid] = { id: mid, nome, mestre: u, membros: [], code: newCode(), created: now() };
      persist();
      return stateFor(u);
    }
    if (p === '/api/mesas/join' && m === 'POST') {
      throttle(req);
      const code = String(body.code || '').trim().toUpperCase();
      const mesa = Object.values(db.mesas).find((x) => x.code === code);
      if (!mesa) { failedAttempt(req); fail(404, 'Código de mesa não encontrado.'); }
      if (!isMember(mesa, u) && mesa.convites === false) fail(403, 'Esta mesa não está aceitando jogadores novos agora.');
      if (!isMember(mesa, u)) { mesa.membros.push(u); persist(); notify(mesaPeople(mesa)); }
      return stateFor(u);
    }
    let mm = p.match(/^\/api\/mesas\/([\w-]+)(?:\/(leave|kick|code|lib))?$/);
    if (mm) {
      const mesa = getMesa(mm[1]);
      if (!isMember(mesa, u)) fail(404, 'Mesa não encontrada.');
      const act = mm[2];
      const before = mesaPeople(mesa);
      if (!act && m === 'PATCH') {
        if (!isMestre(mesa, u)) fail(403, 'Só o mestre muda a mesa.');
        if (body.nome !== undefined) mesa.nome = String(body.nome || '').trim().slice(0, 60) || mesa.nome;
        if (body.descricao !== undefined) mesa.descricao = String(body.descricao || '').slice(0, 2000);
        if (body.convites !== undefined) mesa.convites = !!body.convites;
        if (body.libAuto !== undefined) mesa.libAuto = !!body.libAuto;
      } else if (act === 'lib' && m === 'POST') {
        if (!isMestre(mesa, u)) fail(403, 'Só o mestre libera fichas.');
        for (const c of Object.values(db.chars)) if (c.mesa === mesa.id) { c.lib = !!body.lib; c.upd = now(); }
      } else if (!act && m === 'DELETE') {
        if (!isMestre(mesa, u)) fail(403, 'Só o mestre apaga a mesa.');
        detachFromMesa(mesa.id);
        delete db.mesas[mesa.id];
      } else if (act === 'leave' && m === 'POST') {
        if (isMestre(mesa, u)) fail(400, 'O mestre não sai da mesa: apague-a se quiser encerrá-la.');
        mesa.membros = mesa.membros.filter((x) => x !== u);
        detachFromMesa(mesa.id, u);
      } else if (act === 'kick' && m === 'POST') {
        if (!isMestre(mesa, u)) fail(403, 'Só o mestre remove jogadores.');
        mesa.membros = mesa.membros.filter((x) => x !== body.user);
        detachFromMesa(mesa.id, body.user);
      } else if (act === 'code' && m === 'POST') {
        if (!isMestre(mesa, u)) fail(403, 'Só o mestre vê o código.');
        mesa.code = newCode();
      } else fail(405, 'Método não permitido.');
      persist();
      notify(before);
      return stateFor(u);
    }

    // fichas
    if (p === '/api/chars' && m === 'POST') {
      const data = cleanData(body.data);
      let cid = String(body.id || '');
      if (!/^c[a-z0-9]{6,32}$/.test(cid) || db.chars[cid]) cid = id('c');
      const mesaId = checkMesaFor(u, body.mesa);
      const c = { id: cid, owner: u, mesa: mesaId, lib: libAuto(mesaId), upd: now(), data };
      db.chars[cid] = c;
      persist();
      notify(charPeople(c));
      return { id: cid, upd: c.upd };
    }
    mm = p.match(/^\/api\/chars\/([\w-]+)(?:\/(lib))?$/);
    if (mm) {
      const c = getChar(mm[1]);
      if (!canRead(c, u)) fail(404, 'Ficha não encontrada.');
      const oldMesa = c.mesa;
      if (!mm[2] && m === 'PUT') {
        if (!canWrite(c, u)) fail(403, 'Você só pode ver esta ficha.');
        c.data = cleanData(body.data);
        if (body.mesa !== undefined && body.mesa !== c.mesa) {
          if (c.owner !== u) fail(403, 'Só o dono da ficha muda a mesa.');
          c.mesa = checkMesaFor(u, body.mesa);
          c.lib = libAuto(c.mesa);
        }
        c.upd = now();
      } else if (!mm[2] && m === 'DELETE') {
        if (c.owner !== u) fail(403, 'Só o dono apaga a ficha.');
        delete db.chars[c.id];
      } else if (mm[2] === 'lib' && m === 'POST') {
        if (!isMestre(db.mesas[c.mesa], u)) fail(403, 'Só o mestre da mesa libera fichas.');
        c.lib = !!body.lib;
        c.upd = now();
      } else fail(405, 'Método não permitido.');
      persist();
      notify(charPeople(c, oldMesa));
      return { id: c.id, upd: c.upd, mesa: c.mesa, lib: !!c.lib };
    }
    fail(404, 'Rota desconhecida.');
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (ch) => {
        size += ch.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'Ficha grande demais.')); req.destroy(); return; }
        chunks.push(ch);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON inválido.')); }
      });
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
      if (req.audit) audit({ ...req.audit, status: 200 });
      if (out === undefined) return; // stream SSE
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (req.audit) audit({ ...req.audit, status });
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? 'Erro no servidor.' : e.message }));
    }
  });

  function resetPassword(name, pass) {
    const user = Object.values(db.users).find((x) => x.key === nameKey(name));
    if (!user) return false;
    Object.assign(user, hashPass(cleanPass(pass)));
    for (const [t, s] of Object.entries(db.sessions)) if (s.uid === user.id) delete db.sessions[t];
    flush();
    return true;
  }

  return { server, flush, resetPassword, db: () => db };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}

if (require.main === module) {
  const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
  const app = createApp({ dataFile });
  const args = process.argv.slice(2);
  if (args[0] === '--reset-senha') {
    if (args.length < 3) { console.log('Uso: node server.js --reset-senha "Nome do jogador" novaSenha'); process.exit(1); }
    console.log(app.resetPassword(args[1], args[2]) ? 'Senha redefinida.' : 'Jogador não encontrado.');
    process.exit(0);
  }
  const port = +process.env.PORT || 3000;
  app.server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`Fichas D&D rodando na porta ${port}.`);
    // no Docker a porta publicada pode ser outra e os IPs do container não servem para o celular
    const shown = +process.env.PUBLIC_PORT || port;
    console.log(`Neste computador: http://localhost:${shown}`);
    if (process.env.IN_DOCKER) console.log(`No celular (mesma Wi-Fi): http://<IP deste computador na rede>:${shown}`);
    else for (const ip of lanAddresses()) console.log(`No celular (mesma Wi-Fi): http://${ip}:${shown}`);
  });
  const stop = () => { app.flush(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { createApp };
