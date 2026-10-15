// clients.js — список клиентов, карточка клиента с историей занятий
// и форма клиента. Заметки здесь — долгоживущий контекст, а не журнал:
// журнал по датам — это история занятий ниже на том же экране.

import {
  CLIENTS, EVENTS, TASKS, getAll, getById, add, update, updateMany, remove,
  eventsByClient, tasksByClient,
} from './db.js';
import {
  $, escapeHtml, emptyState, todayISO, daysBetween, fmtRelativeDay, fmtShortDate,
  fmtTimeRange, fmtMoney, fmtRate, pluralize, byKey, debounce, CLIENT_COLORS, avatarHTML,
} from './utils.js';
import { openOverlay, closeOverlay, toast, confirmAction } from './ui.js';
import { eventCardHTML, eventActionsHTML, onListClick as onEventListClick, openEventForm } from './calendar.js';
import { taskCardHTML, sortTasks, onListClick as onTaskListClick } from './tasks.js';

let search = '';
let editing = null;         // клиент в форме
let openedClientId = null;  // клиент, чья карточка открыта
let afterFormClose = null;  // что сделать, когда форма действительно закроется
let pickedColor = '';       // цвет метки в открытой форме

// Подписи для читалок экрана — цвет должен быть понятен не только глазами
const COLOR_NAMES = {
  teal: 'бирюзовый',
  sky: 'синий',
  violet: 'фиолетовый',
  rose: 'розовый',
  amber: 'янтарный',
  lime: 'зелёный',
  clay: 'терракотовый',
  slate: 'серый',
};

/* ===================== Список клиентов ===================== */

export function init() {
  const onSearch = debounce((value) => {
    search = value.trim().toLowerCase();
    render();
  }, 150);

  $('#client-search').addEventListener('input', (event) => onSearch(event.target.value));

  $('#client-list').addEventListener('click', (event) => {
    const card = event.target.closest('[data-client-open]');
    if (card) openClientCard(Number(card.dataset.clientOpen));
  });

  initCardScreen();
  initForm();
}

function matches(client, query) {
  if (!query) return true;
  const digits = query.replace(/\D/g, '');
  const phone = (client.phone || '').replace(/\D/g, '');
  return client.name.toLowerCase().includes(query)
    || (client.tag || '').toLowerCase().includes(query)
    || (digits.length >= 2 && phone.includes(digits));
}

export async function render() {
  const today = todayISO();
  const [clients, events] = await Promise.all([getAll(CLIENTS), getAll(EVENTS)]);

  // Ближайшее занятие по каждому клиенту — подсказка прямо в списке
  const nextByClient = new Map();
  events
    .filter((e) => e.status === 'scheduled' && e.date >= today && e.clientId != null)
    .sort(byKey('date', 'startTime'))
    .forEach((e) => {
      if (!nextByClient.has(e.clientId)) nextByClient.set(e.clientId, e);
    });

  $('#clients-count').textContent = clients.length
    ? pluralize(clients.length, ['клиент', 'клиента', 'клиентов'])
    : 'Пока никого';

  const visible = clients.filter((c) => matches(c, search)).sort(byKey('name'));

  if (!visible.length) {
    $('#client-list').innerHTML = clients.length
      ? emptyState('Никого не нашли', 'Попробуйте другое имя или телефон')
      : emptyState('Клиентов пока нет', 'Добавьте первого кнопкой «+»');
    return;
  }

  $('#client-list').innerHTML = visible.map((client) => {
    const next = nextByClient.get(client.id);
    const diff = next ? daysBetween(today, next.date) : null;
    const mark = !next ? 'off' : diff === 0 ? 'urgent' : diff <= 3 ? 'upcoming' : 'quiet';
    const nextLine = next
      ? `${fmtRelativeDay(next.date)} · ${escapeHtml(next.startTime)}`
      : 'Занятия не запланированы';
    const meta = [client.phone].filter(Boolean).join(' · ');

    return `<div class="card" data-mark="${mark}">
      <button type="button" class="card-row" data-client-open="${client.id}">
        <span class="card-main">
          <span class="card-head">
            ${avatarHTML(client)}
            <span class="card-title">${escapeHtml(client.name)}</span>
          </span>
          ${meta ? `<span class="card-sub">${escapeHtml(meta)}</span>` : ''}
          <span class="card-sub">${nextLine}</span>
        </span>
        <span class="card-side">
          ${client.tag ? `<span class="chip chip--tag">${escapeHtml(client.tag)}</span>` : ''}
          ${client.defaultRate ? `<span class="price">${escapeHtml(fmtRate(client.defaultRate))}</span>` : ''}
        </span>
      </button>
    </div>`;
  }).join('');
}

/* ===================== Карточка клиента ===================== */

function initCardScreen() {
  $('#cli-edit').addEventListener('click', () => {
    if (openedClientId != null) openClientForm(openedClientId);
  });
  $('#cli-add-event').addEventListener('click', () => {
    if (openedClientId != null) openEventForm({ clientId: openedClientId });
  });
  $('#cli-upcoming').addEventListener('click', onEventListClick);
  $('#cli-history').addEventListener('click', onEventListClick);
  $('#cli-tasks').addEventListener('click', onTaskListClick);
}

