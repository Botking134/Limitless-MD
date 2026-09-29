// plugins/sticker.js
const config = require('../config');
const { saveState, normalizeToJid } = require('../stateManager');
const { setVar } = require('../vars');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// ─── CREDENTIALS & BRANDING DEFAULTS ──────────────────────────────
const KLIPY_API_KEY = process.env.KLIPY_API_KEY || '7wvbG3l5iJ1h21e3beb2xebaZuglezPhnMIHiJ0ooZodo39pceCYOxTQtKGOYMw6';
const DEFAULT_PACK = '𝕴𝖓𝖋𝖎𝖓𝖎𝖙𝖞';
const DEFAULT_AUTHOR = '〘♾️〙';

// ─── EMPIRE FONT TRANSFORMER (Bold Fraktur) ───────────────────────
function toEmpireFont(str) {
    if (!str) return '';
    const frakturMap = {
        'A': '𝕬', 'B': '𝕭', 'C': '𝕮', 'D': '𝕯', 'E': '𝕰', 'F': '𝕱', 'G': '𝕲', 'H': '𝕳', 'I': '𝕴',
        'J': '𝕵', 'K': '𝕶', 'L': '𝕷', 'M': '𝕸', 'N': '𝕹', 'O': '𝕺', 'P': '𝕻', 'Q': '𝕼', 'R': '𝕽',
        'S': '𝕾', 'T': '𝕿', 'U': '𝖀', 'V': '𝖁', 'W': '𝖂', 'X': '𝖃', 'Y': '𝖄', 'Z': '𝖅',
        'a': '𝖆', 'b': '𝖇', 'c': '𝖈', 'd': '𝖉', 'e': '𝖊', 'f': '𝖋', 'g': '𝖌', 'h': '𝖍', 'i': '𝖎',
        'j': '𝖏', 'k': '𝖐', 'l': '𝖑', 'm': '𝖒', 'n': '𝖓', 'o': '𝖔', 'p': '𝖕', 'q': '𝖖', 'r': '𝖗',
        's': '𝖘', 't': '𝖙', 'u': '𝖚', 'v': '𝖛', 'w': '𝖜', 'x': '𝖝', 'y': '𝖞', 'z': '𝖟',
        '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗'
    };
    return str.split('').map(c => frakturMap[c] || c).join('');
}

// ─── SAFE TTL IN-MEMORY CACHE ─────────────────────────────────────
const stickerCache = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of stickerCache.entries()) {
        if (now - val.timestamp > 300000) stickerCache.delete(key);
    }
}, 300000);

function getCacheKey(buffer, type, pack, author) {
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    return `${hash}_${type}_${pack}_${author}`;
}

// ─── HELPERS ──────────────────────────────────────────────────────
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

async function isVideoBuffer(buffer) {
    try {
        const metadata = await sharp(buffer).metadata();
        return metadata.pages && metadata.pages > 1;
    } catch {
        const header = buffer.slice(0, 12).toString('hex');
        return header.startsWith('1a45dfa3') || // webm
               header.startsWith('0000001c66747970') || // mp4
               header.startsWith('0000002066747970');
    }
}

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
}

function extractText(m) {
    const r = getRawMessage(m);
    return r?.conversation || r?.extendedTextMessage?.text ||
           r?.imageMessage?.caption || r?.videoMessage?.caption || '';
}

// ─── QUOTE-BUBBLE STICKER (emoji-safe) ────────────────────────────
async function renderQuoteSticker({ name, text, avatarBuf }) {
    const W = 512, FONT = `26px "Noto Sans", "Noto Color Emoji", sans-serif`;
    const NAME_FONT = `bold 24px "Noto Sans", "Noto Color Emoji", sans-serif`;
    const TIME_FONT = `18px "Noto Sans", sans-serif`;
    const AV = 64, bx = 16 + AV + 12, bw = W - bx - 16, pad = 18, tw = bw - pad * 2;

    const measure = createCanvas(1, 1).getContext('2d');
    measure.font = FONT;

    // wrap (breaks long words too)
    const lines = [];
    for (const para of text.trim().slice(0, 400).split('\n')) {
        let cur = '';
        for (let word of para.split(/\s+/)) {
            while (measure.measureText(word).width > tw) {
                let i = word.length;
                while (i > 1 && measure.measureText(word.slice(0, i)).width > tw) i--;
                if (cur) { lines.push(cur); cur = ''; }
                lines.push(word.slice(0, i));
                word = word.slice(i);
            }
            const test = cur ? `${cur} ${word}` : word;
            if (measure.measureText(test).width <= tw) cur = test;
            else { if (cur) lines.push(cur); cur = word; }
        }
        lines.push(cur);
    }
    const MAX = 9;
    if (lines.length > MAX) { lines.length = MAX; lines[MAX - 1] = lines[MAX - 1].slice(0, -1) + '…'; }

    const LH = 34, bh = pad + 30 + lines.length * LH + 26 + 6;
    const canvas = createCanvas(W, W);
    const ctx = canvas.getContext('2d');
    const by = Math.max(16, (W - bh) / 2);

    // bubble
    ctx.fillStyle = '#202c33';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 18); ctx.fill();

    // avatar
    const ay = by;
    ctx.save();
    ctx.beginPath(); ctx.arc(16 + AV / 2, ay + AV / 2, AV / 2, 0, Math.PI * 2); ctx.clip();
    if (avatarBuf) {
        try { ctx.drawImage(await loadImage(avatarBuf), 16, ay, AV, AV); }
        catch { avatarBuf = null; }
    }
    if (!avatarBuf) {
        ctx.fillStyle = '#6b7c85'; ctx.fillRect(16, ay, AV, AV);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 30px "Noto Sans", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((name[0] || '?').toUpperCase(), 16 + AV / 2, ay + AV / 2);
    }
    ctx.restore();

    ctx.textAlign = 'left'; ctx.textBaseline = 'top';

    // name (stable color per name)
    const palette = ['#06cf9c', '#53bdeb', '#ffa726', '#e26ab6', '#a7d24d', '#c5a3ff'];
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    ctx.font = NAME_FONT; ctx.fillStyle = palette[h % palette.length];
    let shownName = name;
    while (shownName.length > 3 && ctx.measureText(shownName).width > tw) shownName = shownName.slice(0, -2) + '…';
    ctx.fillText(shownName, bx + pad, by + pad - 4);

    // text
    ctx.font = FONT; ctx.fillStyle = '#e9edef';
    lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad + 30 + i * LH));

    // time
    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    ctx.font = TIME_FONT; ctx.fillStyle = '#8696a0'; ctx.textAlign = 'right';
    ctx.fillText(time, bx + bw - pad + 6, by + bh - 26);

    return canvas.toBuffer('image/png');
}

