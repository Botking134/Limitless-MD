// plugins/downloaders/aud.js
const config = require('../../config');

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

function logError(cmd, args, err) {
    console.error(`\n================= [DIAGNOSTIC ERROR LOG: .${cmd}] =================`);
    console.error(`Timestamp:  ${new Date().toISOString()}`);
    console.error(`Arguments:  "${args || 'none'}"`);
    console.error(`Error Type: ${err.name}`);
    console.error(`Message:    ${err.message}`);
    console.error(`Stack Trace:\n${err.stack}`);
    console.error(`==================================================================\n`);
}

module.exports = [
    // 1. PLAY
    {
        name: 'play',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a song query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching song... 🔍" }, { quoted: msg });

                const yts = require('yt-search');
                const results = await yts(args);
                const videos = results.videos || [];
                if (videos.length === 0) throw new Error("No results found on search index.");
                const videoUrl = videos[0].url;

                let downloadUrl = "";
                let title = videos[0].title || "YouTube Audio";
                let thumbnail = videos[0].thumbnail || "";
                let duration = videos[0].duration?.timestamp || "N/A";

                const response = await fetch(`https://yt.david-cyril.net.ng/api/download?url=${encodeURIComponent(videoUrl)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.status && data.result) {
                        title = data.result.title || title;
                        downloadUrl = data.result.mp3 || data.result.download_url || data.result.link;
                    }
                }

                if (!downloadUrl) throw new Error("Isolated YouTube downloader returned empty audio stream.");

                await sock.sendMessage(jid, {
                    image: { url: thumbnail },
                    caption: `🎵 *SONG FOUND*\n\n📌 *Title:* ${title}\n⏳ *Duration:* ${duration}`
                }, { quoted: msg });

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
                logError("play", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download song. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 2. YTMP3
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
                if (!resolvedUrl) throw new Error("Unable to resolve link.");

                let downloadUrl = "";
                let title = "YouTube Audio";

                const response = await fetch(`https://yt.david-cyril.net.ng/api/download?url=${encodeURIComponent(resolvedUrl)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.status && data.result) {
                        title = data.result.title || title;
                        downloadUrl = data.result.mp3 || data.result.download_url || data.result.link;
                    }
                }

                if (!downloadUrl) throw new Error("Isolated YouTube downloader returned empty audio stream.");

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
                logError("ytmp3", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download audio. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 3. SONG (Interactive selection)
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

                if (videos.length === 0) throw new Error("No results found.");

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
                logError("song", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to search song. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 4. YTMP3DOC (Audio as document)
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
                if (!resolvedUrl) throw new Error("Unable to resolve link.");

                const response = await fetch(`https://yt.david-cyril.net.ng/api/download?url=${encodeURIComponent(resolvedUrl)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Invalid response or unsuccessful status.");

                const title = data.result.title || "YouTube Audio";
                const downloadUrl = data.result.mp3 || data.result.download_url;
                if (!downloadUrl) throw new Error("Audio download link resolved empty.");

                const docBuffer = await fetchBuffer(downloadUrl);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                }
            } catch (error) {
                logError("ytmp3doc", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download audio document. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 5. PLAYDOC (Search and download as document)
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

                if (videos.length === 0) throw new Error("No search results found.");

                const firstSong = videos[0];

                const response = await fetch(`https://yt.david-cyril.net.ng/api/download?url=${encodeURIComponent(firstSong.url)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Failed to parse downloader result.");

                const title = data.result.title || "YouTube Audio";
                const downloadUrl = data.result.mp3 || data.result.download_url;
                if (!downloadUrl) throw new Error("Direct audio stream download link empty.");

                const docBuffer = await fetchBuffer(downloadUrl);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                }
            } catch (error) {
                logError("playdoc", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to process document download. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 6. SPOTIFY
    {
        name: 'spotify',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a Spotify link or song query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching Spotify track... 📥" }, { quoted: msg });

                const response = await fetch(`https://david-cyril.net.ng/projects/spotify/api?query=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Spotify track unresolved.");

                const downloadUrl = data.result.download_url || data.result.link;
                if (!downloadUrl) throw new Error("Spotify download link empty.");

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
                logError("spotify", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Spotify track. Error: ${error.message}` }, { quoted: msg });
            }
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'play') aliases.push({ ...cmd, name: 'play' }); // no alias
});
module.exports.push(...aliases);