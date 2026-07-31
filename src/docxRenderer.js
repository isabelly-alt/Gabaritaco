'use strict';

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  ShadingType,
  BorderStyle,
  VerticalAlign,
  Header,
  Footer,
  SectionType,
} = require('docx');

const { MARKER_STYLE_IDS } = require('./roundTripStyles');

// Mirrors the color palette used in templateRenderer.js's CSS, so the
// generated .docx reads as the same design in Word - just editable.
const COLORS = {
  purple: '4C1D95',
  yellow: 'FFD23F',
  yellowText: '2A1155',
  lilacBg: 'EFE9FC',
  lilacText: '4C1D95',
  alertaBg: 'FEF6E4',
  alertaText: '7A4B00',
  comentarioBg: 'E7F0FE',
  comentarioTagBg: '1D4ED8',
  comentarioText: '1E3A8A',
  questaoBg: 'F7F5FC',
  white: 'FFFFFF',
  gray: '6B7280',
  dark: '111827',
};

// Same font family as the PDF (embedded as base64 @font-face there - Word
// has no equivalent of that, so this just names the font; it renders
// correctly if Poppins is installed locally and otherwise falls back to
// Word's default substitute while keeping the name tagged).
const FONT = 'Poppins';

// Matches the PDF's CSS page geometry (--margin-top/bottom: 0.9cm,
// --margin-left/right: 0.65in) and column-gap: 36px, converted to twips
// (1440 twips/inch; 1cm = 566.9 twips; 1px = 15 twips at 96dpi).
const PAGE = { width: 11906, height: 16838 };
const MARGIN = { top: 510, bottom: 510, left: 720, right: 720 };
const COLUMN_GAP = 540;

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'D9D2EF' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9D2EF' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'D9D2EF' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'D9D2EF' },
};

// Passed to both a Table (which also recognizes insideHorizontal/
// insideVertical, to kill the default grid line Word draws between rows)
// and a TableCell (which only reads the four outer sides and ignores the
// rest) - see renderMapaMentalItem.
const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

// Mirrors the palette defined in assets/style.css (same hex values, without
// the leading '#' - the docx library's own color format) - the Word table
// can't consume that CSS file, so the cycle is just index % length here
// instead of the CSS's :nth-of-type selectors.
const MAPA_MENTAL_COLORS = ['5A009F', '1D4E89', '0B7A57', 'C77800', 'A6178A'];

// "Boxes" (.lei-box/.juris-box/.alerta-box/etc. in the PDF) are simulated
// with shaded, indented paragraphs rather than a shaded table cell -
// docxParser.js (see roundTripStyles.js) only scans TOP-LEVEL body
// paragraphs for its round-trip marker styles, the same as it only scans
// top-level paragraphs for "MARKER:" text in a raw file; a style tucked
// inside a table cell would be invisible to it. Consecutive same-color
// paragraphs render as one continuous band in Word, and the indent plus
// extra spacing on the first/last paragraph approximates the padded card
// look without needing a table at all.
const BOX_INDENT = { left: 200, right: 200 };
function renderBox(specs, fill) {
  return specs.map((spec, i) => {
    const spacing = { ...(spec.spacing || {}) };
    if (spacing.after === undefined) spacing.after = 0;
    if (i === 0) spacing.before = (spacing.before || 0) + 160;
    if (i === specs.length - 1) spacing.after += 160;
    return new Paragraph({
      ...spec,
      indent: BOX_INDENT,
      shading: { fill, type: ShadingType.CLEAR, color: 'auto' },
      spacing,
    });
  });
}

function run(props) {
  return new TextRun({ font: FONT, ...props });
}

function unescapeHtml(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Splits our internal mini-HTML (only ever produces <b>...</b> plus
 *  escaped entities - see docxParser's segmentsToHtml/escapeHtml) into
 *  {text,bold} runs for TextRun generation. */
function htmlToRunParts(html) {
  if (!html) return [];
  const parts = [];
  const re = /<b>([\s\S]*?)<\/b>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m.index > last) parts.push({ text: unescapeHtml(html.slice(last, m.index)), bold: false });
    parts.push({ text: unescapeHtml(m[1]), bold: true });
    last = re.lastIndex;
  }
  if (last < html.length) parts.push({ text: unescapeHtml(html.slice(last)), bold: false });
  return parts.filter((p) => p.text !== '');
}

function runs(html, extra = {}) {
  const parts = htmlToRunParts(html);
  if (!parts.length) return [run({ text: '', ...extra })];
  return parts.map((p) => run({ text: p.text, bold: p.bold, ...extra }));
}

