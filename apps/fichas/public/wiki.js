// Wiki da suite-dnd: transforma o texto das páginas (Markdown simples) em HTML e converte documentos HTML em Markdown.
// Usado por app.js; não fala com o servidor. Todo texto é escapado antes de virar HTML.
'use strict';
(function () {
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const simples = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const slug = (s) => simples(s).replace(/[*_`[\]]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'secao';
const BLOCOS = { nota: 'Nota', leitura: 'Leia em voz alta', aviso: 'Atenção', mestre: 'Só para o mestre' };

// endereços aceitos em links e imagens: sites, âncoras internas e as imagens da wiki
function urlSegura(u, img) {
  u = String(u || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (img) return /^\/api\/wiki\/img\/[\w-]+$/.test(u) ? u : null;
  return /^#[\w\/~.-]*$/.test(u) ? u : null;
}

/* ---------- inline ---------- */
// opts.link(alvo, texto) -> {href, texto, falta} resolve [[links]]
function inline(src, opts) {
  const guard = [];
  const keep = (html) => `\u0000${guard.push(html) - 1}\u0000`;
  let s = String(src);
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, c) => keep(`<code>${esc(c.trim())}</code>`));
  s = s.replace(/\\([\\`*_[\]|~#>!-])/g, (_, c) => keep(esc(c)));
  s = s.replace(/!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"([^"]*)")?\s*\)/g, (_, alt, u) => {
    const ok = urlSegura(u, true);
    return ok ? keep(`<img src="${esc(ok)}" alt="${esc(alt)}" loading="lazy">`) : keep(`<span class="wmiss">[imagem: ${esc(alt || u)}]</span>`);
  });
  s = s.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, alvo, txt) => {
    const r = opts && opts.link ? opts.link(alvo.trim(), txt && txt.trim()) : { href: null, texto: txt || alvo };
    const t = inline(r.texto || txt || alvo, {});
    return keep(r.href ? `<a class="wl" href="${esc(r.href)}">${t}</a>` : `<a class="wl falta" ${r.nova ? `data-a="wnova" data-v="${esc(r.nova)}"` : ''} title="Página ainda não existe">${t}</a>`);
  });
  s = s.replace(/\[([^\]]+)\]\(\s*(\S+?)\s*\)/g, (_, t, u) => {
    const ok = urlSegura(u);
    if (!ok) return keep(esc(t));
    return keep(`<a href="${esc(ok)}"${ok[0] === '#' ? '' : ' target="_blank" rel="noopener noreferrer"'}>${inline(t, opts)}</a>`);
  });
  s = s.replace(/\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g, (u) => keep(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`));
  s = esc(s);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?![*\w])/g, '$1<em>$2</em>').replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => guard[+i]);
}

/* ---------- blocos ---------- */
const reLista = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const celulas = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const ehSeparador = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');

function blocos(linhas, opts, ctx) {
  let html = '', i = 0;
  const para = [];
  const fechaPara = () => { if (para.length) { html += paragrafo(para.join('\n'), opts); para.length = 0; } };
  while (i < linhas.length) {
    const l = linhas[i];
    let m;
    if (!l.trim()) { fechaPara(); i++; continue; }
    // bloco ``` de código
    if (/^\s*```/.test(l)) {
      fechaPara(); const buf = []; i++;
      while (i < linhas.length && !/^\s*```/.test(linhas[i])) buf.push(linhas[i++]);
      i++; html += `<pre class="wpre"><code>${esc(buf.join('\n'))}</code></pre>`; continue;
    }
    // :::tipo título ... :::
    if ((m = /^\s*:::\s*(\S+)\s*(.*)$/.exec(l))) {
      fechaPara(); const tipo = simples(m[1]); const buf = []; let nivel = 1; i++;
      while (i < linhas.length) {
        const x = /^\s*:::\s*(\S*)/.exec(linhas[i]);
        if (x) { if (x[1]) nivel++; else if (!--nivel) break; }
        buf.push(linhas[i++]);
      }
      i++;
      const cls = BLOCOS[tipo] ? tipo : 'nota';
      const titulo = m[2].trim() || BLOCOS[tipo] || m[1];
      html += `<aside class="wbox w-${cls}">${titulo ? `<div class="wbt">${cls === 'mestre' ? '<span class="wtag">Só para o mestre</span>' : ''}${m[2].trim() || cls !== 'mestre' ? inline(titulo, opts) : ''}</div>` : ''}${blocos(buf, opts, ctx)}</aside>`;
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(l))) {
      fechaPara(); const n = Math.min(4, Math.max(2, m[1].length + (m[1].length === 1 ? 1 : 0)));
      const texto = m[2]; let id = slug(texto); const base = id; let k = 2;
      while (ctx.ids.has(id)) id = `${base}-${k++}`;
      ctx.ids.add(id); if (n <= 3) ctx.toc.push({ id, nivel: n, texto: texto.replace(/[*_`]/g, '') });
      html += `<h${n} id="w-${id}" class="wh">${inline(texto, opts)}</h${n}>`; i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { fechaPara(); html += '<hr class="whr">'; i++; continue; }
    if (/^\s*\|/.test(l) && ehSeparador(linhas[i + 1])) {
      fechaPara(); const cab = celulas(l); i += 2; const corpo = [];
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) corpo.push(celulas(linhas[i++]));
      html += `<div class="wtab"><table><thead><tr>${cab.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${corpo.map((r) => `<tr>${cab.map((_, j) => `<td>${inline(r[j] || '', opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    if (/^\s*>/.test(l)) {
      fechaPara(); const buf = [];
      while (i < linhas.length && /^\s*>/.test(linhas[i])) buf.push(linhas[i++].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${blocos(buf, opts, ctx)}</blockquote>`; continue;
    }
    if (reLista.test(l)) {
      fechaPara(); const buf = [];
      while (i < linhas.length && (reLista.test(linhas[i]) || (/^\s{2,}\S/.test(linhas[i]) && buf.length))) buf.push(linhas[i++]);
      html += lista(buf, opts); continue;
    }
    // imagem sozinha numa linha vira figura, com a legenda do título
    if ((m = /^\s*!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"([^"]*)")?\s*\)\s*$/.exec(l)) && !para.length) {
      const ok = urlSegura(m[2], true);
      html += ok ? `<figure class="wfig"><img src="${esc(ok)}" alt="${esc(m[1])}" loading="lazy">${m[3] ? `<figcaption>${inline(m[3], opts)}</figcaption>` : ''}</figure>` : paragrafo(l, opts);
      i++; continue;
    }
    para.push(l.replace(/\s+$/, '')); i++;
  }
  fechaPara();
  return html;
}
function paragrafo(t, opts) { return `<p>${inline(t, opts)}</p>`; }
function lista(linhas, opts) {
  const ind = (l) => /^(\s*)/.exec(l)[1].replace(/\t/g, '  ').length;
  const base = ind(linhas[0]);
  const ord = /^\s*\d/.test(linhas[0]);
  let html = '', i = 0;
  while (i < linhas.length) {
    const m = reLista.exec(linhas[i]);
    let texto = m ? m[3] : linhas[i].trim(); i++;
    const sub = [];
    while (i < linhas.length && (!reLista.test(linhas[i]) || ind(linhas[i]) > base)) {
      if (reLista.test(linhas[i])) sub.push(linhas[i]); else if (sub.length) sub.push(linhas[i]); else texto += '\n' + linhas[i].trim();
      i++;
    }
    html += `<li>${inline(texto, opts)}${sub.length ? lista(sub, opts) : ''}</li>`;
  }
  return ord ? `<ol>${html}</ol>` : `<ul>${html}</ul>`;
}

// texto -> {html, toc}
function render(texto, opts = {}) {
  const ctx = { ids: new Set(), toc: [] };
  const html = blocos(String(texto || '').replace(/\r\n?/g, '\n').split('\n'), opts, ctx);
  return { html, toc: ctx.toc };
}

// uma seção (do título até o próximo do mesmo nível ou maior), como texto
function secao(texto, id) {
  const linhas = String(texto || '').split('\n'); let ini = -1, nivel = 0;
  for (let i = 0; i < linhas.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(linhas[i]);
    if (!m) continue;
    if (ini >= 0 && m[1].length <= nivel) return linhas.slice(ini, i).join('\n').trim();
    if (ini < 0 && slug(m[2]) === id) { ini = i + 1; nivel = m[1].length; }
  }
  return ini >= 0 ? linhas.slice(ini).join('\n').trim() : '';
}

// texto puro para a busca e para resumos
function textoPuro(t) {
  return String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^\s*:::.*$/gm, ' ').replace(/^\s*#+\s*/gm, '').replace(/^\s*[-*+>]\s+/gm, '').replace(/[*_`|~]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------- HTML -> Markdown (importar documentos) ---------- */
// devolve {titulo, texto, imagens: [src relativos encontrados]}
function deHtml(src) {
  const doc = new DOMParser().parseFromString(String(src), 'text/html');
  for (const x of doc.querySelectorAll('script,style,noscript,template,iframe,object,embed,link,meta,svg,canvas,form,button,input,select,textarea')) x.remove();
  const imagens = [];
  const h1 = doc.querySelector('h1');
  const titulo = ((h1 && h1.textContent) || doc.title || '').replace(/\s+/g, ' ').trim();
  if (h1) h1.remove();
  const temCls = (el, re) => re.test(String(el.className || ''));
  const BLOCO = /^(P|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|MAIN|NAV|UL|OL|TABLE|BLOCKQUOTE|FIGURE|H[1-6]|HR|PRE|DL|DETAILS)$/;
  const temBloco = (el) => [...el.children].some((c) => BLOCO.test(c.tagName));

  function linha(el) { // inline
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' ').replace(/([*_`[\]|])/g, '\\$1'); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (t === 'BR') out += '\n';
      else if (t === 'STRONG' || t === 'B') out += envolve(linha(n), '**');
      else if (t === 'EM' || t === 'I' || t === 'CITE') out += envolve(linha(n), '*');
      else if (t === 'CODE' || t === 'KBD') out += '`' + n.textContent.replace(/`/g, "'") + '`';
      else if (t === 'A') { const h = n.getAttribute('href') || ''; const tx = linha(n).trim(); out += /^https?:/i.test(h) && tx ? `[${tx}](${h})` : tx; }
      else if (t === 'IMG') out += img(n, '');
      else if (temCls(n, /\bname\b|title|-num|tag/)) out += envolve(linha(n), '**') + ' ';
      else out += linha(n);
    }
    return out;
  }
  function envolve(s, m) { const t = s.trim(); return t ? (/^\s/.test(s) ? ' ' : '') + m + t + m + (/\s$/.test(s) ? ' ' : '') : s; }
  function img(n, legenda) {
    const s = n.getAttribute('src') || ''; if (!s) return '';
    if (!/^(https?:|data:)/i.test(s)) imagens.push(s);
    if (/^data:/i.test(s)) return '';
    return `![${(n.getAttribute('alt') || '').replace(/[\[\]]/g, '')}](${s.replace(/\s/g, '%20')}${legenda ? ` "${legenda.replace(/"/g, "'")}"` : ''})`;
  }
  function limpa(s) { return s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/^\s+|\s+$/g, ''); }

  function bloco(el, out) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) out.push(t); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (/^H[1-6]$/.test(t)) { const lv = Math.min(4, Math.max(2, +t[1])); const tx = limpa(linha(n)).replace(/\n/g, ' '); if (tx) out.push('#'.repeat(lv) + ' ' + tx.replace(/\*\*/g, '')); }
      else if (t === 'P') { const tx = limpa(linha(n)); if (tx) out.push(tx); }
      else if (t === 'HR') out.push('---');
      else if (t === 'UL' || t === 'OL') out.push(listaMd(n, 0));
      else if (t === 'TABLE') out.push(tabela(n));
      else if (t === 'BLOCKQUOTE') { const sub = []; bloco(n, sub); out.push(sub.join('\n\n').split('\n').map((x) => '> ' + x).join('\n')); }
      else if (t === 'PRE') out.push('```\n' + n.textContent.replace(/```/g, "'''") + '\n```');
      else if (t === 'FIGURE') { const cap = n.querySelector('figcaption'); const legenda = cap ? cap.textContent.replace(/\s+/g, ' ').trim() : ''; for (const im of n.querySelectorAll('img')) { const md = img(im, legenda); if (md) out.push(md); } }
      else if (t === 'IMG') { const md = img(n, ''); if (md) out.push(md); }
      else if (t === 'DL') { for (const c of n.children) { const tx = limpa(linha(c)); if (tx) out.push(c.tagName === 'DT' ? `**${tx}**` : tx); } }
      else if (t === 'DETAILS' || t === 'DIV' || t === 'SECTION' || t === 'ARTICLE' || t === 'ASIDE' || t === 'MAIN' || t === 'HEADER' || t === 'FOOTER' || t === 'NAV' || t === 'CENTER' || t === 'SUMMARY') {
        const cls = String(n.className || '');
        if (/(^|[\s_-])quote([\s_-]|$)/i.test(cls)) { const sub = []; bloco(n, sub); if (sub.length) out.push(sub.join('\n\n').split('\n').map((x) => '> ' + x).join('\n')); continue; }
        const tipo = /(^|[\s_-])(gm|dm|mestre)([\s_-]|$)/i.test(cls) ? 'mestre' : /read-?aloud|leitura|boxed/i.test(cls) ? 'leitura' : /sidebar|callout|note|nota|box|feature|item-block|stat-block|quote|aviso|warning/i.test(cls) || t === 'ASIDE' ? (/warning|aviso/i.test(cls) ? 'aviso' : 'nota') : null;
        if (tipo) {
          const tt = n.querySelector('[class*="title"],[class*="titulo"],[class*="name"]');
          let titulo = '';
          if (tt && !temBloco(tt) && tt.textContent.trim().length < 80) { titulo = tt.textContent.replace(/\s+/g, ' ').trim(); tt.remove(); }
          const sub = []; bloco(n, sub);
          if (sub.length) out.push(`:::${tipo}${titulo ? ' ' + titulo : ''}\n${sub.join('\n\n')}\n:::`);
        } else if (!temBloco(n)) {
          const tx = limpa(linha(n));
          if (tx) out.push(/title|titulo|heading|cabec/i.test(cls) && tx.length < 90 ? '### ' + tx.replace(/\*\*/g, '') : /subtitle|subtitulo/i.test(cls) ? `*${tx}*` : /name|-num|tag/i.test(cls) ? `**${tx.replace(/\*\*/g, '')}**` : tx);
        } else bloco(n, out);
      } else { const tx = limpa(linha(n)); if (tx) out.push(tx); }
    }
    return out;
  }
  function listaMd(el, nivel) {
    const ord = el.tagName === 'OL'; let k = 1; const out = [];
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      const copia = li.cloneNode(true); const subs = [...copia.querySelectorAll(':scope > ul, :scope > ol')]; subs.forEach((s) => s.remove());
      out.push('  '.repeat(nivel) + (ord ? `${k++}. ` : '- ') + limpa(linha(copia)).replace(/\n/g, ' '));
      for (const s of li.querySelectorAll(':scope > ul, :scope > ol')) out.push(listaMd(s, nivel + 1));
    }
    return out.join('\n');
  }
  function tabela(el) {
    const linhas = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => limpa(linha(c)).replace(/\n/g, ' ')));
    if (!linhas.length) return '';
    const n = Math.max(...linhas.map((l) => l.length));
    const fmt = (l) => '| ' + Array.from({ length: n }, (_, j) => l[j] || '').join(' | ') + ' |';
    const cap = el.querySelector('caption');
    return (cap ? `**${cap.textContent.replace(/\s+/g, ' ').trim()}**\n\n` : '') + [fmt(linhas[0]), '|' + ' --- |'.repeat(n), ...linhas.slice(1).map(fmt)].join('\n');
  }

  const out = bloco(doc.body, []);
  const texto = out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { titulo, texto, imagens: [...new Set(imagens)] };
}

window.Wiki = { render, secao, slug, simples, textoPuro, deHtml, esc };
})();
