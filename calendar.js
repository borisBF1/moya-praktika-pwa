// calendar.js — неделя и месяц, список дня, форма занятия и логика повторов.
// Здесь же живёт «словарь» занятий (метки, чипы, карточки), которым
// пользуются остальные экраны.

import {
  EVENTS, CLIENTS, TASKS, getAll, getById, add, addMany, update, updateMany, remove, removeMany,
  eventsInRange, eventsBySeries, clientsMap,
} from './db.js';
import {
  $, escapeHtml, emptyState, todayISO, weekStart, weekDays, addDays, fromISO, pad2, fmtFullDate,
  fmtDayMonth, fmtMonthYear, fmtWeekdayShort, fmtTimeRange, fmtMoney, fmtRate, fmtShortDate, addMinutes,
  daysBetween, plural, pluralize, byKey, avatarHTML, clientColorVar, dayMarksHTML,
} from './utils.js';
import { openOverlay, closeOverlay, toast, confirmAction, askSessionNote } from './ui.js';
import { taskCardHTML, onListClick as onTaskListClick } from './tasks.js';
import { createWheel, hourItems, minuteItems, priceItems } from './wheel.js';
import { onSwipe } from './swipe.js';

let view = 'week';                 // 'week' | 'month'
let selectedDate = todayISO();
let visibleWeek = weekStart(todayISO());
let visibleMonth = todayISO().slice(0, 7);
let editing = null;                // редактируемое занятие или null для нового
let priceAuto = true;              // цена считается по ставке, пока её не задали руками
let hourlyRate = 0;                // ставка выбранного клиента за час
let durationMinutes = 60;          // чтобы конец ехал вслед за началом
let wheels = null;                 // колёса формы занятия

/* ===================== Словарь занятий ===================== */

export function eventTitle(event, client) {
  if (client) return client.name;
  if (event.title) return event.title;
  return event.clientId != null ? 'Клиент удалён' : 'Занятие';
}

/**
 * Цветовая метка полоски слева.
 * Оранжевая — сегодня или требует внимания, золотая — скоро, тихая — позже.
 */
function eventMark(event, today = todayISO()) {
  if (event.status === 'cancelled') return 'off';
  if (event.status === 'completed' || event.status === 'no-show') return 'quiet';
  const diff = daysBetween(today, event.date);
  if (diff <= 0) return 'urgent';
  if (diff <= 3) return 'upcoming';
  return 'quiet';
}

function statusChipHTML(event, today = todayISO()) {
  if (event.status === 'completed') return '<span class="chip chip--done">Проведено</span>';
  if (event.status === 'no-show') return '<span class="chip chip--urgent">Не пришёл</span>';
  if (event.status === 'cancelled') return '<span class="chip">Отменено</span>';
  if (event.date < today) return '<span class="chip chip--urgent">Не отмечено</span>';
  return '';
}

/** Цена занятия справа в карточке. */
function priceHTML(event) {
  if (event.price == null || event.price === '') return '';
  const unpaid = event.status === 'completed' && !event.paid;
  return `<span class="price${unpaid ? ' price--unpaid' : ''}">${escapeHtml(fmtMoney(event.price))}</span>`;
}

/** Карточка занятия для списков «Календарь» и «Сегодня». */
export function eventCardHTML(event, client, { showDate = false, actions = '' } = {}) {
  const today = todayISO();
  const sub = [];
  if (showDate) sub.push(fmtShortDate(event.date));
  if (client && client.tag) sub.push(client.tag);
  if (client && event.title) sub.push(event.title);

  return `<div class="card" data-mark="${eventMark(event, today)}" data-dim="${event.status === 'cancelled' ? 1 : 0}">
    <button type="button" class="card-row" data-event-open="${event.id}">
      <span class="card-main">
        <span class="card-time">${escapeHtml(fmtTimeRange(event.startTime, event.endTime))}</span>
        <span class="card-head">
          ${avatarHTML(client)}
          <span class="card-title">${escapeHtml(eventTitle(event, client))}</span>
        </span>
        ${sub.length ? `<span class="card-sub">${escapeHtml(sub.join(' · '))}</span>` : ''}
        ${event.sessionNote ? `<span class="card-note">${escapeHtml(event.sessionNote)}</span>` : ''}
      </span>
      <span class="card-side">
        ${statusChipHTML(event, today)}
        ${priceHTML(event)}
      </span>
    </button>
    ${actions ? `<div class="card-actions">${actions}</div>` : ''}
  </div>`;
}

