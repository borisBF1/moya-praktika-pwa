// app.js — точка входа: собирает модули, переключает вкладки
// и перерисовывает активный экран, когда данные меняются.

import { openDb, subscribe } from './db.js';
import { $, $$, todayISO } from './utils.js';
import { setOverlayChangeHandler, openModal, closeModal, closeOverlay, toast } from './ui.js';
import * as today from './today.js';
import * as calendar from './calendar.js';
import * as clients from './clients.js';
import * as tasks from './tasks.js';
import * as income from './income.js';
import * as settings from './settings.js';
import * as whatsnew from './whatsnew.js';

const TABS = {
  today: { screen: '#screen-today', render: today.render },
  calendar: { screen: '#screen-calendar', render: calendar.render },
  clients: { screen: '#screen-clients', render: clients.render },
  tasks: { screen: '#screen-tasks', render: tasks.render },
  income: { screen: '#screen-income', render: income.render },
};

let activeTab = 'today';
let renderedDay = todayISO();
const scrollByTab = {};

/* ===================== Навигация по вкладкам ===================== */

const ENTER_MS = 520; // держим в паре с .screen.is-entering в styles.css
let enterTimer = null;

/**
 * Блоки открытого экрана появляются по очереди. Класс снимаем по таймеру:
 * иначе перерисовка от любого изменения данных запускала бы анимацию заново.
 */
function playEnter(screen) {
  clearTimeout(enterTimer);
  $$('.screen.is-entering').forEach((el) => el.classList.remove('is-entering'));
  screen.classList.add('is-entering');
  enterTimer = setTimeout(() => screen.classList.remove('is-entering'), ENTER_MS);
}

async function goTab(name) {
  if (!TABS[name]) return;

  if (name !== activeTab) {
    scrollByTab[activeTab] = window.scrollY;
    $(TABS[activeTab].screen).hidden = true;
    $(TABS[name].screen).hidden = false;
    activeTab = name;

    $$('#tabbar .tab').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    });

    playEnter($(TABS[name].screen));
  }

  await TABS[name].render();
  window.scrollTo({ top: scrollByTab[name] || 0, behavior: 'instant' });
}

const ctx = {
  goTab,
  openSettings: settings.openSettings,
  // Карточка доходов на «Сегодня» всегда ведёт в текущий месяц
  openIncome: () => {
    income.resetMonth();
    return goTab('income');
  },
};

/* ===================== Перерисовка ===================== */

let renderQueued = false;

/**
 * Несколько изменений подряд превращаются в одну перерисовку.
 * Таймер, а не requestAnimationFrame: свёрнутое окно кадры не рисует,
 * и перерисовка бы просто не случилась.
 */
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(async () => {
    renderQueued = false;
    await renderActive();
  }, 0);
}

async function renderActive() {
  try {
    await TABS[activeTab].render();
    await clients.renderClientCard(); // если открыта карточка клиента
  } catch (err) {
    console.error('Не удалось отрисовать экран', err);
  }
}

/* ===================== Общие элементы интерфейса ===================== */

function bindChrome() {
  $('#tabbar').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) goTab(tab.dataset.tab);
  });

  // Кнопка «назад» в экранах поверх вкладок
  document.addEventListener('click', (event) => {
    if (event.target.closest('.overlay [data-close]')) closeOverlay();
  });

  // Пока открыт экран поверх — нижняя навигация не нужна
  setOverlayChangeHandler((depth) => {
    $('#chrome').hidden = depth > 0;
  });

  // Плюс на кнопке разворачивается в крестик, пока открыта шторка
  const fab = $('#fab');
  fab.addEventListener('click', () => {
    fab.classList.add('is-open');
    openModal($('#add-sheet'), { onClose: () => fab.classList.remove('is-open') });
  });

  $('#add-sheet').addEventListener('click', (event) => {
    const item = event.target.closest('[data-add]');
    if (!item) return;
    closeModal();

    if (item.dataset.add === 'event') {
      // На календаре занятие добавляется на выбранный день, иначе — на сегодня
      calendar.openEventForm(activeTab === 'calendar' ? {} : { date: todayISO() });
    } else if (item.dataset.add === 'task') {
      tasks.openTaskForm({});
    } else {
      clients.openClientForm();
    }
  });

  // Приложение могло провисеть открытым до следующего дня
  const refreshIfDayChanged = () => {
    if (document.hidden) return;
    const now = todayISO();
    if (now === renderedDay) return;
    renderedDay = now;
    calendar.selectDate(now);
    income.resetMonth();
    renderActive();
  };
  document.addEventListener('visibilitychange', refreshIfDayChanged);
  window.addEventListener('focus', refreshIfDayChanged);
}

/* ===================== Запуск ===================== */

async function start() {
  try {
    await openDb();
  } catch (err) {
    console.error('IndexedDB недоступна', err);
    toast('Не удалось открыть локальное хранилище');
    return;
  }

  settings.init();
  today.init(ctx);
  calendar.init();
  clients.init();
  tasks.init();
  income.init();
  whatsnew.init();
  bindChrome();

  subscribe(scheduleRender);
  playEnter($(TABS[activeTab].screen));
  await renderActive();
  await whatsnew.maybeShow();
}

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker не зарегистрирован', err);
    });
  });
}