// ─── MEDIA → GIF (mp4 + gifPlayback) ──────────────────────────────
async function convertToGifMp4(buffer, kind) {
    const id = crypto.randomBytes(6).toString('hex');
    const inPath = path.join(os.tmpdir(), `gif_in_${id}.bin`);
    const outPath = path.join(os.tmpdir(), `gif_out_${id}.mp4`);
    const vf = 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p';
    try {
        let input = buffer;
        let loopArgs = '';

        if (kind === 'sticker' || kind === 'image') {
            if (await isVideoBuffer(buffer)) {
                // animated webp → gif via sharp (ffmpeg can't reliably decode animated webp)
                input = await sharp(buffer, { animated: true }).gif().toBuffer();
            } else {
                // static → 3s looping clip
                input = await sharp(buffer).png().toBuffer();
                loopArgs = '-loop 1 -t 3';
            }
        }

        await fs.promises.writeFile(inPath, input);
        await execAsync(
            `ffmpeg -y ${loopArgs} -i "${inPath}" -t 15 -an -c:v libx264 -preset veryfast -crf 26 ` +
            `-movflags +faststart -vf "${vf}" "${outPath}"`
        );
        return await fs.promises.readFile(outPath);
    } finally {
        try { await fs.promises.unlink(inPath); } catch {}
        try { await fs.promises.unlink(outPath); } catch {}
    }
}

// ─── STICKER PACK: LOAD FROM A RECEIVED PACK CARD ─────────────────
// A received pack card is ONE encrypted zip (stickerPackMessage.directPath +
// mediaKey). The items in packMsg.stickers only carry fileName/emojis/isAnimated,
// so they can't be downloaded individually. Download the zip once, unzip it,
// and map entries back by fileName.
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

async function loadPackStickers(packMsg) {
    const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
    const zipBuf = await streamToBuffer(await downloadContentFromMessage(packMsg, 'sticker-pack'));
    const entries = new AdmZip(zipBuf).getEntries().filter(e => !e.isDirectory);
    const find = (name) => name && entries.find(e => safeDecode(e.entryName) === safeDecode(name));

    const stickers = [];
    for (const s of packMsg.stickers || []) {
        const e = find(s.fileName);
        if (e) stickers.push(e.getData());
    }
    const tray = find(packMsg.trayIconFileName);

    if (!stickers.length) { // fallback: every webp in the zip, in order
        entries
            .filter(e => e !== tray && /\.webp$/i.test(e.entryName))
            .sort((a, b) => a.entryName.localeCompare(b.entryName))
            .forEach(e => stickers.push(e.getData()));
    }
    return { stickers, cover: tray ? tray.getData() : null };
}

// ─── STICKER PACK: WEBP NORMALIZERS (WhatsApp size limits) ────────
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// 512x512 WebP, ≤100KB static / ≤500KB animated (blank tiles = usually too big)
async function toPackWebp(buf) {
    try {
        const meta = await sharp(buf, { animated: true }).metadata();
        const animated = (meta.pages || 1) > 1;
        const limit = animated ? 500 * 1024 : 100 * 1024;

        for (const quality of [70, 55, 40, 28, 18]) {
            const out = await sharp(buf, { animated })
                .resize(512, 512, { fit: 'contain', background: CLEAR })
                .webp({ quality, effort: 4 }).toBuffer();
            if (out.length <= limit) return out;
        }
        // still too heavy: fall back to a static first frame
        return await sharp(buf)
            .resize(512, 512, { fit: 'contain', background: CLEAR })
            .webp({ quality: 45 }).toBuffer();
    } catch (e) {
        console.error('[toPackWebp]', e.message);
        return buf;
    }
}

// Static (first-frame) cover for the pack card
async function toPackCover(buf) {
    try {
        return await sharp(buf)
            .resize(252, 252, { fit: 'contain', background: CLEAR })
            .webp({ quality: 80 }).toBuffer();
    } catch {
        return buf;
    }
}

// ─── NATIVE STICKER PACK SENDER ────────────────────────────────────
// Uses the @itsliaaa/baileys fork's built-in Sticker Pack message
// (`stickers: [{ data: <Buffer|{url}> }], name, publisher, cover`).
async function sendStickerPackNative(sock, jid, { name, publisher, stickers, cover }, quotedMsg) {
    if (!stickers || !stickers.length) {
        throw new Error('No stickers to send');
    }
    const list = stickers.slice(0, 30);
    return await sock.sendMessage(jid, {
        cover: await toPackCover(cover || list[0]),
        stickers: list.map(s => ({ data: s })),
        name: name || DEFAULT_PACK,
        publisher: publisher || DEFAULT_AUTHOR,
        description: ''
    }, { quoted: quotedMsg });
}

