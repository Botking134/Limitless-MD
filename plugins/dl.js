const config = require('../config');
const { normalizeToJid, saveState } = require('../stateManager');
const axios = require('axios');
const FormData = require('form-data');

// ─── GLOBAL SESSIONS ──────────────────────────────────────────────
global.songSessions = global.songSessions || {};
global.tgsSessions = global.tgsSessions || {};
global.lyricsSessions = global.lyricsSessions || {};
global.xvidSessions = global.xvidSessions || {};

// Helper to register sessions with automatic garbage collection
function registerSession(sessionType, promptId, data) {
    const registries = {
        song: global.songSessions,
        tgs: global.tgsSessions,
        lyrics: global.lyricsSessions,
        xvid: global.xvidSessions
    };
    const registry = registries[sessionType];
    if (registry) {
        registry[promptId] = data;
        // Auto-delete session after 5 minutes to prevent RAM memory leaks
        setTimeout(() => {
            if (registry[promptId]) delete registry[promptId];
        }, 5 * 60 * 1000);
    }
}

// ─── HELPERS ──────────────────────────────────────────────────────

// Upgraded fetchBuffer with User-Agent spoofing and direct Content-Type extraction
async function fetchBuffer(url) {
    if (!url) throw new Error('No URL provided');
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.google.com/'
        },
        maxRedirects: 5,
        timeout: 15000
    });
    const buffer = Buffer.from(response.data);
    // Attaching real MIME-Type header directly to the buffer object
    buffer.mimeType = response.headers['content-type'] || 'application/octet-stream';
    return buffer;
}

async function uploadToCloud(buffer, mimeType) {
    let ext = mimeType.split('/')[1] || 'bin';
    ext = ext.split(';')[0].trim();
    const filename = `file_${Date.now()}.${ext}`;

    try {
        const form = new FormData();
        form.append('files[]', buffer, { filename, contentType: mimeType });
        const response = await axios.post('https://qu.ax/upload.php', form, {
            headers: { ...form.getHeaders() }
        });
        if (response.data?.success && response.data.files?.[0]?.url) {
            return response.data.files[0].url.trim();
        }
    } catch (err) { /* ignore */ }

    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', buffer, { filename, contentType: mimeType });
        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: { ...form.getHeaders() }
        });
        if (response.data && typeof response.data === 'string' && response.data.startsWith('http')) {
            return response.data.trim();
        }
    } catch (err) { /* ignore */ }

    throw new Error("Cloud upload gateways failed.");
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

// Deep recursive scanner to catch shifting API response keys automatically
function scanObjectForUrl(obj) {
    if (!obj) return null;
    if (typeof obj === 'string') {
        if (obj.startsWith('http') && (obj.includes('cdn') || obj.includes('download') || /\.(mp4|mp3|jpg|jpeg|png|gif|pdf|zip|apk)/i.test(obj.split('?')[0]))) {
            return obj;
        }
    }
    if (typeof obj === 'object') {
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const result = scanObjectForUrl(obj[key]);
                if (result) return result;
            }
        }
    }
    return null;
}

