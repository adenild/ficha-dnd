'use strict';
// Testa o serviço de mapas junto com o app de fichas: identidade, regras de acesso, tokens e imagem de fundo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server.js');
const { createMapas } = require('../mapas/server.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ficha-mapas-'));
const fichas = createApp({ dataFile: path.join(dir, 'db.json') });
let fichaBase, base, mapas;

test.before(async () => {
  await new Promise((ok) => fichas.server.listen(0, '127.0.0.1', ok));
  fichaBase = `http://127.0.0.1:${fichas.server.address().port}`;
  mapas = createMapas({ dataFile: path.join(dir, 'mapas.json'), fichaUrl: fichaBase });
  await new Promise((ok) => mapas.server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${mapas.server.address().port}`;
});
test.after(() => { mapas.server.close(); fichas.server.close(); mapas.flush(); fichas.flush(); });

// um jogador: entra no app de fichas e usa o mesmo cookie nos dois serviços
function pessoa() {
  const me = { cookie: '' };
  me.ficha = async (method, url, body) => {
    const r = await fetch(fichaBase + url, { method, headers: { 'Content-Type': 'application/json', cookie: me.cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) me.cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  me.mapa = async (method, url, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const r = await fetch(base + url, { method, headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', cookie: me.cookie + '; outro=nao-repassa', ...headers }, body: body ? (raw ? body : JSON.stringify(body)) : undefined });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return me;
}

const mestre = pessoa(), ana = pessoa(), bruno = pessoa(), intruso = pessoa();
let mesa, fichaAna, fichaBruno, goblin, mapa;

test('identifica pela sessão do app de fichas', async () => {
  assert.equal((await mestre.mapa('GET', '/api/state')).status, 401, 'sem sessão não entra');
  await mestre.ficha('POST', '/api/register', { name: 'Mestre', pass: 'segredo1' });
  await ana.ficha('POST', '/api/register', { name: 'Ana', pass: 'segredo2' });
  await bruno.ficha('POST', '/api/register', { name: 'Bruno', pass: 'segredo3' });
  await intruso.ficha('POST', '/api/register', { name: 'Intruso', pass: 'segredo4' });
  mesa = (await mestre.ficha('POST', '/api/mesas', { nome: 'A Mina Perdida' })).body.mesas[0];
  await ana.ficha('POST', '/api/mesas/join', { code: mesa.code });
  await bruno.ficha('POST', '/api/mesas/join', { code: mesa.code });
  fichaAna = (await ana.ficha('POST', '/api/chars', { data: { name: 'Thorin', hp: { max: 20, cur: 20 } }, mesa: mesa.id })).body.id;
  fichaBruno = (await bruno.ficha('POST', '/api/chars', { data: { name: 'Bree', hp: { max: 12, cur: 12 } }, mesa: mesa.id })).body.id;
  goblin = (await mestre.ficha('POST', '/api/chars', { data: { name: 'Goblin 1', hp: { max: 7, cur: 7 }, ac: 15 }, mesa: mesa.id })).body.id;

  const st = (await ana.mapa('GET', '/api/state')).body;
  assert.equal(st.me.name, 'Ana');
  assert.equal(st.mesas[0].souMestre, false);
  assert.deepEqual(st.fichas.map((c) => c.nome), ['Thorin'], 'Ana não vê o goblin oculto nem a ficha do Bruno');
  const sm = (await mestre.mapa('GET', '/api/state')).body;
  assert.equal(sm.mesas[0].souMestre, true);
  assert.equal(sm.fichas.length, 3);
});

test('só o mestre cria e edita mapas; mapa oculto não aparece para jogadores', async () => {
  assert.equal((await ana.mapa('POST', '/api/mapas', { mesa: mesa.id, nome: 'Hack' })).status, 403);
  assert.equal((await intruso.mapa('POST', '/api/mapas', { mesa: mesa.id })).status, 404);
  const r = await mestre.mapa('POST', '/api/mapas', { mesa: mesa.id, nome: 'Entrada da mina', cols: 10, rows: 8 });
  assert.equal(r.status, 200);
  mapa = r.body;
  assert.equal(mapa.tiles.length, 80);
  assert.equal((await ana.mapa('GET', '/api/mapas/' + mapa.id)).status, 404, 'ainda não foi mostrado');
  assert.deepEqual((await ana.mapa('GET', '/api/state')).body.mapas, []);
  assert.equal((await ana.mapa('PATCH', '/api/mapas/' + mapa.id, { nome: 'x' })).status, 404);

  const tiles = 'p'.repeat(10) + 'c'.repeat(70);
  assert.equal((await mestre.mapa('PATCH', '/api/mapas/' + mapa.id, { tiles: 'x'.repeat(80) })).status, 400, 'terreno desconhecido');
  assert.equal((await mestre.mapa('PATCH', '/api/mapas/' + mapa.id, { tiles: 'c' })).status, 400, 'tamanho errado');
  assert.equal((await mestre.mapa('PATCH', '/api/mapas/' + mapa.id, { tiles })).body.tiles, tiles);
  const v = (await mestre.mapa('PATCH', '/api/mapas/' + mapa.id, { mostrar: true })).body;
  assert.ok(v.visivel && v.mostrado);
  assert.equal((await ana.mapa('GET', '/api/mapas/' + mapa.id)).status, 200);
  assert.equal((await ana.mapa('PATCH', '/api/mapas/' + mapa.id, { nome: 'x' })).status, 403);
  assert.equal((await intruso.mapa('GET', '/api/mapas/' + mapa.id)).status, 404, 'quem não é da mesa não vê');
});

test('tokens das fichas: mestre coloca, jogador move só o seu', async () => {
  let v = (await mestre.mapa('POST', `/api/mapas/${mapa.id}/tokens`, { ficha: fichaAna, x: 1, y: 1 })).body;
  const tAna = v.tokens.at(-1);
  assert.equal(tAna.tipo, 'pj');
  v = (await mestre.mapa('POST', `/api/mapas/${mapa.id}/tokens`, { ficha: goblin, x: 50, y: 50, oculto: true })).body;
  const tGob = v.tokens.at(-1);
  assert.equal(tGob.tipo, 'inimigo', 'ficha do mestre vira inimigo');
  assert.deepEqual([tGob.x, tGob.y], [9, 7], 'fica dentro do mapa');
  assert.equal((await mestre.mapa('POST', `/api/mapas/${mapa.id}/tokens`, { ficha: 'cnaoexiste' })).status, 404);

  const va = (await ana.mapa('GET', '/api/mapas/' + mapa.id)).body;
  assert.deepEqual(va.tokens.map((t) => t.nome), ['Thorin'], 'token oculto não vai para o jogador');
  assert.equal((await ana.mapa('PATCH', `/api/mapas/${mapa.id}/tokens/${tAna.id}`, { x: 3, y: 2, oculto: true, nome: 'X' })).status, 200);
  const moved = (await mestre.mapa('GET', '/api/mapas/' + mapa.id)).body.tokens.find((t) => t.id === tAna.id);
  assert.deepEqual([moved.x, moved.y, moved.oculto, moved.nome], [3, 2, false, 'Thorin'], 'jogador só muda a posição');
  assert.equal((await bruno.mapa('PATCH', `/api/mapas/${mapa.id}/tokens/${tAna.id}`, { x: 0 })).status, 403, 'Bruno não move o Thorin');
  assert.equal((await ana.mapa('PATCH', `/api/mapas/${mapa.id}/tokens/${tGob.id}`, { x: 0 })).status, 404, 'nem acha o token oculto');
  assert.equal((await bruno.mapa('POST', `/api/mapas/${mapa.id}/tokens`, { nome: 'Livre' })).status, 403, 'token livre é do mestre');
  assert.equal((await bruno.mapa('POST', `/api/mapas/${mapa.id}/tokens`, { ficha: fichaAna })).status, 404, 'ficha de outro, que ele nem vê');
  assert.equal((await bruno.mapa('POST', `/api/mapas/${mapa.id}/tokens`, { ficha: fichaBruno, x: 2, y: 2 })).status, 200, 'a própria ficha pode');
  assert.equal((await bruno.mapa('POST', `/api/mapas/${mapa.id}/tokens`, { ficha: fichaBruno })).status, 409, 'uma vez só');
});

test('saúde do monstro chega aos jogadores, os números não', async () => {
  await mestre.mapa('PATCH', `/api/mapas/${mapa.id}`, {}); // nada muda
  const gob = (await mestre.mapa('GET', '/api/mapas/' + mapa.id)).body.tokens.find((t) => t.ficha === goblin);
  await mestre.mapa('PATCH', `/api/mapas/${mapa.id}/tokens/${gob.id}`, { oculto: false, nome: 'Vulto' });
  const ficha = (await mestre.ficha('GET', '/api/state')).body.chars.find((c) => c.id === goblin);
  await mestre.ficha('PUT', '/api/chars/' + goblin, { data: { ...ficha.data, hp: { max: 7, cur: 2 } } });
  await mestre.mapa('GET', '/api/state'); // o mestre consultando atualiza a saúde
  const t = (await ana.mapa('GET', '/api/mapas/' + mapa.id)).body.tokens.find((x) => x.ficha === goblin);
  assert.equal(t.saude, 'muito ferido');
  assert.equal(t.nome, 'Vulto', 'o nome que o mestre deu fica');
  assert.equal(t.fnome, undefined, 'o nome da ficha não vaza');
  assert.equal(t.hp, undefined);
});

test('redimensionar mantém o terreno e puxa os tokens para dentro', async () => {
  const v = (await mestre.mapa('PATCH', `/api/mapas/${mapa.id}`, { cols: 4, rows: 3 })).body;
  assert.equal(v.tiles, 'pppp' + 'cccc' + 'cccc');
  assert.ok(v.tokens.every((t) => t.x <= 3 && t.y <= 2));
});

test('imagem de fundo: só imagem de verdade, só para quem vê o mapa', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010018dd8db40000000049454e44ae426082', 'hex');
  assert.equal((await ana.mapa('PUT', `/api/mapas/${mapa.id}/fundo`, png)).status, 403);
  assert.equal((await mestre.mapa('PUT', `/api/mapas/${mapa.id}/fundo`, Buffer.from('<svg onload=alert(1)>'))).status, 400);
  const v = (await mestre.mapa('PUT', `/api/mapas/${mapa.id}/fundo`, png)).body;
  assert.ok(v.fundo.v);
  const img = await ana.mapa('GET', `/api/mapas/${mapa.id}/fundo`);
  assert.equal(img.status, 200);
  assert.ok(img.body.equals(png));
  assert.equal((await intruso.mapa('GET', `/api/mapas/${mapa.id}/fundo`)).status, 404);
});

test('token de conta funciona no lugar do cookie', async () => {
  const token = (await mestre.ficha('POST', '/api/tokens', { nome: 'Mapas' })).body.token;
  const r = await fetch(base + '/api/state', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).me.name, 'Mestre');
  const bad = await fetch(base + '/api/state', { headers: { Authorization: 'Bearer fdnd_errado' } });
  assert.equal(bad.status, 401);
});

test('apagar mapa', async () => {
  assert.equal((await ana.mapa('DELETE', '/api/mapas/' + mapa.id)).status, 403);
  assert.equal((await mestre.mapa('DELETE', '/api/mapas/' + mapa.id)).status, 200);
  assert.equal((await mestre.mapa('GET', '/api/mapas/' + mapa.id)).status, 404);
});
