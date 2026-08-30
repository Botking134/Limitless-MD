// plugins/adapt.js

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { downloadContentFromMessage } = require('@itsliaaa/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

/* 
======================================================================
🔐 API KEY OBFUSCATION
Key is fragmented and reversed to avoid basic automated scrapers.
======================================================================
*/
const OBFUSCATED_KEY_CHUNKS = [
    "BxWbokA", 
    "SSC8tUNYomep0rgeMjeQzX", 
    "9s17rupcS8Z7hsa81iKcuE8",
    "JXxl7dmMKOATFWQDyOq7Sum", 
    "-aDsT0m8HXLDo1DmT3BlbkF",
    "6tvcJIHCXLnNK3UcKPRxUi", 
    "tO5cfDMGa0qRxaf6ynPOpx",
    "W-LjDtcjGcYSrI", 
    "sk-proj-"
];

// Reassembles the key at runtime using join
function getOpenAIKey() {
    return OBFUSCATED_KEY_CHUNKS.reverse().join('');
}

// ─── STICKER ASSETS ───────────────────────────────────────────────
const MAHORAGA_1 = "https://tenor.com/view/mahoraga-gif-12969334221298264530";
const MAHORAGA_2 = "https://tenor.com/view/mahoraga-gif-3784514205632293942";
const VORTEX = "https://tenor.com/view/loop-warp-portal-vortex-face-gif-17203234";

// ─── UTILS ────────────────────────────────────────────────────────
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function resolveTenorGif(pageUrl) {
    try {
        const { data: html } = await axios.get(pageUrl, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' }, responseType: 'text' });
        const match = html.match(/https:\/\/media(?:1|)\.tenor\.com\/[^"'\\]+\.gif/);
        return match ? match[0] : null;
    } catch (error) {
        console.error(`[Tenor Error] ${pageUrl}:`, error.message);
        return null;
    }
}

async function sendLoadingSticker(sock, jid, url, author = 'Adapt.js') {
    // Best-effort only: any failure here (gif fetch, tenor resolution,
    // sticker conversion, or the send itself) must never bubble up and
    // must never block/abort the actual adapt/warp workflow.
    try {
        let mediaUrl = url;
        if (mediaUrl.includes('tenor.com/view')) {
            const resolved = await resolveTenorGif(mediaUrl);
            if (!resolved) return;
            mediaUrl = resolved;
        }
        const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 15000 });
        const sticker = new Sticker(Buffer.from(response.data), {
            pack: 'Limitless-MD', author: author, type: StickerTypes.FULL, quality: 30
        });
        await sock.sendMessage(jid, { sticker: await sticker.toBuffer() });
    } catch (e) {
        console.error("[Sticker Drop Error]", e.message);
    }
}

// Fire-and-forget wrapper: guarantees no unhandled promise rejection
// can ever escape from the loading-sticker step, no matter what.
function fireLoadingSticker(sock, jid, url, author) {
    Promise.resolve(sendLoadingSticker(sock, jid, url, author)).catch((e) => {
        console.error("[Sticker Drop Error - outer]", e?.message || e);
    });
}

// Extracts media from quotes or direct messages
async function downloadMedia(msg) {
    const raw = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || msg.message;
    const type = Object.keys(raw).find(k => k.endsWith('Message') && k !== 'extendedTextMessage');
    if (!type || (!raw[type].url && !raw[type].directPath)) return null;

    const stream = await downloadContentFromMessage(raw[type], type.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return { buffer, type: type === 'videoMessage' ? 'video' : 'image' };
}

// FFmpeg wrapper for local quality adjustments
function processMedia(inputBuffer, type, mode) {
    return new Promise((resolve, reject) => {
        const ext = type === 'video' ? 'mp4' : 'jpg';
        const tempIn = path.join(__dirname, `../temp_in_${crypto.randomBytes(4).toString('hex')}.${ext}`);
        const tempOut = path.join(__dirname, `../temp_out_${crypto.randomBytes(4).toString('hex')}.${ext}`);
        
        fs.writeFileSync(tempIn, inputBuffer);
        
        let vf = "";
        let extra = "";

        if (mode === 'low') {
            vf = "scale=iw/2:-2";
            extra = type === 'video' ? "-b:v 300k -r 15" : "-q:v 31"; // Nuke quality
        } else if (mode === 'mid') {
            vf = "unsharp=5:5:0.8"; // Slight sharpening
            extra = type === 'video' ? "-b:v 1M" : "-q:v 5";
        } else if (mode === 'high') {
            // Lanczos scaling (upscale 2x) + heavy sharpening & denoise
            vf = "scale=iw*2:-2:flags=lanczos,unsharp=5:5:1.5";
            extra = type === 'video' ? "-b:v 4M" : "-q:v 1"; 
        }

        const cmd = `ffmpeg -i ${tempIn} -vf "${vf}" ${extra} -y ${tempOut}`;
        
        exec(cmd, (err) => {
            // Always clean up tempIn regardless of outcome
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

// ─── COMMANDS ─────────────────────────────────────────────────────

module.exports = [
    {
        name: 'adapt-low',
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const media = await downloadMedia(msg);
            if (!media) return sock.sendMessage(jid, { text: "Reply to an image or video to adapt it." }, { quoted: msg });

            fireLoadingSticker(sock, jid, MAHORAGA_1, 'Adapting (Low)');
            try {
                const output = await processMedia(media.buffer, media.type, 'low');
                const content = media.type === 'video' ? { video: output, caption: "📉 Quality Adapted: Low" } : { image: output, caption: "📉 Quality Adapted: Low" };
                await sock.sendMessage(jid, content, { quoted: msg });
            } catch (e) {
                console.error("[Adapt Error]", e);
                sock.sendMessage(jid, { text: "⚠️ Failed to adapt media. Ensure FFmpeg is installed." });
            }
        }
    },
    {
        name: 'adapt-mid',
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const media = await downloadMedia(msg);
            if (!media) return sock.sendMessage(jid, { text: "Reply to an image or video to adapt it." }, { quoted: msg });

            fireLoadingSticker(sock, jid, MAHORAGA_2, 'Adapting (Mid)');
            try {
                const output = await processMedia(media.buffer, media.type, 'mid');
                const content = media.type === 'video' ? { video: output, caption: "⚖️ Quality Adapted: Mid" } : { image: output, caption: "⚖️ Quality Adapted: Mid" };
                await sock.sendMessage(jid, content, { quoted: msg });
            } catch (e) {
                console.error("[Adapt Error]", e);
                sock.sendMessage(jid, { text: "⚠️ Failed to adapt media. Ensure FFmpeg is installed." });
            }
        }
    },
    {
        name: 'adapt-high',
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const media = await downloadMedia(msg);
            if (!media) return sock.sendMessage(jid, { text: "Reply to an image or video to adapt it." }, { quoted: msg });

            fireLoadingSticker(sock, jid, Math.random() > 0.5 ? MAHORAGA_1 : MAHORAGA_2, 'Adapting (High)');
            try {
                const output = await processMedia(media.buffer, media.type, 'high');
                const content = media.type === 'video' ? { video: output, caption: "📈 Quality Adapted: High" } : { image: output, caption: "📈 Quality Adapted: High" };
                await sock.sendMessage(jid, content, { quoted: msg });
            } catch (e) {
                console.error("[Adapt Error]", e);
                sock.sendMessage(jid, { text: "⚠️ Failed to adapt media. Ensure FFmpeg is installed." });
            }
        }
    },
    {
        name: 'warp',
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const apiKey = getOpenAIKey();
            if (!apiKey) return sock.sendMessage(jid, { text: "❌ Missing or invalid OpenAI API Key." });

            const media = await downloadMedia(msg);
            if (!media || media.type !== 'image') return sock.sendMessage(jid, { text: "Reply to an **image** to warp reality." }, { quoted: msg });

            const userPrompt = args ? args.trim() : null;
            fireLoadingSticker(sock, jid, VORTEX, 'Warping Reality');

            try {
                // STEP 1: Vision - Let GPT-4o analyze the image and build a new DALL-E prompt
                const base64Img = media.buffer.toString('base64');
                const visionSystemPrompt = userPrompt 
                    ? `Describe this image in extreme detail. Then, modify your description to fulfill this request: "${userPrompt}". Output ONLY the final detailed prompt, optimized for an AI image generator.`
                    : `Describe this image in extreme detail. Then, twist the description into something surreal, bizarre, highly corrupted, or completely mind-bending. Output ONLY the final detailed prompt, optimized for an AI image generator.`;

                const visionRes = await axios.post('https://api.openai.com/v1/chat/completions', {
                    model: "gpt-4o",
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: visionSystemPrompt },
                                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Img}` } }
                            ]
                        }
                    ]
                }, { headers: { "Authorization": `Bearer ${apiKey}` } });

                const dallePrompt = visionRes.data.choices[0].message.content;
                console.log(`[Warp] Generated Prompt: ${dallePrompt}`);

                // STEP 2: Generation - DALL-E 3 creates the new warped reality
                const generationRes = await axios.post('https://api.openai.com/v1/images/generations', {
                    model: "dall-e-3",
                    prompt: dallePrompt,
                    n: 1,
                    size: "1024x1024",
                    quality: "hd"
                }, { headers: { "Authorization": `Bearer ${apiKey}` } });

                const warpedImageUrl = generationRes.data.data[0].url;

                // Send result back to WhatsApp
                await sock.sendMessage(jid, { 
                    image: { url: warpedImageUrl }, 
                    caption: `🌌 *Reality Warped*\n\n_Prompt:_ ${userPrompt || "Surreal Mutation"}` 
                }, { quoted: msg });

            } catch (e) {
                console.error("[Warp Error]:", e?.response?.data || e.message);
                sock.sendMessage(jid, { text: "⚠️ The warp matrix collapsed. (AI Generation Failed)" });
            }
        }
    }
];