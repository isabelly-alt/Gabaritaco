'use strict';

const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { MARKER_NAMES, STYLE_NAME_PREFIX } = require('./roundTripStyles');

// TITULO_SECAO/DICA/LEI/ALERTA/TABELA/JURISPRUDENCIA are the officially
// defined marker set. QUESTAO/ENUNCIADO/GABARITO/COMENTARIOS aren't part of
// that spec (the user chose not to author new files with them), but the
// approved design already ships full CSS for a question block
// (.questao/.gabarito/.coment-label) and real raw files can still contain
// them - so they're recognized too, rather than silently dropping content.
const MARKERS = [
  'DISCIPLINA', 'SELO', 'SUBTITULO', 'TITULO_SECAO', 'DICA', 'LEI', 'ALERTA', 'TABELA',
  'JURISPRUDENCIA', 'ARTIGOS', 'SUMULAS', 'COMENTARIO_ARTIGO', 'QUESTAO', 'ENUNCIADO', 'GABARITO',
  'COMENTARIOS',
];
// Flexible-format files are often natural Portuguese prose ("Comentários:",
// "Questão:") rather than the ASCII-only marker spelling, so each marker
// also accepts its accented spelling. Named groups (rather than accent-
// stripping the whole line) keep the match offset exact for slicing.
const MARKER_ACCENT_ALTS = {
  SUBTITULO: 'SUBT[IÍ]TULO',
  TITULO_SECAO: 'T[IÍ]TULO[_ ]SE[CÇ][AÃ]O',
  JURISPRUDENCIA: 'JURISPRUD[EÊ]NCIA',
  SUMULAS: 'S[UÚ]MULAS',
  COMENTARIO_ARTIGO: 'COMENT[AÁ]RIO\\s+AO\\s+ARTIGO',
  QUESTAO: 'QUEST[AÃ]O',
  COMENTARIOS: 'COMENT[AÁ]RIOS',
};
const MARKER_PREFIX_RE = new RegExp(
  '^\\s*(?:' +
    MARKERS.map((name) => `(?<${name}>${name}${MARKER_ACCENT_ALTS[name] ? '|' + MARKER_ACCENT_ALTS[name] : ''})`).join('|') +
    ')\\s*:\\s*',
  'i'
);

// --- "Flexible" format support -------------------------------------------
// Some raw files aren't typed by hand with literal "TITULO_SECAO:"/"DICA:"
// markers - they're drafted in Markdown (often by an AI) and converted to
// .docx, which produces real Word heading styles, real numbered/bulleted
// list items, and inline emoji instead of marker text. Rather than guess
// from wording, these signals are read from the OOXML itself:
//   - heading level -> read from styles.xml's <w:outlineLvl> (locale- and
//     tool-independent; works for pandoc's "Ttulo2" as much as Word's own
//     "Heading 2")
//   - list item -> <w:numPr> presence on the paragraph
// Both formats can appear in the same file; strict marker text always wins
// when present.
const QUESTAO_HEADING_RE = /como (ja|já) caiu|questao|caso concreto/i;
const DICA_HEADING_RE = /^dica\s*\d*\s*[-–—:]*\s*/i;
const LEI_EMOJI_RE = /^\s*⚖️?\s*/;
const ALERTA_EMOJI_RE = /^\s*⚠️?\s*(alerta\s*:?\s*)?/i;
const ART_LABEL_RE = /^((?:Art\.?|Artigo)\s*\d+[ºo°]?\s*,\s*[A-ZÇÃÕ]{2,8})\.?\s+(.*)$/;
// Same citation shape as ART_LABEL_RE, but for a paragraph that's ONLY the
// citation with nothing trailing it (docxRenderer puts a bare "Art. 25, CF"
// label in its own paragraph, with no space-then-body after it, which
// ART_LABEL_RE's mandatory trailing \s+ can't match).
const ART_LABEL_ONLY_RE = /^(?:Art\.?|Artigo)\s*\d+[ºo°]?\s*,\s*[A-ZÇÃÕ]{2,8}\.?$/;

