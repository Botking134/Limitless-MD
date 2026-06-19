// plugins/dl.js
const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const FormData = require('form-data');
const { fileTypeFromBuffer } = require('file-type');

// ─── GLOBAL SESSIONS ──────────────────────────────────────────────
global.downloaderSessions = global.downloaderSessions || {};

// ─── HELPERS ──────────────────────────────────────────────────────

// Helper: download buffer from URL
async function downloadBuffer(url) {
    const res = await axios({ url, method: 'GET', responseType: 'arraybuffer' });
    return Buffer.from(res.data);
}

// Helper: send media (image/video/audio) to chat
async function sendMedia(sock, jid, buffer, options = {}) {
    const type = await fileTypeFromBuffer(buffer);
    const mime = type?.mime || 'application/octet-stream';
    if (mime.startsWith('image/')) {
        return sock.sendMessage(jid, { image: buffer, caption: options.caption || '' });
    } else if (mime.startsWith('video/')) {
        return sock.sendMessage(jid, { video: buffer, caption: options.caption || '' });
    } else if (mime.startsWith('audio/')) {
        return sock.sendMessage(jid, { audio: buffer, mimetype: mime, ptt: false });
    } else {
        return sock.sendMessage(jid, { document: buffer, mimetype: mime, fileName: options.fileName || 'file' });
    }
}

// Helper: send list of suggestions and store pending state
function sendSuggestions(sock, jid, userId, type, results) {
    const lines = results.map((item, i) => `${i + 1}. ${item.title || item.name}`).join('\n');
    sock.sendMessage(jid, { text: `*Select a number (1-${results.length}):*\n${lines}` });
    // Clear any existing session for this user
    if (global.downloaderSessions[userId]) {
        clearTimeout(global.downloaderSessions[userId].timeout);
        delete global.downloaderSessions[userId];
    }
    // Set timeout to auto-clear after 60s
    const timeout = setTimeout(() => {
        delete global.downloaderSessions[userId];
    }, 60000);
    global.downloaderSessions[userId] = { type, results, timeout };
}

// ─── COMMAND DEFINITIONS ─────────────────────────────────────────

