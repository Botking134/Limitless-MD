// plugins/dl.js

const config = require('../config');
const { normalizeToJid, saveState } = require('../stateManager');
const axios = require('axios');
const FormData = require('form-data');
const UI = require('../helpers/DownloaderUI');

// ─── KEYS ─────────────────────────────────────────────────────────
// AudD is the song-recognition service behind .shazam and .find.
const AUDD_TOKEN = 'afc72ab7d043dc4de76dd5a7ccb0a0c1';

// Only needed if apis.davidcyril.name.ng starts requiring a key (sent as X-API-Key).
const DAVID_API_KEY = '';

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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Some download tokens (e.g. the savenow.to links /play's upstream hands back)
// are short-lived or single-use and can go stale by the time we fetch them.
// A dead link doesn't throw — it comes back as a 403/404 page that's only a
// few dozen bytes, which fetchBuffer happily returns as a "valid" buffer.
// Without this check that tiny error page gets shipped to WhatsApp as if it
// were the actual song (the "1.0 kB audio" bug).
function isLikelyAudio(buffer) {
    if (!buffer || buffer.length < 20000) return false; // real songs are reliably >20KB
    const mime = (buffer.mimeType || '').toLowerCase();
    if (mime && !mime.startsWith('audio') && mime !== 'application/octet-stream') return false;
    return true;
}

// Upgraded fetchBuffer with User-Agent spoofing and direct Content-Type extraction
async function fetchBuffer(url, timeout = 15000) {
    if (!url) throw new Error('No URL provided');
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.google.com/'
        },
        maxRedirects: 5,
        timeout
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

async function downloadMedia(apiUrl, params = {}, method = 'GET', opts = {}) {
    try {
        const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        if (DAVID_API_KEY && /davidcyril/i.test(apiUrl)) headers['X-API-Key'] = DAVID_API_KEY;
        const response = await axios({
            method,
            url: apiUrl,
            params: method === 'GET' ? params : undefined,
            data: method === 'POST' ? params : undefined,
            headers,
            // Was unset, so a hung upstream (e.g. /play going unresponsive)
            // left every command that calls this — song, play, tiktok, ig, fb,
            // spotify, pinterest, mediafire, gdrive, lyrics, img, xvid, apk,
            // web, shazam, obf — stuck on "⏳ ..." forever with no error ever
            // shown to the user. Now it fails fast with a clear message instead.
            timeout: opts.timeout || 20000
        });
        return response.data;
    } catch (err) {
        const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message);
        const status = err.response?.status;
        const reason = isTimeout
            ? 'the API took too long to respond (it may be down or overloaded)'
            : (status ? `HTTP ${status}` : err.message);
        const wrapped = new Error(`API error: ${reason}`);
        // Flagged so callers can retry a flaky upstream (5xx / timeout) instead
        // of surfacing a one-off blip straight to the user — a 4xx (bad input,
        // not found) is a real answer and retrying it would just waste time.
        wrapped.isTransient = isTimeout || (status >= 500);
        throw wrapped;
    }
}

// Retries apiFn only on a transient (5xx/timeout) failure, per downloadMedia's
// isTransient flag. Several of these community API endpoints (TikTok's
// secondary endpoint in particular) intermittently 500 on an otherwise-valid
// request, so one retry turns an occasional blip into a working result
// instead of an error straight to the user.
async function withRetry(apiFn, retries = 2, delayMs = 1000) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await apiFn();
        } catch (err) {
            lastErr = err;
            if (!err.isTransient || attempt === retries) throw err;
            await delay(delayMs);
        }
    }
    throw lastErr;
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
    let song = session.results[num - 1];
    let downloadUrl = song.download_url || song.download || extractDownloadUrl(song);
    if (!downloadUrl) {
        return await sock.sendMessage(jid, { text: "❌ This song has no download link." });
    }
    try {
        // The link was fetched whenever the user originally ran .song — by the
        // time they reply with their pick, it can easily have gone stale. Same
        // validate-and-retry-with-a-fresh-search as .play, using the saved query.
        let audioBuffer;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const buf = await fetchBuffer(downloadUrl);
                if (isLikelyAudio(buf)) { audioBuffer = buf; break; }
            } catch (e) { /* fall through to retry */ }

            if (attempt < 3 && session.query) {
                await delay(1200);
                const data = await downloadMedia('https://apis.davidcyril.name.ng/play', { query: session.query, limit: 1 });
                if (data?.result) {
                    song = data.result;
                    downloadUrl = song.download_url || song.download || extractDownloadUrl(song);
                }
            } else if (attempt < 3) {
                await delay(1200);
            }
        }
        if (!audioBuffer) {
            return await sock.sendMessage(jid, { text: "❌ The song link kept coming back invalid or expired after 3 tries. Try `.song` again." });
        }

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
        await sock.sendMessage(jid, { text: UI.errorText(err.message) });
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
        await sock.sendMessage(jid, { text: UI.errorText(err.message) });
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

    const ui = await UI.begin(sock, msg, 'lyrics', { steps: ['Fetching lyrics', 'Preparing'] });
    try {
        const lyricsData = await downloadMedia('https://apis.davidcyril.name.ng/lyrics', { text: `${result.title} ${result.artist}` });
        const lyricsText = lyricsData?.lyrics || lyricsData?.result || null;

        if (!lyricsText) {
            await sock.sendMessage(jid, {
                text: UI.card({ icon: '📝', title: result.title, fields: [['Artist', result.artist]], note: `The lyrics text could not be read. Read them online: ${result.url}` })
            });
            return await ui.done();
        }

        const header = UI.card({ icon: '📝', title: result.title, fields: [['Artist', result.artist]] });
        await sock.sendMessage(jid, { text: `${header}\n\n${lyricsText}` });
        await ui.done();
    } catch (err) {
        await ui.fail(`Failed to fetch lyrics: ${err.message}`);
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
        text: UI.card({ icon: '🎥', title: video.title, sections: [{ rows: ['▶️ Watch', video.url] }], footer: true })
    });
}