export async function openClientCard(id) {
  openedClientId = Number(id);
  await renderClientCard();
  openOverlay($('#screen-client'), { onClose: () => { openedClientId = null; } });
}

/** Перерисовка открытой карточки — вызывается и после изменений данных. */
export async function renderClientCard() {
  if (openedClientId == null) return;

  const client = await getById(CLIENTS, openedClientId);
  if (!client) {
    closeOverlay();
    return;
  }

  const today = todayISO();
  const [events, tasks] = await Promise.all([
    eventsByClient(client.id),
    tasksByClient(client.id),
  ]);

  $('#cli-name').textContent = client.name;
  $('#cli-tag').textContent = client.tag || 'Клиент';
  $('#cli-avatar').innerHTML = avatarHTML(client, { large: true });

  // Статистика надёжности
  const completed = events.filter((e) => e.status === 'completed');
  const noShow = events.filter((e) => e.status === 'no-show');
  const attended = completed.length + noShow.length;
  const rate = attended ? Math.round((completed.length / attended) * 100) : null;

  $('#cli-stats').innerHTML = `
    <div class="stat">
      <p class="stat-value">${completed.length}</p>
      <p class="stat-label">Проведено</p>
    </div>
    <div class="stat${noShow.length ? ' stat--warn' : ''}">
      <p class="stat-value">${noShow.length}</p>
      <p class="stat-label">Не пришёл</p>
    </div>
    <div class="stat">
      <p class="stat-value">${rate === null ? '—' : `${rate}%`}</p>
      <p class="stat-label">Приходит</p>
    </div>`;

  // Контакты и ставка
  const contact = [];
  if (client.phone) {
    contact.push(`<a class="panel-text" href="tel:${escapeHtml(client.phone.replace(/\s/g, ''))}">${escapeHtml(client.phone)}</a>`);
  } else {
    contact.push('<p class="panel-text panel-text--muted">Телефон не указан</p>');
  }
  contact.push(`<p class="hint">Ставка за час: ${client.defaultRate ? escapeHtml(fmtRate(client.defaultRate)) : 'не задана'}</p>`);
  $('#cli-contact').innerHTML = contact.join('');

  $('#cli-notes').innerHTML = client.notes
    ? `<p class="panel-text panel-note">${escapeHtml(client.notes)}</p>`
    : '<p class="panel-text panel-text--muted">Заметок пока нет — сюда удобно записать цели, особенности и договорённости.</p>';

  // Ближайшие занятия
  const upcoming = events
    .filter((e) => e.status === 'scheduled' && e.date >= today)
    .sort(byKey('date', 'startTime'))
    .slice(0, 5);
  $('#cli-upcoming').innerHTML = upcoming.length
    ? upcoming.map((e) => eventCardHTML(e, client, {
      showDate: true,
      actions: e.date <= today ? eventActionsHTML(e) : '',
    })).join('')
    : emptyState('Занятий впереди нет', 'Запланируйте следующее — кнопка выше');

  // История: что уже прошло, свежее сверху
  const history = events
    .filter((e) => e.status === 'completed' || e.status === 'no-show')
    .sort(byKey('date', 'startTime'))
    .reverse()
    .slice(0, 30);
  $('#cli-history').innerHTML = history.length
    ? history.map((e) => historyRowHTML(e)).join('')
    : emptyState('История пуста', 'Здесь появятся проведённые занятия с заметками');

  // Задачи по клиенту
  const openTasks = sortTasks(tasks.filter((t) => t.status !== 'done'));
  $('#cli-tasks-block').hidden = openTasks.length === 0;
  $('#cli-tasks').innerHTML = openTasks.map((t) => taskCardHTML(t, client, { showClient: false })).join('');
}

function historyRowHTML(event) {
  const noShow = event.status === 'no-show';
  return `<div class="card" data-mark="${noShow ? 'urgent' : 'quiet'}">
    <button type="button" class="card-row" data-event-open="${event.id}">
      <span class="card-main">
        <span class="card-time">${escapeHtml(fmtShortDate(event.date))} · ${escapeHtml(fmtTimeRange(event.startTime, event.endTime))}</span>
        ${noShow ? '<span class="card-title">Клиент не пришёл</span>' : ''}
        ${event.sessionNote
          ? `<span class="card-note">${escapeHtml(event.sessionNote)}</span>`
          : (noShow ? '' : '<span class="card-note">Без заметки</span>')}
      </span>
      <span class="card-side">
        ${event.price != null && event.price !== ''
          ? `<span class="price${event.paid ? '' : ' price--unpaid'}">${escapeHtml(fmtMoney(event.price))}</span>`
          : ''}
        ${event.price != null && event.price !== '' && !event.paid && !noShow
          ? '<span class="chip chip--upcoming">Не оплачено</span>' : ''}
      </span>
    </button>
  </div>`;
}

