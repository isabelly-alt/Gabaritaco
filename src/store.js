'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parseDocxBlocks } = require('./docxParser');
const { buildSections } = require('./sectionBuilder');
const { renderDocumentHtml } = require('./templateRenderer');
const { buildMateriaPdf } = require('./pdfRenderer');
const { renderDocumentDocx } = require('./docxRenderer');

const DATA_DIR = path.join(__dirname, '..', 'data');

function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'materia';
}

function materiaDir(slug) {
  return path.join(DATA_DIR, slug);
}
function sectionsDir(slug) {
  return path.join(materiaDir(slug), 'sections');
}
function metaPath(slug) {
  return path.join(materiaDir(slug), 'meta.json');
}
function outputPath(slug) {
  return path.join(materiaDir(slug), 'output.pdf');
}
function outputDocxPath(slug) {
  return path.join(materiaDir(slug), 'output.docx');
}

function ensureDirs(slug) {
  fs.mkdirSync(sectionsDir(slug), { recursive: true });
}

function readMeta(slug) {
  const p = metaPath(slug);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeMeta(slug, meta) {
  fs.writeFileSync(metaPath(slug), JSON.stringify(meta, null, 2));
}

function listMaterias() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readMeta(d.name))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function getMateria(slug) {
  return readMeta(slug);
}

/** Peeks a raw .docx buffer's DISCIPLINA: field, without persisting anything. */
async function peekDisciplina(buffer) {
  const blocks = await parseDocxBlocks(buffer);
  const { disciplina } = buildSections(blocks);
  return disciplina;
}

async function addSectionFile(originalFilename, buffer) {
  const disciplina = await peekDisciplina(buffer);
  if (!disciplina) {
    throw new Error(
      'Não encontrei o campo "DISCIPLINA:" no início do arquivo. Todo arquivo bruto precisa começar com "DISCIPLINA: Nome da Matéria" para que eu saiba a qual matéria ele pertence.'
    );
  }
  const slug = slugify(disciplina);
  ensureDirs(slug);

  let meta = readMeta(slug);
  if (!meta) {
    meta = { slug, name: disciplina, sections: [], cover: null, generatedAt: null };
  }

  const id = crypto.randomUUID();
  const storedAs = `${id}.docx`;
  fs.writeFileSync(path.join(sectionsDir(slug), storedAs), buffer);
  meta.sections.push({ id, filename: originalFilename, storedAs, uploadedAt: new Date().toISOString() });
  writeMeta(slug, meta);

  await regenerate(slug);
  return slug;
}

async function removeSection(slug, sectionId) {
  const meta = readMeta(slug);
  if (!meta) throw new Error('Matéria não encontrada.');
  const idx = meta.sections.findIndex((s) => s.id === sectionId);
  if (idx === -1) throw new Error('Arquivo não encontrado.');
  const [removed] = meta.sections.splice(idx, 1);
  const filePath = path.join(sectionsDir(slug), removed.storedAs);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  writeMeta(slug, meta);
  if (meta.sections.length) await regenerate(slug);
  else {
    if (fs.existsSync(outputPath(slug))) fs.unlinkSync(outputPath(slug));
    if (fs.existsSync(outputDocxPath(slug))) fs.unlinkSync(outputDocxPath(slug));
    meta.generatedAt = null;
    writeMeta(slug, meta);
  }
}

async function setCover(slug, buffer, ext) {
  const meta = readMeta(slug);
  if (!meta) throw new Error('Matéria não encontrada.');
  if (meta.cover) {
    const old = path.join(materiaDir(slug), meta.cover.storedAs);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  const storedAs = `cover${ext}`;
  fs.writeFileSync(path.join(materiaDir(slug), storedAs), buffer);
  meta.cover = { storedAs, uploadedAt: new Date().toISOString() };
  writeMeta(slug, meta);
  if (meta.sections.length) await regenerate(slug);
}

async function removeCover(slug) {
  const meta = readMeta(slug);
  if (!meta || !meta.cover) return;
  const old = path.join(materiaDir(slug), meta.cover.storedAs);
  if (fs.existsSync(old)) fs.unlinkSync(old);
  meta.cover = null;
  writeMeta(slug, meta);
  if (meta.sections.length) await regenerate(slug);
}

async function deleteMateria(slug) {
  const dir = materiaDir(slug);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/** Re-parses every uploaded .docx of a materia (in upload order) and
 *  rebuilds the combined PDF. Sections from later files continue to append
 *  after earlier files' sections; DICA numbering restarts per TITULO_SECAO
 *  regardless of which file it came from. */
async function regenerate(slug) {
  const meta = readMeta(slug);
  if (!meta || !meta.sections.length) return;

  let disciplina = meta.name;
  let subtitulo = '';
  const allSections = [];
  for (const s of meta.sections) {
    const buffer = fs.readFileSync(path.join(sectionsDir(slug), s.storedAs));
    const blocks = await parseDocxBlocks(buffer);
    const parsed = buildSections(blocks);
    if (parsed.disciplina) disciplina = parsed.disciplina;
    if (parsed.subtitulo) subtitulo = parsed.subtitulo;
    allSections.push(...parsed.sections);
  }

  const html = renderDocumentHtml({ disciplina, subtitulo, sections: allSections });
  const coverPath = meta.cover ? path.join(materiaDir(slug), meta.cover.storedAs) : null;
  const pdfBuffer = await buildMateriaPdf(html, coverPath);
  fs.writeFileSync(outputPath(slug), pdfBuffer);

  const docxBuffer = await renderDocumentDocx({ disciplina, subtitulo, sections: allSections });
  fs.writeFileSync(outputDocxPath(slug), docxBuffer);

  meta.name = disciplina;
  meta.generatedAt = new Date().toISOString();
  writeMeta(slug, meta);
}

module.exports = {
  DATA_DIR,
  slugify,
  listMaterias,
  getMateria,
  addSectionFile,
  removeSection,
  setCover,
  removeCover,
  deleteMateria,
  regenerate,
  outputPath,
  outputDocxPath,
  sectionsDir,
  materiaDir,
};
