// today.js — стартовый экран: что происходит сегодня и сколько заработано
// в этом месяце. Отсюда занятие можно отметить проведённым, не заходя в календарь.

import { TASKS, getAll, eventsOnDate, clientsMap } from './db.js';
import {
  $, emptyState, todayISO, currentMonthKey, fmtFullDate, fmtMoney, byKey,
} from './utils.js';
import { eventCardHTML, eventActionsHTML, onListClick as onEventListClick } from './calendar.js';
import { taskCardHTML, sortTasks, onListClick as onTaskListClick } from './tasks.js';
import { monthTotals } from './income.js';

let ctx = null;

export function init(context) {
  ctx = context;

  $('#today-events').addEventListener('click', onEventListClick);
  $('#today-tasks').addEventListener('click', onTaskListClick);
  $('#today-money').addEventListener('click', () => ctx.openIncome());
  $('#open-settings').addEventListener('click', () => ctx.openSettings());
}

export async function render() {
  const today = todayISO();
  const [events, tasks, clients, totals] = await Promise.all([
    eventsOnDate(today),
    getAll(TASKS),
    clientsMap(),
    monthTotals(currentMonthKey()),
  ]);

  const dateLine = fmtFullDate(today);
  $('#today-date').textContent = dateLine[0].toUpperCase() + dateLine.slice(1);

  $('#today-money-paid').textContent = fmtMoney(totals.paid);
  $('#today-money-unpaid').textContent = fmtMoney(totals.unpaid);

  // Занятия по времени; отменённые уходят вниз списка
  const dayEvents = events.sort(byKey('startTime'));
  const active = dayEvents.filter((e) => e.status !== 'cancelled');
  const cancelled = dayEvents.filter((e) => e.status === 'cancelled');

  $('#today-events').innerHTML = dayEvents.length
    ? [...active, ...cancelled]
      .map((e) => eventCardHTML(e, clients.get(e.clientId), { actions: eventActionsHTML(e) }))
      .join('')
    : emptyState('На сегодня занятий нет', 'Свободный день — или запланируйте занятие кнопкой «+»');

  // Задачи: сначала просроченные, затем сегодняшние
  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const forToday = open.filter((t) => t.dueDate === today);
  const visible = [...sortTasks(overdue), ...sortTasks(forToday)];

  $('#today-tasks').innerHTML = visible.length
    ? visible.map((t) => taskCardHTML(t, clients.get(t.clientId))).join('')
    : emptyState(
      open.length ? 'На сегодня задач нет' : 'Задач нет',
      open.length ? `Всего в работе: ${open.length}` : 'Всё разобрано',
    );
}
