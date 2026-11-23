'use strict';
// Servidor MCP das fichas de D&D 5e. Sem dependências: só Node.js 18+.
// Fala MCP por stdio (JSON-RPC, uma mensagem por linha) e conversa com server.js pela mesma API
// que os celulares usam, entrando como um jogador. Assim as regras de acesso continuam valendo e
// quem estiver com a ficha aberta recebe as mudanças ao vivo.
//
// Configuração (variáveis de ambiente):
//   FICHA_URL      endereço do servidor (padrão http://localhost:3000)
//   FICHA_TOKEN    token de conta, gerado no app em Configurações › Conta. Pode ser pausado ou
//                  removido lá, e cada chamada feita com ele fica no registro de auditoria.

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// ---------- regras da ficha (as mesmas de public/app.js) ----------
const AB = [['for', 'Força'], ['des', 'Destreza'], ['con', 'Constituição'], ['int', 'Inteligência'], ['sab', 'Sabedoria'], ['car', 'Carisma']];
const SK = [['acro', 'Acrobacia', 'des'], ['ades', 'Adestrar Animais', 'sab'], ['arca', 'Arcanismo', 'int'], ['atle', 'Atletismo', 'for'], ['atua', 'Atuação', 'car'], ['enga', 'Enganação', 'car'], ['furt', 'Furtividade', 'des'], ['hist', 'História', 'int'], ['inti', 'Intimidação', 'car'], ['intu', 'Intuição', 'sab'], ['inve', 'Investigação', 'int'], ['medi', 'Medicina', 'sab'], ['natu', 'Natureza', 'int'], ['perc', 'Percepção', 'sab'], ['pers', 'Persuasão', 'car'], ['pres', 'Prestidigitação', 'des'], ['reli', 'Religião', 'int'], ['sobr', 'Sobrevivência', 'sab']];
const COND = ['Agarrado', 'Amedrontado', 'Atordoado', 'Caído', 'Cego', 'Contido', 'Enfeitiçado', 'Envenenado', 'Exausto', 'Incapacitado', 'Inconsciente', 'Invisível', 'Paralisado', 'Petrificado', 'Surdo'];

const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const mod = (s) => Math.floor(((+s || 0) - 10) / 2);
const sg = (n) => (n >= 0 ? '+' : '') + n;
const prof = (c) => Math.ceil(Math.max(1, +c.level || 1) / 4) + 1;
const saveV = (c, a) => mod(c.ab[a]) + (c.sv[a] ? prof(c) : 0);
const skillV = (c, s) => mod(c.ab[s[2]]) + prof(c) * (+c.sk[s[0]] || 0);

function blank(n) {
  return { name: n || 'Novo personagem', cls: '', level: 1, race: '', bg: '', align: '', xp: 0, ab: { for: 10, des: 10, con: 10, int: 10, sab: 10, car: 10 }, sv: {}, sk: {}, ac: 10, initB: 0, speed: 9, hp: { max: 10, cur: 10, tmp: 0 }, hd: { die: 'd8', used: 0 }, death: { s: 0, f: 0 }, cond: [], insp: false, atk: [], spAb: 'int', slots: Array.from({ length: 9 }, () => ({ max: 0, used: 0 })), spells: [], coins: { pc: 0, pp: 0, pe: 0, po: 0, pl: 0 }, items: [], profs: '', feats: '', traits: '', ideals: '', bonds: '', flaws: '', story: '', notes: '' };
}
function fix(c) {
  const b = blank(); const o = Object.assign(b, c);
  for (const k of ['ab', 'hp', 'hd', 'death', 'coins', 'sv', 'sk']) o[k] = Object.assign({}, b[k], c[k] || {});
  o.slots = Array.from({ length: 9 }, (_, i) => Object.assign({ max: 0, used: 0 }, (c.slots || [])[i] || {}));
  for (const k of ['atk', 'spells', 'items', 'cond']) if (!Array.isArray(o[k])) o[k] = [];
  return o;
}
function derived(c) {
  return {
    proficiencia: sg(prof(c)),
    modificadores: Object.fromEntries(AB.map(([k]) => [k, sg(mod(c.ab[k]))])),
    salvaguardas: Object.fromEntries(AB.map(([k]) => [k, sg(saveV(c, k))])),
    pericias: Object.fromEntries(SK.map((s) => [s[1], sg(skillV(c, s))])),
    iniciativa: sg(mod(c.ab.des) + (+c.initB || 0)),
    percepcao_passiva: 10 + skillV(c, SK.find((s) => s[0] === 'perc')),
    cd_magia: 8 + prof(c) + mod(c.ab[c.spAb]),
    ataque_magico: sg(prof(c) + mod(c.ab[c.spAb])),
    dados_de_vida: `${Math.max(1, +c.level || 1) - (+c.hd.used || 0)}/${Math.max(1, +c.level || 1)} ${c.hd.die}`,
    carga_kg: `${c.items.reduce((s, i) => s + (+i.q || 0) * (+i.w || 0), 0)} / ${(+c.ab.for || 0) * 7.5}`,
  };
}