/** Same as runs(), but re-emits bold spans as literal **text** instead of
 *  real native-bold formatting. Only used for JURISPRUDENCIA body text:
 *  docxParser.js deliberately ignores NATIVE bold there (to counteract
 *  citations pasted pre-bold in raw files) while still honoring
 *  **markdown** bold - so writing real native bold here would look
 *  identical, on re-upload, to that "pasted pre-bold" case and get
 *  silently stripped. Keeping it as literal asterisks survives the round
 *  trip (parsed back via markdown, not native-bold, detection). */
function markdownRuns(html, extra = {}) {
  const parts = htmlToRunParts(html).map((p) => (p.bold ? { text: `**${p.text}**`, bold: false } : p));
  if (!parts.length) return [run({ text: '', ...extra })];
  return parts.map((p) => run({ text: p.text, bold: false, ...extra }));
}

/** Plain paragraph-options object (not yet a Paragraph instance) so box
 *  content can be built once and re-shaded/re-indented uniformly by
 *  renderBox - see the comment there. */
function bodySpec(html, extra = {}) {
  return {
    children: (extra.markdown ? markdownRuns : runs)(html, extra.run),
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120 },
    ...extra.paragraph,
  };
}

function bodyPara(html, extra = {}) {
  return new Paragraph(bodySpec(html, extra));
}

function spacer(after = 200) {
  return new Paragraph({ text: '', spacing: { after } });
}

function sectionBand(titulo) {
  return new Paragraph({
    style: MARKER_STYLE_IDS.TITULO_SECAO,
    shading: { fill: COLORS.purple, type: ShadingType.CLEAR, color: 'auto' },
    indent: BOX_INDENT,
    spacing: { before: 160, after: 160 },
    children: [run({ text: titulo, bold: true, color: COLORS.white, size: 28 })],
  });
}

function renderTableCell(cellText, opts = {}) {
  return new TableCell({
    columnSpan: cellText.colspan > 1 ? cellText.colspan : undefined,
    rowSpan: cellText.rowspan > 1 ? cellText.rowspan : undefined,
    shading: opts.headerFill ? { fill: opts.headerFill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    borders: CELL_BORDERS,
    children: [
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: runs(cellText.text, opts.headerFill ? { color: COLORS.white, bold: true } : {}),
      }),
    ],
  });
}

function renderTabelaItem(item) {
  const blocks = [];
  if (item.caption) {
    blocks.push(new Paragraph({ children: runs(item.caption, { bold: true }), spacing: { after: 80 } }));
  }
  const rows = [];
  if (item.headers.length) {
    rows.push(new TableRow({ tableHeader: true, children: item.headers.map((h) => renderTableCell(h, { headerFill: COLORS.purple })) }));
  }
  for (const row of item.rows) {
    rows.push(new TableRow({ children: row.map((c) => renderTableCell(c)) }));
  }
  blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
  blocks.push(spacer());
  return blocks;
}

function renderQuestaoItem(item) {
  const specs = [
    {
      style: MARKER_STYLE_IDS.QUESTAO,
      children: [
        run({
          text: item.titulo.toUpperCase(),
          bold: true,
          color: COLORS.white,
          size: 16,
          shading: { fill: COLORS.purple, type: ShadingType.CLEAR, color: 'auto' },
        }),
      ],
      spacing: { after: 100 },
    },
  ];
  item.enunciado.forEach((p, i) => {
    specs.push(bodySpec(p, { run: { color: COLORS.dark }, paragraph: i === 0 ? { style: MARKER_STYLE_IDS.ENUNCIADO } : {} }));
  });
  for (const opt of item.opcoes) {
    specs.push(bodySpec(opt, { run: { color: COLORS.dark }, paragraph: { spacing: { after: 60 } } }));
  }
  if (item.gabarito) {
    specs.push({
      style: MARKER_STYLE_IDS.GABARITO,
      children: [run({ text: `Gabarito: ${item.gabarito}`, bold: true, color: COLORS.purple })],
      spacing: { after: 80 },
    });
  }
  if (item.comentarios.length) {
    specs.push({ children: [run({ text: 'Comentários:', bold: true, color: COLORS.dark })], spacing: { after: 40 } });
    item.comentarios.forEach((c, i) => {
      specs.push(bodySpec(c, { run: { color: COLORS.dark }, paragraph: i === 0 ? { style: MARKER_STYLE_IDS.COMENTARIOS } : {} }));
    });
  }
  return [...renderBox(specs, COLORS.questaoBg), spacer()];
}

/** Renders a MAPA_MENTAL item as a borderless table, one branch per row
 *  (row height follows the cell's own content, same as any Word table row) -
 *  see references/sintaxe.md. The optional title sits above the table as its
 *  own paragraph, since the table itself is one row per branch only. */