// ─── UNIVERSAL LINK EXTRACTOR HELPER ──────────────────────────────
    function extractUrlFromMsg(msg, args) {
        let text = args ? args.trim() : '';

        if (!text) {
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            if (quoted) {
                const rawContent = getRawMessage(quoted);
                text = rawContent?.conversation || 
                       rawContent?.extendedTextMessage?.text || 
                       rawContent?.imageMessage?.caption || 
                       rawContent?.videoMessage?.caption || 
                       '';
            }
        }

        if (!text) return null;

        const match = text.match(/(https?:\/\/[^\s]+)/i);
        return match ? match[1].trim() : text.trim();
    }

    // ─── CATBOX DOWNLOADER (single file + album support) ───────────
    async function sendCatboxMedia(sock, jid, msg, url) {
        const buffer = await fetchBuffer(url);
        const mime = (buffer.mimeType || '').toLowerCase();
        const ext = url.split('.').pop().toLowerCase();

        const isVideo = mime.startsWith('video') || ['mp4', 'mov', 'webm', 'mkv'].includes(ext);
        const isAudio = mime.startsWith('audio') || ['mp3', 'ogg', 'wav', 'm4a'].includes(ext);
        const isImage = mime.startsWith('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);

        if (isImage) {
            await sock.sendMessage(jid, { image: buffer }, { quoted: msg });
        } else if (isVideo) {
            await sock.sendMessage(jid, { video: buffer, mimetype: mime || 'video/mp4' }, { quoted: msg });
        } else if (isAudio) {
            await sock.sendMessage(jid, { audio: buffer, mimetype: mime || 'audio/mpeg', ptt: false }, { quoted: msg });
        } else {
            await sock.sendMessage(jid, { document: buffer, mimetype: mime || 'application/octet-stream', fileName: url.split('/').pop() }, { quoted: msg });
        }
    }

    async function getCatboxAlbumFileUrls(albumUrl) {
        const res = await axios.get(albumUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            timeout: 15000
        });
        const html = res.data.toString();
        const matches = html.match(/https?:\/\/files\.catbox\.moe\/[A-Za-z0-9]+\.[A-Za-z0-9]+/g) || [];
        return [...new Set(matches)];
    }

// ─── SONG SOURCES ────────────────────────────────────────────────

function qualityFromUrl(url) {
    const m = String(url || '').match(/[-_](\d{2,3})(?:kbps)?[-_.]/);
    return m ? `${m[1]}kbps` : '128kbps';
}

// play-v2 takes a plain song name and returns a direct mp3 on a CDN in ONE call.
// The first call for a song can be slow (it converts on demand), so this waits up
// to 60s and retries once; a repeat call comes back quickly.
async function fetchPlayV2(query) {
    const data = await withRetry(
        () => downloadMedia('https://apis.davidcyril.name.ng/play-v2', { q: query }, 'GET', { timeout: 60000 }),
        2, 1500
    );
    const r = data?.result;
    const audioUrl = r?.audio?.url;
    if (!data?.success || !audioUrl) throw new Error(data?.message || 'No audio link returned');
    return {
        title: r.title || query,
        thumbnail: r.thumbnail || null,
        durationText: UI.formatDuration(r.duration),
        source: r.source || null,
        audioUrl,
        quality: `MP3 • ${qualityFromUrl(audioUrl)}`
    };
}