async function loadZipEntry(zip, path) {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async('string');
}

/** Reads styles.xml and returns a Map of styleId -> heading level (1-based),
 *  derived from each style's <w:outlineLvl> (0-based in OOXML). */
function buildHeadingLevelMap(stylesXml) {
  const map = new Map();
  if (!stylesXml) return map;
  const doc = new DOMParser().parseFromString(stylesXml, 'text/xml');
  for (const style of Array.from(doc.getElementsByTagName('w:style'))) {
    if (style.getAttribute('w:type') !== 'paragraph') continue;
    const styleId = style.getAttribute('w:styleId');
    const pPr = childrenByName(style, 'w:pPr')[0];
    const outline = pPr && childrenByName(pPr, 'w:outlineLvl')[0];
    if (styleId && outline) {
      const lvl = parseInt(outline.getAttribute('w:val'), 10);
      if (!Number.isNaN(lvl)) map.set(styleId, lvl + 1);
    }
  }
  return map;
}

/** Reads styles.xml and returns a Map of styleId -> marker name, for the
 *  round-trip styles docxRenderer.js stamps (see roundTripStyles.js).
 *  Resolved dynamically per-document by each style's <w:name> rather than
 *  by a fixed ID - Word rewrites <w:styleId> to its own generated value
 *  every time it resaves a .docx, but leaves <w:name> untouched, the same
 *  reasoning buildHeadingLevelMap already relies on for heading styles. */
function buildGabStyleMap(stylesXml) {
  const map = new Map();
  if (!stylesXml) return map;
  const doc = new DOMParser().parseFromString(stylesXml, 'text/xml');
  for (const style of Array.from(doc.getElementsByTagName('w:style'))) {
    if (style.getAttribute('w:type') !== 'paragraph') continue;
    const styleId = style.getAttribute('w:styleId');
    const nameEl = childrenByName(style, 'w:name')[0];
    const name = nameEl && nameEl.getAttribute('w:val');
    if (!styleId || !name || !name.startsWith(STYLE_NAME_PREFIX)) continue;
    const marker = name.slice(STYLE_NAME_PREFIX.length);
    if (MARKER_NAMES.includes(marker)) map.set(styleId, marker);
  }
  return map;
}

function childrenByName(node, name) {
  return Array.from(node.childNodes || []).filter((n) => n.nodeName === name);
}

function isRunBold(runNode) {
  const rPr = childrenByName(runNode, 'w:rPr')[0];
  if (!rPr) return false;
  const b = childrenByName(rPr, 'w:b')[0];
  if (!b) return false;
  const val = b.getAttribute && b.getAttribute('w:val');
  return val === undefined || val === null || !['0', 'false'].includes(String(val).toLowerCase());
}

function getParagraphStyleId(pNode) {
  const pPr = childrenByName(pNode, 'w:pPr')[0];
  const pStyle = pPr && childrenByName(pPr, 'w:pStyle')[0];
  return pStyle ? pStyle.getAttribute('w:val') : null;
}

function paragraphHeadingLevel(pNode, headingLevels) {
  const styleId = getParagraphStyleId(pNode);
  return styleId && headingLevels.has(styleId) ? headingLevels.get(styleId) : null;
}

function paragraphIsListItem(pNode) {
  const pPr = childrenByName(pNode, 'w:pPr')[0];
  return !!(pPr && childrenByName(pPr, 'w:numPr')[0]);
}

/** Walks a <w:p> into a flat list of {text, bold} segments and 'break'
 *  markers, so callers can split on blank lines (two+ consecutive breaks). */
