export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export async function readJson(req, limit) {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'Expected a JSON body.');
  }

  // Vercel's Node runtime parses the body itself (and throws on invalid JSON).
  let preParsed;
  try {
    preParsed = req.body;
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
  if (preParsed !== undefined) return parsedBody(preParsed);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}

function parsedBody(body) {
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) return body;
  try {
    return JSON.parse(body.toString());
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}

export function clientIp(req, trustProxy) {
  const forwarded = req.headers['x-forwarded-for'];
  if (trustProxy && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}
