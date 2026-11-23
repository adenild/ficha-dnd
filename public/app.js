// Fichas D&D 5e — app do navegador. Fala com server.js pela API /api/*.
'use strict';
{
const AB=[['for','FOR','Força'],['des','DES','Destreza'],['con','CON','Constituição'],['int','INT','Inteligência'],['sab','SAB','Sabedoria'],['car','CAR','Carisma']];
const ABN=Object.fromEntries(AB.map(a=>[a[0],a[1]]));
const SK=[['acro','Acrobacia','des'],['ades','Adestrar Animais','sab'],['arca','Arcanismo','int'],['atle','Atletismo','for'],['atua','Atuação','car'],['enga','Enganação','car'],['furt','Furtividade','des'],['hist','História','int'],['inti','Intimidação','car'],['intu','Intuição','sab'],['inve','Investigação','int'],['medi','Medicina','sab'],['natu','Natureza','int'],['perc','Percepção','sab'],['pers','Persuasão','car'],['pres','Prestidigitação','des'],['reli','Religião','int'],['sobr','Sobrevivência','sab']];
const SKM=Object.fromEntries(SK.map(s=>[s[0],s]));
const COND=['Agarrado','Amedrontado','Atordoado','Caído','Cego','Contido','Enfeitiçado','Envenenado','Exausto','Incapacitado','Inconsciente','Invisível','Paralisado','Petrificado','Surdo'];
const TABS=[['principal','Principal'],['combate','Combate'],['magias','Magias'],['itens','Itens'],['notas','Notas']];
const COINS=[['pc','PC'],['pp','PP'],['pe','PE'],['po','PO'],['pl','PL']];

/* ---------- estado ---------- */
const MUT=new Set(['sv','sk','insp','cond','ds','slot','prep','add','rm','dmg','heal','hd','long']);
const S={me:null,mesas:[],chars:new Map(),view:null,locked:true,mode:0,tab:'principal',online:true,authMode:'login',pending:new Set(),busy:new Set()};
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
  prefs()}
async function refresh(){try{applyState(await api('GET','/api/state'));setConn(true);softRender()}catch(e){if(e.status===401)return showAuth();setConn(false)}}
function refreshSoon(){clearTimeout(refreshT);refreshT=setTimeout(refresh,250)}
function listen(){if(es)es.close();if(!window.EventSource)return setInterval(refresh,8000);
  es=new EventSource('/api/events');es.onmessage=refreshSoon;es.onopen=()=>{setConn(true);refreshSoon()};es.onerror=()=>setConn(false)}
function setConn(ok){if(S.online===ok)return;S.online=ok;document.body.classList.toggle('offline',!ok);if(S.me&&C())head();status()}
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
function save(c){c=c||C();if(!c||!canWrite(c))return;c._edit=Date.now();S.pending.add(c.id);clearTimeout(saveT[c.id]);saveT[c.id]=setTimeout(()=>flushChar(c.id),700)}
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
async function act(method,url,body,okMsg){try{const st=await api(method,url,body);if(st&&st.me)applyState(st);setConn(true);render();if($('sheet').classList.contains('on'))drawer();if(okMsg)toast(`<div><b>${okMsg}</b></div>`);return true}
  catch(e){if(e.status===401)return showAuth();toast(`<div><b>${esc(e.message)}</b></div>`);return false}}
window.addEventListener('beforeunload',e=>{if(S.pending.size){e.preventDefault();e.returnValue=''}});

/* ---------- campos ---------- */
function f(p,o={}){const c=C();const v=getP(c,p);const ro=(S.locked&&!o.live)||RO()?' readonly':'';
  return `<input data-k="${p}"${o.n?' type="number" data-n':''} value="${esc(v)}"${o.ph?` placeholder="${esc(o.ph)}"`:''}${o.al?` aria-label="${esc(o.al)}"`:''}${ro}>`}
