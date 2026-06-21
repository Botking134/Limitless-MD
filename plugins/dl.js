// plugins/dl.js
const config = require('../config');
const { normalizeToJid, saveState } = require('../stateManager');
const axios = require('axios');

// ─── GLOBAL SESSIONS ──────────────────────────────────────────────
global.songSessions = global.songSessions || {};
global.tgsSessions = global.tgsSessions || {};
global.lyricsSessions = global.lyricsSessions || {};
global.xvidSessions = global.xvidSessions || {};

// ─── HELPERS ──────────────────────────────────────────────────────

async function fetchBuffer(url) {
    if (!url) throw new Error('No URL provided');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function downloadMedia(apiUrl, params = {}, method = 'GET') {
    try {
        const response = await axios({
            method,
            url: apiUrl,
            params: method === 'GET' ? params : undefined,
            data: method === 'POST' ? params : undefined,
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (err) {
        throw new Error(`API error: ${err.response?.status || err.message}`);
    }
}

function extractDownloadUrl(data) {
    if (!data) return null;
    const paths = [
        // Common download fields
        'result.download_url',
        'result.download',
        'result.video',
        'result.video_sd',
        'result.video_hd',
        'result.mp3',
        'downloadUrl',
        'DownloadLink',
        'download_link',
        'download',
        'data.download_url',
        'data.download',
        'data.hdplay',
        'data.wmplay',
        'data.play',
        'data.data.download',
        'url'
    ];
    for (const path of paths) {
        const parts = path.split('.');
        let value = data;
        for (const part of parts) {
            if (value && value[part] !== undefined) value = value[part];
            else { value = undefined; break; }
        }
        if (value && typeof value === 'string') return value;
    }
    return null;
}

function extractTitle(data) {
    if (data?.result?.title) return data.result.title;
    if (data?.title) return data.title;
    if (data?.data?.title) return data.data.title;
    if (data?.data?.author?.nickname) return data.data.author.nickname;
    if (data?.result?.name) return data.result.name;
    return 'Media';
}

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// ─── INTERACTIVE HANDLERS ────────────────────────────────────────

async function handleSongReply(sock, msg, session, userReply) {
    const jid = msg.key.remoteJid;
    const num = parseInt(userReply);
    if (isNaN(num) || num < 1 || num > session.results.length) {
        return await sock.sendMessage(jid, { text: `❌ Invalid selection. Please choose a number between 1 and ${session.results.length}.` });
    }
    const song = session.results[num - 1];
    const downloadUrl = song.download_url || song.download || extractDownloadUrl(song);
    if (!downloadUrl) {
        return await sock.sendMessage(jid, { text: "❌ This song has no download link." });
    }
    try {
        const audioBuffer = await fetchBuffer(downloadUrl);
        let thumbnailBuffer = null;
        if (song.thumbnail) {
            try { thumbnailBuffer = await fetchBuffer(song.thumbnail); } catch (e) {}
        }
        const caption = `🎵 *${song.title}*\n` + (song.artist ? `👤 ${song.artist}\n` : '') + (song.duration ? `⏱️ ${song.duration}` : '');
        if (thumbnailBuffer) {
            await sock.sendMessage(jid, {
                image: thumbnailBuffer,
                caption: caption,
                contextInfo: { externalAdReply: { title: song.title, body: 'Song', thumbnail: thumbnailBuffer, mediaType: 1 } }
            });
            await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false, caption });
        } else {
            await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false, caption });
        }
    } catch (err) {
        await sock.sendMessage(jid, { text: `❌ Download failed: ${err.message}` });
    }
}

async function handleTgsReply(sock, msg, session, userReply) {
    const jid = msg.key.remoteJid;
    const num = parseInt(userReply);
    if (isNaN(num) || num < 1 || num > session.stickers.length) {
        return await sock.sendMessage(jid, { text: `❌ Invalid selection. Please choose a number between 1 and ${session.stickers.length}.` });
    }
    const sticker = session.stickers[num - 1];
    if (!sticker.url) return await sock.sendMessage(jid, { text: "❌ This sticker has no URL." });
    try {
        const buffer = await fetchBuffer(sticker.url);
        await sock.sendMessage(jid, { sticker: buffer });
    } catch (err) {
        await sock.sendMessage(jid, { text: `❌ Download failed: ${err.message}` });
    }
}

