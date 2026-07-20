/**
 * Collection Panini FWC26
 * Logique métier, gestion d'état, rendu des vues, import/export
 */

'use strict';

const DATABASE_URL = 'database.json';
const LS_KEY = 'panini_wc2026_collection';
const SEARCHABLE_VIEWS = ['manquantes', 'doublons'];

let stickers = [];
let collectionState = {};
let currentView = 'album';
let currentAlbumPageIndex = 0;
let albumPages = [];
let modalStickerID = null;
let searchQuery = '';
let searchActive = false;
let friendCollection = null;

document.addEventListener('DOMContentLoaded', async () => {
  showLoadingSpinner();
  try {
    await loadDatabase();
    loadCollectionFromLocalStorage();
    initNavigation();
    initAlbumPageSelect();
    initFilters();
    initExportImport();
    initModal();
    initGlobalSearch();
    initBoosterModal();
    initMatchmaker();
    document.getElementById('btnTuto')?.addEventListener('click', openTutoModal);
    document.getElementById('btnTutoClose')?.addEventListener('click', closeTutoModal);
    document.getElementById('btnTutoCloseFooter')?.addEventListener('click', closeTutoModal);
    document.getElementById('tutoModal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeTutoModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('tutoModal');
        if (modal && !modal.classList.contains('hidden')) closeTutoModal();
      }
    });
    moveSearchBarToView(currentView);
    renderCurrentView();
    updateGlobalProgress();
  } catch (err) {
    console.error('Erreur au démarrage :', err);
    showToast('Impossible de charger la base de données.', 4000);
    hideLoadingSpinner();
  }
});

async function loadDatabase() {
  const response = await fetch(DATABASE_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  stickers = await response.json();
  const pagesSet = new Set(stickers.map(s => s['Page']));
  albumPages = Array.from(pagesSet).sort((a, b) => a - b);
  stickers.forEach(s => {
    if (!collectionState[s.ID]) {
      collectionState[s.ID] = { status: 'missing', count: 0 };
    }
  });
  hideLoadingSpinner();
}

function getStatus(id) {
  return collectionState[id]?.status || 'missing';
}

function getDupCount(id) {
  return collectionState[id]?.count || 2;
}

function setStatus(id, status, count) {
  if (!collectionState[id]) {
    collectionState[id] = { status: 'missing', count: 0 };
  }
  collectionState[id].status = status;
  if (status === 'duplicate') {
    collectionState[id].count = Math.max(2, count ?? collectionState[id].count ?? 2);
  } else {
    collectionState[id].count = 0;
  }
  saveCollectionToLocalStorage();
  updateGlobalProgress();
}

function saveCollectionToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(collectionState));
  } catch (e) {
    console.warn('Impossible de sauvegarder dans localStorage :', e);
  }
}

function loadCollectionFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Format invalide');
    Object.keys(parsed).forEach(id => {
      if (collectionState[id] !== undefined) {
        collectionState[id] = parsed[id];
      }
    });
  } catch (e) {
    console.warn('Données localStorage corrompues, réinitialisation :', e);
  }
}

function downloadJSONFile(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCollectionAsJSON() {
  try {
    downloadJSONFile(collectionState, 'ma-collection.json');
    showToast('Collection exportée avec succès.');
  } catch (e) {
    console.error('Erreur lors de l\'export :', e);
    showToast('Erreur lors de l\'export.');
  }
}

function importCollectionFromJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Le fichier ne contient pas un objet JSON valide.');
      }
      const knownIDs = new Set(stickers.map(s => s.ID));
      const validKeys = Object.keys(parsed).filter(k => knownIDs.has(k));
      if (validKeys.length === 0) {
        throw new Error('Aucun sticker reconnu dans ce fichier.');
      }
      stickers.forEach(s => {
        collectionState[s.ID] = { status: 'missing', count: 0 };
      });
      validKeys.forEach(id => {
        const entry = parsed[id];
        if (entry && typeof entry.status === 'string') {
          collectionState[id] = {
            status: ['owned', 'missing', 'duplicate'].includes(entry.status) ? entry.status : 'missing',
            count: typeof entry.count === 'number' ? entry.count : 0,
          };
        }
      });
      saveCollectionToLocalStorage();
      renderCurrentView();
      updateGlobalProgress();
      const plural = validKeys.length > 1 ? 's' : '';
      showToast(`Collection importée (${validKeys.length} vignette${plural} chargée${plural}).`);
    } catch (e) {
      console.error('Erreur lors de l\'import :', e);
      showToast(`Erreur d'import : ${e.message}`);
    }
  };
  reader.onerror = () => showToast('Impossible de lire le fichier.');
  reader.readAsText(file);
}

function initNavigation() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
    });
  });
}

function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('[data-view]').forEach(btn => {
    const isActive = btn.dataset.view === viewName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('hidden', view.id !== `view-${viewName}`);
  });
  moveSearchBarToView(viewName);
  if (searchActive && SEARCHABLE_VIEWS.includes(viewName)) {
    applySearchFilter();
  } else {
    renderCurrentView();
  }
}

function renderCurrentView() {
  switch (currentView) {
    case 'album':      renderAlbumView();      break;
    case 'manquantes': renderManquantesView();  break;
    case 'doublons':   renderDoublonsView();    break;
    case 'stats':      renderStatsView();       break;
    case 'echanges':   break;
    default: break;
  }
}

