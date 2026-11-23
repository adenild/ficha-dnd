'use strict';
// Servidor MCP da suite-dnd: fichas, mesas e mapas de D&D 5e. Sem dependências: só Node.js 18+.
// Fala MCP por stdio (JSON-RPC, uma mensagem por linha) e conversa com apps/fichas e apps/mapas pela mesma API
// que os celulares usam, entrando como um jogador. Assim as regras de acesso continuam valendo e
// quem estiver com a ficha aberta recebe as mudanças ao vivo.
//
// Configuração (variáveis de ambiente):
//   FICHA_URL      endereço do servidor (padrão http://localhost:3000)
//   FICHA_TOKEN    token de conta, gerado no app em Configurações › Conta. Pode ser pausado ou
//                  removido lá, e cada chamada feita com ele fica no registro de auditoria.
//   MAPAS_URL      endereço do serviço de mapas (padrão: o mesmo de FICHA_URL na porta 3001). Ele
//                  aceita o mesmo token e aplica as mesmas regras de acesso.

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

function createClient({ url, token, servico = 'o servidor das fichas', comando = 'npm start' }) {
  return async function call(method, path, body) {
    if (!token) fail('Configure FICHA_TOKEN no servidor MCP: gere um token no app, em Configurações › Conta.');
    let res;
    try {
      res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      fail(`Não consegui falar com ${servico} em ${url}. Ele está rodando (${comando} ou o Docker)?`);
    }
    const out = await res.json().catch(() => null);
    if (res.status !== 200) fail(out?.error || `Erro ${res.status}`);
    return out;
  };
}

// ---------- ferramentas ----------
function createTools(call, mcall) {
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
  if (mcall) tools.push(...createMapTools(mcall));
  return tools;
}

// ---------- ferramentas de mapa (falam com apps/mapas) ----------
const TERRENO = { vazio: '.', pedra: 'c', madeira: 'm', grama: 'g', terra: 't', agua: 'a', parede: 'p', lava: 'l', porta: 'o', rocha: 'r' };
const TERRENO_NOME = Object.fromEntries(Object.entries(TERRENO).map(([k, v]) => [v, k === 'agua' ? 'água' : k]));
const TIPOS_TOKEN = ['pj', 'aliado', 'inimigo', 'objeto'];
const TAMANHO = { 1: 'Médio ou menor (1×1)', 2: 'Grande (2×2)', 3: 'Enorme (3×3)', 4: 'Imenso (4×4)' };
const MARCAS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const metros = (q) => String(q * 1.5).replace('.', ',') + ' m';

function colName(x) { let s = ''; x += 1; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; }
const coord = (x, y) => colName(x) + (y + 1);
function parsePos(p, mp) {
  const m = /^\s*([a-z]+)\s*(\d+)\s*$/i.exec(String(p ?? ''));
  if (!m) fail(`Posição "${p}" inválida. Use coluna e linha, como C7.`);
  let x = 0;
  for (const ch of m[1].toUpperCase()) x = x * 26 + (ch.charCodeAt(0) - 64);
  x -= 1; const y = +m[2] - 1;
  if (x < 0 || y < 0 || x >= mp.cols || y >= mp.rows) fail(`${String(p).toUpperCase()} fica fora do mapa, que vai de A1 a ${coord(mp.cols - 1, mp.rows - 1)}.`);
  return { x, y };
}
// distância de 5e no quadriculado: a diagonal conta como um quadrado; tokens grandes contam da borda mais próxima
const gap = (a0, a1, b0, b1) => Math.max(0, b0 - a1, a0 - b1);
const distQ = (a, b) => Math.max(gap(a.x, a.x + (a.tam || 1) - 1, b.x, b.x + (b.tam || 1) - 1), gap(a.y, a.y + (a.tam || 1) - 1, b.y, b.y + (b.tam || 1) - 1));

