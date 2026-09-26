import { api, uploadFile } from './api.js';
import { KDF_ITERATIONS, deriveKey, encryptFile, encryptJson, encryptedSize, randomBytes, toBase64 } from './crypto.js';

// Creates the share, then uploads each file in order. `onCreated` fires as
// soon as the link exists, so it can be shown while the upload runs.
export async function sendShare({ files, text, slug, expiresIn, password }, { onCreated, onProgress }) {
  const sealed = password ? await sealManifest(password, files, text) : null;

  const share = await api.createShare({
    slug: slug || undefined,
    expiresIn,
    text: sealed ? undefined : text || undefined,
    encryption: sealed?.encryption,
    files: files.map((file) =>
      sealed ? { size: encryptedSize(file.size) } : { name: file.name, type: file.type, size: file.size },
    ),
  });
  onCreated(share);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let doneBytes = 0;

  for (const [index, file] of files.entries()) {
    const progress = (phase, bytes) => {
      onProgress({ phase, index, file, fraction: totalBytes ? (doneBytes + bytes) / totalBytes : 1 });
    };

    let body = file;
    if (sealed) {
      progress('encrypting', 0);
      body = await encryptFile(sealed.key, file, sealed.nonces[index]);
    }

    // Encrypted bodies are slightly larger; scale back so the bar tracks the original sizes.
    const scale = file.size / (body.size || 1);
    await uploadOne(share, index, body, (sent) => progress('uploading', sent * scale));
    doneBytes += file.size;
  }

  onProgress({ phase: 'done', fraction: 1 });
  return share;
}

// The server says where each file goes: a presigned Vercel Blob URL it hands
// out on request, or a PUT to the ShareFast server when it stores files itself.
async function uploadOne(share, index, body, onProgress) {
  const target = share.uploads[index];
  const fileId = share.files[index].id;

  if (target.presign) {
    const { url, headers } = await api.presignUpload(target.presign, share.token);
    await uploadFile({ url, body, headers, onProgress });
  } else {
    await uploadFile({ url: target.url, body, headers: { Authorization: `Bearer ${share.token}` }, onProgress });
  }

  await api.completeUpload(share.slug, fileId, share.token);
}

async function sealManifest(password, files, text) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  const nonces = files.map(() => randomBytes(8));

  const manifest = {
    text: text || null,
    files: files.map((file, index) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      nonce: toBase64(nonces[index]),
    })),
  };
  const { iv, data } = await encryptJson(key, manifest);

  return {
    key,
    nonces,
    encryption: {
      iterations: KDF_ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
      manifest: toBase64(data),
    },
  };
}
