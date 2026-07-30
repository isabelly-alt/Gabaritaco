'use strict';

const { pickEmoji } = require('./emojiMap');

const BRAND_SUFFIX_RE = /[-–—]\s*VDE\s+CONCURSOS\s*$/i;
const OPTION_LINE_RE = /^[A-E]\)/;
// Splits a single "- a) ... - b) ... - c) ..." run-on paragraph (common when
// a flexible/Markdown-sourced file writes all comments as one paragraph)
// into one entry per lettered comment.
// The letter is sometimes wrapped in <b> (native bold on "a)", "b)"...).
const DASHED_COMMENT_SPLIT_RE = /\s*-\s+(?=(?:<b>)?[a-e]\)(?:<\/b>)?\s)/i;
const LEADING_DASH_RE = /^\s*-\s+/;
// Marks the end of a jurisprudencia citation - e.g. "(STF, ADI 6.649/DF,
// Julgamento: 15.9.2022)." Once seen, any further text belongs outside the
// lilac box (plain flowing commentary), not inside it.
const CITATION_CLOSE_RE = /Julgamento:?\s*\d{1,2}\.\d{1,2}\.\d{4}\)?\.?\s*$/i;

function stripTags(html) {
  return (html || '').replace(/<[^>]+>/g, '');
}

