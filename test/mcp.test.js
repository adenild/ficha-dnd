'use strict';
// Testa o servidor MCP de ponta a ponta: sobe a API, liga mcp.js por stdio e chama as ferramentas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createApp } = require('../server.js');
const { createMapas } = require('../mapas/server.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ficha-mcp-'));
const app = createApp({ dataFile: path.join(dir, 'db.json') });
let base, proc, ana, mapas, nextId = 1, buf = '';
const waiting = new Map();
const mapasBase = () => `http://127.0.0.1:${mapas.server.address().port}`;

function rpc(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((ok) => waiting.set(id, ok));
}
async function tool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.result.content[0].text;
  return r.result.isError ? { erro: text } : JSON.parse(text);
}
async function post(url, body, cookie = '') {
  const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  return { cookie: (r.headers.get('set-cookie') || '').split(';')[0], body: await r.json() };
}

test.before(async () => {
  await new Promise((ok) => app.server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${app.server.address().port}`;
  const mestre = await post('/api/register', { name: 'Mestre', pass: 'segredo1' });
  ana = await post('/api/register', { name: 'Ana', pass: 'segredo2' });
  const ficha = await post('/api/chars', { data: { name: 'Thorin', level: 3, ab: { con: 14 }, hp: { max: 20, cur: 20, tmp: 0 } } }, ana.cookie);
  ana.fichaId = ficha.body.id;
  const token = (await post('/api/tokens', { nome: 'MCP de teste' }, mestre.cookie)).body.token;
  mapas = createMapas({ dataFile: path.join(dir, 'mapas.json'), fichaUrl: base });
  await new Promise((ok) => mapas.server.listen(0, '127.0.0.1', ok));
  const mapasUrl = `http://127.0.0.1:${mapas.server.address().port}`;
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'mcp.js')], { env: { ...process.env, FICHA_URL: base, FICHA_TOKEN: token, MAPAS_URL: mapasUrl } });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (ch) => {
    buf += ch; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); }
  });
});
test.after(() => { proc.kill(); mapas.server.close(); mapas.flush(); app.server.close(); app.flush(); });

test('handshake e lista de ferramentas', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const names = (await rpc('tools/list')).result.tools.map((t) => t.name);
  for (const n of ['estado', 'ver_ficha', 'criar_ficha', 'editar_ficha', 'acao_ficha', 'rolar', 'liberar_ficha', 'apagar_ficha', 'mesa', 'ver_mapa', 'gerenciar_mapa', 'pintar_mapa', 'colocar_token', 'mover_token', 'editar_token', 'medir']) assert.ok(names.includes(n), n);
  assert.equal((await rpc('metodo/inexistente')).error.code, -32601);
});