// The original /play flow (a converter link that is often stale). Kept as the backup.
async function fetchLegacyPlay(query) {
    let song, audioBuffer;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const data = await downloadMedia('https://apis.davidcyril.name.ng/play', { query, limit: 1 });
        if (!data?.result) throw new Error('No song found.');
        song = data.result;
        const downloadUrl = song.download_url || song.download || extractDownloadUrl(song);
        if (!downloadUrl) throw new Error('No download link');
        try {
            const buf = await fetchBuffer(downloadUrl);
            if (isLikelyAudio(buf)) { audioBuffer = buf; break; }
        } catch (e) { /* retry */ }
        if (attempt < 3) await delay(1200);
    }
    if (!audioBuffer) throw new Error('The song link kept coming back invalid or expired after 3 tries.');
    return {
        song: {
            title: song.title,
            thumbnail: song.thumbnail || null,
            durationText: song.duration || 'N/A',
            source: song.video_url || null,
            audioUrl: null,
            quality: 'MP3'
        },
        audioBuffer
    };
}

// Finds a song by name and returns { song, audioBuffer }.
// onStep(1) fires when the audio download starts (drives the progress card).
async function getSongAudio(query, onStep) {
    try {
        const song = await fetchPlayV2(query);
        if (onStep) onStep(1);
        const audioBuffer = await fetchBuffer(song.audioUrl, 60000);
        if (isLikelyAudio(audioBuffer)) return { song, audioBuffer };
        console.log('[PLAY] play-v2 link did not return audio, trying the older source');
    } catch (err) {
        console.log('[PLAY] play-v2 failed:', err.message);
    }
    if (onStep) onStep(1);
    return await fetchLegacyPlay(query);
}

// ─── VIDEO / MEDIA SOURCES ───────────────────────────────────────

// Decides photo / video / audio from the real Content-Type, falling back to the
// filename (prexzy's links carry it inside a signed token).
function classifyMedia(buffer, url = '') {
    const mime = (buffer?.mimeType || '').toLowerCase();
    if (mime.startsWith('video')) return 'video';
    if (mime.startsWith('image')) return 'image';
    if (mime.startsWith('audio')) return 'audio';

    let name = String(url).split('?')[0];
    const token = String(url).match(/[?&]token=([^&]+)/)?.[1];
    if (token) {
        try { name = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).filename || name; } catch (e) { /* use url */ }
    }
    const ext = name.split('.').pop().toLowerCase();
    if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return 'video';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
    if (['mp3', 'm4a', 'ogg', 'wav'].includes(ext)) return 'audio';
    return 'video';
}

// Facebook: prexzy facebookv2 first, the older source as the backup.
async function getFacebookMedia(url) {
    try {
        const data = await withRetry(() => downloadMedia('https://prexzyapis.com/download/facebookv2', { url }, 'GET', { timeout: 30000 }));
        const d = data?.data || {};
        const links = (Array.isArray(d.download_links) ? d.download_links : [])
            .map(l => (typeof l === 'string'
                ? { url: l, quality: '' }
                : { url: l.url || l.link || l.download || l.href, quality: String(l.quality || l.label || l.resolution || l.res || '') }))
            .filter(l => /^https?:/i.test(l.url || ''));
        if (links.length) {
            const best = links.find(l => /1080|720|hd/i.test(l.quality)) || links[0];
            return { url: best.url, quality: best.quality || 'Standard', title: d.title || 'Facebook Video', duration: d.duration || '' };
        }
        console.log('[FB] facebookv2 returned no links, trying the older source');
    } catch (e) {
        console.log('[FB] facebookv2 failed:', e.message);
    }

    const data = await downloadMedia('https://apis.davidcyril.name.ng/facebook', { url });
    if (!data || !data.success) throw new Error(data?.message || 'API returned an error');
    const hd = data?.result?.downloads?.hd?.url;
    const sd = data?.result?.downloads?.sd?.url;
    if (!hd && !sd) throw new Error('No download link found');
    return { url: hd || sd, quality: hd ? 'HD' : 'SD', title: data.result?.title || 'Facebook Video', duration: data.result?.duration || '' };
}

// TikTok: prexzy first (HD link, then the standard one), the older endpoints as the backup.
async function getTikTokMedia(url) {
    try {
        const data = await withRetry(() => downloadMedia('https://prexzyapis.com/download/tiktok', { url }, 'GET', { timeout: 30000 }));
        const d = data?.data;
        const urls = [d?.hdplay, d?.play].filter(u => /^https?:/i.test(u || ''));
        if (urls.length) {
            return {
                urls,
                title: d.title || 'TikTok video',
                creator: d.author?.nickname ? `${d.author.nickname}${d.author.unique_id ? ` (@${d.author.unique_id})` : ''}` : '',
                duration: UI.formatDuration(d.duration),
                plays: d.play_count != null ? UI.formatCount(d.play_count) : '',
                likes: d.digg_count != null ? UI.formatCount(d.digg_count) : ''
            };
        }
        console.log('[TIKTOK] prexzy returned no video link, trying the older endpoints');
    } catch (e) {
        console.log('[TIKTOK] prexzy failed:', e.message);
    }

    let data = await withRetry(() => downloadMedia(`https://apis.davidcyril.name.ng/download/tiktokv4?url=${encodeURIComponent(url)}`));
    let res = data?.results || data?.result || data;
    let downloadUrl = res?.nowatermark || res?.noWatermark || res?.video || res?.play || res?.download_url ||
                      (Array.isArray(res?.downloads) ? res.downloads[0]?.url : null) || extractDownloadUrl(data);
    if (!downloadUrl) {
        data = await withRetry(() => downloadMedia(`https://apis.davidcyril.name.ng/download/tiktok?url=${encodeURIComponent(url)}`));
        res = data?.results || data?.result || data;
        downloadUrl = res?.video || res?.nowatermark || extractDownloadUrl(data);
    }
    if (!downloadUrl) throw new Error('No valid video download link found.');
    return { urls: [downloadUrl], title: res?.title || res?.caption || res?.desc || 'TikTok video', creator: '', duration: '', plays: '', likes: '' };
}

