import { api, qrUrl } from './api.js';
import { copyText, readClipboard } from './clipboard.js';
import { createCountdown } from './countdown.js';
import { confirmAndDelete } from './delete-share.js';
import { $, fillHost, h, icon, isApplePlatform, removeAnimated, renderIcons, setBusy, setIcon, toast } from './dom.js';
import { describeContents, formatBytes, pluralize } from './format.js';
import { forgetShare, loadRecent, rememberShare } from './recent.js';
import { initSettings } from './settings.js';
import { extractSlug, isValidSlug, normalizeSlug } from './slug.js';
import { sendShare } from './transfer.js';

const limits = {
  maxShareBytes: 1024 ** 3,
  maxFiles: 50,
  maxTextBytes: 1024 ** 2,
  expiryOptions: [{ seconds: 3600, label: '1 hour' }],
  defaultExpiry: 3600,
};

const state = {
  files: [],
  slugSource: 'suggested',
  slugStatus: 'empty',
  busy: false,
  current: null,
};

const pageTitle = document.title;
const composer = $('#composer');
const result = $('#result');
const textField = $('#text');
const slugField = $('#slug');
const passwordField = $('#password');

const SLUG_STATUS = {
  empty: ['', 'A random word will be picked'],
  suggested: ['is-ok', 'Available'],
  invalid: ['is-error', 'Use 3 to 40 letters, numbers or dashes'],
  checking: ['', 'Checking…'],
  available: ['is-ok', 'Available'],
  taken: ['is-error', 'Already taken'],
  unknown: ['', ''],
};


function init() {
  fillHost();
  renderIcons();
  initSettings();
  for (const key of document.querySelectorAll('[data-mod]')) key.textContent = isApplePlatform ? '⌘' : 'Ctrl';

  bindTabs();
  bindComposer();
  bindDragAndDrop();
  bindResult();
  bindReceive();

  renderExpiryOptions();
  loadLimits();
  suggestSlug();
  renderRecent();
}

async function loadLimits() {
  try {
    Object.assign(limits, await api.config());
  } catch {
    // Keep the defaults. Anything that really fails will surface on submit.
  }
  $('#size-limit').textContent = formatBytes(limits.maxShareBytes);
  renderExpiryOptions();
}

// Tabs

const TABS = ['send', 'receive'];

function bindTabs() {
  for (const name of TABS) {
    const tab = $(`#tab-${name}`);
    tab.addEventListener('click', () => selectTab(name));
    tab.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const next = TABS[(TABS.indexOf(name) + step + TABS.length) % TABS.length];
      selectTab(next);
      $(`#tab-${next}`).focus();
    });
  }

  selectTab(location.hash === '#receive' ? 'receive' : 'send');
  window.addEventListener('hashchange', () => selectTab(location.hash === '#receive' ? 'receive' : 'send'));
}

function selectTab(name) {
  for (const tab of TABS) {
    const selected = tab === name;
    const button = $(`#tab-${tab}`);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#panel-${tab}`).hidden = !selected;
  }
  $('.tabs').dataset.active = name;
  history.replaceState(null, '', name === 'receive' ? '#receive' : location.pathname);
}

// Composer

function bindComposer() {
  $('#pick-files').addEventListener('click', () => $('#file-input').click());
  $('#pick-photos').addEventListener('click', () => $('#photo-input').click());
  $('#take-photo').addEventListener('click', () => $('#camera-input').click());
  $('#paste').addEventListener('click', pasteFromClipboard);
  $('#dropzone').addEventListener('click', () => $('#file-input').click());
  $('#clear-files').addEventListener('click', clearFiles);

  for (const input of document.querySelectorAll('input[type="file"]')) {
    input.addEventListener('change', () => {
      addFiles(input.files);
      input.value = '';
    });
  }

  textField.addEventListener('input', syncTextTools);
  textField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) composer.requestSubmit();
  });
  $('#clear-text').addEventListener('click', () => {
    textField.value = '';
    syncTextTools();
    textField.focus();
  });

  slugField.addEventListener('input', handleSlugInput);
  $('#shuffle').addEventListener('click', () => suggestSlug({ animate: true }));

  $('#toggle-password').addEventListener('click', togglePasswordVisibility);

  document.addEventListener('paste', handlePasteEvent);
  composer.addEventListener('submit', handleSubmit);

  window.addEventListener('beforeunload', (event) => {
    if (state.busy) event.preventDefault();
  });
}

