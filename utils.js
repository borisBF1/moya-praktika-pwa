// utils.js — даты, форматирование и мелкие помощники для DOM.
// Даты везде хранятся строкой YYYY-MM-DD в локальном времени: так они
// сравниваются как обычные строки и не «уезжают» на день из-за часового пояса.

const LOCALE = 'ru-RU';

/* ===================== Даты ===================== */

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Date -> 'YYYY-MM-DD' в локальном времени. */
export function toISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 'YYYY-MM-DD' -> Date (полночь по локальному времени). */
export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  return toISO(new Date());
}

export function addDays(iso, days) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** Понедельник той недели, в которую попадает дата. */
export function weekStart(iso) {
  const d = fromISO(iso);
  const shift = (d.getDay() + 6) % 7; // воскресенье = 6
  d.setDate(d.getDate() - shift);
  return toISO(d);
}

export function weekDays(startIso) {
  return Array.from({ length: 7 }, (_, i) => addDays(startIso, i));
}

/** 'YYYY-MM-DD' -> 'YYYY-MM' */
export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function currentMonthKey() {
  return monthKey(todayISO());
}

/** Границы месяца включительно: { from: 'YYYY-MM-01', to: 'YYYY-MM-31' } */
export function monthBounds(ym) {
  return { from: `${ym}-01`, to: `${ym}-31` };
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function daysBetween(fromIso, toIso) {
  return Math.round((fromISO(toIso) - fromISO(fromIso)) / 86400000);
}

/* ===================== Форматирование дат ===================== */

const fmtCache = new Map();
function formatter(options) {
  const key = JSON.stringify(options);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat(LOCALE, options));
  return fmtCache.get(key);
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** «понедельник, 10 августа» */
export function fmtFullDate(iso) {
  return formatter({ weekday: 'long', day: 'numeric', month: 'long' }).format(fromISO(iso));
}

/** «10 августа» */
export function fmtDayMonth(iso) {
  return formatter({ day: 'numeric', month: 'long' }).format(fromISO(iso));
}

/** «10 авг» */
export function fmtShortDate(iso) {
  return formatter({ day: 'numeric', month: 'short' }).format(fromISO(iso)).replace('.', '');
}

/** «пн» */
export function fmtWeekdayShort(iso) {
  return formatter({ weekday: 'short' }).format(fromISO(iso));
}

/** «Август 2026» */
export function fmtMonthYear(ym) {
  const [y, m] = ym.split('-').map(Number);
  const month = formatter({ month: 'long' }).format(new Date(y, m - 1, 1));
  return `${capitalize(month)} ${y}`;
}

/** «Сегодня» / «Завтра» / «Вчера» / «10 авг» */
export function fmtRelativeDay(iso, { capital = true } = {}) {
  const diff = daysBetween(todayISO(), iso);
  let text;
  if (diff === 0) text = 'сегодня';
  else if (diff === 1) text = 'завтра';
  else if (diff === -1) text = 'вчера';
  else return fmtShortDate(iso);
  return capital ? capitalize(text) : text;
}

export function fmtTimeRange(start, end) {
  if (!start) return '';
  return end && end !== start ? `${start} – ${end}` : start;
}

/** Прибавить минуты к 'HH:MM'. */
export function addMinutes(hm, minutes) {
  const [h, m] = hm.split(':').map(Number);
  const total = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/* ===================== Числа и слова ===================== */

const moneyFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

export function fmtMoney(value) {
  return `${moneyFmt.format(Math.round(Number(value) || 0))} ₽`;
}

/** «1 000 ₽/ч» — ставка клиента всегда часовая. */
export function fmtRate(value) {
  return `${fmtMoney(value)}/ч`;
}

/** plural(2, ['занятие', 'занятия', 'занятий']) -> 'занятия' */
export function plural(n, forms) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function pluralize(n, forms) {
  return `${n} ${plural(n, forms)}`;
}

/* ===================== DOM ===================== */

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ===================== Цветные метки клиентов ===================== */

/** Ключи палитры. Сами цвета живут в токенах CSS: --c-<ключ>. */
export const CLIENT_COLORS = ['teal', 'sky', 'violet', 'rose', 'amber', 'lime', 'clay', 'slate'];

/** CSS-переменная цвета клиента или фирменный цвет, если метка не выбрана. */
export function clientColorVar(client) {
  return client && CLIENT_COLORS.includes(client.color)
    ? `var(--c-${client.color})`
    : 'var(--brand)';
}

/** Кружок с инициалом — им клиенты различаются в списках. */
export function avatarHTML(client, { large = false } = {}) {
  if (!client) return '';
  const letter = (client.name || '?').trim().charAt(0).toUpperCase();
  return `<span class="avatar${large ? ' avatar--lg' : ''}" style="--dot: ${clientColorVar(client)}">${escapeHtml(letter)}</span>`;
}

/**
 * Точки под числом в календаре: до трёх — по точке на событие,
 * больше трёх — две точки и плюс на месте третьей.
 * Занятия — заливка, задачи — кольцо.
 */
export function dayMarksHTML(marks) {
  if (!marks.length) return '';
  const dot = (mark) => `<span class="day-dot${mark.kind === 'task' ? ' day-dot--task' : ''}"
    style="--dot: ${mark.color}"></span>`;

  if (marks.length > 3) {
    return marks.slice(0, 2).map(dot).join('') + '<span class="day-more">+</span>';
  }
  return marks.map(dot).join('');
}

/** Разметка пустого состояния — используется всеми экранами. */
export function emptyState(title, sub = '') {
  return `<div class="empty">
    <p class="empty-title">${escapeHtml(title)}</p>
    ${sub ? `<p class="empty-sub">${escapeHtml(sub)}</p>` : ''}
  </div>`;
}

export function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Сортировка по нескольким ключам-строкам. */
export function byKey(...keys) {
  return (a, b) => {
    for (const key of keys) {
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  };
}
