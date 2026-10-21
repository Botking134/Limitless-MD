// plugins/adapt.js

const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
// sharp failed to load once on a live deployment with an ES-module require
// error and took the entire plugin file down with it — every command here
// (warp, adapt, adapt-low/mid/high) disappeared, not just image resizing.
// Never let a single optional dependency crash the whole plugin again:
// require it defensively, and processImage() below falls back to the old
// ffmpeg path if sharp isn't actually usable on this host.
let sharp = null;
try {
    sharp = require('sharp');
} catch (e) {
    console.error('⚠️ [ADAPT] sharp failed to load — image adapt/warp will fall back to ffmpeg:', e.message);
}

// @itsliaaa/baileys ships as an ES module — require() of it throws
// "not supported" in CommonJS. That throw used to happen at the top of
// this file, which took the whole plugin down (every adapt/warp command
// vanished, not just media downloading). Load it lazily via dynamic
// import() instead, cached so we only pay the import cost once.
let _baileysPromise = null;
function getBaileys() {
    if (!_baileysPromise) _baileysPromise = import('@itsliaaa/baileys');
    return _baileysPromise;
}

const { Sticker, StickerTypes } = require('wa-sticker-formatter');

// ─── STICKER ASSETS ───────────────────────────────────────────────
const MAHORAGA_1 = "https://tenor.com/view/mahoraga-gif-12969334221298264530";
const MAHORAGA_2 = "https://tenor.com/view/mahoraga-gif-3784514205632293942";
const VORTEX = "https://tenor.com/view/loop-warp-portal-vortex-face-gif-17203234";

// ─── UTILS ────────────────────────────────────────────────────────
async function resolveTenorGif(pageUrl) {
    try {
        const { data: html } = await axios.get(pageUrl, { 
            timeout: 10000, 
            headers: { 'User-Agent': 'Mozilla/5.0' }, 
            responseType: 'text' 
        });
        const match = html.match(/https:\/\/media(?:1|)\.tenor\.com\/[^"'\\]+\.gif/);
        return match ? match[0] : null;
    } catch (error) {
        console.error(`[Tenor Error] ${pageUrl}:`, error.message);
        return null;
    }
}

async function sendLoadingSticker(sock, jid, url, author = 'Adapt.js') {
    try {
        let mediaUrl = url;
        if (mediaUrl.includes('tenor.com/view')) {
            const resolved = await resolveTenorGif(mediaUrl);
            if (!resolved) return;
            mediaUrl = resolved;
        }
        const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 15000 });
        const sticker = new Sticker(Buffer.from(response.data), {
            pack: 'Limitless-MD', 
            author: author, 
            type: StickerTypes.FULL, 
            quality: 30
        });
        await sock.sendMessage(jid, { sticker: await sticker.toBuffer() });
    } catch (e) {
        console.error("[Sticker Drop Error]", e.message);
    }
}