function initAlbumPageSelect() {
  const select = document.getElementById('albumPageSelect');
  select.innerHTML = '';
  albumPages.forEach((page, idx) => {
    const pageStickers = stickers.filter(s => s['Page'] === page);
    const section = pageStickers[0]?.Section || `Page ${page}`;
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `${section}`;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    currentAlbumPageIndex = parseInt(select.value, 10);
    renderAlbumView();
  });
  document.getElementById('btnPagePrev').addEventListener('click', () => {
    if (currentAlbumPageIndex > 0) {
      currentAlbumPageIndex--;
      renderAlbumView();
    }
  });
  document.getElementById('btnPageNext').addEventListener('click', () => {
    if (currentAlbumPageIndex < albumPages.length - 1) {
      currentAlbumPageIndex++;
      renderAlbumView();
    }
  });
  document.getElementById('albumPageTotal').textContent = 106;
}

function renderAlbumView() {
  const pageNum = albumPages[currentAlbumPageIndex];
  const pageStickers = stickers.filter(s => s['Page'] === pageNum);
  document.getElementById('albumPageCurrent').textContent = pageNum;
  document.getElementById('albumPageSelect').value = currentAlbumPageIndex;
  document.getElementById('btnPagePrev').disabled = currentAlbumPageIndex === 0;
  document.getElementById('btnPageNext').disabled = currentAlbumPageIndex === albumPages.length - 1;
  renderAlbumSectionHeader(pageStickers);
  const grid = document.getElementById('stickerGrid');
  const fragment = document.createDocumentFragment();
  pageStickers.forEach(sticker => {
    fragment.appendChild(buildStickerCard(sticker));
  });
  grid.innerHTML = '';
  grid.appendChild(fragment);
}

function getSectionClass(section, group) {
  const specialSections = {
    'Panini': 'panini',
    'Histoire de la Coupe du monde': 'histoire-de-la-coupe-du-monde'
  };
  if (specialSections[section]) return specialSections[section];
  if (group) return `groupe-${group.toLowerCase()}`;
  return 'default';
}

function renderAlbumSectionHeader(pageStickers) {
  const container = document.getElementById('albumSectionHeader');
  if (!pageStickers.length) {
    container.innerHTML = '';
    return;
  }
  const sections = [...new Set(pageStickers.map(s => s['Section']))];
  const firstSection = sections[0];
  const flagURL = pageStickers[0]?.Drapeau || '';
  const groupe = pageStickers[0]?.Groupe || '';
  const colorClass = getSectionClass(firstSection, groupe);
  container.innerHTML = `
    <div class="section-banner section-banner-${colorClass}">
      ${flagURL ? `<img src="${escHtml(flagURL)}" alt="${escHtml(firstSection)}" />` : ''}
      <span>${escHtml(firstSection)}</span>
      ${groupe ? `<span style="font-size:12px;opacity:0.7;letter-spacing:0.1em;">Groupe ${escHtml(groupe)}</span>` : ''}
    </div>
  `;
}

function buildStickerCard(sticker) {
  const status = getStatus(sticker.ID);
  const dupCount = getDupCount(sticker.ID);
  const article = document.createElement('article');
  article.className = `sticker-card ${status}`;
  article.setAttribute('role', 'listitem');
  article.setAttribute('aria-label', `${sticker.ID} — ${sticker.Nom} (${statusLabel(status)})`);
  article.dataset.id = sticker.ID;
  article.dataset.type = sticker.Type || '';
  if (sticker.Type === 'Spécial') {
    article.classList.add('type-special');
  } else {
    article.classList.add('type-classic');
  }
  const dupBadge = status === 'duplicate'
    ? `<div class="dup-badge" aria-label="${dupCount} doublons">x${dupCount}</div>`
    : '';
  const typeStyle = sticker.Type === 'Spécial' ? 'style="background:var(--purple-psycho);color:#fff;"' : '';
  article.innerHTML = `
    ${dupBadge}
    <div class="sticker-header" ${typeStyle}>
      <span class="sticker-id">${escHtml(sticker.ID)}</span>
      <span class="sticker-type-badge">${escHtml(sticker.Type === 'Spécial' ? 'SPEC' : 'STD')}</span>
    </div>
    <div class="sticker-flag-wrap">
      <img class="sticker-flag" src="${escHtml(sticker.Drapeau || '')}" alt="${escHtml(sticker.Section)}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2240%22><rect width=%2260%22 height=%2240%22 fill=%22%23DEE3F7%22/></svg>'" />
    </div>
    <div class="sticker-footer">
      <div class="sticker-name">${escHtml(sticker.Nom)}</div>
      <div class="sticker-section-label">${escHtml(sticker.Section)}</div>
    </div>
  `;
  article.addEventListener('click', () => openModal(sticker.ID));
  return article;
}

function initFilters() {
  document.getElementById('manqSectionFilter').addEventListener('change', renderManquantesView);
  document.getElementById('dblSectionFilter').addEventListener('change', renderDoublonsView);
  populateFilterSelects();
}

function populateFilterSelects() {
  const sections = [...new Set(stickers.map(s => s.Section))].sort();
  const manqSec = document.getElementById('manqSectionFilter');
  const dblSec = document.getElementById('dblSectionFilter');
  sections.forEach(sec => {
    [manqSec, dblSec].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = sec;
      sel.appendChild(opt);
    });
  });
}

function renderManquantesView() {
  const filterSection = document.getElementById('manqSectionFilter').value;
  let missing = stickers.filter(s => getStatus(s.ID) === 'missing');
  if (filterSection) missing = missing.filter(s => s.Section === filterSection);
  document.getElementById('manqCount').innerHTML =
    `<span>${missing.length}</span> vignette${missing.length > 1 ? 's' : ''} manquante${missing.length > 1 ? 's' : ''}`;
  renderStickerList(document.getElementById('manqList'), missing);
  document.getElementById('manqExportZone').classList.add('hidden');
}

