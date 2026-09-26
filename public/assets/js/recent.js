// Shares you created are remembered in this browser only, so you can copy
// or delete them later. Nothing here is ever sent anywhere.

const STORAGE_KEY = 'sharefast:recent';
const MAX_ENTRIES = 20;

export function loadRecent(now = Date.now()) {
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(entries) ? entries.filter((entry) => entry.expiresAt > now) : [];
  } catch {
    return [];
  }
}

export function findRecent(slug) {
  return loadRecent().find((entry) => entry.slug === slug);
}

export function rememberShare(entry) {
  write([entry, ...loadRecent().filter((existing) => existing.slug !== entry.slug)].slice(0, MAX_ENTRIES));
}

export function forgetShare(slug) {
  write(loadRecent().filter((entry) => entry.slug !== slug));
}

function write(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Private mode or storage disabled. The app works fine without it.
  }
}
