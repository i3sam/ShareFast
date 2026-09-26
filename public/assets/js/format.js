const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${Number(value.toFixed(digits))} ${UNITS[unit]}`;
}

export function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

const pad = (value) => String(value).padStart(2, '0');

// "4:09", "23:04:09", "6d 23h"
export function formatCountdown(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours >= 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

// Spoken version for screen readers: "1 hour 4 minutes".
export function describeDuration(milliseconds) {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 1) return 'less than a minute';

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [];
  if (days) parts.push(pluralize(days, 'day'));
  if (hours) parts.push(pluralize(hours, 'hour'));
  if (rest && !days) parts.push(pluralize(rest, 'minute'));
  return parts.join(' ');
}

export function describeContents({ text, fileCount }) {
  const parts = [];
  if (fileCount > 0) parts.push(pluralize(fileCount, 'file'));
  if (text) parts.push(fileCount > 0 ? 'text' : 'Text');
  return parts.join(' and ') || 'Empty';
}
