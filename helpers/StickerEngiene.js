// helpers/StickerEngine.js
//
// Shared animated-sticker converter used by .s, .crop and .smeme.
//
// Why this exists: WhatsApp refuses to show/download an animated sticker larger than
// about 500 KB. The old converter encoded once at a fixed quality (allowing up to 900 KB),
// then re-encoded the result a second time through wa-sticker-formatter, which usually made it
// bigger again. Long or detailed GIFs therefore came out as stickers WhatsApp would not accept,
// or the encoder ran so long the command timed out.
//
// This one ADAPTS: it encodes, measures the real file size, and steps down through a ladder of
// fps / resolution / quality until the sticker fits. It never re-encodes after that, only adds the
// pack name / author metadata to the file in place. Every ffmpeg run has its own time limit, the
// whole job has a deadline, and only a few conversions run at once so they do not starve each other.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const sharp = require('sharp');

// ═══════════════ HARDCODED SIZES — edit these numbers to taste ═══════════════
// WhatsApp's own limits are ~500 KB (animated) and 100 KB (still); these are set well
// under them so a sticker always downloads, even after the pack-name metadata is added.
const MAX_ANIMATED_BYTES = 300 * 1000;   // animated sticker: never larger than 300 KB
const MAX_STATIC_BYTES = 80 * 1024;      // still sticker: never larger than 80 KB
const MAX_SECONDS = 8;                   // longest clip turned into a sticker
const JOB_DEADLINE_MS = 75 * 1000;       // stop trying better fits after this long
const STEP_TIMEOUT_MS = 30 * 1000;       // one ffmpeg run
const MAX_FRAMES = 160;

// Fixed steps, best first. Every sticker is still a 512x512 canvas: lower steps shrink the
// picture first and scale it back up, which keeps the canvas size WhatsApp expects but makes
// the file much smaller. A clip starts on the step that matches its length, then moves down
// the list until it is under MAX_ANIMATED_BYTES.
const LADDER = [
    { fps: 15, size: 512, q: 50 },   // 0  short clips (<= 2s)
    { fps: 12, size: 480, q: 40 },   // 1  (<= 4s)
    { fps: 10, size: 448, q: 34 },   // 2  (<= 6s)
    { fps: 10, size: 400, q: 28 },   // 3  (longer)
    { fps: 8,  size: 360, q: 24 },
    { fps: 8,  size: 320, q: 20 },
    { fps: 6,  size: 256, q: 16 }
];
const START_RUNG = (seconds) => (seconds <= 2 ? 0 : seconds <= 4 ? 1 : seconds <= 6 ? 2 : 3);

// Still stickers: [longest side in px, webp quality], best first.
const STATIC_STEPS = [[512, 60], [512, 45], [448, 32], [384, 22], [320, 14]];

// ─── LIMIT HOW MANY CONVERSIONS RUN AT ONCE ───────────────────────
const MAX_PARALLEL = 2;
let running = 0;
const waiting = [];
async function slot(fn) {
    if (running >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
    running++;
    try { return await fn(); }
    finally {
        running--;
        const next = waiting.shift();
        if (next) next();
    }
}

// ─── SMALL HELPERS ────────────────────────────────────────────────
function run(bin, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                const why = err.killed ? `${bin} timed out` : String(stderr || err.message).split('\n').filter(Boolean).pop();
                return reject(new Error(why || `${bin} failed`));
            }
            resolve(stdout);
        });
    });
}

// Some ffmpeg builds only have "libwebp"; newer ones also have "libwebp_anim". Use the best one available.
let webpCodec = null;
async function pickWebpCodec() {
    if (webpCodec) return webpCodec;
    try {
        const out = await run('ffmpeg', ['-hide_banner', '-encoders'], 10000);
        webpCodec = /libwebp_anim/.test(out) ? 'libwebp_anim' : 'libwebp';
    } catch (e) {
        webpCodec = 'libwebp';
    }
    return webpCodec;
}

function tmpFile(ext) {
    return path.join(os.tmpdir(), `stk_${crypto.randomBytes(6).toString('hex')}${ext}`);
}
async function rmQuiet(...files) {
    for (const f of files) { try { await fs.promises.rm(f, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
}

// What kind of media is this? Decided from the file's own bytes, not from guesses about the name.
//   'animwebp' = animated WebP (an animated sticker)   'video' = mp4 / webm / mov / gif
//   'image'    = anything else (png, jpg, still webp...)
function sniff(buf) {
    if (!buf || buf.length < 16) return 'image';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        if (buf.toString('ascii', 12, 16) === 'VP8X' && (buf[20] & 0x02)) return 'animwebp';
        return 'image';
    }
    if (buf.toString('ascii', 0, 4) === 'GIF8') return 'video';
    if (buf.toString('ascii', 4, 8) === 'ftyp') return 'video';
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video';
    return 'image';
}

async function probeDuration(file) {
    try {
        const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], 10000);
        const d = parseFloat(String(out).trim());
        if (d > 0) return d;
    } catch (e) { /* fall through */ }
    return 6;
}