function renderDoublonsView() {
  const filterSection = document.getElementById('dblSectionFilter').value;
  let duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate');
  if (filterSection) duplicates = duplicates.filter(s => s.Section === filterSection);
  document.getElementById('dblCount').innerHTML =
    `<span>${duplicates.length}</span> vignette${duplicates.length > 1 ? 's' : ''} en doublon`;
  renderStickerList(document.getElementById('dblList'), duplicates, true);
  document.getElementById('dblExportZone').classList.add('hidden');
}

function renderStickerList(container, stickersList, showDupCount = false) {
  const frag = document.createDocumentFragment();
  if (!stickersList.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:var(--sp-lg);text-align:center;color:var(--outline);';
    empty.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;display:block;margin-bottom:12px;">check_circle</span>
      <p style="font-weight:700;font-size:14px;">Aucune vignette dans cette catégorie.</p>
    `;
    frag.appendChild(empty);
    container.innerHTML = '';
    container.appendChild(frag);
    return;
  }
  const grouped = {};
  stickersList.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = [];
    grouped[s.Code].push(s);
  });
  Object.entries(grouped).forEach(([code, items]) => {
    const sectionName = items[0]?.Section || code;
    const flagURL = items[0]?.Drapeau || '';
    const group = items[0]?.Groupe || '';
    const sectionClass = getSectionClass(sectionName, group);
    const header = document.createElement('div');
    header.className = `list-group-header list-group-header-${sectionClass}`;
    header.innerHTML = `
      ${flagURL ? `<img src="${escHtml(flagURL)}" alt="" />` : ''}
      <span>${escHtml(sectionName)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--outline);">${items.length} vignette${items.length > 1 ? 's' : ''}</span>
    `;
    frag.appendChild(header);
    items.forEach(s => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.setAttribute('role', 'listitem');
      item.dataset.id = s.ID;
      const dupBadge = showDupCount
        ? `<div class="list-item-dup-count">x${getDupCount(s.ID)}</div>`
        : '';
      item.innerHTML = `
        <img class="list-item-flag" src="${escHtml(s.Drapeau || '')}" alt="" loading="lazy" onerror="this.style.display='none'" />
        <span class="list-item-id">${escHtml(s.ID)}</span>
        <span class="list-item-name">${escHtml(s.Nom)}</span>
        <span class="list-item-section">${escHtml(s.Type)}</span>
        ${dupBadge}
      `;
      item.addEventListener('click', () => openModal(s.ID));
      frag.appendChild(item);
    });
  });
  container.innerHTML = '';
  container.appendChild(frag);
}

function generateExportText(stickersList) {
  const map = new Map();
  stickersList.forEach(s => {
    if (!map.has(s.Code)) map.set(s.Code, []);
    map.get(s.Code).push(s['N°']);
  });
  return Array.from(map.entries())
    .map(([code, nums]) => `${code} ${nums.join(',')}`)
    .join('\n');
}

function copyTextarea(textareaId) {
  const textarea = document.getElementById(textareaId);
  navigator.clipboard.writeText(textarea.value)
    .then(() => showToast('Liste copiée dans le presse-papier.'))
    .catch(() => {
      textarea.select();
      document.execCommand('copy');
      showToast('Liste copiée.');
    });
}

function initExportImport() {
  document.getElementById('btnReset').addEventListener('click', () => {
    if (confirm('Voulez-vous vraiment réinitialiser toute votre collection ? Toutes les vignettes seront marquées comme manquantes.')) {
      stickers.forEach(s => {
        collectionState[s.ID] = { status: 'missing', count: 0 };
      });
      saveCollectionToLocalStorage();
      renderCurrentView();
      updateGlobalProgress();
      showToast('Collection réinitialisée.', 2500);
    }
  });
  document.getElementById('btnExport').addEventListener('click', exportCollectionAsJSON);
  document.getElementById('inputImport').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importCollectionFromJSON(file);
    e.target.value = '';
  });
  document.getElementById('btnExportManq').addEventListener('click', () => {
    const filterSection = document.getElementById('manqSectionFilter').value;
    let missing = stickers.filter(s => getStatus(s.ID) === 'missing');
    if (filterSection) missing = missing.filter(s => s.Section === filterSection);
    const text = generateExportText(missing);
    document.getElementById('manqTextarea').value = text || '(Aucune vignette manquante)';
    document.getElementById('manqExportZone').classList.remove('hidden');
    document.getElementById('manqExportZone').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  document.getElementById('btnCopyManq').addEventListener('click', () => copyTextarea('manqTextarea'));
  document.getElementById('btnCloseManqExport').addEventListener('click', () => {
    document.getElementById('manqExportZone').classList.add('hidden');
  });
  document.getElementById('btnExportDbl').addEventListener('click', () => {
    const filterSection = document.getElementById('dblSectionFilter').value;
    let duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate');
    if (filterSection) duplicates = duplicates.filter(s => s.Section === filterSection);
    const text = generateExportText(duplicates);
    document.getElementById('dblTextarea').value = text || '(Aucun doublon)';
    document.getElementById('dblExportZone').classList.remove('hidden');
    document.getElementById('dblExportZone').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  document.getElementById('btnCopyDbl').addEventListener('click', () => copyTextarea('dblTextarea'));
  document.getElementById('btnCloseDblExport').addEventListener('click', () => {
    document.getElementById('dblExportZone').classList.add('hidden');
  });
}

function renderStatsView() {
  const total = stickers.length;
  const owned = stickers.filter(s => getStatus(s.ID) === 'owned').length;
  const duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate').length;
  const missing = stickers.filter(s => getStatus(s.ID) === 'missing').length;
  const ownedTotal = owned + duplicates;
  const pct = Math.round((ownedTotal / total) * 100);
  document.getElementById('statsGlobal').innerHTML = `
    <div class="stat-card completion">
      <div class="stat-card-value">${pct}%</div>
      <div class="stat-card-label">Complétion globale</div>
    </div>
    <div class="stat-card owned">
      <div class="stat-card-value">${ownedTotal}</div>
      <div class="stat-card-label">Possédées</div>
    </div>
    <div class="stat-card missing">
      <div class="stat-card-value">${missing}</div>
      <div class="stat-card-label">Manquantes</div>
    </div>
    <div class="stat-card duplicate">
      <div class="stat-card-value">${duplicates}</div>
      <div class="stat-card-label">Doublons</div>
    </div>
  `;
  renderStatsBars();
}

function renderStatsBars() {
  const container = document.getElementById('statsBars');
  container.innerHTML = '';
  const grouped = {};
  stickers.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = { section: s.Section, flag: s.Drapeau, stickers: [] };
    grouped[s.Code].stickers.push(s);
  });
  const sortedEntries = Object.entries(grouped).sort((a, b) => {
    const getPct = (items) => {
      const total = items.length;
      const ok = items.filter(s => getStatus(s.ID) !== 'missing').length;
      return ok / total;
    };
    return getPct(b[1].stickers) - getPct(a[1].stickers);
  });
  sortedEntries.forEach(([code, data]) => {
    const total = data.stickers.length;
    const ok = data.stickers.filter(s => getStatus(s.ID) !== 'missing').length;
    const pct = Math.round((ok / total) * 100);
    const fillColor = `hsl(${120 * pct / 100}, 80%, 50%)`;
    const row = document.createElement('div');
    row.className = 'stat-bar-row';
    row.innerHTML = `
      <div class="stat-bar-label">
        ${data.flag ? `<img src="${escHtml(data.flag)}" alt="" loading="lazy" />` : ''}
        <span title="${escHtml(data.section)}">${escHtml(data.section)}</span>
      </div>
      <div class="stat-bar-track">
        <div class="stat-bar-fill" style="width:${pct}%; background:${fillColor};"></div>
      </div>
      <div class="stat-bar-pct">${pct}%</div>
    `;
    container.appendChild(row);
  });
}

function parseTextList(text) {
  const ids = new Set();
  const knownIDs = new Set(stickers.map(s => s.ID));
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  lines.forEach(line => {
    const match = line.match(/^([A-Z0-9]+)\s+([\d,\s]+)$/i);
    if (!match) return;
    const code = match[1].toUpperCase();
    const nums = match[2].split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
    nums.forEach(n => {
      const id = `${code}${n}`;
      if (knownIDs.has(id)) ids.add(id);
    });
  });
  return ids;
}

function initModal() {
  document.getElementById('btnModalClose').addEventListener('click', closeModal);
  document.getElementById('stickerModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStickerID) closeModal();
  });
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      if (!modalStickerID) return;
      setStatus(modalStickerID, status);
      updateModalStatusButtons(status);
      updateModalHeader(status);
      refreshStickerInView(modalStickerID);
      if (status === 'duplicate') {
        document.getElementById('modalDupControls').classList.remove('hidden');
        document.getElementById('dupCountDisplay').textContent = getDupCount(modalStickerID);
        updateDupMinusState();
      } else {
        document.getElementById('modalDupControls').classList.add('hidden');
      }
    });
  });
  document.getElementById('btnDupPlus').addEventListener('click', () => {
    if (!modalStickerID) return;
    const newCount = (collectionState[modalStickerID]?.count || 2) + 1;
    setStatus(modalStickerID, 'duplicate', newCount);
    document.getElementById('dupCountDisplay').textContent = newCount;
    updateDupMinusState();
    refreshStickerInView(modalStickerID);
  });
  document.getElementById('btnDupMinus').addEventListener('click', () => {
    if (!modalStickerID) return;
    const current = collectionState[modalStickerID]?.count || 2;
    if (current <= 2) return;
    const newCount = current - 1;
    setStatus(modalStickerID, 'duplicate', newCount);
    document.getElementById('dupCountDisplay').textContent = newCount;
    document.getElementById('btnDupMinus').disabled = (newCount <= 2);
    refreshStickerInView(modalStickerID);
  });
}

function updateDupMinusState() {
  const btnMinus = document.getElementById('btnDupMinus');
  if (!modalStickerID) { btnMinus.disabled = false; return; }
  const count = collectionState[modalStickerID]?.count || 2;
  btnMinus.disabled = (count <= 2);
}

function openModal(id) {
  const sticker = stickers.find(s => s.ID === id);
  if (!sticker) return;
  modalStickerID = id;
  const status = getStatus(id);
  document.getElementById('modalId').textContent = sticker.ID;
  document.getElementById('modalTitle').textContent = sticker.Nom;
  document.getElementById('modalFlag').src = sticker.Drapeau || '';
  document.getElementById('modalFlag').alt = sticker.Section;
  document.getElementById('modalMeta').innerHTML = `
    <span>${escHtml(sticker.Section)}</span>
    <span>${escHtml(sticker.Type)}</span>
    ${sticker.Groupe ? `<span>Groupe ${escHtml(sticker.Groupe)}</span>` : ''}
    <span>Page ${sticker['Page']}</span>
  `;
  updateModalHeader(status);
  updateModalStatusButtons(status);
  const dupControls = document.getElementById('modalDupControls');
  if (status === 'duplicate') {
    dupControls.classList.remove('hidden');
    document.getElementById('dupCountDisplay').textContent = getDupCount(id);
    updateDupMinusState();
  } else {
    dupControls.classList.add('hidden');
  }
  const flagWrap = document.getElementById('modalFlagWrap');
  if (sticker.Type === 'Spécial') {
    flagWrap.classList.add('holo');
  } else {
    flagWrap.classList.remove('holo');
  }
  document.getElementById('stickerModal').classList.remove('hidden');
  document.getElementById('btnModalClose').focus();
}

function updateModalHeader(status) {
  const header = document.getElementById('modalHeader');
  const headerColors = {
    owned:     { bg: 'var(--green-deep)' },
    missing:   { bg: 'var(--surface-mid)' },
    duplicate: { bg: 'var(--orange-vibrant)' }
  };
  const colors = headerColors[status] || headerColors.missing;
  header.style.background = colors.bg;
  header.style.color = '#ffffff';
}

function closeModal() {
  document.getElementById('stickerModal').classList.add('hidden');
  modalStickerID = null;
}

function updateModalStatusButtons(activeStatus) {
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.classList.toggle('active-status', btn.dataset.status === activeStatus);
  });
}

function refreshStickerInView(id) {
  const existingCards = document.querySelectorAll(`.sticker-card[data-id="${id}"]`);
  if (existingCards.length > 0) {
    const sticker = stickers.find(s => s.ID === id);
    if (!sticker) return;
    const newCard = buildStickerCard(sticker);
    existingCards.forEach(card => card.parentNode.replaceChild(newCard.cloneNode(true), card));
    document.querySelectorAll(`.sticker-card[data-id="${id}"]`).forEach(card => {
      card.addEventListener('click', () => openModal(id));
    });
  }
  if (currentView === 'manquantes') renderManquantesView();
  if (currentView === 'doublons')   renderDoublonsView();
  if (currentView === 'stats')      renderStatsView();
}

function updateGlobalProgress() {
  const total = stickers.length;
  const owned = stickers.filter(s => getStatus(s.ID) !== 'missing').length;
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
  document.getElementById('progressOwned').textContent = owned;
  document.getElementById('progressTotal').textContent = total;
  document.getElementById('progressPct').textContent = `${pct}%`;
  document.getElementById('progressFill').style.width = `${pct}%`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function statusLabel(status) {
  const labels = { owned: 'Possédée', missing: 'Manquante', duplicate: 'Doublon' };
  return labels[status] || status;
}

let toastTimer = null;
function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function showLoadingSpinner() {
  const main = document.getElementById('stickerGrid');
  if (main) {
    main.innerHTML = `
      <div class="loading-spinner" style="grid-column:1/-1">
        <div class="spinner-ring"></div>
        <p style="font-weight:700;font-size:14px;color:var(--outline);">Chargement de la base…</p>
      </div>
    `;
  }
}

function hideLoadingSpinner() {}

function initGlobalSearch() {
  const input = document.getElementById('globalSearch');
  const clearBtn = document.getElementById('searchClear');
  if (!input) return;
  input.addEventListener('input', () => {
    searchQuery = input.value.trim().toLowerCase();
    searchActive = searchQuery.length > 0;
    clearBtn.classList.toggle('hidden', !searchActive);
    applySearchFilter();
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    searchQuery = '';
    searchActive = false;
    clearBtn.classList.add('hidden');
    applySearchFilter();
  });
}

function moveSearchBarToView(viewName) {
  const bar = document.getElementById('viewSearchBar');
  if (!bar) return;
  const slot = document.getElementById(`searchSlot-${viewName}`);
  if (slot && SEARCHABLE_VIEWS.includes(viewName)) {
    slot.appendChild(bar);
    bar.style.display = '';
  } else {
    let hiddenContainer = document.getElementById('hiddenSearchContainer');
    if (!hiddenContainer) {
      hiddenContainer = document.createElement('div');
      hiddenContainer.id = 'hiddenSearchContainer';
      hiddenContainer.style.display = 'none';
      document.body.appendChild(hiddenContainer);
    }
    hiddenContainer.appendChild(bar);
  }
}

function applySearchFilter() {
  document.querySelectorAll('.search-results-banner').forEach(b => b.remove());
  if (!searchActive) {
    renderCurrentView();
    return;
  }
  const q = searchQuery;
  const matched = stickers.filter(s => {
    const idMatch = s.ID.toLowerCase().includes(q);
    const nomMatch = (s.Nom || '').toLowerCase().includes(q);
    const codeMatch = (s.Code || '').toLowerCase().includes(q);
    return idMatch || nomMatch || codeMatch;
  });
  if (currentView === 'album') {
    renderSearchResultsGrid(matched, q);
  } else if (currentView === 'manquantes') {
    const filtered = matched.filter(s => getStatus(s.ID) === 'missing');
    renderSearchResultsList(filtered, q, false);
  } else if (currentView === 'doublons') {
    const filtered = matched.filter(s => getStatus(s.ID) === 'duplicate');
    renderSearchResultsList(filtered, q, true);
  }
}

function renderSearchResultsGrid(results, q) {
  const grid = document.getElementById('stickerGrid');
  const container = document.getElementById('view-album');
  if (!grid || !container) return;
  const banner = createSearchBanner(results.length, q);
  grid.parentNode.insertBefore(banner, grid);
  const frag = document.createDocumentFragment();
  results.forEach(s => frag.appendChild(buildStickerCard(s)));
  grid.innerHTML = '';
  grid.appendChild(frag);
}

function renderSearchResultsList(results, q, showDupCount) {
  const listId = currentView === 'manquantes' ? 'manqList' : 'dblList';
  const listEl = document.getElementById(listId);
  if (!listEl) return;
  const banner = createSearchBanner(results.length, q);
  listEl.parentNode.insertBefore(banner, listEl);
  renderStickerList(listEl, results, showDupCount);
}

function createSearchBanner(count, q) {
  const banner = document.createElement('div');
  banner.className = 'search-results-banner';
  banner.innerHTML = `
    <span class="material-symbols-outlined" style="font-size:16px;">search</span>
    <span><strong>${count}</strong> résultat${count !== 1 ? 's' : ''} pour "<em>${escHtml(q)}</em>"</span>
    <button class="search-banner-clear" id="searchBannerClear">
      <span class="material-symbols-outlined" style="font-size:14px;">close</span>
      Effacer
    </button>
  `;
  banner.querySelector('#searchBannerClear').addEventListener('click', () => {
    const input = document.getElementById('globalSearch');
    if (input) input.value = '';
    searchQuery = '';
    searchActive = false;
    document.getElementById('searchClear').classList.add('hidden');
    applySearchFilter();
  });
  return banner;
}

function initBoosterModal() {
  const fab = document.getElementById('fabBooster');
  const modal = document.getElementById('boosterModal');
  const btnClose = document.getElementById('btnBoosterClose');
  const btnCancel = document.getElementById('btnBoosterCancel');
  const btnValidate = document.getElementById('btnBoosterValidate');
  const input = document.getElementById('boosterInput');
  const preview = document.getElementById('boosterPreview');
  if (!fab || !modal) return;
  fab.addEventListener('click', () => {
    input.value = '';
    preview.innerHTML = '';
    modal.classList.remove('hidden');
    input.focus();
  });
  [btnClose, btnCancel].forEach(btn => {
    btn && btn.addEventListener('click', closeBoosterModal);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeBoosterModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeBoosterModal();
  });
  input.addEventListener('input', () => {
    updateBoosterPreview(input.value, preview);
  });
  btnValidate.addEventListener('click', () => {
    const ids = parseBoosterInput(input.value);
    if (ids.valid.length === 0) {
      showToast('Aucun ID reconnu dans la saisie.');
      return;
    }
    ids.valid.forEach(id => {
      const current = getStatus(id);
      if (current === 'missing') {
        setStatus(id, 'owned');
      } else if (current === 'owned') {
        setStatus(id, 'duplicate', Math.max(2, (collectionState[id]?.count || 0) + 1));
      } else if (current === 'duplicate') {
        const newCount = (collectionState[id]?.count || 2) + 1;
        setStatus(id, 'duplicate', newCount);
      }
    });
    renderCurrentView();
    closeBoosterModal();
    const plural = ids.valid.length > 1 ? 's' : '';
    showToast(`${ids.valid.length} vignette${plural} ajoutée${plural}.`, 3000);
  });
}

function closeBoosterModal() {
  document.getElementById('boosterModal').classList.add('hidden');
}

function parseBoosterInput(raw) {
  const knownIDs = new Set(stickers.map(s => s.ID));
  const cleaned = raw.replace(/[,;]/g, ' ').trim();
  const tokens = cleaned.toUpperCase().split(/\s+/).filter(Boolean);
  const valid = [];
  const invalid = [];
  let currentCode = null;
  const codeRegex = /^([A-Z]{2,})(\d*)$/;
  for (const token of tokens) {
    const match = token.match(codeRegex);
    if (match) {
      const letters = match[1];
      const digits = match[2];
      currentCode = letters;
      if (digits) {
        const id = letters + digits;
        if (knownIDs.has(id)) valid.push(id);
        else invalid.push(id);
      }
    } else {
      if (currentCode && /^\d+$/.test(token)) {
        const id = currentCode + token;
        if (knownIDs.has(id)) valid.push(id);
        else invalid.push(id);
      } else {
        invalid.push(token);
      }
    }
  }
  return { valid, invalid };
}

function updateBoosterPreview(raw, preview) {
  if (!raw.trim()) {
    preview.innerHTML = '';
    return;
  }
  const { valid, invalid } = parseBoosterInput(raw);
  const frag = document.createDocumentFragment();
  valid.forEach(id => {
    const tag = document.createElement('span');
    tag.className = 'booster-tag valid';
    tag.textContent = id;
    frag.appendChild(tag);
  });
  invalid.forEach(id => {
    const tag = document.createElement('span');
    tag.className = 'booster-tag invalid';
    tag.textContent = id;
    frag.appendChild(tag);
  });
  preview.innerHTML = '';
  preview.appendChild(frag);
}

function initMatchmaker() {
  const inputFriendJSON = document.getElementById('inputFriendJSON');
  const btnExportMatch = document.getElementById('btnExportMatch');
  const btnCopyMatch = document.getElementById('btnCopyMatch');
  const btnCopyMatchText = document.getElementById('btnCopyMatchText');
  const btnCloseMatchExport = document.getElementById('btnCloseMatchExport');
  const btnValidateExchange = document.getElementById('btnValidateExchange');
  const btnSelectAllMatches = document.getElementById('btnSelectAllMatches');
  const btnSelectNoneMatches = document.getElementById('btnSelectNoneMatches');
  const resultsEl = document.getElementById('matchmakerResults');
  if (!inputFriendJSON) return;

  const modeBtnImport = document.getElementById('modeBtnImport');
  const modeBtnManual = document.getElementById('modeBtnManual');
  const modePanelImport = document.getElementById('modePanel-import');
  const modePanelManual = document.getElementById('modePanel-manual');

  function setMatchmakerMode(mode) {
    const isManual = mode === 'manual';
    modeBtnImport?.classList.toggle('active', !isManual);
    modeBtnManual?.classList.toggle('active', isManual);
    if (modeBtnImport) modeBtnImport.setAttribute('aria-selected', String(!isManual));
    if (modeBtnManual) modeBtnManual.setAttribute('aria-selected', String(isManual));
    if (modePanelImport) modePanelImport.classList.toggle('hidden', isManual);
    if (modePanelManual) modePanelManual.classList.toggle('hidden', !isManual);
  }

  modeBtnImport?.addEventListener('click', () => setMatchmakerMode('import'));
  modeBtnManual?.addEventListener('click', () => setMatchmakerMode('manual'));

  const btnAnalyseManual = document.getElementById('btnAnalyseManual');
  btnAnalyseManual?.addEventListener('click', runMatchmakerManual);

  inputFriendJSON.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => runMatchmakerFromJSON(ev.target.result);
    reader.onerror = () => showToast('Impossible de lire le fichier.');
    reader.readAsText(file);
    e.target.value = '';
  });

  btnExportMatch?.addEventListener('click', exportMatchSummary);
  btnCopyMatch?.addEventListener('click', exportMatchSummary);
  btnCopyMatchText?.addEventListener('click', () => copyTextarea('matchTextarea'));
  resultsEl?.addEventListener('change', (e) => {
    if (!e.target.classList.contains('match-tag-check')) return;
    const tag = e.target.closest('.match-tag');
    tag?.classList.toggle('excluded', !e.target.checked);
    updateValidateHint();
  });
  btnSelectAllMatches?.addEventListener('click', () => setAllMatchChecks(true));
  btnSelectNoneMatches?.addEventListener('click', () => setAllMatchChecks(false));
  btnValidateExchange?.addEventListener('click', validateExchange);
  btnCloseMatchExport?.addEventListener('click', () => {
    document.getElementById('matchExportZone').classList.add('hidden');
  });
}

function parseFriendCollection(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {}
  return null;
}

function runMatchmakerFromJSON(raw) {
  const parsed = parseFriendCollection(raw);
  if (!parsed) {
    showToast('Fichier JSON invalide ou non reconnu.');
    return;
  }
  friendCollection = parsed;
  refreshMatchResults();
}

function parseFriendManual(duplicatesRaw, missingRaw) {
  const dupIds = parseTextList(duplicatesRaw);
  const missIds = parseTextList(missingRaw);
  if (dupIds.size === 0 && missIds.size === 0) return null;
  const result = {};
  stickers.forEach(s => {
    result[s.ID] = { status: 'owned', count: 0 };
  });
  missIds.forEach(id => {
    result[id] = { status: 'missing', count: 0 };
  });
  dupIds.forEach(id => {
    result[id] = { status: 'duplicate', count: 0 };
  });
  return result;
}

function runMatchmakerManual() {
  const duplicatesRaw = document.getElementById('friendDuplicatesInput').value.trim();
  const missingRaw = document.getElementById('friendMissingInput').value.trim();
  if (!duplicatesRaw && !missingRaw) {
    showToast('La liste de ton échangeur est vide.');
    return;
  }
  const parsed = parseFriendManual(duplicatesRaw, missingRaw);
  if (!parsed) {
    showToast('Aucun ID reconnu. Utilise le format CODE 1,2,3.');
    return;
  }
  friendCollection = parsed;
  refreshMatchResults();
}

function refreshMatchResults() {
  if (!friendCollection) return;
  const resultsEl = document.getElementById('matchmakerResults');
  const emptyEl = document.getElementById('echangeResults');
  const mesManquantes = new Set(stickers.filter(s => getStatus(s.ID) === 'missing').map(s => s.ID));
  const mesDoublons = new Set(stickers.filter(s => getStatus(s.ID) === 'duplicate').map(s => s.ID));
  const échangeurManquantes = new Set(stickers.filter(s => {
    const entry = friendCollection[s.ID];
    return !entry || entry.status === 'missing';
  }).map(s => s.ID));
  const échangeurDoublons = new Set(stickers.filter(s => {
    const entry = friendCollection[s.ID];
    return entry && entry.status === 'duplicate';
  }).map(s => s.ID));
  const jeDonne = [...mesDoublons].filter(id => échangeurManquantes.has(id));
  const ilDonne = [...mesManquantes].filter(id => échangeurDoublons.has(id));
  emptyEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  document.getElementById('matchmakerSummary').innerHTML = `
    <div class="matchmaker-summary-stat">
      <span class="stat-val">${jeDonne.length}</span>
      <span class="stat-lbl">Je donne</span>
    </div>
    <div class="matchmaker-summary-divider"></div>
    <div class="matchmaker-summary-stat">
      <span class="stat-val">${ilDonne.length}</span>
      <span class="stat-lbl">Je reçois</span>
    </div>
    <div class="matchmaker-summary-divider"></div>
    <div class="matchmaker-summary-stat">
      <span class="stat-val">${Math.min(jeDonne.length, ilDonne.length)}</span>
      <span class="stat-lbl">Échange net possible</span>
    </div>
  `;
  document.getElementById('giveCount').textContent = jeDonne.length;
  document.getElementById('receiveCount').textContent = ilDonne.length;
  renderMatchTags(document.getElementById('giveList'), jeDonne);
  renderMatchTags(document.getElementById('receiveList'), ilDonne);
  document.getElementById('matchExportZone').classList.add('hidden');
  updateValidateHint();
}

function renderMatchTags(container, ids) {
  const frag = document.createDocumentFragment();
  if (ids.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--outline);font-size:13px;font-style:italic;padding:4px;';
    empty.textContent = 'Aucune vignette correspondante.';
    frag.appendChild(empty);
  } else {
    ids.forEach(id => {
      const s = stickers.find(x => x.ID === id);
      const tag = document.createElement('label');
      tag.className = 'match-tag';
      tag.dataset.id = id;
      tag.title = `${id} — ${s?.Nom || ''} (décoche si non échangée)`;
      tag.innerHTML = `
        <input type="checkbox" class="match-tag-check" checked />
        <span class="match-tag-code">${escHtml(id)}</span>
        <span class="tag-name">${escHtml(s?.Nom || '')}</span>
      `;
      frag.appendChild(tag);
    });
  }
  container.innerHTML = '';
  container.appendChild(frag);
}

function setAllMatchChecks(checked) {
  document.querySelectorAll('#matchmakerResults .match-tag-check').forEach(cb => {
    cb.checked = checked;
    cb.closest('.match-tag')?.classList.toggle('excluded', !checked);
  });
  updateValidateHint();
}

function updateValidateHint() {
  const hint = document.getElementById('validateHint');
  if (!hint) return;
  const giveChecked = document.querySelectorAll('#giveList .match-tag-check:checked').length;
  const receiveChecked = document.querySelectorAll('#receiveList .match-tag-check:checked').length;
  const total = giveChecked + receiveChecked;
  if (total === 0) {
    hint.textContent = 'Décoche les cartes qui n\'ont pas été échangées, puis valide pour mettre à jour ta collection.';
    return;
  }
  const vignettePluriel = total > 1 ? 's' : '';
  const etre = total > 1 ? 'seront' : 'sera';
  const marquePluriel = total > 1 ? 's' : '';
  const echangePluriel = total > 1 ? 's' : '';
  const donnePluriel = giveChecked > 1 ? 's' : '';
  const recuPluriel = receiveChecked > 1 ? 's' : '';
  hint.textContent =
    `${total} vignette${vignettePluriel} ${etre} marquée${marquePluriel} comme échangée${echangePluriel} : ` +
    `${giveChecked} donnée${donnePluriel}, ${receiveChecked} reçue${recuPluriel}.`;
}

function validateExchange() {
  if (!friendCollection) {
    showToast('Analyse d\'abord la collection de ton échangeur.');
    return;
  }
  const selectedGive = Array.from(document.querySelectorAll('#giveList .match-tag'))
    .filter(tag => tag.querySelector('.match-tag-check')?.checked)
    .map(tag => tag.dataset.id);
  const selectedReceive = Array.from(document.querySelectorAll('#receiveList .match-tag'))
    .filter(tag => tag.querySelector('.match-tag-check')?.checked)
    .map(tag => tag.dataset.id);
  if (selectedGive.length === 0 && selectedReceive.length === 0) {
    showToast('Sélectionne au moins une vignette échangée.');
    return;
  }
  selectedGive.forEach(id => {
    const current = collectionState[id]?.count || 2;
    const next = current - 1;
    if (next <= 1) setStatus(id, 'owned');
    else setStatus(id, 'duplicate', next);
  });
  selectedReceive.forEach(id => {
    setStatus(id, 'owned');
  });
  selectedGive.forEach(id => {
    friendCollection[id] = { status: 'owned', count: 0 };
  });
  selectedReceive.forEach(id => {
    const entry = friendCollection[id];
    const current = entry?.count || 2;
    const next = current - 1;
    friendCollection[id] = next <= 1
      ? { status: 'owned', count: 0 }
      : { status: 'duplicate', count: next };
  });
  downloadJSONFile(friendCollection, `collection-de-ton-échangeur-à-jour-${dateStamp()}.json`);
  renderCurrentView();
  updateGlobalProgress();
  refreshMatchResults();
  const total = selectedGive.length + selectedReceive.length;
  const plural = total > 1 ? 's' : '';
  showToast(`Échange validé : ${total} vignette${plural} mise${plural} à jour. Fichier pour ton échangeur téléchargé.`, 3500);
}

function exportMatchSummary() {
  const giveList = Array.from(document.getElementById('giveList').querySelectorAll('.match-tag'))
    .filter(t => t.querySelector('.match-tag-check')?.checked)
    .map(t => t.dataset.id);
  const receiveList = Array.from(document.getElementById('receiveList').querySelectorAll('.match-tag'))
    .filter(t => t.querySelector('.match-tag-check')?.checked)
    .map(t => t.dataset.id);
  const giveText = giveList.length ? giveList.join(', ') : 'Aucun doublon à donner';
  const receiveText = receiveList.length ? receiveList.join(', ') : 'Aucune vignette à recevoir';
  const text = [
    'RÉCAPITULATIF',
    '',
    `Ce que je peux te donner (${giveList.length}) :`,
    giveText,
    '',
    `Ce que tu peux me donner (${receiveList.length}) :`,
    receiveText,
    '',
    `Généré le ${new Date().toLocaleDateString('fr-FR')} via Ma collection Panini FWC26`,
  ].join('\n');
  document.getElementById('matchTextarea').value = text;
  const zone = document.getElementById('matchExportZone');
  zone.classList.remove('hidden');
  zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openTutoModal() {
  document.getElementById('tutoModal').classList.remove('hidden');
  document.getElementById('btnTutoClose').focus();
}

function closeTutoModal() {
  document.getElementById('tutoModal').classList.add('hidden');
}
