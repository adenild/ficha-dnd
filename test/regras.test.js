'use strict';
// Testa as regras de nível e equipamento (apps/fichas/public/regras.js). Rode com `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../apps/fichas/public/regras.js');

const dados = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/fichas/wiki/dados', n + '.json'), 'utf8'));
const classes = dados('classes'), armaduras = dados('armaduras'), armas = dados('armas');
const cl = (id) => classes.find((c) => c.id === id);
const ficha = (o = {}) => ({ name: 'Teste', cls: '', level: 1, xp: 0, ab: { for: 10, des: 14, con: 14, int: 16, sab: 12, car: 10 }, hp: { max: 8, cur: 8, tmp: 0 }, hd: { die: 'd6', used: 0 }, slots: [], spells: [], items: [], feats: '', ...o });

test('experiência e proficiência', () => {
  assert.equal(R.nivelPorXp(0), 1);
  assert.equal(R.nivelPorXp(299), 1);
  assert.equal(R.nivelPorXp(300), 2);
  assert.equal(R.nivelPorXp(6500), 5);
  assert.equal(R.nivelPorXp(999999), 20);
  assert.equal(R.xpDoNivel(6), 14000);
  assert.deepEqual([1, 4, 5, 9, 13, 17, 20].map(R.prof), [2, 2, 3, 4, 5, 6, 6]);
  assert.equal(R.podeSubir(ficha({ xp: 299 })), false);
  assert.equal(R.podeSubir(ficha({ xp: 300 })), true);
  assert.equal(R.podeSubir(ficha({ nivelLib: 1 })), true, 'nível concedido pelo mestre');
  assert.equal(R.podeSubir(ficha({ level: 20, xp: 999999, nivelLib: 3 })), false);
});