function renderExpiryOptions() {
  const selected = Number(new FormData(composer).get('expiry')) || limits.defaultExpiry;
  $('#expiry').replaceChildren(
    ...limits.expiryOptions.map(({ seconds, label }) =>
      h(
        'label',
        { class: 'segment' },
        h('input', { type: 'radio', name: 'expiry', value: seconds, checked: seconds === selected }),
        h('span', {}, label),
      ),
    ),
  );
}

function togglePasswordVisibility() {
  const button = $('#toggle-password');
  const visible = passwordField.type === 'password';
  passwordField.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  setIcon(button.firstElementChild, visible ? 'eye-off' : 'eye');
}

function syncTextTools() {
  $('#clear-text').hidden = textField.value === '';
}

// Files

function addFiles(list) {
  const incoming = [...list].filter((file) => !state.files.some((entry) => isSameFile(entry.file, file)));
  const room = limits.maxFiles - state.files.length;
  if (incoming.length > room) toast(`A share can hold up to ${limits.maxFiles} files`);

  for (const file of incoming.slice(0, Math.max(room, 0))) {
    const entry = { file, thumbUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null };
    entry.element = renderFileItem(entry);
    state.files.push(entry);
    $('#file-list').append(entry.element);
  }
  renderFileSummary();
}

function removeFile(entry) {
  if (entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
  state.files = state.files.filter((candidate) => candidate !== entry);
  removeAnimated(entry.element);
  renderFileSummary();
}

function clearFiles() {
  for (const entry of state.files) {
    if (entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
  }
  state.files = [];
  $('#file-list').replaceChildren();
  renderFileSummary();
}

function isSameFile(a, b) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

function totalBytes() {
  return state.files.reduce((sum, entry) => sum + entry.file.size, 0);
}

function renderFileSummary() {
  const bytes = totalBytes();
  const total = $('#file-total');
  $('#files').hidden = state.files.length === 0;
  total.textContent = `${pluralize(state.files.length, 'file')} · ${formatBytes(bytes)}`;
  total.classList.toggle('is-error', bytes > limits.maxShareBytes);
  hideError();
}

function renderFileItem(entry) {
  const { file } = entry;
  return h(
    'li',
    { class: 'file-item' },
    renderThumb(entry),
    h(
      'div',
      { class: 'file-info' },
      h('p', { class: 'file-name', title: file.name }, file.name),
      h('p', { class: 'file-size' }, formatBytes(file.size)),
    ),
    h(
      'button',
      { type: 'button', class: 'icon-button', 'aria-label': `Remove ${file.name}`, onClick: () => removeFile(entry) },
      icon('x', 16),
    ),
  );
}

function renderThumb(entry) {
  const thumb = h('span', { class: 'file-thumb' }, icon(entry.thumbUrl ? 'image' : 'file'));
  if (entry.thumbUrl) {
    // Only swap the icon out once the browser has proven it can decode the image (HEIC often can't).
    const image = h('img', { src: entry.thumbUrl, alt: '' });
    image.addEventListener('load', () => thumb.replaceChildren(image), { once: true });
  }
  return thumb;
}

// Clipboard

function insertText(text) {
  textField.value = textField.value ? `${textField.value}\n${text}` : text;
  syncTextTools();
}

async function pasteFromClipboard() {
  const content = await readClipboard();
  if (!content) {
    toast(`Press ${isApplePlatform ? '⌘V' : 'Ctrl+V'} to paste`);
    return;
  }
  applyPasted(content.files, content.text);
}

function handlePasteEvent(event) {
  if (composer.hidden || $('#panel-send').hidden || state.busy) return;

  const files = [...event.clipboardData.files];
  if (files.length > 0) {
    event.preventDefault();
    applyPasted(files, '');
    return;
  }

  if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const text = event.clipboardData.getData('text/plain');
  if (text) {
    event.preventDefault();
    applyPasted([], text);
  }
}

function applyPasted(files, text) {
  if (files.length === 0 && !text) {
    toast('Clipboard is empty');
    return;
  }
  addFiles(files);
  if (text) insertText(text);
  toast(files.length > 0 ? `Pasted ${pluralize(files.length, 'file')}` : 'Pasted text');
}

// Link word

let slugTimer;
let slugRequest = 0;

async function suggestSlug({ animate = false } = {}) {
  const request = ++slugRequest;
  try {
    const { slug } = await api.suggestSlug();
    if (request !== slugRequest) return;
    slugField.value = slug;
    state.slugSource = 'suggested';
    setSlugStatus('suggested');
    if (animate) replayAnimation(slugField.closest('.input-group'), 'is-shuffled');
  } catch {
    if (request === slugRequest && !slugField.value) setSlugStatus('empty');
  }
}

function handleSlugInput() {
  const { value, selectionStart } = slugField;
  const normalized = normalizeSlug(value);
  if (normalized !== value) {
    slugField.value = normalized;
    const caret = Math.max(0, selectionStart - (value.length - normalized.length));
    slugField.setSelectionRange(caret, caret);
  }
  state.slugSource = 'custom';
  checkSlug(normalized);
}

function checkSlug(slug) {
  clearTimeout(slugTimer);
  const request = ++slugRequest;

  if (!slug) return setSlugStatus('empty');
  if (!isValidSlug(slug)) return setSlugStatus('invalid');

  setSlugStatus('checking');
  slugTimer = setTimeout(async () => {
    let status;
    try {
      status = (await api.checkSlug(slug)).available ? 'available' : 'taken';
    } catch {
      status = 'unknown';
    }
    if (request === slugRequest) setSlugStatus(status);
  }, 300);
}

function setSlugStatus(status) {
  state.slugStatus = status;
  const [tone, message] = SLUG_STATUS[status];
  const element = $('#slug-status');
  element.className = `status ${tone}`.trim();
  element.textContent = message;
}

function replayAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

// Sending

async function handleSubmit(event) {
  event.preventDefault();
  if (state.busy) return;

  const files = state.files.map((entry) => entry.file);
  const text = textField.value.trim() ? textField.value : '';

  const problem = findProblem({ files, text, slug: slugField.value });
  if (problem) {
    showError(problem);
    return;
  }

  hideError();
  setSending(true);
  try {
    await sendWithRetry({
      files,
      text,
      expiresIn: Number(new FormData(composer).get('expiry')),
      password: passwordField.value,
    });
  } catch (error) {
    await handleSendError(error);
  } finally {
    setSending(false);
  }
}

// A suggested word can be taken by someone else between suggesting and
// sending. In that case quietly pick a new one instead of bothering the user.
async function sendWithRetry(input) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendShare(
        { ...input, slug: slugField.value },
        {
          onCreated: (share) => showResult(share, { fileCount: input.files.length, hasText: Boolean(input.text) }),
          onProgress: renderProgress,
        },
      );
    } catch (error) {
      const canRetry = error.status === 409 && !state.current && state.slugSource === 'suggested' && attempt < 2;
      if (!canRetry) throw error;
      await suggestSlug();
    }
  }
}

