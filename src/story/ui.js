/** Cinematic UI helpers: letterbox bars and act title cards (in #ui / #letterbox). */
export function letterbox(on) {
  document.getElementById('letterbox')?.classList.toggle('letterbox--on', on);
}

/** An act title card ("I" + title) that fades in, holds, and fades away. */
export function actCard(numeral, title, hold = 5) {
  const ui = document.getElementById('ui');
  if (!ui) return;
  const el = document.createElement('div');
  el.className = 'act-card';
  el.innerHTML = `<span class="act-card__num">${numeral}</span><span class="act-card__title">${title}</span>`;
  ui.appendChild(el);
  requestAnimationFrame(() => el.classList.add('act-card--on'));
  setTimeout(() => el.classList.remove('act-card--on'), hold * 1000);
  setTimeout(() => el.remove(), hold * 1000 + 2500);
}

/** The interactive-mode prompt near the bottom of the screen (HTML; null hides it). */
export function prompt(html) {
  const el = document.getElementById('prompt');
  if (!el) return;
  if (html) el.innerHTML = html;
  el.classList.toggle('prompt--on', !!html);
}

/** A short floating caption in the middle of the screen ("Caught!", "Missed…"). */
export function flashText(text, cls = '') {
  const ui = document.getElementById('ui');
  if (!ui) return;
  for (const old of ui.querySelectorAll('.flash-text')) old.remove(); // one at a time: a new one replaces the last
  const el = document.createElement('div');
  el.className = `flash-text ${cls}`;
  el.textContent = text;
  ui.appendChild(el);
  requestAnimationFrame(() => el.classList.add('flash-text--on'));
  setTimeout(() => el.classList.remove('flash-text--on'), 900);
  setTimeout(() => el.remove(), 1700);
}

/**
 * The question: big serif line + YES / NO. Resolves 'yes' | 'no' on a click
 * (or the Y / N keys). `noScale` shrinks the NO button (it gets harder to say).
 */
export function ask(question, { noScale = 1, onAnswer = null } = {}) {
  document.exitPointerLock?.();
  const ui = document.getElementById('ui');
  const el = document.createElement('div');
  el.className = 'ask';
  el.innerHTML = `<p class="ask__q">${question}</p><div class="ask__row"><button type="button" class="ask__btn ask__btn--yes" data-a="yes">Yes</button><button type="button" class="ask__btn ask__btn--no" data-a="no" style="transform: scale(${noScale.toFixed(2)})">No</button></div>`;
  ui?.appendChild(el);
  requestAnimationFrame(() => el.classList.add('ask--on'));
  return new Promise((resolve) => {
    const done = (a) => {
      onAnswer?.(a); // synchronously, inside the click (the YES music starts in the gesture)
      removeEventListener('keydown', onKey);
      el.classList.remove('ask--on');
      el.classList.add(`ask--${a}`);
      setTimeout(() => el.remove(), 1200);
      resolve(a);
    };
    const onKey = (e) => {
      if (e.code === 'KeyY') done('yes');
      else if (e.code === 'KeyN') done('no');
    };
    addEventListener('keydown', onKey);
    for (const b of el.querySelectorAll('[data-a]')) b.addEventListener('click', (e) => (e.stopPropagation(), done(b.dataset.a)), { once: true });
  });
}

/** THE END: title, a line, and two choices. */
export function theEnd({ onReplay, onWander } = {}) {
  const ui = document.getElementById('ui');
  const el = document.createElement('div');
  el.className = 'the-end';
  el.innerHTML = `<p class="the-end__kanji">完</p><h2 class="the-end__title">The End</h2><p class="the-end__sub">she said yes</p><div class="the-end__row"><button type="button" data-a="replay">Watch again</button><button type="button" data-a="wander">Wander the park</button></div>`;
  ui?.appendChild(el);
  requestAnimationFrame(() => el.classList.add('the-end--on'));
  el.querySelector('[data-a="replay"]').addEventListener('click', () => onReplay?.());
  el.querySelector('[data-a="wander"]').addEventListener('click', () => {
    el.classList.remove('the-end--on');
    setTimeout(() => el.remove(), 1500);
    onWander?.();
  });
  return el;
}

/**
 * A row of action buttons near the bottom of the screen (the interactive
 * picnic's Eat / Feed Her, the scarf's Lean In…). Resolves with the chosen id;
 * keys 1, 2, 3… pick too. `clearActions()` removes the row.
 */
export function actions(list) {
  clearActions();
  document.exitPointerLock?.();
  const ui = document.getElementById('ui');
  const el = document.createElement('div');
  el.className = 'actions';
  el.id = 'actions';
  el.innerHTML = list.map((a, i) => `<button type="button" data-id="${a.id}" class="actions__btn${a.primary ? ' actions__btn--primary' : ''}"><span class="actions__key">${i + 1}</span>${a.label}</button>`).join('');
  ui?.appendChild(el);
  requestAnimationFrame(() => el.classList.add('actions--on'));
  return new Promise((resolve) => {
    const done = (id) => {
      removeEventListener('keydown', onKey);
      el.classList.remove('actions--on');
      setTimeout(() => el.remove(), 400);
      resolve(id);
    };
    const onKey = (e) => {
      const i = Number(e.key) - 1;
      if (list[i]) done(list[i].id);
    };
    addEventListener('keydown', onKey);
    el._cancel = () => {
      removeEventListener('keydown', onKey);
      resolve(null);
    };
    for (const b of el.querySelectorAll('[data-id]')) b.addEventListener('click', (e) => (e.stopPropagation(), done(b.dataset.id)), { once: true });
  });
}

export function clearActions() {
  const el = document.getElementById('actions');
  if (!el) return;
  el._cancel?.();
  el.remove();
}

/** A small heads-up line at the top (the catch game's score + timer). */
export function hud(html) {
  let el = document.getElementById('hud');
  if (!html) return void el?.remove();
  if (!el) {
    el = document.createElement('div');
    el.id = 'hud';
    el.className = 'hud';
    document.getElementById('ui')?.appendChild(el);
  }
  el.innerHTML = html;
}
