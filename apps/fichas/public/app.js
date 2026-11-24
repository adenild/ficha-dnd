// Fichas D&D 5e — app do navegador. Fala com server.js pela API /api/*.
'use strict';
{
const AB=[['for','FOR','Força'],['des','DES','Destreza'],['con','CON','Constituição'],['int','INT','Inteligência'],['sab','SAB','Sabedoria'],['car','CAR','Carisma']];
const ABN=Object.fromEntries(AB.map(a=>[a[0],a[1]]));
const SK=[['acro','Acrobacia','des'],['ades','Adestrar Animais','sab'],['arca','Arcanismo','int'],['atle','Atletismo','for'],['atua','Atuação','car'],['enga','Enganação','car'],['furt','Furtividade','des'],['hist','História','int'],['inti','Intimidação','car'],['intu','Intuição','sab'],['inve','Investigação','int'],['medi','Medicina','sab'],['natu','Natureza','int'],['perc','Percepção','sab'],['pers','Persuasão','car'],['pres','Prestidigitação','des'],['reli','Religião','int'],['sobr','Sobrevivência','sab']];
const SKM=Object.fromEntries(SK.map(s=>[s[0],s]));
const COND=['Agarrado','Amedrontado','Atordoado','Caído','Cego','Contido','Enfeitiçado','Envenenado','Exausto','Incapacitado','Inconsciente','Invisível','Paralisado','Petrificado','Surdo'];
const TABS=[['personagem','Herói'],['principal','Principal'],['combate','Combate'],['magias','Magias'],['itens','Itens'],['notas','Notas']];
const COINS=[['pc','PC'],['pp','PP'],['pe','PE'],['po','PO'],['pl','PL']];

/* ---------- estado ---------- */
const MUT=new Set(['sv','sk','insp','cond','ds','slot','prep','add','rm','dmg','heal','hd','long','eq','uneq','acauto','xpadd','lvl','conceder']);
const S={me:null,mesas:[],chars:new Map(),view:null,locked:true,mode:0,tab:'personagem',eqPick:null,lvl:null,page:'inicio',mesaAtual:null,mesaTab:'mesa',alvo:null,loc:new Map(),locOk:false,cfgTab:'conta',cfgMesa:null,online:true,authMode:'login',pending:new Set(),busy:new Set(),wikiSel:null,wikiQ:'',wEdit:null};
let hist=[],lastPush=0,toastT,pendR=false,arm=null,refreshT=null,es=null;
const saveT={};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

/* ---------- servidor ---------- */
async function api(method,url,body){
  const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(j.error||'Erro '+r.status),{status:r.status});
  return j}
function fromServer(x){const c=fix(x.data||{});c.id=x.id;c.mesa=x.mesa||'';c._owner=x.owner;c._ownerName=x.ownerName;c._lib=!!x.lib;c.upd=x.upd;return c}
function pack(c){const o={};for(const k of Object.keys(c))if(!k.startsWith('_')&&!['id','mesa','upd','demo'].includes(k))o[k]=c[k];return o}
function applyState(st){
  S.me=st.me;S.mesas=st.mesas||[];const seen=new Set();
  for(const x of st.chars||[]){seen.add(x.id);const local=S.chars.get(x.id);
    if(local&&(S.pending.has(x.id)||S.busy.has(x.id))){local._lib=local.mesa===x.mesa?!!x.lib:local._lib;local._ownerName=x.ownerName;continue}
    S.chars.set(x.id,fromServer(x))}
  for(const [id,c] of S.chars)if(!seen.has(id)&&!c._new)S.chars.delete(id);
  if(!C())S.view=(myChars()[0]||[...S.chars.values()][0]||{}).id||null;
  applyTheme();prefs()}
async function refresh(){try{applyState(await api('GET','/api/state'));setConn(true);softRender();loadLoc()}catch(e){if(e.status===401)return showAuth();setConn(false)}}
function refreshSoon(){clearTimeout(refreshT);refreshT=setTimeout(refresh,250)}
function listen(){if(es)es.close();if(!window.EventSource)return setInterval(refresh,8000);
  es=new EventSource('/api/events');es.onmessage=e=>{if(e.data==='wiki'){WK.stale=true;if(naWikiAgora())loadWiki()}else refreshSoon()};es.onopen=()=>{setConn(true);refreshSoon();WK.stale=true;if(naWikiAgora())loadWiki()};es.onerror=()=>setConn(false)}
function setConn(ok){if(S.online===ok)return;S.online=ok;document.body.classList.toggle('offline',!ok);if(S.me&&S.page==='ficha'&&C())head();status()}
function statusText(){return S.online?'Conectado ao servidor da mesa':'Sem conexão com o servidor: as mudanças serão enviadas quando ele voltar'}
function status(){const s=$('st');if(s)s.textContent=statusText()}
function prefs(){try{localStorage.setItem('fichas5e-prefs',JSON.stringify({locked:S.locked,view:S.view,tab:S.tab}))}catch(e){}}
function loadPrefs(){try{const p=JSON.parse(localStorage.getItem('fichas5e-prefs')||'{}');if(typeof p.locked==='boolean')S.locked=p.locked;if(p.view)S.view=p.view;if(p.tab)S.tab=p.tab}catch(e){}}

/* ---------- quem pode o quê ---------- */
const meId=()=>S.me&&S.me.id;
const mesaOf=id=>S.mesas.find(m=>m.id===id);
const isMestre=m=>!!m&&m.mestre===meId();
const isOwn=c=>!!c&&c._owner===meId();
const canWrite=c=>!!c&&(isOwn(c)||isMestre(mesaOf(c.mesa)));
const RO=()=>!canWrite(C());
const C=()=>S.chars.get(S.view)||null;
const myChars=()=>[...S.chars.values()].filter(isOwn);
const isLib=c=>!!c._lib;

/* ---------- gravação ---------- */
function save(c){c=c||C();if(!c||!canWrite(c))return;if(c.acAuto){const v=caAuto(c);if(v!=null)c.ac=v}c._edit=Date.now();S.pending.add(c.id);clearTimeout(saveT[c.id]);saveT[c.id]=setTimeout(()=>flushChar(c.id),700)}
async function flushChar(id){const c=S.chars.get(id);if(!c)return;
  if(S.busy.has(id)){saveT[id]=setTimeout(()=>flushChar(id),400);return}
  S.busy.add(id);const edit=c._edit;
  try{let res;
    if(c._new){res=await api('POST','/api/chars',{id:c.id,data:pack(c),mesa:c.mesa});c._new=false;if(res.id!==c.id){S.chars.delete(c.id);c.id=res.id;S.chars.set(c.id,c);if(S.view===id)S.view=c.id}}
    else res=await api('PUT','/api/chars/'+id,{data:pack(c),mesa:c.mesa});
    c.upd=res.upd;if('lib' in res)c._lib=res.lib;if(c._edit===edit)S.pending.delete(c.id);setConn(true)}
  catch(e){if(e.status===401){S.busy.delete(id);return showAuth()}
    if(e.status>=400&&e.status<500&&e.status!==408&&e.status!==429){S.pending.delete(id);toast(`<div><b>Não foi possível salvar</b><small>${esc(e.message)}</small></div>`);refreshSoon()}
    else{setConn(false);saveT[id]=setTimeout(()=>flushChar(id),4000)}}
  S.busy.delete(id)}
async function act(method,url,body,okMsg){try{const st=await api(method,url,body);if(st&&st.me)applyState(st);setConn(true);render();if(okMsg)toast(`<div><b>${okMsg}</b></div>`);return true}
  catch(e){if(e.status===401)return showAuth();toast(`<div><b>${esc(e.message)}</b></div>`);return false}}
window.addEventListener('beforeunload',e=>{if(S.pending.size||(S.wEdit&&S.wEdit.dirty)){e.preventDefault();e.returnValue=''}});

/* ---------- campos ---------- */
function f(p,o={}){const c=C();const v=getP(c,p);const ro=(S.locked&&!o.live)||RO()?' readonly':'';
  return `<input data-k="${p}"${o.n?' type="number" data-n':''} value="${esc(v)}"${o.ph?` placeholder="${esc(o.ph)}"`:''}${o.al?` aria-label="${esc(o.al)}"`:''}${o.list&&!ro?` list="${o.list}"`:''}${ro}>`}
