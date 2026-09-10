// plugins/adapt.js

const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const sharp = require('sharp');
const { downloadContentFromMessage } = require('@itsliaaa/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

/* 
======================================================================
🔐 API KEY RECONSTRUCTION
======================================================================
*/
const OBFUSCATED_KEY_CHUNKS = [
    "sk-proj-",
    "W-LjDtcjGcYSrI", 
    "tO5cfDMGa0qRxaf6ynPOpx",
    "6tvcJIHCXLnNK3UcKPRxUi", 
    "-aDsT0m8HXLDo1DmT3BlbkF",
    "JXxl7dmMKOATFWQDyOq7Sum", 
    "9s17rupcS8Z7hsa81iKcuE8",
    "SSC8tUNYomep0rgeMjeQzX", 
    "BxWbokA"
];

function getOpenAIKey() {
    return OBFUSCATED_KEY_CHUNKS.join('');
}

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

    const stream = await downloadContentFromMessage(raw[type], type.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return { buffer, type: type === 'videoMessage' ? 'video' : 'image' };
}

// Pure-code image upscale/downscale — no ffmpeg binary needed for the image
// case, just the `sharp` library (already a project dependency). This is
// what adapt/adapt-low/adapt-mid/adapt-high actually run for images now;
// ffmpeg is only still used below for video, since there's no equivalent
// pure-JS video transcoder.
async function processImage(inputBuffer, mode) {
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

// FFmpeg wrapper — video only now (see processImage above for the image path).
function processVideo(inputBuffer, mode) {
    return new Promise((resolve, reject) => {
        const tempIn = path.join(__dirname, `../temp_in_${crypto.randomBytes(4).toString('hex')}.mp4`);
        const tempOut = path.join(__dirname, `../temp_out_${crypto.randomBytes(4).toString('hex')}.mp4`);

        fs.writeFileSync(tempIn, inputBuffer);

        let vf = "";
        let extra = "";

        if (mode === 'low') {
            vf = "scale=iw/2:-2";
            extra = "-b:v 200k -r 15";
        } else if (mode === 'mid') {
            vf = "scale=iw*1.5:-2:flags=lanczos,unsharp=5:5:1.0:5:5:0.0";
            extra = "-b:v 2M";
        } else if (mode === 'high') {
            vf = "scale=iw*2:-2:flags=lanczos,unsharp=7:7:1.8:7:7:0.0,eq=contrast=1.05:saturation=1.1";
            extra = "-b:v 6M -c:a copy";
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
    return type === 'video' ? processVideo(inputBuffer, mode) : processImage(inputBuffer, mode);
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

// Image synthesis for `warp`, via Gemini's image-output models (same
// "3.7 → 3.6 → 3.5" tiering as the vision step above). Returns a raw image
// Buffer. This is what actually needed to change — the vision step alone
// being on Gemini didn't matter to you since the OpenAI call was still the
// one producing the image you actually see.
const GEMINI_IMAGE_MODELS = ['gemini-3.7-flash-image', 'gemini-3.6-flash-image', 'gemini-3.5-flash-image'];

async function generateImageWithGemini(prompt) {
    if (!config.geminiApiKey) throw new Error('Gemini API key is missing in config.');
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

    let lastErr;
    for (const model of GEMINI_IMAGE_MODELS) {
        try {
            const response = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: prompt }] }]
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
            const apiKey = getOpenAIKey();
            if (!apiKey) return sock.sendMessage(jid, { text: "❌ Missing or invalid API Key." }, { quoted: msg });

            const media = await downloadMedia(msg);
            if (!media || media.type !== 'image') return sock.sendMessage(jid, { text: "Reply to an **image** to warp reality." }, { quoted: msg });

            const userPrompt = args ? args.trim() : null;

            // Send loading sticker first
            await sendLoadingSticker(sock, jid, VORTEX, 'Warping Reality');

            try {
                const base64Img = media.buffer.toString('base64');
                const visionSystemPrompt = userPrompt 
                    ? `Describe this image in detail. Then, alter the description to fulfill this request: "${userPrompt}". Output ONLY the final detailed prompt for image generation.`
                    : `Describe this image in detail. Then, mutate the description into a surreal, highly corrupted, reality-warping visual. Output ONLY the final detailed prompt for image generation.`;

                // STEP 1: Vision / Analysis — Gemini (3.7 → 3.6 → 3.5 fallback).
                const generatedPrompt = await describeImageWithGemini(base64Img, 'image/jpeg', visionSystemPrompt);

                // STEP 2: Image Synthesis — Gemini (3.7 → 3.6 → 3.5 fallback).
                // Falls back to the old OpenAI-format endpoint only if every
                // Gemini image model genuinely fails — "only where necessary"
                // now actually applies to the step that produces what you see.
                let warpedImageBuffer;
                try {
                    warpedImageBuffer = await generateImageWithGemini(generatedPrompt);
                } catch (geminiErr) {
                    console.error("[Warp] Gemini image generation unavailable, falling back to OpenAI:", geminiErr.message);
                    const generationRes = await axios.post('https://api.openai.com/v1/images/generations', {
                        model: "openai/gpt-5.6-luna",
                        prompt: generatedPrompt,
                        n: 1,
                        size: "1024x1024"
                    }, {
                        headers: { "Authorization": `Bearer ${apiKey}` },
                        timeout: 120000
                    });
                    const warpedImageUrl = generationRes.data.data[0].url;
                    warpedImageBuffer = (await axios.get(warpedImageUrl, { responseType: 'arraybuffer' })).data;
                }

                // Send the generated result
                await sock.sendMessage(jid, { 
                    image: warpedImageBuffer, 
                    caption: `🌌 *Reality Warped*\n\n_Prompt:_ ${userPrompt || "Surreal Mutation"}` 
                }, { quoted: msg });

            } catch (e) {
                console.error("[Warp Error]:", e?.response?.data || e.message);
                const errMsg = e?.response?.data?.error?.message || e.message;
                sock.sendMessage(jid, { text: `⚠️ The warp matrix collapsed: ${errMsg}` }, { quoted: msg });
            }
        }
    }
];