// ─── WHATSAPP STICKER METADATA (pack name / author), added without re-encoding ───
function buildExif(pack, author) {
    const json = {
        'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
        'sticker-pack-name': String(pack || ''),
        'sticker-pack-publisher': String(author || ''),
        'emojis': []
    };
    const attr = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const body = Buffer.from(JSON.stringify(json), 'utf-8');
    const exif = Buffer.concat([attr, body]);
    exif.writeUIntLE(body.length, 14, 4);
    return exif;
}

// Writes the metadata into an animated WebP (RIFF container) in place. Replaces any EXIF it
// already had. Returns null if the file is not an extended WebP, so the caller can fall back.
function injectExif(webp, pack, author) {
    if (webp.length < 30 || webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') return null;
    if (webp.toString('ascii', 12, 16) !== 'VP8X') return null;

    const parts = [webp.subarray(0, 12)];
    let pos = 12;
    while (pos + 8 <= webp.length) {
        const tag = webp.toString('ascii', pos, pos + 4);
        const len = webp.readUInt32LE(pos + 4);
        const end = Math.min(webp.length, pos + 8 + len + (len % 2));
        if (tag !== 'EXIF') {
            let chunk = webp.subarray(pos, end);
            if (tag === 'VP8X') { chunk = Buffer.from(chunk); chunk[8] |= 0x08; } // flag: has EXIF
            parts.push(chunk);
        }
        pos = end;
    }
    const exif = buildExif(pack, author);
    const head = Buffer.alloc(8);
    head.write('EXIF', 0, 'ascii');
    head.writeUInt32LE(exif.length, 4);
    parts.push(head, exif);
    if (exif.length % 2) parts.push(Buffer.alloc(1));

    const out = Buffer.concat(parts);
    out.writeUInt32LE(out.length - 8, 4);
    return out;
}

// ─── THE ADAPTIVE ENCODER ─────────────────────────────────────────
// inputArgs : ffmpeg input arguments, e.g. ['-i', file] or ['-framerate', '12', '-i', 'dir/f_%04d.png']
// overlay   : optional 512x512 PNG laid over every frame (used by .smeme on video / gif)
// crop      : true = fill the square (crop the edges), false = fit inside it (transparent bars)
async function encodeAnimated({ inputArgs, overlay = null, crop = false, duration = 6 }) {
    const started = Date.now();
    const seconds = Math.min(MAX_SECONDS, Math.max(1, duration));

    const fit = crop
        ? 'scale=512:512:force_original_aspect_ratio=increase:flags=lanczos,crop=512:512'
        : 'format=rgba,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';

    const encode = async (rung, secs) => {
        const out = tmpFile('.webp');
        const shrink = rung.size < 512 ? `,scale=${rung.size}:${rung.size}:flags=lanczos,scale=512:512:flags=bicubic` : '';
        const graph = overlay
            ? `[0:v]fps=${rung.fps},${fit}[b];[b][1:v]overlay=0:0:format=auto${shrink}[v]`
            : `[0:v]fps=${rung.fps},${fit}${shrink}[v]`;
        const args = ['-nostdin', '-y', '-loglevel', 'error', ...inputArgs];
        if (overlay) args.push('-i', overlay);
        args.push('-t', String(secs), '-filter_complex', graph, '-map', '[v]', '-an',
            '-c:v', await pickWebpCodec(), '-lossless', '0', '-q:v', String(rung.q), '-compression_level', '3', '-loop', '0', '-f', 'webp', out);
        try {
            const left = Math.max(5000, JOB_DEADLINE_MS + 20000 - (Date.now() - started));
            await run('ffmpeg', args, Math.min(STEP_TIMEOUT_MS, left));
            return await fs.promises.readFile(out);
        } finally {
            await rmQuiet(out);
        }
    };

    // longer clips start lower on the ladder, short ones start at full quality
    let idx = START_RUNG(seconds);
    let best = null;
    let triedUp = false;

    while (idx < LADDER.length) {
        if (Date.now() - started > JOB_DEADLINE_MS && idx < LADDER.length - 1) idx = LADDER.length - 1; // out of time: go straight to the smallest
        const buf = await encode(LADDER[idx], idx >= LADDER.length - 1 ? Math.min(seconds, 6) : seconds);

        if (buf.length <= MAX_ANIMATED_BYTES) {
            // fits. If it fits with lots of room and we started low, try one rung better once.
            if (!best || buf.length > best.length) best = buf;
            if (!triedUp && idx > 0 && buf.length < MAX_ANIMATED_BYTES * 0.45 && Date.now() - started < JOB_DEADLINE_MS / 2) {
                triedUp = true;
                try {
                    const better = await encode(LADDER[idx - 1], seconds);
                    if (better.length <= MAX_ANIMATED_BYTES) best = better;
                } catch (e) { /* keep the one that fit */ }
            }
            return best;
        }
        // too big: skip two rungs if it is far over, otherwise one
        idx += buf.length > MAX_ANIMATED_BYTES * 2 ? 2 : 1;
    }
    throw new Error('this clip is too detailed to fit WhatsApp\'s sticker size limit, even at the lowest quality. Try a shorter one.');
}

// ─── PUBLIC: video / gif -> animated sticker ──────────────────────
async function videoToSticker(buffer, { crop = false, pack = '', author = '', overlay = null } = {}) {
    return slot(async () => {
        const input = tmpFile('.bin');
        try {
            await fs.promises.writeFile(input, buffer);
            const duration = await probeDuration(input);
            const webp = await encodeAnimated({ inputArgs: ['-i', input], overlay, crop, duration });
            return finish(webp, pack, author);
        } finally { await rmQuiet(input); }
    });
}

// ─── PUBLIC: animated WebP (an animated sticker) -> animated sticker ───
// ffmpeg cannot decode animated WebP, so the frames are pulled out with sharp, optionally
// captioned (overlay), and re-encoded through the same adaptive encoder.
async function animWebpToSticker(buffer, { crop = false, pack = '', author = '', overlay = null } = {}) {
    // Plain re-brand: already small enough and no changes asked for -> only swap the metadata.
    if (!crop && !overlay && buffer.length <= MAX_ANIMATED_BYTES) {
        const same = injectExif(buffer, pack, author);
        if (same) return same;
    }
    return slot(async () => {
        const dir = tmpFile('_frames');
        try {
            await fs.promises.mkdir(dir, { recursive: true });
            const meta = await sharp(buffer, { animated: true, limitInputPixels: false }).metadata();
            const pages = meta.pages || 1;
            const ph = meta.pageHeight || meta.height;
            const delays = Array.isArray(meta.delay) && meta.delay.length ? meta.delay : [];

            const { data, info } = await sharp(buffer, { animated: true, limitInputPixels: false })
                .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            const frameBytes = info.width * ph * 4;

            // keep at most MAX_SECONDS / MAX_FRAMES of the animation
            let total = 0, count = 0;
            for (let i = 0; i < pages && count < MAX_FRAMES; i++) {
                const d = Math.max(20, Number(delays[i]) || 100);
                if (total + d > MAX_SECONDS * 1000 && count > 0) break;
                total += d; count++;
            }
            const avg = total / Math.max(1, count);
            const fps = Math.min(25, Math.max(5, Math.round(1000 / avg)));
            const overlayBuf = overlay ? await fs.promises.readFile(overlay) : null;

            for (let i = 0; i < count; i++) {
                let img = sharp(data.subarray(i * frameBytes, (i + 1) * frameBytes), { raw: { width: info.width, height: ph, channels: 4 } })
                    .resize(512, 512, { fit: crop || overlay ? 'cover' : 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
                if (overlayBuf) img = img.composite([{ input: overlayBuf }]);
                await img.png({ compressionLevel: 1 }).toFile(path.join(dir, `f_${String(i).padStart(4, '0')}.png`));
            }

            const webp = await encodeAnimated({
                inputArgs: ['-framerate', String(fps), '-i', path.join(dir, 'f_%04d.png')],
                crop: false, // frames are already 512x512
                duration: count / fps
            });
            return finish(webp, pack, author);
        } finally { await rmQuiet(dir); }
    });
}

function finish(webp, pack, author) {
    const tagged = injectExif(webp, pack, author);
    if (!tagged) return webp; // untagged still plays; only the pack name would be missing
    return tagged;
}

module.exports = {
    sniff, videoToSticker, animWebpToSticker, injectExif,
    MAX_ANIMATED_BYTES, MAX_STATIC_BYTES, STATIC_STEPS
};