// ─── ADAPTIVE VIDEO/GIF TO WEBP CONVERTER (<900KB & UP TO 15s) ───
async function convertVideoAdaptive(buffer, isCropped = false, pack = DEFAULT_PACK, author = DEFAULT_AUTHOR) {
    const tempId = crypto.randomBytes(6).toString('hex');
    const inputPath = path.join(os.tmpdir(), `input_${tempId}.bin`);
    const outputPath = path.join(os.tmpdir(), `output_${tempId}.webp`);

    try {
        await fs.promises.writeFile(inputPath, buffer);

        // 1. Probe video duration
        let duration = 6;
        try {
            const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`);
            const parsed = parseFloat(stdout.trim());
            if (!isNaN(parsed) && parsed > 0) duration = Math.min(15, parsed);
        } catch (e) {
            duration = 8;
        }

        // 2. Adaptive FPS & CRF based on duration
        let fps = 10;
        let quality = 22;
        if (duration <= 4) {
            fps = 14;
            quality = 35;
        } else if (duration <= 8) {
            fps = 11;
            quality = 28;
        } else {
            fps = 8;
            quality = 18;
        }

        const filter = isCropped
            ? `fps=${fps},scale=512:512:force_original_aspect_ratio=increase,crop=512:512,flags=lanczos`
            : `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,flags=lanczos`;

        // 3. Encode to WebP
        const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -t 15 -vf "${filter}" -vcodec libwebp -lossless 0 -q:v ${quality} -compression_level 4 -loop 0 -an -vsync 0 "${outputPath}"`;
        await execAsync(ffmpegCmd);

        let webpBuffer = await fs.promises.readFile(outputPath);

        // 4. Strict Safety Net Guard: If still > 900KB, crush down
        if (webpBuffer.length > 900000) {
            const reducedFilter = isCropped
                ? `fps=7,scale=400:400:force_original_aspect_ratio=increase,crop=400:400,pad=512:512:(512-400)/2:(512-400)/2:color=0x00000000`
                : `fps=7,scale=400:400:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
            const retryCmd = `ffmpeg -y -i "${inputPath}" -t 12 -vf "${reducedFilter}" -vcodec libwebp -lossless 0 -q:v 15 -compression_level 5 -loop 0 -an -vsync 0 "${outputPath}"`;
            await execAsync(retryCmd);
            webpBuffer = await fs.promises.readFile(outputPath);
        }

        // 5. Inject WhatsApp EXIF Metadata
        const sticker = new Sticker(webpBuffer, {
            pack: pack || DEFAULT_PACK,
            author: author || DEFAULT_AUTHOR,
            type: isCropped ? StickerTypes.CROPPED : StickerTypes.FULL,
            quality: 70
        });

        return await sticker.toBuffer();

    } catch (err) {
        // Fallback to standard wa-sticker-formatter
        const sticker = new Sticker(buffer, {
            pack: pack || DEFAULT_PACK,
            author: author || DEFAULT_AUTHOR,
            type: isCropped ? StickerTypes.CROPPED : StickerTypes.FULL,
            quality: 20
        });
        return await sticker.toBuffer();
    } finally {
        try { await fs.promises.unlink(inputPath); } catch (e) {}
        try { await fs.promises.unlink(outputPath); } catch (e) {}
    }
}

// ─── API CONVERTER FALLBACK ───────────────────────────────────────
async function convertViaApi(buffer, isCropped = false) {
    try {
        const form = new FormData();
        form.append('file', buffer, { filename: 'media', contentType: 'application/octet-stream' });
        form.append('crop', isCropped ? 'true' : 'false');
        form.append('pack', config.packName || DEFAULT_PACK);
        form.append('author', config.author || DEFAULT_AUTHOR);

        const response = await axios.post('https://apis.davidcyril.name.ng/converter/sticker', form, {
            headers: { ...form.getHeaders() },
            timeout: 15000
        });

        if (response.data && response.data.success && response.data.sticker) {
            return Buffer.from(response.data.sticker, 'base64');
        }
        return null;
    } catch {
        return null;
    }
}

// ─── STICKER CONVERT DISPATCHER (media + text/quote) ──────────────
async function handleSticker(sock, msg, args, isCropped = false) {
    const jid = msg.key.remoteJid;
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
    const quoted = contextInfo?.quotedMessage;

    let mediaContent = getRawMessage(quoted || msg.message);
    let mediaMessage = mediaContent?.imageMessage || mediaContent?.videoMessage || mediaContent?.stickerMessage;
    let mediaType = mediaContent?.imageMessage ? "image" : (mediaContent?.videoMessage ? "video" : (mediaContent?.stickerMessage ? "sticker" : ""));

    // ── TEXT → quote-bubble sticker ──
    if (!mediaMessage) {
        const quotedText = extractText(quoted);
        const text = quotedText || (args || '').trim();
        if (!text) {
            return await sock.sendMessage(jid, {
                text: `❌ Reply to media/text, or use \`${config.prefix}s <text>\`.`
            }, { quoted: msg });
        }
        try {
            await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });

            // who "said" it: the quoted author, or the sender if typed inline
            const senderJid = quotedText
                ? (contextInfo?.participant || jid)
                : (msg.key.participant || msg.key.remoteJid);
            const name = quotedText
                ? '+' + senderJid.split('@')[0].split(':')[0]
                : (msg.pushName || '+' + senderJid.split('@')[0].split(':')[0]);

            let avatarBuf = null;
            try {
                const url = await sock.profilePictureUrl(senderJid, 'image');
                const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
                avatarBuf = Buffer.from(res.data);
            } catch {}

            const png = await renderQuoteSticker({ name, text, avatarBuf });
            const sticker = new Sticker(png, {
                pack: config.packName || DEFAULT_PACK,
                author: config.author || DEFAULT_AUTHOR,
                type: StickerTypes.FULL,
                quality: 70
            });
            await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
        } catch (error) {
            await sock.sendMessage(jid, { text: `❌ Text sticker failed: ${error.message}` }, { quoted: msg });
        }
        return;
    }

    // ── MEDIA → sticker ──
    try {
        await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        const pack = config.packName || DEFAULT_PACK;
        const author = config.author || DEFAULT_AUTHOR;
        const cacheKey = getCacheKey(buffer, isCropped ? 'crop' : 'full', pack, author);

        if (stickerCache.has(cacheKey)) {
            const cached = stickerCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 300000) {
                await sock.sendMessage(jid, { sticker: cached.buffer }, { quoted: msg });
                await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
                return;
            }
        }

        const isVideo = await isVideoBuffer(buffer);
        let stickerBuffer = null;

        if (isVideo) {
            stickerBuffer = await convertVideoAdaptive(buffer, isCropped, pack, author);
        } else {
            stickerBuffer = await convertViaApi(buffer, isCropped);
            if (!stickerBuffer) {
                const sticker = new Sticker(buffer, {
                    pack: pack,
                    author: author,
                    type: isCropped ? StickerTypes.CROPPED : StickerTypes.FULL,
                    quality: 60
                });
                stickerBuffer = await sticker.toBuffer();
            }
        }

        stickerCache.set(cacheKey, { buffer: stickerBuffer, timestamp: Date.now() });

        await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
        await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });

    } catch (error) {
        console.error("❌ [STICKER] Error:", error.message);
        await sock.sendMessage(jid, { text: `❌ Sticker creation failed: ${error.message}` }, { quoted: msg });
    }
}