function findProblem({ files, text, slug }) {
  if (files.length === 0 && !text) return 'Add a file or some text first.';
  if (passwordField.value && !crypto.subtle) {
    return 'Passwords need a secure connection. Open the site over https, or remove the password.';
  }

  const bytes = totalBytes();
  if (bytes > limits.maxShareBytes) {
    return `These files are ${formatBytes(bytes)}. The limit is ${formatBytes(limits.maxShareBytes)}.`;
  }
  if (new Blob([text]).size > limits.maxTextBytes) return 'That text is too long.';
  if (slug && !isValidSlug(slug)) return 'The link can use 3 to 40 letters, numbers or dashes.';
  if (state.slugStatus === 'taken') return 'That link is already taken. Try another word.';
  return null;
}

async function handleSendError(error) {
  const created = state.current;
  if (created) {
    // The upload failed part way, so remove the half-finished share.
    await api.deleteShare(created.slug, created.token).catch(() => {});
    forgetShare(created.slug);
    state.current = null;
    showComposer();
  } else if (error.status === 409) {
    setSlugStatus('taken');
  }
  showError(error.message);
}

function setSending(busy) {
  state.busy = busy;
  setBusy($('#submit'), busy);
  $('#submit').lastElementChild.textContent = busy ? 'Creating link' : 'Create link';
  $('#delete-share').disabled = busy;
  $('#send-another').disabled = busy;
  keepScreenAwake(busy);
}

