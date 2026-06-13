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

module.exports = [
    // 1. YOUTUBE MP4 DOWNLOADER (.ytmp4 - Strictly Links Only)
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

                if (!downloadUrl) throw new Error();

                // Send via direct URL reference so WhatsApp transcodes it correctly for in-app mobile playback
                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎥 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download video." }, { quoted: msg });
            }
        }
    },

    // 2. VIDEO DOWNPARSER (.video - Supports both Search Queries and Links)
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

                if (videos.length === 0) return await sock.sendMessage(jid, { text: "❌ No results found." }, { quoted: msg });

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

                if (!downloadUrl) throw new Error();

                const caption = `🎥 *Title:* ${title}\n⏳ *Duration:* ${firstVideo.duration || 'N/A'}`;
                
                // Send via direct URL reference so WhatsApp transcodes it correctly for in-app mobile playback
                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: caption }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download video." }, { quoted: msg });
            }
        }
    },

    // 3. FACEBOOK VIDEO DOWNLOADER (.fb - Strictly Links Only)
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
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.video) return await sock.sendMessage(jid, { text: "❌ Failed to parse Facebook video." }, { quoted: msg });

                const title = data.video.title || "Facebook Video";
                const downloads = data.video.downloads || [];
                const downloadUrl = downloads.find(d => d.quality === 'hd')?.downloadUrl || downloads.find(d => d.quality === 'sd')?.downloadUrl || downloads[0]?.downloadUrl;

                if (!downloadUrl) throw new Error();

                // Send via direct URL reference so WhatsApp transcodes it correctly for in-app mobile playback
                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎬 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download Facebook video." }, { quoted: msg });
            }
        }
    },

    // 4. TIKTOK VIDEO DOWNLOADER (.tt - Strictly Links Only)
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
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ Failed to parse TikTok." }, { quoted: msg });

                const title = data.result.title || "TikTok Video";
                const downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url;

                // Send via direct URL reference so WhatsApp transcodes it correctly for in-app mobile playback
                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎵 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download TikTok." }, { quoted: msg });
            }
        }
    },

    // 5. INSTAGRAM DOWNLOADER (.ig - Strictly Links Only)
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
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ Instagram download failed." }, { quoted: msg });

                const downloadUrl = data.result.url || data.result.video || data.result.image || data.result.download_url;
                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");

                if (isVideo) {
                    await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 Instagram Video`, mimetype: 'video/mp4' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { image: { url: downloadUrl }, caption: `📸 Instagram Image` }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download Instagram media." }, { quoted: msg });
            }
        }
    },

    // 6. TWITTER VIDEO & IMAGE DOWNLOADER V2 (.x2 - Strictly Links Only)
    {
        name: 'x2',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
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
                    const response = await fetch(`https://apis.davidcyril.name.ng/twitterV2?url=${encodeURIComponent(query)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            downloadUrl = data.result.video || data.result.image || data.result.download_url || data.result.link;
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

                if (!downloadUrl) throw new Error();

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");

                if (isVideo) {
                    await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 Twitter Video`, mimetype: 'video/mp4' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { image: { url: downloadUrl }, caption: `📸 Twitter Image` }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download Twitter/X media." }, { quoted: msg });
            }
        }
    },

    // 7. TIKTOK VIDEO DOWNLOADER V2 (.tt2 - Strictly Links Only)
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
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) throw new Error();

                const title = data.result.title || "TikTok Video";
                const downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url;

                // Send via direct URL reference so WhatsApp transcodes it correctly for in-app mobile playback
                await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎵 *Title:* ${title}`, mimetype: 'video/mp4' }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to complete TikTok v2 download." }, { quoted: msg });
            }
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'fb') aliases.push({ ...cmd, name: 'facebook' });
    if (cmd.name === 'tt') aliases.push({ ...cmd, name: 'tiktok' });
    if (cmd.name === 'ig') aliases.push({ ...cmd, name: 'instagram' });
    if (cmd.name === 'x2') aliases.push({ ...cmd, name: 'xdl2' });
});
module.exports.push(...aliases);