// ---------- dados ----------
const r = (n) => 1 + Math.floor(Math.random() * n);
function dice(expr) {
  let tot = 0, ok = false; const parts = [];
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/gi; let m;
  const src = String(expr).replace(/\s/g, '');
  while ((m = re.exec(src))) {
    ok = true;
    if (m[3]) {
      const n = Math.min(+m[2] || 1, 100), s = +m[3], neg = m[1] === '-';
      if (s < 1) fail('Dado inválido: d' + m[3]);
      const rs = Array.from({ length: n }, () => r(s));
      tot += (neg ? -1 : 1) * rs.reduce((a, b) => a + b, 0);
      parts.push(`${neg ? '-' : ''}${n}d${s}[${rs.join(',')}]`);
    } else {
      const v = (m[4] === '-' ? -1 : 1) * +m[5];
      tot += v; parts.push(sg(v));
    }
  }
  if (!ok) fail(`Expressão de dados inválida: "${expr}". Use algo como 2d6+3.`);
  return { total: tot, detalhe: parts.join(' ') };
}
function d20(modo) {
  const a = r(20);
  if (!modo || modo === 'normal') return { v: a, rolagens: [a] };
  const b = r(20);
  return { v: modo === 'vantagem' ? Math.max(a, b) : Math.min(a, b), rolagens: [a, b] };
}
function test20(label, bonus, modo) {
  const x = d20(modo);
  return { teste: label, modo: modo || 'normal', d20: x.rolagens, bonus: sg(bonus), total: x.v + bonus, ...(x.v === 20 ? { natural: 20 } : x.v === 1 ? { natural: 1 } : {}) };
}

// ---------- cliente da API ----------
class ToolError extends Error {}
const fail = (msg) => { throw new ToolError(msg); };

function createClient({ url, token }) {
  return async function call(method, path, body) {
    if (!token) fail('Configure FICHA_TOKEN no servidor MCP: gere um token no app, em Configurações › Conta.');
    let res;
    try {
      res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      fail(`Não consegui falar com o servidor das fichas em ${url}. Ele está rodando (npm start)?`);
    }
    const out = await res.json().catch(() => null);
    if (res.status !== 200) fail(out?.error || `Erro ${res.status}`);
    return out;
  };
}

