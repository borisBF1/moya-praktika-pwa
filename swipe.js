// swipe.js — горизонтальный свайп пальцем или мышью.
// Никакой бизнес-логики: на входе элемент, на выходе — «влево» или «вправо».
// Вертикальную прокрутку не трогаем: жест засчитывается, только если
// движение по горизонтали заметно длиннее движения по вертикали.

const DEFAULTS = {
  threshold: 52,    // сколько пикселей нужно пройти, чтобы жест засчитался
  ratio: 1.4,       // во сколько раз горизонталь должна обгонять вертикаль
  maxDuration: 800, // медленное перетаскивание — это не свайп
};

// Внутри этих элементов палец занят своим делом — свайп там не нужен
const IGNORE = '.wheel-col, input, textarea, select, [data-no-swipe]';

/**
 * @param {HTMLElement} el
 * @param {{onLeft?: () => void, onRight?: () => void,
 *          threshold?: number, ratio?: number, maxDuration?: number}} options
 */
export function onSwipe(el, { onLeft = null, onRight = null, ...tuning } = {}) {
  const { threshold, ratio, maxDuration } = { ...DEFAULTS, ...tuning };

  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let tracking = false;
  let swiped = false;

  el.addEventListener('pointerdown', (event) => {
    swiped = false;
    tracking = false;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest(IGNORE)) return;
    tracking = true;
    startX = event.clientX;
    startY = event.clientY;
    startedAt = Date.now();
  }, { passive: true });

  el.addEventListener('pointerup', (event) => {
    if (!tracking) return;
    tracking = false;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Date.now() - startedAt > maxDuration) return;
    if (Math.abs(dx) < threshold) return;
    if (Math.abs(dx) < Math.abs(dy) * ratio) return;

    swiped = true;
    if (dx < 0) { if (onLeft) onLeft(); } else if (onRight) onRight();
  }, { passive: true });

  el.addEventListener('pointercancel', () => { tracking = false; });

  // Палец уехал по карточке или по дню — это был свайп, а не нажатие.
  // Ловим на фазе погружения, до делегированных обработчиков экрана.
  el.addEventListener('click', (event) => {
    if (!swiped) return;
    swiped = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}
