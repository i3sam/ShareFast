export function $(selector, root = document) {
  return root.querySelector(selector);
}

// Small element builder. Using textContent everywhere means shared text and
// file names can never be interpreted as HTML.
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, value === true ? '' : value);
  }

  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

const ICON_PATHS = {
  accessibility: 'M12 6a1.75 1.75 0 1 0 0-3.5A1.75 1.75 0 0 0 12 6zM5 8.5l7 1.5 7-1.5M12 10v4.5M12 14.5 9 21M12 14.5l3 6.5',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  camera: 'M4 8.5A2 2 0 0 1 6 6.5h1.5L9 4.5h6l1.5 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 16a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clipboard: 'M9 3.5h6a1 1 0 0 1 1 1V6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1zM8 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  copy: 'M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5zM16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H9',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  'eye-off': 'M4 4l16 16M10.5 5.6q.75-.1 1.5-.1c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.5M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  image: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 16l4.5-4.5a1.5 1.5 0 0 1 2 0L16 17M14 15l1.5-1.5a1.5 1.5 0 0 1 2 0L20 16M15 8.5h.01',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1-1',
  lock: 'M6.5 11h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  mail: 'M3.5 6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5zM4 6l8 6.5L20 6',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 20h2M20 14v2',
  share: 'M12 3.5V15M8 7.5l4-4 4 4M7 11H6a1 1 0 0 0-1 1v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a1 1 0 0 0-1-1h-1',
  shuffle: 'M16 4h4v4M4 20 20 4M20 16v4h-4M14.5 14.5 20 20M4 4l5 5',
  text: 'M5 6h14M5 11h14M5 16h9',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  x: 'M6 6l12 12M18 6 6 18',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

// Static markup marks icon spots with <span data-icon="name"></span>.
export function renderIcons(root = document) {
  for (const slot of root.querySelectorAll('[data-icon]')) {
    slot.replaceChildren(icon(slot.dataset.icon, Number(slot.dataset.size) || 18));
  }
}

export function setIcon(slot, name) {
  slot.dataset.icon = name;
  slot.replaceChildren(icon(name, Number(slot.dataset.size) || 18));
}

let toastTimer;

export function toast(message) {
  let element = $('.toast');
  if (!element) {
    element = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(element);
  }

  element.textContent = message;
  element.classList.remove('is-visible');
  // Restart the enter animation when toasts come in quick succession.
  void element.offsetWidth;
  element.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('is-visible'), 2600);
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  button.setAttribute('aria-busy', String(busy));
}

export function fillHost(root = document) {
  for (const element of root.querySelectorAll('[data-host]')) {
    element.textContent = `${location.host}/`;
  }
}

export const isApplePlatform = /Mac|iPhone|iPad/.test(navigator.platform);

export function prefersReducedMotion() {
  return document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function removeAnimated(element) {
  const animation = element.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'scale(0.98)' },
    ],
    { duration: prefersReducedMotion() ? 0 : 160, easing: 'ease-in' },
  );
  animation.onfinish = () => element.remove();
}