// ─── AUTO-WRAPPING & DYNAMIC MEME SVG GENERATOR ───────────────────
function generateMemeSvg(topText, bottomText) {
    const escapeXml = (str) => str.replace(/[&<>'"]/g, (c) => {
        switch (c) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case "'": return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });

    const wrapWords = (text, maxCharsPerLine = 15) => {
        if (!text) return [];
        const words = text.toUpperCase().trim().split(/\s+/);
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
                currentLine = (currentLine + ' ' + word).trim();
            } else {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines;
    };

    const topLines = wrapWords(topText);
    const bottomLines = wrapWords(bottomText);

    // Dynamic font sizing so text never spills over
    const maxLines = Math.max(topLines.length, bottomLines.length);
    let fontSize = 46;
    if (maxLines >= 3) fontSize = 32;
    else if (maxLines === 2) fontSize = 38;

    const strokeWidth = Math.round(fontSize * 0.12);

    const renderBlock = (lines, startY, isBottom = false) => {
        if (!lines.length) return '';
        const lineHeight = fontSize * 1.15;
        const totalHeight = (lines.length - 1) * lineHeight;
        const baseOffset = isBottom ? startY - totalHeight : startY;

        return lines.map((line, index) => {
            const y = baseOffset + (index * lineHeight);
            return `<text x="256" y="${y}" class="meme-text">${escapeXml(line)}</text>`;
        }).join('\n');
    };

    return Buffer.from(`
        <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
            <style>
                .meme-text {
                    font-family: 'Impact', 'Arial Black', 'Trebuchet MS', sans-serif;
                    font-size: ${fontSize}px;
                    font-weight: 900;
                    fill: #FFFFFF;
                    stroke: #000000;
                    stroke-width: ${strokeWidth}px;
                    stroke-linejoin: round;
                    paint-order: stroke fill;
                    text-anchor: middle;
                    dominant-baseline: central;
                }
            </style>
            ${renderBlock(topLines, 45, false)}
            ${renderBlock(bottomLines, 470, true)}
        </svg>
    `);
}

// ─── STICKER.LY: RELEVANCE PICKER ─────────────────────────────────
// Never blindly take packs[0] — Sticker.ly often returns unrelated packs
// ("My stickers", "Animated Stickers Pt. 05"). Returns null when nothing
// in the results actually matches the query.
const SEARCH_STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for']);

