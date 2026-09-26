<p align="center">
  <img src="public/assets/icon.svg" width="64" height="64" alt="ShareFast logo">
</p>

<h1 align="center">ShareFast</h1>

<p align="center">
  Send files, photos, text and links between any two devices with a one-word link.<br>
  Free, open source, and no account needed.
</p>

<p align="center">
  <a href="https://sharefast.essam.biz"><strong>Open ShareFast</strong></a>
  &nbsp;·&nbsp;
  <a href="#running-locally">Run it yourself</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/i3sam/ShareFast/issues">Report a bug</a>
  &nbsp;·&nbsp;
  <a href="https://essam.biz">Built by essam.biz</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-black" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-black" alt="Node.js 20 or newer">
  <img src="https://img.shields.io/badge/dependencies-1-black" alt="One dependency">
  <img src="https://img.shields.io/badge/build%20step-none-black" alt="No build step">
</p>

<p align="center">
  <img src="docs/send.png" width="32%" alt="Choosing files and writing a note on the send page">
  <img src="docs/link.png" width="32%" alt="The finished link with a countdown, share buttons and a QR code">
  <img src="docs/receive.png" width="32%" alt="The receive page with an image preview and download buttons">
</p>

Open the site, drop something in, and you get a link like `sharefast.essam.biz/otter`. Open it on your other device and download. There's no account and no app to install, and everything is deleted when the link expires.

It's built for the everyday case of moving a photo from an iPhone to a Windows laptop, or a document from a work computer to your phone, without emailing it to yourself.

## Features

- **Any file, original quality.** Files are stored byte for byte. Nothing is compressed, resized or converted.
- **Text and links.** Paste a note or a URL and copy it or open it on the other side.
- **One-word links.** A free word is suggested before you send, so you know the link up front. Shuffle for another or type your own.
- **Expiry with a live countdown.** Pick 10 minutes, 1 hour, 1 day or 7 days. Both sides see the time left, and expired shares are deleted from disk.
- **Password protection.** With a password, files, names and text are encrypted in your browser before upload. The server never sees any of them.
- **Made for phones.** Camera and photo library buttons, Save to Photos through the share sheet, 44px tap targets, and the screen stays awake during uploads.
- **Quick sharing.** Copy, share, open, email or show a QR code for the link. Paste straight from the clipboard, or drag files anywhere on the page.
- **Accessible.** Larger text, high contrast, reduced motion and underlined links, saved per browser. Full keyboard support and screen reader labels throughout.
- **Your shares.** Links you create are remembered in your browser only, so you can copy or delete them later.

## Running locally

Requires Node.js 20 or newer.

```sh
git clone https://github.com/i3sam/ShareFast.git
cd ShareFast
npm install
npm start
```

Open http://localhost:3000. To try it from your phone on the same Wi-Fi, use your computer's local IP address, for example `http://192.168.1.20:3000`.

Clipboard access and password encryption only work on secure origins. `localhost` counts as secure, a LAN IP over plain `http` does not, so those two features need HTTPS when testing from another device.

Run the tests with `npm test`.

## Configuration

Settings are read from environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind to |
| `DATA_DIR` | `./data` | Where files are kept until they expire |
| `MAX_SHARE_MB` | `1024` | Maximum size of one share |
| `MAX_STORAGE_MB` | `20480` | Total disk space all shares may use |
| `MAX_FILES` | `50` | Maximum files per share |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy so rate limits see the real client IP |

## Deploying

ShareFast keeps files on local disk, so it needs a server or container with a persistent volume (a VPS, Fly.io, Railway and so on) rather than a static or serverless host. Run a single instance.

With Docker:

```sh
docker build -t sharefast .
docker run -d -p 3000:3000 -e TRUST_PROXY=true -v sharefast-data:/app/data sharefast
```

Then put HTTPS in front of it. With [Caddy](https://caddyserver.com), this is the whole config, and it gets a certificate automatically:

```
sharefast.essam.biz {
  reverse_proxy localhost:3000
}
```

If you use nginx instead, raise `client_max_body_size` above `MAX_SHARE_MB` and set `proxy_request_buffering off` so large uploads stream straight through.

Links and QR codes use whatever domain the site is served from, so there is nothing to configure for a custom domain.

## How it works

The server is plain Node.js with one dependency (`qrcode`). The frontend is HTML, CSS and JavaScript modules with no build step. The typeface is [Geist](https://vercel.com/font), self-hosted under the SIL Open Font License.

1. The browser asks the server to create a share and gets back the link and a private upload token.
2. Each file is streamed to disk with a `PUT` request. The server checks it matches the size that was announced.
3. The share opens once every file is in. Anyone who opens the link early sees upload progress.
4. A sweeper runs every minute and deletes expired shares.

Each share is a folder in `DATA_DIR` with a `meta.json` and one file per upload, so shares survive a restart.

### Encryption

Password-protected shares use the Web Crypto API.

- The key is derived with PBKDF2-SHA256 (600,000 iterations, random 16-byte salt) and used for AES-256-GCM.
- File names, types and text go into an encrypted manifest.
- Files are encrypted in 1 MiB chunks, each with its own IV, so large files never need to sit in memory as one buffer.

The server stores only ciphertext, the salt and the IVs. A wrong password fails GCM authentication, so the page can say so right away.

### Security notes

- One-word links are easy to type, which also makes them easy to guess. Looking up links that don't exist is tightly rate limited per IP, but that only slows guessing down. Use a password for anything private and send it separately from the link.
- Uploaded files are always served as downloads with `Content-Security-Policy: sandbox`. Only common image, video and audio types are shown inline as previews, never HTML or SVG.
- Every page has a strict Content Security Policy with no inline scripts and no third-party requests.

### iPhone photos

Safari can convert HEIC photos to JPEG when they're picked from the photo library. To send the untouched original, choose the photo through the Files app, or set Settings > Photos > Transfer to Mac or PC to Keep Originals.

## Project layout

```
server/
  index.js          starts the HTTP server and the expiry sweeper
  app.js            request handling, security headers, errors
  api.js            API routes
  store.js          share storage on disk
  validate.js       request validation
  static.js         pages and assets
public/
  index.html        send page
  share.html        receive page
  assets/app.css    all styles
  assets/js/        browser modules: send, receive, crypto, countdown, settings
test/               node:test suites
```

## Open source

ShareFast is free and open source under the [MIT license](LICENSE). Use it, fork it, host your own copy, or build something new on top of it.

Contributions are welcome. Open an [issue](https://github.com/i3sam/ShareFast/issues) for bugs and ideas, or send a pull request. Please run `npm test` before submitting.

## Author

ShareFast is designed and built by **Essam**. See more of my work at **[essam.biz](https://essam.biz)**.
