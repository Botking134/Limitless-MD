// plugins/audio.js
const settings = require('../../settings');

global.songSessions = global.songSessions || {};

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

async function fetchBuffer(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept': '*/*'
            }
        });
        if (!response.ok) throw new Error(`HTTP Status ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (e) {
        console.error("❌ [DOWNLOADER] fetchBuffer failed:", e.message);
        return null;
    }
}

async function resolveUrlOrSearch(args) {
    if (!args) return null;
    const urlRegex = /^(https?:\/\/[^\s]+)/i;
    if (urlRegex.test(args)) {
        return args.trim();
    }
    try {
        const yts = require('yt-search');
        const results = await yts(args);
        if (results.videos && results.videos.length > 0) {
            return results.videos[0].url;
        }
    } catch (e) {
        console.error("resolveUrlOrSearch error:", e.message);
    }
    return null;
}

module.exports = [
    // 1. MUSIC PLAYER (.play)
    {
        name: 'play',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a song query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching song... 🔍" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ No results found." }, { quoted: msg });

                const { title, thumbnail, duration, download_url } = data.result;

                await sock.sendMessage(jid, { 
                    image: { url: thumbnail }, 
                    caption: `🎵 *SONG FOUND*\n\n📌 *Title:* ${title}\n⏳ *Duration:* ${duration}` 
                }, { quoted: msg });

                const audioBuffer = await fetchBuffer(download_url);
                if (audioBuffer) {
                    try {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(jid, { document: audioBuffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { audio: { url: download_url }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download song." }, { quoted: msg });
            }
        }
    },

    // 2. YOUTUBE MP3 DOWNLOADER (.ytmp3)
    {
        name: 'ytmp3',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a YouTube link or search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Fetching audio... 📥" }, { quoted: msg });

                const resolvedUrl = await resolveUrlOrSearch(query);
                if (!resolvedUrl) return await sock.sendMessage(jid, { text: "❌ No results found." }, { quoted: msg });

                let downloadUrl = "";
                let title = "YouTube Audio";

                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/youtube/mp33?url=${encodeURIComponent(resolvedUrl)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            title = data.result.title || title;
                            downloadUrl = data.result.mp3 || data.result.download_url || data.result.link;
                        }
                    }
                } catch (e) {}

                if (!downloadUrl) {
                    const response = await fetch(`https://apis.davidcyril.name.ng/download/ytmp3?url=${encodeURIComponent(resolvedUrl)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            title = data.result.title || title;
                            downloadUrl = data.result.mp3 || data.result.download_url || data.result.link;
                        }
                    }
                }

                if (!downloadUrl) throw new Error();

                const audioBuffer = await fetchBuffer(downloadUrl);
                if (audioBuffer) {
                    try {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(jid, { document: audioBuffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { audio: { url: downloadUrl }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download audio." }, { quoted: msg });
            }
        }
    },

    // 3. INTERACTIVE SONG SEARCHER (.song)
    {
        name: 'song',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a song query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching song index... 🔍" }, { quoted: msg });

                const yts = require('yt-search');
                const results = await yts(args);
                const videos = results.videos || [];

                if (videos.length === 0) return await sock.sendMessage(jid, { text: "❌ No results found." }, { quoted: msg });

                const selectedResults = videos.slice(0, 10);

                let listCaption = `🎵 *SONG SEARCH RESULTS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                selectedResults.forEach((video, index) => {
                    listCaption += `${index + 1}. *${video.title}* (${video.duration || 'N/A'})\n`;
                });
                listCaption += `\n💡 *Reply with the number of the song to download.*`;

                const prompt = await sock.sendMessage(jid, { text: listCaption }, { quoted: msg });

                global.songSessions[prompt.key.id] = {
                    query: args,
                    results: selectedResults.map(v => ({ title: v.title, url: v.url }))
                };
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to search song." }, { quoted: msg });
            }
        }
    },

    // 4. DOCUMENT-FORMAT YOUTUBE LINK AUDIO DOWNLOADER (.ytmp3doc)
    {
        name: 'ytmp3doc',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a YouTube link or search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Fetching YouTube audio as document... 📥" }, { quoted: msg });

                const resolvedUrl = await resolveUrlOrSearch(query);
                if (!resolvedUrl) return;

                const response = await fetch(`https://apis.davidcyril.name.ng/youtube?url=${encodeURIComponent(resolvedUrl)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ Failed to parse media." }, { quoted: msg });

                const title = data.result.title || "YouTube Audio";
                const downloadUrl = data.result.mp3 || data.result.download_url;

                const docBuffer = await fetchBuffer(downloadUrl);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download audio document." }, { quoted: msg });
            }
        }
    },

    // 5. DOCUMENT-FORMAT YOUTUBE SEARCH AUDIO DOWNLOADER (.playdoc)
    {
        name: 'playdoc',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a song query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching song index for document... 🔍" }, { quoted: msg });

                const yts = require('yt-search');
                const results = await yts(args);
                const videos = results.videos || [];

                if (videos.length === 0) return await sock.sendMessage(jid, { text: "❌ Song not found." }, { quoted: msg });

                const firstSong = videos[0];

                const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(firstSong.title)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ Song not found." }, { quoted: msg });

                const { title, download_url } = data.result;

                const docBuffer = await fetchBuffer(download_url);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: download_url }, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to process document download." }, { quoted: msg });
            }
        }
    },

    // 6. SPOTIFY AUDIO DOWNLOADER (.spotify)
    {
        name: 'spotify',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a Spotify link or song query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching Spotify track... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/spotifydl?query=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) throw new Error();

                const downloadUrl = data.result.download_url || data.result.link;

                const audioBuffer = await fetchBuffer(downloadUrl);
                if (audioBuffer) {
                    try {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(jid, { document: audioBuffer, mimetype: 'audio/mpeg', fileName: 'spotify-track.mp3' }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { audio: { url: downloadUrl }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download Spotify track." }, { quoted: msg });
            }
        }
    },

    // 7. SPOTIFY AUDIO DOWNLOADER V2 (.spotify2)
    {
        name: 'spotify2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a Spotify link or song query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching Spotify track v2... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/spotifydl2?query=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) throw new Error();

                const downloadUrl = data.result.download_url || data.result.link;

                const audioBuffer = await fetchBuffer(downloadUrl);
                if (audioBuffer) {
                    try {
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(jid, { document: audioBuffer, mimetype: 'audio/mpeg', fileName: 'spotify-track.mp3' }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { audio: { url: downloadUrl }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download Spotify track." }, { quoted: msg });
            }
        }
    }
];