function pickBestPack(packs, query) {
    const q = query.toLowerCase().replace(/\b(stickers?|pack)\b/g, '').replace(/\s+/g, ' ').trim();
    const tokens = q.split(' ').filter(t => t && !SEARCH_STOP.has(t));
    if (!tokens.length) return packs[0] || null;

    const need = Math.max(1, Math.ceil(tokens.length / 2));
    let best = null, bestScore = 0;

    for (const p of packs) {
        const hay = `${p.name || ''} ${p.authorName || p.user?.name || ''} ${(p.tags || []).join(' ')}`.toLowerCase();
        const words = new Set(hay.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
        const matched = tokens.filter(t => words.has(t)).length;
        const phrase = hay.includes(q);
        if (!phrase && matched < need) continue;

        const score = matched * 2 + (phrase ? 10 : 0) +
            Math.min(1, Math.log10((p.viewCount || 0) + 1) / 10); // popularity = tie-breaker only
        if (score > bestScore) { best = p; bestScore = score; }
    }
    return best;
}

// ─── SEARCH STICKER.LY (ACCURATE TITLE & CREATOR) ──────────────────
// NOTE: distinguishes a genuine block/rate-limit response (403/429, or an
// error message that actually says so) from a bare transient 500, which
// Sticker.ly's backend throws for all sorts of unrelated reasons. Only the
// former sets `stickerlyBlocked`. A transient error gets one short-backoff
// retry against the same endpoint before moving on, instead of being
// treated as proof of a block.
async function searchStickerly(query) {
    const endpoints = [
        `https://api.sticker.ly/v3.1/stickerPack/search?keyword=${encodeURIComponent(query)}&limit=25&offset=0`,
        `https://api.sticker.ly/v3.1/stickerPack/search/${encodeURIComponent(query)}?limit=25&offset=0`
    ];

    const headers = {
        'User-Agent': 'okhttp/4.12.0',
        'package-name': 'com.snowcorp.stickerly.android',
        'app-version-code': '1033700',
        'manufacturer': 'Samsung',
        'model': 'SM-G998B',
        'os-version': '34',
        'content-type': 'application/json'
    };

    for (let e = 0; e < endpoints.length; e++) {
        const url = endpoints[e];

        // Space out hits to the second endpoint variant rather than firing
        // both back-to-back.
        if (e > 0) await new Promise(r => setTimeout(r, 600));

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const { data } = await axios.get(url, { headers, timeout: 8000 });
                const packs = data?.result?.stickerPacks || data?.stickerPacks || data?.data?.stickerPacks || [];

                if (packs.length > 0) {
                    const pack = pickBestPack(packs, query);
                    if (!pack) {
                        console.error(`⚠️ [STICKERLY] "${query}" returned ${packs.length} packs but none matched the query`);
                        break; // unrelated results: skip to the next endpoint / query variant
                    }

                    let stickerUrls = (pack.stickers || []).map(s =>
                        s?.resourceUrl || s?.imageFile?.contentUrl || s?.url ||
                        (pack.resourceUrlPrefix && s?.fileName ? pack.resourceUrlPrefix + s.fileName : null)
                    ).filter(Boolean);

                    if (!stickerUrls.length && pack.resourceUrlPrefix) {
                        stickerUrls = (pack.resourceFiles || []).map(f => pack.resourceUrlPrefix + f);
                    }

                    if (stickerUrls.length > 0) {
                        const exactAuthor = pack.user?.name || pack.authorName || pack.userName || pack.user?.nickname || 'Sticker.ly';
                        return {
                            name: pack.name || query,
                            publisher: exactAuthor,
                            urls: stickerUrls.slice(0, 30)
                        };
                    }
                    console.error(`⚠️ [STICKERLY] "${query}" matched a pack but 0 sticker URLs parsed — pack keys: ${Object.keys(pack).join(',')}, sticker[0] keys: ${Object.keys(pack.stickers?.[0] || {}).join(',')}`);
                    break; // got a real response, just nothing usable — no point retrying this endpoint
                } else if (data?.error) {
                    const errCode = String(data.error.errorCode ?? '');
                    const errMsg = String(data.error.errorMessage ?? '').toLowerCase();
                    const isRealBlock = ['403', '429'].includes(errCode) ||
                        /rate.?limit|forbidden|blocked|too many|unauthor/.test(errMsg);
                    // 404 (and similar "no such resource" codes) is a definitive
                    // answer, not a glitch — retrying it just burns a request and
                    // a delay for the same result. Only genuinely ambiguous/server
                    // errors (5xx, unlabeled) get the transient retry below.
                    const isNoMatch = errCode === '404';

                    if (isRealBlock) {
                        console.error(`⚠️ [STICKERLY] "${query}" API error response (block/rate-limit):`, JSON.stringify(data.error));
                        const blockedErr = new Error('STICKERLY_BLOCKED');
                        blockedErr.stickerlyBlocked = true;
                        blockedErr.raw = data.error;
                        throw blockedErr;
                    }

                    if (isNoMatch) {
                        console.error(`⚠️ [STICKERLY] "${query}" no match (404):`, JSON.stringify(data.error));
                        break; // move straight to the next endpoint / fallback, no retry
                    }

                    // Generic/transient server error (e.g. bare 500 internalError).
                    // Retry once after a short backoff before giving up on this
                    // endpoint — this is NOT treated as a block.
                    console.error(`⚠️ [STICKERLY] "${query}" transient error, attempt ${attempt + 1}/2:`, JSON.stringify(data.error));
                    if (attempt === 0) {
                        await new Promise(r => setTimeout(r, 900));
                        continue;
                    }
                } else {
                    console.error(`⚠️ [STICKERLY] "${query}" got 0 packs — top-level response keys: ${Object.keys(data || {}).join(',')}`);
                }
            } catch (err) {
                if (err.stickerlyBlocked) throw err;
                console.error(`⚠️ [STICKERLY] "${query}" via ${url.split('?')[0]} failed:`, err.response?.status || err.code || err.message);
            }
            break; // no retriable condition hit (or retry already used) — move to next endpoint
        }
    }
    return null;
}

// ─── STICKIFY / BACKUP FETCHER ────────────────────────────────────
async function searchStickify(query) {
    try {
        const url = `https://api.stickify.app/v1/stickers/search?q=${encodeURIComponent(query)}&limit=10`;
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 8000
        });
        const packs = res.data?.data || res.data?.packs || [];
        if (packs.length > 0) {
            const pack = packs[0];
            const stickerUrls = (pack.stickers || pack.images || []).map(s =>
                typeof s === 'string' ? s : (s.url || s.image_url || s.file)
            ).filter(Boolean);

            if (stickerUrls.length > 0) {
                return {
                    name: pack.name || pack.title || query,
                    publisher: pack.author || pack.username || pack.creator || 'Stickify',
                    urls: stickerUrls.slice(0, 30)
                };
            }
        }
    } catch (err) {
        console.error(`⚠️ [STICKIFY] "${query}" failed:`, err.response?.status || err.code || err.message);
    }
    return null;
}

