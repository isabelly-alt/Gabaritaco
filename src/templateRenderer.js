'use strict';

const fs = require('fs');
const path = require('path');

// Fixed branding per the approved design - the user's instruction was that
// this header/footer must "sempre" (always) appear this way, regardless of
// the SELO field in any given raw file.
const HEADER_BRAND = { selo: 'GABARITAÇO', dash: '–', sub: 'VDE CONCURSOS' };
const FOOTER_HANDLES = '@vdeconcursos';

// Poppins is embedded as base64 @font-face data instead of linked from
// Google Fonts: PDF generation runs in a headless browser with no
// guarantee of network access (sandboxes, offline machines, and corporate
// proxies that intercept TLS have all been observed breaking the Google
// Fonts fetch silently, leaving the PDF on a fallback system font). Read
// once at module load and reused for every render.
const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONT_WEIGHTS = [400, 600, 700, 800];
const POPPINS_FONT_FACES = FONT_WEIGHTS.map((weight) => {
  const b64 = fs.readFileSync(path.join(FONT_DIR, `poppins-${weight}.ttf`)).toString('base64');
  return `@font-face{font-family:'Poppins';font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
}).join('\n');

// MAPA_MENTAL's palette/box styling lives in assets/style.css (see
// references/sintaxe.md) instead of inline here, so it can be documented and
// tweaked on its own - read once and inlined into the page's own <style>,
// same reasoning as the embedded font faces above (page.setContent has no
// base URL a linked <link rel="stylesheet"> could resolve against).
const MAPA_MENTAL_CSS = fs.readFileSync(path.join(__dirname, '..', 'assets', 'style.css'), 'utf8');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderTableCell(tag, cell) {
  const colspan = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
  const rowspan = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
  return `<${tag}${colspan}${rowspan}>${cell.text}</${tag}>`;
}

function renderItem(item) {
  if (item.type === 'dica') {
    const numero = String(item.numero).padStart(2, '0');
    return `<div class="dica"><div class="dica-head"><span class="dica-tag">DICA ${numero}</span><h4 class="dica-title">${escapeHtml(item.titulo)}</h4></div>${item.paragrafos
      .map((p) => `<p class="dica-p">${p}</p>`)
      .join('')}</div>`;
  }
  if (item.type === 'lei') {
    const label = item.label ? `<span class="lei-label">${escapeHtml(item.label)}</span>` : '';
    return `<div class="lei-box">${label}${item.paragrafos.map((p) => `<p>${p}</p>`).join('')}</div>`;
  }
  if (item.type === 'jurisprudencia') {
    return `<div class="juris-box">${item.paragrafos.map((p) => `<p>${p}</p>`).join('')}</div>`;
  }
  if (item.type === 'nota') {
    return item.paragrafos.map((p) => `<p class="nota-p">${p}</p>`).join('');
  }
  if (item.type === 'comentario_artigo') {
    return `<div class="comentario-box"><span class="comentario-tag">Comentário ao artigo</span>${item.paragrafos
      .map((p) => `<p>${p}</p>`)
      .join('')}</div>`;
  }
  if (item.type === 'alerta') {
    const paras = item.paragrafos.map((p, i) => (i === 0 ? `<p><b>ALERTA:</b> ${p}</p>` : `<p>${p}</p>`));
    return `<div class="alerta-box"><span class="alerta-icon">⚠️</span><div>${paras.join('')}</div></div>`;
  }
  if (item.type === 'tabela') {
    const caption = item.caption ? `<p class="tabela-caption">${item.caption}</p>` : '';
    const thead = item.headers.length
      ? `<thead><tr>${item.headers.map((h) => renderTableCell('th', h)).join('')}</tr></thead>`
      : '';
    const tbody = `<tbody>${item.rows
      .map((row) => `<tr>${row.map((c) => renderTableCell('td', c)).join('')}</tr>`)
      .join('')}</tbody>`;
    return `<div class="tabela-wrap">${caption}<table class="tabela">${thead}${tbody}</table></div>`;
  }
  if (item.type === 'referencias') {
    const itens = item.paragrafos.map((p) => `<li>${p}</li>`).join('');
    return `<div class="ref-box"><span class="ref-label">${escapeHtml(item.label)}</span><ul class="ref-list">${itens}</ul></div>`;
  }
  if (item.type === 'mapa_mental') {
    const titulo = item.titulo ? `<p class="mapa-mental-titulo">${escapeHtml(item.titulo)}</p>` : '';
    const ramos = item.ramos
      .map(
        (r) =>
          `<div class="mapa-mental-ramo"><span class="mapa-mental-nome">${r.nome}</span>${r.textos
            .map((t) => `<p class="mapa-mental-texto">${t}</p>`)
            .join('')}</div>`
      )
      .join('');
    return `<div class="mapa-mental-box">${titulo}${ramos}</div>`;
  }
  if (item.type === 'questao') {
    const enunciado = item.enunciado.map((p) => `<p class="questao-p">${p}</p>`).join('');
    const opcoes = item.opcoes.length
      ? `<div class="questao-opts">${item.opcoes.map((p) => `<p class="opt">${p}</p>`).join('')}</div>`
      : '';
    const gabarito = item.gabarito
      ? `<p class="gabarito">Gabarito: ${escapeHtml(item.gabarito)}</p>`
      : '';
    const comentarios = item.comentarios.length
      ? `<p class="coment-label">Comentários:</p>${item.comentarios.map((p) => `<p class="coment-p">${p}</p>`).join('')}`
      : '';
    return `<div class="questao"><span class="questao-tag">${escapeHtml(item.titulo)}</span>${enunciado}${opcoes}${gabarito}${comentarios}</div>`;
  }
  return '';
}

function renderSection(section, isFirst) {
  const bandClass = isFirst ? 'matter-band first' : 'matter-band';
  const items = section.items.map(renderItem).join('\n');
  return `<div class="${bandClass}">${escapeHtml(section.titulo)}</div>\n${items}`;
}

/**
 * Renders a full standalone document for one materia.
 * @param {{disciplina:string, subtitulo?:string, sections:Array}} materia -
 *   merged sections from every uploaded .docx of this materia, in upload
 *   order.
 */
function renderDocumentHtml(materia) {
  const title = (materia.disciplina || '').toUpperCase() || 'MATÉRIA';
  const subtitleHtml = materia.subtitulo
    ? `<p style="color:#6B7280; font-size:13px; text-align:center; margin:0 0 26px 0;">${escapeHtml(materia.subtitulo)}</p>`
    : '';
  const titleMarginBottom = materia.subtitulo ? '6px' : '26px';
  const colsHtml = materia.sections
    .map((section, i) => renderSection(section, i === 0))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${POPPINS_FONT_FACES}
  :root{
    --page-w: 210mm;
    --page-h: 297mm;
    --margin-top: 0.9cm;
    --margin-bottom: 0.9cm;
    --margin-left: 0.5in;
    --margin-right: 0.5in;
    --hdr-h: 62px;
    --ftr-h: 42px;
    --body-size: 11pt;
    --body-line: 1.15;
  }
  *{ box-sizing:border-box; }
  html, body{ margin:0; padding:0; }
  body{
    font-family:'Poppins',sans-serif;
    background:#ece8dd;
    padding:48px 24px;
  }
  .sheet{
    position:relative;
    width:var(--page-w);
    margin:0 auto;
    background:#fff;
    box-shadow:0 2px 14px rgba(20,20,19,.12);
    border-radius:2px;
  }
  .frame{ width:100%; border-collapse:collapse; }
  .frame td, .frame th{ padding:0; text-align:left; font-weight:inherit; border:none; }
  .hdr-spacer, .ftr-spacer{ height:0; }
  .frame td.body-cell{ padding:var(--margin-top) var(--margin-right) var(--margin-bottom) var(--margin-left); }
  @page{ size:210mm 297mm; margin:0; }
  @media print{
    body{ background:none; padding:0; }
    .sheet{ width:auto; margin:0; box-shadow:none; border-radius:0; }
    .frame td.body-cell{ padding:0 var(--margin-right) 0 var(--margin-left); }
    .hdr-spacer{ height:calc(var(--hdr-h) + var(--margin-top)); }
    .ftr-spacer{ height:calc(var(--ftr-h) + var(--margin-bottom)); }
    .hdr-band, .ftr-band{ position:fixed; left:0; right:0; margin:0 !important; }
    .hdr-band{ top:0; }
    .ftr-band{ bottom:0; }
    h1,h2,h3,h4,h5,h6{ break-after:avoid; }
    p,li{ orphans:3; widows:3; }
    *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
  .cols{ column-count:2; column-gap:36px; }
  .cols > .dica, .cols > .lei-box, .cols > .alerta-box, .cols > .ref-box, .cols > .juris-box, .cols > .comentario-box{ break-inside:avoid; }
  .cols > .questao{ break-inside:auto; }
  .cols p, .cols li{ text-align:justify; text-justify:inter-word; }
  .cols p, .cols li{ line-height:var(--body-line) !important; }
  .cols p, .cols li{ orphans:3; widows:3; }
  .questao-tag, .gabarito, .coment-label{ break-after:avoid; }
  .questao-opts{ break-inside:avoid; }
  .hdr-band{ background:#4C1D95; display:flex; align-items:center; justify-content:center; gap:10px; padding:16px var(--margin-right); }
  .ftr-band{ background:#4C1D95; border-top:3px solid #2E1155; display:flex; align-items:center; justify-content:center; padding:12px var(--margin-right); }
  .matter-band{ column-span:all; background:#4C1D95; color:#fff; font-weight:800; font-size:19px; letter-spacing:.03em; padding:10px 16px; border-radius:8px; margin-bottom:14px; break-before:page; }
  .matter-band.first{ break-before:auto; }
  .dica{ margin-bottom:14px; }
  .dica-tag{ display:inline-block; background:#FFD23F; color:#2A1155; font-weight:800; font-size:11.5px; letter-spacing:.02em; padding:3px 10px; border-radius:6px; margin-bottom:5px; }
  .dica-title{ color:#6D28D9; font-size:14.5px; margin:0 0 4px 0; }
  .dica-p{ font-size:var(--body-size); line-height:var(--body-line); margin:0 0 2px 0; }
  .lei-box{ background:#EFE9FC; border-radius:10px; padding:12px 14px; margin-bottom:14px; }
  .lei-box .lei-label{ display:block; font-weight:800; font-size:11px; letter-spacing:.03em; color:#6D28D9; margin-bottom:4px; }
  .lei-box p{ font-size:var(--body-size); line-height:var(--body-line); margin:0; color:#4C1D95; }
  .juris-box{ background:#EFE9FC; border-radius:10px; padding:12px 14px; margin-bottom:14px; }
  .juris-box p{ font-size:var(--body-size); line-height:var(--body-line); margin:0 0 6px 0; color:#4C1D95; }
  .juris-box p:last-child{ margin-bottom:0; }
  .nota-p{ font-size:var(--body-size); line-height:var(--body-line); margin:0 0 8px 0; }
  .comentario-box{ background:#E7F0FE; border-radius:10px; padding:12px 14px; margin-bottom:14px; }
  .comentario-box .comentario-tag{ display:inline-block; background:#1D4ED8; color:#fff; font-weight:800; font-size:11px; letter-spacing:.03em; text-transform:uppercase; padding:3px 10px; border-radius:6px; margin-bottom:6px; }
  .comentario-box p{ font-size:var(--body-size); line-height:var(--body-line); margin:0 0 6px 0; color:#1E3A8A; }
  .comentario-box p:last-child{ margin-bottom:0; }
  .alerta-box{ display:flex; gap:10px; align-items:flex-start; background:#FEF6E4; border-radius:10px; padding:12px 14px; margin-bottom:14px; }
  .alerta-box .alerta-icon{ font-size:15px; line-height:1.3; }
  .alerta-box p{ font-size:var(--body-size); line-height:var(--body-line); margin:0; color:#7A4B00; }
  .ref-box{ background:#EFE9FC; border-radius:10px; padding:12px 14px; margin-bottom:14px; }
  .ref-box .ref-label{ display:block; font-weight:800; font-size:11px; letter-spacing:.03em; color:#6D28D9; margin-bottom:6px; }
  .ref-box .ref-list{ margin:0; padding-left:18px; }
  .ref-box .ref-list li{ font-size:var(--body-size); line-height:var(--body-line); margin:0 0 2px 0; color:#4C1D95; }
  .tabela-wrap{ margin-bottom:14px; }
  .tabela-caption{ font-weight:700; font-size:var(--body-size); margin:0 0 6px 0; break-after:avoid; }
  .tabela{ width:100%; border-collapse:collapse; font-size:10pt; line-height:var(--body-line); }
  .cols .tabela{ table-layout:fixed; }
  .tabela th{ background:#4C1D95; color:#fff; text-align:left; padding:6px 8px; font-weight:700; overflow-wrap:break-word; word-break:break-word; }
  .tabela td{ padding:6px 8px; border-bottom:1px solid #EFE9FC; text-align:justify; text-justify:inter-word; overflow-wrap:break-word; word-break:break-word; }
  .tabela tr:nth-child(even) td{ background:#FAF8FF; }
  .tabela tr{ break-inside:avoid; }
  .questao{ background:#F7F5FC; border-radius:10px; padding:14px 16px; margin-bottom:14px; }
  .questao-tag{ display:inline-block; background:#4C1D95; color:#fff; font-weight:800; font-size:11.5px; letter-spacing:.03em; text-transform:uppercase; padding:3px 10px; border-radius:6px; margin-bottom:8px; }
  .questao-p{ font-size:var(--body-size); line-height:var(--body-line); margin:0 0 8px 0; }
  .questao-opts{ margin-bottom:8px; }
  .opt{ font-size:var(--body-size); line-height:var(--body-line); margin:0 0 5px 0; }
  .gabarito{ font-weight:800; color:#6D28D9; font-size:var(--body-size); margin:0 0 6px 0; }
  .coment-label{ font-weight:700; font-size:var(--body-size); margin:0 0 4px 0; }
  .coment-p{ font-size:var(--body-size); line-height:var(--body-line); margin:0 0 6px 0; }
  .cols > .mapa-mental-box{ break-inside:avoid; }
${MAPA_MENTAL_CSS}
</style>
</head>
<body>

<div class="sheet">

  <div class="hdr-band">
    <div style="width:30px; height:30px; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; color:#4C1D95; font-size:15px;">✓</div>
    <span style="font-weight:800; color:#fff; font-size:19px; letter-spacing:.02em;">${HEADER_BRAND.selo}</span>
    <span style="color:#D9C7FF; font-size:19px; font-weight:600;">${HEADER_BRAND.dash}</span>
    <span style="font-weight:700; color:#FFD23F; font-size:17px; letter-spacing:.02em;">${HEADER_BRAND.sub}</span>
  </div>

  <table class="frame">
    <thead><tr><th><div class="hdr-spacer"></div></th></tr></thead>
    <tbody><tr><td class="body-cell">

      <h1 style="font-weight:800; color:#6D28D9; font-size:32px; text-align:center; letter-spacing:.01em; margin:0 0 ${titleMarginBottom} 0;">${escapeHtml(title)}</h1>
      ${subtitleHtml}

      <div class="cols">
${colsHtml}
      </div>

    </td></tr></tbody>
    <tfoot><tr><td><div class="ftr-spacer"></div></td></tr></tfoot>
  </table>

  <div class="ftr-band">
    <span style="font-weight:700; color:#fff; font-size:13px; letter-spacing:.01em;">${FOOTER_HANDLES}</span>
  </div>

</div>

</body>
</html>
`;
}

module.exports = { renderDocumentHtml };
