export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure contexts (plain http on a LAN IP).
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.className = 'visually-hidden';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  }
}

export const canCopyImages = typeof ClipboardItem === 'function' && Boolean(navigator.clipboard?.write);

// Takes a promise for the image so the clipboard write starts inside the
// click handler; Safari refuses writes that begin after an await.
export async function copyImage(blobPromise) {
  try {
    const png = blobPromise.then((blob) => (blob.type === 'image/png' ? blob : convertToPng(blob)));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

async function convertToPng(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('Could not convert image'))), 'image/png');
  });
}

// Returns { files, text }, or null when the browser won't let us read the
// clipboard directly (the caller should suggest Ctrl/Cmd+V instead).
export async function readClipboard() {
  if (navigator.clipboard?.read) {
    try {
      const files = [];
      let text = '';

      for (const item of await navigator.clipboard.read()) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const extension = imageType.split('/')[1].split('+')[0];
          files.push(new File([blob], `pasted-image.${extension}`, { type: imageType }));
        } else if (item.types.includes('text/plain')) {
          text += await (await item.getType('text/plain')).text();
        }
      }
      return { files, text };
    } catch {
      // Permission denied or unsupported content; try plain text below.
    }
  }

  if (navigator.clipboard?.readText) {
    try {
      return { files: [], text: await navigator.clipboard.readText() };
    } catch {
      return null;
    }
  }
  return null;
}
