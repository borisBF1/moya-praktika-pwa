// tasks.js — свои дела специалиста: список, фильтры и форма задачи.
// Задача может быть привязана к клиенту, но чаще это просто «своё дело».

import { TASKS, CLIENTS, getAll, getById, add, update, remove, clientsMap } from './db.js';
import {
  $, escapeHtml, emptyState, todayISO, addDays, daysBetween, fmtRelativeDay, fmtFullDate,
  plural, pluralize, byKey, avatarHTML,
} from './utils.js';
import { openOverlay, closeOverlay, toast, confirmAction } from './ui.js';
import { createWheel } from './wheel.js';

let filter = 'all';
let editing = null;
let dueWheel = null;

/* ===================== Представление задачи ===================== */

/** Метка полоски: просрочено и сегодня — оранжевые, ближайшие дни — золотые. */
function taskMark(task, today = todayISO()) {
  if (task.status === 'done') return 'off';
  if (!task.dueDate) return 'quiet';
  const diff = daysBetween(today, task.dueDate);
  if (diff <= 0) return 'urgent';
  if (diff <= 3) return 'upcoming';
  return 'quiet';
}

function dueLabel(task, today) {
  if (!task.dueDate) return '';
  if (task.status !== 'done' && task.dueDate < today) return `Просрочено · ${fmtRelativeDay(task.dueDate)}`;
  return `Срок: ${fmtRelativeDay(task.dueDate, { capital: false })}`;
}

export function taskCardHTML(task, client, { showClient = true } = {}) {
  const today = todayISO();
  const done = task.status === 'done';
  const sub = [];
  const due = dueLabel(task, today);
  if (due) sub.push(due);
  if (showClient && client) sub.push(client.name);

  return `<div class="card${done ? ' card-strike' : ''}" data-mark="${taskMark(task, today)}" data-dim="${done ? 1 : 0}">
    <div class="card-row">
      <button type="button" class="task-check" data-task-toggle="${task.id}"
        aria-pressed="${done}" aria-label="${done ? 'Вернуть в работу' : 'Отметить выполненной'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      </button>
      <button type="button" class="card-main" data-task-open="${task.id}">
        <span class="card-head">
          ${showClient ? avatarHTML(client) : ''}
          <span class="card-title card-title--wrap">${escapeHtml(task.title)}</span>
        </span>
        ${sub.length ? `<span class="card-sub">${escapeHtml(sub.join(' · '))}</span>` : ''}
        ${task.description ? `<span class="card-note">${escapeHtml(task.description)}</span>` : ''}
      </button>
    </div>
  </div>`;
}

/** Переключить «сделано / не сделано» одним тапом. */
async function toggleTask(id) {
  const task = await getById(TASKS, id);
  if (!task) return;
  const done = task.status === 'done';
  await update(TASKS, id, {
    status: done ? 'todo' : 'done',
    completedAt: done ? null : new Date().toISOString(),
  });
  toast(done ? 'Вернули в работу' : 'Задача выполнена');
}

/** Делегированный обработчик для любого списка задач. */
export async function onListClick(event) {
  const toggle = event.target.closest('[data-task-toggle]');
  if (toggle) {
    await toggleTask(Number(toggle.dataset.taskToggle));
    return;
  }
  const open = event.target.closest('[data-task-open]');
  if (open) openTaskForm({ id: Number(open.dataset.taskOpen) });
}

/* ===================== Сортировка ===================== */

/** Сначала просроченные и ближайшие сроки, задачи без срока — в конце. */
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const ad = a.dueDate || '9999-12-31';
    const bd = b.dueDate || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
  });
}

/* ===================== Экран задач ===================== */

export function init() {
  $('#task-filter').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    filter = button.dataset.filter;
    render();
  });

  $('#task-list').addEventListener('click', onListClick);

  initForm();
}