// Phones dim and suspend the page mid-upload otherwise.
let wakeLock = null;

async function keepScreenAwake(awake) {
  try {
    if (awake) wakeLock = await navigator.wakeLock?.request('screen');
    else await wakeLock?.release();
  } catch {
    // Not supported or not allowed right now. The upload still works.
  }
  if (!awake) wakeLock = null;
}

function showError(message) {
  const element = $('#composer-error');
  element.textContent = message;
  element.hidden = false;
  replayAnimation(element, 'is-shaking');
}

function hideError() {
  $('#composer-error').hidden = true;
}

// Result

function bindResult() {
  $('#copy-link').addEventListener('click', () => copyLink(shareUrl(state.current.slug)));
  $('#share-link').addEventListener('click', () => {
    navigator.share({ title: 'ShareFast', url: shareUrl(state.current.slug) }).catch(() => {});
  });
  $('#toggle-qr').addEventListener('click', () => setQrVisible($('#qr-panel').hidden));
  $('#send-another').addEventListener('click', resetComposer);
  $('#delete-share').addEventListener('click', () => deleteShare(state.current));
}

function shareUrl(slug) {
  return `${location.origin}/${slug}`;
}

function showResult(share, { fileCount, hasText }) {
  const url = shareUrl(share.slug);
  state.current = {
    slug: share.slug,
    token: share.token,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    summary: describeContents({ text: hasText, fileCount }),
    locked: Boolean(share.encryption),
  };
  rememberShare(state.current);

  for (const link of [$('#result-link'), $('#open-link')]) link.href = `/${share.slug}`;
  $('#result-link').replaceChildren(h('span', { class: 'link-host' }, `${location.host}/`), h('span', {}, share.slug));
  $('#email-link').href = `mailto:?subject=${encodeURIComponent('Shared with ShareFast')}&body=${encodeURIComponent(url)}`;
  $('#share-link').hidden = typeof navigator.share !== 'function';
  $('#qr').src = qrUrl(url);
  setQrVisible(matchMedia('(hover: hover)').matches);

  const summary = [state.current.summary];
  if (state.current.locked) summary.push('password protected');
  $('#result-summary').textContent = summary.join(' · ');
  $('#result-countdown').replaceChildren(
    createCountdown({
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      onExpire: () => {
        toast('Your share expired and was deleted');
        resetComposer();
      },
    }),
  );

  renderProgress(fileCount > 0 ? { phase: 'starting', fraction: 0 } : { phase: 'done', fraction: 1 });

  composer.hidden = true;
  result.hidden = false;
  result.focus({ preventScroll: true });
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  renderRecent();
}

function setQrVisible(visible) {
  $('#qr-panel').hidden = !visible;
  $('#toggle-qr').setAttribute('aria-expanded', String(visible));
  $('#toggle-qr').classList.toggle('is-active', visible);
}

function renderProgress({ phase, fraction, file, index }) {
  const percent = Math.min(100, Math.round(fraction * 100));
  const count = state.files.length;
  const done = phase === 'done';

  const details = {
    starting: 'Starting upload…',
    encrypting: () => `Encrypting ${file.name}`,
    uploading: () => (count > 1 ? `Uploading file ${index + 1} of ${count}` : `Uploading ${file.name}`),
    done: 'Anyone with the link can open it until it expires.',
  };
  const detail = details[phase];

  result.classList.toggle('is-done', done);
  $('#progress-ring-fill').style.strokeDashoffset = String(100 - percent);
  $('#progress-value').textContent = `${percent}%`;
  $('#result-title').textContent = done ? 'Ready to share' : 'Uploading';
  document.title = done || phase === 'starting' ? pageTitle : `${percent}% uploaded · ShareFast`;
  $('#result-detail').textContent = typeof detail === 'function' ? detail() : detail;
}

