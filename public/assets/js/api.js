export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Could not reach ShareFast. Check your connection.');
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status}).`);
  return data;
}

const sharePath = (slug) => `/api/shares/${encodeURIComponent(slug)}`;

export const api = {
  config: () => request('/api/config'),
  suggestSlug: () => request('/api/slugs/suggest'),
  checkSlug: (slug) => request(`/api/slugs/${encodeURIComponent(slug)}`),
  createShare: (input) => request('/api/shares', { method: 'POST', body: input }),
  getShare: (slug) => request(sharePath(slug)),
  deleteShare: (slug, token) => request(sharePath(slug), { method: 'DELETE', token }),
  completeUpload: (slug, fileId, token) =>
    request(`${sharePath(slug)}/files/${fileId}/complete`, { method: 'POST', body: {}, token }),
};

export function fileUrl(slug, fileId, { inline = false } = {}) {
  return `${sharePath(slug)}/files/${fileId}${inline ? '?inline' : ''}`;
}

export function qrUrl(text) {
  return `/api/qr?data=${encodeURIComponent(text)}`;
}

// XHR rather than fetch, because fetch still can't report upload progress.
export function uploadFile({ url, body, token, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (event) => onProgress?.(event.loaded);
    xhr.onerror = () => reject(new ApiError(0, 'The upload was interrupted. Check your connection.'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, readError(xhr.responseText) ?? `Upload failed (${xhr.status}).`));
    };
    xhr.send(body);
  });
}

export function downloadBlob(url, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';

    xhr.onprogress = (event) => onProgress?.(event.loaded);
    xhr.onerror = () => reject(new ApiError(0, 'The download was interrupted. Check your connection.'));
    xhr.onload = () => {
      if (xhr.status === 200) resolve(xhr.response);
      else reject(new ApiError(xhr.status, `Download failed (${xhr.status}).`));
    };
    xhr.send();
  });
}

function readError(body) {
  try {
    return JSON.parse(body).error;
  } catch {
    return null;
  }
}
