'use strict';

const toast = document.getElementById('toast');
const materiasList = document.getElementById('materias-list');
const emptyState = document.getElementById('empty-state');
const cardTemplate = document.getElementById('materia-card-template');

function showToast(message, type) {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 5000);
}

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('pt-BR');
}

async function apiRequest(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Erro inesperado.');
  return body;
}

async function uploadDocx(file, onDone) {
  const form = new FormData();
  form.append('file', file);
  try {
    showToast(`Processando "${file.name}"…`, 'success');
    const materia = await apiRequest('/api/upload', { method: 'POST', body: form });
    showToast(`"${file.name}" adicionado à matéria "${materia.name}".`, 'success');
    await refresh();
    if (onDone) onDone(materia);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function uploadCover(slug, file) {
  const form = new FormData();
  form.append('file', file);
  try {
    await apiRequest(`/api/materias/${slug}/cover`, { method: 'POST', body: form });
    showToast('Capa atualizada.', 'success');
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function removeCover(slug) {
  try {
    await apiRequest(`/api/materias/${slug}/cover`, { method: 'DELETE' });
    showToast('Capa removida.', 'success');
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function removeSection(slug, id) {
  try {
    await apiRequest(`/api/materias/${slug}/sections/${id}`, { method: 'DELETE' });
    showToast('Arquivo removido.', 'success');
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function removeMateria(slug, name) {
  if (!confirm(`Excluir a matéria "${name}" e todos os arquivos enviados? Essa ação não pode ser desfeita.`)) return;
  try {
    await apiRequest(`/api/materias/${slug}`, { method: 'DELETE' });
    showToast('Matéria excluída.', 'success');
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderMateriaCard(materia) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);

  node.querySelector('.materia-name').textContent = materia.name;

  const status = node.querySelector('.materia-status');
  status.textContent = materia.generatedAt
    ? `PDF e DOCX gerados em ${formatDate(materia.generatedAt)} · ${materia.sections.length} arquivo(s)`
    : `Nenhum PDF/DOCX gerado ainda · ${materia.sections.length} arquivo(s)`;

  const downloadBtn = node.querySelector('.btn-download');
  const downloadDocxBtn = node.querySelector('.btn-download-docx');
  if (materia.generatedAt) {
    downloadBtn.href = `/api/materias/${materia.slug}/pdf`;
    downloadDocxBtn.href = `/api/materias/${materia.slug}/docx`;
  } else {
    for (const btn of [downloadBtn, downloadDocxBtn]) {
      btn.href = '#';
      btn.setAttribute('aria-disabled', 'true');
      btn.addEventListener('click', (e) => e.preventDefault());
    }
  }

  node.querySelector('.btn-remove-materia').addEventListener('click', () => removeMateria(materia.slug, materia.name));

  const list = node.querySelector('.section-list');
  materia.sections.forEach((s) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'fname';
    span.textContent = s.filename;
    span.title = `Enviado em ${formatDate(s.uploadedAt)}`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger btn-small';
    removeBtn.textContent = 'Remover';
    removeBtn.addEventListener('click', () => removeSection(materia.slug, s.id));
    li.append(span, removeBtn);
    list.appendChild(li);
  });

  const addFileInput = node.querySelector('.add-file-input');
  addFileInput.addEventListener('change', () => {
    if (addFileInput.files[0]) uploadDocx(addFileInput.files[0]);
    addFileInput.value = '';
  });

  const coverEmpty = node.querySelector('.cover-empty');
  const coverPresent = node.querySelector('.cover-present');
  if (materia.cover) {
    coverEmpty.hidden = true;
    coverPresent.hidden = false;
    node.querySelector('.cover-filename').textContent = materia.cover.storedAs;
    node.querySelector('.btn-remove-cover').addEventListener('click', () => removeCover(materia.slug));
  } else {
    coverEmpty.hidden = false;
    coverPresent.hidden = true;
  }

  const coverInput = node.querySelector('.cover-file-input');
  coverInput.addEventListener('change', () => {
    if (coverInput.files[0]) uploadCover(materia.slug, coverInput.files[0]);
    coverInput.value = '';
  });

  return node;
}

async function refresh() {
  const materias = await apiRequest('/api/materias');
  materiasList.querySelectorAll('.materia-card').forEach((el) => el.remove());
  emptyState.hidden = materias.length > 0;
  materias.forEach((m) => materiasList.appendChild(renderMateriaCard(m)));
}

const dropZone = document.getElementById('global-drop');
const fileInput = document.getElementById('global-file-input');

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) uploadDocx(fileInput.files[0]);
  fileInput.value = '';
});
['dragenter', 'dragover'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); })
);
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) uploadDocx(file);
});

refresh();
