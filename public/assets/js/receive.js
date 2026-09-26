import { api, downloadBlob, fileUrl } from './api.js';
import { canCopyImages, copyImage, copyText } from './clipboard.js';
import { createCountdown } from './countdown.js';
import { decryptFile, decryptJson, deriveKey, fromBase64 } from './crypto.js';
import { confirmAndDelete } from './delete-share.js';
import { $, fillHost, h, icon, isApplePlatform, renderIcons, saveBlob, setBusy, setIcon, toast } from './dom.js';
import { formatBytes, pluralize } from './format.js';
import { findRecent } from './recent.js';
import { initSettings } from './settings.js';
import { extractSlug, isValidSlug } from './slug.js';

const POLL_INTERVAL_MS = 2000;
const ENCRYPTED_PREVIEW_LIMIT = 25 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(avif|gif|jpeg|png|webp)$/;
const VIDEO_TYPES = /^video\/(mp4|webm|quicktime)$/;
const AUDIO_TYPES = /^audio\/(mpeg|mp4|ogg|wav|webm)$/;
const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
const SINGLE_URL = /^https?:\/\/\S+$/i;

const isTouch = matchMedia('(pointer: coarse)').matches;
// On phones the share sheet is how a file gets into the photo library.
const canSaveToDevice =
  isTouch && navigator.canShare?.({ files: [new File([''], 'photo.jpg', { type: 'image/jpeg' })] }) === true;

const view = $('#view');
const slug = location.pathname.slice(1);


async function load() {
  let share;
  try {
    share = await api.getShare(slug);
  } catch (error) {
    if (error.status === 404) renderNotFound();
    else renderState({ iconName: 'x', title: 'Could not load this share', text: error.message }, retryButton());
    return;
  }

  if (!share.ready) {
    renderWaiting(share);
    setTimeout(load, POLL_INTERVAL_MS);
  } else if (share.encryption) {
    renderLocked(share);
  } else {
    renderShare(share, plainContents(share));
  }
}

// States

function renderState({ iconName, title, text }, ...extra) {
  document.title = `${title} · ShareFast`;
  view.setAttribute('aria-busy', 'false');
  view.replaceChildren(
    h(
      'section',
      { class: 'card state' },
      h('span', { class: 'icon-tile' }, icon(iconName, 22)),
      h('h1', {}, title),
      text ? h('p', { class: 'muted' }, text) : null,
      ...extra,
    ),
  );
}

function retryButton() {
  return h('button', { type: 'button', class: 'button', onClick: load }, 'Try again');
}

function renderNotFound() {
  const input = h('input', {
    type: 'text',
    inputmode: 'url',
    placeholder: 'otter',
    'aria-label': 'Link word',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
  });
  const form = h(
    'form',
    {
      class: 'state-form',
      onSubmit: (event) => {
        event.preventDefault();
        const next = extractSlug(input.value);
        if (isValidSlug(next)) location.href = `/${next}`;
        else toast("That doesn't look like a ShareFast link");
      },
    },
    h('div', { class: 'input-group' }, h('span', { class: 'input-prefix', 'data-host': true }, 'sharefast.essam.biz/'), input),
    h('button', { type: 'submit', class: 'button button-primary' }, 'Open'),
  );
  fillHost(form);

  renderState(
    { iconName: 'link', title: 'Link not found', text: 'It may have expired, been deleted, or the word is misspelled.' },
    form,
    h('a', { class: 'text-button', href: '/' }, 'Send something instead'),
  );
  input.value = slug;
  input.focus();
}

function renderExpired() {
  renderState(
    { iconName: 'clock', title: 'This share expired', text: 'Everything in it has been deleted.' },
    h('a', { class: 'button', href: '/' }, 'Send something'),
  );
}

function renderWaiting(share) {
  const done = share.files.filter((file) => file.uploaded).length;
  const bar = h('div', { class: 'bar' }, h('span', { class: 'bar-fill' }));
  bar.firstChild.style.width = `${Math.max(4, (done / share.files.length) * 100)}%`;

  renderState(
    {
      iconName: 'upload',
      title: 'Still uploading',
      text: `${done} of ${pluralize(share.files.length, 'file')} ready. This page opens the share as soon as it's done.`,
    },
    bar,
  );
}

// Password-protected shares

