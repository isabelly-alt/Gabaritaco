'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');

// This container ships a pre-installed Chromium at this path; a normal local
// install (after `npm run setup-browser`) uses Playwright's own managed
// browser instead, so only override the executable when the fixed path exists.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

async function htmlToPdfBuffer(html) {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    // 'networkidle' fires once the Google Fonts stylesheet has downloaded,
    // but not once the Poppins font FILE it references has actually been
    // decoded and swapped in - printing before that leaves the PDF on the
    // browser's default fallback font. document.fonts.ready is the actual
    // signal for "fonts are ready to render with".
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

const A4_WIDTH = 595.28; // pt
const A4_HEIGHT = 841.89; // pt

async function coverToPdfDoc(coverPath) {
  const ext = path.extname(coverPath).toLowerCase();
  const bytes = fs.readFileSync(coverPath);
  if (ext === '.pdf') {
    return PDFDocument.load(bytes);
  }
  const doc = await PDFDocument.create();
  const image = ext === '.png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  const scale = Math.min(A4_WIDTH / image.width, A4_HEIGHT / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, { x: (A4_WIDTH - w) / 2, y: (A4_HEIGHT - h) / 2, width: w, height: h });
  return doc;
}

/**
 * Builds the final PDF for a materia: optional cover pages, then the
 * rendered content pages. Returns a Buffer.
 */
async function buildMateriaPdf(html, coverPath) {
  const contentBytes = await htmlToPdfBuffer(html);
  if (!coverPath) return Buffer.from(contentBytes);

  const finalDoc = await PDFDocument.create();
  const coverDoc = await coverToPdfDoc(coverPath);
  const coverPages = await finalDoc.copyPages(coverDoc, coverDoc.getPageIndices());
  coverPages.forEach((p) => finalDoc.addPage(p));

  const contentDoc = await PDFDocument.load(contentBytes);
  const contentPages = await finalDoc.copyPages(contentDoc, contentDoc.getPageIndices());
  contentPages.forEach((p) => finalDoc.addPage(p));

  return Buffer.from(await finalDoc.save());
}

module.exports = { buildMateriaPdf };