function createMapTools(mcall) {
  const mstate = () => mcall('GET', '/api/state');
  function findMapa(ms, ref, mesaRef) {
    let list = ms.mapas;
    if (mesaRef) {
      const me = ms.mesas.find((x) => x.id === mesaRef || plain(x.nome) === plain(mesaRef)) || ms.mesas.find((x) => plain(x.nome).includes(plain(mesaRef))) || fail(`Mesa "${mesaRef}" não encontrada.`);
      list = list.filter((x) => x.mesa === me.id);
    }
    if (!ref) {
      if (list.length === 1) return list[0];
      if (!list.length) fail('Nenhum mapa disponível. O mestre cria um com gerenciar_mapa (acao criar).');
      fail(`Informe o mapa. Mapas: ${list.map((x) => `${x.nome} (${x.id})`).join('; ')}.`);
    }
    const hit = list.find((x) => x.id === ref) || list.find((x) => plain(x.nome) === plain(ref));
    if (hit) return hit;
    const part = list.filter((x) => plain(x.nome).includes(plain(ref)));
    if (part.length === 1) return part[0];
    fail(part.length ? `Mais de um mapa combina com "${ref}": ${part.map((x) => `${x.nome} (${x.id})`).join('; ')}.` : `Mapa "${ref}" não encontrado entre os que esta conta vê.`);
  }
  async function abrir(ref, mesa) {
    const ms = await mstate();
    const r = findMapa(ms, ref, mesa);
    return { ms, mp: await mcall('GET', `/api/mapas/${r.id}`) };
  }
  const fichaDe = (ms, id) => ms.fichas.find((f) => f.id === id);
  function findToken(ms, mp, ref) {
    if (!ref) fail('Informe o token (nome, nome da ficha ou id).');
    const byId = mp.tokens.find((t) => t.id === ref);
    if (byId) return byId;
    const nomeDe = (t) => [t.nome, t.fnome, (fichaDe(ms, t.ficha) || {}).nome].filter(Boolean);
    const exato = mp.tokens.filter((t) => nomeDe(t).some((n) => plain(n) === plain(ref)));
    const hits = exato.length ? exato : mp.tokens.filter((t) => nomeDe(t).some((n) => plain(n).includes(plain(ref))));
    if (hits.length === 1) return hits[0];
    fail(hits.length ? `Mais de um token combina com "${ref}": ${hits.map((t) => `${t.nome} em ${coord(t.x, t.y)} (${t.id})`).join('; ')}. Use o id.` : `Token "${ref}" não está no mapa ${mp.nome}. Tokens: ${mp.tokens.map((t) => t.nome).join(', ') || 'nenhum'}.`);
  }
  function findFicha(ms, ref) {
    const hit = ms.fichas.find((f) => f.id === ref) || ms.fichas.filter((f) => plain(f.nome) === plain(ref)).at(0);
    if (hit) return hit;
    const part = ms.fichas.filter((f) => plain(f.nome).includes(plain(ref)));
    if (part.length === 1) return part[0];
    fail(part.length ? `Mais de uma ficha combina com "${ref}": ${part.map((f) => `${f.nome} (${f.id})`).join('; ')}.` : `Ficha "${ref}" não encontrada entre as que esta conta vê.`);
  }
  const souMestre = (ms, mp) => !!(ms.mesas.find((x) => x.id === mp.mesa) || {}).souMestre;
  function tokenView(ms, mp, t, marca) {
    const f = t.ficha && fichaDe(ms, t.ficha);
    return {
      ...(marca ? { marca } : {}), id: t.id, nome: t.nome, posicao: coord(t.x, t.y), ...(t.tam > 1 ? { ocupa: `${coord(t.x, t.y)} a ${coord(t.x + t.tam - 1, t.y + t.tam - 1)}` } : {}),
      tipo: t.tipo, tamanho: TAMANHO[t.tam], ...(t.oculto ? { oculto: true } : {}),
      ...(f ? { ficha: f.nome, pv: `${f.hp.cur}/${f.hp.max}${f.hp.tmp ? ' +' + f.hp.tmp : ''}`, ca: f.ac, ...(f.cond.length ? { condicoes: f.cond } : {}) } : t.ficha ? { saude: t.saude } : {}),
    };
  }
  function resumo(ms, mp) {
    const me = ms.mesas.find((x) => x.id === mp.mesa) || {};
    return { id: mp.id, nome: mp.nome, mesa: me.nome, visivel_para_jogadores: !!mp.visivel, tamanho: `${mp.cols}×${mp.rows} quadrados (${metros(mp.cols)} × ${metros(mp.rows)}), de A1 a ${coord(mp.cols - 1, mp.rows - 1)}` };
  }
  function grade(mp) {
    if (mp.cols * mp.rows > 4000) return null;
    const cell = Array.from(mp.tiles);
    mp.tokens.forEach((t, i) => {
      const mk = MARCAS[i] || '*';
      for (let y = t.y; y < t.y + t.tam; y++) for (let x = t.x; x < t.x + t.tam; x++) if (x < mp.cols && y < mp.rows) cell[y * mp.cols + x] = mk;
    });
    const w = mp.cols > 26 ? 3 : 2;
    const linhas = ['    ' + Array.from({ length: mp.cols }, (_, x) => colName(x).padEnd(w)).join('').trimEnd()];
    for (let y = 0; y < mp.rows; y++) linhas.push(String(y + 1).padStart(3) + ' ' + cell.slice(y * mp.cols, (y + 1) * mp.cols).map((c) => c.padEnd(w)).join('').trimEnd());
    return linhas.join('\n');
  }
  async function patchTiles(mp, arr) { return mcall('PATCH', `/api/mapas/${mp.id}`, { tiles: arr.join('') }); }
  const terrenoDe = (n) => TERRENO[plain(n)] || fail(`Terreno "${n}" desconhecido. Opções: ${Object.values(TERRENO_NOME).join(', ')}.`);

  return [
    {
      name: 'ver_mapa',
      description: 'Sem "mapa": lista os mapas que esta conta vê. Com "mapa": mostra o mapa em texto (colunas com letras, linhas com números; cada letra minúscula é um terreno da legenda e cada marca 1-9/A-Z é um token), a lista de tokens com posição (ex.: C7), PV e condições das fichas que a conta lê, ou só a saúde aproximada das outras. 1 quadrado = 1,5 m.',
      inputSchema: { type: 'object', properties: { mapa: { type: 'string', description: 'Id ou nome do mapa' }, mesa: { type: 'string', description: 'Filtra por mesa (id ou nome)' }, grade: { type: 'boolean', description: 'false para não mandar o desenho em texto' } } },
      async run({ mapa, mesa, grade: comGrade }) {
        if (!mapa) {
          const ms = await mstate();
          const list = mesa ? ms.mapas.filter((x) => x.mesa === findMapaMesa(ms, mesa)) : ms.mapas;
          return { mapas: list.map((x) => ({ id: x.id, nome: x.nome, mesa: (ms.mesas.find((m) => m.id === x.mesa) || {}).nome, tamanho: `${x.cols}×${x.rows}`, visivel_para_jogadores: x.visivel })) };
        }
        const { ms, mp } = await abrir(mapa, mesa);
        const out = { ...resumo(ms, mp), escala: '1 quadrado = 1,5 m; a diagonal conta como 1 quadrado' };
        if (comGrade !== false) {
          const g = grade(mp);
          if (g) { out.grade = g; out.legenda = { ...Object.fromEntries(Object.entries(TERRENO_NOME)), marcas: 'tokens, ver lista' }; }
          else out.grade = 'Mapa grande demais para mostrar em texto; use as posições dos tokens.';
        }
        if (mp.fundo) out.imagem_de_fundo = 'O mapa tem uma imagem de fundo que só aparece no app; o texto mostra só o terreno pintado.';
        out.tokens = mp.tokens.map((t, i) => tokenView(ms, mp, t, MARCAS[i] || '*'));
        return out;
      },
    },
    {
      name: 'gerenciar_mapa',
      description: 'Mestre da mesa: criar (mesa, nome, largura, altura em quadrados, terreno base opcional), mostrar (os jogadores passam a ver e o app deles abre este mapa), ocultar, renomear (nome), redimensionar (largura, altura) ou apagar (não dá para desfazer: confirme antes). Mapas novos começam ocultos.',
      inputSchema: {
        type: 'object',
        properties: {
          acao: { type: 'string', enum: ['criar', 'mostrar', 'ocultar', 'renomear', 'redimensionar', 'apagar'] },
          mapa: { type: 'string', description: 'Id ou nome do mapa (menos em criar)' },
          mesa: { type: 'string', description: 'Id ou nome da mesa (em criar)' },
          nome: { type: 'string' },
          largura: { type: 'number', description: 'Quadrados de largura (1 a 120)' },
          altura: { type: 'number', description: 'Quadrados de altura (1 a 120)' },
          terreno: { type: 'string', description: 'Terreno base ao criar: ' + Object.values(TERRENO_NOME).join(', ') },
        },
        required: ['acao'],
      },
      async run({ acao, mapa, mesa, nome, largura, altura, terreno }) {
        const ms = await mstate();
        if (acao === 'criar') {
          const mid = findMapaMesa(ms, mesa);
          let mp = await mcall('POST', '/api/mapas', { mesa: mid, nome, cols: largura, rows: altura });
          if (terreno) mp = await patchTiles(mp, Array(mp.cols * mp.rows).fill(terrenoDe(terreno)));
          return { ...resumo(ms, mp), aviso: 'O mapa está oculto: use acao mostrar quando os jogadores puderem ver.' };
        }
        const r = findMapa(ms, mapa);
        if (acao === 'apagar') { await mcall('DELETE', `/api/mapas/${r.id}`); return { apagado: r.nome }; }
        const body = acao === 'mostrar' ? { mostrar: true } : acao === 'ocultar' ? { visivel: false }
          : acao === 'renomear' ? { nome: nome || fail('Informe o novo nome.') }
            : acao === 'redimensionar' ? { cols: largura ?? r.cols, rows: altura ?? r.rows } : fail(`Ação desconhecida: ${acao}`);
        return resumo(ms, await mcall('PATCH', `/api/mapas/${r.id}`, body));
      },
    },
    {
      name: 'pintar_mapa',
      description: 'Mestre da mesa: pinta o terreno em retângulos, na ordem dada. Cada área: de e ate (cantos, ex.: A1 e J8), terreno (' + Object.values(TERRENO_NOME).join(', ') + ') e, opcional, contorno: true para pintar só a borda (bom para paredes de uma sala). Exemplo de sala com porta: [{de:"B2",ate:"K9",terreno:"pedra"},{de:"B2",ate:"K9",terreno:"parede",contorno:true},{de:"F9",ate:"F9",terreno:"porta"}].',
      inputSchema: {
        type: 'object',
        properties: {
          mapa: { type: 'string', description: 'Id ou nome do mapa' },
          areas: { type: 'array', items: { type: 'object', properties: { de: { type: 'string' }, ate: { type: 'string' }, terreno: { type: 'string' }, contorno: { type: 'boolean' } }, required: ['de', 'terreno'] } },
        },
        required: ['mapa', 'areas'],
      },
      async run({ mapa, areas }) {
        const { ms, mp } = await abrir(mapa);
        if (!souMestre(ms, mp)) fail('Só o mestre da mesa pinta o mapa.');
        if (!Array.isArray(areas) || !areas.length) fail('Informe ao menos uma área.');
        const arr = Array.from(mp.tiles);
        let n = 0;
        for (const a of areas) {
          const p = parsePos(a.de, mp), q = parsePos(a.ate || a.de, mp), ch = terrenoDe(a.terreno);
          const [x0, x1] = [Math.min(p.x, q.x), Math.max(p.x, q.x)], [y0, y1] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!a.contorno || x === x0 || x === x1 || y === y0 || y === y1) { arr[y * mp.cols + x] = ch; n++; }
        }
        await patchTiles(mp, arr);
        return { mapa: mp.nome, quadrados_pintados: n };
      },
    },
    {
      name: 'colocar_token',
      description: 'Coloca um token no mapa. Com "ficha", o token mostra os PV e as condições dela (ficha do mestre vira inimigo, de jogador vira personagem). Sem ficha, é um token livre com "nome" (só o mestre). Posição é o canto de cima à esquerda (ex.: C7). Use oculto: true para monstros que os jogadores ainda não viram. Jogadores só colocam as próprias fichas.',
      inputSchema: {
        type: 'object',
        properties: {
          mapa: { type: 'string', description: 'Id ou nome do mapa' },
          ficha: { type: 'string', description: 'Id ou nome da ficha' },
          nome: { type: 'string', description: 'Nome do token livre, ou o nome que os jogadores veem' },
          posicao: { type: 'string', description: 'Ex.: C7' },
          tipo: { type: 'string', enum: TIPOS_TOKEN },
          tamanho: { type: 'number', description: '1 médio ou menor, 2 grande, 3 enorme, 4 imenso' },
          oculto: { type: 'boolean' },
          cor: { type: 'string', description: 'Cor em #rrggbb (opcional)' },
        },
        required: ['mapa', 'posicao'],
      },
      async run({ mapa, ficha, nome, posicao, tipo, tamanho, oculto, cor }) {
        const { ms, mp } = await abrir(mapa);
        const pos = parsePos(posicao, mp);
        if (!ficha && !nome) fail('Informe a ficha ou o nome do token livre.');
        const body = { x: pos.x, y: pos.y };
        if (ficha) body.ficha = findFicha(ms, ficha).id;
        if (nome) body.nome = nome;
        if (tipo) body.tipo = tipo;
        if (tamanho) body.tam = tamanho;
        if (oculto !== undefined) body.oculto = !!oculto;
        if (cor) body.cor = cor;
        const v = await mcall('POST', `/api/mapas/${mp.id}/tokens`, body);
        const t = v.tokens[v.tokens.length - 1];
        return { mapa: mp.nome, token: tokenView(ms, v, t), ...(t.x !== pos.x || t.y !== pos.y ? { aviso: 'O token foi ajustado para caber no mapa.' } : {}) };
      },
    },
    {
      name: 'mover_token',
      description: 'Move um token para uma posição (canto de cima à esquerda, ex.: F4) e diz quantos quadrados e metros andou. Os jogadores veem o movimento na hora. Jogadores só movem os próprios tokens; o mestre move qualquer um. O app não bloqueia paredes nem deslocamento: confira com ver_mapa e com o deslocamento da ficha.',
      inputSchema: { type: 'object', properties: { mapa: { type: 'string' }, token: { type: 'string', description: 'Nome do token, nome da ficha ou id' }, posicao: { type: 'string', description: 'Ex.: F4' } }, required: ['mapa', 'token', 'posicao'] },
      async run({ mapa, token, posicao }) {
        const { ms, mp } = await abrir(mapa);
        const t = findToken(ms, mp, token), pos = parsePos(posicao, mp);
        const andou = distQ(t, { ...pos, tam: 1 });
        const v = await mcall('PATCH', `/api/mapas/${mp.id}/tokens/${t.id}`, { x: pos.x, y: pos.y });
        const n = v.tokens.find((x) => x.id === t.id);
        return { token: n.nome, de: coord(t.x, t.y), para: coord(n.x, n.y), andou: `${andou} ${andou === 1 ? 'quadrado' : 'quadrados'} (${metros(andou)})` };
      },
    },
    {
      name: 'editar_token',
      description: 'Mestre da mesa: muda o nome que os jogadores veem, o tipo, o tamanho, a cor ou se o token está oculto (oculto: false revela um monstro). remover: true tira o token do mapa (a ficha continua existindo). Jogadores só podem remover os próprios tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          mapa: { type: 'string' }, token: { type: 'string', description: 'Nome do token, nome da ficha ou id' },
          nome: { type: 'string' }, tipo: { type: 'string', enum: TIPOS_TOKEN }, tamanho: { type: 'number' }, oculto: { type: 'boolean' }, cor: { type: 'string' }, remover: { type: 'boolean' },
        },
        required: ['mapa', 'token'],
      },
      async run({ mapa, token, nome, tipo, tamanho, oculto, cor, remover }) {
        const { ms, mp } = await abrir(mapa);
        const t = findToken(ms, mp, token);
        if (remover) { await mcall('DELETE', `/api/mapas/${mp.id}/tokens/${t.id}`); return { removido: t.nome, mapa: mp.nome }; }
        const body = {};
        if (nome !== undefined) body.nome = nome;
        if (tipo !== undefined) body.tipo = tipo;
        if (tamanho !== undefined) body.tam = tamanho;
        if (oculto !== undefined) body.oculto = !!oculto;
        if (cor !== undefined) body.cor = cor;
        if (!Object.keys(body).length) fail('Nada para mudar: informe nome, tipo, tamanho, oculto, cor ou remover.');
        if (!souMestre(ms, mp)) fail('Só o mestre da mesa muda os tokens; jogadores só movem ou removem os próprios.');
        const v = await mcall('PATCH', `/api/mapas/${mp.id}/tokens/${t.id}`, body);
        return { mapa: mp.nome, token: tokenView(ms, v, v.tokens.find((x) => x.id === t.id)) };
      },
    },
    {
      name: 'medir',
      description: 'Distância no mapa entre dois tokens, dois quadrados (ex.: C7) ou um token e um quadrado, pelas regras do quadriculado (diagonal conta 1; tokens grandes contam da borda mais próxima). Tokens vizinhos estão a 1 quadrado (1,5 m), o alcance de corpo a corpo.',
      inputSchema: { type: 'object', properties: { mapa: { type: 'string' }, de: { type: 'string', description: 'Token ou posição' }, ate: { type: 'string', description: 'Token ou posição' } }, required: ['mapa', 'de', 'ate'] },
      async run({ mapa, de, ate }) {
        const { ms, mp } = await abrir(mapa);
        const ponto = (ref) => (/^\s*[a-z]{1,2}\s*\d+\s*$/i.test(String(ref)) && !mp.tokens.some((t) => plain(t.nome) === plain(ref)) ? { ...parsePos(ref, mp), tam: 1, rotulo: String(ref).toUpperCase().replace(/\s/g, '') } : (() => { const t = findToken(ms, mp, ref); return { ...t, rotulo: `${t.nome} (${coord(t.x, t.y)})` }; })());
        const a = ponto(de), b = ponto(ate), q = distQ(a, b);
        return { de: a.rotulo, ate: b.rotulo, quadrados: q, metros: metros(q), ...(q <= 1 ? { corpo_a_corpo: true } : {}) };
      },
    },
  ];

  function findMapaMesa(ms, ref) {
    if (!ref) { if (ms.mesas.length === 1) return ms.mesas[0].id; fail(`Informe a mesa. Mesas: ${ms.mesas.map((x) => x.nome).join(', ')}.`); }
    const me = ms.mesas.find((x) => x.id === ref || plain(x.nome) === plain(ref)) || (() => { const p = ms.mesas.filter((x) => plain(x.nome).includes(plain(ref))); return p.length === 1 ? p[0] : null; })();
    return (me || fail(`Mesa "${ref}" não encontrada.`)).id;
  }
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
          serverInfo: { name: 'suite-dnd', version: '1.0.0' },
          instructions: 'Acesso às fichas de D&D 5e, às mesas e aos mapas do app da rede de casa. Use "estado" para ver mesas e fichas e "ver_mapa" para ver os mapas; fichas, mesas, mapas e tokens podem ser indicados pelo nome, e posições no mapa são coluna e linha (ex.: C7, 1 quadrado = 1,5 m). As regras de acesso do app valem: o assistente só vê e muda o que a conta dele pode.',
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
  const fichaUrl = (process.env.FICHA_URL || 'http://localhost:3000').replace(/\/$/, '');
  const mapasUrl = process.env.MAPAS_URL || (() => { const u = new URL(fichaUrl); u.port = '3001'; return u.origin; })();
  const call = createClient({ url: fichaUrl, token: process.env.FICHA_TOKEN });
  const mcall = createClient({ url: mapasUrl.replace(/\/$/, ''), token: process.env.FICHA_TOKEN, servico: 'o serviço de mapas', comando: 'npm start' });
  serveStdio(createMcp(createTools(call, mcall)));
}

module.exports = { createClient, createTools, createMcp, createMapTools };