// ---------- ferramentas ----------
function createTools(call) {
  const state = () => call('GET', '/api/state');

  function findChar(st, ref) {
    if (!ref) fail('Informe a ficha (id ou nome do personagem).');
    const byId = st.chars.find((c) => c.id === ref);
    if (byId) return byId;
    const hits = st.chars.filter((c) => plain(c.data.name) === plain(ref));
    if (hits.length === 1) return hits[0];
    const part = hits.length ? hits : st.chars.filter((c) => plain(c.data.name).includes(plain(ref)));
    if (part.length === 1) return part[0];
    if (part.length > 1) fail(`Mais de uma ficha combina com "${ref}": ${part.map((c) => `${c.data.name} (${c.id}, de ${c.ownerName})`).join('; ')}. Use o id.`);
    fail(`Ficha "${ref}" não encontrada entre as que ${st.me.name} pode ver.`);
  }
  function findMesa(st, ref) {
    if (!ref) fail('Informe a mesa (id ou nome).');
    const m = st.mesas.find((x) => x.id === ref) || st.mesas.filter((x) => plain(x.nome) === plain(ref)).at(0)
      || (() => { const p = st.mesas.filter((x) => plain(x.nome).includes(plain(ref))); return p.length === 1 ? p[0] : null; })();
    return m || fail(`Mesa "${ref}" não encontrada entre as de ${st.me.name}.`);
  }
  function mesaRef(st, ref) { return ref === '' || ref === null ? '' : findMesa(st, ref).id; }
  const mesaName = (st, id) => (st.mesas.find((m) => m.id === id) || {}).nome || '';
  const summary = (st, c) => {
    const d = fix(c.data);
    return { id: c.id, nome: d.name, dono: c.ownerName, mesa: mesaName(st, c.mesa) || null, liberada: c.lib, ...(c.owner === st.me.id ? { minha: true } : {}), classe: [d.cls, d.level && 'nível ' + d.level].filter(Boolean).join(' '), raca: d.race, pv: `${d.hp.cur}${+d.hp.tmp ? '+' + d.hp.tmp : ''}/${d.hp.max}`, ca: d.ac, ...(d.cond.length ? { condicoes: d.cond } : {}) };
  };
  const full = (st, c) => ({ ...summary(st, c), dados: fix(c.data), calculado: derived(fix(c.data)) });

  function merge(dst, src) {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) merge(dst[k], v);
      else dst[k] = v;
    }
    return dst;
  }
  async function save(c, data, mesa) {
    const body = { data };
    if (mesa !== undefined) body.mesa = mesa;
    await call('PUT', `/api/chars/${c.id}`, body);
    const st = await state();
    return st.chars.find((x) => x.id === c.id) ? summary(st, st.chars.find((x) => x.id === c.id)) : { id: c.id };
  }
  const findSkill = (ref) => SK.find((s) => s[0] === plain(ref) || plain(s[1]) === plain(ref)) || fail(`Perícia "${ref}" desconhecida. Opções: ${SK.map((s) => s[1]).join(', ')}.`);
  const findAb = (ref) => (AB.find(([k, n]) => k === plain(ref) || plain(n) === plain(ref)) || fail(`Atributo "${ref}" desconhecido. Use for, des, con, int, sab ou car.`))[0];
  const abName = (k) => AB.find((a) => a[0] === k)[1];
  const num = (v, what) => { const n = Math.abs(parseInt(v, 10)); if (!n) fail(`Informe ${what}.`); return n; };

  const DATA_DOC = 'Formato da ficha: name, cls (classe), level, race, bg (antecedente), align, xp, ab {for,des,con,int,sab,car} (valores, não modificadores), sv {atributo: 1 se proficiente}, sk {código: 1 proficiente, 2 especialista} (códigos: ' + SK.map((s) => `${s[0]}=${s[1]}`).join(', ') + '), ac, initB (bônus extra de iniciativa), speed (metros), hp {max,cur,tmp}, hd {die:"d8",used}, death {s,f}, cond [condições], insp (inspiração), atk [{n nome, b "+5" bônus, d "1d8+3" dano, t tipo/alcance}], spAb (atributo de conjuração), slots [9 níveis {max,used}], spells [{n nome, l nível 0-9, p preparada}], coins {pc,pp,pe,po,pl}, items [{n, q quantidade, w peso kg}], profs, feats, traits, ideals, bonds, flaws, story, notes (textos).';

  const tools = [
    {
      name: 'estado',
      description: 'Mostra quem é o assistente no app, as mesas (com membros e, se for mestre, o código de convite) e um resumo de todas as fichas que ele pode ver. Comece por aqui.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const st = await state();
        return {
          eu: st.me.name,
          mesas: st.mesas.map((m) => ({ id: m.id, nome: m.nome, mestre: m.membros.find((x) => x.id === m.mestre)?.name, sou_mestre: m.mestre === st.me.id, ...(m.code ? { codigo: m.code } : {}), membros: m.membros.map((x) => x.name) })),
          fichas: st.chars.map((c) => summary(st, c)),
        };
      },
    },
    {
      name: 'ver_ficha',
      description: 'Ficha completa de um personagem, com os valores calculados (modificadores, salvaguardas, perícias, iniciativa, percepção passiva, CD e ataque de magia, carga).',
      inputSchema: { type: 'object', properties: { ficha: { type: 'string', description: 'Id ou nome do personagem' } }, required: ['ficha'] },
      async run({ ficha }) { const st = await state(); return full(st, findChar(st, ficha)); },
    },
    {
      name: 'criar_ficha',
      description: 'Cria uma ficha nova na conta do assistente. Campos não informados usam o padrão. ' + DATA_DOC,
      inputSchema: { type: 'object', properties: { dados: { type: 'object', description: 'Campos da ficha' }, mesa: { type: 'string', description: 'Id ou nome da mesa (opcional)' } }, required: ['dados'] },
      async run({ dados, mesa }) {
        const st = await state();
        const data = merge(fix(blank()), dados || {});
        const out = await call('POST', '/api/chars', { data, mesa: mesa ? mesaRef(st, mesa) : '' });
        const st2 = await state();
        return summary(st2, st2.chars.find((c) => c.id === out.id));
      },
    },
    {
      name: 'editar_ficha',
      description: 'Altera campos de uma ficha. Objetos são mesclados (ex.: {"hp":{"max":30}} só muda o máximo); listas (atk, spells, items, cond, slots) são substituídas inteiras, então mande a lista completa. "mesa" troca a mesa (só o dono pode; "" tira de qualquer mesa). O mestre pode editar fichas da mesa dele. ' + DATA_DOC,
      inputSchema: { type: 'object', properties: { ficha: { type: 'string', description: 'Id ou nome do personagem' }, alteracoes: { type: 'object', description: 'Campos a mudar' }, mesa: { type: 'string', description: 'Id ou nome da nova mesa, ou "" para nenhuma' } }, required: ['ficha'] },
      async run({ ficha, alteracoes, mesa }) {
        const st = await state();
        const c = findChar(st, ficha);
        return save(c, merge(fix(c.data), alteracoes || {}), mesa === undefined ? undefined : mesaRef(st, mesa));
      },
    },
    {
      name: 'acao_ficha',
      description: 'Ações de jogo numa ficha, com as regras do app: dano (gasta PV temporários primeiro), cura, pv_temporarios (define o valor), dado_de_vida (rola e cura), descanso_longo (PV cheios, espaços de magia e metade dos dados de vida), usar_espaco e recuperar_espaco (valor = nível da magia), salvaguarda_morte (rola e marca), adicionar_condicao e remover_condicao (condicao = nome), inspiracao (valor 1 dá, 0 tira).',
      inputSchema: {
        type: 'object',
        properties: {
          ficha: { type: 'string', description: 'Id ou nome do personagem' },
          acao: { type: 'string', enum: ['dano', 'cura', 'pv_temporarios', 'dado_de_vida', 'descanso_longo', 'usar_espaco', 'recuperar_espaco', 'salvaguarda_morte', 'adicionar_condicao', 'remover_condicao', 'inspiracao'] },
          valor: { type: 'number', description: 'Quantidade de PV, nível do espaço ou 1/0 para inspiração' },
          condicao: { type: 'string', description: 'Condição: ' + COND.join(', ') },
        },
        required: ['ficha', 'acao'],
      },
      async run({ ficha, acao, valor, condicao }) {
        const st = await state();
        const ch = findChar(st, ficha);
        const c = fix(ch.data);
        const info = {};
        const lv = Math.max(1, +c.level || 1);
        switch (acao) {
          case 'dano': {
            let left = num(valor, 'o dano'); const t = +c.hp.tmp || 0; const u = Math.min(t, left);
            c.hp.tmp = t - u; left -= u; c.hp.cur = Math.max(0, (+c.hp.cur || 0) - left);
            if (c.hp.cur === 0) info.aviso = 'Personagem caído (0 PV).';
            break;
          }
          case 'cura': c.hp.cur = Math.min(+c.hp.max || 0, (+c.hp.cur || 0) + num(valor, 'a cura')); if (c.hp.cur > 0) c.death = { s: 0, f: 0 }; break;
          case 'pv_temporarios': c.hp.tmp = Math.max(0, parseInt(valor, 10) || 0); break;
          case 'dado_de_vida': {
            if ((+c.hd.used || 0) >= lv) fail('Sem dados de vida: recupere no descanso longo.');
            const s = parseInt(String(c.hd.die).slice(1), 10) || 8; const rv = r(s); const h = Math.max(1, rv + mod(c.ab.con));
            c.hd.used = (+c.hd.used || 0) + 1; c.hp.cur = Math.min(+c.hp.max || 0, (+c.hp.cur || 0) + h);
            info.rolagem = `${c.hd.die}: ${rv} ${sg(mod(c.ab.con))} CON = +${h} PV`;
            break;
          }
          case 'descanso_longo':
            c.hp.cur = +c.hp.max || 0; c.hp.tmp = 0; c.death = { s: 0, f: 0 }; c.slots.forEach((s) => { s.used = 0; });
            c.hd.used = Math.max(0, (+c.hd.used || 0) - Math.max(1, Math.floor(lv / 2)));
            break;
          case 'usar_espaco': case 'recuperar_espaco': {
            const n = parseInt(valor, 10); if (!(n >= 1 && n <= 9)) fail('Informe o nível do espaço (1 a 9) em "valor".');
            const s = c.slots[n - 1];
            if (acao === 'usar_espaco') { if (s.used >= s.max) fail(`Sem espaços de ${n}º nível livres (${s.used}/${s.max} usados).`); s.used++; } else s.used = Math.max(0, s.used - 1);
            info.espacos = `${n}º nível: ${s.max - s.used}/${s.max} livres`;
            break;
          }
          case 'salvaguarda_morte': {
            const v = r(20);
            if (v === 20) { c.death = { s: 0, f: 0 }; c.hp.cur = Math.max(1, +c.hp.cur || 0); } else if (v === 1) c.death.f = Math.min(3, c.death.f + 2);
            else if (v >= 10) c.death.s = Math.min(3, c.death.s + 1); else c.death.f = Math.min(3, c.death.f + 1);
            info.rolagem = v; info.resultado = v === 20 ? 'Recupera 1 PV!' : v === 1 ? 'Duas falhas' : v >= 10 ? 'Sucesso' : 'Falha';
            info.morte = `${c.death.s} sucessos, ${c.death.f} falhas${c.death.f >= 3 ? ' · morto' : c.death.s >= 3 ? ' · estabilizado' : ''}`;
            break;
          }
          case 'adicionar_condicao': case 'remover_condicao': {
            const name = COND.find((x) => plain(x) === plain(condicao)) || fail(`Condição desconhecida. Opções: ${COND.join(', ')}.`);
            c.cond = c.cond.filter((x) => x !== name); if (acao === 'adicionar_condicao') c.cond.push(name);
            break;
          }
          case 'inspiracao': c.insp = valor === undefined ? true : !!+valor; break;
          default: fail(`Ação desconhecida: ${acao}`);
        }
        return { ...(await save(ch, c)), ...info };
      },
    },
    {
      name: 'rolar',
      description: 'Rola dados. Sem ficha: rola a expressão (ex.: "2d6+3", "1d20+5"). Com ficha: rola um teste dela com os bônus calculados. teste: "atributo:<for|des|con|int|sab|car>", "salvaguarda:<atributo>", "pericia:<nome ou código>", "iniciativa", "ataque_magico" ou "ataque:<nome do ataque>" (rola acerto e dano, com crítico no 20). Não altera a ficha.',
      inputSchema: {
        type: 'object',
        properties: {
          expressao: { type: 'string', description: 'Dados a rolar, ex.: 4d6, 1d20+3' },
          ficha: { type: 'string', description: 'Id ou nome do personagem' },
          teste: { type: 'string', description: 'Teste da ficha, ex.: pericia:Furtividade' },
          modo: { type: 'string', enum: ['normal', 'vantagem', 'desvantagem'] },
          vezes: { type: 'number', description: 'Quantas vezes repetir (até 20)' },
        },
      },
      async run({ expressao, ficha, teste, modo, vezes }) {
        const n = Math.min(Math.max(1, parseInt(vezes, 10) || 1), 20);
        let once;
        if (!ficha) {
          if (!expressao) fail('Informe "expressao" ou "ficha" com "teste".');
          once = () => ({ expressao, ...dice(expressao) });
        } else {
          const st = await state();
          const ch = findChar(st, ficha); const c = fix(ch.data);
          const [t, a = ''] = String(teste || '').split(/:(.*)/s);
          const kind = plain(t);
          if (kind === 'atributo') { const k = findAb(a); once = () => test20('Teste de ' + abName(k), mod(c.ab[k]), modo); }
          else if (kind === 'salvaguarda') { const k = findAb(a); once = () => test20('Salvaguarda de ' + abName(k), saveV(c, k), modo); }
          else if (kind === 'pericia') { const s = findSkill(a); once = () => test20(s[1], skillV(c, s), modo); }
          else if (kind === 'iniciativa') once = () => test20('Iniciativa', mod(c.ab.des) + (+c.initB || 0), modo);
          else if (kind === 'ataque_magico') once = () => test20('Ataque mágico', prof(c) + mod(c.ab[c.spAb]), modo);
          else if (kind === 'ataque') {
            const atk = c.atk.find((x) => plain(x.n) === plain(a)) || c.atk.find((x) => plain(x.n).includes(plain(a))) || fail(`Ataque "${a}" não está na ficha. Ataques: ${c.atk.map((x) => x.n).join(', ') || 'nenhum'}.`);
            const b = parseInt(String(atk.b).replace(/\s/g, ''), 10) || 0;
            once = () => {
              const x = test20(atk.n || 'Ataque', b, modo);
              if (atk.d) {
                const dm = dice(atk.d);
                if (x.natural === 20) { const e = dice(String(atk.d).replace(/[+-]\s*\d+(?!\s*d)/g, '') || '0'); dm.total += e.total; dm.detalhe += ' + crítico ' + e.detalhe; }
                x.dano = dm.total; x.dano_detalhe = dm.detalhe; if (atk.t) x.tipo = atk.t;
              }
              return x;
            };
          } else fail('Teste inválido. Use atributo:<x>, salvaguarda:<x>, pericia:<nome>, iniciativa, ataque_magico ou ataque:<nome>.');
          const base = once; once = () => ({ personagem: c.name, ...base() });
        }
        const rolls = Array.from({ length: n }, once);
        return n === 1 ? rolls[0] : rolls;
      },
    },
    {
      name: 'liberar_ficha',
      description: 'Mestre da mesa: libera (os outros jogadores da mesa podem ler) ou oculta uma ficha.',
      inputSchema: { type: 'object', properties: { ficha: { type: 'string' }, liberada: { type: 'boolean' } }, required: ['ficha', 'liberada'] },
      async run({ ficha, liberada }) {
        const st = await state(); const c = findChar(st, ficha);
        await call('POST', `/api/chars/${c.id}/lib`, { lib: !!liberada });
        return { id: c.id, nome: c.data.name, liberada: !!liberada };
      },
    },
    {
      name: 'apagar_ficha',
      description: 'Apaga de vez uma ficha da conta do assistente. Não dá para desfazer: confirme com o usuário antes.',
      inputSchema: { type: 'object', properties: { ficha: { type: 'string' } }, required: ['ficha'] },
      async run({ ficha }) {
        const st = await state(); const c = findChar(st, ficha);
        await call('DELETE', `/api/chars/${c.id}`);
        return { apagada: c.data.name };
      },
    },
    {
      name: 'mesa',
      description: 'Gerencia mesas. criar (nome), entrar (codigo), renomear (mesa, nome), novo_codigo (mesa), remover_jogador (mesa, jogador), sair (mesa), apagar (mesa; tira as fichas dela e não dá para desfazer). Só o mestre renomeia, troca código, remove jogador e apaga.',
      inputSchema: {
        type: 'object',
        properties: {
          acao: { type: 'string', enum: ['criar', 'entrar', 'renomear', 'novo_codigo', 'remover_jogador', 'sair', 'apagar'] },
          mesa: { type: 'string', description: 'Id ou nome da mesa' },
          nome: { type: 'string' },
          codigo: { type: 'string', description: 'Código de convite' },
          jogador: { type: 'string', description: 'Nome do jogador' },
        },
        required: ['acao'],
      },
      async run({ acao, mesa, nome, codigo, jogador }) {
        const st = await state();
        let st2;
        if (acao === 'criar') st2 = await call('POST', '/api/mesas', { nome });
        else if (acao === 'entrar') st2 = await call('POST', '/api/mesas/join', { code: codigo || fail('Informe o código.') });
        else {
          const m = findMesa(st, mesa);
          if (acao === 'renomear') st2 = await call('PATCH', `/api/mesas/${m.id}`, { nome: nome || fail('Informe o novo nome.') });
          else if (acao === 'novo_codigo') st2 = await call('POST', `/api/mesas/${m.id}/code`);
          else if (acao === 'sair') st2 = await call('POST', `/api/mesas/${m.id}/leave`);
          else if (acao === 'apagar') st2 = await call('DELETE', `/api/mesas/${m.id}`);
          else if (acao === 'remover_jogador') {
            const p = m.membros.find((x) => x.id === jogador || plain(x.name) === plain(jogador)) || fail(`"${jogador}" não está na mesa ${m.nome}.`);
            st2 = await call('POST', `/api/mesas/${m.id}/kick`, { user: p.id });
          } else fail(`Ação desconhecida: ${acao}`);
        }
        return { ok: true, mesas: st2.mesas.map((m) => ({ id: m.id, nome: m.nome, ...(m.code ? { codigo: m.code } : {}), membros: m.membros.map((x) => x.name) })) };
      },
    },
  ];
  return tools;
}

