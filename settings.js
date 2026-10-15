// settings.js — тема оформления и резервная копия данных.
// Тема: три состояния (системная / светлая / тёмная). JS только выставляет
// атрибут data-theme на <html>, всю отрисовку делает CSS.

import { exportAll, importAll, countAll, inspectBackup, SCHEMA_VERSION } from './db.js';
import { $, $$, todayISO, pluralize } from './utils.js';
import { openOverlay, toast, confirmAction } from './ui.js';

const THEME_KEY = 'practice.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

/* ===================== Тема ===================== */

export function themePref() {
  try {
    return localStorage.getItem(THEME_KEY) || 'system';
  } catch (err) {
    return 'system';
  }
}

function savePref(pref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch (err) {
    // приватный режим — тема просто не переживёт перезапуск
  }
}

export function applyTheme(pref = themePref()) {
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  const root = document.documentElement;

  if (dark) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');

  // Цвет системной панели берём из токена, чтобы не дублировать hex в JS
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const surface = getComputedStyle(root).getPropertyValue('--surface').trim();
    if (surface) meta.setAttribute('content', surface);
  }
}

function renderThemeUI() {
  const pref = themePref();
  $$('#theme-switch [data-theme-pref]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themePref === pref));
  });

  $('#theme-hint').textContent = pref === 'system'
    ? `Следует настройкам телефона — сейчас ${media.matches ? 'тёмная' : 'светлая'}.`
    : pref === 'dark'
      ? 'Всегда тёмная, даже если телефон переключится на светлую.'
      : 'Всегда светлая, даже если телефон переключится на тёмную.';
}

/* ===================== Экран настроек ===================== */

export function init() {
  applyTheme();

  // Живая реакция на смену темы в системе, пока приложение открыто
  media.addEventListener('change', () => {
    if (themePref() !== 'system') return;
    applyTheme();
    renderThemeUI();
  });

  $('#theme-switch').addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-pref]');
    if (!button) return;
    savePref(button.dataset.themePref);
    applyTheme();
    renderThemeUI();
  });

  $('#export-btn').addEventListener('click', onExport);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', onImportFile);
}

export async function openSettings() {
  renderThemeUI();
  await renderStorageInfo();
  openOverlay($('#screen-settings'));
}

async function renderStorageInfo() {
  const counts = await countAll();
  $('#storage-info').textContent = [
    pluralize(counts.clients, ['клиент', 'клиента', 'клиентов']),
    pluralize(counts.events, ['занятие', 'занятия', 'занятий']),
    pluralize(counts.tasks, ['задача', 'задачи', 'задач']),
  ].join(' · ');
}

/* ===================== Резервная копия ===================== */

async function onExport() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `moya-praktika-${todayISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  toast('Копия сохранена в загрузки');
}

async function onImportFile(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  let data = null;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    data = null;
  }

  if (!data || !Array.isArray(data.clients) || !Array.isArray(data.events)) {
    input.value = '';
    toast('Файл не похож на копию «Моей практики»');
    return;
  }

  const info = inspectBackup(data);
  const current = await countAll();
  const hasData = current.clients + current.events + current.tasks > 0;

  // Копия из старой версии приложения дополняется недостающими полями,
  // копия из более новой — заливается как есть, о чём честно предупреждаем.
  const versionNote = info.newer
    ? ` Копия сделана в более новой версии приложения (формат ${info.version} против ${SCHEMA_VERSION}) — часть данных может не отобразиться.`
    : info.version < SCHEMA_VERSION
      ? ` Копия из прежней версии (формат ${info.version}) — она будет обновлена до текущей.`
      : '';

  const ok = await confirmAction({
    title: 'Восстановить из копии?',
    text: `В файле: ${info.clients} кл., ${info.events} зан., ${info.tasks} зад.`
      + (hasData ? ' Всё, что сейчас в приложении, будет заменено.' : '')
      + versionNote,
    okText: 'Восстановить',
    danger: hasData,
  });

  if (!ok) {
    input.value = '';
    return;
  }

  await importAll(data);
  input.value = '';
  await renderStorageInfo();
  toast('Данные восстановлены');
}