export async function render() {
  const today = todayISO();
  const [tasks, clients] = await Promise.all([getAll(TASKS), clientsMap()]);

  document.querySelectorAll('#task-filter [data-filter]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  });

  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const counts = [pluralize(open.length, ['открытая', 'открытых', 'открытых'])];
  if (overdue.length) counts.push(`${overdue.length} просрочено`);
  $('#tasks-count').textContent = counts.join(' · ');

  let visible = open;
  if (filter === 'today') visible = open.filter((t) => t.dueDate === today);
  if (filter === 'overdue') visible = overdue;

  const parts = [];
  if (visible.length) {
    parts.push(sortTasks(visible).map((t) => taskCardHTML(t, clients.get(t.clientId))).join(''));
  } else {
    parts.push(emptyState(
      filter === 'overdue' ? 'Просроченного нет' : filter === 'today' ? 'На сегодня задач нет' : 'Задач нет',
      filter === 'all' ? 'Добавьте первое дело кнопкой «+»' : 'Хороший знак',
    ));
  }

  // Выполненные показываем только во вкладке «Все» — коротким хвостом
  if (filter === 'all') {
    const done = tasks
      .filter((t) => t.status === 'done')
      .sort(byKey('completedAt'))
      .reverse()
      .slice(0, 15);
    if (done.length) {
      parts.push('<p class="block-title">Выполненные</p>');
      parts.push(done.map((t) => taskCardHTML(t, clients.get(t.clientId))).join(''));
    }
  }

  $('#task-list').innerHTML = parts.join('');
}

/* ===================== Форма задачи ===================== */

function initForm() {
  $('#task-form').addEventListener('submit', onSubmit);
  $('#tf-delete').addEventListener('click', onDelete);

  dueWheel = createWheel($('#tf-due-col'), {
    items: dueItems(),
    ariaLabel: 'Срок задачи',
    onChange: (value) => {
      $('#tf-due').value = value;
      updateDueHint();
    },
  });

  // Точный день — через календарь; обратно возвращаемся к колесу
  $('#tf-due-pick').addEventListener('click', () => setDueMode('calendar'));
  $('#tf-due-done').addEventListener('click', () => setDueMode('wheel'));
  $('#tf-due').addEventListener('change', updateDueHint);
}

/**
 * Значения колеса срока: «Без срока», затем дни от сегодня.
 * Дата вне этого диапазона (просроченная или далёкая) добавляется
 * отдельным пунктом на своё место — чтобы её было видно в колесе.
 */
function dueItems(extraIso = null, days = 60) {
  const today = todayISO();
  const items = [{ value: '', label: 'Без срока' }];

  for (let day = 0; day <= days; day += 1) {
    const iso = addDays(today, day);
    items.push({ value: iso, label: dayOffsetLabel(day) });
  }

  if (extraIso && !items.some((item) => item.value === extraIso)) {
    const entry = { value: extraIso, label: fmtRelativeDay(extraIso) };
    const index = items.findIndex((item) => item.value && item.value > extraIso);
    if (index < 0) items.push(entry);
    else items.splice(index, 0, entry);
  }
  return items;
}

function dayOffsetLabel(day) {
  if (day === 0) return 'Сегодня';
  if (day === 1) return 'Завтра';
  if (day === 2) return 'Послезавтра';
  return `Через ${day} ${plural(day, ['день', 'дня', 'дней'])}`;
}

function updateDueHint() {
  const value = $('#tf-due').value;
  if (!value) {
    $('#tf-due-hint').textContent = 'Задача без срока — не попадёт в «Сегодня» и «Просрочено».';
    return;
  }
  const full = fmtFullDate(value);
  $('#tf-due-hint').textContent = full[0].toUpperCase() + full.slice(1);
}

function setDueMode(mode) {
  const calendar = mode === 'calendar';
  $('#tf-due-row').hidden = calendar;
  $('#tf-due-manual').hidden = !calendar;

  if (calendar) {
    const input = $('#tf-due');
    input.focus();
    try {
      input.showPicker();
    } catch (err) {
      /* браузер без showPicker — пользователь откроет календарь сам */
    }
    return;
  }
  applyDue($('#tf-due').value);
}

/** Поставить срок и в поле, и в колесо. */
function applyDue(iso) {
  $('#tf-due').value = iso || '';
  dueWheel.setItems(dueItems(iso || null), iso || '');
  updateDueHint();
}

export async function openTaskForm({ id = null, clientId = null, dueDate = null } = {}) {
  const clients = (await getAll(CLIENTS)).sort(byKey('name'));
  $('#tf-client').innerHTML = ['<option value="">Без клиента</option>']
    .concat(clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`))
    .join('');

  editing = id != null ? await getById(TASKS, Number(id)) : null;
  let due = dueDate || '';

  if (editing) {
    $('#tf-title').textContent = 'Задача';
    $('#tf-title-input').value = editing.title || '';
    $('#tf-desc').value = editing.description || '';
    $('#tf-client').value = editing.clientId != null ? String(editing.clientId) : '';
    $('#tf-done').checked = editing.status === 'done';
    $('#tf-delete').hidden = false;
    due = editing.dueDate || '';
  } else {
    $('#tf-title').textContent = 'Новая задача';
    $('#tf-title-input').value = '';
    $('#tf-desc').value = '';
    $('#tf-client').value = clientId != null ? String(clientId) : '';
    $('#tf-done').checked = false;
    $('#tf-delete').hidden = true;
  }

  setDueMode('wheel');
  // Колесо выставляем после показа экрана: у скрытого элемента нет прокрутки
  openOverlay($('#screen-task-form'), { focus: editing ? null : '#tf-title-input' });
  applyDue(due);
}

async function onSubmit(event) {
  event.preventDefault();

  const title = $('#tf-title-input').value.trim();
  if (!title) {
    toast('Впишите, что нужно сделать');
    $('#tf-title-input').focus();
    return;
  }

  const clientValue = $('#tf-client').value;
  const done = $('#tf-done').checked;
  const data = {
    title,
    description: $('#tf-desc').value.trim(),
    dueDate: $('#tf-due').value || null,
    clientId: clientValue ? Number(clientValue) : null,
    status: done ? 'done' : 'todo',
    completedAt: done ? (editing && editing.completedAt) || new Date().toISOString() : null,
  };

  if (editing) {
    await update(TASKS, editing.id, data);
    toast('Задача сохранена');
  } else {
    await add(TASKS, data);
    toast('Задача добавлена');
  }
  closeOverlay();
}

async function onDelete() {
  if (!editing) return;
  const ok = await confirmAction({
    title: 'Удалить задачу?',
    text: editing.title,
    okText: 'Удалить',
    danger: true,
  });
  if (!ok) return;
  await remove(TASKS, editing.id);
  toast('Задача удалена');
  closeOverlay();
}