function renderLocked(share) {
  const input = h('input', { type: 'password', id: 'unlock-password', placeholder: 'Password', autocomplete: 'off', 'aria-label': 'Password' });
  const eyeSlot = h('span', {}, icon('eye'));
  const reveal = h('button', { type: 'button', class: 'input-button', 'aria-label': 'Show password', 'aria-pressed': 'false' }, eyeSlot);
  reveal.addEventListener('click', () => {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(visible));
    reveal.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    setIcon(eyeSlot, visible ? 'eye-off' : 'eye');
  });

  const submit = h('button', { type: 'submit', class: 'button button-primary button-lg' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, 'Unlock'));
  const error = h('p', { class: 'error', role: 'alert', hidden: true });

  const form = h(
    'form',
    {
      class: 'unlock-form',
      onSubmit: async (event) => {
        event.preventDefault();
        if (!input.value) {
          input.focus();
          return;
        }
        setBusy(submit, true);
        error.hidden = true;
        try {
          renderShare(share, await unlock(share, input.value));
        } catch {
          setBusy(submit, false);
          error.textContent = crypto.subtle
            ? 'Wrong password. Try again.'
            : 'Unlocking needs a secure connection. Open this link over https.';
          error.hidden = false;
          input.select();
        }
      },
    },
    h('div', { class: 'input-group' }, h('span', { class: 'input-icon' }, icon('lock', 16)), input, reveal),
    error,
    submit,
  );

  renderState({ iconName: 'lock', title: 'Password required', text: 'This share is encrypted. Enter the password you were given.' }, form);
  input.focus();
}

async function unlock(share, password) {
  const { iterations, salt, iv, manifest } = share.encryption;
  const key = await deriveKey(password, fromBase64(salt), iterations);
  const contents = await decryptJson(key, fromBase64(iv), fromBase64(manifest));

  return {
    text: contents.text,
    files: share.files.map((file, index) => {
      const { name, size, nonce } = contents.files[index];
      const type = contents.files[index].type || 'application/octet-stream';
      const blob = once(async (onProgress) => {
        const encrypted = await downloadBlob(fileUrl(slug, file.id), onProgress);
        return decryptFile(key, encrypted, fromBase64(nonce), { size, type });
      });
      return { id: file.id, name, type, size, blob };
    }),
  };
}

// Caches a successful result; a failed attempt can be retried.
function once(task) {
  let pending = null;
  return (...args) => {
    pending ??= task(...args).catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

// The share

function plainContents(share) {
  return {
    text: share.text,
    files: share.files.map((file) => {
      const href = fileUrl(slug, file.id);
      return {
        ...file,
        href,
        previewUrl: fileUrl(slug, file.id, { inline: true }),
        blob: once((onProgress) => downloadBlob(href, onProgress)),
      };
    }),
  };
}

function renderShare(share, { text, files }) {
  const title = shareTitle(text, files);
  document.title = `${title} · ShareFast`;
  view.setAttribute('aria-busy', 'false');

  const owner = findRecent(slug);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const meta = [];
  if (files.length === 1 && !text) meta.push(formatBytes(total), describeType(files[0]));
  else if (files.length === 1) meta.push(formatBytes(total));
  else if (files.length > 1) meta.push(`${formatBytes(total)} total`);
  if (files.length > 0 && text) meta.push('includes a note');
  if (share.encryption) meta.push('encrypted');
  if (meta.length === 0) meta.push('Shared with ShareFast');

  const sections = [
    h(
      'section',
      { class: 'card share-head' },
      h(
        'div',
        { class: 'share-head-row' },
        h('span', { class: 'icon-tile' }, icon(shareIcon(text, files), 22)),
        h('div', { class: 'share-head-text' }, h('h1', {}, title), h('p', { class: 'muted' }, meta.join(' · '))),
        createCountdown({ createdAt: share.createdAt, expiresAt: share.expiresAt, onExpire: renderExpired }),
      ),
      h(
        'div',
        { class: 'toolbar' },
        files.length > 0
          ? h(
              'button',
              { type: 'button', class: 'button button-primary', onClick: (event) => downloadAll(files, event.currentTarget) },
              icon('download', 16),
              files.length > 1 ? 'Download all' : 'Download',
            )
          : null,
        h('button', { type: 'button', class: 'button', onClick: () => copy(location.href, 'Link copied') }, icon('link', 16), 'Copy link'),
        typeof navigator.share === 'function'
          ? h(
              'button',
              { type: 'button', class: 'button', onClick: () => navigator.share({ title, url: location.href }).catch(() => {}) },
              icon('share', 16),
              'Share',
            )
          : null,
      ),
    ),
    text ? renderText(text) : null,
    files.length > 0 ? h('ul', { class: 'shared-files', 'aria-label': 'Files' }, files.map(renderSharedFile)) : null,
    owner ? renderOwnerCard(owner) : null,
  ];
  view.replaceChildren(...sections.filter(Boolean));
}

function shareTitle(text, files) {
  if (files.length === 1 && !text) return files[0].name;
  if (files.length > 0) return pluralize(files.length, 'file');
  return SINGLE_URL.test(text.trim()) ? 'A link for you' : 'A note for you';
}

function shareIcon(text, files) {
  if (files.length === 0) return SINGLE_URL.test(text.trim()) ? 'link' : 'text';
  return files.every((file) => IMAGE_TYPES.test(file.type)) ? 'image' : 'file';
}

function renderText(text) {
  const trimmed = text.trim();
  return h(
    'section',
    { class: 'card text-card' },
    h('pre', { class: 'text-content' }, linkify(text)),
    h(
      'div',
      { class: 'toolbar' },
      SINGLE_URL.test(trimmed)
        ? h('a', { class: 'button button-primary', href: trimmed, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), 'Open link')
        : null,
      h('button', { type: 'button', class: 'button', onClick: () => copy(text, 'Copied') }, icon('copy', 16), 'Copy'),
    ),
  );
}

function linkify(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:!?)\]]+$/, '');
    nodes.push(text.slice(last, match.index));
    nodes.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url));
    last = match.index + url.length;
  }
  nodes.push(text.slice(last));
  return nodes;
}

