// whatsnew.js — окно «Что нового». Показывается один раз после обновления
// приложения: отметка о показанной версии лежит в localStorage.
// Список изменений — обычные данные, разметку собираем на месте.

import { $, escapeHtml } from './utils.js';
import { openModal, closeModal } from './ui.js';
import { countAll } from './db.js';

/** Версия приложения. Подняли — окно покажется всем ещё раз. */
export const VERSION = '1.1';

const SEEN_KEY = 'practice.whatsnew';

const CHANGES = [
  {
    icon: 'rate',
    title: 'Цена считается по ставке за час',
    text: 'Ставка клиента теперь часовая. Занятие на полтора часа при ставке 1000 ₽ '
      + 'само получит цену 1500 ₽ — и пересчитается, если подвинуть время.',
  },
  {
    icon: 'swipe',
    title: 'Свайп по календарю',
    text: 'Неделя и месяц листаются пальцем влево и вправо. Стрелки в шапке остались на месте.',
  },
  {
    icon: 'spark',
    title: 'Мягкие переходы',
    text: 'Экраны, шторки и списки появляются плавно. Если в телефоне включено '
      + '«уменьшение движения» — анимации выключатся сами.',
  },
];

const ICONS = {
  rate: '<circle cx="12" cy="12" r="9"/><path d="M9 9.5h6M9 14.5h6M14.5 7l-5 10"/>',
  swipe: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/><path d="M11.5 12h1"/>',
  spark: '<path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z"/><path d="M18 16.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z"/>',
};

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch (err) {
    return VERSION; // приватный режим — не мозолим глаза каждым запуском
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, VERSION);
  } catch (err) {
    // не сохранилось — окно просто появится в следующий раз
  }
}

function renderList() {
  $('#whatsnew-version').textContent = `Версия ${VERSION}`;
  $('#whatsnew-list').innerHTML = CHANGES.map((change) => `
    <li class="news-item">
      <span class="news-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">${ICONS[change.icon] || ''}</svg>
      </span>
      <span class="news-text">
        <span class="news-title">${escapeHtml(change.title)}</span>
        <span class="news-sub">${escapeHtml(change.text)}</span>
      </span>
    </li>`).join('');
}

/** Показать окно прямо сейчас — из настроек или после обновления. */
export function open() {
  renderList();
  openModal($('#whatsnew-dialog'), { onClose: markSeen });
}

export function init() {
  $('#whatsnew-ok').addEventListener('click', () => closeModal());
  $('#whatsnew-open').addEventListener('click', () => open());
  $('#app-version').textContent = VERSION;
}

/**
 * Первый заход после обновления — показать. Первый заход вообще
 * (пустая база, отметки нет) — рассказывать «что нового» не о чем.
 */
export async function maybeShow() {
  const seen = readSeen();
  if (seen === VERSION) return;

  if (seen === null) {
    const counts = await countAll();
    if (counts.clients + counts.events + counts.tasks === 0) {
      markSeen();
      return;
    }
  }

  open();
}
