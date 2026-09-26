import { $, h, icon } from './dom.js';

const STORAGE_KEY = 'sharefast:prefs';

const TEXT_SIZES = [
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' },
];

const TOGGLES = [
  { key: 'contrast', on: 'high', label: 'High contrast', hint: 'Darker text and stronger borders' },
  { key: 'motion', on: 'reduce', label: 'Reduce motion', hint: 'Turn off animations' },
  { key: 'links', on: 'underline', label: 'Underline links', hint: 'Make every link easy to spot' },
];

let dialog;

export function initSettings() {
  for (const trigger of document.querySelectorAll('[data-open-settings]')) {
    trigger.addEventListener('click', openSettings);
  }
}

function openSettings() {
  dialog ??= buildDialog();
  dialog.showModal();
}

function buildDialog() {
  const sizeGroup = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'text-size-label' },
    TEXT_SIZES.map(({ value, label }) =>
      h(
        'label',
        { class: 'segment' },
        h('input', {
          type: 'radio',
          name: 'text-size',
          value,
          checked: (readPref('text') ?? 'default') === value,
          onChange: () => setPref('text', value === 'default' ? null : value),
        }),
        h('span', {}, label),
      ),
    ),
  );

  const toggles = TOGGLES.map(({ key, on, label, hint }) => {
    const toggle = h('button', {
      type: 'button',
      class: 'switch',
      role: 'switch',
      'aria-checked': String(readPref(key) === on),
      'aria-label': label,
    });
    toggle.addEventListener('click', () => {
      const enabled = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(enabled));
      setPref(key, enabled ? on : null);
    });
    return h(
      'div',
      { class: 'setting-row' },
      h('div', {}, h('p', { class: 'setting-title' }, label), h('p', { class: 'setting-hint' }, hint)),
      toggle,
    );
  });

  const element = h(
    'dialog',
    { class: 'sheet', 'aria-labelledby': 'settings-title' },
    h(
      'div',
      { class: 'sheet-head' },
      h('h2', { id: 'settings-title' }, 'Accessibility'),
      h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', onClick: () => element.close() }, icon('x')),
    ),
    h('p', { class: 'setting-title', id: 'text-size-label' }, 'Text size'),
    sizeGroup,
    h('div', { class: 'setting-list' }, toggles),
    h(
      'div',
      { class: 'sheet-actions' },
      h('button', { type: 'button', class: 'button', onClick: () => resetPrefs(element) }, 'Reset'),
      h('button', { type: 'button', class: 'button button-primary', onClick: () => element.close() }, 'Done'),
    ),
  );

  // Clicking the dimmed backdrop closes the sheet.
  element.addEventListener('click', (event) => {
    if (event.target === element) element.close();
  });
  document.body.append(element);
  return element;
}

function resetPrefs(element) {
  writePrefs({});
  for (const key of ['text', ...TOGGLES.map((toggle) => toggle.key)]) {
    delete document.documentElement.dataset[key];
  }
  $('input[value="default"]', element).checked = true;
  for (const toggle of element.querySelectorAll('.switch')) toggle.setAttribute('aria-checked', 'false');
}

function readPref(key) {
  return readPrefs()[key] ?? null;
}

function setPref(key, value) {
  const prefs = readPrefs();
  if (value === null) {
    delete prefs[key];
    delete document.documentElement.dataset[key];
  } else {
    prefs[key] = value;
    document.documentElement.dataset[key] = value;
  }
  writePrefs(prefs);
}

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return { ...document.documentElement.dataset };
  }
}

function writePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences still apply for this visit.
  }
}