function showComposer() {
  document.title = pageTitle;
  result.hidden = true;
  composer.hidden = false;
}

function resetComposer() {
  clearFiles();
  state.current = null;
  composer.reset();
  renderExpiryOptions();
  syncTextTools();
  if (passwordField.type === 'text') togglePasswordVisibility();
  suggestSlug();
  showComposer();
  renderRecent();
  textField.focus({ preventScroll: true });
}

async function deleteShare(entry) {
  if (!entry || state.busy || !(await confirmAndDelete(entry))) return;

  toast('Share deleted');
  if (state.current?.slug === entry.slug) resetComposer();
  else renderRecent();
}

async function copyLink(url) {
  const copied = await copyText(url);
  toast(copied ? 'Link copied' : 'Could not copy');
  if (copied) replayAnimation($('.link-box'), 'is-copied');
}

// Drag and drop anywhere on the page

function bindDragAndDrop() {
  let depth = 0;
  const carriesFiles = (event) => event.dataTransfer?.types.includes('Files');
  const setOver = (over) => document.body.classList.toggle('is-dragging', over);

  window.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event) || composer.hidden) return;
    depth += 1;
    setOver(true);
  });

  window.addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setOver(false);
  });

  window.addEventListener('dragover', (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });

  window.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    setOver(false);
    if (composer.hidden || state.busy) return;
    selectTab('send');
    addDropped(event.dataTransfer);
  });
}

function addDropped(dataTransfer) {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => ({ file: item.getAsFile(), isFolder: Boolean(item.webkitGetAsEntry?.()?.isDirectory) }));

  if (entries.some((entry) => entry.isFolder)) toast('Folders are not supported. Zip it first.');
  addFiles(entries.filter((entry) => entry.file && !entry.isFolder).map((entry) => entry.file));
}

// Receiving

function bindReceive() {
  const input = $('#receive-slug');

  $('#receive-form').addEventListener('submit', (event) => {
    event.preventDefault();
    openShare(input.value);
  });

  $('#receive-paste').addEventListener('click', async () => {
    const content = await readClipboard();
    if (!content?.text) {
      toast(`Press ${isApplePlatform ? '⌘V' : 'Ctrl+V'} in the box to paste`);
      input.focus();
      return;
    }
    input.value = extractSlug(content.text);
    openShare(input.value);
  });
}

function openShare(value) {
  const slug = extractSlug(value);
  const error = $('#receive-error');
  if (isValidSlug(slug)) {
    location.href = `/${slug}`;
    return;
  }
  error.textContent = value.trim() ? "That doesn't look like a ShareFast link." : 'Type the word first.';
  error.hidden = false;
  replayAnimation(error, 'is-shaking');
}

// Recent shares

function renderRecent() {
  const entries = loadRecent();
  $('#recent').hidden = entries.length === 0;
  $('#recent-list').replaceChildren(...entries.map(renderRecentItem));
}

function renderRecentItem(entry) {
  return h(
    'li',
    { class: 'recent-item' },
    h('span', { class: 'recent-icon' }, icon(entry.locked ? 'lock' : 'link', 16)),
    h(
      'div',
      { class: 'recent-info' },
      h('a', { class: 'recent-link', href: `/${entry.slug}` }, `${location.host}/${entry.slug}`),
      h('p', { class: 'recent-meta' }, entry.summary),
    ),
    createCountdown({ createdAt: entry.createdAt, expiresAt: entry.expiresAt, label: '', onExpire: renderRecent }),
    h(
      'div',
      { class: 'recent-actions' },
      h(
        'button',
        { type: 'button', class: 'icon-button', title: 'Copy link', 'aria-label': `Copy link ${entry.slug}`, onClick: () => copyLink(shareUrl(entry.slug)) },
        icon('copy', 16),
      ),
      h(
        'button',
        { type: 'button', class: 'icon-button', title: 'Delete', 'aria-label': `Delete ${entry.slug}`, onClick: () => deleteShare(entry) },
        icon('trash', 16),
      ),
    ),
  );
}

init();