// Extracts media from quotes or direct messages
async function downloadMedia(msg) {
    const raw = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || msg.message;
    if (!raw) return null;

    const type = Object.keys(raw).find(k => k.endsWith('Message') && k !== 'extendedTextMessage');
    if (!type || (!raw[type].url && !raw[type].directPath)) return null;

    const { downloadContentFromMessage } = await getBaileys();
    const stream = await downloadContentFromMessage(raw[type], type.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return { buffer, type: type === 'videoMessage' ? 'video' : 'image' };
}

// Pure-code image upscale/downscale via sharp — no ffmpeg binary needed for
// images. Falls back to the ffmpeg path below if sharp isn't usable on this
// host (it failed to load once in production and took the whole plugin
// down — see the require() above — so this fallback is load-bearing, not
// just a nicety).
async function processImageWithSharp(inputBuffer, mode) {
    const img = sharp(inputBuffer, { failOn: 'none' });
    const metadata = await img.metadata();
    const width = metadata.width || 800;

    let targetWidth = width;
    let sharpenSigma = 0;
    let quality = 90;

    if (mode === 'low') {
        targetWidth = Math.max(32, Math.round(width / 2));
        quality = 60;
    } else if (mode === 'mid') {
        targetWidth = Math.round(width * 1.5);
        sharpenSigma = 1.0;
        quality = 92;
    } else if (mode === 'high') {
        targetWidth = Math.round(width * 2);
        sharpenSigma = 1.6;
        quality = 95;
    }

    let pipeline = img.resize({ width: targetWidth, kernel: sharp.kernel.lanczos3 });
    if (sharpenSigma > 0) pipeline = pipeline.sharpen({ sigma: sharpenSigma });
    if (mode === 'high') pipeline = pipeline.modulate({ saturation: 1.1 }).linear(1.05, -8);

    return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
}

async function processImage(inputBuffer, mode) {
    if (sharp) {
        try {
            return await processImageWithSharp(inputBuffer, mode);
        } catch (e) {
            console.error('⚠️ [ADAPT] sharp processing failed, falling back to ffmpeg:', e.message);
        }
    }
    return processWithFfmpeg(inputBuffer, 'image', mode);
}

// FFmpeg wrapper — video always, and the fallback path for images when
// sharp isn't available.
function processWithFfmpeg(inputBuffer, type, mode) {
    return new Promise((resolve, reject) => {
        const ext = type === 'video' ? 'mp4' : 'jpg';
        const tempIn = path.join(__dirname, `../temp_in_${crypto.randomBytes(4).toString('hex')}.${ext}`);
        const tempOut = path.join(__dirname, `../temp_out_${crypto.randomBytes(4).toString('hex')}.${ext}`);

        fs.writeFileSync(tempIn, inputBuffer);

        let vf = "";
        let extra = "";

        if (mode === 'low') {
            vf = "scale=iw/2:-2";
            extra = type === 'video' ? "-b:v 200k -r 15" : "-q:v 31";
        } else if (mode === 'mid') {
            vf = "scale=iw*1.5:-2:flags=lanczos,unsharp=5:5:1.0:5:5:0.0";
            extra = type === 'video' ? "-b:v 2M" : "-q:v 2";
        } else if (mode === 'high') {
            vf = "scale=iw*2:-2:flags=lanczos,unsharp=7:7:1.8:7:7:0.0,eq=contrast=1.05:saturation=1.1";
            extra = type === 'video' ? "-b:v 6M -c:a copy" : "-q:v 1";
        }

        const cmd = `ffmpeg -i "${tempIn}" -vf "${vf}" ${extra} -y "${tempOut}"`;

        exec(cmd, (err) => {
            if (fs.existsSync(tempIn)) {
                try { fs.unlinkSync(tempIn); } catch (_) {}
            }
            if (err) {
                return reject(err);
            }
            try {
                const outBuffer = fs.readFileSync(tempOut);
                if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
                resolve(outBuffer);
            } catch (readErr) {
                reject(readErr);
            }
        });
    });
}

async function processMedia(inputBuffer, type, mode) {
    return type === 'video' ? processWithFfmpeg(inputBuffer, 'video', mode) : processImage(inputBuffer, mode);
}

// ─── COMMANDS ─────────────────────────────────────────────────────

// Vision/description step for `warp`, using the same Gemini SDK + API key
// convention as plugins/converter.js. Tries the newest model first and only
// drops down a tier when that one actually fails — "use Gemini 3.7/3.6/3.5,
// only where necessary" — instead of picking one fixed model up front.
const GEMINI_VISION_MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];

