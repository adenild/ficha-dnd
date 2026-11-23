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

test('token de conta: usar, pausar, remover e auditar', async () => {
  const novo = await mestre('POST', '/api/tokens', { nome: 'Claude' });
  assert.equal(novo.status, 200);
  const raw = novo.body.token;
  assert.match(raw, /^fdnd_/);
  const bearer = (method, url, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + raw }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  const st = await bearer('GET', '/api/state');
  assert.equal(st.status, 200);
  assert.equal(st.body.me.name, 'Mestre', 'o token age como o dono');
  assert.equal((await bearer('PUT', `/api/chars/${fichaAna}`, { data: { name: 'Lyra', hp: { cur: 5 } } })).status, 200, 'mestre edita ficha da mesa pelo token');
  assert.equal((await bearer('POST', '/api/tokens', { nome: 'outro' })).status, 403, 'token não cria tokens');
  assert.equal((await bearer('POST', '/api/password', { old: 'segredo1', pass: 'qualquer1' })).status, 403, 'token não troca senha');

  const lista = (await mestre('GET', '/api/tokens')).body.tokens;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].hash, undefined, 'o hash não sai da API');
  assert.equal(lista[0].token, undefined, 'o token não aparece de novo');
  assert.ok(lista[0].usado, 'registra o último uso');

  assert.equal((await mestre('PATCH', `/api/tokens/${novo.body.id}`, { pausado: true })).status, 200);
  assert.equal((await bearer('GET', '/api/state')).status, 403, 'token pausado é recusado');
  await mestre('PATCH', `/api/tokens/${novo.body.id}`, { pausado: false });
  assert.equal((await bearer('GET', '/api/state')).status, 200, 'retomado volta a funcionar');
  assert.equal((await ana('GET', '/api/tokens')).body.tokens.length, 0, 'cada um vê só os próprios tokens');
  assert.equal((await ana('DELETE', `/api/tokens/${novo.body.id}`)).status, 404);

  const reg = (await mestre('GET', `/api/audit?token=${novo.body.id}`)).body.registros;
  assert.ok(reg.some((e) => e.acao.startsWith('Alterou a ficha ') && e.acao.length > 16 && e.status === 200), 'auditoria nomeia a ficha');
  assert.ok(reg.some((e) => e.status === 403 && e.acao === 'Consultou fichas e mesas'), 'tentativa com token pausado fica registrada');
  const todos = (await mestre('GET', '/api/audit')).body.registros;
  assert.ok(todos.some((e) => e.via === 'conta' && e.acao === 'Pausou o token Claude'));
  assert.equal((await ana('GET', '/api/audit')).body.registros.length, 0, 'auditoria é só do dono');

  assert.equal((await mestre('DELETE', `/api/tokens/${novo.body.id}`)).status, 200);
  assert.equal((await bearer('GET', '/api/state')).status, 401, 'token removido para de funcionar');
});

test('preferências e nome da conta', async () => {
  const st = (await bruno('PATCH', '/api/me', { prefs: { tema: 'escuro', abrirTravada: false, abaInicial: 'combate' } })).body;
  assert.deepEqual(st.me.prefs, { tema: 'escuro', abrirTravada: false, abaInicial: 'combate' });
  assert.equal((await bruno('PATCH', '/api/me', { prefs: { tema: 'roxo' } })).body.me.prefs.tema, 'escuro', 'valor inválido é ignorado');
  assert.equal((await bruno('PATCH', '/api/me', { name: 'ana' })).status, 409, 'nome de outra conta');
  assert.equal((await bruno('PATCH', '/api/me', { name: 'Bruno Silva' })).body.me.name, 'Bruno Silva');
  const outro = client();
  assert.equal((await outro('POST', '/api/login', { name: 'bruno silva', pass: 'segredo3' })).status, 200, 'entra com o nome novo');
  assert.equal((await bruno('POST', '/api/sessions/sair-outras')).body.encerradas, 1);
  assert.equal((await outro('GET', '/api/state')).status, 401, 'a outra sessão caiu');
  assert.equal((await bruno('GET', '/api/state')).status, 200, 'a sessão atual continua');
});

test('configurações da mesa', async () => {
  const st = (await mestre('POST', '/api/mesas', { nome: 'Mesa de sábado' })).body;
  const nova = st.mesas.find((m) => m.nome === 'Mesa de sábado');
  assert.equal(nova.convites, true);
  assert.equal(nova.libAuto, false);
  await mestre('PATCH', `/api/mesas/${nova.id}`, { descricao: 'Sábados às 20h', convites: false, libAuto: true });
  assert.equal((await bruno('POST', '/api/mesas/join', { code: nova.code })).status, 403, 'convites fechados');
  await mestre('PATCH', `/api/mesas/${nova.id}`, { convites: true });
  const sb = (await bruno('POST', '/api/mesas/join', { code: nova.code })).body;
  const vista = sb.mesas.find((m) => m.id === nova.id);
  assert.equal(vista.descricao, 'Sábados às 20h', 'jogador vê a descrição');
  assert.equal(vista.convites, undefined, 'jogador não vê as opções do mestre');
  assert.equal((await bruno('PATCH', `/api/mesas/${nova.id}`, { libAuto: false })).status, 403);

  const f = (await bruno('POST', '/api/chars', { data: { name: 'Kael' }, mesa: nova.id })).body;
  assert.ok((await mestre('GET', '/api/state')).body.chars.find((c) => c.id === f.id).lib, 'ficha nova entra liberada');
  await mestre('POST', `/api/mesas/${nova.id}/lib`, { lib: false });
  assert.equal((await mestre('GET', '/api/state')).body.chars.find((c) => c.id === f.id).lib, false, 'ocultar todas');
  assert.equal((await intruso('POST', `/api/mesas/${nova.id}/lib`, { lib: true })).status, 401);
});
