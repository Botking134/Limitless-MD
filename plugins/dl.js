// plugins/dl.js
const config = require('../config');
const { normalizeToJid, saveState } = require('../stateManager');
const axios = require('axios');

// ─── SESSION STORE ──────────────────────────────────────────────
global.songSessions = global.songSessions || {};

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

// ─── EXTRACT DOWNLOAD URL (handles multiple response structures) ──
function extractDownloadUrl(data) {
    if (!data) return null;
    // Common paths
    const paths = [
        'data.download',
        'data.url',
        'data.hdplay',
        'data.wmplay',
        'data.play',
        'download',
        'url',
        'hdplay',
        'wmplay',
        'play',
        'data.data.download',
        'data.data.url'
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
    return data?.title || data?.data?.title || data?.data?.author?.nickname || 'Media';
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // ─── FACEBOOK ────────────────────────────────────────────────
    {
        name: 'fb',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a Facebook video URL." }, { quoted: msg });

            await sock.sendMessage(jid, { text: "⏳ Fetching Facebook video..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.prexzyvilla.site/download/facebook', { url });
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
        name: 'facebook',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'fb');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // ─── TIKTOK ──────────────────────────────────────────────────
    {
        name: 'tt',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a TikTok video URL." }, { quoted: msg });

            await sock.sendMessage(jid, { text: "⏳ Fetching TikTok video (no watermark)..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.prexzyvilla.site/download/tiktok', { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const caption = extractTitle(data);
                await sock.sendMessage(jid, { video: buffer, caption });
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

    // ─── YOUTUBE ──────────────────────────────────────────────────
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
                if (last === 'mp3' || last === 'audio') {
                    type = 'audio';
                    url = parts.slice(0, -1).join(' ');
                } else if (last === 'mp4' || last === 'video') {
                    type = 'video';
                    url = parts.slice(0, -1).join(' ');
                }
            }

            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a YouTube URL.\nExample: `.yt https://youtu.be/xxx mp3`" }, { quoted: msg });

            const endpoint = type === 'audio' 
                ? 'https://apis.prexzyvilla.site/download/youtube-audio'
                : 'https://apis.prexzyvilla.site/download/youtube-video';

            await sock.sendMessage(jid, { text: `⏳ Downloading YouTube ${type.toUpperCase()}...` }, { quoted: msg });
            try {
                const data = await downloadMedia(endpoint, { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const caption = extractTitle(data) || 'YouTube ' + type;

                if (type === 'audio') {
                    await sock.sendMessage(jid, {
                        audio: buffer,
                        mimetype: 'audio/mpeg',
                        ptt: false,
                        caption
                    });
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

    // ─── INSTAGRAM ──────────────────────────────────────────────
    {
        name: 'ig',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide an Instagram post/reel URL." }, { quoted: msg });

            await sock.sendMessage(jid, { text: "⏳ Fetching Instagram media..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.prexzyvilla.site/download/ig2', { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const isVideo = downloadUrl.match(/\.(mp4|mov|avi)/i);
                if (isVideo) {
                    await sock.sendMessage(jid, { video: buffer, caption: extractTitle(data) });
                } else {
                    await sock.sendMessage(jid, { image: buffer, caption: extractTitle(data) });
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

    // ─── TWITTER/X ──────────────────────────────────────────────
    {
        name: 'x',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a Twitter/X post URL." }, { quoted: msg });

            await sock.sendMessage(jid, { text: "⏳ Fetching Twitter/X media..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.prexzyvilla.site/download/twitter', { url });
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
        name: 'xdl',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'x');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // ─── SPOTIFY ──────────────────────────────────────────────────
    {
        name: 'spotify',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a Spotify track URL." }, { quoted: msg });

            await sock.sendMessage(jid, { text: "⏳ Fetching Spotify track..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.prexzyvilla.site/download/spotify', { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                await sock.sendMessage(jid, {
                    audio: buffer,
                    mimetype: 'audio/mpeg',
                    ptt: false,
                    caption: extractTitle(data)
                });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // ─── PINTEREST ────────────────────────────────────────────────
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

    // ─── MEDIAFIRE ────────────────────────────────────────────────
    {
        name: 'mediafire',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: "❌ Please provide a MediaFire link." }, { quoted: msg });

            await sock.sendMessage(jid, { text: "⏳ Fetching MediaFire file..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.prexzyvilla.site/download/mediafire', { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                // Attempt to guess file type from URL extension
                const ext = downloadUrl.split('.').pop().split('?')[0] || 'bin';
                const mime = {
                    mp4: 'video/mp4',
                    mp3: 'audio/mpeg',
                    jpg: 'image/jpeg',
                    jpeg: 'image/jpeg',
                    png: 'image/png',
                    pdf: 'application/pdf',
                    zip: 'application/zip'
                }[ext] || 'application/octet-stream';
                await sock.sendMessage(jid, {
                    document: buffer,
                    fileName: `mediafire.${ext}`,
                    mimetype: mime,
                    caption: extractTitle(data)
                });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // ─── OBFUSCATE ───────────────────────────────────────────────
    {
        name: 'obf',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            let code = args?.trim();
            if (!code) {
                const rawMsg = getRawMessage(msg.message);
                const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
                if (contextInfo && contextInfo.quotedMessage) {
                    const quoted = contextInfo.quotedMessage;
                    const rawContent = getRawMessage(quoted);
                    code = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
                }
            }
            if (!code) return await sock.sendMessage(jid, { text: "❌ Please provide JavaScript code to obfuscate, or reply to a message with code." }, { quoted: msg });

            await sock.sendMessage(jid, { text: "⏳ Obfuscating code..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/obfuscate', { code }, 'POST');
                // Expect response like { obfuscated: "..." } or { data: { obfuscated: "..." } }
                let obfuscated = data?.obfuscated || data?.data?.obfuscated || data?.result;
                if (!obfuscated) throw new Error('No obfuscated code returned');
                const buffer = Buffer.from(obfuscated, 'utf-8');
                await sock.sendMessage(jid, {
                    document: buffer,
                    fileName: 'obfuscated.js',
                    mimetype: 'text/javascript',
                    caption: '✅ Obfuscated code'
                });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // ─── SONG (Interactive) ──────────────────────────────────────
    {
        name: 'song',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args?.trim();
            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a song name to search." }, { quoted: msg });

            await sock.sendMessage(jid, { text: "🔍 Searching for songs..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/play', { q: query, limit: 5 }, 'GET');
                if (!data || !data.results || data.results.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No songs found. Please try a different search term." }, { quoted: msg });
                }

                let list = '🎵 *Song Search Results:*\n\n';
                data.results.forEach((song, i) => {
                    list += `${i + 1}. *${song.title}* - ${song.artist || 'Unknown artist'}\n`;
                    if (song.duration) list += `   ⏱️ ${song.duration}\n`;
                });
                list += `\n📌 Reply to this message with the number (1-${data.results.length}) to download.`;

                const prompt = await sock.sendMessage(jid, { text: list }, { quoted: msg });
                global.songSessions[prompt.key.id] = {
                    results: data.results,
                    timestamp: Date.now(),
                    handle: handleSongReply
                };
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Search failed: ${err.message}` });
            }
        }
    },

    // ─── PLAY (Direct download) ──────────────────────────────────
    {
        name: 'play',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args?.trim();
            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a song name to play directly." }, { quoted: msg });

            await sock.sendMessage(jid, { text: "⏳ Fetching first result..." }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/play', { q: query, limit: 1 }, 'GET');
                if (!data || !data.results || data.results.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No song found." }, { quoted: msg });
                }
                const song = data.results[0];
                if (!song.download) throw new Error('No download link found');

                const audioBuffer = await fetchBuffer(song.download);
                let thumbnailBuffer = null;
                if (song.thumbnail) {
                    try {
                        thumbnailBuffer = await fetchBuffer(song.thumbnail);
                    } catch (e) { /* ignore */ }
                }

                const caption = `🎵 *${song.title}*\n` +
                              (song.artist ? `👤 ${song.artist}\n` : '') +
                              (song.duration ? `⏱️ ${song.duration}` : '');

                if (thumbnailBuffer) {
                    await sock.sendMessage(jid, {
                        image: thumbnailBuffer,
                        caption: caption,
                        contextInfo: {
                            externalAdReply: {
                                title: song.title,
                                body: song.artist || 'Song',
                                thumbnail: thumbnailBuffer,
                                mediaType: 1
                            }
                        }
                    });
                    await sock.sendMessage(jid, {
                        audio: audioBuffer,
                        mimetype: 'audio/mpeg',
                        ptt: false,
                        caption: caption
                    });
                } else {
                    await sock.sendMessage(jid, {
                        audio: audioBuffer,
                        mimetype: 'audio/mpeg',
                        ptt: false,
                        caption: caption
                    });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    }
];

// ─── INTERACTIVE SESSION HANDLER ────────────────────────────────
async function handleSongReply(sock, msg, session, userReply) {
    const jid = msg.key.remoteJid;
    const num = parseInt(userReply);
    if (isNaN(num) || num < 1 || num > session.results.length) {
        return await sock.sendMessage(jid, { text: `❌ Invalid selection. Please choose a number between 1 and ${session.results.length}.` });
    }

    const song = session.results[num - 1];
    if (!song.download) {
        return await sock.sendMessage(jid, { text: "❌ This song has no download link." });
    }

    try {
        const audioBuffer = await fetchBuffer(song.download);
        let thumbnailBuffer = null;
        if (song.thumbnail) {
            try {
                thumbnailBuffer = await fetchBuffer(song.thumbnail);
            } catch (e) { /* ignore */ }
        }

        const caption = `🎵 *${song.title}*\n` +
                      (song.artist ? `👤 ${song.artist}\n` : '') +
                      (song.duration ? `⏱️ ${song.duration}` : '');

        if (thumbnailBuffer) {
            await sock.sendMessage(jid, {
                image: thumbnailBuffer,
                caption: caption,
                contextInfo: {
                    externalAdReply: {
                        title: song.title,
                        body: song.artist || 'Song',
                        thumbnail: thumbnailBuffer,
                        mediaType: 1
                    }
                }
            });
            await sock.sendMessage(jid, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                ptt: false,
                caption: caption
            });
        } else {
            await sock.sendMessage(jid, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                ptt: false,
                caption: caption
            });
        }
    } catch (err) {
        await sock.sendMessage(jid, { text: `❌ Download failed: ${err.message}` });
    }
}

// ─── REGISTER SESSION HANDLER ───────────────────────────────────
module.exports.handleSongReply = handleSongReply;

// ─── HELPER ──────────────────────────────────────────────────────
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}