// Instagram: prexzy igv2 (a list, so albums work), the older source as the backup.
async function getInstagramItems(url) {
    try {
        const data = await withRetry(() => downloadMedia('https://prexzyapis.com/download/igv2', { url }, 'GET', { timeout: 30000 }));
        const items = (Array.isArray(data?.results) ? data.results : [])
            .map(r => ({ url: r.download || r.url })).filter(r => /^https?:/i.test(r.url || ''));
        if (items.length) return items;
        console.log('[IG] igv2 returned no items, trying the older source');
    } catch (e) {
        console.log('[IG] igv2 failed:', e.message);
    }
    const data = await downloadMedia('https://apis.davidcyril.name.ng/instagram', { url });
    const downloadUrl = data?.result?.video || data?.result?.mp3 || extractDownloadUrl(data);
    if (!downloadUrl) throw new Error('No download link found');
    return [{ url: downloadUrl }];
}

// ─── SONG RECOGNITION (.shazam / .find) ──────────────────────────

// Works out WHERE the audio comes from, without downloading anything yet.
function findRecognitionSource(msg, args) {
    const typed = (args || '').match(/(https?:\/\/[^\s]+)/i);
    if (typed) return { url: typed[1] };

    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
    const quoted = contextInfo?.quotedMessage;
    if (!quoted) return null;

    const raw = getRawMessage(quoted);
    if (raw?.audioMessage) return { node: raw.audioMessage, type: 'audio', mime: raw.audioMessage.mimetype || 'audio/mpeg' };
    if (raw?.documentMessage?.mimetype?.startsWith('audio/')) return { node: raw.documentMessage, type: 'document', mime: raw.documentMessage.mimetype };
    if (raw?.videoMessage) return { node: raw.videoMessage, type: 'video', mime: raw.videoMessage.mimetype || 'video/mp4' };

    const text = raw?.conversation || raw?.extendedTextMessage?.text || raw?.imageMessage?.caption || raw?.videoMessage?.caption || '';
    const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
    return urlMatch ? { url: urlMatch[1] } : null;
}