/* ===================== Форма клиента ===================== */

function initForm() {
  $('#client-form').addEventListener('submit', onSubmit);
  $('#cf-delete').addEventListener('click', onDelete);

  $('#cf-colors').addEventListener('click', (event) => {
    const dot = event.target.closest('[data-color]');
    if (!dot) return;
    pickedColor = dot.dataset.color;
    renderColorPicker();
  });
}

/** Палитра меток: кружки с галочкой на выбранном. */
function renderColorPicker() {
  const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const none = `<button type="button" class="color-dot color-dot--none" data-color=""
    aria-pressed="${pickedColor === ''}" aria-label="Без цвета">${check}</button>`;

  const dots = CLIENT_COLORS.map((name) => `<button type="button" class="color-dot" data-color="${name}"
    style="--dot: var(--c-${name})" aria-pressed="${pickedColor === name}"
    aria-label="Цвет ${COLOR_NAMES[name]}">${check}</button>`);

  $('#cf-colors').innerHTML = [none, ...dots].join('');
}

export async function openClientForm(id = null) {
  const clients = await getAll(CLIENTS);
  editing = id != null ? await getById(CLIENTS, Number(id)) : null;

  // Подсказки направлений — то, что уже использовалось раньше
  const tags = [...new Set(clients.map((c) => c.tag).filter(Boolean))].sort();
  $('#tag-suggestions').innerHTML = tags.map((t) => `<option value="${escapeHtml(t)}"></option>`).join('');

  if (editing) {
    $('#cf-title').textContent = 'Клиент';
    $('#cf-name').value = editing.name || '';
    $('#cf-phone').value = editing.phone || '';
    $('#cf-tag').value = editing.tag || '';
    $('#cf-rate').value = editing.defaultRate ?? '';
    $('#cf-notes').value = editing.notes || '';
    $('#cf-delete').hidden = false;
    pickedColor = CLIENT_COLORS.includes(editing.color) ? editing.color : '';
  } else {
    $('#cf-title').textContent = 'Новый клиент';
    $('#cf-name').value = '';
    $('#cf-phone').value = '';
    $('#cf-tag').value = '';
    $('#cf-rate').value = '';
    $('#cf-notes').value = '';
    $('#cf-delete').hidden = true;
    // Новому клиенту предлагаем следующий цвет по кругу — меньше ручной работы
    pickedColor = CLIENT_COLORS[clients.length % CLIENT_COLORS.length];
  }
  renderColorPicker();

  openOverlay($('#screen-client-form'), {
    focus: editing ? null : '#cf-name',
    // Переход на карточку нового клиента ждёт закрытия формы: иначе
    // история браузера получит два действия одновременно.
    onClose: () => {
      const next = afterFormClose;
      afterFormClose = null;
      if (next) next();
    },
  });
}

async function onSubmit(event) {
  event.preventDefault();

  const name = $('#cf-name').value.trim();
  if (!name) {
    toast('Как зовут клиента?');
    $('#cf-name').focus();
    return;
  }

  const rate = $('#cf-rate').value;
  const data = {
    name,
    phone: $('#cf-phone').value.trim(),
    tag: $('#cf-tag').value.trim(),
    defaultRate: rate === '' ? null : Number(rate),
    color: pickedColor || null,
    notes: $('#cf-notes').value.trim(),
  };

  if (editing) {
    await update(CLIENTS, editing.id, data);
    toast('Клиент сохранён');
    closeOverlay();
  } else {
    const id = await add(CLIENTS, data);
    toast('Клиент добавлен');
    afterFormClose = () => openClientCard(id);
    closeOverlay();
  }
}

/**
 * Удаление клиента не должно рвать историю доходов, поэтому занятия
 * остаются в календаре: они просто теряют связь и получают имя в названии.
 */
async function onDelete() {
  if (!editing) return;

  const [events, tasks] = await Promise.all([
    eventsByClient(editing.id),
    tasksByClient(editing.id),
  ]);

  // Имя не склоняем — оно идёт отдельной строкой, а не внутри вопроса
  const ok = await confirmAction({
    title: 'Удалить клиента?',
    text: events.length
      ? `${editing.name}. Карточка и заметки исчезнут, а ${pluralize(events.length, ['занятие останется', 'занятия останутся', 'занятий останутся'])} в календаре и в доходах — под именем клиента.`
      : `${editing.name}. Карточка и заметки исчезнут безвозвратно.`,
    okText: 'Удалить',
    danger: true,
  });
  if (!ok) return;

  const named = events.filter((e) => e.title).map((e) => e.id);
  const unnamed = events.filter((e) => !e.title).map((e) => e.id);
  await updateMany(EVENTS, named, { clientId: null });
  await updateMany(EVENTS, unnamed, { clientId: null, title: editing.name });
  await updateMany(TASKS, tasks.map((t) => t.id), { clientId: null });
  await remove(CLIENTS, editing.id);

  toast('Клиент удалён');
  openedClientId = null;
  closeOverlay(2); // форма и карточка под ней
}