// ─── COMBINED EXACT-METADATA PACK FETCHER ─────────────────────────
// Tries the literal query first (exact pack titles like "Naruto stickers
// bread4life" match this directly). If — and only if — that comes back as
// a genuine no-match (404, or a real response with 0 relevant packs), we
// widen to more search-friendly phrasing for generic single-word queries
// (e.g. "gojo" -> "gojo stickers"). A real block/rate-limit (403/429)
// short-circuits immediately instead of burning the remaining variants.
// Each variant is spaced out rather than fired back-to-back.
async function fetchStickerPack(query) {
    const trimmed = query.trim();
    const variants = [...new Set([
        trimmed,
        `${trimmed} stickers`,
        `${trimmed} sticker pack`
    ])];

    for (let i = 0; i < variants.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 800));

        try {
            const pack = await searchStickerly(variants[i]);
            if (pack && pack.urls.length) return pack;
        } catch (err) {
            if (err.stickerlyBlocked) {
                // Don't burn more requests against an active block/rate-limit —
                // that only makes it worse. Bubble up so the caller can tell
                // the user this isn't a "no results" situation.
                const e = new Error('Sticker.ly is rejecting requests right now');
                e.stickerlyBlocked = true;
                e.raw = err.raw;
                throw e;
            }
            // Any other error for this variant: fall through and try the next one.
        }
    }

    return null;
}

// ─── KLIPY GIF FETCHER ────────────────────────────────────────────
async function klipySearch(query, { limit = 5 } = {}) {
    const poolLimit = Math.max(30, limit * 3);
    const url = `https://api.klipy.com/v2/search?q=${encodeURIComponent(query)}&key=${KLIPY_API_KEY}&limit=${poolLimit}`;

    const { data } = await axios.get(url, { timeout: 15000 });
    const items = data?.results || data?.data?.data || data?.data || (Array.isArray(data) ? data : []);
    if (!items.length) return [];

    const allUrls = items.map(item => {
        return item?.media_formats?.gif?.url ||
               item?.media_formats?.tinygif?.url ||
               item?.media_formats?.mediumgif?.url ||
               item?.gif_url ||
               item?.url || null;
    }).filter(Boolean);

    // Fisher-Yates Shuffle
    for (let i = allUrls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allUrls[i], allUrls[j]] = [allUrls[j], allUrls[i]];
    }

    return allUrls.slice(0, limit);
}

// ─── COMMAND HANDLERS ─────────────────────────────────────────────

// 1. .sp <query> — Native WhatsApp Sticker Pack Card
async function handleSp(sock, msg, args) {
    const jid = msg.key.remoteJid;
    const query = (args || '').trim();

    if (!query) {
        return await sock.sendMessage(jid, {
            text: `❌ *Usage:* \`${config.prefix}sp <search term>\`\n*Example:* \`${config.prefix}sp Naruto stickers bread4life\``
        }, { quoted: msg });
    }

    const statusMsg = await sock.sendMessage(jid, { text: `⏳ _Fetching sticker pack, please wait..._` }, { quoted: msg });

    try {
        const pack = await fetchStickerPack(query);

        if (!pack || !pack.urls.length) {
            try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}
            return await sock.sendMessage(jid, { text: `❌ No sticker pack found for "${query}".` }, { quoted: msg });
        }

        // Download + normalize every sticker to a WhatsApp-valid WebP first
        // (instead of letting the fork fetch raw URLs).
        const results = await Promise.allSettled(pack.urls.map(async (u) => {
            const r = await axios.get(u, { responseType: 'arraybuffer', timeout: 12000 });
            return toPackWebp(Buffer.from(r.data));
        }));
        const buffers = results.filter(r => r.status === 'fulfilled').map(r => r.value);
        if (!buffers.length) throw new Error('Could not download any stickers from that pack');

        console.log(`[SP] "${pack.name}" by ${pack.publisher} → ${buffers.length} stickers:`,
            buffers.map(b => `${(b.length / 1024).toFixed(0)}KB`).join(', '));

        await sendStickerPackNative(sock, jid, {
            name: pack.name,
            publisher: pack.publisher,
            stickers: buffers
        }, msg);

        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}

    } catch (err) {
        console.error('[SP]', err);
        if (err.stickerlyBlocked) {
            console.error(`⚠️ [SP] Sticker.ly block confirmed for "${query}":`, JSON.stringify(err.raw));
        }
        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}
        await sock.sendMessage(jid, { text: `❌ Failed to fetch sticker pack: ${err.message}` }, { quoted: msg });
    }
}

