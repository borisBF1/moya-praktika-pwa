// income.js — небольшая бухгалтерия заработка: сколько заработано за месяц
// и что ещё не оплачено. Считаем только проведённые занятия с ценой.

import { EVENTS, update, eventsInRange, clientsMap } from './db.js';
import {
  $, escapeHtml, emptyState, currentMonthKey, monthBounds, shiftMonth, fmtMonthYear,
  fmtShortDate, fmtMoney, pluralize, byKey, avatarHTML,
} from './utils.js';
import { toast } from './ui.js';
import { eventTitle, openEventForm } from './calendar.js';

let month = currentMonthKey();

/* ===================== Подсчёт ===================== */

/** Итоги месяца — используются и на экране «Сегодня». */
export async function monthTotals(ym) {
  const { from, to } = monthBounds(ym);
  const events = await eventsInRange(from, to);
  const completed = events.filter((e) => e.status === 'completed');

  let paid = 0;
  let unpaid = 0;
  let unpriced = 0;

  completed.forEach((event) => {
    const price = Number(event.price) || 0;
    if (event.price == null || event.price === '') unpriced += 1;
    if (event.paid) paid += price;
    else unpaid += price;
  });

  return { paid, unpaid, unpriced, count: completed.length, events: completed };
}

/* ===================== Экран ===================== */

export function init() {
  $('#inc-prev').addEventListener('click', () => { month = shiftMonth(month, -1); render(); });
  $('#inc-next').addEventListener('click', () => { month = shiftMonth(month, 1); render(); });

  $('#inc-list').addEventListener('click', async (event) => {
    const toggle = event.target.closest('[data-paid-toggle]');
    if (toggle) {
      const paid = toggle.dataset.paid === '1';
      await update(EVENTS, Number(toggle.dataset.paidToggle), { paid: !paid });
      toast(paid ? 'Оплата снята' : 'Отмечено как оплаченное');
      return;
    }
    const open = event.target.closest('[data-event-open]');
    if (open) openEventForm({ id: Number(open.dataset.eventOpen) });
  });
}

/** Открыть раздел на текущем месяце — вызывается с экрана «Сегодня». */
export function resetMonth() {
  month = currentMonthKey();
}

export async function render() {
  const [{ paid, unpaid, unpriced, count, events }, clients] = await Promise.all([
    monthTotals(month),
    clientsMap(),
  ]);

  $('#inc-month').textContent = fmtMonthYear(month);
  $('#inc-paid').textContent = fmtMoney(paid);
  $('#inc-unpaid').textContent = fmtMoney(unpaid);

  const summary = [pluralize(count, ['проведённое занятие', 'проведённых занятия', 'проведённых занятий'])];
  if (unpriced) summary.push(`${unpriced} без цены`);
  $('#inc-summary').textContent = summary.join(' · ');

  if (!events.length) {
    $('#inc-list').innerHTML = emptyState(
      'В этом месяце пока пусто',
      'Отмечайте занятия как проведённые — они появятся здесь',
    );
    return;
  }

  const sorted = events.sort(byKey('date', 'startTime')).reverse();
  $('#inc-list').innerHTML = sorted.map((event) => {
    const client = clients.get(event.clientId);
    const hasPrice = event.price != null && event.price !== '';
    const paidFlag = Boolean(event.paid);

    // Кнопка оплаты — отдельной строкой: так имя клиента не сжимается на узком экране
    return `<div class="card" data-mark="${!hasPrice ? 'off' : paidFlag ? 'quiet' : 'upcoming'}">
      <div class="card-row">
        <button type="button" class="card-main" data-event-open="${event.id}">
          <span class="card-time">${escapeHtml(fmtShortDate(event.date))} · ${escapeHtml(event.startTime || '')}</span>
          <span class="card-head">
            ${avatarHTML(client)}
            <span class="card-title">${escapeHtml(eventTitle(event, client))}</span>
          </span>
          ${hasPrice ? '' : '<span class="card-sub">Цена не указана — откройте занятие</span>'}
        </button>
        <span class="card-side">
          ${hasPrice ? `<span class="price${paidFlag ? '' : ' price--unpaid'}">${escapeHtml(fmtMoney(event.price))}</span>` : ''}
          ${hasPrice && paidFlag ? `<button type="button" class="chip chip--done"
            data-paid-toggle="${event.id}" data-paid="1">Оплачено</button>` : ''}
        </span>
      </div>
      ${hasPrice && !paidFlag ? `<div class="card-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-paid-toggle="${event.id}" data-paid="0">
          Отметить оплаченным
        </button>
      </div>` : ''}
    </div>`;
  }).join('');
}
