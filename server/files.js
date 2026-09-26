import { HttpError } from './http.js';

// Only these are ever shown inline. Everything else is forced to download,
// so an uploaded HTML or SVG file can never run as a page.
export const PREVIEW_TYPES = new Set([
  'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm',
]);

export function canPreview(share, file) {
  return share.encryption === null && PREVIEW_TYPES.has(file.type);
}

// Supports a single "bytes=start-end" range, which is all browsers need for
// seeking in videos and resuming downloads. Anything fancier gets the full file.
export function parseRange(header, size) {
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;

  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (start > end || start >= size) {
    throw new HttpError(416, 'Range not satisfiable.', { 'Content-Range': `bytes */${size}` });
  }
  return { start, end };
}

export function contentDisposition(type, filename) {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