function renderMapaMentalItem(item) {
  const blocks = [];
  if (item.titulo) {
    blocks.push(
      new Paragraph({
        style: MARKER_STYLE_IDS.MAPA_MENTAL,
        children: [run({ text: item.titulo, bold: true, color: COLORS.purple, size: 22 })],
        spacing: { after: 120 },
      })
    );
  }
  const rows = item.ramos.map((ramo, i) => {
    const color = MAPA_MENTAL_COLORS[i % MAPA_MENTAL_COLORS.length];
    return new TableRow({
      children: [
        new TableCell({
          borders: NO_BORDERS,
          margins: { top: 40, bottom: 60, left: 0, right: 0 },
          children: [
            new Paragraph({ children: runs(ramo.nome, { bold: true, color }), spacing: { after: 40 } }),
            ...ramo.textos.map((t) => new Paragraph({ ...bodySpec(t, { run: { color: COLORS.dark } }), spacing: { after: 40 } })),
          ],
        }),
      ],
    });
  });
  if (rows.length) blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, rows }));
  blocks.push(spacer());
  return blocks;
}

function renderItem(item) {
  if (item.type === 'dica') {
    // No "DICA NN" badge baked into the title text: it's re-derived
    // automatically on every parse (dicaCounter increments fresh per
    // TITULO_SECAO), so storing it here would only risk piling up
    // ("DICA 01 DICA 01 ...") across repeated edit/reupload cycles for no
    // benefit.
    const blocks = [
      new Paragraph({
        style: MARKER_STYLE_IDS.DICA,
        children: [run({ text: item.titulo, bold: true, color: COLORS.purple, size: 26 })],
        spacing: { after: 100 },
      }),
    ];
    for (const p of item.paragrafos) blocks.push(bodyPara(p));
    blocks.push(spacer());
    return blocks;
  }
  if (item.type === 'lei') {
    const specs = [];
    if (item.label) {
      specs.push({
        style: MARKER_STYLE_IDS.LEI,
        children: [run({ text: item.label, bold: true, color: COLORS.purple, size: 18 })],
        spacing: { after: 60 },
      });
      for (const p of item.paragrafos) specs.push(bodySpec(p, { run: { color: COLORS.lilacText } }));
    } else {
      item.paragrafos.forEach((p, i) => {
        specs.push(bodySpec(p, { run: { color: COLORS.lilacText }, paragraph: i === 0 ? { style: MARKER_STYLE_IDS.LEI } : {} }));
      });
    }
    return [...renderBox(specs, COLORS.lilacBg), spacer()];
  }
  if (item.type === 'jurisprudencia') {
    const specs = item.paragrafos.map((p, i) =>
      bodySpec(p, { run: { color: COLORS.lilacText }, paragraph: i === 0 ? { style: MARKER_STYLE_IDS.JURISPRUDENCIA } : {}, markdown: true })
    );
    return [...renderBox(specs, COLORS.lilacBg), spacer()];
  }
  if (item.type === 'nota') {
    // Styling the first paragraph gives this trailing commentary its own
    // recognizable marker on re-upload - without it, this content has no
    // signal distinguishing it from the jurisprudencia box that precedes
    // it, and a round trip would silently fold it back inside that box
    // (undoing the "closed citation exits the lilac box" behavior).
    return [
      ...item.paragrafos.map((p, i) => bodyPara(p, { paragraph: i === 0 ? { style: MARKER_STYLE_IDS.NOTA } : {} })),
      spacer(),
    ];
  }
  if (item.type === 'comentario_artigo') {
    const specs = item.paragrafos.map((p, i) => {
      if (i === 0) {
        return {
          style: MARKER_STYLE_IDS.COMENTARIO_ARTIGO,
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 120 },
          children: [run({ text: 'Comentário ao artigo: ', bold: true, color: COLORS.comentarioTagBg }), ...runs(p, { color: COLORS.comentarioText })],
        };
      }
      return bodySpec(p, { run: { color: COLORS.comentarioText } });
    });
    return [...renderBox(specs, COLORS.comentarioBg), spacer()];
  }
  if (item.type === 'alerta') {
    const specs = item.paragrafos.map((p, i) => {
      if (i === 0) {
        return {
          style: MARKER_STYLE_IDS.ALERTA,
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 120 },
          children: [run({ text: 'ALERTA: ', bold: true, color: COLORS.alertaText }), ...runs(p, { color: COLORS.alertaText })],
        };
      }
      return bodySpec(p, { run: { color: COLORS.alertaText } });
    });
    return [...renderBox(specs, COLORS.alertaBg), spacer()];
  }
  if (item.type === 'referencias') {
    const specs = [
      {
        style: MARKER_STYLE_IDS.REFERENCIAS,
        children: [run({ text: item.label, bold: true, color: COLORS.purple, size: 18 })],
        spacing: { after: 60 },
      },
    ];
    for (const p of item.paragrafos) {
      specs.push({ bullet: { level: 0 }, children: runs(p, { color: COLORS.lilacText }) });
    }
    return [...renderBox(specs, COLORS.lilacBg), spacer()];
  }
  if (item.type === 'tabela') return renderTabelaItem(item);
  if (item.type === 'questao') return renderQuestaoItem(item);
  if (item.type === 'mapa_mental') return renderMapaMentalItem(item);
  return [];
}