async function loadRecognitionAudio(source) {
    if (source.url) return { url: source.url };
    const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
    const stream = await downloadContentFromMessage(source.node, source.type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    if (buffer.length > 15 * 1024 * 1024) throw new Error('That clip is too large. Send a shorter one (under about 15 MB).');
    return { buffer, mimeType: source.mime };
}

async function recognizeWithAudD({ buffer, mimeType, url }) {
    const form = new FormData();
    form.append('api_token', AUDD_TOKEN);
    form.append('return', 'apple_music,spotify');
    if (buffer) {
        const ext = (mimeType || 'audio/mpeg').split('/')[1].split(';')[0] || 'mp3';
        form.append('file', buffer, { filename: `clip.${ext}`, contentType: mimeType || 'audio/mpeg' });
    } else {
        form.append('url', url);
    }
    const res = await axios.post('https://api.audd.io/', form, {
        headers: form.getHeaders(), timeout: 45000, maxBodyLength: Infinity, maxContentLength: Infinity
    });
    const d = res.data;
    if (d?.status !== 'success') {
        const code = d?.error?.error_code;
        throw new Error(`${d?.error?.error_message || 'AudD returned an error'}${code ? ` (code ${code})` : ''}`);
    }
    const r = d.result;
    if (!r) { const e = new Error('No match'); e.code = 'NO_MATCH'; throw e; }

    const apple = r.apple_music || {};
    const spotify = r.spotify || {};
    const art = apple.artwork?.url ? apple.artwork.url.replace('{w}', '600').replace('{h}', '600') : (spotify.album?.images?.[0]?.url || null);
    return {
        title: r.title, artist: r.artist, album: r.album || apple.albumName || '',
        year: String(r.release_date || apple.releaseDate || '').slice(0, 4),
        genre: (apple.genreNames || []).filter(g => g !== 'Music').join(', '),
        timecode: r.timecode || '',
        spotifyUrl: spotify.external_urls?.spotify || '',
        appleUrl: apple.url || '',
        songLink: r.song_link || '',
        cover: art
    };
}

async function recognizeSong(input) {
    if (!AUDD_TOKEN) {
        const e = new Error('No AudD token is set in dl.js');
        e.hint = 'Paste your AudD token into AUDD_TOKEN at the top of dl.js.';
        throw e;
    }
    try {
        return await recognizeWithAudD(input);
    } catch (err) {
        if (err.code === 'NO_MATCH') throw err;
        // Say plainly what AudD answered (an API error code, an HTTP status, or a timeout).
        throw new Error(err.response?.status ? `AudD answered HTTP ${err.response.status}` : err.message);
    }
}

// mode 'shazam' = details only. mode 'find' = details + links + a Download button.
async function runRecognition(sock, msg, args, mode) {
    const jid = msg.key.remoteJid;
    const cmdName = mode === 'find' ? 'find' : 'shazam';

    const source = findRecognitionSource(msg, args);
    if (!source) {
        return await sock.sendMessage(jid, {
            text: UI.usage(`Reply to an audio, voice note or video with \`.${cmdName}\`, or send a link to an audio file.`)
        }, { quoted: msg });
    }

    const ui = await UI.begin(sock, msg, cmdName);
    try {
        const input = await loadRecognitionAudio(source);
        await ui.step(1);
        const song = await recognizeSong(input);
        await ui.step(2);

        const fields = [
            ['Title', song.title], ['Artist', song.artist], ['Album', song.album],
            ['Year', song.year], ['Genre', song.genre], ['Matched at', song.timecode]
        ];
        const sections = [];
        if (mode === 'find') {
            const query = `${song.title} ${song.artist}`.replace(/\s+/g, ' ').trim();
            const rows = [];
            if (song.spotifyUrl) rows.push('🎧 Spotify', song.spotifyUrl);
            if (song.appleUrl) rows.push('🍎 Apple Music', song.appleUrl);
            if (song.songLink) rows.push('🔗 All platforms', song.songLink);
            rows.push('▶️ YouTube', `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
            sections.push({ rows });
        }
        const caption = UI.card({ icon: '🎶', title: 'SONG FOUND', fields, sections, footer: true });

        let cover = null;
        if (song.cover) { try { cover = await fetchBuffer(song.cover, 20000); } catch (e) { /* no cover */ } }
        const base = cover ? { image: cover, caption } : { text: caption };

        if (mode === 'find') {
            const downloadQuery = `${song.title} ${song.artist}`.replace(/\s+/g, ' ').trim().slice(0, 120);
            const prefix = Array.isArray(config.prefix) ? (config.prefix[0] || '.') : (config.prefix || '.');
            const buttons = [{ buttonId: `${prefix}play ${downloadQuery}`, buttonText: { displayText: '⬇️ Download' }, type: 1 }];
            try {
                await sock.sendMessage(jid, { ...base, buttons, headerType: cover ? 4 : 1 }, { quoted: msg });
            } catch (btnErr) {
                console.log('[FIND] buttons not accepted, sending without:', btnErr.message);
                await sock.sendMessage(jid, base, { quoted: msg });
            }
        } else {
            await sock.sendMessage(jid, base, { quoted: msg });
        }
        await ui.done();
    } catch (err) {
        console.error('[SHAZAM] failed:', err.message);
        if (err.code === 'NO_MATCH') {
            await ui.fail("Couldn't identify that song.", { title: 'NO MATCH', hint: 'Try a clearer 10 to 20 second clip with less background noise.' });
        } else {
            await ui.fail(err.message, { title: 'IDENTIFICATION FAILED', hint: err.hint });
        }
    }
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 0. Catbox (single file or full album)
    {
        name: 'catbox',
        isPrefixless: false,
        execute: async (sock, msg, args, opts) => {
            const jid = msg.key.remoteJid;
            const url = extractUrlFromMsg(msg, args);
            if (!url || !/catbox\.moe/i.test(url)) {
                return await sock.sendMessage(jid, { text: UI.usage("Please provide a catbox.moe file or album link.\n\nUsage: `.catbox <link>`") }, { quoted: msg });
            }

            const isAlbum = /catbox\.moe\/c\//i.test(url);

            try {
                if (isAlbum) {
                    await sock.sendMessage(jid, { text: "⏳ Fetching album, downloading all images..." }, { quoted: msg });
                    const fileUrls = await getCatboxAlbumFileUrls(url);
                    if (!fileUrls.length) {
                        return await sock.sendMessage(jid, { text: "❌ No files found in that catbox album, or the link is invalid." }, { quoted: msg });
                    }
                    for (const fileUrl of fileUrls) {
                        try {
                            await sendCatboxMedia(sock, jid, msg, fileUrl);
                            await delay(600); // avoid rate limiting on rapid sends
                        } catch (e) {
                            console.error('[CATBOX ALBUM] Failed on', fileUrl, e.message);
                        }
                    }
                } else {
                    await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
                    await sendCatboxMedia(sock, jid, msg, url);
                    await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
                }
            } catch (error) {
                console.error('[CATBOX] Error:', error.message);
                await sock.sendMessage(jid, { text: UI.errorText(`Failed to download from catbox: ${error.message}`) }, { quoted: msg });
            }
        }
    },

    // 1. Facebook (prexzy first, the older source as backup)
    {
        name: 'fb',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = extractUrlFromMsg(msg, args);
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Please provide a Facebook video URL.\n\nExample: `.fb <link>`") }, { quoted: msg });

            const ui = await UI.begin(sock, msg, 'facebook');
            try {
                const media = await getFacebookMedia(url);
                await ui.step(1);
                const buffer = await fetchBuffer(media.url, 60000);
                await ui.step(2);
                const caption = UI.card({
                    icon: '📘', title: media.title,
                    fields: [['Quality', media.quality], ['Duration', media.duration], ['Size', UI.formatBytes(buffer.length)]],
                    footer: true
                });
                await sock.sendMessage(jid, { video: buffer, caption }, { quoted: msg });
                await ui.done();
            } catch (err) {
                console.error('[FB] failed:', err.message);
                await ui.fail(err.message);
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

    

    // 2. TikTok Downloader (.tt / .tiktok) - prexzy first, the older endpoints as backup
    {
        name: 'tt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const url = extractUrlFromMsg(msg, args);

            if (!url || !url.includes('tiktok.com')) {
                return await sock.sendMessage(jid, {
                    text: UI.usage("Please provide or reply to a valid TikTok video link.\n\nExamples:\n• `.tt https://vm.tiktok.com/xxxx/`\n• Reply to a TikTok link with `.tt`")
                }, { quoted: msg });
            }

            const ui = await UI.begin(sock, msg, 'tiktok');
            try {
                const media = await getTikTokMedia(url);
                await ui.step(1);

                // Try the HD link first, then the standard one.
                let buffer = null;
                for (const candidate of media.urls) {
                    try {
                        const buf = await fetchBuffer(candidate, 60000);
                        if (buf.length > 10000) { buffer = buf; break; }
                    } catch (e) { /* try the next link */ }
                }
                if (!buffer) throw new Error('The video link could not be downloaded.');

                await ui.step(2);
                const caption = UI.card({
                    icon: '🎵', title: media.title,
                    fields: [['Creator', media.creator], ['Duration', media.duration], ['Plays', media.plays], ['Likes', media.likes], ['Size', UI.formatBytes(buffer.length)]],
                    footer: true
                });
                await sock.sendMessage(jid, { video: buffer, caption }, { quoted: msg });
                await ui.done();
            } catch (err) {
                console.error('[TIKTOK DOWNLOAD FAILED]:', err.message);
                await ui.fail(err.message);
            }
        }
    },

    // TikTok Aliases
    {
        name: 'tiktok',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const cmd = module.exports.find(c => c.name === 'tt');
            if (cmd) await cmd.execute(sock, msg, args);
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
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Please provide a YouTube URL.") }, { quoted: msg });
            const endpoint = 'https://apis.davidcyril.name.ng/download/savetube';
            const ui = await UI.begin(sock, msg, 'youtube');
            try {
                const data = await downloadMedia(endpoint, { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const caption = UI.card({
                    icon: '▶️', title: data?.data?.title || 'YouTube',
                    fields: [['Type', type === 'audio' ? 'MP3 audio' : 'MP4 video'], ['Size', UI.formatBytes(buffer.length)]],
                    footer: true
                });
                if (type === 'audio') {
                    await sock.sendMessage(jid, { text: caption }, { quoted: msg });
                    await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { video: buffer, caption }, { quoted: msg });
                }
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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

    // 4. Instagram (prexzy igv2 first: handles albums; the older source as backup)
    {
        name: 'ig',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = extractUrlFromMsg(msg, args);
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Please provide an Instagram URL.\n\nExample: `.ig <link>`") }, { quoted: msg });

            const ui = await UI.begin(sock, msg, 'instagram');
            try {
                const items = (await getInstagramItems(url)).slice(0, 10);
                await ui.step(1);

                for (let i = 0; i < items.length; i++) {
                    const buffer = await fetchBuffer(items[i].url, 60000);
                    if (i === 0) await ui.step(2);

                    const kind = classifyMedia(buffer, items[i].url);
                    const label = kind === 'video' ? 'Video' : (kind === 'image' ? 'Photo' : 'Audio');
                    const caption = i === 0
                        ? UI.card({
                            icon: '📸', title: items.length > 1 ? `Instagram album • ${items.length} items` : 'Instagram',
                            fields: [['Type', label], ['Size', UI.formatBytes(buffer.length)]],
                            footer: true
                        })
                        : `📸 ${i + 1} of ${items.length}`;

                    if (kind === 'image') await sock.sendMessage(jid, { image: buffer, caption }, { quoted: msg });
                    else if (kind === 'audio') await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                    else await sock.sendMessage(jid, { video: buffer, caption }, { quoted: msg });

                    if (i < items.length - 1) await delay(500);
                }
                await ui.done();
            } catch (err) {
                console.error('[IG] failed:', err.message);
                await ui.fail(err.message);
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
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Please provide a Twitter/X URL.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'twitter');
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/twitter', { url });
                const downloadUrl = data?.video_hd || data?.video_sd || extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const caption = UI.card({
                    icon: '🐦', title: data.description || 'Twitter video',
                    fields: [['Size', UI.formatBytes(buffer.length)]], footer: true
                });
                await sock.sendMessage(jid, { video: buffer, caption }, { quoted: msg });
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Please provide a Spotify track URL.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'spotify');
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/spotifydl', { url });
                const downloadUrl = data?.DownloadLink || extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                const caption = UI.card({
                    icon: '🟢', title: data.title || 'Spotify',
                    fields: [['Size', UI.formatBytes(buffer.length)]], footer: true
                });
                await sock.sendMessage(jid, { text: caption }, { quoted: msg });
                await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Please provide a Pinterest pin URL.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'pinterest');
            try {
                const data = await downloadMedia('https://apis.prexzyvilla.site/download/pinterest', { url });
                const downloadUrl = extractDownloadUrl(data);
                if (!downloadUrl) throw new Error('No download link found');
                const buffer = await fetchBuffer(downloadUrl);
                await sock.sendMessage(jid, { image: buffer, caption: extractTitle(data) });
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Please provide a MediaFire link.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'mediafire');
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
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Please provide a Google Drive link.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'gdrive');
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
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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
            if (!code) return await sock.sendMessage(jid, { text: UI.usage("Please provide JavaScript code to obfuscate.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'obf');
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
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
            }
        }
    },


// 11. Song (one call, delivered as a native music card)
    {
        name: 'song',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args?.trim();
            if (!query) return await sock.sendMessage(jid, { text: UI.usage("Provide a song name.\n\nExample: `.song Faded`") }, { quoted: msg });

            const ui = await UI.begin(sock, msg, 'song');
            try {
                const { song, audioBuffer } = await getSongAudio(query, (i) => ui.step(i));
                await ui.step(2);

                let thumb = null;
                if (song.thumbnail) { try { thumb = await fetchBuffer(song.thumbnail); } catch (e) { /* no cover */ } }

                const payload = { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false };
                if (thumb) {
                    payload.contextInfo = {
                        externalAdReply: {
                            title: song.title,
                            body: `${song.durationText} • ${song.quality}`,
                            thumbnail: thumb,
                            mediaType: 2, // renders as a native music card
                            mediaUrl: song.source || undefined,
                            sourceUrl: song.source || undefined
                        }
                    };
                }
                await sock.sendMessage(jid, payload, { quoted: msg });
                await ui.done();
            } catch (err) {
                console.error('[SONG] failed:', err.message);
                await ui.fail(err.message);
            }
        }
    },

    // 12. Play (details card with the cover, then the audio)
    {
        name: 'play',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args?.trim();
            if (!query) return await sock.sendMessage(jid, { text: UI.usage("Provide a song name.\n\nExample: `.play Faded`") }, { quoted: msg });

            const ui = await UI.begin(sock, msg, 'play');
            try {
                const { song, audioBuffer } = await getSongAudio(query, (i) => ui.step(i));
                await ui.step(2);

                let thumb = null;
                if (song.thumbnail) { try { thumb = await fetchBuffer(song.thumbnail); } catch (e) { console.log('[Play Command] Failed to download the cover.'); } }

                const caption = UI.card({
                    icon: '🎵', title: song.title,
                    fields: [['Duration', song.durationText], ['Quality', song.quality], ['Size', UI.formatBytes(audioBuffer.length)]],
                    footer: true
                });
                if (thumb) await sock.sendMessage(jid, { image: thumb, caption }, { quoted: msg });
                else await sock.sendMessage(jid, { text: caption }, { quoted: msg });

                await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                await ui.done();
            } catch (err) {
                console.error('[PLAY] failed:', err.message);
                await ui.fail(err.message);
            }
        }
    },