// ---------- protocolo MCP (stdio) ----------
function createMcp(tools) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return async function handle(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    const reply = (result) => (isRequest ? { jsonrpc: '2.0', id, result } : null);
    const error = (code, message) => (isRequest ? { jsonrpc: '2.0', id, error: { code, message } } : null);
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'ficha-dnd', version: '1.0.0' },
          instructions: 'Acesso às fichas de D&D 5e e às mesas do app da rede de casa. Use "estado" para ver mesas e fichas; fichas e mesas podem ser indicadas pelo nome. As regras de acesso do app valem: o assistente só vê e muda o que a conta dele pode.',
        });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const tool = byName.get(params?.name);
        if (!tool) return error(-32602, `Ferramenta desconhecida: ${params?.name}`);
        try {
          const out = await tool.run(params.arguments || {});
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
        } catch (e) {
          if (!(e instanceof ToolError)) console.error(e);
          return reply({ content: [{ type: 'text', text: e instanceof ToolError ? e.message : 'Erro interno: ' + e.message }], isError: true });
        }
      }
      default:
        if (!isRequest) return null; // notificações (initialized, cancelled...) não têm resposta
        return error(-32601, `Método não suportado: ${method}`);
    }
  };
}

function serveStdio(handle) {
  let buf = '';
  const pending = new Set();
  const send = (o) => { if (o) process.stdout.write(JSON.stringify(o) + '\n'); };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); continue; }
      const list = Array.isArray(msg) ? msg : [msg];
      for (const m of list) {
        const p = handle(m).then(send, (e) => { console.error(e); }).finally(() => pending.delete(p));
        pending.add(p);
      }
    }
  });
  // sem stdin, o processo termina sozinho quando as chamadas em andamento acabam
  process.stdin.on('end', () => Promise.allSettled([...pending]).then(() => { process.exitCode = 0; }));
}

if (require.main === module) {
  const call = createClient({ url: (process.env.FICHA_URL || 'http://localhost:3000').replace(/\/$/, ''), token: process.env.FICHA_TOKEN });
  serveStdio(createMcp(createTools(call)));
}

module.exports = { createClient, createTools, createMcp };
