// Loaded as a classic script in <head> so display preferences apply before
// the first paint. The settings panel (settings.js) is what changes them.
// Also loaded on every page, which makes it the place for global touch fixes.
{
  try {
    const prefs = JSON.parse(localStorage.getItem('sharefast:prefs') ?? '{}');
    Object.assign(document.documentElement.dataset, prefs);
  } catch {
    // Storage is unavailable; defaults apply.
  }

  // iOS Safari only applies :active styles when a touch listener exists,
  // so without this, buttons give no visual feedback when tapped.
  document.addEventListener('touchstart', () => {}, { passive: true });
}