// 13. Telegram Stickers (using Telegram Bot API - Fixed Edit ID Reply Bug)
    {
        name: 'tgs',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const url = args?.trim();
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Provide a Telegram sticker pack URL.\n\nExample: `.tgs https://t.me/addstickers/doakesreactions`") }, { quoted: msg });

            // 1. Send the initial loading message container (gets the persistent ID)
            const statusMsg = await sock.sendMessage(jid, { text: UI.statusText('tgs', 0) }, { quoted: msg });

            const token = config.telegramBotToken;
            if (!token) {
                return await sock.sendMessage(jid, {
                    text: UI.errorText("Telegram Bot Token not configured. Please add TELEGRAM_BOT_TOKEN to your .env file.", { title: 'SETUP NEEDED', hint: '' }),
                    edit: statusMsg.key
                });
            }

            const packMatch = url.match(/addstickers\/([a-zA-Z0-9_]+)/i);
            if (!packMatch) {
                return await sock.sendMessage(jid, {
                    text: UI.errorText("Invalid sticker pack URL. It must look like: https://t.me/addstickers/PackName"),
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
                    await sock.sendMessage(jid, { text: UI.errorText("No stickers found in this pack."), edit: statusMsg.key });
                    return;
                }

                const maxShow = Math.min(stickers.length, 20);
                const list = UI.card({
                    icon: '🧩', title: data.result.title || 'Stickers',
                    fields: stickers.slice(0, maxShow).map((st, i) => [`${i + 1}.`, `${st.emoji || '📌'}${st.is_animated ? ' (animated)' : ''}`]),
                    note: `${stickers.length > 20 ? `Showing the first 20 of ${stickers.length}. ` : ''}📌 Reply with a number to download.`
                });

                // 2. Edit the loading message to display the list
                await sock.sendMessage(jid, { text: list, edit: statusMsg.key });
                
                // 3. FIX: Register the session under statusMsg.key.id (the original message container)
                // This ensures replies to the edited message match correctly.
                registerSession('tgs', statusMsg.key.id, {
                    stickers: stickers,
                    token: token,
                    handle: handleTgsReply,
                    timestamp: Date.now()
                });
            } catch (err) {
                console.error('[TGS] Error:', err.message);
                await sock.sendMessage(jid, {
                    text: UI.errorText(`Failed to fetch sticker pack: ${err.message}`),
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
            if (!query) return await sock.sendMessage(jid, { text: UI.usage("Provide an app name (e.g., whatsapp).") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'apk');
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
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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
            if (!url) return await sock.sendMessage(jid, { text: UI.usage("Provide a website URL.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'web');
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
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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
            if (!query) return await sock.sendMessage(jid, { text: UI.usage("Provide song name/artist.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'lyrics');
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/lyrics/genius', { q: query });
                if (!data?.success || !data.results || data.results.length === 0) {
                    return await ui.fail("No lyrics found.");
                }
                const results = data.results.slice(0, 5);
                const list = UI.card({
                    icon: '📝', title: 'LYRICS RESULTS',
                    fields: results.map((r, i) => [`${i + 1}.`, `${r.title} - ${r.artist}`]),
                    note: '📌 Reply with a number to view the lyrics.'
                });
                const prompt = await sock.sendMessage(jid, { text: list }, { quoted: msg });
                
                // Registered via safe session helper
                registerSession('lyrics', prompt.key.id, { results, handle: handleLyricsReply });
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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
            let count = 5;
            let query = parts.join(' ');
            const first = parts[0];
            if (first && !isNaN(first) && parseInt(first) > 0) {
                count = Math.min(parseInt(first), 10);
                query = parts.slice(1).join(' ');
            }
            if (!query) return await sock.sendMessage(jid, { text: UI.usage("Provide a search query.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'images');
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/search/pinterest', { text: query });
                if (!data?.success || !data.result || data.result.length === 0) {
                    return await ui.fail("No images found.");
                }
                const images = data.result.slice(0, count);
                for (const img of images) {
                    const buffer = await fetchBuffer(img.image);
                    await sock.sendMessage(jid, { image: buffer });
                }
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
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
            if (!query) return await sock.sendMessage(jid, { text: UI.usage("Provide a search term.") }, { quoted: msg });
            const ui = await UI.begin(sock, msg, 'xvid');
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/search/xvideo', { text: query });
                if (!data?.success || !data.result || data.result.length === 0) {
                    return await ui.fail("No videos found.");
                }
                const results = data.result.slice(0, 10);
                const list = UI.card({
                    icon: '🎥', title: 'VIDEO RESULTS',
                    fields: results.map((r, i) => [`${i + 1}.`, `${r.title} (${r.duration})`]),
                    note: '📌 Reply with a number to get the video link.'
                });
                const prompt = await sock.sendMessage(jid, { text: list }, { quoted: msg });
                
                // Registered via safe session helper
                registerSession('xvid', prompt.key.id, { results, handle: handleXvidReply });
                await ui.done();
            } catch (err) {
                await ui.fail(err.message);
            }
        }
    },

    // 19. Shazam (details only) and Find (details + links + Download button)
    {
        name: 'shazam',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => runRecognition(sock, msg, args, 'shazam')
    },
    {
        name: 'find',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => runRecognition(sock, msg, args, 'find')
    }
];

// ─── EXPORT HANDLERS ─────────────────────────────────────────────
module.exports.handleSongReply = handleSongReply;
module.exports.handleTgsReply = handleTgsReply;
module.exports.handleLyricsReply = handleLyricsReply;
module.exports.handleXvidReply = handleXvidReply;