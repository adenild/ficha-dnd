// Regras de nível e equipamento do D&D 5e, usadas pelo navegador (window.Regras) e pelo servidor MCP (require).
// Funções puras: recebem a ficha e os dados da wiki (classes.json, armaduras.json, armas.json) e não falam com o servidor.
'use strict';
(function (raiz, fabrica) {
  const R = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = R;
  else raiz.Regras = R;
})(typeof self !== 'undefined' ? self : this, function () {
  const ATRIB = ['for', 'des', 'con', 'int', 'sab', 'car'];
  const mod = (s) => Math.floor(((+s || 0) - 10) / 2);
  const simples = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

  // ---------- experiência (wiki: niveis) ----------
  const XP = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
  const nivel = (c) => Math.min(20, Math.max(1, Math.floor(+c.level || 1)));
  const nivelPorXp = (xp) => XP.filter((x) => (+xp || 0) >= x).length;
  const xpDoNivel = (n) => XP[Math.min(20, Math.max(1, n)) - 1];
  const prof = (n) => Math.ceil(Math.max(1, n) / 4) + 1;
  // pode subir quando o XP passou do próximo nível ou quando o mestre concedeu um nível
  const podeSubir = (c) => nivel(c) < 20 && (nivelPorXp(c.xp) > nivel(c) || (+c.nivelLib || 0) > 0);

  // ---------- espaços de magia (wiki: magia#espacos-por-nivel) ----------
  const COMPLETO = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
  const MEIO = [[], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2]];
  // bruxo: [quantidade, nível dos espaços]
  const PACTO = [[1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5]];
  // máximos dos 9 níveis de espaço, ou null para quem não conjura
  function espacosPara(classe, n) {
    const t = classe && classe.conjuracao, i = Math.min(20, Math.max(1, n)) - 1;
    if (!t) return null;
    const out = Array(9).fill(0);
    if (t === 'pacto') { const [q, l] = PACTO[i]; out[l - 1] = q; return out; }
    (t === 'meio' ? MEIO : COMPLETO)[i].forEach((v, k) => { out[k] = v; });
    return out;
  }
  const nivelMaxMagia = (classe, n) => { const e = espacosPara(classe, n); return e ? e.reduce((m, v, i) => (v ? i + 1 : m), 0) : 0; };
  // quantos truques e magias novas a classe ganha ao chegar no nível n
  function novasMagias(classe, n) {
    if (!classe) return { truques: 0, magias: 0 };
    const dif = (a) => (a ? (a[n - 1] || 0) - (n > 1 ? a[n - 2] || 0 : 0) : 0);
    return { truques: dif(classe.truques), magias: dif(classe.conhecidas) + (classe.grimorio && n > 1 ? classe.grimorio : 0) };
  }

  // ---------- pontos de vida ----------
  const DADO_MEDIO = { d6: 4, d8: 5, d10: 6, d12: 7 };
  const lados = (dado) => +String(dado || 'd8').slice(1) || 8;
  // valor do dado: 'media' ou o número rolado (1..lados)
  function valorDado(dado, pv) {
    if (pv === 'media' || pv == null) return DADO_MEDIO[dado] || Math.floor(lados(dado) / 2) + 1;
    const v = Math.floor(+pv);
    if (!(v >= 1 && v <= lados(dado))) throw new Error(`O valor do dado de vida precisa estar entre 1 e ${lados(dado)}.`);
    return v;
  }

  // ---------- classes ----------
  const achar = (lista, nome) => {
    if (!lista || !nome) return null;
    const s = simples(nome);
    return lista.find((x) => x.id === nome || simples(x.nome) === s) || null;
  };
  const acharClasse = (classes, c) => achar(classes, c.clsId) || achar(classes, c.cls);
  const asiNoNivel = (classe, n) => !!(classe && (classe.asi || []).includes(n));
  const subclasseNoNivel = (classe, n) => !!(classe && classe.subclasseNivel === n);
  // habilidades da classe do 1º ao nível n, com o aumento de atributo e a subclasse no lugar certo
  function habilidades(classe, ate, de = 1) {
    if (!classe) return [];
    const out = [];
    for (let n = de; n <= ate; n++) {
      for (const h of (classe.niveis || {})[n] || []) out.push({ n, ...h });
      if (asiNoNivel(classe, n)) out.push({ n, nome: 'Aumento de Atributo', resumo: '+2 num atributo ou +1 em dois (máximo 20), ou um talento.' });
    }
    return out;
  }

  // ---------- subir de nível ----------
  // escolhas: { pv: 'media' | número rolado, asi: { for: 2 } | { for: 1, des: 1 }, talento: { nome, desc },
  //             subclasse, magias: [{ n, l }], data }
  // Devolve uma ficha nova (a original não muda). Lança Error com a mensagem para o jogador se algo estiver errado.
  function subirNivel(c0, classe, e = {}) {
    if (!classe) throw new Error('Escolha a classe do personagem antes de subir de nível.');
    const c = JSON.parse(JSON.stringify(c0));
    const n = nivel(c) + 1;
    if (n > 20) throw new Error('O personagem já está no nível 20.');
    const porXp = nivelPorXp(c.xp) >= n;
    if (!porXp && !((+c.nivelLib || 0) > 0)) throw new Error(`Faltam ${xpDoNivel(n) - (+c.xp || 0)} XP para o nível ${n}, e o mestre não concedeu um nível.`);
    // o texto da classe é do jogador ("Maga", "Guerreira"): só preenche quando está vazio
    if (c.clsId !== classe.id) { c.clsId = classe.id; if (!String(c.cls || '').trim()) c.cls = classe.nome; }
    c.ab = c.ab || {};
    const conAntes = mod(c.ab.con);
    const reg = { n, data: e.data || Date.now() };

    if (asiNoNivel(classe, n)) {
      if (e.talento && e.talento.nome) {
        reg.talento = String(e.talento.nome).trim();
        c.feats = juntar(c.feats, `Talento (nível ${n}) — ${reg.talento}${e.talento.desc ? ': ' + String(e.talento.desc).trim() : ''}`);
      } else if (e.asi) {
        const par = Object.entries(e.asi).filter(([, v]) => +v);
        const soma = par.reduce((s, [, v]) => s + +v, 0);
        if (soma !== 2 || par.some(([k, v]) => !ATRIB.includes(k) || +v < 0 || +v > 2)) throw new Error('O aumento de atributo é +2 num atributo ou +1 em dois.');
        for (const [k, v] of par) {
          if ((+c.ab[k] || 0) + +v > 20) throw new Error('Um atributo não passa de 20 com o aumento.');
          c.ab[k] = (+c.ab[k] || 0) + +v;
        }
        reg.asi = Object.fromEntries(par.map(([k, v]) => [k, +v]));
      } else throw new Error(`No nível ${n} a classe ganha um aumento de atributo: escolha os atributos ou um talento.`);
    }

    // PV: dado + Con (mínimo 1); se o modificador de Con subiu, o máximo sobe 1 por nível que o personagem já tinha
    const conDepois = mod(c.ab.con);
    const ganho = Math.max(1, valorDado(classe.dado, e.pv) + conDepois) + (conDepois - conAntes) * (n - 1);
    c.hp = c.hp || { max: 10, cur: 10, tmp: 0 };
    c.hp.max = (+c.hp.max || 0) + ganho;
    c.hp.cur = (+c.hp.cur || 0) + ganho;
    c.hd = { ...(c.hd || {}), die: classe.dado };
    reg.pv = ganho;

    if (subclasseNoNivel(classe, n) && e.subclasse) c.sub = String(e.subclasse).trim();
    const novas = habilidades(classe, n, n).filter((h) => h.nome !== 'Aumento de Atributo');
    const linhas = novas.map((h) => {
      const nome = h.sub && c.sub ? `${h.nome} (${c.sub})` : h.nome;
      return `Nível ${n} — ${nome}${h.resumo ? ': ' + h.resumo : ''}`;
    });
    if (linhas.length) c.feats = juntar(c.feats, linhas.join('\n'));

    const esp = espacosPara(classe, n);
    if (esp) {
      c.slots = Array.from({ length: 9 }, (_, i) => {
        const s = (c.slots || [])[i] || {};
        return { max: esp[i], used: Math.min(+s.used || 0, esp[i]) };
      });
      if (classe.atributoMagia) c.spAb = classe.atributoMagia;
    }
    c.spells = Array.isArray(c.spells) ? c.spells : [];
    for (const m of e.magias || []) {
      if (m && m.n && !c.spells.some((s) => simples(s.n) === simples(m.n))) c.spells.push({ n: String(m.n), l: +m.l || 0, p: true });
    }

    if (!porXp) c.nivelLib = Math.max(0, (+c.nivelLib || 0) - 1);
    c.level = n;
    c.historico = [...(Array.isArray(c.historico) ? c.historico : []), reg];
    return c;
  }
  const juntar = (txt, linha) => (String(txt || '').trim() ? String(txt).replace(/\s+$/, '') + '\n' : '') + linha;

  // ---------- equipamento ----------
  const SLOTS = [['cabeca', 'Cabeça'], ['pescoco', 'Pescoço'], ['capa', 'Capa'], ['armadura', 'Armadura'], ['luvas', 'Luvas'], ['cinto', 'Cinto'], ['botas', 'Botas'], ['mao1', 'Mão principal'], ['mao2', 'Mão secundária'], ['anel1', 'Anel'], ['anel2', 'Anel']];
  const SLOT_NOME = Object.fromEntries(SLOTS);
  // acha o item da tabela pelo nome, aceitando sufixos como "Cota de malha +1" ou "Espada longa (prata)"
  function porNome(lista, nome) {
    if (!lista || !nome) return null;
    const s = simples(nome);
    let melhor = null;
    for (const x of lista) {
      const k = simples(x.nome);
      if ((s === k || s.startsWith(k + ' ') || s.startsWith(k + ',')) && (!melhor || k.length > simples(melhor.nome).length)) melhor = x;
    }
    return melhor;
  }
  // bônus mágico escrito no nome: "Escudo +1"
  const bonusNoNome = (nome) => { const m = /\+(\d)\b/.exec(String(nome || '')); return m ? +m[1] : 0; };
  // slot sugerido para um item: armadura, escudo e armas vão para o lugar certo; o resto o jogador escolhe
  function slotSugerido(item, dados = {}) {
    const a = porNome(dados.armaduras, item && item.n);
    if (a) return a.tipo === 'escudo' ? 'mao2' : 'armadura';
    if (porNome(dados.armas, item && item.n)) return 'mao1';
    const s = simples(item && item.n);
    if (/^anel/.test(s)) return 'anel1';
    if (/^(botas|sandalias|chinelos)/.test(s)) return 'botas';
    if (/^(luvas|manoplas|braceletes|bracadeiras)/.test(s)) return 'luvas';
    if (/^(capa|manto)/.test(s)) return 'capa';
    if (/^(elmo|chapeu|capacete|diadema|tiara|coroa|tapa-olho|oculos|lentes)/.test(s)) return 'cabeca';
    if (/^(amuleto|colar|medalhao|broche|pingente)/.test(s)) return 'pescoco';
    if (/^(cinto|cinturao)/.test(s)) return 'cinto';
    return '';
  }
  const equipados = (c) => (c.items || []).filter((i) => i && i.eq);
  // CA pelo equipamento: armadura (com o limite de Destreza), escudo, defesa sem armadura da classe e bônus mágicos
  function caEquipada(c, dados = {}, classe = null) {
    const des = mod((c.ab || {}).des), eq = equipados(c);
    let armadura = null, escudo = false, bonus = 0;
    for (const it of eq) {
      const a = porNome(dados.armaduras, it.n);
      if (a && a.tipo === 'escudo') escudo = a;
      else if (a && it.eq === 'armadura') armadura = a;
      bonus += (+it.bonusCa || 0) || (a ? bonusNoNome(it.n) : 0);
    }
    let base;
    if (armadura) base = armadura.ca + (armadura.desMax === null || armadura.desMax === undefined ? des : Math.min(des, armadura.desMax));
    else if (classe && classe.caSemArmadura && !(classe.id === 'monge' && escudo)) base = 10 + classe.caSemArmadura.reduce((s, k) => s + mod((c.ab || {})[k]), 0);
    else base = 10 + des;
    return base + (escudo ? escudo.ca : 0) + bonus;
  }

  return { XP, nivelPorXp, xpDoNivel, prof, podeSubir, espacosPara, nivelMaxMagia, novasMagias, DADO_MEDIO, lados, valorDado, acharClasse, achar, asiNoNivel, subclasseNoNivel, habilidades, subirNivel, SLOTS, SLOT_NOME, porNome, slotSugerido, equipados, caEquipada, mod, simples };
});