function walkParagraphRuns(pNode) {
  const items = [];
  const walk = (node) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeName === 'w:r') {
        const bold = isRunBold(child);
        for (const rc of Array.from(child.childNodes || [])) {
          if (rc.nodeName === 'w:t') {
            items.push({ type: 'text', text: rc.textContent || '', bold });
          } else if (rc.nodeName === 'w:br' || rc.nodeName === 'w:cr') {
            items.push({ type: 'break' });
          } else if (rc.nodeName === 'w:tab') {
            items.push({ type: 'text', text: '\t', bold });
          }
        }
      } else if (child.nodeName === 'w:hyperlink') {
        walk(child);
      }
    }
  };
  walk(pNode);
  return items;
}

/** Splits run-items into sub-paragraphs. First pass: cut into "lines" at
 *  every break, recording how many consecutive breaks preceded each line.
 *  Second pass: a line starts a new sub-paragraph if it's the first line,
 *  follows a genuine blank line (2+ breaks), or itself begins with a marker
 *  prefix (e.g. "ARTIGOS:"/"SUMULAS:" separated from the preceding citation
 *  by only a single soft Shift+Enter break, not a blank line) - otherwise
 *  it's an ordinary soft-wrapped continuation, joined with a space. */
function splitOnBlankLines(items) {
  const lines = [[]];
  const breaksBefore = [0];
  let pendingBreaks = 0;
  for (const item of items) {
    if (item.type === 'break') {
      pendingBreaks += 1;
    } else {
      if (pendingBreaks > 0) {
        lines.push([]);
        breaksBefore.push(pendingBreaks);
        pendingBreaks = 0;
      }
      if (item.text !== '') lines[lines.length - 1].push(item);
    }
  }

  const paragraphs = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.length) continue;
    const startsNew = i === 0 || breaksBefore[i] >= 2 || MARKER_PREFIX_RE.test(rawConcat(line));
    if (startsNew || !paragraphs.length) {
      paragraphs.push([...line]);
    } else {
      const last = paragraphs[paragraphs.length - 1];
      last.push({ text: ' ', bold: false });
      last.push(...line);
    }
  }
  return paragraphs.filter((p) => p.length && p.some((s) => s.text.trim() !== ''));
}

/** Renders a list of {text,bold} segments to inline HTML, applying native
 *  bold runs and markdown-style **bold** for text that isn't natively bold.
 *  With opts.ignoreNativeBold, native <w:b/> run bold is suppressed and only
 *  explicit **markdown** bold survives - used for JURISPRUDENCIA text, which
 *  is often typed/pasted entirely bold in the source file even though only
 *  the **marked** portions should render bold. */