/** Кнопки «проведено / не пришёл» — показываются, пока занятие не отмечено. */
export function eventActionsHTML(event) {
  if (event.status !== 'scheduled') return '';
  return `<button type="button" class="btn btn-ghost btn-sm" data-event-done="${event.id}">Проведено</button>
    <button type="button" class="btn btn-ghost btn-sm" data-event-noshow="${event.id}">Не пришёл</button>`;
}

/**
 * Сменить статус занятия. После «проведено» предлагаем записать заметку —
 * шаг необязательный и само действие не блокирует.
 */
export async function setEventStatus(eventId, status) {
  const event = await getById(EVENTS, eventId);
  if (!event) return;
  await update(EVENTS, eventId, { status });

  if (status !== 'completed') {
    toast(status === 'no-show' ? 'Отмечено: клиент не пришёл' : 'Статус обновлён');
    return;
  }

  toast('Занятие проведено');
  const client = event.clientId != null ? await getById(CLIENTS, event.clientId) : null;
  const note = await askSessionNote({
    title: 'Что делали?',
    sub: `${eventTitle(event, client)} · ${fmtDayMonth(event.date)}`,
    value: event.sessionNote || '',
  });
  if (note !== null) await update(EVENTS, eventId, { sessionNote: note });
}

/* ===================== Экран календаря ===================== */

export function init() {
  $('#cal-prev').addEventListener('click', () => shift(-1));
  $('#cal-next').addEventListener('click', () => shift(1));

  $('#cal-today').addEventListener('click', () => {
    selectDate(todayISO());
    render();
  });

  $('#cal-view').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button || button.dataset.view === view) return;
    view = button.dataset.view;
    selectDate(selectedDate);
    render();
  });

  const onDayClick = (event) => {
    const cell = event.target.closest('[data-day]');
    if (!cell) return;
    const changed = cell.dataset.day !== selectedDate;
    selectedDate = cell.dataset.day;
    if (view === 'month' && selectedDate.slice(0, 7) !== visibleMonth) {
      visibleMonth = selectedDate.slice(0, 7);
    }
    render().then(() => {
      if (changed) replay($('#cal-day-list'), 'is-fade-in');
    });
  };
  $('#cal-week').addEventListener('click', onDayClick);
  $('#cal-month').addEventListener('click', onDayClick);

  // Свайп по экрану листает период — то же, что стрелки в шапке
  onSwipe($('#screen-calendar'), {
    onLeft: () => shift(1),
    onRight: () => shift(-1),
  });

  $('#cal-add').addEventListener('click', () => openEventForm({ date: selectedDate }));

  $('#cal-day-list').addEventListener('click', onListClick);
  $('#cal-day-list').addEventListener('click', onTaskListClick);

  initForm();
}

/** Шаг назад/вперёд: в режиме недели — на неделю, в режиме месяца — на месяц. */
async function shift(direction) {
  if (view === 'week') {
    visibleWeek = addDays(visibleWeek, 7 * direction);
    selectedDate = addDays(selectedDate, 7 * direction);
  } else {
    const [y, m] = visibleMonth.split('-').map(Number);
    const next = new Date(y, m - 1 + direction, 1);
    visibleMonth = `${next.getFullYear()}-${pad2(next.getMonth() + 1)}`;
    const today = todayISO();
    selectedDate = today.slice(0, 7) === visibleMonth ? today : `${visibleMonth}-01`;
  }

  await render();
  slide(direction > 0 ? 'next' : 'prev');
}

/** Новый период въезжает со стороны движения — так шаг заметен и без стрелок. */
function slide(way) {
  replay(view === 'week' ? $('#cal-week') : $('#cal-month'), `is-slide-${way}`);
  replay($('#cal-day-list'), `is-slide-${way}`);
}

const MOTION_MS = 280; // держим в паре с .is-slide-* в styles.css
const replayTimers = new WeakMap();

/**
 * Перезапустить анимацию на элементе, который её уже проигрывал.
 * Класс снимаем по таймеру, а не по animationend: спрятанный элемент
 * ничего не анимирует, и событие бы не пришло вовсе.
 */
