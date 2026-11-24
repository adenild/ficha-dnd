'use strict';
// Testa a wiki: regras da suíte, páginas da mesa, quem vê o quê, trechos do mestre e imagens. Rode com `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, semBlocosDoMestre } = require('../apps/fichas/server.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ficha-wiki-'));
const app = createApp({ dataFile: path.join(dir, 'db.json') });
let base;

test.before(() => new Promise((ok) => app.server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${app.server.address().port}`; ok(); })));
test.after(() => { app.server.close(); app.flush(); });

function client() {
  let cookie = '';
  return async (method, url, body, raw) => {
    const headers = { cookie, ...(raw ? { 'Content-Type': raw.type } : { 'Content-Type': 'application/json' }) };
    const r = await fetch(base + url, { method, headers, body: raw ? raw.buf : body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = r.headers.get('content-type') || '';
    return { status: r.status, type, body: type.startsWith('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}

const mestre = client(), ana = client(), fora = client();
let mesa, pagina;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

test('contas e mesa', async () => {
  await mestre('POST', '/api/register', { name: 'Mestre', pass: 'segredo1' });
  await ana('POST', '/api/register', { name: 'Ana', pass: 'segredo2' });
  await fora('POST', '/api/register', { name: 'Fora', pass: 'segredo3' });
  mesa = (await mestre('POST', '/api/mesas', { nome: 'Mesa' })).body.mesas[0];
  await ana('POST', '/api/mesas/join', { code: mesa.code });
});

test('as regras vêm com a suíte e todos leem', async () => {
  const r = await ana('GET', '/api/wiki');
  assert.equal(r.status, 200);
  const slugs = r.body.base.map((p) => p.slug);
  for (const s of ['condicoes', 'combate', 'magia', 'pericias', 'escrevendo-na-wiki']) assert.ok(slugs.includes(s), s);
  const cond = r.body.base.find((p) => p.slug === 'condicoes');
  assert.equal(cond.titulo, 'Condições');
  assert.ok(cond.resumo && !cond.texto.startsWith('---'), 'cabeçalho separado do texto');
  assert.equal((await ana('GET', '/api/wiki?base=0')).body.base, undefined, 'base=0 manda só as páginas das mesas');
  assert.equal((await client()('GET', '/api/wiki')).status, 401, 'sem conta não lê');
});

test('as condições da ficha têm uma seção cada nas regras', async () => {
  const cond = (await ana('GET', '/api/wiki')).body.base.find((p) => p.slug === 'condicoes').texto;
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const secoes = [...cond.matchAll(/^## (.+)$/gm)].map((m) => slug(m[1]));
  for (const c of ['Agarrado', 'Amedrontado', 'Atordoado', 'Caído', 'Cego', 'Contido', 'Enfeitiçado', 'Envenenado', 'Exausto', 'Incapacitado', 'Inconsciente', 'Invisível', 'Paralisado', 'Petrificado', 'Surdo']) assert.ok(secoes.includes(slug(c)), c);
});

test('só o mestre escreve; a página nasce oculta', async () => {
  assert.equal((await ana('POST', '/api/wiki', { mesa: mesa.id, titulo: 'Minha', texto: 'x' })).status, 403);
  assert.equal((await fora('POST', '/api/wiki', { mesa: mesa.id, titulo: 'Intrusa', texto: 'x' })).status, 404);
  assert.equal((await mestre('POST', '/api/wiki', { mesa: mesa.id, titulo: '  ', texto: 'x' })).status, 400, 'título obrigatório');
  const r = await mestre('POST', '/api/wiki', { mesa: mesa.id, titulo: 'Pedravela', cat: 'Lugares', texto: 'Cidade.\n\n:::mestre Segredo\nO prefeito é o vilão.\n:::\n\nFim.' });
  assert.equal(r.status, 200);
  pagina = r.body;
  assert.equal(pagina.lib, false);
  assert.equal(pagina.autor, 'Mestre');
  assert.equal((await mestre('POST', '/api/wiki', { mesa: mesa.id, titulo: 'pedravéla', texto: '' })).status, 409, 'título repetido, sem contar acento e caixa');
  assert.deepEqual((await ana('GET', '/api/wiki?base=0')).body.paginas, [], 'Ana não vê a página oculta');
  assert.equal((await ana('GET', `/api/wiki/${pagina.id}`)).status, 404);
});

test('liberada, o jogador lê sem os trechos do mestre e não edita', async () => {
  assert.equal((await mestre('PUT', `/api/wiki/${pagina.id}`, { lib: true })).status, 200);
  const vista = (await ana('GET', '/api/wiki?base=0')).body.paginas[0];
  assert.equal(vista.titulo, 'Pedravela');
  assert.ok(!vista.texto.includes('prefeito') && !vista.texto.includes(':::'), 'trecho do mestre sai do texto');
  assert.ok(vista.texto.includes('Cidade.') && vista.texto.includes('Fim.'));
  assert.ok((await mestre('GET', `/api/wiki/${pagina.id}`)).body.texto.includes('prefeito'), 'o mestre vê tudo');
  assert.equal((await ana('PUT', `/api/wiki/${pagina.id}`, { texto: 'hackeada' })).status, 403);
  assert.equal((await ana('DELETE', `/api/wiki/${pagina.id}`)).status, 403);
  assert.deepEqual((await fora('GET', '/api/wiki?base=0')).body.paginas, [], 'quem não é da mesa não vê');
});

test('blocos do mestre aninhados saem inteiros', () => {
  const t = 'a\n:::nota Caixa\nb\n:::mestre\nc\n:::nota\nd\n:::\ne\n:::\nf\n:::\ng';
  assert.equal(semBlocosDoMestre(t), 'a\n:::nota Caixa\nb\nf\n:::\ng');
  assert.equal(semBlocosDoMestre(':::MESTRE\nsegredo\n:::'), '');
  assert.equal(semBlocosDoMestre('sem fechar\n:::mestre\nsegredo'), 'sem fechar');
});

test('imagens: só o mestre envia, só a mesa vê', async () => {
  assert.equal((await ana('POST', `/api/wiki/img?mesa=${mesa.id}`, null, { type: 'image/png', buf: PNG })).status, 403);
  assert.equal((await mestre('POST', `/api/wiki/img?mesa=${mesa.id}`, null, { type: 'text/plain', buf: Buffer.from('oi') })).status, 400, 'só imagem de verdade');
  const r = await mestre('POST', `/api/wiki/img?mesa=${mesa.id}`, null, { type: 'image/png', buf: PNG });
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^\/api\/wiki\/img\/i\w+$/);
  const vista = await ana('GET', r.body.url);
  assert.equal(vista.status, 200);
  assert.equal(vista.type, 'image/png');
  assert.ok(vista.body.equals(PNG));
  assert.equal((await fora('GET', r.body.url)).status, 404, 'quem não é da mesa não vê a imagem');
});

test('página grande demais é recusada', async () => {
  assert.equal((await mestre('PUT', `/api/wiki/${pagina.id}`, { texto: 'x'.repeat(150001) })).status, 413);
});

test('apagar a mesa apaga a wiki dela', async () => {
  await mestre('DELETE', `/api/mesas/${mesa.id}`);
  assert.deepEqual((await mestre('GET', '/api/wiki?base=0')).body.paginas, []);
  assert.deepEqual(Object.keys(app.db().wikiImg), []);
});

test('listas: magias, itens mágicos e equipamento vêm completas e consistentes', async () => {
  const pegar = async (n) => (await ana('GET', '/api/wiki/dados/' + n)).body;
  const magias = await pegar('magias');
  assert.ok(magias.length > 250, `magias: ${magias.length}`);
  const ESC = ['Abjuração', 'Adivinhação', 'Conjuração', 'Encantamento', 'Evocação', 'Ilusão', 'Necromancia', 'Transmutação'];
  const CLS = ['Bardo', 'Bruxo', 'Clérigo', 'Druida', 'Feiticeiro', 'Mago', 'Paladino', 'Patrulheiro'];
  for (const x of magias) {
    for (const k of ['nome', 'en', 'escola', 'tempo', 'alcance', 'componentes', 'duracao', 'descricao', 'slug']) assert.ok(x[k], `${x.nome}: ${k}`);
    assert.ok(Number.isInteger(x.nivel) && x.nivel >= 0 && x.nivel <= 9, `${x.nome}: nível`);
    assert.ok(ESC.includes(x.escola), `${x.nome}: escola ${x.escola}`);
    assert.ok(x.classes.length && x.classes.every((c) => CLS.includes(c)), `${x.nome}: classes`);
    assert.equal(x.conc, /^Concentração/.test(x.duracao), `${x.nome}: concentração`);
  }
  assert.ok(magias.every((x, i) => !i || magias[i - 1].nivel <= x.nivel), 'ordenadas por nível');
  const itens = await pegar('itens-magicos');
  assert.ok(itens.length > 150, `itens: ${itens.length}`);
  const RAR = ['comum', 'incomum', 'raro', 'muito raro', 'lendário', 'artefato', 'varia'];
  for (const x of itens) {
    assert.ok(x.nome && x.tipo && x.descricao && x.slug, x.nome);
    assert.ok(RAR.includes(x.raridade), `${x.nome}: raridade ${x.raridade}`);
  }
  const eq = await pegar('equipamento');
  assert.ok(eq.some((x) => x.nome === 'Corda de cânhamo (15 m)' && x.peso === 5));
  for (const lista of [magias, itens, eq]) assert.equal(new Set(lista.map((x) => x.slug)).size, lista.length, 'slugs únicos');
  assert.equal((await ana('GET', '/api/wiki/dados/nada')).status, 404);
  const paginas = (await ana('GET', '/api/wiki')).body.base;
  assert.equal(paginas.find((p) => p.slug === 'lista-de-magias').lista, 'magias');
  assert.ok(paginas.some((p) => p.slug === 'antecedentes'));
});

test('listas: classes, armas e armaduras batem com as regras', async () => {
  const pegar = async (n) => (await ana('GET', '/api/wiki/dados/' + n)).body;
  const classes = await pegar('classes');
  const NOMES = ['Bárbaro', 'Bardo', 'Bruxo', 'Clérigo', 'Druida', 'Feiticeiro', 'Guerreiro', 'Ladino', 'Mago', 'Monge', 'Paladino', 'Patrulheiro'];
  assert.deepEqual(classes.map((c) => c.nome).sort(), [...NOMES].sort());
  const quadro = (await ana('GET', '/api/wiki')).body.base.find((p) => p.slug === 'classes').texto;
  const ATR = ['for', 'des', 'con', 'int', 'sab', 'car'];
  for (const c of classes) {
    assert.deepEqual(Object.keys(c.niveis).map(Number), Array.from({ length: 20 }, (_, i) => i + 1), `${c.nome}: níveis 1 a 20`);
    assert.ok(c.niveis[1].length, `${c.nome}: habilidades no 1º nível`);
    assert.ok(c.niveis[c.subclasseNivel].some((h) => h.sub), `${c.nome}: subclasse no nível ${c.subclasseNivel}`);
    assert.ok(new RegExp(`\\| ${c.nome} \\| ${c.dado} \\|`).test(quadro), `${c.nome}: dado de vida igual ao quadro da wiki`);
    assert.ok(c.salvaguardas.length === 2 && c.salvaguardas.every((a) => ATR.includes(a)), `${c.nome}: salvaguardas`);
    assert.ok([null, 'completo', 'meio', 'pacto'].includes(c.conjuracao), `${c.nome}: conjuração`);
    assert.ok(!c.conjuracao || ATR.includes(c.atributoMagia), `${c.nome}: atributo de magia`);
    for (const k of ['truques', 'conhecidas']) if (c[k]) assert.ok(c[k].length === 20 && c[k].every((v, i) => !i || v >= c[k][i - 1]), `${c.nome}: ${k}`);
    assert.ok(c.asi.every((n) => n >= 1 && n <= 20), `${c.nome}: aumentos de atributo`);
  }
  const armaduras = await pegar('armaduras'), armas = await pegar('armas');
  const tab = (slug) => (paginas) => paginas.find((p) => p.slug === slug).texto;
  const paginas = (await ana('GET', '/api/wiki')).body.base;
  for (const a of armaduras) assert.ok(tab('armaduras')(paginas).includes(`| ${a.nome} |`), `armadura ${a.nome} está na tabela`);
  for (const a of armas) assert.ok(tab('armas')(paginas).includes(`| ${a.nome} |`), `arma ${a.nome} está na tabela`);
  assert.equal(armaduras.find((a) => a.nome === 'Cota de malha').ca, 16);
});

test('os links entre as regras apontam para páginas e seções que existem', async () => {
  const paginas = (await ana('GET', '/api/wiki')).body.base;
  const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[*_`[\]]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const dados = {};
  for (const n of ['magias', 'itens-magicos', 'equipamento']) dados[n] = (await ana('GET', '/api/wiki/dados/' + n)).body;
  const lista = { 'lista-de-magias': 'magias', 'itens-magicos': 'itens-magicos', 'equipamento-de-aventura': 'equipamento' };
  const quebrados = [];
  const textos = [...paginas.map((p) => [p.slug, p.texto]), ...dados.equipamento.filter((x) => x.descricao).map((x) => ['equipamento-de-aventura', x.descricao])];
  for (const [de, texto] of textos) {
    const semCodigo = texto.replace(/```[\s\S]*?```/g, '').replace(/(`+)[\s\S]*?\1/g, ''); // exemplos de sintaxe não são links
    for (const [, alvo] of semCodigo.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
      const [nome, anc] = alvo.split('#');
      const p = nome ? paginas.find((x) => x.slug === nome.trim()) : paginas.find((x) => x.slug === de);
      if (!p) { quebrados.push(`${de} → ${alvo}`); continue; }
      if (!anc) continue;
      const secoes = [...p.texto.matchAll(/^#{1,6}\s+(.*?)\s*$/gm)].map((m) => slug(m[1]));
      const entradas = p.lista ? dados[lista[p.slug]].map((x) => x.slug) : [];
      if (!secoes.includes(slug(anc)) && !entradas.includes(slug(anc))) quebrados.push(`${de} → ${alvo}`);
    }
  }
  assert.deepEqual(quebrados, []);
});
