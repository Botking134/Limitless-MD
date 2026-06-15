// plugins/downloaders/video.js
const settings = require('../../settings');

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

const urlRegex = /^(https?:\/\/[^\s]+)/i;

async function resolveUrlOrSearch(args) {
    if (!args) return null;
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

function logCommandError(commandName, args, error) {
    console.error(`\n================= [DIAGNOSTIC ERROR LOG: .${commandName}] =================`);
    console.error(`Timestamp:  ${new Date().toISOString()}`);
    console.error(`Arguments:  "${args || 'none'}"`);
    console.error(`Error Type: ${error.name || 'Unknown'}`);
    console.error(`Message:    ${error.message || 'No message provided'}`);
    console.error(`Stack Trace:\n${error.stack || 'No stack trace available'}`);
    console.error(`========================================================================\n`);
}

module.exports = [
    // 1. YOUTUBE MP4 DOWNLOADER (.ytmp4)
    {
        name: 'ytmp4',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query || !urlRegex.test(query)) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid direct YouTube link." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Fetching video... 🎬" }, { quoted: msg });

                let downloadUrl = "";
                let title = "YouTube Video";

                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/youtube?url=${encodeURIComponent(query)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            title = data.result.title || title;
                            downloadUrl = data.result.video || data.result.mp4 || data.result.download_url || data.result.link;
                        }
                    }
                } catch (e) {}

                if (!downloadUrl) {
                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/download/ytmp4?url=${encodeURIComponent(query)}`);
                        if (response.ok) {
                            const data = await response.json();
                            if (data.status && data.result) {
                                title = data.result.title || title;
                                downloadUrl = data.result.video || data.result.mp4 || data.result.download_url || data.result.link;
                            }
                        }
                    } catch (e) {}
                }

                if (!downloadUrl) throw new Error("Could not resolve download URL across secondary conversions.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎥 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                logCommandError('ytmp4', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download video. Diagnostic: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 2. VIDEO DOWNPARSER (.video)
    {
        name: 'video',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a video query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching video... 🎥" }, { quoted: msg });

                const yts = require('yt-search');
                const results = await yts(args);
                const videos = results.videos || [];

                if (videos.length === 0) throw new Error("No video tracks found matching query.");

                const firstVideo = videos[0];
                const videoUrl = firstVideo.url;

                let downloadUrl = "";
                let title = firstVideo.title || "YouTube Video";

                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/youtube?url=${encodeURIComponent(videoUrl)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            title = data.result.title || title;
                            downloadUrl = data.result.video || data.result.mp4 || data.result.download_url || data.result.link;
                        }
                    }
                } catch (e) {}

                if (!downloadUrl) {
                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/download/ytmp4?url=${encodeURIComponent(videoUrl)}`);
                        if (response.ok) {
                            const data = await response.json();
                            if (data.status && data.result) {
                                title = data.result.title || title;
                                downloadUrl = data.result.video || data.result.mp4 || data.result.download_url || data.result.link;
                            }
                        }
                    } catch (e) {}
                }

                if (!downloadUrl) throw new Error("Conversion endpoint was unable to render download link from index reference.");

                const caption = `🎥 *Title:* ${title}\n⏳ *Duration:* ${firstVideo.duration || 'N/A'}`;
                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: caption }, { quoted: msg });
            } catch (error) {
                logCommandError('video', args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download video. Diagnostic: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 3. FACEBOOK VIDEO DOWNLOADER (.fb)
    {
        name: 'fb',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query || !urlRegex.test(query)) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid direct Facebook link." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading Facebook video... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/facebook2?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error(`Facebook API responded with HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.video) throw new Error("API reported status false or contains no video data.");

                const title = data.video.title || "Facebook Video";
                const downloads = data.video.downloads || [];
                const downloadUrl = downloads.find(d => d.quality === 'hd')?.downloadUrl || downloads.find(d => d.quality === 'sd')?.downloadUrl || downloads[0]?.downloadUrl;

                if (!downloadUrl) throw new Error("Could not find a valid quality link inside Facebook array structure.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎬 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                logCommandError('fb', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Facebook video. Diagnostic: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 4. TIKTOK VIDEO DOWNLOADER (.tt)
    {
        name: 'tt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query || !urlRegex.test(query)) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid direct TikTok link." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading TikTok... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/download/tiktokv2?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error(`TikTok API responded with HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("API execution status reported unsuccessful.");

                const title = data.result.title || "TikTok Video";
                const downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url;

                if (!downloadUrl) throw new Error("Direct media URL properties missing inside response payload.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎵 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                logCommandError('tt', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download TikTok. Diagnostic: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 5. INSTAGRAM DOWNLOADER (.ig)
    {
        name: 'ig',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query || !urlRegex.test(query)) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid direct Instagram link." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading Instagram media... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/instagram?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error(`Instagram API responded with HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Invalid response or unsuccessful status from Instagram API.");

                const downloadUrl = data.result.url || data.result.video || data.result.image || data.result.download_url;
                if (!downloadUrl) throw new Error("Unable to identify media link fields from data payload.");

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");

                if (isVideo) {
                    await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 Instagram Video`, mimetype: 'video/mp4' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { image: { url: downloadUrl }, caption: `📸 Instagram Image` }, { quoted: msg });
                }
            } catch (error) {
                logCommandError('ig', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Instagram media. Diagnostic: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 6. TWITTER VIDEO & IMAGE DOWNLOADER (.X / .twitter)
    {
        name: 'x2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query || !urlRegex.test(query)) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid direct Twitter/X link." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading Twitter/X media... 📥" }, { quoted: msg });

                let downloadUrl = "";

                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/twitter?url=${encodeURIComponent(query)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            downloadUrl = data.result.video || data.result.image || data.result.download_url || data.result.link || data.result.url;
                        }
                    }
                } catch (e) {}

                if (!downloadUrl) {
                    const response = await fetch(`https://apis.davidcyril.name.ng/download/xdownloader?url=${encodeURIComponent(query)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            downloadUrl = data.result.video || data.result.image || data.result.download_url || data.result.link;
                        }
                    }
                }

                if (!downloadUrl) throw new Error("Could not extract a valid media URL from Twitter API endpoints.");

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");

                if (isVideo) {
                    await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 Twitter Video`, mimetype: 'video/mp4' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { image: { url: downloadUrl }, caption: `📸 Twitter Image` }, { quoted: msg });
                }
            } catch (error) {
                logCommandError('x2', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Twitter/X media. Diagnostic: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 7. TIKTOK VIDEO DOWNLOADER V2 (.tt2)
    {
        name: 'tt2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query || !urlRegex.test(query)) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid direct TikTok link." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading TikTok v2 video... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/download/tiktokv2?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error(`TikTok v2 API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Unsuccessful execution status parsed from v2 payload.");

                const title = data.result.title || "TikTok Video";
                const downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url;

                if (!downloadUrl) throw new Error("Missing direct download URL pointers in v2 response.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎵 *Title:* ${title}`, mimetype: 'video/mp4' }, { quoted: msg });
            } catch (error) {
                logCommandError('tt2', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to complete TikTok v2 download. Diagnostic: ${error.message}` }, { quoted: msg });
            }
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'fb') aliases.push({ ...cmd, name: 'facebook' });
    if (cmd.name === 'tt') aliases.push({ ...cmd, name: 'tiktok' });
    if (cmd.name === 'ig') aliases.push({ ...cmd, name: 'instagram' });
    if (cmd.name === 'x2') {
        aliases.push({ ...cmd, name: 'twitter' });
        aliases.push({ ...cmd, name: 'x' });
    }
});
module.exports.push(...aliases);