function ta(p,ph){return `<textarea data-k="${p}" placeholder="${esc(ph||'')}"${S.locked||RO()?' readonly':''}>${esc(getP(C(),p))}</textarea>`}
function sel(p,opts){const v=getP(C(),p);return `<select data-k="${p}">${opts.map(([k,t])=>`<option value="${esc(k)}"${String(k)===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select>`}
const mod=s=>Math.floor(((+s||0)-10)/2);
const sg=n=>(n>=0?'+':'')+n;
const prof=c=>Math.ceil(Math.max(1,+c.level||1)/4)+1;
const uidGen=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function blank(n){return{id:'c'+uidGen(),name:n||'Novo personagem',mesa:'',cls:'',level:1,race:'',bg:'',align:'',xp:0,ab:{for:10,des:10,con:10,int:10,sab:10,car:10},sv:{},sk:{},ac:10,initB:0,speed:9,hp:{max:10,cur:10,tmp:0},hd:{die:'d8',used:0},death:{s:0,f:0},cond:[],insp:false,atk:[],spAb:'int',slots:Array.from({length:9},()=>({max:0,used:0})),spells:[],coins:{pc:0,pp:0,pe:0,po:0,pl:0},items:[],profs:'',feats:'',traits:'',ideals:'',bonds:'',flaws:'',story:'',notes:'',upd:Date.now()}}
function fix(c){const b=blank();const o=Object.assign(b,c);for(const k of['ab','hp','hd','death','coins','sv','sk'])o[k]=Object.assign({},b[k],c[k]||{});o.slots=Array.from({length:9},(_,i)=>Object.assign({max:0,used:0},(c.slots||[])[i]||{}));for(const k of['atk','spells','items','cond'])if(!Array.isArray(o[k]))o[k]=[];if(typeof o.mesa!=='string')o.mesa='';return o}
function sample(){const c=blank('Lyra Vento-Frio');Object.assign(c,{cls:'Maga',level:5,race:'Alta elfa',bg:'Sábio',align:'Neutra e boa',xp:6500,ab:{for:8,des:14,con:13,int:18,sab:12,car:10},sv:{int:1,sab:1},sk:{arca:2,hist:1,inve:1,perc:1},ac:12,speed:9,hp:{max:27,cur:21,tmp:0},hd:{die:'d6',used:1},spAb:'int',
atk:[{n:'Adaga',b:'+5',d:'1d4+2',t:'perfurante'},{n:'Raio de Fogo',b:'+7',d:'2d10',t:'fogo, 36 m'}],
spells:[['Raio de Fogo',0],['Mãos Mágicas',0],['Luz',0],['Prestidigitação',0],['Escudo',1],['Mísseis Mágicos',1],['Armadura Arcana',1],['Detectar Magia',1],['Passo Nebuloso',2],['Teia',2],['Bola de Fogo',3],['Contramágica',3]].map(([n,l])=>({n,l,p:true})),
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

/* ---------- abas ---------- */
function mesaField(c){const m=mesaOf(c.mesa);
  if(S.locked||RO()||!isOwn(c))return L('Mesa',`<input readonly value="${esc(m?m.nome:'Sem mesa')}">`,'span2');
  if(!S.mesas.length)return L('Mesa',`<p class="note" style="margin:6px 0 0">Entre numa mesa pelo menu ☰ com o código do mestre.</p>`,'span2');
  return L('Mesa',sel('mesa',[['','Sem mesa'],...S.mesas.map(m=>[m.id,m.nome])]),'span2')}
function tPrincipal(c){
  const id=card('Identidade',`<div class="g2">${L('Nome',f('name'),'span2')}${mesaField(c)}${L('Classe',f('cls',{ph:'Ex.: Guerreiro'}))}${L('Nível',f('level',{n:1}))}${L('Raça',f('race'))}${L('Antecedente',f('bg'))}${L('Alinhamento',f('align'))}${L('XP',f('xp',{n:1}))}</div>`);
  const abs=card('Atributos',`<div class="abs">${AB.map(([k,s,n])=>`<div class="ab"><button data-a="rl" data-v="mod:${k}" aria-label="Rolar ${n}"><span class="n">${s}</span><span class="m" data-d="mod:${k}">${calc('mod:'+k,c)}</span></button>${f('ab.'+k,{n:1,al:n})}</div>`).join('')}</div><p class="foot">Toque no modificador para rolar o teste.</p>`,`<small>Prof. ${d('prof')}</small>`);
  const sv=card('Salvaguardas',`<div class="rows">${AB.map(([k,s,n])=>`<div class="row"><button class="dot ${c.sv[k]?'p1':''}" data-a="sv" data-v="${k}" aria-label="Proficiência em ${n}"><i></i></button><button class="rl" data-a="rl" data-v="save:${k}">${n}</button><span class="val" data-d="save:${k}">${calc('save:'+k,c)}</span></div>`).join('')}</div>`);
  const sk=card('Perícias',`<div class="rows">${SK.map(([k,n,a])=>`<div class="row"><button class="dot p${c.sk[k]||0}" data-a="sk" data-v="${k}" aria-label="Proficiência em ${n}"><i></i></button><button class="rl" data-a="rl" data-v="skill:${k}">${n} <em>${ABN[a]}</em></button><span class="val" data-d="skill:${k}">${calc('skill:'+k,c)}</span></div>`).join('')}</div><p class="foot">Percepção passiva ${d('pp')}. Toque no círculo: proficiente, especialista, nenhum.</p>`);
  const pr=card('Proficiências e idiomas',ta('profs','Armaduras, armas, ferramentas, idiomas'));
  return `<div class="cols"><div class="stackc">${abs}${sv}${pr}</div><div class="stackc">${sk}</div><div class="stackc">${id}</div></div>`}
function tCombate(c){const lk=S.locked||RO();
  const hp=card('Pontos de vida',`<div class="hpbig">${f('hp.cur',{n:1,live:1,al:'PV atuais'})}<span>/ ${lk?esc(c.hp.max):''}</span>${lk?'':f('hp.max',{n:1,al:'PV máximos'})}</div>
  <div class="g2" style="margin-bottom:10px">${L('PV temporários',f('hp.tmp',{n:1,live:1}))}${L('Dados de vida',`<div style="display:flex;gap:6px;align-items:center"><span class="val" data-d="hd" style="min-width:4ch;text-align:left">${calc('hd',c)}</span>${sel('hd.die',['d6','d8','d10','d12'].map(x=>[x,x]))}</div>`)}</div>
  ${RO()?'':`<div class="amt"><input id="amt" type="number" inputmode="numeric" placeholder="Valor" aria-label="Valor de dano ou cura"><button class="btn warn" data-a="dmg">Dano</button><button class="btn" data-a="heal">Cura</button></div>
  <div class="btns" style="margin-top:10px"><button class="btn sm" data-a="hd">Gastar dado de vida</button><button class="btn sm" data-a="long">Descanso longo</button></div>`}`);
  const st=card('Defesa e movimento',`<div class="big3"><div><label>CA</label>${f('ac',{n:1})}</div><div><label>Iniciativa</label><button class="roll" style="text-align:center;padding:0" data-a="rl" data-v="init"><b data-d="init">${calc('init',c)}</b></button><div class="ed">${f('initB',{n:1,al:'Bônus extra de iniciativa'})}</div></div><div><label>Desloc. (m)</label>${f('speed',{n:1})}</div></div>
  <div class="row" style="margin-top:8px"><button class="chk ${c.insp?'on':''}" data-a="insp" aria-label="Inspiração"><i></i></button><span style="flex:1">Inspiração</span></div>`);
  const ds=card('Salvaguardas contra morte',`<div class="g2"><div><label>Sucessos</label><div class="pips">${[0,1,2].map(i=>`<button class="pip g ${c.death.s>i?'on':''}" data-a="ds" data-v="s${i}" aria-label="Sucesso ${i+1}"></button>`).join('')}</div></div><div><label>Falhas</label><div class="pips">${[0,1,2].map(i=>`<button class="pip ${c.death.f>i?'on':''}" data-a="ds" data-v="f${i}" aria-label="Falha ${i+1}"></button>`).join('')}</div></div></div>${RO()?'':'<div class="btns" style="margin-top:10px"><button class="btn sm" data-a="rl" data-v="death">Rolar d20</button></div>'}`);
  const cd=card('Condições',`<div class="chips">${COND.map(n=>`<button class="chip ${c.cond.includes(n)?'on':''}" data-a="cond" data-v="${n}">${n}</button>`).join('')}</div>${lk&&!c.cond.length?'<p class="foot" style="margin:0">Nenhuma condição ativa.</p>':''}`);
  const at=card('Ataques',`${c.atk.length?'':'<p class="note">Nenhum ataque cadastrado.</p>'}<div>${c.atk.map((a,i)=>`<div class="item atk"><div class="vw"><button class="roll" data-a="atk" data-v="${i}">${esc(a.n)||'Ataque'}</button></div><div class="ed">${f(`atk.${i}.n`,{ph:'Nome',al:'Nome do ataque'})}</div>${f(`atk.${i}.b`,{ph:'+5',al:'Bônus de ataque'})}${f(`atk.${i}.d`,{ph:'1d8+3',al:'Dano'})}<button class="x ed" data-a="rm" data-v="atk.${i}" aria-label="Remover">×</button><div style="grid-column:1/-1;margin-top:-6px">${lk?`<span class="foot" style="margin:0">${esc(a.t)}</span>`:f(`atk.${i}.t`,{ph:'Tipo, alcance, notas',al:'Notas'})}</div></div>`).join('')}</div><div class="btns ed" style="margin-top:8px"><button class="btn sm" data-a="add" data-v="atk">Adicionar ataque</button></div>${c.atk.length?'<p class="foot vw">Toque no nome para rolar ataque e dano.</p>':''}`);
  return `<div class="cols"><div class="stackc">${hp}${ds}</div><div class="stackc">${st}${at}</div><div class="stackc">${cd}</div></div>`}
function tMagias(c){const lk=S.locked||RO();
  const hdr=card('Conjuração',`<div class="big3"><div><label>Atributo</label>${sel('spAb',AB.map(a=>[a[0],a[1]]))}</div><div><label>CD</label><b data-d="dc">${calc('dc',c)}</b></div><div><label>Ataque</label><button class="roll" style="text-align:center;padding:0" data-a="rl" data-v="satk"><b data-d="satk">${calc('satk',c)}</b></button></div></div>`);
  const lv=c.slots.map((s,i)=>({...s,i})).filter(s=>!lk||+s.max>0);
  const sl=card('Espaços de magia',`${lv.length?'':'<p class="note">Sem espaços de magia.</p>'}${lv.map(s=>`<div class="slot"><b>${s.i+1}º nível</b><div class="pips">${Array.from({length:Math.min(+s.max||0,9)},(_,j)=>`<button class="pip ${j<(+s.used||0)?'on':''}" data-a="slot" data-v="${s.i}.${j}" aria-label="Espaço ${j+1} de ${s.i+1}º nível"></button>`).join('')}</div><div class="ed">${f(`slots.${s.i}.max`,{n:1,al:`Máximo de ${s.i+1}º nível`})}</div></div>`).join('')}<p class="foot">Espaço preenchido = gasto. O descanso longo restaura todos.</p>`);
  const by={};c.spells.forEach((s,i)=>{(by[+s.l||0]=by[+s.l||0]||[]).push([s,i])});
  const lvls=Object.keys(by).map(Number).sort((a,b)=>a-b);
  const lst=card('Magias',`${c.spells.length?'':'<p class="note">Nenhuma magia cadastrada.</p>'}${lvls.map(l=>`<div class="lvh">${l?l+'º nível':'Truques'}</div>${by[l].filter(([s])=>!lk||s.p||!l).map(([s,i])=>`<div class="item sp"><button class="chk ${s.p||!l?'on':''}" data-a="prep" data-v="${i}" aria-label="Preparada"><i></i></button><div style="display:flex;gap:6px">${f(`spells.${i}.n`,{ph:'Nome da magia',al:'Nome da magia'})}<div class="ed" style="width:76px;flex:none">${sel(`spells.${i}.l`,Array.from({length:10},(_,k)=>[k,k?k+'º':'T']))}</div></div><button class="x ed" data-a="rm" data-v="spells.${i}" aria-label="Remover">×</button></div>`).join('')}`).join('')}
  <div class="btns ed" style="margin-top:8px"><button class="btn sm" data-a="add" data-v="spells">Adicionar magia</button></div><p class="foot">${lk?'Mostrando truques e magias preparadas.':'Marque o quadrado para preparar a magia.'}</p>`);
  return `<div class="cols"><div class="stackc">${hdr}${sl}</div><div class="stackc">${lst}</div></div>`}
function tItens(c){
  const co=card('Moedas',`<div class="g5">${COINS.map(([k,n])=>L(n,f('coins.'+k,{n:1,live:1}))).join('')}</div>`);
  const it=card('Equipamento',`${c.items.length?'':'<p class="note">Mochila vazia.</p>'}<div class="item inv" style="padding:0 0 4px;border:0"><label>Item</label><label>Qtd.</label><label>Peso (kg)</label></div><div>${c.items.map((x,i)=>`<div class="item inv">${f(`items.${i}.n`,{ph:'Item',al:'Item'})}${f(`items.${i}.q`,{n:1,live:1,al:'Quantidade'})}${f(`items.${i}.w`,{n:1,al:'Peso unitário'})}<button class="x ed" data-a="rm" data-v="items.${i}" aria-label="Remover">×</button></div>`).join('')}</div><div class="btns ed" style="margin-top:8px"><button class="btn sm" data-a="add" data-v="items">Adicionar item</button></div>`,`<small data-d="wt">${calc('wt',c)}</small>`);
  return `<div class="cols"><div class="stackc">${it}</div><div class="stackc">${co}</div></div>`}
function tNotas(){
  return `<div class="cols"><div class="stackc">${card('Características e talentos',ta('feats','Habilidades de classe, raça e talentos'))}${card('História e aparência',ta('story'))}</div><div class="stackc">${card('Personalidade',`${L('Traços',ta('traits'))}${L('Ideais',ta('ideals'))}${L('Vínculos',ta('bonds'))}${L('Defeitos',ta('flaws'))}`)}</div><div class="stackc">${card('Anotações da campanha',ta('notes','NPCs, pistas, missões'))}</div></div>`}


/* ---------- render ---------- */
function shield(){return `<svg viewBox="0 0 60 58" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="M30 2 56 9v17c0 15-11 26-26 30C15 52 4 41 4 26V9Z" fill="rgba(0,0,0,.22)" stroke="rgba(255,255,255,.55)" stroke-width="2"/><path d="M30 6 52 12v14c0 12-9 21-22 25" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/></svg>`}
function subline(c){return [c.race,[c.cls,c.level?'nível '+c.level:''].filter(Boolean).join(' '),c.bg].filter(Boolean).join(' · ')}
function head(){const c=C();$('nm').textContent=c.name||'Sem nome';$('sub').textContent=subline(c);
  const m=mesaOf(c.mesa);let w='';
  if(!S.online)w='Sem conexão com o servidor: as mudanças serão enviadas quando ele voltar.';
  else if(!isOwn(c))w='Ficha de '+(c._ownerName||'outro jogador')+(canWrite(c)?' · você está editando como mestre':' · liberada pelo mestre, somente leitura');
  else if(m)w='Mesa: '+m.nome+(isLib(c)?' · liberada para a mesa':'');
  $('who2').textContent=w;
  $('vit').innerHTML=`<div class="shield">${shield()}<b data-d="ac">${esc(c.ac)}</b><span>CA</span></div><div><b data-d="hpt">${calc('hpt',c)}</b><span>PV</span></div><div><b data-d="init">${calc('init',c)}</b><span>Inic.</span></div><div><b data-d="prof">${calc('prof',c)}</b><span>Prof.</span></div><div><b data-d="spd">${calc('spd',c)}</b><span>Desl.</span></div>`;
  $('seg').innerHTML=['Normal','Vantagem','Desvantagem'].map((t,i)=>`<button class="${S.mode===i?'on':''}" data-a="mode" data-v="${i}">${t}</button>`).join('');
  hpbar()}
function hpbar(){const c=C();if(!c)return;const p=Math.max(0,Math.min(100,(+c.hp.cur||0)/Math.max(1,+c.hp.max||1)*100));const w=$('hpw');w.style.width=p+'%';w.className=p<=25?'low':''}
function render(){
  if(!S.me)return showAuth();
  document.body.classList.remove('auth');
  const c=C();document.body.classList.toggle('nochar',!c);
  if(!c){$('nm').textContent='Fichas';$('sub').textContent=S.me.name;$('who2').textContent=S.online?'':'Sem conexão com o servidor.';$('vit').innerHTML='';$('seg').innerHTML='';$('nav').innerHTML='';
    $('main').innerHTML=`<section class="card empty"><h2>Nenhuma ficha ainda</h2><p class="note">Crie sua primeira ficha, comece pelo exemplo ou entre na mesa do seu mestre com o código de convite.</p><div class="btns" style="justify-content:center"><button class="btn pri" data-a="new">Nova ficha</button><button class="btn" data-a="sample">Começar com exemplo</button><button class="btn" data-a="drawer">Mesas</button></div></section><p class="status" id="st">${esc(statusText())}</p>`;return}
  document.body.classList.toggle('locked',S.locked||RO());document.body.classList.toggle('ro',RO());
  const lk=$('lk');lk.classList.toggle('on',!S.locked);lk.setAttribute('aria-label',S.locked?'Editar ficha':'Concluir edição');
  $('nav').innerHTML=TABS.map(([k,t])=>`<button class="${S.tab===k?'on':''}" data-a="tab" data-v="${k}">${t}</button>`).join('');
  head();const fn={principal:tPrincipal,combate:tCombate,magias:tMagias,itens:tItens,notas:tNotas}[S.tab]||tPrincipal;
  $('main').innerHTML=fn(c)+`<p class="status" id="st">${esc(statusText())}</p>`}
const typing=root=>{const a=document.activeElement;return a&&root.contains(a)&&/INPUT|TEXTAREA/.test(a.tagName)};
function softRender(){if(!S.me)return;if(typing($('main')))pendR=true;else render();if($('sheet').classList.contains('on')&&!typing($('panel')))drawer()}
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
function showAuth(){S.me=null;if(es){es.close();es=null}document.body.classList.add('auth');$('sheet').classList.remove('on');
  const reg=S.authMode==='register';
  $('main').innerHTML=`<div class="authbox"><svg class="crest" viewBox="0 0 60 58" aria-hidden="true"><path d="M30 2 56 9v17c0 15-11 26-26 30C15 52 4 41 4 26V9Z" fill="#9e1b22"/><path d="M30 14 41 21v13L30 41 19 34V21Z" fill="none" stroke="#d6a23a" stroke-width="2.5"/><path d="M19 21l11 7 11-7M30 28v13" fill="none" stroke="#d6a23a" stroke-width="2"/></svg>
  <h1>Fichas D&amp;D 5e</h1><p class="note">Suas fichas e as mesas do grupo, num servidor da sua casa.</p>
  <div class="seg" style="border-color:var(--line);margin-top:18px">${[['login','Entrar'],['register','Criar conta']].map(([k,t])=>`<button type="button" class="${S.authMode===k?'on':''}" style="color:${S.authMode===k?'#fff':'var(--ink)'};background:${S.authMode===k?'var(--red)':'none'}" data-a="authmode" data-v="${k}">${t}</button>`).join('')}</div>
  <form id="authf"><div><label for="an">Nome</label><input id="an" name="name" autocomplete="username" required minlength="2" maxlength="30"></div>
  <div><label for="ap">Senha${reg?' (mínimo 6 caracteres)':''}</label><input id="ap" name="pass" type="password" autocomplete="${reg?'new-password':'current-password'}" required minlength="${reg?6:1}"></div>
  <button class="btn pri" type="submit">${reg?'Criar conta':'Entrar'}</button><p class="err" id="aerr" role="alert"></p></form>
  ${reg?'<p class="note">O nome é como os outros jogadores vão te ver.</p>':'<p class="note">Esqueceu a senha? Quem roda o servidor pode redefinir.</p>'}</div>`}
document.addEventListener('submit',async e=>{if(e.target.id!=='authf')return;e.preventDefault();const fd=new FormData(e.target);const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
  try{const st=await api('POST',S.authMode==='register'?'/api/register':'/api/login',{name:fd.get('name'),pass:fd.get('pass')});S.chars=new Map();applyState(st);setConn(true);render();listen()}
  catch(err){$('aerr').textContent=err.status?err.message:'Não foi possível falar com o servidor.'}btn.disabled=false});

/* ---------- histórico ---------- */
function touch(){const now=Date.now();if(now-lastPush>1500){hist.push(JSON.stringify(C()));if(hist.length>40)hist.shift()}lastPush=now}
function undo(){if(RO())return;const s=hist.pop();if(!s){toast('<div><b>Nada para desfazer</b></div>');return}const o=fix(JSON.parse(s));const cur=C();
  if(cur){for(const k of Object.keys(cur))if(k.startsWith('_')&&k!=='_edit')o[k]=cur[k];o.mesa=cur.mesa}
  S.chars.set(o.id,o);lastPush=0;save(o);render();toast('<div><b>Alteração desfeita</b></div>')}

/* ---------- painel de fichas e mesas ---------- */
function row(c,lib){const on=c===C();const m=mesaOf(c.mesa);
  const info=[isOwn(c)?'Você':c._ownerName,subline(c),lib===undefined&&m?m.nome:'',lib===undefined&&isLib(c)?'liberada':''].filter(Boolean).join(' · ');
  return `<div class="prow"><button class="pick ${on?'on':''}" data-a="open" data-v="${esc(c.id)}"><div><b>${esc(c.name||'Sem nome')}</b><span>${esc(info)}</span></div></button>${lib?`<button class="tog ${isLib(c)?'on':''}" data-a="lib" data-v="${esc(c.id)}" aria-pressed="${isLib(c)}">${isLib(c)?'Liberada':'Oculta'}</button>`:''}</div>`}
const armBtn=(key,label,confirm,cls='warn')=>`<button class="btn sm ${cls}" data-a="${key.split(':')[0]}" data-v="${esc(key.split(':').slice(1).join(':'))}">${arm===key?confirm:label}</button>`;
function drawer(){const p=$('panel');const mine=myChars();const all=[...S.chars.values()];let b='';
  b+=`<p class="role">Conectado como <b>${esc(S.me.name)}</b>. ${S.online?'':'Sem conexão com o servidor agora.'}</p>`;
  b+=`<div class="grp" style="border:0;margin:0;padding:0"><h3>Minhas fichas</h3>${mine.length?mine.map(c=>row(c)).join(''):'<p class="note">Você ainda não tem fichas.</p>'}
    <div class="btns"><button class="btn pri" data-a="new">Nova ficha</button><button class="btn" data-a="sample">Ficha de exemplo</button></div></div>`;
  for(const m of S.mesas){const mestre=isMestre(m);const list=all.filter(c=>c.mesa===m.id&&(mestre||!isOwn(c)));
    b+=`<div class="grp"><h3>${mestre?`<input data-mesa="${esc(m.id)}" value="${esc(m.nome)}" aria-label="Nome da mesa">`:esc(m.nome)}</h3>`;
    if(mestre){b+=`<p class="note" style="margin:0 0 8px">Você é o mestre. Fichas ocultas só aparecem para o dono e para você.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="code">${esc(m.code)}</span><button class="btn sm" data-a="newcode" data-v="${esc(m.id)}">Novo código</button></div>
      <p class="foot">Passe esse código aos jogadores para entrarem na mesa.</p>
      <div class="members">${m.membros.map(x=>`<span class="member">${esc(x.name)}${x.id===m.mestre?' (mestre)':`<button class="x" data-a="kick" data-v="${esc(m.id)}|${esc(x.id)}" aria-label="Remover ${esc(x.name)} da mesa">${arm==='kick:'+m.id+'|'+x.id?'✓':'×'}</button>`}</span>`).join('')}</div>`}
    else b+=`<p class="note" style="margin:0 0 8px">Mestre: ${esc((m.membros.find(x=>x.id===m.mestre)||{}).name||'?')}. Abaixo, as fichas que ele liberou.</p>`;
    b+=list.length?list.map(c=>row(c,mestre)).join(''):`<p class="note">${mestre?'Nenhuma ficha nesta mesa ainda. Os jogadores escolhem a mesa na aba Principal da ficha.':'Nenhuma ficha liberada ainda.'}</p>`;
    b+=`<div class="btns" style="margin-top:6px">${mestre?armBtn('dmesa:'+m.id,'Apagar mesa','Toque de novo para apagar'):armBtn('leave:'+m.id,'Sair da mesa','Toque de novo para sair')}</div></div>`}
  b+=`<div class="grp"><h3>Entrar numa mesa</h3><div class="amt" style="grid-template-columns:minmax(0,1fr) auto"><input id="jcode" placeholder="Código de convite" autocapitalize="characters" aria-label="Código de convite"><button class="btn pri" data-a="join">Entrar</button></div></div>
  <div class="grp"><h3>Criar mesa</h3><div class="amt" style="grid-template-columns:minmax(0,1fr) auto"><input id="nmesa" placeholder="Ex.: A Mina Perdida" aria-label="Nome da nova mesa"><button class="btn" data-a="nmesa">Criar</button></div><p class="foot">Quem cria a mesa é o mestre dela.</p></div>`;
  const c=C();
  if(c)b+=`<div class="btns" style="margin:14px 0"><button class="btn" data-a="dup">Duplicar ficha aberta</button>${isOwn(c)?armBtn('del:'+c.id,'Apagar ficha aberta','Toque de novo para apagar'):''}</div>`;
  b+=`<details class="grp"><summary>Exportar e importar</summary><p class="note">Copie o texto para guardar um backup. Ao importar, as fichas viram suas.</p>
  <textarea id="io" style="min-height:120px;font-size:13px" placeholder="Cole aqui o texto de uma ficha exportada"></textarea>
  <div class="btns" style="margin-top:8px"><button class="btn sm" data-a="exp">Mostrar ficha aberta</button><button class="btn sm" data-a="expall">Mostrar minhas fichas</button><button class="btn sm" data-a="copy">Copiar</button><button class="btn sm pri" data-a="imp">Importar texto</button><label class="btn sm" style="display:inline-flex;align-items:center;color:var(--ink);font-size:14px">Arquivo<input type="file" id="file" accept=".json,application/json" style="display:none"></label></div><p class="foot" id="iomsg"></p></details>
  <details class="grp"><summary>Conta</summary><div class="g2"><div><label for="pold">Senha atual</label><input id="pold" type="password" autocomplete="current-password"></div><div><label for="pnew">Nova senha</label><input id="pnew" type="password" autocomplete="new-password"></div></div><div class="btns" style="margin-top:8px"><button class="btn sm" data-a="pass">Trocar senha</button><button class="btn sm warn" data-a="logout">Sair da conta</button></div></details>`;
  p.innerHTML=`<h2>Fichas e mesas<small><button class="btn sm" data-a="close">Fechar</button></small></h2>${b}`;$('sheet').classList.add('on')}
function addOwn(c,open=true){c._owner=meId();c._ownerName=S.me.name;c._lib=false;c._new=true;delete c.demo;S.chars.set(c.id,c);if(open){S.view=c.id;hist=[];prefs()}save(c);return c}
function importTxt(txt){let o;try{o=JSON.parse(txt)}catch(e){$('iomsg').textContent='Texto inválido: não parece uma ficha exportada.';return}
  const arr=(Array.isArray(o)?o:[o]).filter(x=>x&&typeof x==='object'&&x.ab);if(!arr.length){$('iomsg').textContent='Nenhuma ficha encontrada no texto.';return}
  for(const x of arr){const c=fix(x);for(const k of Object.keys(c))if(k.startsWith('_'))delete c[k];c.id='c'+uidGen();c.mesa='';addOwn(c)}
  render();drawer();$('iomsg').textContent=arr.length+(arr.length>1?' fichas importadas.':' ficha importada.')}

/* ---------- eventos ---------- */
document.addEventListener('input',e=>{const el=e.target;if(!el.dataset||!el.dataset.k||el.tagName==='SELECT'||RO())return;const c=C();touch();let v=el.value;if('n' in el.dataset){v=v===''?0:+v;if(isNaN(v))return}setP(c,el.dataset.k,v);save();derive()});
document.addEventListener('change',e=>{const el=e.target;if(el.id==='file'&&el.files[0]){el.files[0].text().then(importTxt);return}
  if(el.dataset&&el.dataset.mesa!==undefined){const m=mesaOf(el.dataset.mesa);if(m&&el.value.trim())act('PATCH','/api/mesas/'+m.id,{nome:el.value.trim()});return}
  if(el.tagName==='SELECT'&&el.dataset.k&&!RO()){const c=C();touch();let v=el.value;if(/^\d+$/.test(v)&&el.dataset.k!=='hd.die')v=+v;setP(c,el.dataset.k,v);if(el.dataset.k==='mesa')c._lib=false;save();render()}});
document.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const id=e.target.id;if(id==='jcode')$('panel').querySelector('[data-a=join]').click();if(id==='nmesa')$('panel').querySelector('[data-a=nmesa]').click()});
document.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a,v=b.dataset.v,c=C();
  if(a==='close'&&b.id==='sheet'&&e.target!==b)return;
  if(MUT.has(a)&&RO())return toast('<div><b>Somente leitura</b><small>Esta ficha é de outro jogador.</small></div>');
  const edit=fn=>{touch();fn();save();render()};
  const twoTap=key=>{if(arm!==key){arm=key;drawer();return false}arm=null;return true};
  switch(a){
  case'authmode':S.authMode=v;showAuth();break;
  case'tab':S.tab=v;prefs();history.replaceState(null,'','#'+v);render();scrollTo(0,0);break;
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
  case'long':edit(()=>{c.hp.cur=+c.hp.max||0;c.hp.tmp=0;c.death={s:0,f:0};c.slots.forEach(s=>s.used=0);c.hd.used=Math.max(0,(+c.hd.used||0)-Math.max(1,Math.floor((+c.level||1)/2)))});toast('<div><b>Descanso longo</b><small>PV, espaços de magia e metade dos dados de vida recuperados.</small></div>');break;
  case'drawer':arm=null;drawer();break;
  case'close':$('sheet').classList.remove('on');break;
  case'open':S.view=v;hist=[];prefs();$('sheet').classList.remove('on');render();scrollTo(0,0);break;
  case'lib':{const ch=S.chars.get(v);if(!ch)return;const want=!ch._lib;ch._lib=want;drawer();api('POST','/api/chars/'+v+'/lib',{lib:want}).then(()=>{render()}).catch(err=>{ch._lib=!want;drawer();toast(`<div><b>${esc(err.message)}</b></div>`)});break}
  case'nmesa':{const n=$('nmesa').value.trim();if(!n){$('nmesa').focus();return}act('POST','/api/mesas',{nome:n},'Mesa criada. Passe o código aos jogadores.');break}
  case'join':{const code=$('jcode').value.trim();if(!code){$('jcode').focus();return}act('POST','/api/mesas/join',{code},'Você entrou na mesa. Escolha ela na aba Principal da sua ficha.');break}
  case'newcode':act('POST','/api/mesas/'+v+'/code',{},'Código trocado: o antigo não funciona mais.');break;
  case'kick':{const [mid,u]=v.split('|');if(twoTap('kick:'+v))act('POST','/api/mesas/'+mid+'/kick',{user:u},'Jogador removido da mesa.');break}
  case'dmesa':if(twoTap('dmesa:'+v))act('DELETE','/api/mesas/'+v,null,'Mesa apagada.');break;
  case'leave':if(twoTap('leave:'+v))act('POST','/api/mesas/'+v+'/leave',{},'Você saiu da mesa.');break;
  case'new':{const n=addOwn(blank());S.locked=false;S.tab='principal';$('sheet').classList.remove('on');render();setTimeout(()=>{const x=document.querySelector('[data-k="name"]');x&&x.select()},30);break}
  case'sample':{addOwn(sample());S.locked=true;S.tab='principal';$('sheet').classList.remove('on');render();break}
  case'dup':{if(!c)return;const n=fix(JSON.parse(JSON.stringify(pack(c))));n.id='c'+uidGen();n.mesa='';n.name=(c.name||'Personagem')+' (cópia)';addOwn(n);render();drawer();break}
  case'del':{if(!c||!isOwn(c)||!twoTap('del:'+v))return;const id=c.id;clearTimeout(saveT[id]);S.pending.delete(id);S.chars.delete(id);S.view=(myChars()[0]||{}).id||null;hist=[];prefs();
    if(!c._new)api('DELETE','/api/chars/'+id).catch(err=>{toast(`<div><b>Não foi possível apagar</b><small>${esc(err.message)}</small></div>`);refreshSoon()});render();drawer();break}
  case'exp':if(c){$('io').value=JSON.stringify(pack(c),null,1);$('iomsg').textContent='Ficha aberta pronta para copiar.'}break;
  case'expall':$('io').value=JSON.stringify(myChars().map(pack),null,1);$('iomsg').textContent='Suas fichas estão prontas para copiar.';break;
  case'copy':{const t=$('io');if(!t.value&&c)t.value=JSON.stringify(pack(c),null,1);Promise.resolve(navigator.clipboard&&navigator.clipboard.writeText(t.value)).then(()=>{$('iomsg').textContent='Copiado.'}).catch(()=>{t.select();$('iomsg').textContent='Não deu para copiar sozinho: o texto está selecionado, copie manualmente.'});break}
  case'imp':importTxt($('io').value);break;
  case'pass':act('POST','/api/password',{old:$('pold').value,pass:$('pnew').value},'Senha trocada.');break;
  case'logout':api('POST','/api/logout').catch(()=>{}).then(()=>{S.chars=new Map();S.authMode='login';showAuth()});break;
  }});
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(TABS.some(t=>t[0]===h)&&h!==S.tab){S.tab=h;render()}});

/* ---------- início ---------- */
loadPrefs();
const h0=location.hash.slice(1);if(TABS.some(t=>t[0]===h0))S.tab=h0;
(async()=>{try{applyState(await api('GET','/api/state'));render();listen()}catch(e){if(e.status===401)showAuth();else{showAuth();$('aerr').textContent='Não foi possível falar com o servidor. Ele está ligado?'}}})();

}
