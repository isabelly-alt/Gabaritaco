'use strict';

// Paragraph style NAME prefix docxRenderer.js stamps on certain paragraphs
// so a downloaded, user-edited .docx can be re-uploaded and parsed back
// into the same structure. Word rewrites the internal <w:styleId> to a
// value it derives itself (stripping accents/spaces from the style's
// display name) EVERY time it resaves a .docx - confirmed against a real
// file a user edited and reuploaded, where "GabDisciplina" came back as
// "GabaritaoDISCIPLINA" - so docxParser.js can't rely on a fixed ID string
// surviving a real edit. It CAN rely on the style's human-readable
// <w:name>, since Word only uses that to derive a fresh ID - it doesn't
// alter the name. Recognition therefore happens by reading styles.xml
// per-document and resolving whatever ID currently maps to
// "Gabaritaço <MARKER>", the same way heading-level detection already
// resolves whatever ID maps to a given <w:outlineLvl> rather than
// hardcoding Word's own "Heading 2" style ID.
const MARKER_NAMES = [
  'DISCIPLINA',
  'SUBTITULO',
  'TITULO_SECAO',
  'DICA',
  'LEI',
  'JURISPRUDENCIA',
  'ALERTA',
  'COMENTARIO_ARTIGO',
  'REFERENCIAS',
  'QUESTAO',
  'ENUNCIADO',
  'GABARITO',
  'COMENTARIOS',
  'NOTA',
];

const STYLE_NAME_PREFIX = 'Gabaritaço ';

function styleNameFor(marker) {
  return `${STYLE_NAME_PREFIX}${marker}`;
}

// A stable-enough ID for docxRenderer.js to declare/reference within the
// file it generates. Irrelevant once Word resaves the file - reading
// always resolves by style NAME, never by this ID.
const MARKER_STYLE_IDS = Object.fromEntries(MARKER_NAMES.map((m) => [m, `Gab${m.replace(/_/g, '')}`]));

module.exports = { MARKER_NAMES, MARKER_STYLE_IDS, STYLE_NAME_PREFIX, styleNameFor };