function replay(node, className) {
  clearTimeout(replayTimers.get(node));
  node.classList.remove('is-slide-next', 'is-slide-prev', 'is-fade-in');
  void node.offsetWidth; // иначе браузер не заметит, что класс вернули
  node.classList.add(className);
  replayTimers.set(node, setTimeout(() => node.classList.remove(className), MOTION_MS));
}

/** Выбрать день и подтянуть к нему видимый период. */
export function selectDate(iso) {
  selectedDate = iso;
  visibleWeek = weekStart(iso);
  visibleMonth = iso.slice(0, 7);
}

/** Делегированный обработчик списков занятий — используется и на «Сегодня». */
export async function onListClick(event) {
  const open = event.target.closest('[data-event-open]');
  if (open) {
    openEventForm({ id: Number(open.dataset.eventOpen) });
    return;
  }
  const done = event.target.closest('[data-event-done]');
  if (done) {
    await setEventStatus(Number(done.dataset.eventDone), 'completed');
    return;
  }
  const noshow = event.target.closest('[data-event-noshow]');
  if (noshow) {
    await setEventStatus(Number(noshow.dataset.eventNoshow), 'no-show');
  }
}

/** Дни, которые показывает сетка месяца: полные недели с понедельника. */
function monthGridDays(ym) {
  const [y, m] = ym.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const first = weekStart(`${ym}-01`);
  const last = addDays(weekStart(`${ym}-${pad2(daysInMonth)}`), 6);

  const days = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Точки под числом: занятия — заливкой, задачи — кольцом, цвет — от клиента. */
function marksFor(iso, eventsByDate, tasksByDate, clients) {
  const marks = [];
  (eventsByDate.get(iso) || [])
    .filter((event) => event.status !== 'cancelled')
    .forEach((event) => {
      marks.push({ kind: 'event', color: clientColorVar(clients.get(event.clientId)) });
    });
  (tasksByDate.get(iso) || []).forEach((task) => {
    marks.push({
      kind: 'task',
      color: task.clientId != null ? clientColorVar(clients.get(task.clientId)) : 'var(--upcoming)',
    });
  });
  return marks;
}

export async function render() {
  const today = todayISO();
  const days = view === 'week' ? weekDays(visibleWeek) : monthGridDays(visibleMonth);

  const [events, tasks, clients] = await Promise.all([
    eventsInRange(days[0], days[days.length - 1]),
    getAll(TASKS),
    clientsMap(),
  ]);

  const eventsByDate = groupBy(events, 'date');
  const openTasks = tasks.filter((task) => task.status !== 'done' && task.dueDate);
  const tasksByDate = groupBy(openTasks, 'dueDate');

  renderHeader(days, events, openTasks);

  $('#cal-week').hidden = view !== 'week';
  $('#cal-month').hidden = view !== 'month';
  document.querySelectorAll('#cal-view [data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  });
  // Сетка месяца высокая — прилипшая шапка съела бы список дня
  $('#screen-calendar .app-header').dataset.view = view;

  if (view === 'week') renderWeek(days, today, eventsByDate, tasksByDate, clients);
  else renderMonth(days, today, eventsByDate, tasksByDate, clients);

  renderDay(today, eventsByDate, tasksByDate, clients);
}

function groupBy(items, key) {
  const map = new Map();
  items.forEach((item) => {
    const value = item[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(item);
  });
  return map;
}

function renderHeader(days, events, openTasks) {
  if (view === 'week') {
    $('#cal-title').textContent = fmtMonthYear(selectedDate.slice(0, 7));
    $('#cal-range').textContent = `${fmtDayMonth(days[0])} — ${fmtDayMonth(days[6])}`;
    return;
  }

  const inMonth = events.filter((e) => e.date.slice(0, 7) === visibleMonth && e.status !== 'cancelled');
  const tasksInMonth = openTasks.filter((t) => t.dueDate.slice(0, 7) === visibleMonth);
  const parts = [pluralize(inMonth.length, ['занятие', 'занятия', 'занятий'])];
  if (tasksInMonth.length) parts.push(pluralize(tasksInMonth.length, ['задача', 'задачи', 'задач']));

  $('#cal-title').textContent = fmtMonthYear(visibleMonth);
  $('#cal-range').textContent = parts.join(' · ');
}

function renderWeek(days, today, eventsByDate, tasksByDate, clients) {
  $('#cal-week').innerHTML = days.map((iso) => `
    <button type="button" class="day-cell" data-day="${iso}"
      data-today="${iso === today ? 1 : 0}" aria-pressed="${iso === selectedDate}">
      <span class="day-name">${escapeHtml(fmtWeekdayShort(iso))}</span>
      <span class="day-num">${fromISO(iso).getDate()}</span>
      <span class="day-dots">${dayMarksHTML(marksFor(iso, eventsByDate, tasksByDate, clients))}</span>
    </button>`).join('');
}

function renderMonth(days, today, eventsByDate, tasksByDate, clients) {
  $('#cal-month-weekdays').innerHTML = days.slice(0, 7)
    .map((iso) => `<span class="month-weekday">${escapeHtml(fmtWeekdayShort(iso))}</span>`)
    .join('');

  $('#cal-month-grid').innerHTML = days.map((iso) => `
    <button type="button" class="month-cell" data-day="${iso}"
      data-out="${iso.slice(0, 7) === visibleMonth ? 0 : 1}"
      data-today="${iso === today ? 1 : 0}" aria-pressed="${iso === selectedDate}">
      <span class="day-num">${fromISO(iso).getDate()}</span>
      <span class="day-dots">${dayMarksHTML(marksFor(iso, eventsByDate, tasksByDate, clients))}</span>
    </button>`).join('');
}

function renderDay(today, eventsByDate, tasksByDate, clients) {
  const title = fmtFullDate(selectedDate);
  $('#cal-day-title').textContent = title[0].toUpperCase() + title.slice(1);

  const dayEvents = (eventsByDate.get(selectedDate) || []).sort(byKey('startTime'));
  const dayTasks = tasksByDate.get(selectedDate) || [];

  const parts = [];
  if (dayEvents.length) {
    parts.push(dayEvents.map((event) => eventCardHTML(event, clients.get(event.clientId), {
      actions: event.date <= today ? eventActionsHTML(event) : '',
    })).join(''));
  }
  if (dayTasks.length) {
    parts.push('<p class="block-title">Задачи на этот день</p>');
    parts.push(dayTasks.map((task) => taskCardHTML(task, clients.get(task.clientId))).join(''));
  }
  if (!parts.length) {
    parts.push(emptyState('В этот день пусто', 'Свободный день или ещё ничего не записано'));
  }

  $('#cal-day-list').innerHTML = parts.join('');
}

/* ===================== Форма занятия ===================== */

function toMinutes(hm) {
  const [h, m] = (hm || '0:0').split(':').map(Number);
  return h * 60 + m;
}

function fmtDuration(minutes) {
  if (minutes <= 0) return 'Конец раньше начала';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [];
  if (h) parts.push(`${h} ${plural(h, ['час', 'часа', 'часов'])}`);
  if (m) parts.push(`${m} мин`);
  return `Длительность: ${parts.join(' ')}`;
}

/** «1 ч 30 мин» — короткая длительность для формулы под ценой. */
function shortDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ') || '0 мин';
}

/**
 * Цена по часовой ставке: 1000 ₽/ч × 1,5 ч = 1500 ₽.
 * Округляем до десятков — иначе 40 минут дали бы 666,67 ₽.
 * Без ставки или с отрицательной длительностью считать нечего — вернём null.
 */
function ratePrice(rate, minutes) {
  if (!rate || minutes <= 0) return null;
  return Math.round((rate * minutes) / 60 / 10) * 10;
}

/** Длительность по тому, что сейчас стоит в форме. */
function formMinutes() {
  return toMinutes($('#ef-end').value) - toMinutes($('#ef-start').value);
}

function initForm() {
  const form = $('#event-form');

  form.addEventListener('submit', onSubmit);
  $('#ef-delete').addEventListener('click', onDelete);
  $('#ef-client').addEventListener('change', onClientChange);

  wheels = {
    startH: createWheel($('#ef-start-h'), { items: hourItems(), ariaLabel: 'Час начала', onChange: () => onTimeChange('start') }),
    startM: createWheel($('#ef-start-m'), { items: minuteItems(5), ariaLabel: 'Минуты начала', onChange: () => onTimeChange('start') }),
    endH: createWheel($('#ef-end-h'), { items: hourItems(), ariaLabel: 'Час окончания', onChange: () => onTimeChange('end') }),
    endM: createWheel($('#ef-end-m'), { items: minuteItems(5), ariaLabel: 'Минуты окончания', onChange: () => onTimeChange('end') }),
    price: createWheel($('#ef-price-col'), {
      items: priceItems(),
      ariaLabel: 'Цена занятия',
      onChange: (value) => {
        $('#ef-price').value = value === 0 ? '' : value;
        priceAuto = false;
        updatePriceHint();
      },
    }),
  };

  // Повторный тап по выбранному числу — переход к ручному вводу
  $('#ef-price-col').addEventListener('click', (event) => {
    const item = event.target.closest('.wheel-item');
    if (item && item.getAttribute('aria-selected') === 'true') setPriceMode('manual');
  });
  $('#ef-price').addEventListener('input', () => { priceAuto = false; });
  $('#ef-price-done').addEventListener('click', () => {
    setPriceMode('wheel');
    priceAuto = false;
    updatePriceHint();
  });

  // Возврат к расчёту по ставке после ручной правки
  $('#ef-price-auto').addEventListener('click', () => {
    priceAuto = true;
    refreshAutoPrice();
  });

  $('#ef-repeat').addEventListener('change', syncRepeatUI);
  $('#ef-repeat-mode').addEventListener('change', syncRepeatUI);

  $('#ef-series-cancel').addEventListener('click', () => applyToSeries('cancel'));
  $('#ef-series-delete').addEventListener('click', () => applyToSeries('delete'));
}

/** Колёса времени пишут в скрытые поля — форма читает их как раньше. */
function onTimeChange(which) {
  const value = `${wheels[`${which}H`].getValue()}:${wheels[`${which}M`].getValue()}`;
  $(`#ef-${which}`).value = value;

  if (which === 'start') {
    // Конец едет вслед за началом, сохраняя длительность.
    // Двигаем колёса без анимации: тогда они не присылают onChange
    // и длительность не пересчитывается на полпути.
    const end = addMinutes(value, durationMinutes > 0 ? durationMinutes : 60);
    $('#ef-end').value = end;
    const [h, m] = end.split(':');
    wheels.endH.setValue(h);
    wheels.endM.setValue(m);
  } else {
    durationMinutes = formMinutes();
  }
  updateDurationHint();
  refreshAutoPrice();
}

function updateDurationHint() {
  $('#ef-duration').textContent = fmtDuration(formMinutes());
}

/** Пересчитать цену по ставке — пока пользователь не задал её руками. */
function refreshAutoPrice() {
  const price = priceAuto ? ratePrice(hourlyRate, formMinutes()) : null;
  if (price != null) applyPrice(price);
  updatePriceHint();
}

/** Подсказка под ценой: откуда взялась цифра и как вернуть расчёт по ставке. */
function updatePriceHint() {
  const hint = $('#ef-price-hint');
  const button = $('#ef-price-auto');
  const minutes = formMinutes();
  const auto = ratePrice(hourlyRate, minutes);

  if (auto === null) {
    button.hidden = true;
    if (minutes <= 0) hint.textContent = 'Конец раньше начала — цена по ставке не считается.';
    else if (!$('#ef-client').value) hint.textContent = 'Для дела без клиента цена ставится вручную.';
    else hint.textContent = 'У клиента не задана ставка за час — поставьте цену вручную.';
    return;
  }

  const formula = `${fmtRate(hourlyRate)} × ${shortDuration(minutes)}`;
  if (priceAuto) {
    hint.textContent = `Считается по ставке: ${formula}`;
    button.hidden = true;
    return;
  }
  hint.textContent = `Своя цена. По ставке вышло бы ${fmtMoney(auto)} (${formula}).`;
  button.hidden = false;
}

function setTimeWheels(which, hm) {
  const [h, m] = (hm || '10:00').split(':');
  $(`#ef-${which}`).value = `${h}:${m}`;
  wheels[`${which}H`].setValue(h);
  // Минуты не из сетки (например, 10:07 из старой записи) округляем к ближайшим пяти
  const snapped = pad2(Math.round(Number(m) / 5) * 5 % 60);
  if (!wheels[`${which}M`].setValue(m)) wheels[`${which}M`].setValue(snapped);
}

function setPriceMode(mode) {
  const manual = mode === 'manual';
  $('#ef-price-wheel').hidden = manual;
  $('#ef-price-manual').hidden = !manual;

  if (manual) {
    $('#ef-price').focus();
    $('#ef-price').select();
    return;
  }
  // Возврат к колесу: значение не из сетки добавляем отдельным пунктом
  const raw = $('#ef-price').value;
  applyPrice(raw === '' ? 0 : raw);
}

function syncRepeatUI() {
  const repeat = $('#ef-repeat').value;
  const mode = $('#ef-repeat-mode').value;
  $('#ef-repeat-options').hidden = repeat === 'none';
  $('#ef-count-field').hidden = mode !== 'count';
  $('#ef-until-field').hidden = mode !== 'until';
}

async function onClientChange() {
  const id = $('#ef-client').value;
  const client = id ? await getById(CLIENTS, Number(id)) : null;
  hourlyRate = client ? Number(client.defaultRate) || 0 : 0;
  refreshAutoPrice();
}

function applyPrice(value) {
  const price = Math.max(0, Number(value) || 0);
  $('#ef-price').value = price === 0 ? '' : price;
  wheels.price.setItems(priceItems(20000, 100, price), price);
}

/** Открыть форму: без id — новое занятие, с id — редактирование. */
export async function openEventForm({ id = null, date = null, clientId = null } = {}) {
  const clients = (await getAll(CLIENTS)).sort(byKey('name'));
  const select = $('#ef-client');
  select.innerHTML = ['<option value="">Без клиента — общее дело</option>']
    .concat(clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`))
    .join('');

  editing = id != null ? await getById(EVENTS, Number(id)) : null;
  priceAuto = true;
  setPriceMode('wheel');

  let start = '10:00';
  let end = '11:00';
  let price = 0;

  if (editing) {
    $('#ef-title').textContent = 'Занятие';
    $('#ef-client').value = editing.clientId != null ? String(editing.clientId) : '';
    $('#ef-title-input').value = editing.title || '';
    $('#ef-date').value = editing.date;
    $('#ef-status').value = editing.status || 'scheduled';
    $('#ef-paid').checked = Boolean(editing.paid);
    $('#ef-note').value = editing.sessionNote || '';
    $('#ef-delete').hidden = false;
    $('#ef-repeat-block').hidden = true;
    start = editing.startTime || start;
    end = editing.endTime || addMinutes(start, 60);
    price = Number(editing.price) || 0;

    const client = editing.clientId != null ? clients.find((c) => c.id === editing.clientId) : null;
    hourlyRate = client ? Number(client.defaultRate) || 0 : 0;
    // Цена, совпадающая с расчётом по ставке, считается автоматической: подвинули
    // время — она поедет следом. Заданную вручную цену не трогаем.
    const auto = ratePrice(hourlyRate, toMinutes(end) - toMinutes(start));
    priceAuto = auto === null || price === 0 || price === auto;

    await renderSeriesBlock(editing);
  } else {
    const startDate = date || selectedDate || todayISO();
    const client = clientId != null ? clients.find((c) => c.id === Number(clientId)) : null;

    $('#ef-title').textContent = 'Новое занятие';
    $('#ef-client').value = clientId != null ? String(clientId) : '';
    $('#ef-title-input').value = '';
    $('#ef-date').value = startDate;
    $('#ef-status').value = 'scheduled';
    $('#ef-paid').checked = false;
    $('#ef-note').value = '';
    $('#ef-delete').hidden = true;
    $('#ef-repeat-block').hidden = false;
    $('#ef-repeat').value = 'none';
    $('#ef-repeat-mode').value = 'count';
    $('#ef-repeat-count').value = '8';
    $('#ef-repeat-until').value = addDays(startDate, 56);
    $('#ef-series-block').hidden = true;
    hourlyRate = client ? Number(client.defaultRate) || 0 : 0;
    price = ratePrice(hourlyRate, toMinutes(end) - toMinutes(start)) || 0;
  }

  durationMinutes = Math.max(toMinutes(end) - toMinutes(start), 0) || 60;
  syncRepeatUI();

  // Колёса выставляем после показа экрана: у скрытого элемента нет прокрутки
  openOverlay($('#screen-event-form'));
  setTimeWheels('start', start);
  setTimeWheels('end', end);
  applyPrice(price);
  updateDurationHint();
  updatePriceHint(); // всё выставленное выше — не ручная правка
}

async function renderSeriesBlock(event) {
  const block = $('#ef-series-block');
  if (!event.seriesId) {
    block.hidden = true;
    return;
  }
  const series = (await eventsBySeries(event.seriesId)).sort(byKey('date'));
  const future = series.filter((e) => e.date >= event.date);
  block.hidden = false;
  $('#ef-series-info').textContent =
    `Повторяющееся занятие: ${pluralize(series.length, ['занятие', 'занятия', 'занятий'])} `
    + `по ${fmtDayMonth(series[series.length - 1].date)}. `
    + `Впереди ${pluralize(future.length, ['занятие', 'занятия', 'занятий'])}.`;
}

function readForm() {
  const clientValue = $('#ef-client').value;
  const price = $('#ef-price').value;
  return {
    clientId: clientValue ? Number(clientValue) : null,
    title: $('#ef-title-input').value.trim(),
    date: $('#ef-date').value,
    startTime: $('#ef-start').value,
    endTime: $('#ef-end').value,
    status: $('#ef-status').value,
    price: price === '' ? null : Number(price),
    paid: $('#ef-paid').checked,
    sessionNote: $('#ef-note').value.trim(),
  };
}

/** Даты повторов: N занятий или до указанной даты, шаг 7 или 14 дней. */
function repeatDates(startIso) {
  const repeat = $('#ef-repeat').value;
  if (repeat === 'none') return [startIso];

  const step = repeat === 'biweekly' ? 14 : 7;
  const mode = $('#ef-repeat-mode').value;
  const dates = [startIso];

  if (mode === 'count') {
    const total = Math.min(Math.max(Number($('#ef-repeat-count').value) || 1, 1), 60);
    for (let i = 1; i < total; i += 1) dates.push(addDays(startIso, step * i));
    return dates;
  }

  const until = $('#ef-repeat-until').value;
  if (!until || until <= startIso) return dates;
  let next = addDays(startIso, step);
  while (next <= until && dates.length < 100) {
    dates.push(next);
    next = addDays(next, step);
  }
  return dates;
}

async function onSubmit(event) {
  event.preventDefault();
  const data = readForm();

  if (!data.date || !data.startTime) {
    toast('Нужны дата и время начала');
    return;
  }
  if (data.clientId == null && !data.title) {
    toast('Выберите клиента или впишите название');
    return;
  }
  if (data.endTime && data.endTime < data.startTime) {
    toast('Конец занятия раньше начала');
    return;
  }

  if (editing) {
    await update(EVENTS, editing.id, data);
    toast('Занятие сохранено');
    closeOverlay();
    return;
  }

  const dates = repeatDates(data.date);
  if (dates.length === 1) {
    await add(EVENTS, data);
    toast('Занятие добавлено');
  } else {
    const seriesId = `s${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await addMany(EVENTS, dates.map((date) => ({ ...data, date, seriesId })));
    toast(`Добавлено ${pluralize(dates.length, ['занятие', 'занятия', 'занятий'])}`);
  }
  closeOverlay();
}

async function onDelete() {
  if (!editing) return;
  const ok = await confirmAction({
    title: 'Удалить занятие?',
    text: 'Запись исчезнет из календаря и из доходов.',
    okText: 'Удалить',
    danger: true,
  });
  if (!ok) return;
  await remove(EVENTS, editing.id);
  toast('Занятие удалено');
  closeOverlay();
}

/** Действия над «хвостом» серии: отменить или удалить все будущие занятия. */
async function applyToSeries(action) {
  if (!editing || !editing.seriesId) return;

  const series = await eventsBySeries(editing.seriesId);
  const future = series.filter((e) => e.date >= editing.date);
  const ids = future.map((e) => e.id);
  const count = pluralize(ids.length, ['занятие', 'занятия', 'занятий']);

  const ok = await confirmAction({
    title: action === 'cancel' ? 'Отменить будущие занятия?' : 'Удалить будущие занятия?',
    text: action === 'cancel'
      ? `${count} с ${fmtDayMonth(editing.date)} получат статус «Отменено». Проведённые останутся как есть.`
      : `${count} с ${fmtDayMonth(editing.date)} будут удалены безвозвратно.`,
    okText: action === 'cancel' ? 'Отменить занятия' : 'Удалить',
    danger: true,
  });
  if (!ok) return;

  if (action === 'cancel') {
    const scheduled = future.filter((e) => e.status === 'scheduled').map((e) => e.id);
    await updateMany(EVENTS, scheduled, { status: 'cancelled' });
    toast('Будущие занятия отменены');
  } else {
    await removeMany(EVENTS, ids);
    toast('Будущие занятия удалены');
  }
  closeOverlay();
}