module.exports = [
    {
        name: 'ig',
        isPrefixless: false,
        execute: async (sock, msg, args, { senderNumber }) => {
            const jid = msg.key.remoteJid;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide an Instagram URL.' });
            try {
                const { data } = await axios.get(`https://apis.prexzyvilla.site/download/instagram?url=${encodeURIComponent(url)}`);
                if (data && data.media) {
                    for (const m of data.media) {
                        const buffer = await downloadBuffer(m.url);
                        await sendMedia(sock, jid, buffer, { caption: 'Downloaded from Instagram' });
                    }
                } else {
                    await sock.sendMessage(jid, { text: 'Failed to fetch media.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'tgs',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a Telegram sticker URL.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/telegram-sticker?url=${encodeURIComponent(url)}`);
                if (data && data.url) {
                    const buffer = await downloadBuffer(data.url);
                    await sock.sendMessage(jid, { sticker: buffer });
                } else {
                    await sock.sendMessage(jid, { text: 'Failed to convert sticker.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'x',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a Twitter URL.' });
            try {
                const { data } = await axios.get(`https://apis.prexzyvilla.site/download/twitter?url=${encodeURIComponent(url)}`);
                if (data && data.media) {
                    for (const m of data.media) {
                        const buffer = await downloadBuffer(m.url);
                        await sendMedia(sock, jid, buffer);
                    }
                } else {
                    await sock.sendMessage(jid, { text: 'No media found.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'ytmp3',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a YouTube URL.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/download/ytmp3?url=${encodeURIComponent(url)}`);
                if (data && data.download) {
                    const buffer = await downloadBuffer(data.download);
                    await sock.sendMessage(jid, {
                        audio: buffer,
                        mimetype: 'audio/mp4',
                        ptt: false,
                        caption: data.title || 'YouTube audio'
                    });
                } else {
                    await sock.sendMessage(jid, { text: 'Failed to download audio.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'ytmp4',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a YouTube URL.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/download/ytmp4?url=${encodeURIComponent(url)}`);
                if (data && data.download) {
                    const buffer = await downloadBuffer(data.download);
                    await sock.sendMessage(jid, {
                        video: buffer,
                        caption: data.title || 'YouTube video'
                    });
                } else {
                    await sock.sendMessage(jid, { text: 'Failed to download video.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'img',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const query = args.join(' ');
            if (!query) return await sock.sendMessage(jid, { text: 'Please provide a search query.' });
            try {
                const { data } = await axios.get(`https://apis.prexzyvilla.site/search/pinterest?q=${encodeURIComponent(query)}`);
                if (data && data.images && data.images.length) {
                    const randomImg = data.images[Math.floor(Math.random() * data.images.length)];
                    const buffer = await downloadBuffer(randomImg);
                    await sock.sendMessage(jid, { image: buffer, caption: `Result for: ${query}` });
                } else {
                    await sock.sendMessage(jid, { text: 'No images found.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'gitclone',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;
            const repoUrl = args[0];
            if (!repoUrl || !repoUrl.includes('github.com')) return await sock.sendMessage(jid, { text: 'Please provide a valid GitHub repo URL.' });
            try {
                const cleanUrl = repoUrl.replace(/\/$/, '').replace('/tree', '');
                const parts = cleanUrl.split('/');
                const user = parts[parts.length - 2];
                const repo = parts[parts.length - 1].replace('.git', '');
                const zipUrl = `https://github.com/${user}/${repo}/archive/refs/heads/main.zip`;
                const buffer = await downloadBuffer(zipUrl);
                await sock.sendMessage(jid, {
                    document: buffer,
                    fileName: `${repo}-main.zip`,
                    mimetype: 'application/zip'
                });
            } catch (e) {
                try {
                    const cleanUrl = repoUrl.replace(/\/$/, '').replace('/tree', '');
                    const parts = cleanUrl.split('/');
                    const user = parts[parts.length - 2];
                    const repo = parts[parts.length - 1].replace('.git', '');
                    const zipUrl = `https://github.com/${user}/${repo}/archive/refs/heads/master.zip`;
                    const buffer = await downloadBuffer(zipUrl);
                    await sock.sendMessage(jid, {
                        document: buffer,
                        fileName: `${repo}-master.zip`,
                        mimetype: 'application/zip'
                    });
                } catch (e2) {
                    await sock.sendMessage(jid, { text: 'Failed to download repo. Check the URL or branch name.' });
                }
            }
        }
    },
    {
        name: 'lyrics',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const query = args.join(' ');
            if (!query) return await sock.sendMessage(jid, { text: 'Please provide a song title.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/lyrics/search?q=${encodeURIComponent(query)}`);
                if (data && data.lyrics) {
                    const text = `*${data.title}*\n\n${data.lyrics.substring(0, 3000)}`;
                    await sock.sendMessage(jid, { text });
                } else if (data && Array.isArray(data)) {
                    const list = data.map((item, i) => `${i + 1}. ${item.title}`).join('\n');
                    await sock.sendMessage(jid, { text: `*Select a song by replying with its number:*\n${list}` });
                } else {
                    await sock.sendMessage(jid, { text: 'Lyrics not found.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'play',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const query = args.join(' ');
            if (!query) return await sock.sendMessage(jid, { text: 'Please provide a song name.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/play?q=${encodeURIComponent(query)}`);
                if (data && data.download) {
                    const buffer = await downloadBuffer(data.download);
                    const thumb = data.thumbnail ? await downloadBuffer(data.thumbnail) : null;
                    await sock.sendMessage(jid, {
                        audio: buffer,
                        mimetype: 'audio/mp4',
                        ptt: false,
                        ...(thumb ? { thumbnail: thumb } : {}),
                        caption: data.title || 'Song'
                    });
                } else {
                    await sock.sendMessage(jid, { text: 'Song not found.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'song',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const userId = msg.key.participant || msg.key.remoteJid;
            const query = args.join(' ');
            if (!query) return await sock.sendMessage(jid, { text: 'Please provide a song name.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/song?q=${encodeURIComponent(query)}`);
                if (Array.isArray(data) && data.length) {
                    sendSuggestions(sock, jid, userId, 'song', data);
                } else {
                    await sock.sendMessage(jid, { text: 'No results found.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'tt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a TikTok URL.' });
            try {
                const { data } = await axios.get(`https://apis.prexzyvilla.site/download/tiktok?url=${encodeURIComponent(url)}`);
                if (data && data.download) {
                    const buffer = await downloadBuffer(data.download);
                    await sock.sendMessage(jid, { video: buffer, caption: 'TikTok video' });
                } else {
                    await sock.sendMessage(jid, { text: 'Failed to download.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'fb',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a Facebook video URL.' });
            try {
                const { data } = await axios.get(`https://apis.prexzyvilla.site/download/facebook?url=${encodeURIComponent(url)}`);
                if (data && data.download) {
                    const buffer = await downloadBuffer(data.download);
                    await sock.sendMessage(jid, { video: buffer, caption: 'Facebook video' });
                } else {
                    await sock.sendMessage(jid, { text: 'Failed to download.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'shazam',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg || !quotedMsg.audioMessage) {
                return await sock.sendMessage(jid, { text: 'Reply to an audio message with .shazam' });
            }
            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(quotedMsg.audioMessage, 'audio');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                const form = new FormData();
                form.append('audio', buffer, { filename: 'audio.ogg' });
                const { data } = await axios.post('https://apis.davidcyril.name.ng/shazam', form, {
                    headers: form.getHeaders(),
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });
                if (data && data.title) {
                    await sock.sendMessage(jid, {
                        text: `*Title:* ${data.title}\n*Artist:* ${data.artist || 'Unknown'}\n*Album:* ${data.album || 'Unknown'}`
                    });
                } else {
                    await sock.sendMessage(jid, { text: 'Song not identified.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'apk',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const userId = msg.key.participant || msg.key.remoteJid;
            const query = args.join(' ');
            if (!query) return await sock.sendMessage(jid, { text: 'Please provide an app name.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/endpoints/download/apk?q=${encodeURIComponent(query)}`);
                if (Array.isArray(data) && data.length) {
                    sendSuggestions(sock, jid, userId, 'apk', data);
                } else {
                    await sock.sendMessage(jid, { text: 'No APK results found.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'ss',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = args[0];
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a website URL.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/ssweb?url=${encodeURIComponent(url)}`);
                if (data && data.url) {
                    const buffer = await downloadBuffer(data.url);
                    await sock.sendMessage(jid, { image: buffer, caption: `Screenshot of ${url}` });
                } else {
                    await sock.sendMessage(jid, { text: 'Screenshot failed.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'spotify',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a Spotify track URL.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/spotifydl?url=${encodeURIComponent(url)}`);
                if (data && data.download) {
                    const buffer = await downloadBuffer(data.download);
                    await sock.sendMessage(jid, {
                        audio: buffer,
                        mimetype: 'audio/mpeg',
                        ptt: false,
                        caption: data.title || 'Spotify track'
                    });
                } else {
                    await sock.sendMessage(jid, { text: 'Download failed.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'yt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a YouTube URL.' });
            try {
                const { data } = await axios.get(`https://savetube.david-cyril.net.ng/?url=${encodeURIComponent(url)}`);
                if (data && data.download) {
                    const buffer = await downloadBuffer(data.download);
                    await sock.sendMessage(jid, { video: buffer, caption: 'YouTube video' });
                } else {
                    await sock.sendMessage(jid, { text: 'Failed to get download link.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    },
    {
        name: 'mediafire',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = args.join(' ');
            if (!url) return await sock.sendMessage(jid, { text: 'Please provide a Mediafire URL.' });
            try {
                const { data } = await axios.get(`https://apis.davidcyril.name.ng/mediafire?url=${encodeURIComponent(url)}`);
                if (data && data.download) {
                    const buffer = await downloadBuffer(data.download);
                    await sock.sendMessage(jid, {
                        document: buffer,
                        fileName: data.filename || 'mediafire_file',
                        mimetype: 'application/octet-stream'
                    });
                } else {
                    await sock.sendMessage(jid, { text: 'Download failed.' });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: 'Error: ' + e.message });
            }
        }
    }
];

// ─── ADD ALIASES ──────────────────────────────────────────────────
const aliases = [
    { name: 'instagram', target: 'ig' },
    { name: 'tiktok', target: 'tt' },
    { name: 'facebook', target: 'fb' },
    { name: 'xdl', target: 'x' },
    { name: 'youtube', target: 'yt' }
];

const mainCommands = module.exports;
for (const alias of aliases) {
    const targetCmd = mainCommands.find(c => c.name === alias.target);
    if (targetCmd) {
        mainCommands.push({
            name: alias.name,
            isPrefixless: false,
            execute: targetCmd.execute
        });
    }
}