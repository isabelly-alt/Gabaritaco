'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const store = require('./src/store');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/materias', (req, res) => {
  res.json(store.listMaterias());
});

app.get('/api/materias/:slug', (req, res) => {
  const materia = store.getMateria(req.params.slug);
  if (!materia) return res.status(404).json({ error: 'Matéria não encontrada.' });
  res.json(materia);
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  if (!req.file.originalname.toLowerCase().endsWith('.docx')) {
    return res.status(400).json({ error: 'Envie um arquivo .docx.' });
  }
  try {
    const slug = await store.addSectionFile(req.file.originalname, req.file.buffer);
    res.json(store.getMateria(slug));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/materias/:slug/sections/:id', async (req, res) => {
  try {
    await store.removeSection(req.params.slug, req.params.id);
    res.json(store.getMateria(req.params.slug) || { deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const COVER_EXT_BY_MIME = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

app.post('/api/materias/:slug/cover', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const ext = COVER_EXT_BY_MIME[req.file.mimetype];
  if (!ext) return res.status(400).json({ error: 'A capa precisa ser PDF, PNG ou JPG.' });
  try {
    await store.setCover(req.params.slug, req.file.buffer, ext);
    res.json(store.getMateria(req.params.slug));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/materias/:slug/cover', async (req, res) => {
  try {
    await store.removeCover(req.params.slug);
    res.json(store.getMateria(req.params.slug));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/materias/:slug', async (req, res) => {
  await store.deleteMateria(req.params.slug);
  res.json({ deleted: true });
});

app.get('/api/materias/:slug/pdf', async (req, res) => {
  const materia = store.getMateria(req.params.slug);
  if (!materia || !materia.sections.length) {
    return res.status(404).json({ error: 'PDF ainda não gerado para esta matéria.' });
  }
  try {
    // Always rebuild before serving, so a code/template update (or a hand
    // edit to a stored .docx) is reflected immediately - the download
    // never serves a stale PDF left over from before the last change.
    await store.regenerate(req.params.slug);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  const filePath = store.outputPath(req.params.slug);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'PDF não encontrado.' });
  res.download(filePath, `${materia.name}.pdf`);
});

app.get('/api/materias/:slug/docx', async (req, res) => {
  const materia = store.getMateria(req.params.slug);
  if (!materia || !materia.sections.length) {
    return res.status(404).json({ error: 'DOCX ainda não gerado para esta matéria.' });
  }
  try {
    // Same reasoning as the PDF route: always rebuild before serving, so
    // the download reflects the latest stored .docx sections/code.
    await store.regenerate(req.params.slug);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  const filePath = store.outputDocxPath(req.params.slug);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'DOCX não encontrado.' });
  res.download(filePath, `${materia.name}.docx`);
});

const PORT = process.env.PORT || 4173;
app.listen(PORT, () => {
  console.log(`Gabaritaço formatter rodando em http://localhost:${PORT}`);
});