function renderSharedFile(file) {
  const isImage = IMAGE_TYPES.test(file.type);
  const isMedia = /^(image|video)\//.test(file.type);
  const downloadButton = h(
    'button',
    { type: 'button', class: 'button', onClick: (event) => downloadFile(file, event.currentTarget) },
    icon('download', 16),
    h('span', {}, 'Download'),
  );
  const saveButton =
    canSaveToDevice && isMedia
      ? h(
          'button',
          { type: 'button', class: 'button button-primary', onClick: (event) => saveToDevice(file, event.currentTarget) },
          icon('share', 16),
          h('span', {}, isApplePlatform ? 'Save to Photos' : 'Save'),
        )
      : null;

  return h(
    'li',
    { class: 'card shared-file' },
    renderPreview(file),
    h(
      'div',
      { class: 'shared-file-row' },
      h(
        'div',
        { class: 'file-info' },
        h('p', { class: 'file-name', title: file.name }, file.name),
        h('p', { class: 'file-size' }, `${formatBytes(file.size)} · ${describeType(file)}`),
      ),
      h(
        'div',
        { class: 'shared-file-actions' },
        isImage && canCopyImages && !isTouch
          ? h('button', { type: 'button', class: 'icon-button', title: 'Copy image', 'aria-label': `Copy ${file.name}`, onClick: () => copyImageFile(file) }, icon('copy'))
          : null,
        isImage
          ? h('button', { type: 'button', class: 'icon-button', title: 'View full size', 'aria-label': `View ${file.name}`, onClick: () => openLightbox(file) }, icon('expand'))
          : null,
        saveButton,
        downloadButton,
      ),
    ),
  );
}

function describeType(file) {
  const extension = file.name.includes('.') ? file.name.split('.').pop().toUpperCase() : '';
  return extension.length > 0 && extension.length <= 5 ? extension : file.type.split('/')[0] || 'File';
}

function renderPreview(file) {
  if (file.previewUrl) {
    if (IMAGE_TYPES.test(file.type)) {
      return h(
        'button',
        { type: 'button', class: 'preview', 'aria-label': `View ${file.name}`, onClick: () => openLightbox(file) },
        h('img', { src: file.previewUrl, alt: '', loading: 'lazy', onLoad: (event) => event.target.classList.add('is-loaded') }),
      );
    }
    if (VIDEO_TYPES.test(file.type)) {
      return h('video', { class: 'preview', src: file.previewUrl, controls: true, playsinline: true, preload: 'metadata' });
    }
    if (AUDIO_TYPES.test(file.type)) {
      return h('audio', { class: 'preview-audio', src: file.previewUrl, controls: true, preload: 'none' });
    }
    return null;
  }

  if (IMAGE_TYPES.test(file.type) && file.size <= ENCRYPTED_PREVIEW_LIMIT) {
    const frame = h('button', { type: 'button', class: 'preview is-pending', 'aria-label': `View ${file.name}`, onClick: () => openLightbox(file) });
    file
      .blob()
      .then((blob) => {
        const image = h('img', { src: objectUrl(file, blob), alt: '', onLoad: (event) => event.target.classList.add('is-loaded') });
        frame.classList.remove('is-pending');
        frame.replaceChildren(image);
      })
      .catch(() => frame.remove());
    return frame;
  }
  return null;
}