function splitDashedComments(paragraphs) {
  if (paragraphs.length !== 1) return paragraphs;
  const text = paragraphs[0].replace(LEADING_DASH_RE, '');
  const parts = text.split(DASHED_COMMENT_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : paragraphs;
}

// ARTIGOS:/SUMULAS: are typically authored as one line with several
// citations separated by semicolons (e.g. "Súmula 227 STJ; Súmula
// vinculante 25 STF."), so that single line becomes several list entries.
function splitCitations(html) {
  if (!html) return [];
  return html.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
}

// Real raw files export tables from Notion/Google Docs, where every row -
// including row 0 - gets marked "repeat as header" (<w:tblHeader/>) and no
// row gets distinct shading, so neither signal tells a true header apart
// from an ordinary row. What does distinguish them: a genuine header row is
// short labels in EVERY cell, while every other row has at least one
// substantially longer (comparison/definition/paragraph) cell - so row 0 is
// a header only if (a) every one of its cells is short in absolute terms
// (a real column label never runs to a full sentence) AND (b) row 0's
// longest cell is well under half the length of the longest cell in the
// rest of the table. Both conditions matter: (a) alone would misfire on a
// genuine "Termo | curta definição" data row that just happens to be brief;
// (b) alone would misfire when one other row is an outlier - e.g. a
// "Princípio | descrição" table where one row's description happens to run
// much longer than the rest (an unrelated a)/b)/c) list folded into it),
// which drags the half-of-longest threshold up far enough that an ordinary
// data row looks "short by comparison" and gets mistaken for the header.
const HEADER_CELL_MAX_LEN = 60;
function longestCellLength(row) {
  return row.reduce((max, cell) => Math.max(max, (cell.text || '').replace(/<[^>]+>/g, '').length), 0);
}
function tableHasHeaderRow(rows) {
  if (rows.length < 2) return false;
  const row0Len = longestCellLength(rows[0]);
  if (row0Len > HEADER_CELL_MAX_LEN) return false;
  const restLen = rows.slice(1).reduce((max, row) => Math.max(max, longestCellLength(row)), 0);
  return restLen > 0 && row0Len < restLen * 0.5;
}

/**
 * Turns the flat block list from docxParser into structured data:
 *   { disciplina, selo, subtitulo, sections: [ { titulo, items: [...] } ] }
 * Each section's DICA numbering restarts at 1, per the rule that DICA
 * numbering resets at every TITULO_SECAO. Also understands the "flexible"
 * format docxParser translates from headings/emoji/list-items into the same
 * marker shapes as the strict TITULO_SECAO:/DICA:/LEI:/ALERTA: syntax.
 */
function buildSections(blocks) {
  let disciplina = '';
  let selo = '';
  let subtitulo = '';
  const sections = [];
  let currentSection = null;
  let currentItem = null;
  let dicaCounter = 0;
  let pendingTableCaption = null;

  // For 'questao' items, tracks which sub-list new text paragraphs append
  // to: 'enunciado' | 'opcoes' | 'comentarios'.
  let questaoField = null;

  const closeItem = () => {
    if (currentItem && currentSection) currentSection.items.push(currentItem);
    currentItem = null;
    questaoField = null;
  };

  for (const block of blocks) {
    if (block.kind === 'marker') {
      switch (block.marker) {
        case 'DISCIPLINA':
          if (block.inlineText) disciplina = block.inlineText.replace(BRAND_SUFFIX_RE, '').trim();
          break;
        case 'SELO':
          if (block.inlineText) selo = block.inlineText;
          break;
        case 'SUBTITULO':
          if (block.inlineText) subtitulo = block.inlineText;
          break;
        case 'TITULO_SECAO':
          closeItem();
          dicaCounter = 0;
          currentSection = { titulo: block.inlineText, items: [] };
          sections.push(currentSection);
          break;
        case 'DICA':
          closeItem();
          dicaCounter += 1;
          currentItem = { type: 'dica', numero: dicaCounter, titulo: block.inlineText, paragrafos: [] };
          break;
        case 'LEI':
          closeItem();
          currentItem = { type: 'lei', label: block.inlineText, paragrafos: [] };
          break;
        case 'JURISPRUDENCIA':
          closeItem();
          currentItem = { type: 'jurisprudencia', paragrafos: [], closed: false };
          if (block.inlineHtml) {
            currentItem.paragrafos.push(block.inlineHtml);
            if (CITATION_CLOSE_RE.test(stripTags(block.inlineHtml))) currentItem.closed = true;
          }
          break;
        case 'ALERTA':
          closeItem();
          currentItem = { type: 'alerta', paragrafos: block.inlineHtml ? [block.inlineHtml] : [] };
          break;
        case 'NOTA':
          // Only ever seen as a round-trip style tag (see roundTripStyles.js)
          // on a re-uploaded .docx - a freshly-authored raw file has no
          // "NOTA:" marker of its own; sectionBuilder derives this same
          // item type itself when a JURISPRUDENCIA citation closes and
          // plain commentary follows it (see the JURISPRUDENCIA text-block
          // handling below).
          closeItem();
          currentItem = { type: 'nota', paragrafos: block.inlineHtml ? [block.inlineHtml] : [] };
          break;
        case 'TABELA':
          closeItem();
          currentItem = { type: 'tabela', headers: [], rows: [], caption: pendingTableCaption };
          pendingTableCaption = null;
          break;
        case 'REFERENCIAS':
          closeItem();
          currentItem = { type: 'referencias', label: block.inlineText, paragrafos: [] };
          break;
        case 'ARTIGOS':
          closeItem();
          currentItem = { type: 'referencias', label: 'Artigos', paragrafos: splitCitations(block.inlineHtml) };
          break;
        case 'SUMULAS':
          closeItem();
          currentItem = { type: 'referencias', label: 'Súmulas', paragrafos: splitCitations(block.inlineHtml) };
          break;
        case 'COMENTARIO_ARTIGO':
          closeItem();
          currentItem = { type: 'comentario_artigo', paragrafos: block.inlineHtml ? [block.inlineHtml] : [] };
          break;
        case 'QUESTAO':
          closeItem();
          currentItem = {
            type: 'questao',
            titulo: block.inlineText || 'QUESTÃO',
            enunciado: [],
            opcoes: [],
            gabarito: '',
            comentarios: [],
          };
          questaoField = 'enunciado';
          break;
        case 'ENUNCIADO':
          if (currentItem && currentItem.type === 'questao') {
            questaoField = 'enunciado';
            if (block.inlineHtml) currentItem.enunciado.push(block.inlineHtml);
          }
          break;
        case 'GABARITO':
          if (currentItem && currentItem.type === 'questao') {
            currentItem.gabarito = block.inlineText;
            questaoField = null;
          }
          break;
        case 'COMENTARIOS':
          if (currentItem && currentItem.type === 'questao') {
            questaoField = 'comentarios';
            if (block.inlineHtml) currentItem.comentarios.push(block.inlineHtml);
          }
          break;
        default:
          break;
      }
    } else if (block.kind === 'text') {
      if (!currentSection && !subtitulo && block.paragraphs.length) {
        // Plain prose between the DISCIPLINA line and the first
        // TITULO_SECAO, with no explicit SUBTITULO: marker - flexible-
        // format files often write the subtitle this way instead.
        subtitulo = block.paragraphs[0].replace(/<[^>]+>/g, '');
      } else if (currentItem && currentItem.type === 'questao') {
        for (const p of block.paragraphs) {
          if (questaoField === 'enunciado' && (OPTION_LINE_RE.test(p) || block.listItem)) {
            questaoField = 'opcoes';
          }
          const field = questaoField || 'enunciado';
          if (field === 'opcoes' && !OPTION_LINE_RE.test(p)) {
            const letter = String.fromCharCode(65 + currentItem.opcoes.length);
            currentItem.opcoes.push(`${letter}) ${p}`);
          } else {
            currentItem[field].push(p);
          }
        }
      } else if (currentItem && currentItem.type === 'jurisprudencia') {
        for (const p of block.paragraphs) {
          if (currentItem.closed) {
            // Citation already closed (its judgment-date parenthetical was
            // seen): this and any further text is commentary that flows
            // outside the lilac box, not more citation text.
            closeItem();
            currentItem = { type: 'nota', paragrafos: [] };
            currentItem.paragrafos.push(p);
          } else {
            currentItem.paragrafos.push(p);
            if (CITATION_CLOSE_RE.test(stripTags(p))) currentItem.closed = true;
          }
        }
      } else if (currentItem && currentItem.paragrafos) {
        currentItem.paragrafos.push(...block.paragraphs);
      }
      // Free text outside of any marker (e.g. before the first marker) is
      // dropped: the raw-file convention has no slot to place it in.
    } else if (block.kind === 'table-caption') {
      pendingTableCaption = block.html;
    } else if (block.kind === 'table') {
      // Strict format opens an empty 'tabela' item via the TABELA: marker
      // before the real table arrives; flexible format has no such marker,
      // so a table with nothing already waiting for it opens its own item.
      if (!currentItem || currentItem.type !== 'tabela' || currentItem.headers.length || currentItem.rows.length) {
        closeItem();
        currentItem = { type: 'tabela', headers: [], rows: [], caption: pendingTableCaption };
      } else if (pendingTableCaption) {
        currentItem.caption = pendingTableCaption;
      }
      pendingTableCaption = null;
      if (tableHasHeaderRow(block.rows)) {
        const [headers, ...rows] = block.rows;
        currentItem.headers = headers;
        currentItem.rows = rows;
      } else {
        currentItem.headers = [];
        currentItem.rows = block.rows;
      }
    }
  }
  closeItem();

  for (const section of sections) {
    for (const item of section.items) {
      if (item.type === 'dica') {
        item.emoji = pickEmoji(item.titulo, item.paragrafos.join(' '));
      } else if (item.type === 'questao') {
        item.comentarios = splitDashedComments(item.comentarios);
      }
    }
  }

  return { disciplina, selo, subtitulo, sections };
}

module.exports = { buildSections };