async function describeImageWithGemini(base64Img, mimeType, promptText) {
    if (!config.geminiApiKey) throw new Error('Gemini API key is missing in config.');
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

    let lastErr;
    for (const model of GEMINI_VISION_MODELS) {
        try {
            const response = await ai.models.generateContent({
                model,
                contents: [{
                    role: 'user',
                    parts: [
                        { text: promptText },
                        { inlineData: { mimeType, data: base64Img } }
                    ]
                }]
            });
            const text = response.text || response.output;
            if (text) return text;
            throw new Error('Empty response');
        } catch (e) {
            lastErr = e;
            console.error(`⚠️ [WARP] Gemini vision failed on ${model}, trying next:`, e.message);
        }
    }
    throw lastErr || new Error('All Gemini vision models failed.');
}

// Vision fallback when every Gemini vision model is unavailable (e.g. a
// 503 demand spike). Pollinations exposes a free, no-key, OpenAI-compatible
// chat endpoint that accepts an image_url content block, so this uses the
// same "describe + mutate" prompt as the Gemini path above.
async function describeImageWithPollinations(base64Img, mimeType, promptText) {
    const response = await axios.post('https://gen.pollinations.ai/v1/chat/completions', {
        model: 'openai',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: promptText },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Img}` } }
            ]
        }]
    }, { timeout: 60000 });

    const text = response.data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from Pollinations vision');
    return text;
}

// Image synthesis for `warp`, via Gemini's actual image-output models.
// NOTE: the flash *text* models (3.7/3.6/3.5-flash) don't have "-image"
// variants — that was the bug causing every attempt here to fail and fall
// through to the OpenAI proxy. The real image family is "Nano Banana",
// named separately: gemini-3.1-flash-image (Nano Banana 2, free tier) and
// gemini-3.1-flash-lite-image (Nano Banana 2 Lite, free tier, faster).
// gemini-3-pro-image (Nano Banana Pro) is deliberately left out — no free
// tier, so it'd just burn quota/fail auth for no benefit here.
const GEMINI_IMAGE_MODELS = ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'];

async function generateImageWithGemini(prompt) {
    if (!config.geminiApiKey) throw new Error('Gemini API key is missing in config.');
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

    let lastErr;
    for (const model of GEMINI_IMAGE_MODELS) {
        try {
            const response = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                // This was the actual reason every attempt fell straight through
                // to OpenAI: without explicitly asking for IMAGE output, Gemini's
                // image models can just return text (a description) instead of
                // image bytes, which our "no image data in response" check then
                // correctly (but pointlessly) treated as a failure every time.
                config: { responseModalities: ['TEXT', 'IMAGE'] }
            });
            const parts = response.candidates?.[0]?.content?.parts || [];
            const imagePart = parts.find(p => p.inlineData?.data);
            if (imagePart) return Buffer.from(imagePart.inlineData.data, 'base64');
            throw new Error('No image data in response');
        } catch (e) {
            lastErr = e;
            console.error(`⚠️ [WARP] Gemini image generation failed on ${model}, trying next:`, e.message);
        }
    }
    throw lastErr || new Error('All Gemini image models failed.');
}

// ─── CODED IMAGE WARP (no AI, no API keys) ───────────────────────
// Pure pixel remapping: for every output pixel we work out where it should
// come from in the source image, then sample it with bilinear filtering.
const WARP_EFFECTS = ['swirl', 'bulge', 'pinch', 'wave', 'ripple', 'glitch'];

function warpSample(src, w, h, x, y, out, oi) {
    if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0, fy = y - y0;
    const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
    const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
    for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[oi + c] = top * (1 - fy) + bot * fy;
    }
}

function warpPixels(src, w, h, effect, strength) {
    const out = Buffer.alloc(src.length);
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    const R = Math.min(w, h) / 2;
    const s = strength;

    if (effect === 'glitch') {
        // 1) RGB channel split, 2) horizontal slices shifted sideways
        const split = Math.max(2, Math.round(w * 0.012 * s));
        const tmp = Buffer.from(src);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const xr = Math.max(0, x - split), xb = Math.min(w - 1, x + split);
                tmp[i] = src[(y * w + xr) * 4];
                tmp[i + 2] = src[(y * w + xb) * 4 + 2];
            }
        }
        tmp.copy(out);
        const bands = 14 + Math.round(6 * s);
        for (let b = 0; b < bands; b++) {
            const y0 = Math.floor(Math.random() * h);
            const bh = Math.max(2, Math.floor(Math.random() * h * 0.06));
            const shift = Math.round((Math.random() - 0.5) * w * 0.25 * s);
            for (let y = y0; y < Math.min(h, y0 + bh); y++) {
                for (let x = 0; x < w; x++) {
                    const sx = ((x - shift) % w + w) % w;
                    const di = (y * w + x) * 4, si = (y * w + sx) * 4;
                    out[di] = tmp[si]; out[di + 1] = tmp[si + 1]; out[di + 2] = tmp[si + 2]; out[di + 3] = tmp[si + 3];
                }
            }
        }
        return out;
    }

    const amp = Math.min(w, h) * 0.03 * s;
    const lambda = Math.max(8, Math.min(w, h) / 5);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const oi = (y * w + x) * 4;
            const dx = x - cx, dy = y - cy;
            const r = Math.sqrt(dx * dx + dy * dy);
            let sx = x, sy = y;

            if (effect === 'swirl') {
                if (r < R) {
                    const t = 1 - r / R;
                    const ang = 3.2 * s * t * t;
                    const cos = Math.cos(ang), sin = Math.sin(ang);
                    sx = cx + dx * cos - dy * sin;
                    sy = cy + dx * sin + dy * cos;
                }
            } else if (effect === 'bulge') {
                if (r < R && r > 0) {
                    const sr = R * Math.pow(r / R, 1 + 0.6 * s);
                    sx = cx + dx * (sr / r);
                    sy = cy + dy * (sr / r);
                }
            } else if (effect === 'pinch') {
                if (r < R && r > 0) {
                    const sr = R * Math.pow(r / R, 1 / (1 + 0.6 * s));
                    sx = cx + dx * (sr / r);
                    sy = cy + dy * (sr / r);
                }
            } else if (effect === 'wave') {
                sx = x + amp * Math.sin((2 * Math.PI * y) / lambda);
                sy = y + amp * Math.sin((2 * Math.PI * x) / lambda);
            } else if (effect === 'ripple') {
                if (r > 0) {
                    const sr = r + amp * Math.sin(r / (lambda / 6));
                    sx = cx + dx * (sr / r);
                    sy = cy + dy * (sr / r);
                }
            }
            warpSample(src, w, h, sx, sy, out, oi);
        }
    }
    return out;
}

async function warpImage(inputBuffer, effect, strength) {
    if (!sharp) throw new Error('Image library (sharp) is not available on this host.');
    const { data, info } = await sharp(inputBuffer, { failOn: 'none' })
        .rotate()
        .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const warped = warpPixels(data, info.width, info.height, effect, strength);
    return await sharp(warped, { raw: { width: info.width, height: info.height, channels: 4 } })
        .jpeg({ quality: 90 })
        .toBuffer();
}

module.exports = [
    {
        name: 'adapt',
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const media = await downloadMedia(msg);
            if (!media) return sock.sendMessage(jid, { text: "Reply to an image or video to adapt it." }, { quoted: msg });

            await sendLoadingSticker(sock, jid, MAHORAGA_1, 'Adapting (High)');

            try {
                const output = await processMedia(media.buffer, media.type, 'high');
                const content = media.type === 'video' 
                    ? { video: output, caption: "⚡ Quality Adapted: High" } 
                    : { image: output, caption: "⚡ Quality Adapted: High" };
                await sock.sendMessage(jid, content, { quoted: msg });
            } catch (e) {
                console.error("[Adapt Error]", e);
                sock.sendMessage(jid, { text: "⚠️ Failed to adapt media." }, { quoted: msg });
            }
        }
    },
    {
        name: 'adapt-low',
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const media = await downloadMedia(msg);
            if (!media) return sock.sendMessage(jid, { text: "Reply to an image or video to adapt it." }, { quoted: msg });

            await sendLoadingSticker(sock, jid, MAHORAGA_1, 'Adapting (Low)');
            try {
                const output = await processMedia(media.buffer, media.type, 'low');
                const content = media.type === 'video' ? { video: output, caption: "📉 Quality Adapted: Low" } : { image: output, caption: "📉 Quality Adapted: Low" };
                await sock.sendMessage(jid, content, { quoted: msg });
            } catch (e) {
                console.error("[Adapt Error]", e);
                sock.sendMessage(jid, { text: "⚠️ Failed to adapt media." }, { quoted: msg });
            }
        }
    },
    {
        name: 'adapt-mid',
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const media = await downloadMedia(msg);
            if (!media) return sock.sendMessage(jid, { text: "Reply to an image or video to adapt it." }, { quoted: msg });

            await sendLoadingSticker(sock, jid, MAHORAGA_2, 'Adapting (Mid)');
            try {
                const output = await processMedia(media.buffer, media.type, 'mid');
                const content = media.type === 'video' ? { video: output, caption: "⚖️ Quality Adapted: Mid" } : { image: output, caption: "⚖️ Quality Adapted: Mid" };
                await sock.sendMessage(jid, content, { quoted: msg });
            } catch (e) {
                console.error("[Adapt Error]", e);
                sock.sendMessage(jid, { text: "⚠️ Failed to adapt media." }, { quoted: msg });
            }
        }
    },
    {
        name: 'adapt-high',
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const media = await downloadMedia(msg);
            if (!media) return sock.sendMessage(jid, { text: "Reply to an image or video to adapt it." }, { quoted: msg });

            await sendLoadingSticker(sock, jid, MAHORAGA_1, 'Adapting (High)');
            try {
                const output = await processMedia(media.buffer, media.type, 'high');
                const content = media.type === 'video' ? { video: output, caption: "📈 Quality Adapted: High" } : { image: output, caption: "📈 Quality Adapted: High" };
                await sock.sendMessage(jid, content, { quoted: msg });
            } catch (e) {
                console.error("[Adapt Error]", e);
                sock.sendMessage(jid, { text: "⚠️ Failed to adapt media." }, { quoted: msg });
            }
        }
    },
    {
        name: 'warp',
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const media = await downloadMedia(msg);
            if (!media || media.type !== 'image') {
                return sock.sendMessage(jid, {
                    text: "Reply to an *image* to warp it.\n\nEffects: " + WARP_EFFECTS.join(' | ') + " | random\nExample: `.warp swirl 2` (the number is the strength, 0.5 to 3)"
                }, { quoted: msg });
            }

            const parts = (args ? args.trim().toLowerCase() : '').split(/\s+/).filter(Boolean);
            let effect = parts.find(p => WARP_EFFECTS.includes(p) || p === 'random');
            let strength = parseFloat(parts.find(p => !isNaN(parseFloat(p))));
            if (isNaN(strength)) strength = 1;
            strength = Math.min(3, Math.max(0.5, strength));
            if (!effect || effect === 'random') effect = WARP_EFFECTS[Math.floor(Math.random() * WARP_EFFECTS.length)];

            await sendLoadingSticker(sock, jid, VORTEX, 'Warping Reality');

            try {
                const output = await warpImage(media.buffer, effect, strength);
                await sock.sendMessage(jid, {
                    image: output,
                    caption: `🌌 *Reality Warped*\n\n_Effect:_ ${effect} (x${strength})`
                }, { quoted: msg });
            } catch (e) {
                console.error("[Warp Error]:", e.message);
                sock.sendMessage(jid, { text: `⚠️ The warp matrix collapsed: ${e.message}` }, { quoted: msg });
            }
        }
    }
];