function extractDownloadUrl(data) {
    if (!data) return null;
    
    // 1. Try common structured paths first
    const paths = [
        'result.download_url', 'result.download', 'result.video', 'result.video_sd', 'result.video_hd',
        'result.mp3', 'downloadUrl', 'DownloadLink', 'download_link', 'download', 'data.download_url',
        'data.download', 'data.hdplay', 'data.wmplay', 'data.play', 'data.data.download', 'url'
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

    // 2. Fallback to recursive scan if structured lookup fails
    return scanObjectForUrl(data);
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
        
        const audioPayload = {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            ptt: false
        };

        if (thumbnailBuffer) {
            audioPayload.contextInfo = {
                externalAdReply: {
                    title: song.title,
                    body: song.artist || 'Limitless Music',
                    thumbnail: thumbnailBuffer,
                    mediaType: 2, // Tells WhatsApp to render as a native music card
                    mediaUrl: downloadUrl,
                    sourceUrl: downloadUrl
                }
            };
        }

        await sock.sendMessage(jid, audioPayload, { quoted: msg });
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

// Fixed to fetch and display the actual lyrics text instead of just a link
async function handleLyricsReply(sock, msg, session, userReply) {
    const jid = msg.key.remoteJid;
    const num = parseInt(userReply);
    if (isNaN(num) || num < 1 || num > session.results.length) {
        return await sock.sendMessage(jid, { text: `❌ Invalid selection. Please choose a number between 1 and ${session.results.length}.` });
    }
    const result = session.results[num - 1];
    
    await sock.sendMessage(jid, { text: `⏳ Fetching full lyrics text for *${result.title}*...` }, { quoted: msg });
    try {
        const lyricsData = await downloadMedia('https://apis.davidcyril.name.ng/lyrics', { text: `${result.title} ${result.artist}` });
        const lyricsText = lyricsData?.lyrics || lyricsData?.result || null;

        if (!lyricsText) {
            return await sock.sendMessage(jid, { text: `📝 *${result.title}* (${result.artist})\n\nLyrics text could not be parsed. Read online here: ${result.url}` });
        }

        const noteCard =
            `📝 *LYRICS: ${result.title.toUpperCase()}* 📝\n` +
            `👤 *Artist:* ${result.artist}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${lyricsText}`;

        await sock.sendMessage(jid, { text: noteCard });
    } catch (err) {
        await sock.sendMessage(jid, { text: `❌ Failed to fetch lyrics: ${err.message}` });
    }
}

async function handleXvidReply(sock, msg, session, userReply) {
    const jid = msg.key.remoteJid;
    const num = parseInt(userReply);
    if (isNaN(num) || num < 1 || num > session.results.length) {
        return await sock.sendMessage(jid, { text: `❌ Invalid selection. Please choose a number between 1 and ${session.results.length}.` });
    }
    const video = session.results[num - 1];
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

    // 3. YouTube
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

    // 4. Instagram (Fixed audio misidentification checks)
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
                
                const isVideo = downloadUrl.includes('video') || downloadUrl.includes('mp4') || !downloadUrl.includes('mp3');
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

    // 7. Pinterest
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

    // 8. MediaFire (Fixed to map exact Content-Type headers)
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
                const mime = buffer.mimeType || 'application/octet-stream';
                const ext = downloadUrl.split('.').pop().split('?')[0] || 'bin';

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

    // 9. Google Drive (Fixed to map exact Content-Type headers)
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
                const mime = buffer.mimeType || 'application/octet-stream';
                const ext = downloadUrl.split('.').pop().split('?')[0] || 'bin';

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


// 11. Song (interactive search with split image + audio delivery)
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
                
                // Registered via safe session helper, pointing to the handleSongReply function above
                registerSession('song', prompt.key.id, { results: [song], handle: handleSongReply });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Search failed: ${err.message}` });
            }
        }
    },

    // 12. Play (direct song fetch with safe split delivery)
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
                if (song.thumbnail) {
                    try { 
                        thumbBuffer = await fetchBuffer(song.thumbnail); 
                    } catch (e) {
                        console.log("[Play Command] Failed to download thumbnail fallback.");
                    }
                }

                // 1. Send high-quality image with song details in caption (keeps layout compatible)
                if (thumbBuffer) {
                    const caption = `🎵 *${song.title}*\n👤 *Artist:* ${song.artist || 'Limitless Music'}\n⏱️ *Duration:* ${song.duration || 'N/A'}`;
                    await sock.sendMessage(jid, { image: thumbBuffer, caption: caption }, { quoted: msg });
                }

                // 2. Send clean audio bubble immediately after
                await sock.sendMessage(jid, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg });

            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 13. Telegram Stickers (using Telegram Bot API)
    {
        name: 'tgs',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Provide Telegram sticker pack URL.\nExample: `.tgs https://t.me/addstickers/doakesreactions`" }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "⏳ Fetching sticker pack via Telegram API..." }, { quoted: msg });

            const token = config.telegramBotToken;
            if (!token) {
                return await sock.sendMessage(jid, {
                    text: "❌ Telegram Bot Token not configured. Please add TELEGRAM_BOT_TOKEN to your config file",
                    edit: statusMsg.key
                });
            }

            const packMatch = url.match(/addstickers\/([a-zA-Z0-9_]+)/i);
            if (!packMatch) {
                return await sock.sendMessage(jid, {
                    text: "❌ Invalid sticker pack URL. Must be like: https://t.me/addstickers/PackName",
                    edit: statusMsg.key
                });
            }
            const packName = packMatch[1];

            try {
                const apiUrl = `https://api.telegram.org/bot${token}/getStickerSet?name=${packName}`;
                const response = await axios.get(apiUrl);
                const data = response.data;

                if (!data.ok) {
                    throw new Error(data.description || 'Telegram API error');
                }

                const stickers = data.result.stickers || [];
                if (stickers.length === 0) {
                    await sock.sendMessage(jid, { text: "❌ No stickers found in this pack.", edit: statusMsg.key });
                    return;
                }

                const maxShow = Math.min(stickers.length, 20);
                let list = `📦 *${data.result.title || 'Stickers'}*\n\n`;
                for (let i = 0; i < maxShow; i++) {
                    const s = stickers[i];
                    list += `${i+1}. ${s.emoji || '📌'} ${s.is_animated ? '🔄 (Animated)' : ''}\n`;
                }
                if (stickers.length > 20) {
                    list += `\n*Showing first 20 of ${stickers.length}*`;
                }
                list += `\n\n📌 Reply with number to download.`;

                const prompt = await sock.sendMessage(jid, { text: list, edit: statusMsg.key });
                
                // Registered via safe session helper, pointing to the handleTgsReply function above
                registerSession('tgs', prompt.key.id, {
                    stickers: stickers,
                    token: token,
                    handle: handleTgsReply,
                    timestamp: Date.now()
                });
            } catch (err) {
                console.error('[TGS] Error:', err.message);
                await sock.sendMessage(jid, {
                    text: `❌ Failed to fetch sticker pack: ${err.message}`,
                    edit: statusMsg.key
                });
            }
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

    // 15. Web
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

    // 16. Lyrics
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
                
                // Registered via safe session helper
                registerSession('lyrics', prompt.key.id, { results, handle: handleLyricsReply });
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

    // 18. XVID
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
                
                // Registered via safe session helper
                registerSession('xvid', prompt.key.id, { results, handle: handleXvidReply });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 19. Shazam
    {
        name: 'shazam',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            let audioUrl = args?.trim() || '';

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