function segmentsToHtml(segments, opts = {}) {
  const ignoreNativeBold = !!opts.ignoreNativeBold;
  const raw = segments.map((s) => ({ text: s.text, bold: ignoreNativeBold ? false : s.bold }));
  const merged = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && last.bold === s.bold) last.text += s.text;
    else merged.push({ ...s });
  }
  return merged
    .map((s) => {
      const html = applyMarkdownBold(escapeHtml(s.text));
      return s.bold ? `<b>${html}</b>` : html;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyMarkdownBold(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function plainText(segments) {
  return segments.map((s) => s.text).join('').replace(/\s+/g, ' ').trim();
}

/** Real raw tables routinely use merged cells: a grouped label spanning
 *  several rows (<w:vMerge>) - e.g. "STF" next to 4 different competencia
 *  rows - or a wide cell spanning several columns (<w:gridSpan>) - e.g. a
 *  "Conceito" row whose value cell spans what's normally 2 value columns.
 *  Word represents a vertical-merge continuation as its own (empty) <w:tc>
 *  with <w:vMerge> (no w:val, or w:val="continue"); the merge's first cell
 *  carries <w:vMerge w:val="restart">. Cells are returned as
 *  {text,colspan,rowspan} objects - continuation cells are dropped and
 *  instead increment the originating cell's rowspan - so callers can render
 *  real <td colspan rowspan> instead of misaligned ragged rows. */
function parseTable(tblNode) {
  const rows = [];
  const vMergeOrigins = {};
  for (const tr of childrenByName(tblNode, 'w:tr')) {
    const cells = [];
    let colIndex = 0;
    for (const tc of childrenByName(tr, 'w:tc')) {
      const tcPr = childrenByName(tc, 'w:tcPr')[0];
      const gridSpanEl = tcPr && childrenByName(tcPr, 'w:gridSpan')[0];
      const colspan = gridSpanEl ? parseInt(gridSpanEl.getAttribute('w:val'), 10) || 1 : 1;
      const vMergeEl = tcPr && childrenByName(tcPr, 'w:vMerge')[0];
      const vMergeVal = vMergeEl ? vMergeEl.getAttribute('w:val') || 'continue' : null;

      if (vMergeVal === 'continue') {
        const origin = vMergeOrigins[colIndex];
        if (origin) origin.rowspan += 1;
        colIndex += colspan;
        continue;
      }

      const paras = childrenByName(tc, 'w:p').map((p) => splitOnBlankLines(walkParagraphRuns(p)));
      const flatSegs = [];
      for (const subParagraphs of paras) {
        for (const segs of subParagraphs) flatSegs.push(...segs);
      }
      const cell = { text: segmentsToHtml(flatSegs), colspan, rowspan: 1 };
      cells.push(cell);
      if (vMergeVal === 'restart') {
        vMergeOrigins[colIndex] = cell;
      } else {
        delete vMergeOrigins[colIndex];
      }
      colIndex += colspan;
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** Drops zero-length text segments (left behind after stripping a prefix
 *  that consumed an entire segment), so callers never render an empty
 *  <b></b>. */
function dropEmptySegments(segments) {
  return segments.filter((s) => s.text !== '');
}

/** Raw (uncollapsed) concatenation of a sub-paragraph's segment text, used
 *  whenever a regex needs to match across run boundaries. */
function rawConcat(subParagraph) {
  return subParagraph.map((s) => s.text).join('');
}

/** Splits a sub-paragraph's segments at a character offset counted across
 *  the concatenation of ALL its runs (not just the first), so a prefix
 *  match that spans multiple runs still slices cleanly. Google Docs/Word
 *  routinely split a single word like "DICA:" into separate runs after an
 *  edit (e.g. "D" + "ICA: ") - matching only the first run's text, as
 *  earlier versions of this parser did, silently misses those markers. */
function sliceSegmentsAt(subParagraph, offset) {
  let remaining = offset;
  const out = [];
  for (const seg of subParagraph) {
    if (remaining <= 0) {
      out.push(seg);
    } else if (remaining < seg.text.length) {
      out.push({ text: seg.text.slice(remaining), bold: seg.bold });
      remaining = 0;
    } else {
      remaining -= seg.text.length;
    }
  }
  return dropEmptySegments(out);
}

/** Detects a "MARKER: rest" prefix on a sub-paragraph, matching across run
 *  boundaries so a marker split across multiple runs is still recognized,
 *  while keeping bold info on the remainder intact. */
function extractMarker(subParagraph) {
  if (!subParagraph.length) return null;
  const raw = rawConcat(subParagraph);
  const m = MARKER_PREFIX_RE.exec(raw);
  if (!m) return null;
  const marker = Object.keys(m.groups || {}).find((name) => m.groups[name] !== undefined);
  if (!marker) return null;
  const remainder = sliceSegmentsAt(subParagraph, m[0].length);

  if (marker === 'LEI') {
    // The "LEI:" line sometimes carries only a short citation ("Art. 213,
    // CP"), sometimes the whole caput text with the citation folded into
    // it - treating the entire thing as a bold "label" (the old behavior)
    // forced the whole article text bold. Split off just the short
    // citation when present, and let the rest flow as a normal paragraph
    // like the rest of the box, instead of forcing it all bold.
    const split = splitLeiLabel(remainder);
    if (split) {
      return {
        marker,
        inlineText: split.label,
        inlineHtml: split.label,
        extraHtml: split.bodySegments.length ? segmentsToHtml(split.bodySegments) : null,
      };
    }
    return {
      marker,
      inlineText: '',
      inlineHtml: '',
      extraHtml: remainder.length ? segmentsToHtml(remainder) : null,
    };
  }

  // JURISPRUDENCIA text is often pasted entirely bold in the source file;
  // only the **markdown**-marked portions should actually render bold.
  const ignoreNativeBold = marker === 'JURISPRUDENCIA';
  return {
    marker,
    inlineText: plainText(remainder),
    inlineHtml: segmentsToHtml(remainder, { ignoreNativeBold }),
  };
}

/** A .docx downloaded from this app (see docxRenderer.js) tags certain
 *  paragraphs with an invisible Word paragraph style instead of literal
 *  "MARKER:" text, so a round-tripped file (edited in Word, re-uploaded)
 *  is recognized without the user ever seeing marker text. Some of those
 *  paragraphs ALSO carry a human-readable label as real text for
 *  readability (e.g. "ALERTA: ..." or "Gabarito: C") - reusing
 *  extractMarker's own prefix-stripping here, when it happens to match,
 *  keeps regeneration idempotent (no "Gabarito: Gabarito: C" pileup across
 *  repeated edit/reupload cycles) instead of bespoke per-marker regexes. */
function extractStyledMarker(subParagraph, styleMarker) {
  const textMatch = extractMarker(subParagraph);
  if (textMatch && textMatch.marker === styleMarker) return textMatch;

  if (styleMarker === 'LEI') {
    // docxRenderer puts a LEI item's short citation ("Art. 25, CF") alone
    // in its own styled paragraph when one exists, or - when there's no
    // distinct citation - styles the item's first body paragraph directly.
    // Distinguish the two so a bare citation doesn't get misread as body
    // text, and a real caput paragraph doesn't get misread as a citation
    // and forced into the bold label styling (the bug already fixed once
    // for freshly-uploaded raw files - a round-tripped file must not
    // reintroduce it).
    const plain = plainText(subParagraph);
    if (ART_LABEL_ONLY_RE.test(plain)) {
      return { marker: 'LEI', inlineText: plain, inlineHtml: plain };
    }
    const split = splitLeiLabel(subParagraph);
    if (split) {
      return {
        marker: 'LEI',
        inlineText: split.label,
        inlineHtml: split.label,
        extraHtml: split.bodySegments.length ? segmentsToHtml(split.bodySegments) : null,
      };
    }
    return { marker: 'LEI', inlineText: '', inlineHtml: '', extraHtml: plain ? segmentsToHtml(subParagraph) : null };
  }

  const ignoreNativeBold = styleMarker === 'JURISPRUDENCIA';
  return {
    marker: styleMarker,
    inlineText: plainText(subParagraph),
    inlineHtml: segmentsToHtml(subParagraph, { ignoreNativeBold }),
  };
}

/** Strips a leading regex match off the sub-paragraph (matching across run
 *  boundaries), keeping the rest of its bold info intact. Returns null if
 *  the leading text doesn't match. */
function stripLeading(subParagraph, re) {
  if (!subParagraph.length) return null;
  const raw = rawConcat(subParagraph);
  const m = re.exec(raw);
  if (!m) return null;
  return sliceSegmentsAt(subParagraph, m[0].length);
}

/** If the sub-paragraph starts with an "Art. N, SIGLA" style label (a run
 *  typically authored bold, separate from the body run that follows),
 *  splits it into {label, bodySegments}. Operates on the segments (not the
 *  rendered HTML) so bold formatting on the body survives untouched, and
 *  locates the label across run boundaries so a split run doesn't hide it. */
function splitLeiLabel(subParagraph) {
  const plain = plainText(subParagraph);
  const m = ART_LABEL_RE.exec(plain);
  if (!m) return null;
  const [, label] = m;
  const raw = rawConcat(subParagraph);
  const idx = raw.indexOf(label);
  if (idx === -1) return null;
  const bodySegments = sliceSegmentsAt(subParagraph, idx + label.length);
  return { label, bodySegments };
}

/** Recognizes flexible-format cues (emoji-led LEI/ALERTA lines) and
 *  translates them into the same {kind:'marker', ...} shape strict markers
 *  produce, so the rest of the pipeline doesn't need to know which format
 *  a paragraph came from. Returns an array of blocks, or null if no
 *  flexible cue matched. */
function extractFlexibleEmojiBlock(subParagraph) {
  if (!subParagraph.length) return null;
  const firstText = rawConcat(subParagraph);

  if (firstText.trimStart().startsWith('⚖️') || firstText.trimStart().startsWith('⚖')) {
    const remainder = stripLeading(subParagraph, LEI_EMOJI_RE) || subParagraph;
    const split = splitLeiLabel(remainder);
    if (split) {
      const blocks = [{ kind: 'marker', marker: 'LEI', inlineText: split.label, inlineHtml: split.label }];
      if (split.bodySegments.length) blocks.push({ kind: 'text', paragraphs: [segmentsToHtml(split.bodySegments)] });
      return blocks;
    }
    return [{ kind: 'marker', marker: 'LEI', inlineText: 'Base legal', inlineHtml: 'Base legal' },
      { kind: 'text', paragraphs: [segmentsToHtml(remainder)] }];
  }

  if (firstText.trimStart().startsWith('⚠️') || firstText.trimStart().startsWith('⚠')) {
    const remainder = stripLeading(subParagraph, ALERTA_EMOJI_RE) || subParagraph;
    return [{ kind: 'marker', marker: 'ALERTA', inlineHtml: segmentsToHtml(remainder) }];
  }

  return null;
}

/** Translates a heading-level paragraph into the marker shape sectionBuilder
 *  already understands. Headings that aren't a section (level 2), a dica
 *  (level 3), or a questao trigger are treated as a reference-list heading
 *  (e.g. "Artigos que merecem leitura") - the ref-box - since that's what
 *  this heading depth is used for in the flexible format. */
function extractHeadingBlock(subParagraph, level) {
  const text = plainText(subParagraph);
  if (level === 2) {
    return [{ kind: 'marker', marker: 'TITULO_SECAO', inlineText: text }];
  }
  if (level === 3) {
    const remainder = stripLeading(subParagraph, DICA_HEADING_RE);
    const title = remainder ? plainText(remainder) : text;
    return [{ kind: 'marker', marker: 'DICA', inlineText: title || text }];
  }
  if (QUESTAO_HEADING_RE.test(text)) {
    return [{ kind: 'marker', marker: 'QUESTAO', inlineText: text }];
  }
  return [{ kind: 'marker', marker: 'REFERENCIAS', inlineText: text }];
}

/** Parses a .docx buffer into an ordered list of top-level blocks:
 *    { kind: 'marker', marker: 'DICA', inlineText: 'Titulo...', inlineHtml: '...' }
 *    { kind: 'text', paragraphs: ['<b>..</b> texto', 'texto2'], listItem: bool }
 *    { kind: 'table', rows: [['h1','h2'], ['c1','c2']] }
 */
async function parseDocxBlocks(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await loadZipEntry(zip, 'word/document.xml');
  if (!documentXml) throw new Error('Arquivo .docx invalido: word/document.xml nao encontrado.');
  const stylesXml = await loadZipEntry(zip, 'word/styles.xml');
  const headingLevels = buildHeadingLevelMap(stylesXml);
  const gabStyleMap = buildGabStyleMap(stylesXml);

  const doc = new DOMParser().parseFromString(documentXml, 'text/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) throw new Error('Arquivo .docx invalido: <w:body> nao encontrado.');

  const blocks = [];
  // Tracks the marker most recently opened (by a strict MARKER: prefix, a
  // heading, or a flexible emoji cue), so plain-text sub-paragraphs that
  // follow it in the same or later paragraphs know what visual context
  // they're continuing - specifically, whether native bold should be
  // ignored for JURISPRUDENCIA continuation text (see segmentsToHtml).
  let currentMarker = null;

  /** Runs the same marker/flexible-cue detection used on a paragraph's first
   *  sub-paragraph on ANY sub-paragraph, so a marker separated from prior
   *  content by only a single soft break (not a blank line) - e.g. ARTIGOS:/
   *  SUMULAS: right after a JURISPRUDENCIA citation - is still recognized,
   *  instead of being silently absorbed as plain continuation text. */
  const pushSubParagraph = (sub, isListItem) => {
    const markerInfo = extractMarker(sub);
    if (markerInfo) {
      const { extraHtml, ...marker } = markerInfo;
      blocks.push({ kind: 'marker', ...marker });
      currentMarker = marker.marker;
      if (extraHtml) blocks.push({ kind: 'text', paragraphs: [extraHtml] });
      return;
    }
    const flexBlocks = extractFlexibleEmojiBlock(sub);
    if (flexBlocks) {
      blocks.push(...flexBlocks);
      const lastMarker = [...flexBlocks].reverse().find((b) => b.kind === 'marker');
      if (lastMarker) currentMarker = lastMarker.marker;
      return;
    }
    const ignoreNativeBold = currentMarker === 'JURISPRUDENCIA';
    blocks.push({ kind: 'text', paragraphs: [segmentsToHtml(sub, { ignoreNativeBold })], listItem: isListItem });
  };

  const nodes = Array.from(body.childNodes);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.nodeName === 'w:p') {
      const items = walkParagraphRuns(node);
      const subParagraphs = splitOnBlankLines(items);
      if (!subParagraphs.length) continue;

      // A .docx downloaded from this app (see docxRenderer.js/
      // roundTripStyles.js) tags certain paragraphs with an invisible Word
      // style instead of "MARKER:" text - checked first, ahead of every
      // other detection path, since it's an unambiguous, deliberately
      // placed signal rather than a heuristic guess.
      const styleMarker = gabStyleMap.get(getParagraphStyleId(node));
      if (styleMarker) {
        const markerInfo = extractStyledMarker(subParagraphs[0], styleMarker);
        const { extraHtml, ...marker } = markerInfo;
        blocks.push({ kind: 'marker', ...marker });
        currentMarker = marker.marker;
        if (extraHtml) blocks.push({ kind: 'text', paragraphs: [extraHtml] });
        for (const extra of subParagraphs.slice(1)) pushSubParagraph(extra, paragraphIsListItem(node));
        continue;
      }

      // A single fully-bold paragraph immediately before a table is that
      // table's caption in the "flexible" Markdown-sourced format (e.g.
      // pandoc renders a Markdown table's preceding bold line this way).
      // Captured as its own block instead of leaking into whatever block
      // happens to be open, so sectionBuilder can attach it to the table.
      const nextIsTable = nodes[i + 1] && nodes[i + 1].nodeName === 'w:tbl';
      if (nextIsTable && subParagraphs.length === 1 && subParagraphs[0].every((s) => s.bold)) {
        blocks.push({ kind: 'table-caption', html: segmentsToHtml(subParagraphs[0]) });
        continue;
      }

      const headingLevel = paragraphHeadingLevel(node, headingLevels);
      const isListItem = paragraphIsListItem(node);

      if (headingLevel) {
        const headingBlocks = extractHeadingBlock(subParagraphs[0], headingLevel);
        blocks.push(...headingBlocks);
        const lastMarker = [...headingBlocks].reverse().find((b) => b.kind === 'marker');
        if (lastMarker) currentMarker = lastMarker.marker;
        for (const extra of subParagraphs.slice(1)) pushSubParagraph(extra, isListItem);
        continue;
      }

      for (const sub of subParagraphs) pushSubParagraph(sub, isListItem);
    } else if (node.nodeName === 'w:tbl') {
      const rows = parseTable(node);
      if (rows.length) blocks.push({ kind: 'table', rows });
      currentMarker = null;
    }
  }
  return blocks;
}

module.exports = { parseDocxBlocks, MARKERS };
