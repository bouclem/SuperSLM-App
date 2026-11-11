import { escapeHtml } from './dom';
import { icon } from './icons';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectHandle {
  setOptions: (options: SelectOption[]) => void;
  getValue: () => string;
  setValue: (value: string) => void;
  reset: () => void;
  onChange: (cb: (value: string) => void) => void;
}

export const mountSelect = (host: HTMLElement, placeholder: string): SelectHandle => {
  host.classList.add('csel');
  host.innerHTML = `
    <button class="csel-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
      <span class="csel-label">${escapeHtml(placeholder)}</span>
      ${icon('caret').replace('class="icon"', 'class="icon csel-caret"')}
    </button>
    <div class="csel-menu" role="listbox" hidden></div>`;

  const btn = host.querySelector<HTMLButtonElement>('.csel-btn')!;
  const label = host.querySelector<HTMLElement>('.csel-label')!;
  const menu = host.querySelector<HTMLDivElement>('.csel-menu')!;

  let value = '';
  let options: SelectOption[] = [];
  let active = -1;
  // a keyboard pick on Space is followed by the button's own activation click —
  // swallow that one so it doesn't reopen the menu
  let skipNextClick = false;
  const listeners: ((v: string) => void)[] = [];

  const items = (): HTMLButtonElement[] => [
    ...menu.querySelectorAll<HTMLButtonElement>('.csel-opt')
  ];

  const highlight = (i: number): void => {
    const els = items();
    active = els.length ? ((i % els.length) + els.length) % els.length : -1;
    els.forEach((el, n) => {
      el.classList.toggle('is-active', n === active);
      el.setAttribute('aria-selected', String(n === active));
    });
    els[active]?.scrollIntoView({ block: 'nearest' });
  };

  const open = (): void => {
    menu.hidden = false;
    host.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    const cur = options.findIndex((o) => o.value === value);
    highlight(cur >= 0 ? cur : 0);
  };

  const close = (): void => {
    menu.hidden = true;
    host.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    active = -1;
  };

  const setValue = (v: string): void => {
    value = v;
    label.textContent = options.find((o) => o.value === v)?.label ?? placeholder;
  };

  const choose = (el: HTMLButtonElement): void => {
    setValue(el.dataset.v ?? '');
    close();
    listeners.forEach((cb) => cb(value));
  };

  btn.addEventListener('click', () => {
    if (skipNextClick) {
      skipNextClick = false;
      return;
    }
    if (menu.hidden) open();
    else close();
  });

  document.addEventListener('click', (e) => {
    if (!host.contains(e.target as Node)) close();
  });

  host.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (menu.hidden) open();
      else highlight(active + (e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      if (menu.hidden) return;
      e.preventDefault();
      highlight(e.key === 'Home' ? 0 : items().length - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (menu.hidden) return; // let the button's native click open it
      e.preventDefault();
      if (e.key === ' ') skipNextClick = true;
      const focused = menu.querySelector<HTMLButtonElement>('.csel-opt:focus');
      const target = focused ?? (active >= 0 ? items()[active] : null);
      if (target) {
        choose(target);
        btn.focus();
      } else {
        close();
      }
      return;
    }
    if (e.key === 'Escape' && !menu.hidden) {
      e.preventDefault();
      close();
      btn.focus();
      return;
    }
    if (e.key === 'Tab') close();
  });

  return {
    setOptions: (opts) => {
      options = opts;
      menu.innerHTML = opts.length
        ? opts
            .map(
              (o) => `
            <button class="csel-opt" type="button" role="option" data-v="${escapeHtml(o.value)}">
              <span>${escapeHtml(o.label)}</span>
              ${o.hint ? `<small>${escapeHtml(o.hint)}</small>` : ''}
            </button>`
            )
            .join('')
        : '<p class="csel-empty">Nothing here yet</p>';
      menu.querySelectorAll<HTMLButtonElement>('.csel-opt').forEach((el) => {
        el.addEventListener('click', (e) => {
          // detail 0 = keyboard-activated click — those are handled by the
          // host keydown so a stale focus can't select behind a closed menu
          if (e.detail === 0) return;
          choose(el);
        });
      });
    },
    getValue: () => value,
    setValue,
    reset: () => {
      value = '';
      label.textContent = placeholder;
    },
    onChange: (cb) => listeners.push(cb)
  };
};