async function handleLyricsReply(sock, msg, session, userReply) {
    const jid = msg.key.remoteJid;
    const num = parseInt(userReply);
    if (isNaN(num) || num < 1 || num > session.results.length) {
        return await sock.sendMessage(jid, { text: `❌ Invalid selection. Please choose a number between 1 and ${session.results.length}.` });
    }
    const result = session.results[num - 1];
    const songUrl = result.url;
    try {
        // For now, send the URL – you can implement scraping if needed
        await sock.sendMessage(jid, {
            text: `🎵 *${result.full_title}*\n\n📝 *Lyrics:* Please view at: ${songUrl}`
        });
    } catch (err) {
        await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
    }
}

async function handleXvidReply(sock, msg, session, userReply) {
    const jid = msg.key.remoteJid;
    const num = parseInt(userReply);
    if (isNaN(num) || num < 1 || num > session.results.length) {
        return await sock.sendMessage(jid, { text: `❌ Invalid selection. Please choose a number between 1 and ${session.results.length}.` });
    }
    const video = session.results[num - 1];
    // For now, just send the URL – you can implement actual video download if needed
    await sock.sendMessage(jid, {
        text: `🎥 *${video.title}*\n\n▶️ Watch at: ${video.url}`
    });
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. Facebook
    {
        name: 'fb',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a Facebook video URL." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Fetching Facebook video..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/facebook', { url });
                if (!data || !data.success) throw new Error(data?.message || 'API returned error');
                const downloadUrl = data?.result?.downloads?.hd?.url || data?.result?.downloads?.sd?.url;
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                await sock.sendMessage(jid, { video: buffer, caption: data.result?.title || 'Facebook video' });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },
    {
        name: 'facebook',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'fb');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // 2. TikTok
    {
        name: 'tt',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a TikTok video URL." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Fetching TikTok video..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.prexzyvilla.site/download/tiktok', { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                await sock.sendMessage(jid, { video: buffer, caption: extractTitle(data) });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },
    {
        name: 'tiktok',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'tt');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // 3. YouTube (savetube)
    {
        name: 'yt',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const parts = args?.trim().split(' ') || [];
            let url = parts[0];
            let type = 'video';
            if (parts.length > 1) {
                const last = parts[parts.length - 1].toLowerCase();
                if (last === 'mp3' || last === 'audio') { type = 'audio'; url = parts.slice(0, -1).join(' '); }
                else if (last === 'mp4' || last === 'video') { type = 'video'; url = parts.slice(0, -1).join(' '); }
            }
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a YouTube URL." }, { quoted: msg });
            const endpoint = 'https://apis.davidcyril.name.ng/download/savetube';
            await sock.sendMessage(jid, { text: `⏳ Downloading ${type}...` }, { quoted: msg });
            try {
                const data = await downloadMedia(endpoint, { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const caption = data?.data?.title || 'YouTube';
                if (type === 'audio') {
                    await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: false, caption });
                } else {
                    await sock.sendMessage(jid, { video: buffer, caption });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },
    {
        name: 'youtube',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'yt');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // 4. Instagram
    {
        name: 'ig',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide an Instagram URL." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Fetching Instagram media..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/instagram', { url });
                const downloadUrl = data?.result?.video || data?.result?.mp3 || extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const isVideo = downloadUrl.match(/\.(mp4|mov|avi)/i);
                if (isVideo) {
                    await sock.sendMessage(jid, { video: buffer, caption: extractTitle(data) });
                } else {
                    await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: false, caption: extractTitle(data) });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },
    {
        name: 'instagram',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'ig');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // 5. Twitter/X
    {
        name: 'x',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a Twitter/X URL." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Fetching Twitter/X media..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/twitter', { url });
                const downloadUrl = data?.video_hd || data?.video_sd || extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                await sock.sendMessage(jid, { video: buffer, caption: data.description || 'Twitter video' });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },
    {
        name: 'xdl',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'x');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // 6. Spotify
    {
        name: 'spotify',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a Spotify track URL." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Fetching Spotify track..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/spotifydl', { url });
                const downloadUrl = data?.DownloadLink || extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: false, caption: data.title || 'Spotify' });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 7. Pinterest (download specific pin)
    {
        name: 'pinterest',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a Pinterest pin URL." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Fetching Pinterest media..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.prexzyvilla.site/download/pinterest', { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                await sock.sendMessage(jid, { image: buffer, caption: extractTitle(data) });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 8. MediaFire
    {
        name: 'mediafire',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a MediaFire link." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Fetching MediaFire file..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/mediafire', { url });
                const downloadUrl = data?.downloadLink || extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const ext = downloadUrl.split('.').pop().split('?')[0] || 'bin';
                const mime = { mp4: 'video/mp4', mp3: 'audio/mpeg', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', zip: 'application/zip' }[ext] || 'application/octet-stream';
                await sock.sendMessage(jid, {
                    document: buffer,
                    fileName: data.fileName || `mediafire.${ext}`,
                    mimetype: mime,
                    caption: data.fileName || 'MediaFire file'
                });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 9. Google Drive
    {
        name: 'gdrive',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a Google Drive link." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Fetching Google Drive file..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/gdrive', { url });
                const downloadUrl = data?.download_link || extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const ext = downloadUrl.split('.').pop().split('?')[0] || 'bin';
                const mime = { mp4: 'video/mp4', mp3: 'audio/mpeg', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', zip: 'application/zip' }[ext] || 'application/octet-stream';
                await sock.sendMessage(jid, {
                    document: buffer,
                    fileName: data.name || `gdrive.${ext}`,
                    mimetype: mime,
                    caption: data.name || 'Google Drive file'
                });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 10. Obfuscate
    {
        name: 'obf',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            let code = args?.trim() || '';
            let level = 'medium';
            const firstWord = code.split(' ')[0]?.toLowerCase();
            if (['low', 'medium', 'high'].includes(firstWord)) {
                level = firstWord;
                code = code.slice(firstWord.length).trim();
            }
            if (!code) {
                const rawMsg = getRawMessage(msg.message);
                const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
                if (contextInfo && contextInfo.quotedMessage) {
                    const quoted = contextInfo.quotedMessage;
                    const rawContent = getRawMessage(quoted);
                    code = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
                }
            }
            if (!code) return await sock.sendMessage(jid, { text: "❌ Please provide JavaScript code to obfuscate." }, { quoted: msg });
            await sock.sendMessage(jid, { text: `⏳ Obfuscating with ${level} level...` }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/obfuscate', { code, level }, 'POST');
                if (!data || !data.success) throw new Error(data?.message || 'API error');
                const obfuscated = data?.result?.obfuscated_code?.code;
                if (!obfuscated) throw new Error('No obfuscated code returned');
                const buffer = Buffer.from(obfuscated, 'utf-8');
                await sock.sendMessage(jid, {
                    document: buffer,
                    fileName: 'obfuscated.js',
                    mimetype: 'text/javascript',
                    caption: `✅ Obfuscated (${level})`
                });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 11. Song (interactive)
    {
        name: 'song',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args?.trim();
            if (!query) return await sock.sendMessage(jid, { text: "❌ Provide a song name." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "🔍 Searching..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/play', { query, limit: 5 });
                if (!data?.result) return await sock.sendMessage(jid, { text: "❌ No songs found." });
                const song = data.result;
                let list = `🎵 *Song Found:*\n\n1. *${song.title}*\n`;
                if (song.duration) list += `   ⏱️ ${song.duration}\n`;
                list += `\n📌 Reply with **1** to download.`;
                const prompt = await sock.sendMessage(jid, { text: list }, { quoted: msg });
                global.songSessions[prompt.key.id] = { results: [song], handle: handleSongReply };
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Search failed: ${err.message}` });
            }
        }
    },

    // 12. Play (direct)
    {
        name: 'play',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args?.trim();
            if (!query) return await sock.sendMessage(jid, { text: "❌ Provide a song name." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Fetching song..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/play', { query, limit: 1 });
                if (!data?.result) return await sock.sendMessage(jid, { text: "❌ No song found." });
                const song = data.result;
                const downloadUrl = song.download_url || song.download || extractDownloadUrl(song);
                if (!downloadUrl) throw new Error('No download link');
                const audioBuffer = await fetchBuffer(downloadUrl);
                let thumbBuffer = null;
                if (song.thumbnail) try { thumbBuffer = await fetchBuffer(song.thumbnail); } catch (e) {}
                const caption = `🎵 *${song.title}*\n` + (song.duration ? `⏱️ ${song.duration}` : '');
                if (thumbBuffer) {
                    await sock.sendMessage(jid, { image: thumbBuffer, caption, contextInfo: { externalAdReply: { title: song.title, body: 'Song', thumbnail: thumbBuffer, mediaType: 1 } } });
                }
                await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false, caption });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    
// 13. Telegram Stickers (interactive) - FIXED (no token needed)
{
    name: 'tgs',
    isPrefixless: false,
    execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
        const jid = msg.key.remoteJid;
        const url = args?.trim();
        if (!url) return await sock.sendMessage(jid, { text: "❌ Provide Telegram sticker pack URL.\nExample: `.tgs https://t.me/addstickers/doakesreactions`" }, { quoted: msg });

        const statusMsg = await sock.sendMessage(jid, { text: "⏳ Fetching sticker pack..." }, { quoted: msg });

        // ─── TRY BOTH POSSIBLE ENDPOINTS ──────────────────────
        const endpoints = [
            'https://apis.davidcyril.name.ng/tools/telegram-sticker',
            'https://apis.davidcyril.name.ng/endpoints/tools/telegram-sticker'
        ];

        let data = null;
        let usedEndpoint = null;

        for (const endpoint of endpoints) {
            try {
                console.log(`[TGS] Trying: ${endpoint}`);
                const result = await downloadMedia(endpoint, { url }, 'GET');
                if (result && result.status === true) {
                    data = result;
                    usedEndpoint = endpoint;
                    console.log(`[TGS] Success with: ${endpoint}`);
                    break;
                }
            } catch (e) {
                console.log(`[TGS] Failed: ${endpoint} - ${e.message}`);
            }
        }

        if (!data || !data.status) {
            await sock.sendMessage(jid, { 
                text: `❌ Failed to fetch sticker pack.\n\n` +
                      `Make sure the URL is a valid Telegram sticker pack link.\n` +
                      `Example: https://t.me/addstickers/doakesreactions\n\n` +
                      `If the issue persists, the API might be temporarily down.`,
                edit: statusMsg.key 
            });
            return;
        }

        const stickers = data?.result?.sticker || [];
        if (stickers.length === 0) {
            await sock.sendMessage(jid, { text: "❌ No stickers found in this pack.", edit: statusMsg.key });
            return;
        }

        if (stickers.length === 1) {
            try {
                const buffer = await fetchBuffer(stickers[0].url);
                await sock.sendMessage(jid, { sticker: buffer });
                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to download sticker: ${err.message}`, edit: statusMsg.key });
            }
            return;
        }

        // Build selection list (max 20)
        const maxShow = Math.min(stickers.length, 20);
        let list = `📦 *${data.result.title || 'Stickers'}*\n\n`;
        for (let i = 0; i < maxShow; i++) {
            const sticker = stickers[i];
            list += `${i+1}. ${sticker.emoji || '📌'} ${sticker.is_animated ? '🔄' : ''}\n`;
        }
        if (stickers.length > 20) {
            list += `\n*Showing first 20 of ${stickers.length}*`;
        }
        list += `\n\n📌 Reply with number to download.`;

        const prompt = await sock.sendMessage(jid, { text: list, edit: statusMsg.key });
        global.tgsSessions[prompt.key.id] = {
            stickers,
            handle: handleTgsReply,
            timestamp: Date.now()
        };
    }
}, 


    // 14. APK
    {
        name: 'apk',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args?.trim();
            if (!query) return await sock.sendMessage(jid, { text: "❌ Provide an app name (e.g., whatsapp)." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Searching APK..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/download/apk', { text: query });
                if (!data?.status) throw new Error(data?.message || 'API error');
                const apk = data.apk;
                const downloadUrl = apk.downloadLink;
                if (!downloadUrl) throw new Error('No download link');
                const buffer = await fetchBuffer(downloadUrl);
                await sock.sendMessage(jid, {
                    document: buffer,
                    fileName: `${apk.name}.apk`,
                    mimetype: 'application/vnd.android.package-archive',
                    caption: `📱 *${apk.name}*\nVersion: ${apk.lastUpdated || 'latest'}`
                });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 15. Web (download website as zip)
    {
        name: 'web',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Provide a website URL." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "⏳ Downloading website..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/tools/downloadweb', { url });
                if (!data?.success) throw new Error(data?.message || 'API error');
                const downloadUrl = data?.response?.downloadUrl;
                if (!downloadUrl) throw new Error('No download link');
                const buffer = await fetchBuffer(downloadUrl);
                await sock.sendMessage(jid, {
                    document: buffer,
                    fileName: 'website.zip',
                    mimetype: 'application/zip',
                    caption: `📦 Website downloaded from ${url}`
                });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 16. Lyrics (interactive)
    {
        name: 'lyrics',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args?.trim();
            if (!query) return await sock.sendMessage(jid, { text: "❌ Provide song name/artist." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "🔍 Searching lyrics..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/lyrics/genius', { q: query });
                if (!data?.success || !data.results || data.results.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No lyrics found." });
                }
                const results = data.results.slice(0, 5);
                let list = `🎵 *Lyrics Search Results:*\n\n`;
                results.forEach((r, i) => {
                    list += `${i+1}. *${r.title}* - ${r.artist}\n`;
                });
                list += `\n📌 Reply with number to view lyrics.`;
                const prompt = await sock.sendMessage(jid, { text: list }, { quoted: msg });
                global.lyricsSessions[prompt.key.id] = { results, handle: handleLyricsReply };
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 17. Image Search (Pinterest)
    {
        name: 'img',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const parts = args?.trim().split(' ') || [];
            let count = 1;
            let query = parts.join(' ');
            const first = parts[0];
            if (first && !isNaN(first) && parseInt(first) > 0) {
                count = Math.min(parseInt(first), 10);
                query = parts.slice(1).join(' ');
            }
            if (!query) return await sock.sendMessage(jid, { text: "❌ Provide a search query." }, { quoted: msg });
            await sock.sendMessage(jid, { text: `🔍 Searching for images...` }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/search/pinterest', { text: query });
                if (!data?.success || !data.result || data.result.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No images found." });
                }
                const images = data.result.slice(0, count);
                for (const img of images) {
                    const buffer = await fetchBuffer(img.image);
                    await sock.sendMessage(jid, { image: buffer, caption: img.caption || img.fullName || 'Pinterest' });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 18. XVID (interactive)
    {
        name: 'xvid',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args?.trim();
            if (!query) return await sock.sendMessage(jid, { text: "❌ Provide a search term." }, { quoted: msg });
            await sock.sendMessage(jid, { text: "🔍 Searching XVID..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/search/xvideo', { text: query });
                if (!data?.success || !data.result || data.result.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No videos found." });
                }
                const results = data.result.slice(0, 10);
                let list = `🎥 *XVID Results:*\n\n`;
                results.forEach((r, i) => {
                    list += `${i+1}. *${r.title}* (${r.duration})\n`;
                });
                list += `\n📌 Reply with number to get video link.`;
                const prompt = await sock.sendMessage(jid, { text: list }, { quoted: msg });
                global.xvidSessions[prompt.key.id] = { results, handle: handleXvidReply };
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 19. Shazam (supports URL + audio messages)
    {
        name: 'shazam',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            let audioUrl = args?.trim() || '';

            // Helper to upload buffer
            async function uploadToCloud(buffer, mimeType) {
                let ext = mimeType.split('/')[1] || 'bin';
                ext = ext.split(';')[0].trim();
                const filename = `file_${Date.now()}.${ext}`;

                try {
                    const FormData = require('form-data');
                    const axios = require('axios');
                    const form = new FormData();
                    form.append('files[]', buffer, { filename, contentType: mimeType });
                    const response = await axios.post('https://qu.ax/upload.php', form, {
                        headers: { ...form.getHeaders() }
                    });
                    if (response.data?.success && response.data.files?.[0]?.url) {
                        return response.data.files[0].url.trim();
                    }
                } catch (err) {
                    console.error("❌ [UPLOAD] qu.ax failed:", err.message);
                }

                try {
                    const FormData = require('form-data');
                    const axios = require('axios');
                    const form = new FormData();
                    form.append('reqtype', 'fileupload');
                    form.append('fileToUpload', buffer, { filename, contentType: mimeType });
                    const response = await axios.post('https://catbox.moe/user/api.php', form, {
                        headers: { ...form.getHeaders() }
                    });
                    if (response.data && typeof response.data === 'string' && response.data.startsWith('http')) {
                        return response.data.trim();
                    }
                } catch (err) {
                    console.error("❌ [UPLOAD] catbox failed:", err.message);
                }

                throw new Error("Catbox and qu.ax upload hosts failed.");
            }

            // ─── 1. If no URL provided, check if replying to an audio message ───
            if (!audioUrl) {
                const rawMsg = getRawMessage(msg.message);
                const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
                const quoted = contextInfo?.quotedMessage;
                let audioBuffer = null;
                let mimeType = null;

                if (quoted) {
                    const rawContent = getRawMessage(quoted);
                    const audioMsg = rawContent?.audioMessage || (rawContent?.documentMessage?.mimetype?.startsWith('audio/') ? rawContent.documentMessage : null);
                    if (audioMsg) {
                        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                        const stream = await downloadContentFromMessage(audioMsg, 'audio');
                        const chunks = [];
                        for await (const chunk of stream) chunks.push(chunk);
                        audioBuffer = Buffer.concat(chunks);
                        mimeType = audioMsg.mimetype || 'audio/mpeg';
                    }
                }

                if (audioBuffer) {
                    try {
                        await sock.sendMessage(jid, { text: "⏳ Uploading audio for Shazam..." }, { quoted: msg });
                        audioUrl = await uploadToCloud(audioBuffer, mimeType);
                    } catch (uploadErr) {
                        return await sock.sendMessage(jid, { text: `❌ Failed to upload audio: ${uploadErr.message}` }, { quoted: msg });
                    }
                } else {
                    if (quoted) {
                        const rawContent = getRawMessage(quoted);
                        const text = rawContent?.conversation || rawContent?.extendedTextMessage?.text || rawContent?.imageMessage?.caption || rawContent?.videoMessage?.caption || '';
                        const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
                        if (urlMatch) audioUrl = urlMatch[1];
                    }
                }
            }

            if (!audioUrl) {
                return await sock.sendMessage(jid, {
                    text: "❌ Please provide an audio URL, reply to an audio message, or reply to a message containing a URL.\nExample: `.shazam https://example.com/song.mp3`"
                }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: "🔍 Shazaming... 🎶" }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/shazam', { url: audioUrl });
                if (!data || !data.success) {
                    throw new Error(data?.message || 'Shazam failed');
                }
                const result = data.result || data;
                let responseText = `🎵 *Shazam Result*\n\n`;
                responseText += `*Title:* ${result.title || 'Unknown'}\n`;
                responseText += `*Artist:* ${result.artist || 'Unknown'}\n`;
                if (result.album) responseText += `*Album:* ${result.album}\n`;
                if (result.release_date) responseText += `*Released:* ${result.release_date}\n`;
                if (result.genre) responseText += `*Genre:* ${result.genre}\n`;
                if (result.cover) {
                    try {
                        const thumbBuffer = await fetchBuffer(result.cover);
                        await sock.sendMessage(jid, { image: thumbBuffer, caption: responseText });
                    } catch (e) {
                        await sock.sendMessage(jid, { text: responseText });
                    }
                } else {
                    await sock.sendMessage(jid, { text: responseText });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    }
];

// ─── EXPORT HANDLERS ─────────────────────────────────────────────
module.exports.handleSongReply = handleSongReply;
module.exports.handleTgsReply = handleTgsReply;
module.exports.handleLyricsReply = handleLyricsReply;
module.exports.handleXvidReply = handleXvidReply;