// 2. .sf [-N] <query> — Animated Sticker Dropper (Default 5, Max 20)
async function handleSf(sock, msg, args) {
    const jid = msg.key.remoteJid;
    const input = (args || '').trim();

    if (!input) {
        return await sock.sendMessage(jid, {
            text: `❌ *Usage:* \`${config.prefix}sf <search term>\` or \`${config.prefix}sf -<count> <search term>\`\n\n*Examples:*\n• \`${config.prefix}sf goku\` _(Default 5)_\n• \`${config.prefix}sf -10 goku\` _(Drops 10)_\n• \`${config.prefix}sf 10 goku\` _(Searches "10 goku", drops 5)_`
        }, { quoted: msg });
    }

    let count = 5;
    let query = input;

    // Check for hyphen flag: -10 goku or -20 naruto
    const flagMatch = input.match(/^-(\d+)\s*(.*)$/);
    if (flagMatch) {
        count = Math.min(20, Math.max(1, parseInt(flagMatch[1])));
        query = flagMatch[2].trim();
    }

    if (!query) {
        return await sock.sendMessage(jid, { text: `❌ Please provide a search query after the count.` }, { quoted: msg });
    }

    let gifUrls = [];
    try {
        gifUrls = await klipySearch(query, { limit: count });
    } catch (err) {
        return await sock.sendMessage(jid, { text: `❌ Klipy API Error: ${err.message}` }, { quoted: msg });
    }

    if (!gifUrls.length) {
        return await sock.sendMessage(jid, { text: `❌ No results found on Klipy for "${query}".` }, { quoted: msg });
    }

    await sock.sendMessage(jid, { text: `📦 *Fetching "${query}"* — converting ${gifUrls.length} GIF(s) to stickers...` }, { quoted: msg });

    let delivered = 0;
    for (const url of gifUrls) {
        try {
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
            const buffer = Buffer.from(res.data);

            const stickerBuffer = await convertVideoAdaptive(buffer, false, DEFAULT_PACK, DEFAULT_AUTHOR);
            await sock.sendMessage(jid, { sticker: stickerBuffer });
            delivered++;
        } catch (err) {
            console.error(`⚠️ [SF] Conversion error:`, err.message);
        }
        await new Promise(r => setTimeout(r, 1200));
    }

    await sock.sendMessage(jid, {
        text: delivered > 0
            ? `✅ Delivered ${delivered}/${gifUrls.length} stickers for *"${query}"*.`
            : `❌ Failed to convert stickers for "${query}".`
    }, { quoted: msg });
}

