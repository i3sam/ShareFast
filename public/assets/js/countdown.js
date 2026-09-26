import { h } from './dom.js';
import { describeDuration, formatCountdown } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const timers = new Set();
let ticker = null;

// A pill with a ring that drains as the share gets closer to expiring.
// Every countdown on the page shares one interval, and removes itself once
// its element leaves the DOM.
export function createCountdown({ createdAt, expiresAt, onExpire, label = 'Expires in' }) {
  const ring = document.createElementNS(SVG_NS, 'svg');
  ring.setAttribute('viewBox', '0 0 20 20');
  ring.setAttribute('class', 'countdown-ring');
  ring.setAttribute('aria-hidden', 'true');
  ring.innerHTML = '<circle class="countdown-track" cx="10" cy="10" r="8"/><circle class="countdown-fill" cx="10" cy="10" r="8" pathLength="100"/>';

  const time = h('span', { class: 'countdown-time' });
  const element = h('span', { class: 'countdown', role: 'timer' }, ring, label && h('span', { class: 'countdown-label' }, label), time);
  const fill = ring.querySelector('.countdown-fill');
  const lifetime = Math.max(expiresAt - (createdAt ?? Date.now()), 1);

  const timer = {
    element,
    update(now) {
      const left = expiresAt - now;
      if (left <= 0) {
        timers.delete(timer);
        element.classList.add('is-expired');
        time.textContent = 'Expired';
        fill.style.strokeDashoffset = '100';
        onExpire?.();
        return;
      }
      time.textContent = formatCountdown(left);
      fill.style.strokeDashoffset = String(100 - (left / lifetime) * 100);
      element.classList.toggle('is-ending', left < 60_000);
      element.setAttribute('aria-label', `Expires in ${describeDuration(left)}`);
    },
  };

  timer.update(Date.now());
  if (expiresAt > Date.now()) {
    timers.add(timer);
    ticker ??= setInterval(tick, 1000);
  }
  return element;
}

function tick() {
  const now = Date.now();
  for (const timer of timers) {
    // Skip freshly created timers that haven't been attached yet.
    if (!timer.element.isConnected) {
      if (timer.attached) timers.delete(timer);
      continue;
    }
    timer.attached = true;
    timer.update(now);
  }
  if (timers.size === 0) {
    clearInterval(ticker);
    ticker = null;
  }
}
