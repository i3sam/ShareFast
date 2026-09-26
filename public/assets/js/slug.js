// Shared by the browser and the server, so both agree on what a valid link is.

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

const RESERVED = new Set([
  'about', 'admin', 'api', 'assets', 'help', 'login', 'new', 'privacy', 'settings', 'signup', 'suggest', 'terms',
]);

export function isValidSlug(value) {
  return (
    typeof value === 'string' &&
    value.length >= SLUG_MIN &&
    value.length <= SLUG_MAX &&
    SLUG_PATTERN.test(value) &&
    !value.includes('--') &&
    !RESERVED.has(value)
  );
}

// "My Photos!" -> "my-photos"
export function normalizeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, SLUG_MAX);
}

// Accepts a bare word or a full link someone pasted ("https://sharefast.essam.biz/otter").
export function extractSlug(value) {
  const path = value.trim().replace(/[?#].*$/, '');
  const lastSegment = path.split('/').filter(Boolean).pop() ?? '';
  return normalizeSlug(lastSegment).replace(/^-+|-+$/g, '');
}
