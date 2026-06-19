// plugins/downloaders/vid.js
const config = require('../../config');

const urlRegex = /^(https?:\/\/[^\s]+)/i;
const activeSessions = new Map(); // Key: "jid:sender", Value: { type: 'xvid'|'xxx', videos: [...], timestamp: Date.now() }

// Auto-cleanup expired sessions (older than 5 minutes) every minute
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of activeSessions.entries()) {
        if (now - session.timestamp > 300000) { 
            activeSessions.delete(key);
        }
    }
}, 60000);

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
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

const commands = [
    // 1. YTMP4
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

                const response = await fetch(`https://yt.david-cyril.net.ng/api/download?url=${encodeURIComponent(query)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.status && data.result) {
                        title = data.result.title || title;
                        downloadUrl = data.result.video || data.result.mp4 || data.result.download_url || data.result.link;
                    }
                }

                if (!downloadUrl) throw new Error("Dedicated YouTube downloader returned empty streams.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎥 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                logError("ytmp4", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download video. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 2. VIDEO (Search)
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

                const response = await fetch(`https://yt.david-cyril.net.ng/api/download?url=${encodeURIComponent(videoUrl)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.status && data.result) {
                        title = data.result.title || title;
                        downloadUrl = data.result.video || data.result.mp4 || data.result.download_url || data.result.link;
                    }
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

    // 3. FB (Facebook)
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

                let response = await fetch(`https://fb.david-cyril.net.ng/api/download?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                let data = await response.json();

                let retries = 0;
                while ((!data.status || !data.video) && retries < 2) {
                    await new Promise(r => setTimeout(r, 1500));
                    response = await fetch(`https://fb.david-cyril.net.ng/api/download?url=${encodeURIComponent(query)}`);
                    data = await response.json();
                    retries++;
                }

                if (!data.status || !data.video) throw new Error("FB downloader reported false status.");

                const title = data.video.title || "Facebook Video";
                const downloads = data.video.downloads || [];
                const downloadUrl = downloads.find(d => d.quality === 'hd')?.downloadUrl || downloads.find(d => d.quality === 'sd')?.downloadUrl || downloads[0]?.downloadUrl;

                if (!downloadUrl) throw new Error("No media link extracted from FB stream array.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎬 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                logError("fb", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Facebook video. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 4. TT (TikTok)
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

                const response = await fetch(`https://tiksave.name.ng/api/download?url=${encodeURIComponent(query)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.status && data.result) {
                        title = data.result.title || title;
                        downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url || data.result.link;
                    }
                }

                if (!downloadUrl) {
                    const fbResponse = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(query)}`);
                    if (fbResponse.ok) {
                        const fbData = await fbResponse.json();
                        if (fbData.code === 0 && fbData.data) {
                            title = fbData.data.title || title;
                            downloadUrl = fbData.data.play || fbData.data.wmplay;
                            if (downloadUrl && downloadUrl.startsWith("/")) {
                                downloadUrl = "https://www.tikwm.com" + downloadUrl;
                            }
                        }
                    }
                }

                if (!downloadUrl) throw new Error("All TikTok extraction pipelines returned false.");

                await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎵 *Title:* ${title}` }, { quoted: msg });
            } catch (error) {
                logError("tt", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download TikTok. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 5. IG (Instagram)
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

    // 6. X2 (Twitter/X)
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

                const response = await fetch(`https://twitter.david-cyril.net.ng/api/download?url=${encodeURIComponent(query)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.status && data.result) {
                        downloadUrl = data.result.video || data.result.image || data.result.download_url || data.result.link || data.result.url;
                    }
                }

                if (!downloadUrl) throw new Error("Dedicated Twitter scraper returned empty media arrays.");

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
    },

    // 7. XVideos (.xvid)
    {
        name: 'xvid',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) {
                return await sock.sendMessage(jid, { text: "❌ Please provide an XVideos search query." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: `Searching XVideos for "${query}"... 🔍` }, { quoted: msg });
                const searchResponse = await fetch(`https://apis.prexzyvilla.site/nsfw/xvideos-search?query=${encodeURIComponent(query)}`);
                if (!searchResponse.ok) throw new Error(`Search failed with status ${searchResponse.status}`);

                const searchData = await searchResponse.json();
                const videosList = searchData.videos || [];
                if (!searchData.status || videosList.length === 0) {
                    throw new Error("No search results found.");
                }

                const limitList = videosList.slice(0, 10);
                activeSessions.set(`${jid}:${sender}`, {
                    type: 'xvid',
                    videos: limitList,
                    timestamp: Date.now()
                });

                let menuText = `🎥 *XVideos Search Results:*\n\n`;
                limitList.forEach((v, index) => {
                    menuText += `*${index + 1}.* ${v.title}\n⏳ Duration: ${v.duration} min\n\n`;
                });
                menuText += `*Reply to this message with the number you want to download.*`;

                await sock.sendMessage(jid, { text: menuText }, { quoted: msg });
            } catch (error) {
                logError("xvid", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to fetch search results. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 8. XNXX (.xxx)
    {
        name: 'xxx',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) {
                return await sock.sendMessage(jid, { text: "❌ Please provide an XNXX search query." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: `Searching XNXX for "${query}"... 🔍` }, { quoted: msg });
                const searchResponse = await fetch(`https://apis.prexzyvilla.site/nsfw/xnxx-search?query=${encodeURIComponent(query)}`);
                if (!searchResponse.ok) throw new Error(`Search failed with status ${searchResponse.status}`);

                const searchData = await searchResponse.json();
                const videosList = searchData.videos || [];
                if (!searchData.status || videosList.length === 0) {
                    throw new Error("No search results found.");
                }

                const limitList = videosList.slice(0, 10);
                activeSessions.set(`${jid}:${sender}`, {
                    type: 'xxx',
                    videos: limitList,
                    timestamp: Date.now()
                });

                let menuText = `🎥 *XNXX Search Results:*\n\n`;
                limitList.forEach((v, index) => {
                    menuText += `*${index + 1}.* ${v.title}\n⏳ Duration: ${v.duration} min\n\n`;
                });
                menuText += `*Reply to this message with the number you want to download.*`;

                await sock.sendMessage(jid, { text: menuText }, { quoted: msg });
            } catch (error) {
                logError("xxx", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to fetch search results. Error: ${error.message}` }, { quoted: msg });
            }
        }
    }
];

// Generate dynamic prefixless selectors for choices 1 through 15
for (let i = 1; i <= 15; i++) {
    commands.push({
        name: `${i}`,
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const sessionKey = `${jid}:${sender}`;

            if (!activeSessions.has(sessionKey)) return;

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;

            const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || "";
            if (!quotedText.includes("Reply to this message with the number")) return;

            const session = activeSessions.get(sessionKey);
            const index = i - 1;

            if (index >= session.videos.length) {
                return await sock.sendMessage(jid, { text: "❌ Invalid selection index." }, { quoted: msg });
            }

            const selectedVideo = session.videos[index];
            activeSessions.delete(sessionKey); // Clean up active session

            try {
                await sock.sendMessage(jid, { text: `Downloading selected video... 📥\n_${selectedVideo.title}_` }, { quoted: msg });

                const dlEndpoint = session.type === 'xvid' 
                    ? `https://apis.prexzyvilla.site/nsfw/xvideos-dl?url=${encodeURIComponent(selectedVideo.url)}`
                    : `https://apis.prexzyvilla.site/nsfw/xnxx-dl?url=${encodeURIComponent(selectedVideo.url)}`;

                // Adding a standard browser User-Agent to prevent HTTP 400 rejection on fetch
                const response = await fetch(dlEndpoint, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
                    }
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const dlData = await response.json();
                if (!dlData.status) throw new Error("Downloader API failed to parse video elements.");

                // Extracted from the "files" container direct property format
                const downloadUrl = dlData.files?.high || dlData.files?.low || dlData.files?.hls;
                if (!downloadUrl) throw new Error("The media download URLs returned empty.");

                const title = dlData.title || selectedVideo.title;

                await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 *Title:* ${title}`, mimetype: 'video/mp4' }, { quoted: msg });
            } catch (error) {
                logError(session.type + "-download", selectedVideo.url, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download video. Error: ${error.message}` }, { quoted: msg });
            }
        }
    });
}

const aliases = [];
commands.forEach(cmd => {
    if (cmd.name === 'fb') aliases.push({ ...cmd, name: 'facebook' });
    if (cmd.name === 'tt') aliases.push({ ...cmd, name: 'tiktok' });
    if (cmd.name === 'ig') aliases.push({ ...cmd, name: 'instagram' });
    if (cmd.name === 'x2') {
        aliases.push({ ...cmd, name: 'twitter' });
        aliases.push({ ...cmd, name: 'x' });
    }
});
commands.push(...aliases);

module.exports = commands;