function objectUrl(file, blob) {
  file.objectUrl ??= URL.createObjectURL(blob);
  return file.objectUrl;
}

function renderOwnerCard(entry) {
  return h(
    'section',
    { class: 'card owner-card' },
    h('p', { class: 'muted' }, 'You created this share in this browser.'),
    h(
      'button',
      { type: 'button', class: 'button button-danger', onClick: () => deleteOwnShare(entry) },
      icon('trash', 16),
      'Delete share',
    ),
  );
}

// Actions

async function downloadFile(file, button) {
  if (file.href) {
    h('a', { href: file.href, download: file.name }).click();
    toast(`Downloading ${file.name}`);
    return;
  }

  const label = button.lastElementChild;
  button.disabled = true;
  try {
    const blob = await file.blob((loaded) => {
      label.textContent = `${Math.round((loaded / file.size) * 100)}%`;
    });
    saveBlob(blob, file.name);
  } catch {
    toast('Download failed. Try again.');
  } finally {
    button.disabled = false;
    label.textContent = 'Download';
  }
}

// The share sheet needs a fresh tap, so if loading the file took too long
// the first tap only prepares it and the button asks for a second one.
async function saveToDevice(file, button) {
  const label = button.lastElementChild;
  button.dataset.label ??= label.textContent;
  const idleLabel = button.dataset.label;

  if (!file.shareable) {
    setBusy(button, true);
    try {
      const blob = await file.blob((loaded) => {
        label.textContent = `${Math.round((loaded / file.size) * 100)}%`;
      });
      file.shareable = new File([blob], file.name, { type: file.type });
    } catch {
      toast('Could not load this file. Try again.');
      return;
    } finally {
      setBusy(button, false);
      label.textContent = idleLabel;
    }
  }

  try {
    await navigator.share({ files: [file.shareable] });
    label.textContent = idleLabel;
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      label.textContent = 'Tap again to save';
    } else if (error.name !== 'AbortError') {
      downloadFile(file, button);
    }
  }
}

async function downloadAll(files, button) {
  setBusy(button, true);
  try {
    for (const file of files) {
      if (file.href) {
        h('a', { href: file.href, download: file.name }).click();
        // Browsers drop downloads that are triggered too close together.
        await new Promise((resolve) => setTimeout(resolve, 600));
      } else {
        saveBlob(await file.blob(), file.name);
      }
    }
    toast(files.length > 1 ? `Downloading ${files.length} files` : `Downloading ${files[0].name}`);
  } catch {
    toast('Download failed. Try again.');
  } finally {
    setBusy(button, false);
  }
}

async function copyImageFile(file) {
  toast((await copyImage(file.blob())) ? 'Image copied' : 'This browser cannot copy images');
}

async function copy(text, message) {
  toast((await copyText(text)) ? message : 'Could not copy');
}

async function deleteOwnShare(entry) {
  if (!(await confirmAndDelete(entry))) return;
  renderState(
    { iconName: 'trash', title: 'Share deleted', text: 'The link no longer works.' },
    h('a', { class: 'button button-primary', href: '/' }, 'Send something new'),
  );
}

// Full-size image view

let lightboxFile = null;

function bindLightbox() {
  const dialog = $('#lightbox');
  $('#lightbox-close').addEventListener('click', () => dialog.close());
  $('#lightbox-download').addEventListener('click', (event) => downloadFile(lightboxFile, event.currentTarget));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

async function openLightbox(file) {
  lightboxFile = file;
  const image = $('#lightbox-image');
  image.alt = file.name;
  $('#lightbox-name').textContent = file.name;

  if (file.previewUrl) {
    image.src = file.previewUrl;
  } else {
    try {
      image.src = objectUrl(file, await file.blob());
    } catch {
      toast('Could not open this image');
      return;
    }
  }
  $('#lightbox').showModal();
}

renderIcons();
initSettings();
bindLightbox();
load();
