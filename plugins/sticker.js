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

// ─── DOWNLOAD A STICKER OBJECT FROM A RECEIVED stickerPackMessage ──
// Real WhatsApp sticker-pack entries (native packs, or packs we built
// ourselves via the fork's `stickers:` API) are encrypted media refs
// and must go through downloadContentFromMessage. The plain-`.url`
// branch is kept only as a defensive fallback for any legacy/odd shape.
async function downloadPackSticker(stickerObj, downloadContentFromMessage) {
    const directUrl = typeof stickerObj === 'string'
        ? stickerObj
        : (stickerObj?.url || stickerObj?.data?.url);

    if (directUrl && directUrl.startsWith('http')) {
        const res = await axios.get(directUrl, { responseType: 'arraybuffer', timeout: 10000 });
        return Buffer.from(res.data);
    }

    const stream = await downloadContentFromMessage(stickerObj, 'sticker');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

// ─── NATIVE STICKER PACK SENDER ────────────────────────────────────
// Uses the @itsliaaa/baileys fork's built-in Sticker Pack message
// (`stickers: [{ data: <Buffer|{url}> }], name, publisher, cover`).
// The fork uploads/encrypts each item to WhatsApp's media server
// internally — no manual proto-building or media upload code needed.
async function sendStickerPackNative(sock, jid, { name, publisher, stickers, cover }, quotedMsg) {
    if (!stickers || !stickers.length) {
        throw new Error('No stickers to send');
    }
    return await sock.sendMessage(jid, {
        cover: cover || stickers[0],
        stickers: stickers.map(s => ({ data: s })),
        name: name || DEFAULT_PACK,
        publisher: publisher || DEFAULT_AUTHOR
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

// ─── STICKER CONVERT DISPATCHER ──────────────────────────────────
async function handleSticker(sock, msg, args, isCropped = false) {
    const jid = msg.key.remoteJid;
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
    const quoted = contextInfo?.quotedMessage;

    let mediaContent = getRawMessage(quoted || msg.message);
    let mediaMessage = mediaContent?.imageMessage || mediaContent?.videoMessage || mediaContent?.stickerMessage;
    let mediaType = mediaContent?.imageMessage ? "image" : (mediaContent?.videoMessage ? "video" : (mediaContent?.stickerMessage ? "sticker" : ""));

    if (!mediaMessage) {
        return await sock.sendMessage(jid, { text: "❌ Please reply to an image, video, or sticker to convert." }, { quoted: msg });
    }

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

// ─── SEARCH STICKER.LY (ACCURATE TITLE & CREATOR) ──────────────────
// ─── ROTATING DEVICE FINGERPRINTS (sticker.ly spoof headers) ──────
// A single hardcoded device identity is an easy target for fingerprint-based
// blocking. Rotating between a small pool of plausible Android devices means
// one flagged fingerprint doesn't take down every request going forward.
const STICKERLY_DEVICE_PROFILES = [
    { manufacturer: 'Samsung', model: 'SM-G998B', osVersion: '34', appVersionCode: '1033700' },
    { manufacturer: 'Samsung', model: 'SM-S918B', osVersion: '35', appVersionCode: '1034100' },
    { manufacturer: 'Google', model: 'Pixel 8 Pro', osVersion: '35', appVersionCode: '1033700' },
    { manufacturer: 'Xiaomi', model: '2201116SG', osVersion: '34', appVersionCode: '1032900' },
    { manufacturer: 'OnePlus', model: 'CPH2581', osVersion: '34', appVersionCode: '1034100' }
];

function getStickerlyHeaders() {
    const p = STICKERLY_DEVICE_PROFILES[Math.floor(Math.random() * STICKERLY_DEVICE_PROFILES.length)];
    return {
        'User-Agent': 'okhttp/4.12.0',
        'package-name': 'com.snowcorp.stickerly.android',
        'app-version-code': p.appVersionCode,
        'manufacturer': p.manufacturer,
        'model': p.model,
        'os-version': p.osVersion,
        'content-type': 'application/json'
    };
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function searchStickerly(query) {
    const endpoints = [
        `https://api.sticker.ly/v3.1/stickerPack/search?keyword=${encodeURIComponent(query)}&limit=25&offset=0`,
        `https://api.sticker.ly/v3.1/stickerPack/search/${encodeURIComponent(query)}?limit=25&offset=0`
    ];

    // Same rotated identity for both endpoint attempts within this one call —
    // consistent per-call, but a fresh pick on the next call/variant.
    const headers = getStickerlyHeaders();

    for (let i = 0; i < endpoints.length; i++) {
        const url = endpoints[i];
        if (i > 0) await delay(400 + Math.floor(Math.random() * 300));
        try {
            const { data } = await axios.get(url, { headers, timeout: 8000 });
            const packs = data?.result?.stickerPacks || data?.stickerPacks || data?.data?.stickerPacks || [];
            if (packs.length > 0) {
                const pack = packs[0];
                const stickerUrls = (pack.stickers || []).map(s =>
                    s?.resourceUrl || s?.imageFile?.contentUrl || s?.url || null
                ).filter(Boolean);

                if (stickerUrls.length > 0) {
                    // Exact name and creator as fetched
                    const exactAuthor = pack.user?.name || pack.authorName || pack.userName || pack.user?.nickname || 'Sticker.ly';
                    return {
                        name: pack.name || query,
                        publisher: exactAuthor,
                        urls: stickerUrls.slice(0, 30)
                    };
                }
                console.error(`⚠️ [STICKERLY] "${query}" matched a pack but 0 sticker URLs parsed — pack keys: ${Object.keys(pack).join(',')}, sticker[0] keys: ${Object.keys(pack.stickers?.[0] || {}).join(',')}`);
            } else if (data?.error) {
                // API is actively rejecting us (soft block / rate limit / bad
                // auth), not just "no matches". Surface the real message and
                // stop hitting it further this call — retrying variants
                // against an active block just makes it worse.
                console.error(`⚠️ [STICKERLY] "${query}" API error response:`, JSON.stringify(data.error));
                const blockedErr = new Error('STICKERLY_BLOCKED');
                blockedErr.stickerlyBlocked = true;
                blockedErr.raw = data.error;
                throw blockedErr;
            } else {
                console.error(`⚠️ [STICKERLY] "${query}" got 0 packs — top-level response keys: ${Object.keys(data || {}).join(',')}`);
            }
        } catch (err) {
            if (err.stickerlyBlocked) throw err;
            console.error(`⚠️ [STICKERLY] "${query}" via ${url.split('?')[0]} failed:`, err.response?.status || err.code || err.message);
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
// bread4life" match this), then widens to more search-friendly phrasing
// for generic single-word queries (e.g. "goku" -> "goku stickers") since
// Sticker.ly/Stickify's search is picky about exact title-ish phrasing.
async function fetchStickerPack(query) {
    const variants = [...new Set([
        query,
        `${query} stickers`,
        `${query} sticker pack`
    ].map(v => v.trim()))];

    for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        // Growing delay between widened variants (0ms, ~900ms, ~1.8s) so a
        // multi-variant search doesn't look like a burst to sticker.ly.
        if (i > 0) await delay(800 + Math.floor(Math.random() * 400));

        try {
            const pack = await searchStickerly(variant);
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
        }

        const pack2 = await searchStickify(variant);
        if (pack2 && pack2.urls.length) return pack2;
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

        await sendStickerPackNative(sock, jid, {
            name: pack.name,
            publisher: pack.publisher,
            stickers: pack.urls.map(u => ({ url: u })),
            cover: { url: pack.urls[0] }
        }, msg);

        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}

    } catch (err) {
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
                    const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                    const stickers = packMsg.stickers || [];
                    const buffers = [];

                    for (const stickerObj of stickers) {
                        try {
                            const buffer = await downloadPackSticker(stickerObj, downloadContentFromMessage);
                            if (buffer && buffer.length > 0) buffers.push(buffer);
                        } catch (e) {
                            console.error('⚠️ [PACKNAME] Sticker fetch failed:', e.message);
                        }
                    }

                    if (!buffers.length) {
                        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}
                        return await sock.sendMessage(jid, { text: "❌ Couldn't read any stickers from that pack card." }, { quoted: msg });
                    }

                    await sendStickerPackNative(sock, jid, {
                        name: newPack,
                        publisher: newAuthor,
                        stickers: buffers
                    }, msg);

                    try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}
                    return await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
                } catch (e) {
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

    // 6. FIXPACK (Actually repairs blank tiles & EXIF rejection by
    // re-downloading every sticker, re-encoding it cleanly, and
    // resending the whole pack fresh via the native stickers API —
    // this re-uploads and re-encrypts each tile, unlike the old
    // no-op version which relayed the exact same broken pack.)
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
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

                const fixedBuffers = [];
                for (const stickerObj of packMsg.stickers) {
                    try {
                        const buffer = await downloadPackSticker(stickerObj, downloadContentFromMessage);
                        if (buffer && buffer.length > 0) {
                            // Standardize via Sharp: fixes size mismatches, missing
                            // alpha channel, and malformed webp headers that cause
                            // blank tiles / EXIF rejection on WhatsApp's client.
                            const cleanWebp = await sharp(buffer)
                                .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                                .webp({ quality: 70 })
                                .toBuffer();
                            fixedBuffers.push(cleanWebp);
                        }
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
                    stickers: fixedBuffers
                }, msg);

                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch {}

                if (fixedBuffers.length < packMsg.stickers.length) {
                    await sock.sendMessage(jid, {
                        text: `⚠️ Repaired ${fixedBuffers.length}/${packMsg.stickers.length} stickers — the rest failed to download and were dropped.`
                    }, { quoted: msg });
                }

            } catch (err) {
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

    // 9. UNPACK (Bulletproof 1-by-1 Extractor)
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

            const stickers = packMsg.stickers;
            const total = stickers.length;

            await sock.sendMessage(jid, {
                text: `📦 *Unpacking: "${packMsg.name || 'Pack'}"*\n• *Total Stickers:* \`${total}\`\n• *Delivery Interval:* \`1 every 2s\`\n\nStarting delivery...`
            }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

                let delivered = 0;
                for (const stickerObj of stickers) {
                    try {
                        const buffer = await downloadPackSticker(stickerObj, downloadContentFromMessage);
                        if (buffer && buffer.length > 0) {
                            await sock.sendMessage(jid, { sticker: buffer });
                            delivered++;
                        }
                    } catch (err) {
                        console.error(`⚠️ [UNPACK] Sticker ${delivered + 1} failed:`, err.message);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                }

                await sock.sendMessage(jid, {
                    text: `✅ *Unpacking Complete!* Delivered \`${delivered}/${total}\` stickers from *"${packMsg.name || 'Pack'}"*.`
                }, { quoted: msg });

            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Unpacking failed: ${err.message}` }, { quoted: msg });
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
