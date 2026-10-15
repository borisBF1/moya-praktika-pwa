// ui.js — общие детали интерфейса: экраны поверх вкладок, шторки,
// подтверждения и всплывающие сообщения. Никакой бизнес-логики.

import { $ } from './utils.js';

/* ===================== Анимация ухода ===================== */

// Показать элемент — это просто снять hidden. Спрятать — сначала дать ему
// доиграть анимацию: класс is-closing, а hidden выставляется по таймеру.
// Длительность держим в паре со стилями .is-closing в styles.css.
const CLOSE_MS = 180;
const closingTimers = new WeakMap();

function hideAnimated(el) {
  cancelHide(el);
  el.classList.add('is-closing');
  closingTimers.set(el, setTimeout(() => {
    closingTimers.delete(el);
    el.classList.remove('is-closing');
    el.hidden = true;
  }, CLOSE_MS));
}

/** Элемент открыли заново, пока он уходил — отменяем скрытие. */
function cancelHide(el) {
  const timer = closingTimers.get(el);
  if (timer) {
    clearTimeout(timer);
    closingTimers.delete(el);
  }
  el.classList.remove('is-closing');
}

/* ===================== Всплывающее сообщение ===================== */

let toastTimer = null;

export function toast(message, ms = 2400) {
  const node = $('#toast');
  clearTimeout(toastTimer);
  cancelHide(node);
  node.textContent = message;
  node.hidden = false;
  toastTimer = setTimeout(() => hideAnimated(node), ms);
}

/* ===================== Экраны поверх вкладок ===================== */

const overlays = [];
let historyOk = true;
let onOverlayChange = () => {};

// Перезагрузка страницы с открытым экраном поверх вкладки оставляет в истории
// отметку об этом экране. Сбрасываем её на старте, иначе счёт открытых экранов
// разъедется и кнопка «назад» перестанет закрывать то, что видно.
try {
  history.replaceState({ overlay: 0 }, '');
} catch (err) {
  historyOk = false; // файл открыт напрямую с диска — работаем без истории
}

export function setOverlayChangeHandler(fn) {
  onOverlayChange = fn;
}

/**
 * Показать экран поверх текущей вкладки.
 * Каждое открытие кладёт запись в history, поэтому системная кнопка «назад»
 * закрывает верхний экран, а не выкидывает из приложения.
 */
export function openOverlay(el, { onClose = null, focus = null } = {}) {
  overlays.push({ el, onClose });
  cancelHide(el);
  el.hidden = false;
  el.scrollTop = 0;

  if (historyOk) {
    try {
      history.pushState({ overlay: overlays.length }, '');
    } catch (err) {
      historyOk = false; // например, открыли файл напрямую с диска
    }
  }

  onOverlayChange(overlays.length);

  const target = focus ? $(focus, el) : null;
  if (target) target.focus();
}

function popOverlay() {
  const top = overlays.pop();
  if (!top) return;
  hideAnimated(top.el);
  if (top.onClose) top.onClose();
}

/** Закрыть N верхних экранов (по умолчанию один). */
export function closeOverlay(levels = 1) {
  const count = Math.min(levels, overlays.length);
  if (count <= 0) return;

  if (historyOk) {
    history.go(-count); // фактическое закрытие — в обработчике popstate
    return;
  }
  for (let i = 0; i < count; i += 1) popOverlay();
  onOverlayChange(overlays.length);
}

window.addEventListener('popstate', (event) => {
  const depth = event.state && event.state.overlay ? event.state.overlay : 0;
  let changed = false;
  while (overlays.length > depth) {
    popOverlay();
    changed = true;
  }
  if (changed) onOverlayChange(overlays.length);
});

/* ===================== Шторки и диалоги ===================== */

let activeModal = null;

export function openModal(el, { onClose = null } = {}) {
  if (activeModal) closeModal();
  cancelHide(el);
  el.hidden = false;
  activeModal = { el, onClose };
}

export function closeModal() {
  if (!activeModal) return;
  const { el, onClose } = activeModal;
  activeModal = null;
  hideAnimated(el);
  if (onClose) onClose();
}

// Клик по подложке закрывает шторку; Escape — верхний слой интерфейса.
document.addEventListener('click', (event) => {
  const backdrop = event.target.closest('.sheet-backdrop[data-close]');
  if (backdrop && activeModal && activeModal.el.contains(backdrop)) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (activeModal) {
    closeModal();
    return;
  }
  if (overlays.length) closeOverlay();
});

/* ===================== Подтверждение действия ===================== */

export function confirmAction({ title, text = '', okText = 'Да', cancelText = 'Отмена', danger = false }) {
  const root = $('#confirm-dialog');
  const okBtn = $('#confirm-ok');
  const cancelBtn = $('#confirm-cancel');

  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-text').hidden = !text;
  okBtn.textContent = okText;
  cancelBtn.textContent = cancelText;
  okBtn.classList.toggle('btn-accent', danger);
  okBtn.classList.toggle('btn-primary', !danger);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(value);
    };
    // Сначала фиксируем ответ, потом закрываем: закрытие само зовёт finish(false).
    const onOk = () => { finish(true); closeModal(); };
    const onCancel = () => { finish(false); closeModal(); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    openModal(root, { onClose: () => finish(false) });
    okBtn.focus();
  });
}

/* ===================== Быстрая заметка к занятию ===================== */

/** Возвращает текст заметки или null, если пользователь пропустил шаг. */
export function askSessionNote({ title = 'Что делали?', sub = '', value = '' }) {
  const root = $('#note-dialog');
  const form = $('#note-form');
  const skipBtn = $('#note-skip');
  const textarea = $('#note-text');

  $('#note-title').textContent = title;
  $('#note-sub').textContent = sub;
  $('#note-sub').hidden = !sub;
  textarea.value = value;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      form.removeEventListener('submit', onSubmit);
      skipBtn.removeEventListener('click', onSkip);
      resolve(result);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      finish(textarea.value.trim() || null);
      closeModal();
    };
    const onSkip = () => { finish(null); closeModal(); };

    form.addEventListener('submit', onSubmit);
    skipBtn.addEventListener('click', onSkip);
    openModal(root, { onClose: () => finish(null) });
    textarea.focus();
  });
}