function buildHeader() {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          run({ text: 'GABARITAÇO', bold: true, color: COLORS.white, size: 24 }),
          run({ text: '  –  ', color: 'D9C7FF', size: 24 }),
          run({ text: 'VDE CONCURSOS', bold: true, color: COLORS.yellow, size: 22 }),
        ],
        shading: { fill: COLORS.purple, type: ShadingType.CLEAR, color: 'auto' },
        spacing: { before: 100, after: 100 },
      }),
    ],
  });
}

function buildFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [run({ text: '@vdeconcursos', bold: true, color: COLORS.white, size: 17 })],
        shading: { fill: COLORS.purple, type: ShadingType.CLEAR, color: 'auto' },
        spacing: { before: 80, after: 80 },
      }),
    ],
  });
}

function singleColumnProps(sectionType) {
  return { page: { size: PAGE, margin: MARGIN }, column: { count: 1 }, type: sectionType };
}
function twoColumnProps() {
  return { page: { size: PAGE, margin: MARGIN }, column: { count: 2, space: COLUMN_GAP, equalWidth: true }, type: SectionType.CONTINUOUS };
}

/**
 * Renders a full editable .docx for one materia, mirroring the same visual
 * language as templateRenderer.js's PDF (colors, boxes, tags, 2-column
 * layout, Poppins) using real Word paragraphs/tables/shading/section
 * columns, so the user can open it in Word and correct anything without
 * going through another round-trip.
 *
 * Word can't span an element across both columns of a multi-column
 * section (unlike CSS column-span:all), so each TITULO_SECAO's purple band
 * gets its own single-column section (continuous, no page break, except
 * the very first) immediately followed by a two-column continuous section
 * for that section's items - mirroring the PDF's "matter-band spans full
 * width, break-before:page on every band except the first" rule via real
 * Word section breaks instead.
 */
function renderDocumentDocx(materia) {
  const title = (materia.disciplina || '').toUpperCase() || 'MATÉRIA';
  const titleChildren = [
    new Paragraph({
      style: MARKER_STYLE_IDS.DISCIPLINA,
      alignment: AlignmentType.CENTER,
      children: [run({ text: title, bold: true, color: COLORS.purple, size: 44 })],
      spacing: { after: materia.subtitulo ? 60 : 260 },
    }),
  ];
  if (materia.subtitulo) {
    titleChildren.push(
      new Paragraph({
        style: MARKER_STYLE_IDS.SUBTITULO,
        alignment: AlignmentType.CENTER,
        children: [run({ text: materia.subtitulo, color: COLORS.gray, size: 22 })],
        spacing: { after: 260 },
      })
    );
  }

  const docxSections = [];
  materia.sections.forEach((section, i) => {
    const bandChildren = i === 0 ? titleChildren : [];
    bandChildren.push(sectionBand(section.titulo), spacer());
    // Matches the PDF's `.matter-band{break-before:page}`: every band -
    // including the first, which just opens the document - starts a fresh
    // page/section.
    docxSections.push({
      properties: singleColumnProps(SectionType.NEXT_PAGE),
      headers: { default: buildHeader() },
      footers: { default: buildFooter() },
      children: bandChildren,
    });

    const itemChildren = [];
    for (const item of section.items) itemChildren.push(...renderItem(item));
    docxSections.push({
      properties: twoColumnProps(),
      headers: { default: buildHeader() },
      footers: { default: buildFooter() },
      children: itemChildren.length ? itemChildren : [spacer(0)],
    });
  });

  if (!docxSections.length) {
    docxSections.push({
      properties: singleColumnProps(SectionType.NEXT_PAGE),
      headers: { default: buildHeader() },
      footers: { default: buildFooter() },
      children: titleChildren,
    });
  }

  const doc = new Document({
    // Registers the round-trip style IDs so paragraphs referencing them
    // (via `style:`) are valid - the styles carry no visual formatting of
    // their own (each paragraph already styles its own runs directly) and
    // are hidden from Word's style gallery, since they exist purely as a
    // marker docxParser.js can read back on re-upload.
    styles: {
      paragraphStyles: Object.entries(MARKER_STYLE_IDS).map(([marker, id]) => ({
        id,
        name: `Gabaritaço ${marker}`,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: false,
        semiHidden: true,
        unhideWhenUsed: false,
      })),
    },
    sections: docxSections,
  });
  return Packer.toBuffer(doc);
}

module.exports = { renderDocumentDocx };
