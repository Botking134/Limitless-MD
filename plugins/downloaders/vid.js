// plugins/downloaders/vid.js
const settings = require('../../settings');

const urlRegex = /^(https?:\/\/[^\s]+)/i;

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

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

                if (!downloadUrl) throw new Error("Both conversion endpoints returned empty URLs.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎥 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                logError("ytmp4", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download video. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 2. VIDEO SEARCH DOWNPARSER (.video)
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

                if (videos.length === 0) throw new Error("No search results returned.");

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

                if (!downloadUrl) throw new Error("Unable to fetch download link for target video.");

                const caption = `🎥 *Title:* ${title}\n⏳ *Duration:* ${firstVideo.duration || 'N/A'}`;
                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: caption }, { quoted: msg });
            } catch (error) {
                logError("video", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download video. Error: ${error.message}` }, { quoted: msg });
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

                let response = await fetch(`https://apis.davidcyril.name.ng/facebook2?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                let data = await response.json();
                
                // Retry loop if internal scraper fails
                let retries = 0;
                while ((!data.status || !data.video) && retries < 2) {
                    await new Promise(r => setTimeout(r, 1500));
                    response = await fetch(`https://apis.davidcyril.name.ng/facebook2?url=${encodeURIComponent(query)}`);
                    data = await response.json();
                    retries++;
                }

                if (!data.status || !data.video) throw new Error("Facebook API unable to extract video links.");

                const title = data.video.title || "Facebook Video";
                const downloads = data.video.downloads || [];
                const downloadUrl = downloads.find(d => d.quality === 'hd')?.downloadUrl || downloads.find(d => d.quality === 'sd')?.downloadUrl || downloads[0]?.downloadUrl;

                if (!downloadUrl) throw new Error("Download URL parsing empty.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎬 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                logError("fb", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Facebook video. Error: ${error.message}` }, { quoted: msg });
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

                let downloadUrl = "";
                let title = "TikTok Video";

                // Multi-route fallback array to bypass dead scraping endpoints
                const endpoints = [
                    `https://apis.davidcyril.name.ng/download/tiktokv2?url=${encodeURIComponent(query)}`,
                    `https://apis.davidcyril.name.ng/tiktok?url=${encodeURIComponent(query)}`,
                    `https://apis.davidcyril.name.ng/tiktok2?url=${encodeURIComponent(query)}`
                ];

                for (const url of endpoints) {
                    try {
                        const response = await fetch(url);
                        if (response.ok) {
                            const data = await response.json();
                            
                            // Handler for structure: { status: true, result: { video: "...", title: "..." } }
                            if (data.status && data.result) {
                                title = data.result.title || title;
                                downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url || data.result.link;
                                if (downloadUrl) break;
                            }
                            
                            // Handler for structure: { status: true, video: { url: "...", title: "..." } }
                            if (data.status && data.video) {
                                title = data.video.title || title;
                                downloadUrl = data.video.noWatermark || data.video.url || data.video.downloadUrl || data.video.download_url;
                                if (downloadUrl) break;
                            }
                        }
                    } catch (err) {
                        console.warn(`[DIAGNOSTIC] Fallback endpoint failed: ${url}. Error: ${err.message}`);
                    }
                }

                if (!downloadUrl) throw new Error("All resolved TikTok endpoints returned false or invalid structures.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎵 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                logError("tt", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download TikTok. Error: ${error.message}` }, { quoted: msg });
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
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Instagram download yielded no results.");

                const downloadUrl = data.result.url || data.result.video || data.result.image || data.result.download_url;
                if (!downloadUrl) throw new Error("No media direct URLs resolved.");

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");

                if (isVideo) {
                    await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 Instagram Video`, mimetype: 'video/mp4' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { image: { url: downloadUrl }, caption: `📸 Instagram Image` }, { quoted: msg });
                }
            } catch (error) {
                logError("ig", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Instagram media. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 6. TWITTER VIDEO & IMAGE DOWNLOADER V2 (.x2)
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

                if (!downloadUrl) throw new Error("No download media resolved from both endpoints.");

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");

                if (isVideo) {
                    await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 Twitter Video`, mimetype: 'video/mp4' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { image: { url: downloadUrl }, caption: `📸 Twitter Image` }, { quoted: msg });
                }
            } catch (error) {
                logError("x2", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Twitter/X media. Error: ${error.message}` }, { quoted: msg });
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