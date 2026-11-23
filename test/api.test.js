'use strict';
// Testa as regras de acesso da API: rode com `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ficha-'));
const app = createApp({ dataFile: path.join(dir, 'db.json') });
let base;

test.before(() => new Promise((ok) => app.server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${app.server.address().port}`; ok(); })));
test.after(() => { app.server.close(); app.flush(); });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

const mestre = client(), ana = client(), bruno = client(), intruso = client();
let mesa, fichaAna, fichaBruno;

test('cadastro e login', async () => {
  assert.equal((await mestre('POST', '/api/register', { name: 'Mestre', pass: 'segredo1' })).status, 200);
  assert.equal((await ana('POST', '/api/register', { name: 'Ana', pass: 'segredo2' })).status, 200);
  assert.equal((await bruno('POST', '/api/register', { name: 'Bruno', pass: 'segredo3' })).status, 200);
  assert.equal((await intruso('POST', '/api/register', { name: 'ana', pass: 'outra123' })).status, 409, 'nome repetido');
  assert.equal((await intruso('POST', '/api/login', { name: 'Ana', pass: 'errada' })).status, 401);
  assert.equal((await intruso('GET', '/api/state')).status, 401, 'sem login não vê nada');
});

test('mestre cria mesa e jogadores entram com o código', async () => {
  const st = (await mestre('POST', '/api/mesas', { nome: 'Mesa de quinta' })).body;
  mesa = st.mesas[0];
  assert.ok(mesa.code);
  assert.equal((await ana('POST', '/api/mesas/join', { code: mesa.code.toLowerCase() })).status, 200);
  const sb = (await bruno('POST', '/api/mesas/join', { code: mesa.code })).body;
  assert.equal(sb.mesas[0].code, undefined, 'jogador não vê o código');
  assert.equal((await bruno('PATCH', `/api/mesas/${mesa.id}`, { nome: 'Hackeada' })).status, 403);
});

test('fichas ocultas só para o dono e o mestre', async () => {
  fichaAna = (await ana('POST', '/api/chars', { id: 'cana123456', data: { name: 'Thorin', ab: {} }, mesa: mesa.id })).body.id;
  fichaBruno = (await bruno('POST', '/api/chars', { data: { name: 'Bree', ab: {} }, mesa: mesa.id })).body.id;
  const vb = (await bruno('GET', '/api/state')).body.chars.map((c) => c.data.name);
  assert.deepEqual(vb, ['Bree'], 'Bruno não vê Thorin');
  const vm = (await mestre('GET', '/api/state')).body.chars.map((c) => c.data.name).sort();
  assert.deepEqual(vm, ['Bree', 'Thorin'], 'mestre vê tudo da mesa');
  assert.equal((await bruno('PUT', `/api/chars/${fichaAna}`, { data: { name: 'x' } })).status, 404);
  assert.equal((await bruno('POST', `/api/chars/${fichaAna}/lib`, { lib: true })).status, 404);
});

test('mestre libera, jogador vê mas não edita', async () => {
  assert.equal((await ana('POST', `/api/chars/${fichaAna}/lib`, { lib: true })).status, 403, 'dono não se libera');
  assert.equal((await mestre('POST', `/api/chars/${fichaAna}/lib`, { lib: true })).status, 200);
  const vb = (await bruno('GET', '/api/state')).body.chars.map((c) => c.data.name).sort();
  assert.deepEqual(vb, ['Bree', 'Thorin']);
  assert.equal((await bruno('PUT', `/api/chars/${fichaAna}`, { data: { name: 'x' } })).status, 403);
  assert.equal((await mestre('PUT', `/api/chars/${fichaAna}`, { data: { name: 'Thorin', xp: 900 } })).status, 200, 'mestre edita');
  const a = (await ana('GET', '/api/state')).body.chars.find((c) => c.id === fichaAna);
  assert.equal(a.data.xp, 900);
});

test('trocar de mesa volta a ocultar; sair da mesa tira a ficha dela', async () => {
  assert.equal((await mestre('PUT', `/api/chars/${fichaAna}`, { data: { name: 'Thorin' }, mesa: '' })).status, 403, 'mestre não move ficha alheia');
  await ana('PUT', `/api/chars/${fichaAna}`, { data: { name: 'Thorin' }, mesa: '' });
  assert.equal((await bruno('GET', '/api/state')).body.chars.length, 1);
  await ana('PUT', `/api/chars/${fichaAna}`, { data: { name: 'Thorin' }, mesa: mesa.id });
  assert.equal((await bruno('GET', '/api/state')).body.chars.length, 1, 'volta oculta');
  await bruno('POST', `/api/mesas/${mesa.id}/leave`);
  assert.equal((await mestre('GET', '/api/state')).body.chars.some((c) => c.id === fichaBruno), false, 'mestre deixa de ver');
  assert.equal((await bruno('PUT', `/api/chars/${fichaBruno}`, { data: { name: 'Bree' }, mesa: mesa.id })).status, 403, 'não volta sem código');
});

test('estado persiste em disco', async () => {
  app.flush();
  const again = createApp({ dataFile: path.join(dir, 'db.json') });
  assert.ok(Object.keys(again.db().chars).length >= 2);
  assert.ok(again.resetPassword('Ana', 'novaSenha'));
});