// ─── EXPORT COMMANDS ──────────────────────────────────────────────
module.exports = [
    // 1. STICKER
    {
        name: 'sticker',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSticker(sock, msg, args, false);
        }
    },

    // 2. CROP
    {
        name: 'crop',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSticker(sock, msg, args, true);
        }
    },

    // 3. TAKE / STEAL
    {
        name: 'take',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);

            if (!rawContent?.stickerMessage) {
                return await sock.sendMessage(jid, { text: "❌ Reply to a sticker to take its metadata." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                let pack = DEFAULT_PACK;
                let author = DEFAULT_AUTHOR;

                if (args && args.trim()) {
                    const parts = args.split('|');
                    pack = toEmpireFont(parts[0].trim());
                    author = parts[1] ? toEmpireFont(parts[1].trim()) : DEFAULT_AUTHOR;
                }

                const isAnimated = await isVideoBuffer(buffer);
                const sticker = new Sticker(buffer, {
                    pack: pack,
                    author: author,
                    type: StickerTypes.FULL,
                    quality: isAnimated ? 25 : 60
                });

                const stickerBuffer = await sticker.toBuffer();
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
                await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 4. PACKNAME (Empire Styler & Dual Mode)
    {
        name: 'packname',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawQuoted = getRawMessage(quoted);
            const packMsg = rawQuoted?.stickerPackMessage || rawQuoted?.stickerPackMessageV2;

            let newPack = DEFAULT_PACK;
            let newAuthor = DEFAULT_AUTHOR;

            if (args && args.trim()) {
                const parts = args.split('|');
                newPack = toEmpireFont(parts[0].trim());
                newAuthor = parts[1] ? toEmpireFont(parts[1].trim()) : DEFAULT_AUTHOR;
            }

            // DUAL CAPABILITY: If replied to a pack card, rebuild it with new branding.
            // NOTE (unchanged from before): this path has no isOwner/isDev gate —
            // anyone can rebrand a pack card they reply to. Flagging again in case
            // that's not intentional; say the word and I'll lock it down.
            if (packMsg) {
                const statusMsg = await sock.sendMessage(jid, { text: "🎨 _Rebranding sticker pack..._" }, { quoted: msg });
                try {
                    const { stickers: buffers, cover } = await loadPackStickers(packMsg);

                    if (!buffers.length) {
                        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}
                        return await sock.sendMessage(jid, { text: "❌ Couldn't read any stickers from that pack card." }, { quoted: msg });
                    }

                    await sendStickerPackNative(sock, jid, {
                        name: newPack,
                        publisher: newAuthor,
                        stickers: buffers,
                        cover
                    }, msg);

                    try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}
                    return await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
                } catch (e) {
                    console.error('[PACKNAME]', e);
                    try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}
                    return await sock.sendMessage(jid, { text: `❌ Failed to rebrand pack card: ${e.message}` }, { quoted: msg });
                }
            }

            // STANDALONE MODE: Update global defaults (Owner/Dev only)
            if (!isOwner && !isDev) {
                return await sock.sendMessage(jid, { text: "❌ Setting global defaults is restricted to Owner/Dev." }, { quoted: msg });
            }

            config.packName = newPack;
            config.author = newAuthor;

            try {
                setVar('packName', newPack);
                setVar('author', newAuthor);
                saveState();
            } catch {}

            await sock.sendMessage(jid, {
                text: `✅ *Sticker Branding Updated!* \n\n• *Pack Name:* \`${newPack}\`\n• *Author:* \`${newAuthor}\``
            }, { quoted: msg });
        }
    },

    // 5. SMEME (Auto-wrapping, non-overflowing meme sticker)
    {
        name: 'smeme',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            const mediaMessage = rawContent?.imageMessage || rawContent?.stickerMessage;
            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Reply to an image or static sticker to create a meme sticker." }, { quoted: msg });
            }

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ *Usage:* Reply to media with \`${config.prefix}smeme <text>\` or \`${config.prefix}smeme top | bottom\`` }, { quoted: msg });
            }

            let topText = '';
            let bottomText = '';
            const input = args.trim();

            if (input.includes('|')) {
                const parts = input.split('|');
                topText = parts[0].trim();
                bottomText = parts[1].trim();
            } else if (input.toLowerCase().startsWith('top ')) {
                topText = input.slice(4).trim();
            } else if (input.toLowerCase().startsWith('bottom ')) {
                bottomText = input.slice(7).trim();
            } else {
                bottomText = input;
            }

            await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const mediaType = rawContent?.imageMessage ? 'image' : 'sticker';
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const baseImage = await sharp(buffer).resize(512, 512, { fit: 'cover' }).png().toBuffer();
                const svgOverlay = generateMemeSvg(topText, bottomText);
                const memedBuffer = await sharp(baseImage)
                    .composite([{ input: svgOverlay, top: 0, left: 0 }])
                    .png()
                    .toBuffer();

                const sticker = new Sticker(memedBuffer, {
                    pack: config.packName || DEFAULT_PACK,
                    author: config.author || DEFAULT_AUTHOR,
                    type: StickerTypes.FULL,
                    quality: 60
                });

                const stickerBuffer = await sticker.toBuffer();
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
                await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });

            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Failed to create meme sticker: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 6. FIXPACK (re-downloads the pack zip, re-encodes every tile cleanly,
    // and resends the whole pack fresh via the native stickers API)
    {
        name: 'fixpack',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawQuoted = getRawMessage(quoted);

            const packMsg = rawQuoted?.stickerPackMessage || rawQuoted?.stickerPackMessageV2;

            if (!packMsg || !packMsg.stickers || packMsg.stickers.length === 0) {
                return await sock.sendMessage(jid, { text: "❌ Please reply directly to a broken WhatsApp Sticker Pack card." }, { quoted: msg });
            }

            const statusMsg = await sock.sendMessage(jid, { text: "🔧 _Repairing sticker pack buffers & EXIF metadata..._" }, { quoted: msg });

            try {
                const { stickers: raw, cover } = await loadPackStickers(packMsg);

                const fixedBuffers = [];
                for (const b of raw) {
                    try {
                        fixedBuffers.push(await toPackWebp(b));
                    } catch (e) {
                        console.error('⚠️ [FIXPACK] Sticker repair failed:', e.message);
                    }
                }

                if (!fixedBuffers.length) {
                    try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}
                    return await sock.sendMessage(jid, { text: "❌ Couldn't repair any stickers — all downloads/conversions failed." }, { quoted: msg });
                }

                await sendStickerPackNative(sock, jid, {
                    name: packMsg.name || DEFAULT_PACK,
                    publisher: packMsg.publisher || DEFAULT_AUTHOR,
                    stickers: fixedBuffers,
                    cover
                }, msg);

                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}

                if (fixedBuffers.length < packMsg.stickers.length) {
                    await sock.sendMessage(jid, {
                        text: `⚠️ Repaired ${fixedBuffers.length}/${packMsg.stickers.length} stickers — the rest failed and were dropped.`
                    }, { quoted: msg });
                }

            } catch (err) {
                console.error('[FIXPACK]', err);
                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}
                await sock.sendMessage(jid, { text: `❌ Failed to repair pack: ${err.message}` }, { quoted: msg });
            }
        }
    },

    // 7. SP (Interactive Sticker Pack Card)
    {
        name: 'sp',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSp(sock, msg, args);
        }
    },

    // 8. SF (GIF-to-Stickers Dropper)
    {
        name: 'sf',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSf(sock, msg, args);
        }
    },

    // 9. UNPACK (1-by-1 Extractor)
    {
        name: 'unpack',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawQuoted = getRawMessage(quoted);

            const packMsg = rawQuoted?.stickerPackMessage || rawQuoted?.stickerPackMessageV2;

            if (!packMsg || !packMsg.stickers || packMsg.stickers.length === 0) {
                return await sock.sendMessage(jid, { text: "❌ Please reply directly to a WhatsApp Sticker Pack message." }, { quoted: msg });
            }

            const total = packMsg.stickers.length;

            await sock.sendMessage(jid, {
                text: `📦 *Unpacking: "${packMsg.name || 'Pack'}"*\n• *Total Stickers:* \`${total}\`\n• *Delivery Interval:* \`1 every 2s\`\n\nStarting delivery...`
            }, { quoted: msg });

            try {
                const { stickers: buffers } = await loadPackStickers(packMsg);

                let delivered = 0;
                for (const buffer of buffers) {
                    try {
                        await sock.sendMessage(jid, { sticker: buffer });
                        delivered++;
                    } catch (err) {
                        console.error(`⚠️ [UNPACK] send failed:`, err.message);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                }

                await sock.sendMessage(jid, {
                    text: `✅ *Unpacking Complete!* Delivered \`${delivered}/${total}\` stickers from *"${packMsg.name || 'Pack'}"*.`
                }, { quoted: msg });

            } catch (err) {
                console.error('[UNPACK]', err);
                await sock.sendMessage(jid, { text: `❌ Unpacking failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    // 10. TOGIF (video/sticker/image → WhatsApp GIF)
    {
        name: 'togif',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const content = getRawMessage(contextInfo?.quotedMessage || msg.message);

            const mediaMessage = content?.videoMessage || content?.stickerMessage || content?.imageMessage;
            const kind = content?.videoMessage ? 'video' : content?.stickerMessage ? 'sticker' : 'image';

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Reply to a video, sticker, or image to convert to GIF." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, kind);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const mp4 = await convertToGifMp4(buffer, kind);
                await sock.sendMessage(jid, { video: mp4, gifPlayback: true, mimetype: 'video/mp4' }, { quoted: msg });
                await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ GIF conversion failed: ${error.message}` }, { quoted: msg });
            }
        }
    }
];

// ─── COMMAND ALIASES ──────────────────────────────────────────────
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') aliases.push({ ...cmd, name: 's' });
    if (cmd.name === 'take') aliases.push({ ...cmd, name: 'steal' });
});
module.exports.push(...aliases);