test('mesas e fichas respeitam as regras do app', async () => {
  const m = await tool('mesa', { acao: 'criar', nome: 'Mesa de teste' });
  const code = m.mesas[0].codigo;
  assert.ok(code);
  assert.deepEqual((await tool('estado', {})).fichas, [], 'mestre não vê ficha fora da mesa');
  await fetch(base + '/api/mesas/join', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ana.cookie }, body: JSON.stringify({ code }) });
  await fetch(base + `/api/chars/${ana.fichaId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: ana.cookie }, body: JSON.stringify({ data: { name: 'Thorin', level: 3, ab: { con: 14 }, hp: { max: 20, cur: 20, tmp: 0 } }, mesa: m.mesas[0].id }) });
  const st = await tool('estado', {});
  assert.equal(st.fichas[0].nome, 'Thorin');
  assert.equal(st.fichas[0].mesa, 'Mesa de teste');
  assert.match((await tool('apagar_ficha', { ficha: 'thorin' })).erro, /dono/, 'mestre não apaga ficha alheia');
  assert.equal((await tool('liberar_ficha', { ficha: 'Thorin', liberada: true })).liberada, true);
});

test('ações de jogo seguem as regras da ficha', async () => {
  await tool('acao_ficha', { ficha: 'Thorin', acao: 'pv_temporarios', valor: 5 });
  const d = await tool('acao_ficha', { ficha: 'Thorin', acao: 'dano', valor: 8 });
  assert.equal(d.pv, '17/20', 'temporários absorvem primeiro');
  await tool('acao_ficha', { ficha: 'Thorin', acao: 'adicionar_condicao', condicao: 'envenenado' });
  const f = await tool('ver_ficha', { ficha: 'Thorin' });
  assert.deepEqual(f.dados.cond, ['Envenenado']);
  assert.equal(f.calculado.proficiencia, '+2');
  assert.equal(f.calculado.salvaguardas.con, '+2');
  await tool('acao_ficha', { ficha: 'Thorin', acao: 'descanso_longo' });
  assert.equal((await tool('ver_ficha', { ficha: 'Thorin' })).dados.hp.cur, 20);
});

test('editar mescla objetos e criar usa padrões', async () => {
  await tool('editar_ficha', { ficha: 'Thorin', alteracoes: { hp: { max: 25 }, atk: [{ n: 'Machado', b: '+5', d: '1d8+3', t: 'cortante' }] } });
  const f = await tool('ver_ficha', { ficha: 'Thorin' });
  assert.equal(f.dados.hp.max, 25);
  assert.equal(f.dados.hp.cur, 20, 'o resto do objeto fica');
  const nova = await tool('criar_ficha', { dados: { name: 'Goblin', ab: { des: 14 } }, mesa: 'Mesa de teste' });
  assert.equal(nova.mesa, 'Mesa de teste');
  assert.equal((await tool('ver_ficha', { ficha: 'Goblin' })).dados.ab.for, 10);
  assert.ok((await tool('apagar_ficha', { ficha: 'Goblin' })).apagada);
});

test('rolagens', async () => {
  const x = await tool('rolar', { expressao: '2d6+3' });
  assert.ok(x.total >= 5 && x.total <= 15);
  const a = await tool('rolar', { ficha: 'Thorin', teste: 'ataque:machado', modo: 'vantagem' });
  assert.equal(a.d20.length, 2);
  assert.ok(a.dano >= 4);
  const p = await tool('rolar', { ficha: 'Thorin', teste: 'pericia:Percepção', vezes: 3 });
  assert.equal(p.length, 3);
  assert.ok((await tool('rolar', { expressao: 'abc' })).erro);
});

test('mapas: o mestre monta o encontro e move os tokens', async () => {
  assert.deepEqual((await tool('ver_mapa', {})).mapas, []);
  const m = await tool('gerenciar_mapa', { acao: 'criar', mesa: 'Mesa de teste', nome: 'Cripta', largura: 12, altura: 10, terreno: 'pedra' });
  assert.equal(m.visivel_para_jogadores, false);
  assert.match(m.tamanho, /A1 a L10/);
  const p = await tool('pintar_mapa', { mapa: 'cripta', areas: [{ de: 'A1', ate: 'L10', terreno: 'parede', contorno: true }, { de: 'F10', terreno: 'porta' }] });
  assert.equal(p.quadrados_pintados, 12 * 2 + 8 * 2 + 1);
  assert.match((await tool('pintar_mapa', { mapa: 'Cripta', areas: [{ de: 'Z99', terreno: 'lava' }] })).erro, /fora do mapa/);
  assert.match((await tool('pintar_mapa', { mapa: 'Cripta', areas: [{ de: 'B2', terreno: 'gelo' }] })).erro, /desconhecido/);

  await tool('criar_ficha', { dados: { name: 'Esqueleto', ac: 13, hp: { max: 13, cur: 13 } }, mesa: 'Mesa de teste' });
  const t1 = await tool('colocar_token', { mapa: 'Cripta', ficha: 'Thorin', posicao: 'C3' });
  assert.equal(t1.token.posicao, 'C3');
  assert.equal(t1.token.tipo, 'pj');
  assert.equal(t1.token.pv, '20/25', 'o mestre lê a ficha do jogador');
  const t2 = await tool('colocar_token', { mapa: 'Cripta', ficha: 'esqueleto', posicao: 'h7', oculto: true });
  assert.equal(t2.token.tipo, 'inimigo');
  assert.equal(t2.token.oculto, true);
  await tool('colocar_token', { mapa: 'Cripta', nome: 'Sarcófago', posicao: 'J2', tamanho: 2 });

  const v = await tool('ver_mapa', { mapa: 'Cripta' });
  const linhas = v.grade.split('\n');
  assert.match(linhas[0], /^ {4}A B C/);
  assert.equal(linhas[1].trim().split(/\s+/).slice(1).join(''), 'pppppppppppp', 'linha 1 é parede');
  assert.equal(linhas[3].trim().split(/\s+/)[3], '1', 'Thorin é a marca 1 em C3');
  assert.equal(v.tokens.find((t) => t.nome === 'Sarcófago').ocupa, 'J2 a K3');

  const d = await tool('medir', { mapa: 'Cripta', de: 'Thorin', ate: 'Esqueleto' });
  assert.equal(d.quadrados, 5);
  assert.equal(d.metros, '7,5 m');
  const mv = await tool('mover_token', { mapa: 'Cripta', token: 'Thorin', posicao: 'G6' });
  assert.equal(mv.andou, '4 quadrados (6 m)');
  assert.equal((await tool('medir', { mapa: 'Cripta', de: 'Thorin', ate: 'Esqueleto' })).corpo_a_corpo, true);
  assert.equal((await tool('medir', { mapa: 'Cripta', de: 'Sarcófago', ate: 'I2' })).quadrados, 1, 'token grande conta da borda');

  // a jogadora só vê o mapa depois de mostrado, e sem o esqueleto oculto
  const anaMapas = () => fetch(mapasBase() + '/api/state', { headers: { cookie: ana.cookie } }).then((r) => r.json());
  assert.deepEqual((await anaMapas()).mapas, []);
  await tool('gerenciar_mapa', { acao: 'mostrar', mapa: 'Cripta' });
  const mid = (await anaMapas()).mapas[0].id;
  const visto = await fetch(mapasBase() + '/api/mapas/' + mid, { headers: { cookie: ana.cookie } }).then((r) => r.json());
  assert.deepEqual(visto.tokens.map((t) => t.nome).sort(), ['Sarcófago', 'Thorin']);
  await tool('editar_token', { mapa: 'Cripta', token: 'Esqueleto', oculto: false, nome: 'Vulto' });
  assert.equal((await fetch(mapasBase() + '/api/mapas/' + mid, { headers: { cookie: ana.cookie } }).then((r) => r.json())).tokens.length, 3);
  assert.ok((await tool('editar_token', { mapa: 'Cripta', token: 'Vulto', remover: true })).removido);
  assert.equal((await tool('ver_mapa', { mapa: 'Cripta', grade: false })).tokens.length, 2);
});

