// wheel.js — колесо выбора значения: крутится «щелчками», как будильник.
// Используется для времени занятия, цены и срока задачи.
// Никакой бизнес-логики: на входе список значений, на выходе выбранное.

import { escapeHtml } from './utils.js';

const FALLBACK_ITEM_HEIGHT = 40; // синхронизировано с --wheel-item в styles.css

/**
 * @param {HTMLElement} root  пустой контейнер под колонку
 * @param {{items: Array<{value: any, label: string}>, value: any,
 *          ariaLabel: string, onChange: (value: any) => void}} options
 */
export function createWheel(root, { items = [], value = null, ariaLabel = '', onChange = null } = {}) {
  let list = [];
  let currentIndex = 0;
  let settleTimer = null;

  root.classList.add('wheel-col');
  root.setAttribute('role', 'listbox');
  root.setAttribute('tabindex', '0');
  if (ariaLabel) root.setAttribute('aria-label', ariaLabel);

  function itemHeight() {
    const first = root.firstElementChild;
    return (first && first.offsetHeight) || FALLBACK_ITEM_HEIGHT;
  }

  function indexOfValue(val) {
    return list.findIndex((item) => String(item.value) === String(val));
  }

  function markSelected(index) {
    const nodes = root.children;
    for (let i = 0; i < nodes.length; i += 1) {
      nodes[i].setAttribute('aria-selected', String(i === index));
    }
    const selected = nodes[index];
    if (selected) root.setAttribute('aria-activedescendant', selected.id || '');
  }

  /** Значение под центральной планкой. */
  function readScrollIndex() {
    return Math.max(0, Math.min(list.length - 1, Math.round(root.scrollTop / itemHeight())));
  }

  function settle() {
    const index = readScrollIndex();
    if (index === currentIndex) return;
    currentIndex = index;
    markSelected(index);
    if (onChange && list[index]) onChange(list[index].value);
  }

  root.addEventListener('scroll', () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 90);
  }, { passive: true });

  root.addEventListener('click', (event) => {
    const item = event.target.closest('.wheel-item');
    if (!item) return;
    scrollToIndex(Number(item.dataset.i), true);
  });

  root.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    scrollToIndex(currentIndex + step, true);
  });

  function scrollToIndex(index, animate) {
    const clamped = Math.max(0, Math.min(list.length - 1, index));
    root.scrollTo({ top: clamped * itemHeight(), behavior: animate ? 'smooth' : 'auto' });
    // Плавная прокрутка досылает событие scroll — там сработает settle()
    if (!animate) {
      currentIndex = clamped;
      markSelected(clamped);
    }
  }

  function render(nextItems) {
    list = nextItems;
    root.innerHTML = list
      .map((item, i) => `<div class="wheel-item" role="option" data-i="${i}" aria-selected="false">${escapeHtml(item.label)}</div>`)
      .join('');
  }

  const api = {
    /** Значение под планкой. */
    getValue() {
      return list[currentIndex] ? list[currentIndex].value : null;
    },
    /** Поставить значение. Без animate — мгновенно, без вызова onChange. */
    setValue(val, { animate = false } = {}) {
      const index = indexOfValue(val);
      if (index < 0) return false;
      currentIndex = index;
      markSelected(index);
      root.scrollTo({ top: index * itemHeight(), behavior: animate ? 'smooth' : 'auto' });
      return true;
    },
    /** Заменить список значений (например, когда добавилась цена не из сетки). */
    setItems(nextItems, val) {
      render(nextItems);
      api.setValue(val ?? api.getValue());
    },
    /** Перепрокрутить к текущему значению — после показа скрытого экрана. */
    refresh() {
      root.scrollTo({ top: currentIndex * itemHeight(), behavior: 'auto' });
      markSelected(currentIndex);
    },
  };

  render(items);
  if (value !== null) api.setValue(value);
  return api;
}

/* ===================== Готовые наборы значений ===================== */

export function hourItems() {
  return Array.from({ length: 24 }, (_, h) => ({
    value: String(h).padStart(2, '0'),
    label: String(h).padStart(2, '0'),
  }));
}

export function minuteItems(step = 5) {
  const values = [];
  for (let m = 0; m < 60; m += step) {
    values.push({ value: String(m).padStart(2, '0'), label: String(m).padStart(2, '0') });
  }
  return values;
}

/** Цена: шаг 100. Значение не из сетки (например, 1750) добавляется на своё место. */
export function priceItems(max = 20000, step = 100, extra = null) {
  const values = [];
  for (let price = 0; price <= max; price += step) {
    values.push({ value: price, label: price === 0 ? 'Без цены' : formatPrice(price) });
  }
  if (extra != null && extra % step !== 0 && extra >= 0) {
    const index = values.findIndex((item) => item.value > extra);
    const entry = { value: extra, label: formatPrice(extra) };
    if (index < 0) values.push(entry);
    else values.splice(index, 0, entry);
  }
  return values;
}

const priceFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
function formatPrice(value) {
  return `${priceFmt.format(value)} ₽`;
}