function ta(p,ph){return `<textarea data-k="${p}" placeholder="${esc(ph||'')}"${S.locked||RO()?' readonly':''}>${esc(getP(C(),p))}</textarea>`}
function sel(p,opts){const v=getP(C(),p);return `<select data-k="${p}">${opts.map(([k,t])=>`<option value="${esc(k)}"${String(k)===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select>`}
const mod=s=>Math.floor(((+s||0)-10)/2);
const sg=n=>(n>=0?'+':'')+n;
const prof=c=>Math.ceil(Math.max(1,+c.level||1)/4)+1;
const uidGen=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function blank(n){return{id:'c'+uidGen(),name:n||'Novo personagem',mesa:'',cls:'',level:1,race:'',bg:'',align:'',xp:0,ab:{for:10,des:10,con:10,int:10,sab:10,car:10},sv:{},sk:{},ac:10,initB:0,speed:9,hp:{max:10,cur:10,tmp:0},hd:{die:'d8',used:0},death:{s:0,f:0},cond:[],insp:false,atk:[],spAb:'int',slots:Array.from({length:9},()=>({max:0,used:0})),spells:[],coins:{pc:0,pp:0,pe:0,po:0,pl:0},items:[],profs:'',feats:'',traits:'',ideals:'',bonds:'',flaws:'',story:'',notes:'',clsId:'',sub:'',nivelLib:0,acAuto:false,historico:[],upd:Date.now()}}
function fix(c){const b=blank();const o=Object.assign(blank(),c);for(const k of['ab','hp','hd','death','coins','sv','sk'])o[k]=Object.assign({},b[k],c[k]||{});o.slots=Array.from({length:9},(_,i)=>Object.assign({max:0,used:0},(c.slots||[])[i]||{}));for(const k of['atk','spells','items','cond','historico'])if(!Array.isArray(o[k]))o[k]=[];if(typeof o.mesa!=='string')o.mesa='';return o}
function sample(){const c=blank('Lyra Vento-Frio');Object.assign(c,{cls:'Maga',level:5,race:'Alta elfa',bg:'Sábio',align:'Neutra e boa',xp:6500,ab:{for:8,des:14,con:13,int:18,sab:12,car:10},sv:{int:1,sab:1},sk:{arca:2,hist:1,inve:1,perc:1},ac:12,speed:9,hp:{max:27,cur:21,tmp:0},hd:{die:'d6',used:1},spAb:'int',
atk:[{n:'Adaga',b:'+5',d:'1d4+2',t:'perfurante'},{n:'Raio de Fogo',b:'+7',d:'2d10',t:'fogo, 36 m'}],
spells:[['Raio de Fogo',0],['Mãos Mágicas',0],['Luz',0],['Prestidigitação',0],['Escudo Arcano',1],['Mísseis Mágicos',1],['Armadura Arcana',1],['Detectar Magia',1],['Passo Nebuloso',2],['Teia',2],['Bola de Fogo',3],['Contramágica',3]].map(([n,l])=>({n,l,p:true})),
items:[{n:'Grimório',q:1,w:1.5},{n:'Bolsa de componentes',q:1,w:1},{n:'Adaga',q:2,w:.5},{n:'Mochila de estudioso',q:1,w:5},{n:'Poção de cura',q:2,w:.25}],
coins:{pc:12,pp:15,pe:0,po:42,pl:0},profs:'Idiomas: comum, élfico, dracônico, anão.\nArmas: adagas, dardos, fundas, bordões, bestas leves.',
feats:'Recuperação Arcana (1/dia): recupera espaços somando até 3 níveis num descanso curto.\nTradição Arcana: Escola de Evocação — Esculpir Magias.\nAncestral feérico, Visão no escuro (18 m), Transe.',
traits:'Anota tudo num caderno de capa vermelha. Não resiste a um enigma.',ideals:'Conhecimento: o caminho para o poder passa pelo saber.',bonds:'O grimório do meu mestre desaparecido.',flaws:'Subestimo quem não estudou.',notes:'Sessão 7: o selo na cripta tem runas dracônicas.'});
c.slots[0]={max:4,used:1};c.slots[1]={max:3,used:0};c.slots[2]={max:2,used:1};c.demo=true;return c}


const getP=(o,p)=>p.split('.').reduce((x,k)=>x==null?x:x[k],o);
function setP(o,p,v){const k=p.split('.');let x=o;for(let i=0;i<k.length-1;i++)x=x[k[i]];x[k.at(-1)]=v}
const saveV=(c,a)=>mod(c.ab[a])+(c.sv[a]?prof(c):0);
const skillV=(c,k)=>mod(c.ab[SKM[k][2]])+prof(c)*(+c.sk[k]||0);
function calc(k,c){const [t,a]=k.split(':');switch(t){
case'mod':return sg(mod(c.ab[a]));case'save':return sg(saveV(c,a));case'skill':return sg(skillV(c,a));
case'prof':return sg(prof(c));case'init':return sg(mod(c.ab.des)+(+c.initB||0));case'pp':return 10+skillV(c,'perc');
case'dc':return 8+prof(c)+mod(c.ab[c.spAb]);case'satk':return sg(prof(c)+mod(c.ab[c.spAb]));
case'hd':return (Math.max(1,+c.level||1)-(+c.hd.used||0))+'/'+Math.max(1,+c.level||1);
case'wt':{const w=c.items.reduce((s,i)=>s+(+i.q||0)*(+i.w||0),0);return w.toLocaleString('pt-BR',{maximumFractionDigits:2})+' / '+((+c.ab.for||0)*7.5).toLocaleString('pt-BR')+' kg'}
case'hpt':return (+c.hp.cur||0)+(+c.hp.tmp?'+'+c.hp.tmp:'');case'ac':return c.ac;case'spd':return c.speed+' m';}return''}



/* ---------- abas ---------- */
const d=k=>`<span data-d="${k}">${calc(k,C())}</span>`;
const L=(t,inner,cls='')=>`<div class="${cls}"><label>${t}</label>${inner}</div>`;
const card=(t,inner,extra='')=>`<section class="card"><h2>${t}${extra}</h2>${inner}</section>`;
// "?" no título de um cartão da ficha: abre a regra na wiki (alvo: página ou página#seção)
const aj=(alvo,nome)=>` <a class="aj" href="#wiki/${alvo.replace('#','/')}" title="Regras: ${esc(nome)}" aria-label="Regras: ${esc(nome)}">?</a>`;

/* ---------- abas ---------- */
function mesaField(c){const m=mesaOf(c.mesa);
  if(S.locked||RO()||!isOwn(c))return L('Mesa',`<input readonly value="${esc(m?m.nome:'Sem mesa')}">`,'span2');
  if(!S.mesas.length)return L('Mesa',`<p class="note" style="margin:6px 0 0">Entre numa mesa pelo Início com o código do mestre.</p>`,'span2');
  return L('Mesa',sel('mesa',[['','Sem mesa'],...S.mesas.map(m=>[m.id,m.nome])]),'span2')}
function tPrincipal(c){
  const id=card('Identidade',`<div class="g2">${L('Nome',f('name'),'span2')}${mesaField(c)}${L('Classe',f('cls',{ph:'Ex.: Guerreiro'}))}${L('Nível',f('level',{n:1}))}${L('Raça',f('race'))}${L('Antecedente',f('bg'))}${L('Alinhamento',f('align'))}${L('XP',f('xp',{n:1}))}</div>`);
  const abs=card('Atributos'+aj('atributos','Atributos'),`<div class="abs">${AB.map(([k,s,n])=>`<div class="ab"><button data-a="rl" data-v="mod:${k}" aria-label="Rolar ${n}"><span class="n">${s}</span><span class="m" data-d="mod:${k}">${calc('mod:'+k,c)}</span></button>${f('ab.'+k,{n:1,al:n})}</div>`).join('')}</div><p class="foot">Toque no modificador para rolar o teste.</p>`,`<small>Prof. ${d('prof')}</small>`);
  const sv=card('Salvaguardas'+aj('salvaguardas','Salvaguardas'),`<div class="rows">${AB.map(([k,s,n])=>`<div class="row"><button class="dot ${c.sv[k]?'p1':''}" data-a="sv" data-v="${k}" aria-label="Proficiência em ${n}"><i></i></button><button class="rl" data-a="rl" data-v="save:${k}">${n}</button><span class="val" data-d="save:${k}">${calc('save:'+k,c)}</span></div>`).join('')}</div>`);
  const sk=card('Perícias'+aj('pericias','Perícias'),`<div class="rows">${SK.map(([k,n,a])=>`<div class="row"><button class="dot p${c.sk[k]||0}" data-a="sk" data-v="${k}" aria-label="Proficiência em ${n}"><i></i></button><button class="rl" data-a="rl" data-v="skill:${k}">${n} <em>${ABN[a]}</em></button><span class="val" data-d="skill:${k}">${calc('skill:'+k,c)}</span></div>`).join('')}</div><p class="foot">Percepção passiva ${d('pp')}. Toque no círculo: proficiente, especialista, nenhum.</p>`);
  const pr=card('Proficiências e idiomas',ta('profs','Armaduras, armas, ferramentas, idiomas'));
  return `<div class="cols"><div class="stackc">${abs}${sv}${pr}</div><div class="stackc">${sk}</div><div class="stackc">${id}</div></div>`}
function tCombate(c){const lk=S.locked||RO();
  const hp=card('Pontos de vida'+aj('dano-e-cura','Dano, cura e morte'),`<div class="hpbig">${f('hp.cur',{n:1,live:1,al:'PV atuais'})}<span>/ ${lk?esc(c.hp.max):''}</span>${lk?'':f('hp.max',{n:1,al:'PV máximos'})}</div>
  <div class="g2" style="margin-bottom:10px">${L('PV temporários',f('hp.tmp',{n:1,live:1}))}${L('Dados de vida',`<div style="display:flex;gap:6px;align-items:center"><span class="val" data-d="hd" style="min-width:4ch;text-align:left">${calc('hd',c)}</span>${sel('hd.die',['d6','d8','d10','d12'].map(x=>[x,x]))}</div>`)}</div>
  ${RO()?'':`<div class="amt"><input id="amt" type="number" inputmode="numeric" placeholder="Valor" aria-label="Valor de dano ou cura"><button class="btn warn" data-a="dmg">Dano</button><button class="btn" data-a="heal">Cura</button></div>
  <div class="btns" style="margin-top:10px"><button class="btn sm" data-a="hd">Gastar dado de vida</button><button class="btn sm" data-a="long">Descanso longo</button></div>`}`);
  const st=card('Defesa e movimento'+aj('combate','Combate'),`<div class="big3"><div><label>CA</label>${f('ac',{n:1})}</div><div><label>Iniciativa</label><button class="roll" style="text-align:center;padding:0" data-a="rl" data-v="init"><b data-d="init">${calc('init',c)}</b></button><div class="ed">${f('initB',{n:1,al:'Bônus extra de iniciativa'})}</div></div><div><label>Desloc. (m)</label>${f('speed',{n:1})}</div></div>
  <div class="row" style="margin-top:8px"><button class="chk ${c.insp?'on':''}" data-a="insp" aria-label="Inspiração"><i></i></button><span style="flex:1">Inspiração</span></div>`);
  const ds=card('Salvaguardas contra morte'+aj('dano-e-cura#salvaguardas-contra-morte','Salvaguardas contra morte'),`<div class="g2"><div><label>Sucessos</label><div class="pips">${[0,1,2].map(i=>`<button class="pip g ${c.death.s>i?'on':''}" data-a="ds" data-v="s${i}" aria-label="Sucesso ${i+1}"></button>`).join('')}</div></div><div><label>Falhas</label><div class="pips">${[0,1,2].map(i=>`<button class="pip ${c.death.f>i?'on':''}" data-a="ds" data-v="f${i}" aria-label="Falha ${i+1}"></button>`).join('')}</div></div></div>${RO()?'':'<div class="btns" style="margin-top:10px"><button class="btn sm" data-a="rl" data-v="death">Rolar d20</button></div>'}`);
  const cd=card('Condições'+aj('condicoes','Condições'),`<div class="chips">${COND.map(n=>`<button class="chip ${c.cond.includes(n)?'on':''}" data-a="cond" data-v="${n}">${n}</button>`).join('')}</div>${lk&&!c.cond.length?'<p class="foot" style="margin:0">Nenhuma condição ativa.</p>':''}${condResumo(c)}`);
  const at=card('Ataques'+aj('combate#fazer-um-ataque','Fazer um ataque'),`${c.atk.length?'':'<p class="note">Nenhum ataque cadastrado.</p>'}<div>${c.atk.map((a,i)=>`<div class="item atk"><div class="vw"><button class="roll" data-a="atk" data-v="${i}">${esc(a.n)||'Ataque'}</button></div><div class="ed">${f(`atk.${i}.n`,{ph:'Nome',al:'Nome do ataque'})}</div>${f(`atk.${i}.b`,{ph:'+5',al:'Bônus de ataque'})}${f(`atk.${i}.d`,{ph:'1d8+3',al:'Dano'})}<button class="x ed" data-a="rm" data-v="atk.${i}" aria-label="Remover">×</button><div style="grid-column:1/-1;margin-top:-6px">${lk?`<span class="foot" style="margin:0">${esc(a.t)}</span>`:f(`atk.${i}.t`,{ph:'Tipo, alcance, notas',al:'Notas'})}</div></div>`).join('')}</div><div class="btns ed" style="margin-top:8px"><button class="btn sm" data-a="add" data-v="atk">Adicionar ataque</button></div>${c.atk.length?'<p class="foot vw">Toque no nome para rolar ataque e dano.</p>':''}`);
  return `<div class="cols"><div class="stackc">${hp}${ds}</div><div class="stackc">${st}${at}</div><div class="stackc">${cd}</div></div>`}
function tMagias(c){const lk=S.locked||RO();loadDados('magias');
  const hdr=card('Conjuração'+aj('magia#cd-e-ataque-de-magia','CD e ataque de magia'),`<div class="big3"><div><label>Atributo</label>${sel('spAb',AB.map(a=>[a[0],a[1]]))}</div><div><label>CD</label><b data-d="dc">${calc('dc',c)}</b></div><div><label>Ataque</label><button class="roll" style="text-align:center;padding:0" data-a="rl" data-v="satk"><b data-d="satk">${calc('satk',c)}</b></button></div></div>`);
  const lv=c.slots.map((s,i)=>({...s,i})).filter(s=>!lk||+s.max>0);
  const sl=card('Espaços de magia'+aj('magia#espacos-por-nivel','Espaços por nível'),`${lv.length?'':'<p class="note">Sem espaços de magia.</p>'}${lv.map(s=>`<div class="slot"><b>${s.i+1}º nível</b><div class="pips">${Array.from({length:Math.min(+s.max||0,9)},(_,j)=>`<button class="pip ${j<(+s.used||0)?'on':''}" data-a="slot" data-v="${s.i}.${j}" aria-label="Espaço ${j+1} de ${s.i+1}º nível"></button>`).join('')}</div><div class="ed">${f(`slots.${s.i}.max`,{n:1,al:`Máximo de ${s.i+1}º nível`})}</div></div>`).join('')}<p class="foot">Espaço preenchido = gasto. O descanso longo restaura todos.</p>`);
  const by={};c.spells.forEach((s,i)=>{(by[+s.l||0]=by[+s.l||0]||[]).push([s,i])});
  const lvls=Object.keys(by).map(Number).sort((a,b)=>a-b);
  const lst=card('Magias'+aj('magia','Magia'),`${c.spells.length?'':'<p class="note">Nenhuma magia cadastrada.</p>'}${lvls.map(l=>`<div class="lvh">${l?l+'º nível':'Truques'}</div>${by[l].filter(([s])=>!lk||s.p||!l).map(([s,i])=>`<div class="item sp"><button class="chk ${s.p||!l?'on':''}" data-a="prep" data-v="${i}" aria-label="Preparada"><i></i></button><div style="display:flex;gap:6px">${f(`spells.${i}.n`,{ph:'Nome da magia',al:'Nome da magia',list:'dl-magias'})}${ajDado('magias',s.n)}<div class="ed" style="width:76px;flex:none">${sel(`spells.${i}.l`,Array.from({length:10},(_,k)=>[k,k?k+'º':'T']))}</div></div><button class="x ed" data-a="rm" data-v="spells.${i}" aria-label="Remover">×</button></div>`).join('')}`).join('')}
  <div class="btns ed" style="margin-top:8px"><button class="btn sm" data-a="add" data-v="spells">Adicionar magia</button></div><p class="foot">${lk?'Mostrando truques e magias preparadas. Toque no ? para ler a magia.':'Marque o quadrado para preparar a magia. Ao digitar, a ficha sugere as magias da wiki.'}</p>${lk?'':sugestoes('magias')}`);
  return `<div class="cols"><div class="stackc">${hdr}${sl}</div><div class="stackc">${lst}</div></div>`}
function tItens(c){loadDados('itens-magicos');loadDados('equipamento');
  const co=card('Moedas'+aj('equipamento#moedas','Moedas'),`<div class="g5">${COINS.map(([k,n])=>L(n,f('coins.'+k,{n:1,live:1}))).join('')}</div>`);
  const it=card('Equipamento'+aj('equipamento','Equipamento'),`${c.items.length?'':'<p class="note">Mochila vazia.</p>'}<div class="item inv" style="padding:0 0 4px;border:0"><label>Item</label><label>Qtd.</label><label>Peso (kg)</label></div><div>${c.items.map((x,i)=>`<div class="item inv"><div class="nmw">${f(`items.${i}.n`,{ph:'Item',al:'Item',list:'dl-itens'})}${ajDado('itens-magicos',x.n)||ajDado('equipamento',x.n)}</div>${f(`items.${i}.q`,{n:1,live:1,al:'Quantidade'})}${f(`items.${i}.w`,{n:1,al:'Peso unitário'})}<button class="x ed" data-a="rm" data-v="items.${i}" aria-label="Remover">×</button></div>`).join('')}</div><div class="btns ed" style="margin-top:8px"><button class="btn sm" data-a="add" data-v="items">Adicionar item</button></div>${S.locked||RO()?'':sugestoes('itens')}`,`<small data-d="wt">${calc('wt',c)}</small>`);
  return `<div class="cols"><div class="stackc">${it}</div><div class="stackc">${co}</div></div>`}
function tNotas(){
  return `<div class="cols"><div class="stackc">${card('Características e talentos',ta('feats','Habilidades de classe, raça e talentos'))}${card('História e aparência',ta('story'))}</div><div class="stackc">${card('Personalidade',`${L('Traços',ta('traits'))}${L('Ideais',ta('ideals'))}${L('Vínculos',ta('bonds'))}${L('Defeitos',ta('flaws'))}`)}</div><div class="stackc">${card('Anotações da campanha',ta('notes','NPCs, pistas, missões'))}</div></div>`}


/* ---------- aba Herói: tela de personagem ---------- */
// regras de nível e equipamento em regras.js; classes, armaduras e armas vêm das listas da wiki
const RG=window.Regras;
const DEQ=()=>({armaduras:WK.dados.armaduras,armas:WK.dados.armas});
const classeDe=c=>WK.dados.classes?RG.acharClasse(WK.dados.classes,c):null;
const caAuto=c=>WK.dados.armaduras&&WK.dados.classes?RG.caEquipada(c,DEQ(),classeDe(c)):null;
const loadHeroi=()=>['classes','armaduras','armas'].forEach(loadDados);
const fmtN=n=>(+n||0).toLocaleString('pt-BR');
const SLOTIC={cabeca:'<path d="M4 16a8 8 0 0 1 16 0v3H4z"/><path d="M12 8V5M9 16h6"/>',pescoco:'<path d="M6 3c0 6 3 9 6 9s6-3 6-9"/><circle cx="12" cy="16" r="3"/>',capa:'<path d="M8 3h8l1 4 3 14H4L7 7z"/><path d="M12 3v18"/>',
  armadura:'<path d="M8 3 4 6v6l2 1v8h12v-8l2-1V6l-4-3-4 3z"/>',luvas:'<path d="M7 21v-6l-2.5-4a1.5 1.5 0 0 1 2.6-1.5L9 12V5a1.5 1.5 0 0 1 3 0v5V4a1.5 1.5 0 0 1 3 0v6V6a1.5 1.5 0 0 1 3 0v9l-2 6z"/>',cinto:'<path d="M2 9h20v6H2z"/><path d="M9 8h6v8H9z"/>',
  botas:'<path d="M7 3h6v10l6 3v5H5V13z"/>',mao1:'<path d="M20 4 9 15"/><path d="M15 4h5v5"/><path d="M7 13l4 4M5 19l3-3"/>',mao2:'<path d="M12 3 20 6v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',anel1:'<circle cx="12" cy="14" r="6"/><path d="M9 5h6l-3 3z"/>'};
SLOTIC.anel2=SLOTIC.anel1;
const slotIco=k=>`<svg viewBox="0 0 24 24" aria-hidden="true">${SLOTIC[k]}</svg>`;
function slotBtn(c,k){const i=c.items.findIndex(x=>x.eq===k),it=c.items[i];const on=S.eqPick===k;
  const a=it&&RG.porNome(WK.dados.armas,it.n),ar=it&&RG.porNome(WK.dados.armaduras,it.n);
  const det=a?`${a.dano} ${a.tipo}`.trim():ar?(ar.tipo==='escudo'?'+'+ar.ca+' CA':'CA '+ar.ca+(ar.desMax===0?'':ar.desMax?' + Des (máx. '+ar.desMax+')':' + Des')):'';
  return `<button class="eqs${it?' full':''}${on?' sel':''}" data-a="eqslot" data-v="${k}" aria-label="${esc(RG.SLOT_NOME[k])}: ${esc(it?it.n:'vazio')}" aria-expanded="${on}">${slotIco(k)}<span><small>${esc(RG.SLOT_NOME[k])}</small>${it?`<b>${esc(it.n)}</b>${det?`<em>${esc(det)}</em>`:''}`:''}</span></button>`}
// lista que abre ao tocar num slot: tirar o que está nele ou pôr um item da mochila
function eqPicker(c){const k=S.eqPick;if(!k)return '';const ro=RO();
  const cur=c.items.map((x,i)=>[x,i]).filter(([x])=>x.eq===k),bag=c.items.map((x,i)=>[x,i]).filter(([x])=>!x.eq&&x.n);
  const sug=bag.filter(([x])=>RG.slotSugerido(x,DEQ()).replace(/\d$/,'')===k.replace(/\d$/,'')),outros=bag.filter(x=>!sug.includes(x));
  const li=([x,i],btn)=>`<div class="eqli"><span>${esc(x.n)}${+x.q>1?` <small>×${x.q}</small>`:''}</span>${ro?'':btn(i)}</div>`;
  return `<div class="eqpick"><div class="eqph"><b>${esc(RG.SLOT_NOME[k])}</b><button class="x" data-a="eqslot" data-v="${k}" aria-label="Fechar">×</button></div>
    ${cur.map(e=>li(e,i=>`<button class="btn sm" data-a="uneq" data-v="${i}">Tirar</button>`)).join('')}
    ${sug.length?`<label>Da mochila, combina com este lugar</label>${sug.map(e=>li(e,i=>`<button class="btn sm pri" data-a="eq" data-v="${i}|${k}">Equipar</button>`)).join('')}`:''}
    ${outros.length?`<label>Outros itens da mochila</label>${outros.map(e=>li(e,i=>`<button class="btn sm" data-a="eq" data-v="${i}|${k}">Equipar</button>`)).join('')}`:''}
    ${!cur.length&&!bag.length?'<p class="note">Mochila vazia. Cadastre os itens na aba Itens.</p>':''}</div>`}
const DOLL=`<svg class="doll" viewBox="0 0 100 210" aria-hidden="true"><circle cx="50" cy="24" r="15"/><path d="M28 50q22-12 44 0l8 52-10 4-6-38v56l6 72H58l-8-60-8 60H30l6-72V68l-6 38-10-4z"/></svg>`;
function tHeroi(c){loadHeroi();if(c.spells.length)loadDados('magias');
  const cl=classeDe(c),lv=Math.max(1,+c.level||1),ro=RO(),mestre=isMestre(mesaOf(c.mesa));
  const xp=+c.xp||0,a=RG.xpDoNivel(lv),b=lv<20?RG.xpDoNivel(lv+1):null,pct=b?Math.max(0,Math.min(100,(xp-a)/(b-a)*100)):100,pode=RG.podeSubir(c);
  const hist=(c.historico||[]).slice().reverse();
  const hero=`<section class="card hero"><div class="htop"><div class="medal"><span aria-hidden="true">${esc(ini(c.name))}</span><b class="hlv" title="Nível ${lv}" aria-label="Nível ${lv}">${lv}</b></div><div class="hid"><h2>${esc(c.name||'Sem nome')}</h2><p>${esc([c.cls||(cl&&cl.nome),c.sub].filter(Boolean).join(' · ')||'Sem classe')}</p><p>${esc([c.race,c.bg].filter(Boolean).join(' · '))}</p></div></div>
    ${!cl&&WK.dados.classes&&!ro?L('Classe nas regras',sel('clsId',[['','Escolha para usar o assistente de nível'],...WK.dados.classes.map(x=>[x.id,x.nome])])):''}
    <div class="xp" role="progressbar" aria-label="Experiência" aria-valuemin="${a}" aria-valuemax="${b||a}" aria-valuenow="${xp}"><div class="xpb"><i style="width:${pct}%"></i></div><div class="xpt"><span>${fmtN(xp)} XP</span><span>${b?'nível '+(lv+1)+' com '+fmtN(b):'nível máximo'}</span></div></div>
    ${ro?'':`<div class="amt xpadd"><input id="xpamt" type="number" inputmode="numeric" placeholder="+ XP" aria-label="XP ganho"><button class="btn" data-a="xpadd">Somar XP</button></div>`}
    ${pode&&!ro?`<button class="btn lvup" data-a="lvl">${ico('plus')}Subir para o nível ${lv+1}</button>`:''}
    ${+c.nivelLib?`<p class="foot">O mestre concedeu ${c.nivelLib===1?'um nível':c.nivelLib+' níveis'}${pode?'.':' — '}${pode?'':'falta o XP.'}</p>`:''}
    ${mestre&&lv<20?`<div class="btns" style="margin-top:8px"><button class="btn sm" data-a="conceder">Conceder um nível</button>${+c.nivelLib?'<button class="btn sm" data-a="conceder" data-v="-1">Retirar</button>':''}</div>`:''}
    ${hist.length?`<details class="hhist"><summary>Histórico de níveis</summary>${hist.map(h=>`<div><b>Nível ${h.n}</b> <span>+${h.pv} PV${h.asi?' · '+Object.entries(h.asi).map(([k,v])=>ABN[k]+' +'+v).join(', '):''}${h.talento?' · '+esc(h.talento):''}</span></div>`).join('')}</details>`:''}</section>`;
  const abs=card('Atributos'+aj('atributos','Atributos'),`<div class="habs">${AB.map(([k,s,n])=>`<button data-a="rl" data-v="mod:${k}" aria-label="Rolar ${n}"><small>${s}</small><b data-d="mod:${k}">${calc('mod:'+k,c)}</b><span>${esc(c.ab[k])}</span></button>`).join('')}</div><p class="foot">Toque para rolar o teste. Mude os valores na aba Principal.</p>`);
  const dollL=['cabeca','pescoco','capa','armadura'],dollR=['luvas','cinto','botas'],dollB=['mao1','mao2','anel1','anel2'];
  const caE=caAuto(c),caTxt=c.acAuto&&caE!=null?caE:c.ac;
  const eq=card('Equipamento'+aj('armaduras','Armaduras'),`<div class="eqgrid"><div class="eqc">${dollL.map(k=>slotBtn(c,k)).join('')}</div><div class="eqm">${DOLL}</div><div class="eqc">${dollR.map(k=>slotBtn(c,k)).join('')}
      <div class="eqca"><div class="shield">${shield()}<b data-d="ac">${esc(caTxt)}</b></div><button class="hchip sm${c.acAuto?' on':''}" data-a="acauto" aria-pressed="${!!c.acAuto}" title="A CA segue o equipamento">${c.acAuto?'CA auto':'CA manual'}</button></div></div>
    <div class="eqb">${dollB.map(k=>slotBtn(c,k)).join('')}</div></div>${eqPicker(c)}
    ${!c.acAuto&&caE!=null&&caE!==+c.ac?`<p class="foot">Pelo equipamento a CA seria ${caE}. ${ro?'':'Toque em “CA manual” para seguir o equipamento.'}</p>`:''}`,`<small data-d="wt">${calc('wt',c)}</small>`);
  const bag=c.items.map((x,i)=>[x,i]).filter(([x])=>!x.eq&&x.n);
  const mo=card('Mochila'+aj('equipamento','Equipamento'),`${bag.length?`<div class="bag">${bag.map(([x,i])=>{const s=RG.slotSugerido(x,DEQ());return `<div class="eqli"><span>${esc(x.n)}${+x.q>1?` <small>×${x.q}</small>`:''}${ajDado('itens-magicos',x.n)||ajDado('equipamento',x.n)}</span>${s&&!ro?`<button class="btn sm" data-a="eq" data-v="${i}|${s==='anel1'&&c.items.some(y=>y.eq==='anel1')?'anel2':s}">Equipar</button>`:''}</div>`}).join('')}</div>`:'<p class="note">Nada na mochila.</p>'}<div class="btns" style="margin-top:8px"><button class="btn sm" data-a="tab" data-v="itens">Editar itens e moedas</button></div>`);
  const tile=(t,v,extra='')=>`<div class="stt"><small>${t}</small><b>${v}</b>${extra}</div>`;
  const conj=c.spells.length||c.slots.some(s=>+s.max>0)||(cl&&cl.conjuracao);
  const st=card('Combate',`<div class="stg">${tile('PV',`<span data-d="hpt">${calc('hpt',c)}</span><span class="of">/ ${esc(c.hp.max)}</span>`,`<div class="minibar"><i style="width:${Math.max(0,Math.min(100,(+c.hp.cur||0)/Math.max(1,+c.hp.max||1)*100))}%"></i></div>`)}
    <button class="stt" data-a="rl" data-v="init"><small>Iniciativa</small><b data-d="init">${calc('init',c)}</b></button>${tile('Proficiência',d('prof'))}${tile('Deslocamento',d('spd'))}${tile('Percepção passiva',d('pp'))}${tile('Dados de vida',`<span data-d="hd">${calc('hd',c)}</span>`,`<em>${esc(c.hd.die)}</em>`)}
    ${conj?`${tile('CD de magia',d('dc'))}<button class="stt" data-a="rl" data-v="satk"><small>Ataque mágico</small><b data-d="satk">${calc('satk',c)}</b></button>`:''}</div>
    ${c.atk.length?`<div class="hatk">${c.atk.map((x,i)=>`<button class="hchip" data-a="atk" data-v="${i}">${esc(x.n||'Ataque')} <em>${esc(x.b)} · ${esc(x.d)}</em></button>`).join('')}</div>`:''}`);
  let mg='';
  if(conj){const sl=c.slots.map((s,i)=>({...s,i})).filter(s=>+s.max>0);
    const prep=c.spells.map((s,i)=>[s,i]).filter(([s])=>s.n&&(s.p||!+s.l)).sort((x,y)=>(+x[0].l||0)-(+y[0].l||0));
    mg=card('Magias'+aj('magia','Magia'),`${sl.length?`<div class="hslots">${sl.map(s=>`<div><small>${s.i+1}º</small><div class="pips">${Array.from({length:Math.min(+s.max||0,9)},(_,j)=>`<button class="pip ${j<(+s.used||0)?'on':''}" data-a="slot" data-v="${s.i}.${j}" aria-label="Espaço ${j+1} de ${s.i+1}º nível"></button>`).join('')}</div></div>`).join('')}</div>`:''}
      ${prep.length?`<div class="hot">${prep.map(([s])=>{const x=acharDado('magias',s.n);const inner=`<i>${+s.l?s.l:'T'}</i><span>${esc(s.n)}</span>`;return x?`<a class="hsp" href="#wiki/lista-de-magias/${esc(x.slug)}" title="${esc(x.escola||'')}">${inner}</a>`:`<span class="hsp">${inner}</span>`}).join('')}</div>`:'<p class="note">Nenhuma magia preparada.</p>'}
      <p class="foot">Truques e magias preparadas. Toque numa magia para ler a regra.</p>`,`<small>CD ${d('dc')} · ${d('satk')}</small>`)}
  const habs=cl?RG.habilidades(cl,lv):[];const por={};habs.forEach(h=>(por[h.n]=por[h.n]||[]).push(h));
  const hb=card('Habilidades de classe'+aj('classes','Classes'),cl?`<div class="habl">${Object.keys(por).map(Number).sort((x,y)=>y-x).map(n=>`<div class="hn"><i>${n}</i><div>${por[n].map(h=>`<p><b>${esc(h.sub&&c.sub?h.nome+' — '+c.sub:h.nome)}</b>${h.resumo?' '+esc(h.resumo):''}</p>`).join('')}</div></div>`).join('')}</div>${lv<20?`<p class="foot">No nível ${lv+1}: ${esc(RG.habilidades(cl,lv+1,lv+1).map(h=>h.nome).join(', ')||'sem habilidades novas')}.</p>`:''}`
    :`<p class="note">${WK.dados.classes?'Escolha a classe no cartão do personagem para ver as habilidades de cada nível.':'Carregando as classes…'}</p>`);
  return `<div class="cols heroi"><div class="stackc">${hero}${abs}</div><div class="stackc">${eq}${mo}</div><div class="stackc">${st}${mg}${hb}</div></div>`}

/* ---------- assistente de subir de nível ---------- */
function lvPassos(c,cl){const n=Math.max(1,+c.level||1)+1,nm=RG.novasMagias(cl,n);
  return [!classeDe(c)&&'classe','pv',cl&&RG.asiNoNivel(cl,n)&&'asi',cl&&RG.subclasseNoNivel(cl,n)&&'sub','hab',cl&&cl.conjuracao&&(nm.truques||nm.magias||cl.prepara)&&'magias','resumo'].filter(Boolean)}
const lvClasse=c=>S.lvl&&S.lvl.cls?RG.achar(WK.dados.classes,S.lvl.cls):classeDe(c);
function lvEscolhas(){const L=S.lvl,asi={};
  if(L.modo==='2'&&L.a1)asi[L.a1]=2;else if(L.modo==='11'&&L.a1&&L.a2&&L.a1!==L.a2){asi[L.a1]=1;asi[L.a2]=1}
  return{pv:L.pv,asi:L.modo==='talento'?null:asi,talento:L.modo==='talento'&&L.talento.trim()?{nome:L.talento,desc:L.tdesc}:null,subclasse:L.sub,magias:[...L.mag].map(n=>{const x=acharDado('magias',n);return{n,l:x?x.nivel:0}})}}
function lvAbrir(){const c=C();if(!c||RO())return;loadHeroi();loadDados('magias');
  if(!WK.dados.classes)return toast('<div><b>Carregando as regras das classes…</b><small>Tente de novo em instantes.</small></div>');
  S.lvl={i:0,pv:null,rolou:null,modo:'2',a1:'',a2:'',talento:'',tdesc:'',sub:c.sub||'',mag:new Set(),mq:'',cls:'',erro:''};
  let dl=$('lvdlg');if(!dl){dl=document.createElement('dialog');dl.id='lvdlg';dl.className='lvd';dl.addEventListener('close',()=>{S.lvl=null});dl.addEventListener('click',e=>{if(e.target===dl)dl.close()});document.body.appendChild(dl)}
  lvRender();dl.showModal()}
function lvValida(passo,c,cl){const L=S.lvl;
  if(passo==='classe'&&!L.cls)return 'Escolha a classe.';
  if(passo==='pv'&&L.pv==null)return 'Role o dado ou use a média.';
  if(passo==='asi'){if(L.modo==='talento')return L.talento.trim()?'':'Escreva o nome do talento.';if(L.modo==='2')return !L.a1?'Escolha o atributo.':(+c.ab[L.a1]||0)+2>20?'O atributo passaria de 20.':'';
    return !L.a1||!L.a2?'Escolha os dois atributos.':L.a1===L.a2?'Escolha dois atributos diferentes.':[L.a1,L.a2].some(k=>(+c.ab[k]||0)+1>20)?'Um atributo passaria de 20.':''}
  if(passo==='resumo'){try{RG.subirNivel(c,cl,lvEscolhas())}catch(e){return e.message}}
  return ''}
function lvRender(){const dl=$('lvdlg'),c=C(),V=S.lvl;if(!dl||!c||!L)return;const cl=lvClasse(c),passos=lvPassos(c,cl),i=Math.min(V.i,passos.length-1),p=passos[i],n=Math.max(1,+c.level||1)+1;
  const op=(on,a,v,t,sub='')=>`<button class="lvop${on?' on':''}" data-a="${a}" data-v="${esc(v)}" aria-pressed="${!!on}"><b>${t}</b>${sub?`<small>${sub}</small>`:''}</button>`;
  const abSel=(k,ex)=>`<select data-lv="${k}" aria-label="Atributo"><option value="">Atributo…</option>${AB.map(([a,,nm])=>`<option value="${a}"${V[k]===a?' selected':''}${ex===a?' disabled':''}>${nm} (${c.ab[a]})</option>`).join('')}</select>`;
  let body='';
  if(p==='classe')body=`<h3>Qual é a classe?</h3><p class="note">A ficha diz “${esc(c.cls||'sem classe')}”. Escolha a classe das regras para o assistente saber o dado de vida, as habilidades e as magias.</p><div class="lvops">${WK.dados.classes.map(x=>op(V.cls===x.id,'lvcls',x.id,esc(x.nome),x.dado+(x.conjuracao?' · conjurador':''))).join('')}</div>`;
  else if(p==='pv'){const md=RG.mod(c.ab.con),med=RG.DADO_MEDIO[cl.dado];
    body=`<h3>Pontos de vida</h3><p class="note">Dado de vida ${cl.dado} ${sg(md)} de Constituição (mínimo 1 por nível).</p><div class="lvops two">${op(V.pv==='media','lvpv','media','Média: '+Math.max(1,med+md),`${med} ${sg(md)}`)}${op(typeof V.pv==='number','lvpv','rolar',typeof V.pv==='number'?'Rolado: '+Math.max(1,V.pv+md):'Rolar '+cl.dado,typeof V.pv==='number'?`tirou ${V.pv} ${sg(md)} · toque para rolar de novo`:'arrisque a sorte')}</div>${V.rolou?`<div class="lvdie" aria-live="polite">${V.pv}</div>`:''}`}
  else if(p==='asi')body=`<h3>Aumento de atributo</h3><p class="note">No nível ${n}, +2 num atributo ou +1 em dois (máximo 20). Se o mestre usa talentos, dá para trocar por um.</p>
    <div class="lvops three">${op(V.modo==='2','lvmodo','2','+2 em um')}${op(V.modo==='11','lvmodo','11','+1 em dois')}${op(V.modo==='talento','lvmodo','talento','Talento')}</div>
    <div class="g2" style="margin-top:12px">${V.modo==='talento'?`${L('Talento',`<input data-lv="talento" value="${esc(V.talento)}" placeholder="Ex.: Sortudo">`,'span2')}${L('O que ele faz (opcional)',`<textarea data-lv="tdesc">${esc(V.tdesc)}</textarea>`,'span2')}`:V.modo==='2'?L('+2 em',abSel('a1'),'span2'):`${L('+1 em',abSel('a1',V.a2))}${L('+1 em',abSel('a2',V.a1))}`}</div>`;
  else if(p==='sub')body=`<h3>${esc(cl.subclasse)}</h3><p class="note">No nível ${n} a classe escolhe a subclasse. Veja as opções no Livro do Jogador ou combine com o mestre.</p>${L('Nome',`<input data-lv="sub" value="${esc(V.sub)}" placeholder="Ex.: ${esc((cl.niveis[n].find(h=>h.sub)||{}).resumo||'').replace(/^.*\(ex\.: ([^,)]+).*$/,'$1')}">`)}`;
  else if(p==='hab'){const hs=RG.habilidades(cl,n,n),e0=RG.espacosPara(cl,n-1),e1=RG.espacosPara(cl,n);
    body=`<h3>O que muda no nível ${n}</h3><div class="habl">${hs.length?hs.map(h=>`<p><b>${esc(h.sub&&(V.sub||c.sub)?h.nome+' — '+(V.sub||c.sub):h.nome)}</b>${h.resumo?' '+esc(h.resumo):''}</p>`).join(''):'<p class="note">Nenhuma habilidade nova neste nível, só os pontos de vida.</p>'}</div>
    ${RG.prof(n)>RG.prof(n-1)?`<p class="lvup2">Proficiência: ${sg(RG.prof(n-1))} → <b>${sg(RG.prof(n))}</b></p>`:''}
    ${e1&&e1.join()!==(e0||[]).join()?`<p class="lvup2">Espaços de magia: ${e1.map((v,k)=>v?`${k+1}º ×${v}`:'').filter(Boolean).join(', ')}</p>`:''}`}
  else if(p==='magias'){const nm=RG.novasMagias(cl,n),mx=RG.nivelMaxMagia(cl,n),todas=WK.dados.magias||[],ja=new Set(c.spells.map(s=>W.simples(s.n)));
    const ts=W.simples(V.mq).split(/\s+/).filter(Boolean);
    const ok=todas.filter(x=>(x.classes||[]).includes(cl.nome)&&x.nivel<=mx&&(x.nivel>0||nm.truques)&&!ja.has(W.simples(x.nome))&&ts.every(t=>W.simples(x.nome).includes(t)));
    const quer=[nm.truques?`${nm.truques} truque${nm.truques>1?'s':''}`:'',nm.magias?`${nm.magias} magia${nm.magias>1?'s':''}${cl.grimorio?' no grimório':''}`:''].filter(Boolean).join(' e ');
    body=`<h3>Magias</h3><p class="note">${quer?`Neste nível você aprende ${quer}, de até ${mx}º nível.`:`Você prepara magias da lista inteira de ${esc(cl.nome.toLowerCase())}, até ${mx}º nível.`} Marque as que quer pôr na ficha, ou pule.</p>
      <div class="wsearch sm"><input type="search" data-lv="mq" value="${esc(V.mq)}" placeholder="Buscar magia" aria-label="Buscar magia" autocomplete="off"></div>
      ${!WK.dados.magias?'<p class="note">Carregando as magias…</p>':`<div class="lvmag">${ok.slice(0,80).map(x=>`<button class="lvop${V.mag.has(x.nome)?' on':''}" data-a="lvmag" data-v="${esc(x.nome)}" aria-pressed="${V.mag.has(x.nome)}"><b>${esc(x.nome)}</b><small>${x.nivel?x.nivel+'º nível':'Truque'} · ${esc(String(x.escola).toLowerCase())}</small></button>`).join('')||'<p class="note">Nenhuma magia encontrada.</p>'}</div>`}
      ${V.mag.size?`<p class="foot">Escolhidas: ${esc([...V.mag].join(', '))}</p>`:''}`}
  else if(p==='resumo'){let nova=null,err='';try{nova=RG.subirNivel(c,cl,lvEscolhas())}catch(e){err=e.message}
    const linha=(t,a,b)=>`<div class="lvdif"><span>${t}</span><span>${a}</span><b>${b}</b></div>`;
    body=`<h3>Confirmar o nível ${n}</h3>${err?`<p class="err">${esc(err)}</p>`:`<div class="lvdifs">${linha('Nível',c.level,nova.level)}${linha('PV máximos',c.hp.max,nova.hp.max)}${RG.prof(n)>RG.prof(n-1)?linha('Proficiência',sg(RG.prof(n-1)),sg(RG.prof(n))):''}
      ${AB.filter(([k])=>nova.ab[k]!==c.ab[k]).map(([k,,nm])=>linha(nm,`${c.ab[k]} (${sg(RG.mod(c.ab[k]))})`,`${nova.ab[k]} (${sg(RG.mod(nova.ab[k]))})`)).join('')}
      ${nova.slots.some((s,k)=>s.max!==+((c.slots[k]||{}).max||0))?linha('Espaços',c.slots.map(s=>+s.max||0).filter(Boolean).join('/')||'–',nova.slots.map(s=>s.max).filter(Boolean).join('/')):''}
      ${nova.spells.length>c.spells.length?linha('Magias novas','',nova.spells.slice(c.spells.length).map(s=>esc(s.n)).join(', ')):''}
      ${nova.sub!==c.sub?linha('Subclasse',esc(c.sub||'–'),esc(nova.sub)):''}</div><p class="foot">As habilidades novas vão para Características e talentos, na aba Notas. Dá para desfazer com o botão de desfazer.</p>`}`}
  dl.innerHTML=`<form method="dialog" class="lvh"><div><small>Subir de nível · ${esc(c.name||'')}</small><b>Nível ${n}${cl?' de '+esc(cl.nome):''}</b></div><button class="x" aria-label="Fechar">×</button></form>
    <ol class="lvst" aria-label="Passos">${passos.map((x,k)=>`<li class="${k<i?'ok':k===i?'on':''}"${k===i?' aria-current="step"':''}><span>${k+1}</span></li>`).join('')}</ol>
    <div class="lvb">${body}</div>${V.erro?`<p class="err" role="alert">${esc(V.erro)}</p>`:''}
    <div class="lvf"><button class="btn" data-a="lvback"${i?'':' disabled'}>Voltar</button>${p==='resumo'?`<button class="btn pri" data-a="lvok">Subir de nível</button>`:`<button class="btn pri" data-a="lvnext">${p==='magias'&&!V.mag.size?'Pular':'Continuar'}</button>`}</div>`;
  S.lvl.i=i}
function lvAcao(a,v){const c=C(),L=S.lvl;if(!c||!L)return;const cl=lvClasse(c);L.erro='';
  switch(a){
  case'lvcls':L.cls=v;break;
  case'lvpv':if(v==='media'){L.pv='media';L.rolou=null}else{L.pv=r(RG.lados(cl.dado));L.rolou=Date.now()}break;
  case'lvmodo':L.modo=v;break;
  case'lvmag':L.mag.has(v)?L.mag.delete(v):L.mag.add(v);break;
  case'lvback':L.i=Math.max(0,L.i-1);break;
  case'lvnext':{const p=lvPassos(c,cl)[L.i];const e=lvValida(p,c,cl);if(e){L.erro=e;break}L.i++;break}
  case'lvok':{const e=lvValida('resumo',c,cl);if(e){L.erro=e;break}let nova;try{nova=RG.subirNivel(c,cl,lvEscolhas())}catch(err){L.erro=err.message;break}
    touch();Object.assign(c,nova);save();$('lvdlg').close();render();
    toast(`<span class="tot crit">${c.level}</span><div><b>Nível ${c.level}!</b><small>+${c.historico.at(-1).pv} PV${RG.podeSubir(c)?' · ainda dá para subir mais um':''}</small></div>`);return}}
  lvRender();const f=$('lvdlg').querySelector('.lvb');if(a==='lvnext'||a==='lvback')f&&f.scrollTo(0,0)}

/* ---------- render ---------- */
function shield(){return `<svg viewBox="0 0 60 58" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="M30 2 56 9v17c0 15-11 26-26 30C15 52 4 41 4 26V9Z" fill="rgba(0,0,0,.22)" stroke="rgba(255,255,255,.55)" stroke-width="2"/><path d="M30 6 52 12v14c0 12-9 21-22 25" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/></svg>`}
function subline(c){return [c.race,[c.cls,c.level?'nível '+c.level:''].filter(Boolean).join(' '),c.bg].filter(Boolean).join(' · ')}
function head(){const c=C();$('nm').textContent=c.name||'Sem nome';$('sub').textContent=subline(c);
  const m=mesaOf(c.mesa),l=locOf(c.id)[0];let w=[];
  if(!S.online)w.push('Sem conexão com o servidor: as mudanças serão enviadas quando ele voltar.');
  else{if(m)w.push(`Mesa <button class="crumb" data-a="gomesa" data-v="${esc(m.id)}">${esc(m.nome)}</button>`);
    if(!isOwn(c))w.push(esc('Ficha de '+(c._ownerName||'outro jogador')+(canWrite(c)?' · você está editando como mestre':' · liberada pelo mestre, somente leitura')));
    else if(m&&isLib(c))w.push('liberada para a mesa');
    if(l)w.push(`<a class="crumb" href="${esc(tokHref(l))}">${ico('pin')}${esc(l.mapaNome)}</a>`)}
  $('who2').innerHTML=w.join(' · ');
  $('vit').innerHTML=`<div class="shield">${shield()}<b data-d="ac">${esc(c.ac)}</b><span>CA</span></div><div><b data-d="hpt">${calc('hpt',c)}</b><span>PV</span></div><div><b data-d="init">${calc('init',c)}</b><span>Inic.</span></div><div><b data-d="prof">${calc('prof',c)}</b><span>Prof.</span></div><div><b data-d="spd">${calc('spd',c)}</b><span>Desl.</span></div>`;
  $('seg').innerHTML=['Normal','Vantagem','Desvantagem'].map((t,i)=>`<button class="${S.mode===i?'on':''}" data-a="mode" data-v="${i}">${t}</button>`).join('');
  hpbar()}
function hpbar(){const c=C();if(!c)return;const p=Math.max(0,Math.min(100,(+c.hp.cur||0)/Math.max(1,+c.hp.max||1)*100));const w=$('hpw');w.style.width=p+'%';w.className=p<=25?'low':''}
function render(){
  if(!S.me)return showAuth();
  document.body.classList.remove('auth');document.body.dataset.page=S.page;rail();
  if(S.page!=='mesa'){$('mapview').hidden=true;document.body.classList.remove('mapon')}
  if(S.page==='config')return renderConfig();
  document.body.classList.remove('cfg');
  if(S.page!=='ficha')return renderMenu();
  const c=C();
  if(!c)return go('personagens',null,false);
  document.body.classList.remove('menu','nochar');
  if(c.mesa)S.mesaAtual=c.mesa;
  const fh=fichaHash(c);if(location.hash!==fh)history.replaceState(null,'',fh);
  document.body.classList.toggle('locked',S.locked||RO());document.body.classList.toggle('ro',RO());
  const lk=$('lk');lk.classList.toggle('on',!S.locked);lk.setAttribute('aria-label',S.locked?'Editar ficha':'Concluir edição');
  $('nav').innerHTML=TABS.map(([k,t])=>`<button class="${S.tab===k?'on':''}" data-a="tab" data-v="${k}">${t}</button>`).join('');
  head();const fn={personagem:tHeroi,principal:tPrincipal,combate:tCombate,magias:tMagias,itens:tItens,notas:tNotas}[S.tab]||tHeroi;
  $('main').innerHTML=fn(c)+`<p class="status" id="st">${esc(statusText())}</p>`}
const typing=root=>{const a=document.activeElement;return a&&root.contains(a)&&/INPUT|TEXTAREA/.test(a.tagName)};
function softRender(){if(!S.me)return;if(typing($('main')))pendR=true;else render()}
document.addEventListener('focusout',()=>{if(pendR)setTimeout(()=>{if(!typing($('main'))){pendR=false;render()}},60)});
function derive(){const c=C();document.querySelectorAll('[data-d]').forEach(e=>{e.textContent=calc(e.dataset.d,c)});hpbar();$('nm').textContent=c.name||'Sem nome';$('sub').textContent=subline(c)}


/* ---------- dados ---------- */

const r=n=>1+Math.floor(Math.random()*n);
function d20(){const a=r(20);if(!S.mode)return{v:a,t:''+a};const b=r(20);const v=S.mode===1?Math.max(a,b):Math.min(a,b);return{v,t:a+' e '+b}}
function dice(expr){let tot=0,parts=[];const re=/([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/gi;let m,ok=false;
  while((m=re.exec(String(expr).replace(/\s/g,'')))){ok=true;if(m[3]){const n=+m[2]||1,s=+m[3],sgn=m[1]==='-'?-1:1;const rs=Array.from({length:Math.min(n,50)},()=>r(s));tot+=sgn*rs.reduce((a,b)=>a+b,0);parts.push((sgn<0?'−':'')+'['+rs.join(',')+']')}else{const v=(m[4]==='-'?-1:1)*(+m[5]);tot+=v;parts.push(sg(v))}}
  return ok?{tot,txt:parts.join(' ')}:null}
function toast(html){const t=$('toast');t.innerHTML=html;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),5000)}
function rollTest(label,bonus){const x=d20();const tot=x.v+bonus;const md=['',' com vantagem',' com desvantagem'][S.mode];
  toast(`<span class="tot${x.v===20||x.v===1?' crit':''}">${tot}</span><div><b>${esc(label)}</b><small>d20${md}: ${x.t} ${bonus?sg(bonus):''}${x.v===20?' · 20 natural!':x.v===1?' · 1 natural':''}</small></div>`)}
function rollKey(k){const c=C();const [t,a]=k.split(':');
  if(t==='mod')return rollTest('Teste de '+AB.find(x=>x[0]===a)[2],mod(c.ab[a]));
  if(t==='save')return rollTest('Salvaguarda de '+AB.find(x=>x[0]===a)[2],saveV(c,a));
  if(t==='skill')return rollTest(SKM[a][1],skillV(c,a));
  if(t==='init')return rollTest('Iniciativa',mod(c.ab.des)+(+c.initB||0));
  if(t==='satk')return rollTest('Ataque mágico',prof(c)+mod(c.ab[c.spAb]));
  if(t==='death'){if(RO())return;const v=r(20);touch();if(v===20){c.death={s:0,f:0};c.hp.cur=Math.max(1,+c.hp.cur||0)}else if(v===1)c.death.f=Math.min(3,c.death.f+2);else if(v>=10)c.death.s=Math.min(3,c.death.s+1);else c.death.f=Math.min(3,c.death.f+1);save();render();
    toast(`<span class="tot${v===20||v===1?' crit':''}">${v}</span><div><b>Salvaguarda contra morte</b><small>${v===20?'Recupera 1 PV!':v===1?'Duas falhas':v>=10?'Sucesso':'Falha'}</small></div>`)}}
function rollAtk(i){const a=C().atk[i];if(!a)return;const b=parseInt(String(a.b).replace(/\s/g,''))||0;const x=d20();const dm=dice(a.d);
  let dtxt='';if(dm){let tot=dm.tot,extra='';if(x.v===20){const e=dice(String(a.d).replace(/[+-]\s*\d+(?!\s*d)/g,''));if(e){tot+=e.tot;extra=' + crítico '+e.txt}}dtxt=`Dano: <b>${tot}</b> ${esc(a.t||'')} <small style="display:inline">${dm.txt}${extra}</small>`}
  toast(`<span class="tot${x.v===20||x.v===1?' crit':''}">${x.v+b}</span><div><b>${esc(a.n||'Ataque')}</b><small>d20: ${x.t} ${sg(b)}${x.v===20?' · crítico!':x.v===1?' · erro crítico':''}</small><div style="font-size:14px">${dtxt}</div></div>`)}

/* ---------- entrar ---------- */
function showAuth(){S.me=null;if(es){es.close();es=null}document.body.classList.add('auth');
  const reg=S.authMode==='register';
  $('main').innerHTML=`<div class="authbox"><svg class="crest" viewBox="0 0 60 58" aria-hidden="true"><path d="M30 2 56 9v17c0 15-11 26-26 30C15 52 4 41 4 26V9Z" fill="#9e1b22"/><path d="M30 14 41 21v13L30 41 19 34V21Z" fill="none" stroke="#d6a23a" stroke-width="2.5"/><path d="M19 21l11 7 11-7M30 28v13" fill="none" stroke="#d6a23a" stroke-width="2"/></svg>
  <h1>Fichas D&amp;D 5e</h1><p class="note">Suas fichas e as mesas do grupo, num servidor da sua casa.</p>
  <div class="seg" style="border-color:var(--line);margin-top:18px">${[['login','Entrar'],['register','Criar conta']].map(([k,t])=>`<button type="button" class="${S.authMode===k?'on':''}" style="color:${S.authMode===k?'#fff':'var(--ink)'};background:${S.authMode===k?'var(--red)':'none'}" data-a="authmode" data-v="${k}">${t}</button>`).join('')}</div>
  <form id="authf"><div><label for="an">Nome</label><input id="an" name="name" autocomplete="username" required minlength="2" maxlength="30"></div>
  <div><label for="ap">Senha${reg?' (mínimo 6 caracteres)':''}</label><input id="ap" name="pass" type="password" autocomplete="${reg?'new-password':'current-password'}" required minlength="${reg?6:1}"></div>
  <button class="btn pri" type="submit">${reg?'Criar conta':'Entrar'}</button><p class="err" id="aerr" role="alert"></p></form>
  ${reg?'<p class="note">O nome é como os outros jogadores vão te ver.</p>':'<p class="note">Esqueceu a senha? Quem roda o servidor pode redefinir.</p>'}</div>`}
document.addEventListener('submit',async e=>{if(e.target.id!=='authf')return;e.preventDefault();const fd=new FormData(e.target);const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
  try{const st=await api('POST',S.authMode==='register'?'/api/register':'/api/login',{name:fd.get('name'),pass:fd.get('pass')});S.chars=new Map();applyState(st);const pf=S.me.prefs||{};if(typeof pf.abrirTravada==='boolean')S.locked=pf.abrirTravada;if(pf.abaInicial&&S.page==='ficha')S.tab=pf.abaInicial;setConn(true);render();listen();loadLoc(true)}
  catch(err){$('aerr').textContent=err.status?err.message:'Não foi possível falar com o servidor.'}btn.disabled=false});

/* ---------- histórico ---------- */
function touch(){const now=Date.now();if(now-lastPush>1500){hist.push(JSON.stringify(C()));if(hist.length>40)hist.shift()}lastPush=now}
function undo(){if(RO())return;const s=hist.pop();if(!s){toast('<div><b>Nada para desfazer</b></div>');return}const o=fix(JSON.parse(s));const cur=C();
  if(cur){for(const k of Object.keys(cur))if(k.startsWith('_')&&k!=='_edit')o[k]=cur[k];o.mesa=cur.mesa}
  S.chars.set(o.id,o);lastPush=0;save(o);render();toast('<div><b>Alteração desfeita</b></div>')}

/* ---------- painel de fichas e mesas ---------- */
function row(c,lib){const on=c===C();const m=mesaOf(c.mesa);
  const info=[isOwn(c)?'Você':c._ownerName,subline(c),lib===undefined&&m?m.nome:'',lib===undefined&&isLib(c)?'liberada':'',locOf(c.id).length?'no mapa':''].filter(Boolean).join(' · ');
  return `<div class="prow"><button class="pick ${on?'on':''}" data-a="open" data-v="${esc(c.id)}"><div><b>${esc(c.name||'Sem nome')}</b><span>${esc(info)}</span></div></button>${lib?`<button class="tog ${isLib(c)?'on':''}" data-a="lib" data-v="${esc(c.id)}" aria-pressed="${isLib(c)}">${isLib(c)?'Liberada':'Oculta'}</button>`:''}</div>`}
const armBtn=(key,label,confirm,cls='warn')=>`<button class="btn sm ${cls}" data-a="${key.split(':')[0]}" data-v="${esc(key.split(':').slice(1).join(':'))}">${arm===key?confirm:label}</button>`;
function mapasUrl(){const x=K.info&&K.info.mapas;return x&&x.url?x.url.replace(/\/+$/,''):`${location.protocol}//${location.hostname}:${x?x.porta:3001}`}
const tokHref=l=>`#mesa/${l.mesa}/mapas/${l.mapa}/${l.token}`;
const locOf=id=>S.loc.get(id)||[];
const mestreNome=m=>(m.membros.find(x=>x.id===m.mestre)||{}).name||'?';
const ini=n=>{const w=String(n||'?').trim().split(/\s+/);const l=w[w.length-1];return((w.length>1&&/^\d+$/.test(l))?w[0][0]+l:w.length>1?w[0][0]+l[0]:w[0].slice(0,2)).toUpperCase()};
const IC={home:'<path d="M3 11 12 4l9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',pers:'<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><circle cx="18" cy="9" r="3"/><path d="M17 15a5 5 0 0 1 5 5"/>',
  ficha:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>',mapa:'<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',pin:'<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  livro:'<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6M9 10.5h6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',cfg:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'};
const ico=k=>`<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;
const fichaHash=c=>c.mesa?`#mesa/${c.mesa}/ficha/${c.id}`:`#ficha/${c.id}`;
const mesaHash=()=>'#mesa/'+S.mesaAtual+(S.mesaTab==='mapas'?'/mapas'+(S.alvo?`/${S.alvo.mapa}${S.alvo.tok?'/'+S.alvo.tok:''}`:''):S.mesaTab==='wiki'?'/wiki'+(S.wikiSel&&S.wikiSel.id?'/'+S.wikiSel.id+(S.wikiSel.anc?'/'+S.wikiSel.anc:''):''):'');
const wikiHash=()=>'#wiki'+(S.wikiSel&&S.wikiSel.slug?'/'+S.wikiSel.slug+(S.wikiSel.anc?'/'+S.wikiSel.anc:''):'');
// troca de página; ao abrir uma ficha, o endereço já diz em que mesa ela está
function go(page,arg,push=true){
  if(page==='ficha'){const c=S.chars.get(arg||S.view);if(!c)return go('personagens',null,push);if(S.view!==c.id){S.view=c.id;hist=[];S.locked=S.me.prefs?S.me.prefs.abrirTravada!==false:S.locked}prefs()}
  if(page==='mapas'){const [mid,mapa,tok]=String(arg||'').split('|');const m=mesaOf(mid)||mesaOf(S.mesaAtual)||S.mesas[0];if(!m)return go('inicio',null,push);
    S.mesaAtual=m.id;S.mesaTab='mapas';S.alvo=mapa?{mapa,tok:tok||''}:null;page='mesa'}
  else if(page==='mwiki'){const [mid,pid]=String(arg||'').split('|');const m=mesaOf(mid)||mesaOf(S.mesaAtual)||S.mesas[0];if(!m)return go('wiki',null,push);
    S.mesaAtual=m.id;S.mesaTab='wiki';S.wikiSel=pid?{id:pid,anc:''}:null;page='mesa'}
  else if(page==='wiki'){S.wikiSel=arg?{slug:arg,anc:''}:null}
  else if(page==='mesa'){S.mesaAtual=arg;S.mesaTab='mesa'}
  S.page=page;arm=null;
  const h=page==='ficha'?fichaHash(C()):page==='mesa'?mesaHash():page==='config'?cfgHash():page==='wiki'?wikiHash():'#'+page;
  if(location.hash!==h)history[push?'pushState':'replaceState'](null,'',h);
  render();scrollTo(0,0);if(page!=='config')loadLoc()}
// onde os personagens estão nos mapas (o servidor pergunta ao serviço de mapas, com as regras dele)
let locT=0;
function loadLoc(force){if(!S.me||(!force&&Date.now()-locT<3000))return;locT=Date.now();
  api('GET','/api/localizacoes').then(r=>{const m=new Map();for(const l of r.localizacoes||[]){if(!m.has(l.ficha))m.set(l.ficha,[]);m.get(l.ficha).push(l)}
    const mudou=JSON.stringify([...m])!==JSON.stringify([...S.loc])||S.locOk!==!!r.mapas;S.loc=m;S.locOk=!!r.mapas;if(mudou)softRender()}).catch(()=>{})}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadLoc(true)});
// menu lateral de ícones (computador)
function rail(){const r=$('rail'),c=C(),pg=S.page,ficha=pg==='ficha'&&c;
  const it=(a,v,icon,label,on,curto)=>`<button class="ri${on?' on':''}" data-a="${a}" data-v="${esc(v)}" title="${esc(label)}" aria-label="${esc(label)}"${on?' aria-current="page"':''}>${icon}<span aria-hidden="true">${esc(curto||label)}</span></button>`;
  const nome1=n=>String(n||'').trim().split(/\s+/)[0]||'Ficha';
  let h=it('go','inicio',ico('home'),'Início',pg==='inicio')+it('go','personagens',ico('pers'),'Personagens',pg==='personagens');
  if(c)h+=it('go','ficha',`<i class="rav pc">${esc(ini(c.name))}</i>`,'Ficha: '+(c.name||'sem nome'),pg==='ficha',nome1(c.name));
  h+='<hr>';
  const naMapas=pg==='mesa'&&S.mesaTab==='mapas',naWiki=pg==='mesa'&&S.mesaTab==='wiki';
  for(const m of S.mesas)h+=it('gomesa',m.id,`<i class="rav${isMestre(m)?' gm':''}">${esc(ini(m.nome))}</i>`,m.nome,(pg==='mesa'&&!naMapas&&!naWiki&&S.mesaAtual===m.id)||(ficha&&c.mesa===m.id));
  h+=it('novamesa','',`<i class="rav add">${ico('plus')}</i>`,'Entrar ou criar mesa',false,'Nova mesa')+'<hr>';
  h+=S.mesas.length?it('gomapas','',ico('mapa'),'Mapas da mesa',naMapas,'Mapas'):`<a class="ri" href="${esc(mapasUrl())}/" target="mapas" title="Mapas" aria-label="Mapas">${ico('mapa')}<span>Mapas</span></a>`;
  h+=it('go','wiki',ico('livro'),'Wiki: regras e páginas das mesas',pg==='wiki'||naWiki,'Wiki');
  h+='<div class="rsp"></div>';
  h+=it('cfg','conta',ico('cfg'),'Configurações',pg==='config','Ajustes');
  r.innerHTML=h}
// Início, Personagens e Mesa
function renderMenu(){const b=document.body;b.classList.add('menu');b.classList.remove('locked','ro','nochar','cfg');
  let m=mesaOf(S.mesaAtual);
  if(S.page==='mesa'&&!m){S.page='inicio';b.dataset.page='inicio';history.replaceState(null,'','#inicio')}
  const pg=S.page==='mesa'?'mesa':S.page==='personagens'?'personagens':S.page==='wiki'?'wiki':'inicio';
  $('nm').textContent=pg==='mesa'?m.nome:pg==='personagens'?'Personagens':pg==='wiki'?'Wiki':'Início';
  $('sub').textContent=pg==='mesa'?(isMestre(m)?'Você é o mestre desta mesa':'Mestre: '+mestreNome(m)):pg==='wiki'?'Regras do jogo e as páginas das suas mesas':'Conectado como '+S.me.name;
  $('who2').textContent=S.online?'':'Sem conexão com o servidor.';$('vit').innerHTML='';$('seg').innerHTML='';
  const c=C(),naMapas=pg==='mesa'&&S.mesaTab==='mapas',naWiki=pg==='mesa'&&S.mesaTab==='wiki';
  $('nav').innerHTML=[['inicio','Início','home'],['personagens','Personagens','pers'],...(c?[['ficha','Ficha','ficha']]:[])].map(([k,t,i])=>`<button class="ni ${pg===k?'on':''}" data-a="go" data-v="${k}">${ico(i)}${t}</button>`).join('')
    +(S.mesas.length?`<button class="ni ${naMapas?'on':''}" data-a="gomapas" data-v="">${ico('mapa')}Mapas</button>`:`<a class="ni" href="${esc(mapasUrl())}/" target="mapas">${ico('mapa')}Mapas</a>`)
    +`<button class="ni ${pg==='wiki'||naWiki?'on':''}" data-a="go" data-v="wiki">${ico('livro')}Wiki</button><button class="ni" data-a="cfg" data-v="conta">${ico('cfg')}Ajustes</button>`;
  if((pg==='wiki'||pg==='mesa')&&(WK.stale||!WK.base))loadWiki();
  if(pg==='mesa'){
    const aba=(k,t,a)=>{const on=S.mesaTab===k||(k==='mesa'&&!naMapas&&!naWiki);return `<button role="tab" aria-selected="${on}" class="${on?'on':''}" data-a="${a}" data-v="${esc(m.id)}">${t}</button>`};
    const abas=`<div class="mtabs" role="tablist" aria-label="Mesa ${esc(m.nome)}">${aba('mesa','Mesa','gomesa')}${aba('mapas','Mapas','gomapas')}${aba('wiki','Wiki','gomwiki')}${naMapas?`<a class="btn sm" href="${esc(mapasUrl())}/#mesa/${esc(m.id)}" target="mapas">Abrir em outra aba</a>`:''}</div>`;
    $('main').innerHTML=abas+(naMapas?'':(naWiki?pMesaWiki(m):pMesa(m))+`<p class="status" id="st">${esc(statusText())}</p>`);mapView(naMapas,m);if(naWiki)wikiRolar();return}
  $('main').innerHTML=(pg==='personagens'?pPersonagens():pg==='wiki'?pWiki():pInicio())+`<p class="status" id="st">${esc(statusText())}</p>`;
  if(pg==='wiki')wikiRolar()}
// a aba de mapas embute o app de mapas; o quadro fica fora de #main para não recarregar a cada atualização
function mapView(on,m){const v=$('mapview');v.hidden=!on;document.body.classList.toggle('mapon',on);if(!on)return;
  const a=S.alvo,src=`${mapasUrl()}/#${a?`mapa/${a.mapa}${a.tok?'/token/'+a.tok:''}`:'mesa/'+m.id}`,f=$('mapif');
  if(f.dataset.src!==src){f.dataset.src=src;f.src=src}
  requestAnimationFrame(fitMap)}
function fitMap(){const v=$('mapview');if(v.hidden)return;const n=$('nav'),nb=n&&getComputedStyle(n).position==='fixed'?n.offsetHeight:0;
  v.style.height=Math.max(320,innerHeight-v.getBoundingClientRect().top-nb-12)+'px'}
addEventListener('resize',fitMap);
function locLink(c){const l=locOf(c.id);if(!l.length)return '';const x=l[0];return `<a class="loc" href="${esc(tokHref(x))}">${ico('pin')}No mapa ${esc(x.mapaNome)}${l.length>1?` e em mais ${l.length-1}`:''}</a>`}
function pcard(c){const m=mesaOf(c.mesa);const p=Math.max(0,Math.min(100,(+c.hp.cur||0)/Math.max(1,+c.hp.max||1)*100));
  return `<section class="card"><button class="hcard" data-a="open" data-v="${esc(c.id)}"><span class="mav pc">${esc(ini(c.name))}</span><span><b>${esc(c.name||'Sem nome')}</b><small>${esc(subline(c)||'Classe ainda não definida')}</small></span></button>
  <div class="pcm"><span>${m?'Mesa: '+esc(m.nome):'Sem mesa'}</span><span>PV ${esc(c.hp.cur)}/${esc(c.hp.max)} · CA ${esc(c.ac)}</span></div>
  <div class="hpmini"><i class="${p<=25?'low':''}" style="width:${p}%"></i></div>${locLink(c)}
  <div class="btns"><button class="btn sm pri" data-a="open" data-v="${esc(c.id)}">${m?'Abrir na mesa':'Abrir ficha'}</button><button class="btn sm" data-a="dup" data-v="${esc(c.id)}">Duplicar</button>${armBtn('del:'+c.id,'Apagar','Toque de novo para apagar')}</div></section>`}
const byUpd=(a,b)=>(b.upd||0)-(a.upd||0);
function pInicio(){const mine=myChars().sort(byUpd);
  const mesas=S.mesas.map(m=>{const mestre=isMestre(m),meus=mine.filter(c=>c.mesa===m.id),n=m.membros.length-1;
    return `<section class="card"><button class="hcard" data-a="gomesa" data-v="${esc(m.id)}"><span class="mav${mestre?' gm':''}">${esc(ini(m.nome))}</span><span><b>${esc(m.nome)}</b><small>${mestre?'Você é o mestre':'Mestre: '+esc(mestreNome(m))} · ${n} ${n===1?'jogador':'jogadores'}</small></span></button>
    ${meus.length?`<div class="chips" style="margin-bottom:12px">${meus.map(c=>`<button class="chip" data-a="open" data-v="${esc(c.id)}">${esc(c.name||'Sem nome')}</button>`).join('')}</div>`:`<p class="note">${mestre?'Abra a mesa para ver as fichas dos jogadores.':'Nenhum personagem seu nesta mesa ainda.'}</p>`}
    <div class="btns"><button class="btn sm pri" data-a="gomesa" data-v="${esc(m.id)}">Abrir mesa</button><button class="btn sm" data-a="gomapas" data-v="${esc(m.id)}">Mapas</button></div></section>`}).join('');
  const entrar=`<section class="card"><h2>Entrar numa mesa</h2><div class="amt" style="grid-template-columns:minmax(0,1fr) auto"><input id="jcode" placeholder="Código de convite" autocapitalize="characters" aria-label="Código de convite"><button class="btn pri" data-a="join">Entrar</button></div><p class="foot">Peça o código ao mestre da mesa.</p>
    <h2 style="margin-top:18px">Criar mesa</h2><div class="amt" style="grid-template-columns:minmax(0,1fr) auto"><input id="nmesa" placeholder="Ex.: A Mina Perdida" aria-label="Nome da nova mesa"><button class="btn" data-a="nmesa">Criar</button></div><p class="foot">Quem cria a mesa é o mestre dela.</p></section>`;
  const vazio=`<section class="card"><h2>Nenhuma mesa ainda</h2><p class="note">Entre na mesa do seu mestre com o código de convite, ou crie a sua.</p></section>`;
  return `<h2 class="ph">Suas mesas</h2><div class="grid">${mesas||vazio}${entrar}</div>
  <h2 class="ph">Seus personagens${mine.length>3?`<button class="btn sm" data-a="go" data-v="personagens">Ver todos (${mine.length})</button>`:''}</h2>
  <div class="grid">${mine.slice(0,3).map(pcard).join('')}${mine.length?'':`<section class="card"><h2>Nenhum personagem ainda</h2><p class="note">Crie o primeiro ou comece pela ficha de exemplo.</p><div class="btns"><button class="btn pri" data-a="new">Nova ficha</button><button class="btn" data-a="sample">Ficha de exemplo</button></div></section>`}</div>`}
function pPersonagens(){const mine=myChars().sort(byUpd);
  return `<div class="btns" style="margin:4px 0 14px"><button class="btn pri" data-a="new">Nova ficha</button><button class="btn" data-a="sample">Ficha de exemplo</button></div>
  ${mine.length?`<div class="grid">${mine.map(pcard).join('')}</div>`:`<section class="card empty"><h2>Nenhum personagem ainda</h2><p class="note">Crie o primeiro ou comece pela ficha de exemplo. Depois, escolha a mesa dele na aba Principal da ficha ou pela página da mesa.</p></section>`}
  <details class="card" style="margin-top:16px"><summary>Exportar e importar</summary><p class="note">Copie o texto para guardar um backup. Ao importar, as fichas viram suas.</p>
  <textarea id="io" style="min-height:120px;font-size:13px" placeholder="Cole aqui o texto de uma ficha exportada"></textarea>
  <div class="btns" style="margin-top:8px">${C()&&isOwn(C())?'<button class="btn sm" data-a="exp">Mostrar a última ficha aberta</button>':''}<button class="btn sm" data-a="expall">Mostrar minhas fichas</button><button class="btn sm" data-a="copy">Copiar</button><button class="btn sm pri" data-a="imp">Importar texto</button><label class="btn sm" style="display:inline-flex;align-items:center;color:var(--ink);font-size:14px">Arquivo<input type="file" id="file" accept=".json,application/json" style="display:none"></label></div><p class="foot" id="iomsg"></p></details>`}
function pMesa(m){const mestre=isMestre(m),all=[...S.chars.values()].filter(c=>c.mesa===m.id),meus=all.filter(isOwn),outros=all.filter(c=>!isOwn(c)),fora=myChars().filter(c=>c.mesa!==m.id);
  const nova=`<div class="btns" style="margin-top:4px"><button class="btn sm" data-a="new" data-v="${esc(m.id)}">Nova ficha nesta mesa</button></div>`;
  const fichas=mestre?card('Fichas da mesa',`<p class="note">Você vê todas. Toque em Oculta ou Liberada para decidir o que os jogadores veem.</p>${all.length?all.map(c=>row(c,true)).join(''):'<p class="note">Nenhuma ficha nesta mesa ainda.</p>'}${nova}`)
    :card('Seus personagens',`${meus.length?meus.map(c=>row(c,false)).join(''):'<p class="note">Nenhum personagem seu nesta mesa ainda.</p>'}${nova}`)+card('Liberadas pelo mestre',outros.length?outros.map(c=>row(c,false)).join(''):'<p class="note">O mestre ainda não liberou nenhuma ficha.</p>');
  const trazer=fora.length?card(mestre?'Trazer suas fichas':'Trazer personagem',`<p class="note">${mestre?'Monstros e NPCs seus entram ocultos dos jogadores.':'Leve um personagem seu para esta mesa. Ele sai da mesa em que está agora.'}</p>${fora.map(c=>`<div class="prow"><div class="pick" style="cursor:default"><div><b>${esc(c.name||'Sem nome')}</b><span>${esc(mesaOf(c.mesa)?'Na mesa '+mesaOf(c.mesa).nome:'Sem mesa')}</span></div></div><button class="tog" data-a="trazer" data-v="${esc(c.id)}|${esc(m.id)}">Trazer</button></div>`).join('')}`):'';
  const locs=[...S.loc.values()].flat().filter(l=>l.mesa===m.id&&S.chars.has(l.ficha));
  const mapa=card('Mapas',`<p class="note">${!S.locOk?'Não deu para falar com o serviço de mapas agora.':locs.length?'Onde estão os personagens que você vê:':'Nenhum personagem que você vê está num mapa desta mesa.'}</p>
    ${locs.map(l=>`<div class="row"><span style="flex:1">${esc(S.chars.get(l.ficha).name||'Sem nome')}</span><a class="loc" style="margin:0" href="${esc(tokHref(l))}">${ico('pin')}${esc(l.mapaNome)}</a></div>`).join('')}
    <div class="btns" style="margin-top:10px"><button class="btn pri" data-a="gomapas" data-v="${esc(m.id)}">Abrir os mapas da mesa</button></div>`);
  const info=card('Na mesa',`${mestre?`<p class="note" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">Código de convite <span class="code" style="font-size:17px;padding:6px 10px">${esc(m.code)}</span></p>`:''}${m.descricao?`<p style="white-space:pre-wrap;margin:0 0 10px">${esc(m.descricao)}</p>`:''}
    <div class="members">${m.membros.map(x=>`<span class="member" style="padding-right:12px">${esc(x.name)}${x.id===m.mestre?' (mestre)':''}</span>`).join('')}</div>
    <div class="btns"><button class="btn sm" data-a="cfg" data-v="mesa|${esc(m.id)}">${mestre?'Configurar mesa':'Detalhes da mesa'}</button></div>`);
  return `<div class="cols"><div class="stackc">${fichas}${trazer}</div><div class="stackc">${mapa}${cardWikiMesa(m)}</div><div class="stackc">${info}</div></div>`}
function addOwn(c,open=true){c._owner=meId();c._ownerName=S.me.name;c._lib=false;c._new=true;delete c.demo;S.chars.set(c.id,c);if(open){S.view=c.id;hist=[];prefs()}save(c);return c}
function importTxt(txt){let o;try{o=JSON.parse(txt)}catch(e){$('iomsg').textContent='Texto inválido: não parece uma ficha exportada.';return}
  const arr=(Array.isArray(o)?o:[o]).filter(x=>x&&typeof x==='object'&&x.ab);if(!arr.length){$('iomsg').textContent='Nenhuma ficha encontrada no texto.';return}
  for(const x of arr){const c=fix(x);for(const k of Object.keys(c))if(k.startsWith('_'))delete c[k];c.id='c'+uidGen();c.mesa='';addOwn(c)}
  render();$('iomsg').textContent=arr.length+(arr.length>1?' fichas importadas.':' ficha importada.')}

/* ---------- wiki ---------- */
// regras que vêm com a suíte (base) e páginas das mesas (pag); o servidor já filtra o que cada um pode ler
const W=window.Wiki;
const WK={base:null,pag:[],carregando:null,stale:true,erro:0,idx:null,rolado:null};
const naWikiAgora=()=>S.page==='wiki'||(S.page==='mesa'&&S.mesaTab!=='mapas');
function loadWiki(){if(!S.me||WK.carregando||Date.now()-WK.erro<5000)return WK.carregando;
  WK.carregando=api('GET','/api/wiki'+(WK.base?'?base=0':'')).then(r=>{if(r.base)WK.base=r.base;WK.pag=r.paginas||[];WK.stale=false;WK.idx=null})
    .catch(e=>{WK.erro=Date.now();if(e.status===401)showAuth()}).finally(()=>{WK.carregando=null;softRender()});
  return WK.carregando}
const basePg=s=>(WK.base||[]).find(p=>p.slug===s);
const mesaPg=id=>WK.pag.find(p=>p.id===id);
const pgsDaMesa=mid=>WK.pag.filter(p=>p.mesa===mid);
const pgHref=(p,a)=>(p.slug?`#wiki/${p.slug}`:`#mesa/${p.mesa}/wiki/${p.id}`)+(a?'/'+a:'');
function upsertPg(p){const i=WK.pag.findIndex(x=>x.id===p.id);if(i<0)WK.pag.push(p);else WK.pag[i]=p;WK.idx=null}
function tituloSecao(t,a){for(const l of String(t||'').split('\n')){const m=/^#{1,6}\s+(.*?)\s*#*$/.exec(l);if(m&&W.slug(m[1])===a)return m[1].replace(/[*_`]/g,'')}return ''}
// resolve [[links]]: primeiro as páginas da mesa, depois as regras
function linker(ctx){return(alvo,txt)=>{
  const k=alvo.indexOf('#');const nome=(k<0?alvo:alvo.slice(0,k)).trim(),anc=k<0?'':W.slug(alvo.slice(k+1));
  let p=null;
  if(!nome)p=ctx.pg;
  else{if(ctx.mesa)p=pgsDaMesa(ctx.mesa).find(x=>W.simples(x.titulo)===W.simples(nome));
    if(!p)p=(WK.base||[]).find(x=>x.slug===nome||x.slug===W.slug(nome)||W.simples(x.titulo)===W.simples(nome))}
  if(!p||!(p.slug||p.id))return{href:null,texto:txt||nome,nova:ctx.mesa&&isMestre(mesaOf(ctx.mesa))&&nome?ctx.mesa+'|'+nome:null};
  return{href:pgHref(p,anc),texto:txt||(anc?tituloSecao(p.texto,anc)||p.titulo:p.titulo)}}}
// rola até a seção pedida no endereço (ou para o topo) só quando a página muda
function wikiRolar(){const sel=S.wikiSel;const key=(S.page==='mesa'?'m'+S.mesaAtual:'w')+'|'+(sel?(sel.slug||sel.id)+'|'+sel.anc:'')+'|'+(S.wEdit?'e':'');
  if(WK.rolado===key||(sel&&!WK.base))return;
  if(sel&&sel.anc&&!document.getElementById('w-'+sel.anc)&&listaPendente())return;WK.rolado=key;
  requestAnimationFrame(()=>{const el=sel&&sel.anc&&document.getElementById('w-'+sel.anc);
    if(el){el.scrollIntoView({block:'start'});el.classList.add('alvo');setTimeout(()=>el.classList.remove('alvo'),1800)}else scrollTo(0,0)})}
const carregandoWiki=()=>card('Wiki',`<p class="note">${WK.erro&&!WK.base?'Não deu para carregar a wiki agora.':'Carregando…'}</p>`);

// busca: título, seções e texto, sem acentos; o trecho mostrado sai do texto original
function wikiIdx(){if(WK.idx)return WK.idx;
  const todos=[...(WK.base||[]).map(p=>({p,onde:'Regras · '+p.cat})),...Object.entries(WK.dados).filter(([l])=>LISTAS[l]).flatMap(([l,a])=>a.map(x=>({p:{slug:PAGINA[l],titulo:x.nome,texto:(x.en?x.en+' ':'')+(x.descricao||'')},onde:LISTAS[l].onde(x),ancora:x.slug}))),...WK.pag.map(p=>({p,onde:'Wiki de '+((mesaOf(p.mesa)||{}).nome||'mesa')+(p.cat?' · '+p.cat:'')}))];
  return WK.idx=todos.map(x=>{const chars=Array.from(W.textoPuro(x.p.texto));
    const norm=chars.map(ch=>(ch.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()||' ')[0]).join('');
    const hs=[...String(x.p.texto).matchAll(/^#{1,6}\s+(.*?)\s*#*$/gm)].map(m=>m[1].replace(/[*_`]/g,''));
    return{...x,chars,norm,hs,nt:W.simples(x.p.titulo)}})}
const VAZIAS=new Set('de da do das dos em no na nos nas um uma uns umas o a os as e ou com por para pra que se ao aos sem sob'.split(' '));
function buscaWiki(q){const todos=W.simples(q).split(/\s+/).filter(t=>t.length>1),cheios=todos.filter(t=>!VAZIAS.has(t)),ts=cheios.length?cheios:todos;if(!ts.length)return{ts,res:[]};ts.frase=W.simples(q).replace(/\s+/g,' ');
  const res=[];for(const x of wikiIdx()){let sc=0;
    if(ts.every(t=>x.nt.includes(t)))sc+=100;if(x.nt===ts.frase)sc+=300;else if(x.nt.startsWith(ts.frase))sc+=60;
    const h=x.hs.find(h=>ts.every(t=>W.simples(h).includes(t)));if(h)sc+=50;
    if(ts.every(t=>x.norm.includes(t)))sc+=10+Math.min(30,ts.reduce((s,t)=>s+x.norm.split(t).length-1,0));
    if(sc)res.push({...x,sc,h})}
  return{ts,res:res.sort((a,b)=>b.sc-a.sc).slice(0,40)}}
function trecho(x,ts){const fr=ts.frase?x.norm.indexOf(ts.frase):-1,longo=ts.slice().sort((a,b)=>b.length-a.length)[0];
  const ini=fr>=0?fr:(k=>k<0?Infinity:k)(x.norm.indexOf(longo));
  if(ini===Infinity)return esc(x.p.resumo||x.chars.slice(0,160).join(''));
  const a=Math.max(0,ini-60),b=Math.min(x.chars.length,ini+160),seg=x.chars.slice(a,b),nseg=x.norm.slice(a,b),marcas=[];
  for(const t of ts){let k=0;while((k=nseg.indexOf(t,k))>=0){marcas.push([k,k+t.length]);k+=t.length}}
  marcas.sort((p,q)=>p[0]-q[0]);let h='',pos=0;
  for(const [s,e] of marcas){if(s<pos)continue;h+=esc(seg.slice(pos,s).join(''))+'<mark>'+esc(seg.slice(s,e).join(''))+'</mark>';pos=e}
  return (a?'…':'')+h+esc(seg.slice(pos).join(''))+(b<x.chars.length?'…':'')}
function wikiResultados(q){const {ts,res}=buscaWiki(q);
  if(!ts.length)return '<p class="note">Digite pelo menos duas letras.</p>';
  if(!res.length)return card('Nada encontrado',`<p class="note">Nenhuma página fala de “${esc(q)}”. Tente outra palavra.</p>`);
  return `<p class="note">${res.length===40?'Os 40 primeiros resultados':res.length+(res.length===1?' página encontrada':' páginas encontradas')}</p><div class="wlist card">${res.map(x=>`<a class="wli" href="${esc(pgHref(x.p,x.ancora||(x.h?W.slug(x.h):'')))}"><b>${esc(x.p.titulo)}${x.h&&x.h!==x.p.titulo?` <em>› ${esc(x.h)}</em>`:''}</b><small>${esc(x.onde)}</small><span>${trecho(x,ts)}</span></a>`).join('')}</div>`}

// página aberta: regra da suíte ou página de mesa
function pPagina(p,ctx){const r=W.render(p.texto,{link:linker(ctx)});const base=!!p.slug,m=!base&&mesaOf(p.mesa),mestre=!!m&&isMestre(m);
  const crumbs=base?`<a href="#wiki">Wiki</a> › ${esc(p.cat)}`:`<a href="#mesa/${esc(m.id)}/wiki">Wiki de ${esc(m.nome)}</a>${p.cat?' › '+esc(p.cat):''}`;
  const acoes=mestre?`<div class="btns wacts"><button class="btn sm pri" data-a="wedit" data-v="${esc(p.id)}">Editar</button><button class="tog ${p.lib?'on':''}" data-a="wlib" data-v="${esc(p.id)}" aria-pressed="${p.lib}">${p.lib?'Liberada':'Oculta'}</button>${armBtn('wdel:'+p.id,'Apagar','Toque de novo para apagar')}</div>`:'';
  const info=base?`Regras da suíte, um resumo baseado no SRD 5.1. <a href="#wiki/sobre-as-regras">Sobre estas regras</a>`:`Atualizada em ${when(p.upd)}${p.autor?' por '+esc(p.autor):''}${mestre?(p.lib?' · liberada para os jogadores':' · oculta dos jogadores'):''}`;
  const itens=r.toc.map(t=>`<a class="l${t.nivel}" href="${esc(pgHref(p,t.id))}">${esc(t.texto)}</a>`).join('');
  const toc=r.toc.length>2?`<aside class="wside"><div class="wtoc" role="navigation" aria-label="Nesta página"><b>Nesta página</b>${itens}</div></aside>`:'';
  const tocm=r.toc.length>2?`<details class="wtocm"><summary>Nesta página</summary><div class="wtoc" role="navigation" aria-label="Nesta página">${itens}</div></details>`:'';
  return `<div class="wcrumb">${crumbs}</div><div class="wlay${toc?'':' notoc'}"><article class="card wart"><h1 class="wtit">${esc(p.titulo)}</h1>${base&&p.resumo?`<p class="wlead">${esc(p.resumo)}</p>`:''}${acoes}${tocm}${r.html||(p.lista?'':'<p class="note">Página vazia.</p>')}${p.lista?listaHtml(p):''}<p class="foot winfo">${info}</p></article>${toc}</div>`}
function pWiki(){
  if(!WK.base)return carregandoWiki();
  const sel=S.wikiSel;
  if(sel&&sel.slug){const p=basePg(sel.slug);return p?pPagina(p,{mesa:null,pg:p}):card('Página não encontrada',`<p class="note">Não há uma página de regras com esse endereço.</p><div class="btns"><a class="btn sm" href="#wiki">Voltar para a wiki</a></div>`)}
  const q=S.wikiQ||'',busca=!!q.trim();
  const mesas=S.mesas.map(m=>{const ps=pgsDaMesa(m.id).slice().sort((a,b)=>b.upd-a.upd),mestre=isMestre(m);
    return `<section class="card"><button class="hcard" data-a="gomwiki" data-v="${esc(m.id)}"><span class="mav${mestre?' gm':''}">${esc(ini(m.nome))}</span><span><b>Wiki de ${esc(m.nome)}</b><small>${ps.length?ps.length+(ps.length===1?' página':' páginas'):mestre?'Nenhuma página ainda':'Nenhuma página liberada ainda'}</small></span></button>
    ${ps.length?`<div class="wlist">${ps.slice(0,5).map(p=>`<a class="wli" href="${esc(pgHref(p))}"><b>${esc(p.titulo)}</b>${p.cat||(mestre&&!p.lib)?`<small>${esc([p.cat,mestre&&!p.lib?'oculta':''].filter(Boolean).join(' · '))}</small>`:''}</a>`).join('')}</div>`:''}
    <div class="btns" style="margin-top:10px"><button class="btn sm pri" data-a="gomwiki" data-v="${esc(m.id)}">${ps.length>5?`Ver todas (${ps.length})`:'Abrir'}</button>${mestre?`<button class="btn sm" data-a="wnova" data-v="${esc(m.id)}|">Nova página</button>`:''}</div></section>`}).join('');
  const cats=[];for(const p of WK.base){let c=cats.find(x=>x.cat===p.cat);if(!c)cats.push(c={cat:p.cat,ps:[]});c.ps.push(p)}
  const regras=cats.map(c=>card(esc(c.cat),`<div class="wlist">${c.ps.map(p=>`<a class="wli" href="${esc(pgHref(p))}"><b>${esc(p.titulo)}</b><span>${esc(p.resumo)}</span></a>`).join('')}</div>`)).join('');
  return `<div class="wsearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="wq" type="search" placeholder="Buscar nas regras e nas wikis das mesas" value="${esc(q)}" aria-label="Buscar na wiki" autocomplete="off" enterkeyhint="search"></div>
  <div id="wres"${busca?'':' hidden'}>${busca?wikiResultados(q):''}</div>
  <div id="widx"${busca?' hidden':''}>${mesas?`<h2 class="ph">Wikis das suas mesas</h2><div class="grid">${mesas}</div>`:''}<h2 class="ph">Regras do jogo</h2><div class="grid">${regras}</div></div>`}
// aba Wiki da mesa: lista, página aberta ou editor
function pMesaWiki(m){
  if(S.wEdit&&S.wEdit.mesa===m.id)return pEditor(m);
  if(!WK.base)return carregandoWiki();
  const sel=S.wikiSel,mestre=isMestre(m);
  if(sel&&sel.id){const p=mesaPg(sel.id);if(p&&p.mesa===m.id)return pPagina(p,{mesa:m.id,pg:p});
    return card('Página não encontrada',`<p class="note">${mestre?'Ela pode ter sido apagada.':'Ela pode ter sido apagada ou ocultada pelo mestre.'}</p><div class="btns"><button class="btn sm" data-a="gomwiki" data-v="${esc(m.id)}">Voltar para a wiki da mesa</button></div>`)}
  const ps=pgsDaMesa(m.id),grupos=[];
  for(const p of ps.slice().sort((a,b)=>(a.cat||'~').localeCompare(b.cat||'~','pt-BR')||a.titulo.localeCompare(b.titulo,'pt-BR'))){const c=p.cat||'Sem categoria';let g=grupos.find(x=>x.c===c);if(!g)grupos.push(g={c,ps:[]});g.ps.push(p)}
  const linha=p=>`<div class="prow"><a class="pick" href="${esc(pgHref(p))}"><div><b>${esc(p.titulo)}</b><span>Atualizada em ${when(p.upd)}</span></div></a>${mestre?`<button class="tog ${p.lib?'on':''}" data-a="wlib" data-v="${esc(p.id)}" aria-pressed="${p.lib}">${p.lib?'Liberada':'Oculta'}</button>`:''}</div>`;
  const lista=ps.length?grupos.map(g=>card(esc(g.c),g.ps.map(linha).join(''))).join(''):card(mestre?'A wiki da mesa está vazia':'Nada por aqui ainda',`<p class="note">${mestre?'Escreva páginas sobre o cenário, os lugares, os personagens do mestre e as regras da casa, ou importe um documento pronto. As páginas novas começam ocultas: libere quando quiser que os jogadores leiam.':'O mestre ainda não liberou nenhuma página. Enquanto isso, as regras do jogo estão na wiki.'}</p>`);
  const novo=mestre?card('Escrever',`<div class="btns"><button class="btn pri" data-a="wnova" data-v="${esc(m.id)}|">Nova página</button><label class="btn">Importar documento<input type="file" id="wimp" data-mesa="${esc(m.id)}" accept=".html,.htm,.md,.markdown,.txt,text/html,text/markdown,text/plain,image/png,image/jpeg,image/webp,image/gif" multiple hidden></label></div>
    <p class="foot">Importar aceita HTML e Markdown. Selecione o documento junto com as imagens que ele usa para trazê-las também.</p>
    <p class="foot">Trechos entre <code>:::mestre</code> e <code>:::</code> só você vê. <a href="#wiki/escrevendo-na-wiki">Como formatar as páginas</a></p>`):'';
  const regras=card('Regras do jogo',`<div class="wlist">${['como-jogar','combate','condicoes','magia'].map(basePg).filter(Boolean).map(p=>`<a class="wli" href="${esc(pgHref(p))}"><b>${esc(p.titulo)}</b></a>`).join('')}</div><div class="btns" style="margin-top:10px"><button class="btn sm" data-a="go" data-v="wiki">Todas as regras e a busca</button></div>`);
  return `<div class="cols wcols"><div class="stackc">${lista}</div><div class="stackc">${novo}${regras}</div></div>`}
// cartão na aba Mesa
function cardWikiMesa(m){const ps=pgsDaMesa(m.id).slice().sort((a,b)=>b.upd-a.upd),mestre=isMestre(m);
  return card('Wiki da mesa',`${!WK.base?'<p class="note">Carregando…</p>':ps.length?`<div class="wlist">${ps.slice(0,5).map(p=>`<a class="wli" href="${esc(pgHref(p))}"><b>${esc(p.titulo)}</b>${mestre&&!p.lib?'<small>oculta</small>':''}</a>`).join('')}</div>`:`<p class="note">${mestre?'Nenhuma página ainda. Escreva sobre o cenário e as regras da casa para os jogadores lerem com calma.':'O mestre ainda não liberou nenhuma página.'}</p>`}
    <div class="btns" style="margin-top:10px"><button class="btn pri" data-a="gomwiki" data-v="${esc(m.id)}">Abrir a wiki da mesa</button></div>`)}
// listas de dados da wiki (magias, itens mágicos, equipamento): carregadas só quando alguém precisa
WK.dados={};WK.dadosIdx={};WK.dadosVindo={};WK.dadosErro={};
const PAGINA={magias:'lista-de-magias','itens-magicos':'itens-magicos',equipamento:'equipamento-de-aventura'};
const CLASSES=['Bardo','Bruxo','Clérigo','Druida','Feiticeiro','Mago','Paladino','Patrulheiro'];
const ESCOLAS=['Abjuração','Adivinhação','Conjuração','Encantamento','Evocação','Ilusão','Necromancia','Transmutação'];
const RARIDADES=['comum','incomum','raro','muito raro','lendário','artefato','varia'];
const TIPOS=['Arma','Armadura','Poção','Anel','Bastão','Cajado','Varinha','Pergaminho','Item maravilhoso'];
const nivelTxt=n=>n?n+'º nível':'Truque';
const sintTxt=s=>s===true?'requer sintonia':s?'requer sintonia '+s:'';
const opcoes=(todos,arr)=>[['',todos],...arr.map(x=>Array.isArray(x)?x:[x,x])];
const LISTAS={
  magias:{nome:'magias',um:'magia',cat:/^magias?$/,onde:x=>'Lista de magias · '+nivelTxt(x.nivel),
    filtros:[['nivel','Nível',opcoes('Todos os níveis',[['0','Truques'],...[1,2,3,4,5,6,7,8,9].map(n=>[String(n),n+'º nível'])])],['classe','Classe',opcoes('Todas as classes',CLASSES)],['escola','Escola',opcoes('Todas as escolas',ESCOLAS)],['extra','Outros',opcoes('Qualquer',[['ritual','Ritual'],['conc','Concentração'],['semconc','Sem concentração']])]],
    passa:(x,f)=>(!f.nivel||String(x.nivel)===f.nivel)&&(!f.classe||(x.classes||[]).includes(f.classe))&&(!f.escola||x.escola===f.escola)&&(!f.extra||(f.extra==='ritual'?x.ritual:f.extra==='conc'?x.conc:!x.conc)),
    grupo:x=>x.nivel?x.nivel+'º nível':'Truques',
    linha:x=>[nivelTxt(x.nivel)+' de '+String(x.escola||'').toLowerCase(),x.ritual?'ritual':'',x.conc?'concentração':'',(x.classes||[]).join(', ')].filter(Boolean).join(' · '),
    corpo:x=>`<dl class="wst"><dt>Tempo</dt><dd>${esc(x.tempo)}</dd><dt>Alcance</dt><dd>${esc(x.alcance)}</dd><dt>Componentes</dt><dd>${esc(x.componentes)}</dd><dt>Duração</dt><dd>${esc(x.duracao)}</dd></dl>${W.render(x.descricao).html}${x.superior?`<p><b>Em níveis superiores.</b> ${W.render(x.superior).html.replace(/^<p>|<\/p>$/g,'')}</p>`:''}<p class="foot">${esc(nivelTxt(x.nivel))} de ${esc(String(x.escola||'').toLowerCase())}${x.ritual?' (ritual)':''} · ${esc((x.classes||[]).join(', '))}${x.en?` · <i>${esc(x.en)}</i>`:''}</p>`},
  'itens-magicos':{nome:'itens mágicos',um:'item',cat:/^itens? magicos?$/,onde:x=>'Itens mágicos · '+x.raridade,
    filtros:[['tipo','Tipo',opcoes('Todos os tipos',TIPOS)],['raridade','Raridade',opcoes('Todas as raridades',RARIDADES.map(r=>[r,r[0].toUpperCase()+r.slice(1)]))],['sintonia','Sintonia',opcoes('Com ou sem sintonia',[['sim','Requer sintonia'],['nao','Sem sintonia']])]],
    passa:(x,f)=>(!f.tipo||String(x.tipo||'').startsWith(f.tipo))&&(!f.raridade||x.raridade===f.raridade)&&(!f.sintonia||(f.sintonia==='sim')===!!x.sintonia),
    grupo:x=>W.simples(x.nome)[0].toUpperCase(),
    linha:x=>[x.tipo,x.raridade,sintTxt(x.sintonia)].filter(Boolean).join(' · '),
    corpo:x=>`<p class="wsub"><i>${esc([x.tipo,x.raridade,sintTxt(x.sintonia)?'('+sintTxt(x.sintonia)+')':''].filter(Boolean).join(', '))}</i></p>${W.render(x.descricao).html}${x.en?`<p class="foot"><i>${esc(x.en)}</i></p>`:''}`},
  equipamento:{nome:'itens',um:'item',cat:/^(equipamento|itens? comuns?)$/,onde:x=>'Equipamento · '+x.cat,
    filtros:[['cat','Categoria',opcoes('Todas as categorias',['Equipamento de aventura','Munição','Foco de conjuração','Pacote de equipamento','Ferramentas','Instrumento musical','Montarias e veículos','Comida e hospedagem','Serviços'])]],
    passa:(x,f)=>!f.cat||x.cat===f.cat,
    grupo:x=>x.cat,
    linha:x=>[x.preco,x.peso?String(x.peso).replace('.',',')+' kg':''].filter(Boolean).join(' · '),
    corpo:x=>`<dl class="wst"><dt>Preço</dt><dd>${esc(x.preco)}</dd><dt>Peso</dt><dd>${x.peso?esc(String(x.peso).replace('.',','))+' kg':'–'}</dd></dl>${x.descricao?W.render(x.descricao,{link:linker({mesa:null,pg:null})}).html:''}`}};
const MODELO={'Itens mágicos':'**Tipo:** Item maravilhoso · **Raridade:** incomum · **Sintonia:** não\n\nO que o item faz, como se ativa, cargas e como elas voltam.','Magias':'**Nível:** 1º · **Escola:** Evocação · **Tempo:** 1 ação · **Alcance:** 18 metros · **Componentes:** V, S · **Duração:** Instantânea · **Classes:** Mago\n\nO efeito da magia: alvos, salvaguarda, dano.\n\n**Em níveis superiores.** O que muda com espaços maiores.'};
function loadDados(n){if(WK.dados[n]||WK.dadosVindo[n]||Date.now()-(WK.dadosErro[n]||0)<10000||!S.me)return;
  WK.dadosVindo[n]=api('GET','/api/wiki/dados/'+n).then(a=>{WK.dados[n]=a;const m=new Map();for(const x of a){m.set(W.simples(x.nome),x);if(x.en&&!m.has(W.simples(x.en)))m.set(W.simples(x.en),x)}WK.dadosIdx[n]=m;WK.idx=null})
    .catch(()=>{WK.dadosErro[n]=Date.now()}).finally(()=>{delete WK.dadosVindo[n];const q=$('wq');if(q&&q.value.trim()&&$('wres'))$('wres').innerHTML=wikiResultados(q.value);softRender()})}
const acharDado=(l,nome)=>nome&&WK.dadosIdx[l]?WK.dadosIdx[l].get(W.simples(nome)):null;
function listaPendente(){const p=S.page==='wiki'&&S.wikiSel&&basePg(S.wikiSel.slug);return !!(p&&p.lista&&!WK.dados[p.lista])}
// "?" ao lado de uma magia ou item da ficha que existe na wiki
function ajDado(l,nome){const x=acharDado(l,nome);return x?aj(PAGINA[l]+'#'+x.slug,x.nome):''}
function sugestoes(tipo){const ls=tipo==='magias'?['magias']:['equipamento','itens-magicos'];if(!ls.every(l=>WK.dados[l]))return '';
  return `<datalist id="dl-${tipo}">${ls.flatMap(l=>WK.dados[l].map(x=>`<option value="${esc(x.nome)}">`)).join('')}</datalist>`}
// ao escrever o nome de uma magia ou item conhecido, a ficha completa o nível ou o peso
function completar(c,k){let m;
  if((m=/^spells\.(\d+)\.n$/.exec(k))){const s=c.spells[+m[1]],x=acharDado('magias',s&&s.n);if(x&&(+s.l||0)!==x.nivel){s.l=x.nivel;const e=document.querySelector(`[data-k="spells.${m[1]}.l"]`);if(e)e.value=String(x.nivel);softRender()}}
  else if((m=/^items\.(\d+)\.n$/.exec(k))){const it=c.items[+m[1]],x=acharDado('equipamento',it&&it.n);if(x&&x.peso&&!(+it.w)){it.w=x.peso;const e=document.querySelector(`[data-k="items.${m[1]}.w"]`);if(e)e.value=String(x.peso)}}}
// página de lista: filtros em cima, resultados embaixo; a descrição só é montada quando a entrada abre
const filtrosDe=l=>(S.wf=S.wf||{})[l]=(S.wf[l]||{});
function listaHtml(p){const l=p.lista,cfg=LISTAS[l];if(!cfg)return '';loadDados(l);
  const sel=S.wikiSel,anc=sel&&sel.anc;
  if(anc&&WK.ancLista!==l+'/'+anc&&WK.dados[l]&&WK.dados[l].some(x=>x.slug===anc)){WK.ancLista=l+'/'+anc;S.wf[l]={}}
  const f=filtrosDe(l);
  const ctl=`<div class="wfil"><div class="wsearch sm"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" data-wf="q" data-lista="${l}" value="${esc(f.q||'')}" placeholder="Buscar ${cfg.nome}" aria-label="Buscar ${cfg.nome}" autocomplete="off"></div>
    ${cfg.filtros.map(([k,rot,ops])=>`<select data-wf="${k}" data-lista="${l}" aria-label="${rot}">${ops.map(([v,t])=>`<option value="${esc(v)}"${(f[k]||'')===v?' selected':''}>${esc(t)}</option>`).join('')}</select>`).join('')}</div>`;
  return `<section class="wlista" data-lista="${l}">${ctl}<div id="wlres">${listaResultados(l)}</div></section>`}
function listaResultados(l){const cfg=LISTAS[l],f=filtrosDe(l),a=WK.dados[l];
  if(!a)return `<p class="note">${WK.dadosErro[l]?'Não deu para carregar a lista agora.':'Carregando…'}</p>`;
  const ts=W.simples(f.q||'').split(/\s+/).filter(Boolean),bate=t=>ts.every(x=>t.includes(x));
  const proprias=WK.pag.filter(p=>cfg.cat.test(W.simples(p.cat||''))&&bate(W.simples(p.titulo+' '+p.texto)));
  const mestreDe=S.mesas.filter(isMestre);
  const criados=(proprias.length||mestreDe.length)&&l!=='equipamento'?`<div class="wcri"><h3>${l==='magias'?'Criadas':'Criados'} nas suas mesas</h3>${proprias.map(p=>`<a class="wli" href="${esc(pgHref(p))}"><b>${esc(p.titulo)}</b><small>Wiki de ${esc((mesaOf(p.mesa)||{}).nome||'mesa')}${isMestre(mesaOf(p.mesa))&&!p.lib?' · oculta':''}</small><span>${esc(W.textoPuro(p.texto).slice(0,140))}</span></a>`).join('')||`<p class="note">Nenhum${l==='magias'?'a magia criada':' item criado'} ainda.</p>`}
    ${mestreDe.length?`<div class="btns">${mestreDe.map(m=>`<button class="btn sm" data-a="wnova" data-v="${esc(m.id)}||${l==='magias'?'Magias':'Itens mágicos'}">${l==='magias'?'Nova magia':'Novo item'}${S.mesas.length>1?' em '+esc(m.nome):''}</button>`).join('')}</div>`:''}</div>`:'';
  const res=a.filter(x=>cfg.passa(x,f)&&(!ts.length||bate(W.simples(x.nome+' '+(x.en||'')+' '+(x.descricao||'')))));
  const anc=S.wikiSel&&S.wikiSel.anc;let h='',g=null;
  for(const x of res){const gx=cfg.grupo(x);if(gx!==g){g=gx;h+=`<div class="lvh">${esc(g)}</div>`}const aberto=x.slug===anc;
    h+=`<details class="wsp" id="w-${esc(x.slug)}" data-l="${l}" data-s="${esc(x.slug)}"${aberto?' open':''}><summary><b>${esc(x.nome)}</b><small>${esc(cfg.linha(x))}</small></summary><div class="wsb wart">${aberto?cfg.corpo(x):''}</div></details>`}
  return `${criados}<p class="note wcount">${res.length===a.length?`${a.length} ${cfg.nome}`:`${res.length} de ${a.length} ${cfg.nome}`}</p>${h||`<p class="note">Nenhum${cfg.um==='magia'?'a magia':' item'} com esses filtros.</p>`}`}
document.addEventListener('toggle',e=>{const d=e.target;if(!d.classList||!d.classList.contains('wsp')||!d.open)return;const b=d.querySelector('.wsb');if(b&&!b.innerHTML){const x=(WK.dados[d.dataset.l]||[]).find(y=>y.slug===d.dataset.s);if(x)b.innerHTML=LISTAS[d.dataset.l].corpo(x)}},true);
function filtrar(el){const l=el.dataset.lista;filtrosDe(l)[el.dataset.wf]=el.value;const r=$('wlres');if(r)r.innerHTML=listaResultados(l)}

// condições ativas na ficha, com o texto da regra
function condResumo(c){if(!c.cond.length)return '';const b=basePg('condicoes');if(!b){if(!WK.base)loadWiki();return ''}
  return `<div class="csum">${c.cond.map(n=>{const id=W.slug(n),t=W.secao(b.texto,id);return t?`<details class="cs" open><summary>${esc(n)}</summary><div class="wart">${W.render(t,{link:linker({mesa:null,pg:b})}).html}<a class="wl" href="#wiki/condicoes/${id}">Ler na wiki</a></div></details>`:''}).join('')}</div>`}

// editor de página (só o mestre)
function pEditor(m){const e=S.wEdit,cats=[...new Set(pgsDaMesa(m.id).map(p=>p.cat).filter(Boolean))];
  const corpo=e.prev?`<div class="wart wprev">${W.render(e.texto,{link:linker({mesa:m.id,pg:{id:e.id||'nova',mesa:m.id,texto:e.texto,titulo:e.titulo}})}).html||'<p class="note">Nada escrito ainda.</p>'}</div>`
    :`<textarea id="wtxt" data-w="texto" class="wtxt" aria-label="Texto da página" placeholder="Escreva aqui.&#10;&#10;## Seção&#10;Texto com **negrito**, *itálico* e [[links para outras páginas]].&#10;&#10;- listas&#10;&#10;:::mestre&#10;Só o mestre vê este trecho.&#10;:::">${esc(e.texto)}</textarea>`;
  return `<div class="wcrumb"><a href="#mesa/${esc(m.id)}/wiki">Wiki de ${esc(m.nome)}</a> › ${e.id?'Editar página':'Nova página'}</div>
  <section class="card wed"><div class="g2"><div class="span2"><label for="wtit">Título</label><input id="wtit" data-w="titulo" value="${esc(e.titulo)}" maxlength="80" placeholder="Ex.: A cidade de Pedravela"></div>
  <div><label for="wcat">Categoria</label><input id="wcat" data-w="cat" list="wcats" value="${esc(e.cat)}" maxlength="40" placeholder="Ex.: Lugares"><datalist id="wcats">${[...new Set([...cats,'Cenário','Lugares','Personagens','Facções','Regras da casa','Sessões'])].map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
  <div><label>Jogadores</label><button class="tog wlibed ${e.lib?'on':''}" data-a="wlibed" aria-pressed="${e.lib}">${e.lib?'Liberada':'Oculta'}</button></div></div>
  <div class="wbar">${segl([['0','Escrever'],['1','Ver como fica']],e.prev?'1':'0','wprev')}<label class="btn sm">Imagem<input type="file" id="wimg" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label><a class="btn sm" href="#wiki/escrevendo-na-wiki">Como formatar</a></div>
  ${corpo}
  <div class="btns" style="margin-top:12px"><button class="btn pri" data-a="wsalvar">Salvar</button><button class="btn" data-a="wcancelar">${arm==='wcancelar'?'Toque de novo para descartar':e.dirty?'Descartar':'Cancelar'}</button></div>
  <p class="foot">${e.lib?'Liberada: todos da mesa leem esta página, menos os trechos :::mestre.':'Oculta: só você vê esta página até liberar.'}</p></section>`}
function wEditar(mid,p,titulo,cat){S.wEdit=p?{id:p.id,mesa:p.mesa,titulo:p.titulo,cat:p.cat||'',texto:p.texto||'',lib:!!p.lib,prev:false,dirty:false}:{id:null,mesa:mid,titulo:titulo||'',cat:cat||'',texto:MODELO[cat]||'',lib:false,prev:false,dirty:false};
  go('mwiki',(p?p.mesa:mid)+(p?'|'+p.id:''));setTimeout(()=>{const x=$(p||titulo?'wtxt':'wtit');x&&x.focus()},30)}
async function wSalvar(){const e=S.wEdit;if(!e)return;if(!e.titulo.trim()){toast('<div><b>Dê um título para a página</b></div>');const x=$('wtit');x&&x.focus();return}
  try{const body={titulo:e.titulo,cat:e.cat,texto:e.texto,lib:e.lib};const p=e.id?await api('PUT','/api/wiki/'+e.id,body):await api('POST','/api/wiki',{...body,mesa:e.mesa});
    S.wEdit=null;upsertPg(p);go('mwiki',p.mesa+'|'+p.id);toast(`<div><b>Página salva</b><small>${p.lib?'Liberada para os jogadores.':'Oculta dos jogadores.'}</small></div>`)}
  catch(err){if(err.status===401)return showAuth();toast(`<div><b>Não foi possível salvar</b><small>${esc(err.message)}</small></div>`)}}
async function enviarImg(file,mid){const r=await fetch('/api/wiki/img?mesa='+encodeURIComponent(mid),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file,credentials:'same-origin'});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Erro '+r.status);return j}
async function wImagem(file){const e=S.wEdit;if(!e||!file)return;toast('<div><b>Enviando imagem…</b></div>');
  try{const {url}=await enviarImg(file,e.mesa);const ta=$('wtxt');const pos=ta?ta.selectionStart:e.texto.length;
    const md=`\n![${file.name.replace(/\.[^.]+$/,'').replace(/[\[\]]/g,'')}](${url})\n`;e.texto=e.texto.slice(0,pos)+md+e.texto.slice(pos);e.dirty=true;e.prev=false;render();
    const t=$('wtxt');if(t){t.focus();t.selectionStart=t.selectionEnd=pos+md.length}toast('<div><b>Imagem inserida</b></div>')}
  catch(err){toast(`<div><b>Não foi possível enviar</b><small>${esc(err.message)}</small></div>`)}}
// importa documentos HTML ou Markdown; as imagens escolhidas junto vão para a wiki e os endereços são trocados
async function wImportar(files,mid){const arr=[...files],imgs=arr.filter(f=>/^image\//.test(f.type)),docs=arr.filter(f=>!/^image\//.test(f.type));
  if(!docs.length)return toast('<div><b>Escolha um documento</b><small>Um arquivo .html ou .md, com as imagens dele junto.</small></div>');
  toast(`<div><b>Importando ${docs.length>1?docs.length+' documentos':'o documento'}…</b></div>`);
  const enviadas=new Map(),faltam=new Set(),criadas=[],erros=[];
  for(const f of docs){
    try{const src=await f.text();let titulo='',texto='',refs=[];
      if(/\.html?$/i.test(f.name)||/^\s*</.test(src)){const r=W.deHtml(src);titulo=r.titulo;texto=r.texto;refs=r.imagens}
      else{texto=src.replace(/\r\n?/g,'\n');const h=/^#\s+(.+)$/m.exec(texto);if(h){titulo=h[1].trim();texto=texto.replace(h[0],'').trim()}
        refs=[...texto.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)].map(x=>x[1]).filter(u=>!/^(https?:|\/api\/|data:)/i.test(u))}
      titulo=(titulo||f.name.replace(/\.[^.]+$/,'')).slice(0,80);
      for(const ref of refs){let nome=ref.split(/[\\/]/).pop().split(/[?#]/)[0];try{nome=decodeURIComponent(nome)}catch(e){}
        const arq=imgs.find(i=>i.name===nome)||imgs.find(i=>i.name.toLowerCase()===nome.toLowerCase());
        if(arq&&!enviadas.has(arq.name)){try{enviadas.set(arq.name,(await enviarImg(arq,mid)).url)}catch(e){enviadas.set(arq.name,null)}}
        const url=arq&&enviadas.get(arq.name);
        if(url)texto=texto.split(`](${ref.replace(/\s/g,'%20')}`).join(`](${url}`);else faltam.add(nome)}
      let p=null;
      for(let n=1;!p&&n<20;n++){try{p=await api('POST','/api/wiki',{mesa:mid,titulo:n>1?`${titulo.slice(0,74)} (${n})`:titulo,cat:'',texto,lib:false})}catch(e){if(e.status!==409)throw e}}
      if(p){upsertPg(p);criadas.push(p)}}
    catch(err){erros.push(`${f.name}: ${err.message}`)}}
  if(criadas.length)go('mwiki',mid+'|'+criadas[0].id);
  toast(`<div><b>${criadas.length?criadas.length+(criadas.length>1?' páginas importadas, ocultas':' página importada, oculta')+' dos jogadores':'Nada importado'}</b><small>${esc([faltam.size?'Imagens que não vieram: '+[...faltam].join(', ')+'. Selecione-as junto com o documento.':'',...erros].filter(Boolean).join(' '))||'Confira a página e libere quando estiver pronta.'}</small></div>`)}

/* ---------- configurações ---------- */
const CFG=[['conta','Conta'],['mesa','Mesa']];
const K={tokens:null,audit:null,info:null,novo:null,filtro:'',modo:'node',pasta:'',url:location.origin,loading:null};
try{const x=JSON.parse(localStorage.getItem('fichas5e-mcp')||'{}');for(const k of['modo','pasta','url'])if(x[k])K[k]=x[k]}catch(e){}
function saveK(){try{localStorage.setItem('fichas5e-mcp',JSON.stringify({modo:K.modo,pasta:K.pasta,url:K.url}))}catch(e){}}
const cfgHash=()=>'#config/'+S.cfgTab+(S.cfgTab==='mesa'&&S.cfgMesa?'/'+S.cfgMesa:'');
const when=t=>t?new Date(t).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'nunca';
function redraw(){render()}
function applyTheme(){const t=S.me&&S.me.prefs&&S.me.prefs.tema;const r=document.documentElement;
  if(t==='claro')r.dataset.theme='light';else if(t==='escuro')r.dataset.theme='dark';else delete r.dataset.theme}
function setPref(k,v){const old=S.me.prefs[k];S.me.prefs={...S.me.prefs,[k]:v};applyTheme();render();
  api('PATCH','/api/me',{prefs:{[k]:v}}).then(st=>{applyState(st);softRender()}).catch(err=>{S.me.prefs={...S.me.prefs,[k]:old};applyTheme();render();toast(`<div><b>${esc(err.message)}</b></div>`)})}
function loadConta(){if(K.loading)return K.loading;
  K.loading=Promise.all([api('GET','/api/tokens'),api('GET','/api/audit?limite=200'+(K.filtro?'&token='+encodeURIComponent(K.filtro):'')),K.info||api('GET','/api/info')])
    .then(([t,a,i])=>{K.tokens=t.tokens;K.audit=a.registros;K.info=i;if(!K.pasta&&i.pasta)K.pasta=i.pasta})
    .catch(err=>{if(err.status===401)return showAuth();toast(`<div><b>Não deu para carregar a conta</b><small>${esc(err.message)}</small></div>`)})
    .finally(()=>{K.loading=null;if(S.me&&S.page==='config'&&S.cfgTab==='conta')softRender()});
  return K.loading}
function mcpLine(tok){const t=tok||'COLE_O_TOKEN_AQUI';const q=x=>/[\s"]/.test(x)?'"'+x.replace(/"/g,'\\"')+'"':x;
  const dir=(K.pasta||'/caminho/para/suite-dnd').replace(/[\\/]+$/,'');const sep=dir.includes('\\')?'\\':'/';
  if(K.modo==='docker')return `claude mcp add suite-dnd --scope local -e FICHA_TOKEN=${t} -- docker compose -f ${q(dir+sep+'compose.yaml')} run --rm -T mcp`;
  return `claude mcp add suite-dnd --scope local -e FICHA_URL=${K.url||location.origin} -e FICHA_TOKEN=${t} -- node ${q([dir,'apps','mcp','server.js'].join(sep))}`}
const sw=(title,desc,on,a,v)=>`<div class="sw"><div><b>${title}</b><span>${desc}</span></div><button class="tog ${on?'on':''}" data-a="${a}" data-v="${esc(v)}" aria-pressed="${!!on}">${on?'Ligado':'Desligado'}</button></div>`;
const segl=(opts,cur,a,pre='')=>`<div class="segl">${opts.map(([k,t])=>`<button class="${cur===k?'on':''}" data-a="${a}" data-v="${esc(pre+k)}" aria-pressed="${cur===k}">${t}</button>`).join('')}</div>`;
function tConta(){const me=S.me,p=me.prefs||{},nv=K.novo;
  const perfil=card('Perfil',`<label for="cfnome">Nome (aparece para a mesa e é usado para entrar)</label><div class="amt" style="grid-template-columns:minmax(0,1fr) auto"><input id="cfnome" value="${esc(me.name)}" maxlength="30" autocomplete="username"><button class="btn" data-a="cfnome">Salvar</button></div>
    <label style="margin-top:14px">Tema</label>${segl([['auto','Do aparelho'],['claro','Claro'],['escuro','Escuro']],p.tema,'pref','tema|')}
    ${sw('Abrir fichas em modo leitura','Evita mudar a ficha sem querer. Toque no lápis para editar.',p.abrirTravada,'pref','abrirTravada|'+(p.abrirTravada?0:1))}
    <label style="margin-top:12px" for="cfaba">Aba ao abrir o app</label><select id="cfaba" data-pref="abaInicial">${TABS.map(([k,t])=>`<option value="${k}"${p.abaInicial===k?' selected':''}>${t}</option>`).join('')}</select>
    <p class="foot">Valem em todos os aparelhos em que você entrar.</p>`);
  const mcp=card('Assistente (MCP)',`<p class="note">O Claude e outros assistentes entram no app com um token desta conta, sem a sua senha. Você pode pausar ou remover o token quando quiser, e tudo o que ele faz fica no registro de auditoria.</p>
    <div class="amt" style="grid-template-columns:minmax(0,1fr) auto"><input id="tknome" placeholder="Nome, ex.: Claude no notebook" maxlength="40" aria-label="Nome do novo token"><button class="btn pri" data-a="tknovo">Gerar token</button></div>
    ${nv?`<div class="fresh"><p class="note" style="margin:0 0 6px"><b>Token “${esc(nv.nome)}” criado.</b> Copie agora: ele não aparece de novo.</p><div class="copyrow"><code id="tkval">${esc(nv.token)}</code><button class="btn sm" data-a="cp" data-v="tkval">Copiar</button></div></div>`:''}
    <label style="margin-top:14px">Linha de configuração do Claude Code</label>${segl([['node','Node neste computador'],['docker','Docker']],K.modo,'mcpmodo')}
    <div class="g2" style="margin-top:8px"><div class="${K.modo==='docker'?'span2':''}"><label for="mcppasta">Pasta do projeto suite-dnd</label><input id="mcppasta" data-k2="pasta" value="${esc(K.pasta)}" placeholder="F:\\Dev\\ficha-dnd" spellcheck="false"></div>${K.modo==='node'?`<div><label for="mcpurl">Endereço do app</label><input id="mcpurl" data-k2="url" value="${esc(K.url)}" spellcheck="false"></div>`:''}</div>
    <pre class="cmd" id="mcpcmd">${esc(mcpLine(nv&&nv.token))}</pre>
    <div class="btns"><button class="btn sm" data-a="cp" data-v="mcpcmd">Copiar linha</button></div>
    <p class="foot">${nv?'A linha já leva o token novo.':'Gere um token para a linha já sair com ele, ou troque COLE_O_TOKEN_AQUI por um token seu.'} Rode no terminal. O escopo local guarda o token só na sua configuração, fora do repositório.${K.modo==='docker'?' No Docker, o MCP fala com o app pela rede interna e liga o app se ele estiver parado.':''}${K.info&&K.info.docker&&!K.pasta?' Este app roda em Docker: informe a pasta do projeto no seu computador.':''}</p>`);
  const tks=card('Tokens',K.tokens===null?'<p class="note">Carregando…</p>':K.tokens.length?K.tokens.map(t=>`<div class="tk${t.pausado?' off':''}"><div class="tkh"><b>${esc(t.nome)}</b><span class="badge${t.pausado?'':' ok'}">${t.pausado?'Pausado':'Ativo'}</span></div>
    <span class="foot" style="display:block;margin:2px 0 0"><code>${esc(t.inicio)}…</code> · criado ${when(t.criado)} · último uso ${when(t.usado)}</span>
    <div class="btns" style="margin-top:8px"><button class="btn sm" data-a="tkpausa" data-v="${esc(t.id)}">${t.pausado?'Retomar':'Pausar'}</button><button class="btn sm" data-a="tklog" data-v="${esc(t.id)}">Ver registro</button>${armBtn('tkrm:'+t.id,'Remover','Toque de novo para remover')}</div></div>`).join(''):'<p class="note">Nenhum token ainda.</p>');
  const fopts=[['','Todos os registros'],...(K.tokens||[]).map(t=>[t.id,'Token '+t.nome])];if(K.filtro&&!fopts.some(o=>o[0]===K.filtro))fopts.push([K.filtro,'Token removido']);
  const aud=card('Registro de auditoria',`<div class="amt" style="grid-template-columns:minmax(0,1fr) auto"><select id="audf" aria-label="Filtrar registros">${fopts.map(([k,t])=>`<option value="${esc(k)}"${K.filtro===k?' selected':''}>${esc(t)}</option>`).join('')}</select><button class="btn" data-a="audit">Atualizar</button></div>
    ${K.audit===null?'<p class="note" style="margin-top:10px">Carregando…</p>':K.audit.length?`<ol class="log">${K.audit.map(e=>`<li class="${e.status>=400?'bad':''}"><time>${when(e.t)}</time><span>${esc(e.acao)}</span><em>${e.via==='conta'?'pela conta':'token '+esc(e.token||'removido')}${e.status>=400?' · recusado ('+e.status+')':''}</em></li>`).join('')}</ol>`:'<p class="note" style="margin-top:10px">Nada registrado ainda.</p>'}
    <p class="foot">Guarda cada chamada feita com um token, inclusive as recusadas, e as mudanças nos tokens. As rolagens do assistente não passam pelo servidor e não aparecem aqui.</p>`);
  const seg=card('Senha e sessões',`<div class="g2"><div><label for="pold">Senha atual</label><input id="pold" type="password" autocomplete="current-password"></div><div><label for="pnew">Nova senha</label><input id="pnew" type="password" autocomplete="new-password"></div></div>
    <div class="btns" style="margin-top:8px"><button class="btn sm" data-a="pass">Trocar senha</button></div>
    <div class="btns" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px"><button class="btn sm" data-a="sairoutras">Sair dos outros aparelhos</button><button class="btn sm warn" data-a="logout">Sair da conta</button></div>`);
  return `<div class="cols"><div class="stackc">${perfil}${seg}</div><div class="stackc">${mcp}${tks}</div><div class="stackc">${aud}</div></div>`}
function tMesa(){
  if(!S.mesas.length)return `<div class="cols"><div class="stackc">${card('Nenhuma mesa ainda',`<p class="note">Entre numa mesa com o código do mestre ou crie a sua no Início. Quem cria a mesa é o mestre dela.</p><div class="btns"><button class="btn pri" data-a="go" data-v="inicio">Ir para o início</button></div>`)}</div></div>`;
  const m=mesaOf(S.cfgMesa)||S.mesas[0];S.cfgMesa=m.id;
  const pick=S.mesas.length>1?`<div class="chips" style="margin-bottom:14px" role="group" aria-label="Escolher mesa">${S.mesas.map(x=>`<button class="chip ${x.id===m.id?'on':''}" data-a="cfgmesa" data-v="${esc(x.id)}" aria-pressed="${x.id===m.id}">${esc(x.nome)}</button>`).join('')}</div>`:'';
  const fichas=[...S.chars.values()].filter(c=>c.mesa===m.id);
  const mestreNome=(m.membros.find(x=>x.id===m.mestre)||{}).name||'?';
  if(!isMestre(m)){
    const info=card(esc(m.nome),`<p class="note">Mestre: <b>${esc(mestreNome)}</b></p>${m.descricao?`<p style="white-space:pre-wrap;margin:0 0 10px">${esc(m.descricao)}</p>`:'<p class="note">O mestre ainda não escreveu uma descrição.</p>'}<label>Na mesa</label><div class="members">${m.membros.map(x=>`<span class="member" style="padding-right:12px">${esc(x.name)}${x.id===m.mestre?' (mestre)':''}</span>`).join('')}</div>`);
    const fs=card('Fichas na mesa',`${fichas.length?fichas.map(c=>row(c)).join(''):'<p class="note">Nenhuma ficha sua ou liberada nesta mesa.</p>'}<p class="foot">Para levar uma ficha sua para esta mesa, escolha a mesa na aba Principal da ficha.</p>`);
    const sair=card('Sair da mesa',`<p class="note">Suas fichas saem da mesa e voltam a ser só suas.</p>${armBtn('leave:'+m.id,'Sair da mesa','Toque de novo para sair')}`);
    return pick+`<div class="cols"><div class="stackc">${info}</div><div class="stackc">${fs}</div><div class="stackc">${sair}</div></div>`}
  const geral=card('Mesa',`<label for="mnome">Nome</label><input id="mnome" data-mesa="${esc(m.id)}" data-campo="nome" value="${esc(m.nome)}" maxlength="60">
    <label for="mdesc" style="margin-top:10px">Descrição para os jogadores</label><textarea id="mdesc" data-mesa="${esc(m.id)}" data-campo="descricao" maxlength="2000" placeholder="Cenário, dia e horário das sessões, regras da casa">${esc(m.descricao)}</textarea>
    <p class="foot">Salva ao sair do campo. Todos da mesa veem a descrição.</p>`);
  const conv=card('Convite',`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="code" id="mcode">${esc(m.code)}</span><button class="btn sm" data-a="cp" data-v="mcode">Copiar</button><button class="btn sm" data-a="newcode" data-v="${esc(m.id)}">Novo código</button></div>
    <p class="foot">Trocar o código invalida o antigo. Quem já está na mesa continua nela.</p>
    ${sw('Aceitar jogadores novos','Desligado, o código não deixa ninguém novo entrar.',m.convites,'mtog',m.id+'|convites')}`);
  const fch=card('Fichas',`${sw('Fichas novas entram liberadas','Quando um jogador põe a ficha nesta mesa, os outros já podem vê-la.',m.libAuto,'mtog',m.id+'|libAuto').replace('class="sw"','class="sw" style="border:0;margin:0;padding-top:0"')}
    <div class="btns" style="margin:4px 0 12px"><button class="btn sm" data-a="mlib" data-v="${esc(m.id)}|1">Liberar todas</button><button class="btn sm" data-a="mlib" data-v="${esc(m.id)}|0">Ocultar todas</button></div>
    ${fichas.length?fichas.map(c=>row(c,true)).join(''):'<p class="note">Nenhuma ficha nesta mesa ainda. Os jogadores escolhem a mesa na aba Principal da ficha.</p>'}`);
  const jog=card('Jogadores',`<div class="members">${m.membros.map(x=>`<span class="member">${esc(x.name)}${x.id===m.mestre?' (mestre)':`<button class="x" data-a="kick" data-v="${esc(m.id)}|${esc(x.id)}" aria-label="Remover ${esc(x.name)} da mesa">${arm==='kick:'+m.id+'|'+x.id?'✓':'×'}</button>`}</span>`).join('')}</div>
    <p class="foot">${m.membros.length<2?'Passe o código do convite para os jogadores entrarem.':'Remover um jogador tira as fichas dele da mesa. Toque duas vezes no × para confirmar.'}</p>`);
  const perigo=card('Apagar mesa',`<p class="note">As fichas saem da mesa e voltam para os donos. Não dá para desfazer.</p>${armBtn('dmesa:'+m.id,'Apagar mesa','Toque de novo para apagar')}`);
  return pick+`<div class="cols"><div class="stackc">${geral}${conv}</div><div class="stackc">${fch}</div><div class="stackc">${jog}${perigo}</div></div>`}
function renderConfig(){
  document.body.classList.add('cfg');document.body.classList.remove('locked','ro','nochar','menu');
  $('nm').textContent='Configurações';$('sub').textContent=S.me.name;$('who2').textContent=S.online?'':'Sem conexão com o servidor.';
  $('nav').innerHTML=CFG.map(([k,t])=>`<button class="${S.cfgTab===k?'on':''}" data-a="cfgtab" data-v="${k}">${t}</button>`).join('')+'<button data-a="go" data-v="inicio">Início</button>';
  $('main').innerHTML=(S.cfgTab==='mesa'?tMesa():tConta())+`<p class="status" id="st">${esc(statusText())}</p>`;
  if(S.cfgTab==='conta'&&K.tokens===null&&!K.loading)loadConta()}

/* ---------- eventos ---------- */
document.addEventListener('input',e=>{const el=e.target;
  if(el.dataset&&el.dataset.lv&&S.lvl){S.lvl[el.dataset.lv]=el.value;if(el.dataset.lv==='mq'){lvRender();const q=document.querySelector('[data-lv=mq]');if(q){q.focus();q.setSelectionRange(q.value.length,q.value.length)}}return}
  if(el.dataset&&el.dataset.w&&S.wEdit){S.wEdit[el.dataset.w]=el.value;if(!S.wEdit.dirty){S.wEdit.dirty=true;const b=document.querySelector('[data-a=wcancelar]');if(b)b.textContent='Descartar'}return}
  if(el.dataset&&el.dataset.wf){filtrar(el);return}
  if(el.id==='wq'){S.wikiQ=el.value;Object.keys(PAGINA).forEach(loadDados);const busca=!!el.value.trim(),r=$('wres'),i=$('widx');if(r){r.hidden=!busca;r.innerHTML=busca?wikiResultados(el.value):''}if(i)i.hidden=busca;return}
  if(el.dataset&&el.dataset.k2){K[el.dataset.k2]=el.value.trim();saveK();const x=$('mcpcmd');if(x)x.textContent=mcpLine(K.novo&&K.novo.token);return}if(!el.dataset||!el.dataset.k||el.tagName==='SELECT'||RO())return;const c=C();touch();let v=el.value;if('n' in el.dataset){v=v===''?0:+v;if(isNaN(v))return}setP(c,el.dataset.k,v);completar(c,el.dataset.k);save();derive()});
document.addEventListener('change',e=>{const el=e.target;if(el.id==='file'&&el.files[0]){el.files[0].text().then(importTxt);return}
  if(el.id==='wimg'&&el.files[0]){wImagem(el.files[0]);el.value='';return}
  if(el.id==='wimp'&&el.files.length){wImportar(el.files,el.dataset.mesa);el.value='';return}
  if(el.dataset&&el.dataset.w)return;
  if(el.dataset&&el.dataset.lv&&S.lvl){S.lvl[el.dataset.lv]=el.value;S.lvl.erro='';lvRender();return}
  if(el.dataset&&el.dataset.mesa!==undefined){const m=mesaOf(el.dataset.mesa);const k=el.dataset.campo||'nome';if(m&&(k!=='nome'||el.value.trim())&&el.value!==m[k])act('PATCH','/api/mesas/'+m.id,{[k]:k==='nome'?el.value.trim():el.value},k==='nome'?'Nome da mesa salvo.':'Descrição salva.');return}
  if(el.dataset&&el.dataset.pref){setPref(el.dataset.pref,el.value);return}
  if(el.id==='audf'){K.filtro=el.value;K.audit=null;render();loadConta();return}
  if(el.tagName==='SELECT'&&el.dataset.k&&!RO()){const c=C();touch();let v=el.value;if(/^\d+$/.test(v)&&el.dataset.k!=='hd.die')v=+v;setP(c,el.dataset.k,v);if(el.dataset.k==='mesa')c._lib=false;if(el.dataset.k==='clsId'&&!String(c.cls||'').trim()){const x=classeDe(c);if(x)c.cls=x.nome}save();render()}});
document.addEventListener('keydown',e=>{if(!S.me||S.page!=='ficha'||!C()||e.altKey||/INPUT|TEXTAREA|SELECT/.test((document.activeElement||{}).tagName))return;
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();undo();return}
  if(e.ctrlKey||e.metaKey)return;
  const t=TABS[+e.key-1];if(t){S.tab=t[0];prefs();render();scrollTo(0,0)}});
document.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const id=e.target.id;if(id==='jcode')document.querySelector('[data-a=join]').click();if(id==='nmesa')document.querySelector('[data-a=nmesa]').click()});
document.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a,v=b.dataset.v,c=C();
  if(MUT.has(a)&&RO())return toast('<div><b>Somente leitura</b><small>Esta ficha é de outro jogador.</small></div>');
  const edit=fn=>{touch();fn();save();render()};
  const twoTap=key=>{if(arm!==key){arm=key;redraw();return false}arm=null;return true};
  switch(a){
  case'authmode':S.authMode=v;showAuth();break;
  case'tab':S.tab=v;prefs();render();scrollTo(0,0);break;
  case'lock':S.locked=!S.locked;prefs();render();break;
  case'undo':undo();break;
  case'mode':S.mode=+v;head();break;
  case'rl':rollKey(v);break;
  case'atk':rollAtk(+v);break;
  case'toast':$('toast').classList.remove('on');break;
  case'sv':if(S.locked)return toast('<div><b>Toque no lápis para editar</b><small>Toque no nome para rolar.</small></div>');edit(()=>{c.sv[v]=c.sv[v]?0:1});break;
  case'sk':if(S.locked)return toast('<div><b>Toque no lápis para editar</b><small>Toque no nome para rolar.</small></div>');edit(()=>{c.sk[v]=((+c.sk[v]||0)+1)%3});break;
  case'insp':edit(()=>{c.insp=!c.insp});break;
  case'cond':edit(()=>{c.cond=c.cond.includes(v)?c.cond.filter(x=>x!==v):[...c.cond,v]});break;
  case'ds':edit(()=>{const k=v[0],i=+v[1];c.death[k]=c.death[k]===i+1?i:i+1});break;
  case'slot':edit(()=>{const [l,j]=v.split('.').map(Number);const s=c.slots[l];s.used=(+s.used||0)===j+1?j:j+1});break;
  case'prep':if(S.locked)return;edit(()=>{const s=c.spells[+v];s.p=!s.p});break;
  case'add':edit(()=>{c[v].push(v==='atk'?{n:'',b:'',d:'',t:''}:v==='items'?{n:'',q:1,w:0}:{n:'',l:0,p:true})});setTimeout(()=>{const l=document.querySelectorAll(`[data-k^="${v}."]`);const x=[...l].reverse().find(el=>/\.n$/.test(el.dataset.k));x&&x.focus()},30);break;
  case'rm':edit(()=>{const [k,i]=v.split('.');c[k].splice(+i,1)});break;
  case'dmg':case'heal':{const n=Math.abs(parseInt($('amt').value)||0);if(!n){$('amt').focus();return}edit(()=>{if(a==='heal'){c.hp.cur=Math.min(+c.hp.max||0,(+c.hp.cur||0)+n);if(c.hp.cur>0)c.death={s:0,f:0}}else{let left=n;const t=+c.hp.tmp||0;const u=Math.min(t,left);c.hp.tmp=t-u;left-=u;c.hp.cur=Math.max(0,(+c.hp.cur||0)-left)}});toast(`<span class="tot">${a==='heal'?'+':'−'}${n}</span><div><b>${a==='heal'?'Cura':'Dano'}</b><small>PV agora: ${c.hp.cur}${+c.hp.tmp?' + '+c.hp.tmp+' temp.':''} / ${c.hp.max}${c.hp.cur===0?' · caído!':''}</small></div>`);break}
  case'hd':{const lv=Math.max(1,+c.level||1);if((+c.hd.used||0)>=lv)return toast('<div><b>Sem dados de vida</b><small>Recupere no descanso longo.</small></div>');const s=parseInt(String(c.hd.die).slice(1))||8;const rv=r(s);const h=Math.max(1,rv+mod(c.ab.con));edit(()=>{c.hd.used=(+c.hd.used||0)+1;c.hp.cur=Math.min(+c.hp.max||0,(+c.hp.cur||0)+h)});toast(`<span class="tot">+${h}</span><div><b>Dado de vida</b><small>${c.hd.die}: ${rv} ${sg(mod(c.ab.con))} CON · PV ${c.hp.cur}/${c.hp.max}</small></div>`);break}
  case'eqslot':S.eqPick=S.eqPick===v?null:v;render();break;
  case'eq':{const [i,k]=v.split('|');edit(()=>{c.items.forEach((x,j)=>{if(j!==+i&&x.eq===k)x.eq=''});c.items[+i].eq=k});S.eqPick=null;render();break}
  case'uneq':edit(()=>{c.items[+v].eq=''});break;
  case'acauto':edit(()=>{c.acAuto=!c.acAuto});toast(`<div><b>${c.acAuto?'CA automática':'CA manual'}</b><small>${c.acAuto?'A CA agora segue a armadura, o escudo e a Destreza: '+c.ac+'.':'Mude a CA à mão na aba Combate.'}</small></div>`);break;
  case'xpadd':{const n=parseInt($('xpamt').value)||0;if(!n){$('xpamt').focus();return}const antes=RG.podeSubir(c);edit(()=>{c.xp=Math.max(0,(+c.xp||0)+n)});toast(`<span class="tot">${n>0?'+':''}${n}</span><div><b>XP: ${fmtN(c.xp)}</b><small>${!antes&&RG.podeSubir(c)?'Pronto para subir de nível!':RG.nivelPorXp(c.xp)>=20?'Nível máximo de XP':'Faltam '+fmtN(RG.xpDoNivel(Math.min(20,(+c.level||1)+1))-c.xp)+' para o próximo nível'}</small></div>`);break}
  case'conceder':if(!isMestre(mesaOf(c.mesa)))return;edit(()=>{c.nivelLib=Math.max(0,Math.min(20-(+c.level||1),(+c.nivelLib||0)+(v==='-1'?-1:1)))});toast(`<div><b>${v==='-1'?'Nível retirado':'Nível concedido'}</b><small>${c.nivelLib?esc(c.name||'O personagem')+' pode subir '+(c.nivelLib===1?'um nível':c.nivelLib+' níveis')+'.':'Nenhum nível concedido agora.'}</small></div>`);break;
  case'lvl':lvAbrir();break;
  case'lvcls':case'lvpv':case'lvmodo':case'lvmag':case'lvback':case'lvnext':case'lvok':lvAcao(a,v);break;
  case'long':edit(()=>{c.hp.cur=+c.hp.max||0;c.hp.tmp=0;c.death={s:0,f:0};c.slots.forEach(s=>s.used=0);c.hd.used=Math.max(0,(+c.hd.used||0)-Math.max(1,Math.floor((+c.level||1)/2)))});toast('<div><b>Descanso longo</b><small>PV, espaços de magia e metade dos dados de vida recuperados.</small></div>');break;
  case'menu':go('inicio');break;
  case'go':go(v,v==='ficha'?S.view:null);break;
  case'gomesa':go('mesa',v);break;
  case'gomapas':go('mapas',v||S.mesaAtual||'');break;
  case'gomwiki':go('mwiki',v||S.mesaAtual||'');break;
  case'wnova':{const [mid,titulo='',cat='']=String(v).split('|');if(mesaOf(mid)&&isMestre(mesaOf(mid)))wEditar(mid,null,titulo,cat);break}
  case'wedit':{const p=mesaPg(v);if(p)wEditar(p.mesa,p);break}
  case'wsalvar':wSalvar();break;
  case'wcancelar':{const e=S.wEdit;if(!e)return;if(e.dirty&&!twoTap('wcancelar'))return;S.wEdit=null;go('mwiki',e.mesa+(e.id?'|'+e.id:''));break}
  case'wprev':if(S.wEdit){S.wEdit.prev=v==='1';render()}break;
  case'wlibed':if(S.wEdit){S.wEdit.lib=!S.wEdit.lib;S.wEdit.dirty=true;render()}break;
  case'wlib':{const p=mesaPg(v);if(!p)return;const want=!p.lib;p.lib=want;render();api('PUT','/api/wiki/'+v,{lib:want}).then(x=>{upsertPg(x);softRender();toast(`<div><b>${esc(x.titulo)}</b><small>${want?'Liberada: todos da mesa podem ler.':'Oculta: só você vê.'}</small></div>`)}).catch(err=>{p.lib=!want;render();toast(`<div><b>${esc(err.message)}</b></div>`)});break}
  case'wdel':{const p=mesaPg(v);if(!p||!twoTap('wdel:'+v))return;api('DELETE','/api/wiki/'+v).then(()=>{WK.pag=WK.pag.filter(x=>x.id!==v);WK.idx=null;go('mwiki',p.mesa);toast(`<div><b>${esc(p.titulo)} apagada</b></div>`)}).catch(err=>toast(`<div><b>${esc(err.message)}</b></div>`));break}
  case'novamesa':go('inicio');setTimeout(()=>{const x=$('jcode');x&&x.focus()},30);break;
  case'open':go('ficha',v);break;
  case'trazer':{const [cid,mid]=v.split('|');const ch=S.chars.get(cid);if(!ch||!isOwn(ch))return;ch.mesa=mid;ch._lib=false;save(ch);render();toast(`<div><b>${esc(ch.name||'Personagem')} está na mesa ${esc((mesaOf(mid)||{}).nome||'')}</b></div>`);break}
  case'lib':{const ch=S.chars.get(v);if(!ch)return;const want=!ch._lib;ch._lib=want;redraw();api('POST','/api/chars/'+v+'/lib',{lib:want}).then(()=>{render()}).catch(err=>{ch._lib=!want;redraw();toast(`<div><b>${esc(err.message)}</b></div>`)});break}
  case'cfg':{const [t,id]=String(v).split('|');S.cfgTab=t==='mesa'?'mesa':'conta';if(id)S.cfgMesa=id;go('config');break}
  case'cfgtab':S.cfgTab=v;arm=null;history.replaceState(null,'',cfgHash());render();scrollTo(0,0);break;
  case'cfgmesa':S.cfgMesa=v;arm=null;history.replaceState(null,'',cfgHash());render();break;
  case'pref':{const [k,x]=v.split('|');setPref(k,k==='abrirTravada'?x==='1':x);break}
  case'cfnome':{const n=$('cfnome').value.trim();if(n&&n!==S.me.name)act('PATCH','/api/me',{name:n},'Nome atualizado.');break}
  case'sairoutras':api('POST','/api/sessions/sair-outras').then(r=>toast(`<div><b>${r.encerradas?r.encerradas+(r.encerradas===1?' sessão encerrada':' sessões encerradas'):'Nenhuma outra sessão aberta'}</b><small>Este aparelho continua conectado.</small></div>`)).catch(err=>toast(`<div><b>${esc(err.message)}</b></div>`));break;
  case'tknovo':{const n=$('tknome').value.trim();api('POST','/api/tokens',{nome:n||'Assistente'}).then(t=>{K.novo=t;K.tokens=null;render();loadConta();toast('<div><b>Token criado</b><small>Copie agora: ele não aparece de novo.</small></div>')}).catch(err=>toast(`<div><b>${esc(err.message)}</b></div>`));break}
  case'tkpausa':{const t=(K.tokens||[]).find(x=>x.id===v);if(!t)return;api('PATCH','/api/tokens/'+v,{pausado:!t.pausado}).then(()=>{toast(`<div><b>Token ${t.pausado?'retomado':'pausado'}</b><small>${t.pausado?'Ele volta a funcionar na hora.':'Chamadas com ele são recusadas até você retomar.'}</small></div>`);loadConta()}).catch(err=>toast(`<div><b>${esc(err.message)}</b></div>`));break}
  case'tkrm':if(twoTap('tkrm:'+v))api('DELETE','/api/tokens/'+v).then(()=>{if(K.filtro===v)K.filtro='';if(K.novo&&K.novo.id===v)K.novo=null;toast('<div><b>Token removido</b><small>Quem usava este token perdeu o acesso.</small></div>');loadConta()}).catch(err=>toast(`<div><b>${esc(err.message)}</b></div>`));break;
  case'tklog':K.filtro=v;K.audit=null;render();loadConta().then(()=>{const a=$('audf');a&&a.scrollIntoView({block:'center'})});break;
  case'audit':K.audit=null;render();loadConta();break;
  case'mcpmodo':K.modo=v;saveK();render();break;
  case'cp':{const x=$(v);if(!x)return;const t=x.textContent;Promise.resolve(navigator.clipboard&&navigator.clipboard.writeText(t)).then(()=>toast('<div><b>Copiado</b></div>')).catch(()=>{const r=document.createRange();r.selectNodeContents(x);const sl=getSelection();sl.removeAllRanges();sl.addRange(r);toast('<div><b>Texto selecionado</b><small>Copie com Ctrl+C.</small></div>')});break}
  case'mtog':{const [id,k]=v.split('|');const m=mesaOf(id);if(m)act('PATCH','/api/mesas/'+id,{[k]:!m[k]});break}
  case'mlib':{const [id,x]=v.split('|');act('POST','/api/mesas/'+id+'/lib',{lib:x==='1'},x==='1'?'Todas as fichas da mesa liberadas.':'Todas as fichas da mesa ocultas.');break}
  case'nmesa':{const n=$('nmesa').value.trim();if(!n){$('nmesa').focus();return}const antes=new Set(S.mesas.map(m=>m.id));act('POST','/api/mesas',{nome:n},'Mesa criada. Passe o código aos jogadores.').then(ok=>{const nova=ok&&S.mesas.find(m=>!antes.has(m.id));if(nova)go('mesa',nova.id)});break}
  case'join':{const code=$('jcode').value.trim();if(!code){$('jcode').focus();return}const antes=new Set(S.mesas.map(m=>m.id));act('POST','/api/mesas/join',{code},'Você entrou na mesa.').then(ok=>{const nova=ok&&S.mesas.find(m=>!antes.has(m.id));if(nova)go('mesa',nova.id)});break}
  case'newcode':act('POST','/api/mesas/'+v+'/code',{},'Código trocado: o antigo não funciona mais.');break;
  case'kick':{const [mid,u]=v.split('|');if(twoTap('kick:'+v))act('POST','/api/mesas/'+mid+'/kick',{user:u},'Jogador removido da mesa.');break}
  case'dmesa':if(twoTap('dmesa:'+v))act('DELETE','/api/mesas/'+v,null,'Mesa apagada.');break;
  case'leave':if(twoTap('leave:'+v))act('POST','/api/mesas/'+v+'/leave',{},'Você saiu da mesa.');break;
  case'new':{const n=blank();if(v&&mesaOf(v))n.mesa=v;addOwn(n);S.locked=false;S.tab='principal';go('ficha',n.id);setTimeout(()=>{const x=document.querySelector('[data-k="name"]');x&&x.select()},30);break}
  case'sample':{const n=addOwn(sample());S.locked=true;S.tab='personagem';go('ficha',n.id);break}
  case'dup':{const o=S.chars.get(v)||c;if(!o)return;const n=fix(JSON.parse(JSON.stringify(pack(o))));n.id='c'+uidGen();n.mesa='';n.name=(o.name||'Personagem')+' (cópia)';addOwn(n,false);render();toast(`<div><b>Cópia criada</b><small>${esc(n.name)}, sem mesa.</small></div>`);break}
  case'del':{const o=S.chars.get(v);if(!o||!isOwn(o)||!twoTap('del:'+v))return;const id=o.id;clearTimeout(saveT[id]);S.pending.delete(id);S.chars.delete(id);if(S.view===id){S.view=(myChars()[0]||{}).id||null;hist=[]}prefs();
    if(!o._new)api('DELETE','/api/chars/'+id).catch(err=>{toast(`<div><b>Não foi possível apagar</b><small>${esc(err.message)}</small></div>`);refreshSoon()});render();toast(`<div><b>${esc(o.name||'Ficha')} apagada</b></div>`);break}
  case'exp':if(c){$('io').value=JSON.stringify(pack(c),null,1);$('iomsg').textContent='Ficha aberta pronta para copiar.'}break;
  case'expall':$('io').value=JSON.stringify(myChars().map(pack),null,1);$('iomsg').textContent='Suas fichas estão prontas para copiar.';break;
  case'copy':{const t=$('io');if(!t.value&&c)t.value=JSON.stringify(pack(c),null,1);Promise.resolve(navigator.clipboard&&navigator.clipboard.writeText(t.value)).then(()=>{$('iomsg').textContent='Copiado.'}).catch(()=>{t.select();$('iomsg').textContent='Não deu para copiar sozinho: o texto está selecionado, copie manualmente.'});break}
  case'imp':importTxt($('io').value);break;
  case'pass':act('POST','/api/password',{old:$('pold').value,pass:$('pnew').value},'Senha trocada.');break;
  case'logout':api('POST','/api/logout').catch(()=>{}).then(()=>{S.chars=new Map();S.authMode='login';S.page='inicio';Object.assign(K,{tokens:null,audit:null,novo:null,filtro:''});history.replaceState(null,'','#inicio');showAuth()});break;
  }});
function route(){const h=decodeURIComponent(location.hash.slice(1));let m;
  if(h.startsWith('config')){const [,t,id]=h.split('/');S.page='config';S.cfgTab=t==='mesa'?'mesa':'conta';if(id)S.cfgMesa=id;return}
  if(h==='personagens'){S.page='personagens';return}
  if((m=/^wiki(?:\/([\w-]+)(?:\/([\w-]+))?)?$/.exec(h))){S.page='wiki';S.wikiSel=m[1]?{slug:m[1],anc:m[2]||''}:null;return}
  if((m=/^mesa\/([\w-]+)\/wiki(?:\/([\w-]+)(?:\/([\w-]+))?)?$/.exec(h))){S.page='mesa';S.mesaAtual=m[1];S.mesaTab='wiki';S.wikiSel=m[2]?{id:m[2],anc:m[3]||''}:null;return}
  if((m=/^mesa\/([\w-]+)\/ficha\/([\w-]+)$/.exec(h))){S.page='ficha';S.mesaAtual=m[1];S.view=m[2];return}
  if((m=/^mesa\/([\w-]+)\/mapas(?:\/([\w-]+)(?:\/([\w-]+))?)?$/.exec(h))){S.page='mesa';S.mesaAtual=m[1];S.mesaTab='mapas';S.alvo=m[2]?{mapa:m[2],tok:m[3]||''}:null;return}
  if((m=/^mesa\/([\w-]+)$/.exec(h))){S.page='mesa';S.mesaAtual=m[1];S.mesaTab='mesa';return}
  if((m=/^ficha\/([\w-]+)$/.exec(h))){S.page='ficha';S.view=m[1];return}
  if(TABS.some(t=>t[0]===h)){S.page='ficha';S.tab=h;return}
  S.page='inicio'}
window.addEventListener('hashchange',()=>{route();if(S.me)render()});
window.addEventListener('popstate',()=>{route();if(S.me)render()});

/* ---------- início ---------- */
loadPrefs();
const h0=location.hash.slice(1);route();
(async()=>{try{applyState(await api('GET','/api/state'));const pf=S.me.prefs||{};if(typeof pf.abrirTravada==='boolean')S.locked=pf.abrirTravada;if(!h0&&pf.abaInicial)S.tab=pf.abaInicial;render();listen();loadLoc(true);api('GET','/api/info').then(i=>{K.info=i;render()}).catch(()=>{})}catch(e){if(e.status===401)showAuth();else{showAuth();$('aerr').textContent='Não foi possível falar com o servidor. Ele está ligado?'}}})();

}