test('espaços de magia por tipo de conjurador', () => {
  assert.deepEqual(R.espacosPara(cl('mago'), 1), [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(R.espacosPara(cl('mago'), 5), [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(R.espacosPara(cl('clerigo'), 20), [4, 3, 3, 3, 3, 2, 2, 1, 1]);
  assert.deepEqual(R.espacosPara(cl('paladino'), 1), Array(9).fill(0));
  assert.deepEqual(R.espacosPara(cl('paladino'), 2), [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(R.espacosPara(cl('patrulheiro'), 5), [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(R.espacosPara(cl('paladino'), 20), [4, 3, 3, 3, 2, 0, 0, 0, 0]);
  assert.deepEqual(R.espacosPara(cl('bruxo'), 1), [1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(R.espacosPara(cl('bruxo'), 5), [0, 0, 2, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(R.espacosPara(cl('bruxo'), 20), [0, 0, 0, 0, 4, 0, 0, 0, 0]);
  assert.equal(R.espacosPara(cl('guerreiro'), 10), null);
  assert.equal(R.nivelMaxMagia(cl('mago'), 5), 3);
  assert.deepEqual(R.novasMagias(cl('feiticeiro'), 4), { truques: 1, magias: 1 });
  assert.deepEqual(R.novasMagias(cl('mago'), 2), { truques: 0, magias: 2 }, 'mago copia 2 magias no grimório');
});

test('subir de nível: PV, habilidades, espaços e histórico', () => {
  const c0 = ficha({ xp: 300 });
  const c = R.subirNivel(c0, cl('mago'), { pv: 'media', data: 1 });
  assert.equal(c0.level, 1, 'a ficha original não muda');
  assert.equal(c.level, 2);
  assert.equal(c.clsId, 'mago');
  assert.equal(c.cls, 'Mago');
  assert.equal(c.hp.max, 8 + 4 + 2);
  assert.equal(c.hp.cur, 14);
  assert.equal(c.hd.die, 'd6');
  assert.deepEqual(c.slots.map((s) => s.max), [3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(c.spAb, 'int');
  assert.match(c.feats, /Nível 2 — Tradição Arcana/);
  assert.deepEqual(c.historico, [{ n: 2, data: 1, pv: 6 }]);
  assert.equal(R.subirNivel(c0, cl('mago'), { pv: 6 }).hp.max, 8 + 6 + 2, 'dado rolado');
  assert.throws(() => R.subirNivel(c0, cl('mago'), { pv: 7 }), /entre 1 e 6/);
  assert.equal(R.subirNivel(ficha({ xp: 300, ab: { con: 3 } }), cl('mago'), { pv: 1 }).hp.max, 9, 'no mínimo 1 PV');
});

test('subir de nível: precisa de XP ou de nível concedido', () => {
  assert.throws(() => R.subirNivel(ficha(), cl('guerreiro'), { pv: 'media' }), /Faltam 300 XP/);
  const c = R.subirNivel(ficha({ nivelLib: 2 }), cl('guerreiro'), { pv: 'media' });
  assert.equal(c.nivelLib, 1, 'consome o nível concedido');
  assert.equal(R.subirNivel(ficha({ xp: 300, nivelLib: 1 }), cl('guerreiro'), { pv: 'media' }).nivelLib, 1, 'com XP suficiente, guarda o nível concedido');
  assert.throws(() => R.subirNivel(ficha({ xp: 300 }), null, {}), /classe/);
});

test('aumento de atributo e talento', () => {
  const c3 = ficha({ level: 3, xp: 2700, hp: { max: 20, cur: 20 } });
  assert.throws(() => R.subirNivel(c3, cl('mago'), { pv: 'media' }), /aumento de atributo/);
  assert.throws(() => R.subirNivel(c3, cl('mago'), { pv: 'media', asi: { int: 3 } }), /\+2 num atributo/);
  assert.throws(() => R.subirNivel(ficha({ ...c3, ab: { int: 19 } }), cl('mago'), { pv: 'media', asi: { int: 2 } }), /20/);
  const c = R.subirNivel(c3, cl('mago'), { pv: 'media', asi: { int: 1, con: 1 } });
  assert.equal(c.ab.int, 17);
  assert.equal(c.ab.con, 15);
  assert.equal(c.hp.max, 20 + 4 + 2, 'Con 15 não muda o modificador');
  const c2 = R.subirNivel(c3, cl('mago'), { pv: 'media', asi: { con: 2 } });
  assert.equal(c2.hp.max, 20 + 4 + 3 + 3, 'modificador de Con sobe: +1 PV pelos 3 níveis anteriores');
  const t = R.subirNivel(c3, cl('mago'), { pv: 'media', talento: { nome: 'Sortudo', desc: '3 pontos de sorte' } });
  assert.match(t.feats, /Talento \(nível 4\) — Sortudo: 3 pontos de sorte/);
  assert.equal(t.historico[0].talento, 'Sortudo');
  assert.ok(R.asiNoNivel(cl('guerreiro'), 6) && !R.asiNoNivel(cl('mago'), 6));
});

test('subclasse e magias novas', () => {
  const c = R.subirNivel(ficha({ level: 2, xp: 900, cls: 'guerreiro' }), cl('guerreiro'), { pv: 'media', subclasse: 'Campeão' });
  assert.equal(c.sub, 'Campeão');
  assert.equal(c.cls, 'guerreiro', 'o texto da classe do jogador fica');
  assert.match(c.feats, /Arquétipo Marcial \(Campeão\)/);
  const m = R.subirNivel(ficha({ xp: 300, spells: [{ n: 'Luz', l: 0, p: true }] }), cl('mago'), { pv: 'media', magias: [{ n: 'Escudo Arcano', l: 1 }, { n: 'luz', l: 0 }] });
  assert.deepEqual(m.spells.map((s) => s.n), ['Luz', 'Escudo Arcano']);
});

test('habilidades listam o aumento de atributo no nível certo', () => {
  const h = R.habilidades(cl('ladino'), 10);
  assert.ok(h.some((x) => x.n === 10 && x.nome === 'Aumento de Atributo'));
  assert.ok(h.some((x) => x.n === 1 && /Ataque Furtivo/.test(x.nome)));
});

test('CA pelo equipamento', () => {
  const d = { armaduras, armas };
  const ab = { des: 16, con: 14, sab: 14 };
  const ca = (items, classe) => R.caEquipada({ ab, items }, d, classe);
  assert.equal(ca([]), 13, 'sem armadura: 10 + Des');
  assert.equal(ca([{ n: 'Couro batido', eq: 'armadura' }]), 15, 'leve: Des inteira');
  assert.equal(ca([{ n: 'Peitoral', eq: 'armadura' }]), 16, 'média: Des até 2');
  assert.equal(ca([{ n: 'Cota de malha', eq: 'armadura' }, { n: 'Escudo', eq: 'mao2' }]), 18, 'pesada + escudo');
  assert.equal(ca([{ n: 'Cota de malha', eq: '' }]), 13, 'armadura na mochila não conta');
  assert.equal(ca([{ n: 'Placas +1', eq: 'armadura' }]), 19, 'bônus mágico no nome');
  assert.equal(ca([{ n: 'Anel de Proteção', eq: 'anel1', bonusCa: 1 }]), 14, 'bônus de um item qualquer');
  assert.equal(ca([], classes.find((c) => c.id === 'barbaro')), 15, 'bárbaro: 10 + Des + Con');
  assert.equal(ca([{ n: 'Escudo', eq: 'mao2' }], classes.find((c) => c.id === 'barbaro')), 17);
  assert.equal(ca([], classes.find((c) => c.id === 'monge')), 15, 'monge: 10 + Des + Sab');
  assert.equal(ca([{ n: 'Escudo', eq: 'mao2' }], classes.find((c) => c.id === 'monge')), 15, 'monge com escudo perde a defesa sem armadura');
  assert.equal(R.slotSugerido({ n: 'Escudo' }, d), 'mao2');
  assert.equal(R.slotSugerido({ n: 'Cota de malha' }, d), 'armadura');
  assert.equal(R.slotSugerido({ n: 'Espada longa' }, d), 'mao1');
  assert.equal(R.slotSugerido({ n: 'Anel de Proteção' }, d), 'anel1');
  assert.equal(R.slotSugerido({ n: 'Botas Élficas' }, d), 'botas');
});
