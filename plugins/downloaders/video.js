// plugins/video.js
const settings = require('../settings');

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

function isValidMp4(buffer) {
    if (!buffer || buffer.length < 12) return false;
    const hex = buffer.toString('hex', 0, 12);
    const hasFtyp = buffer.toString('ascii', 4, 8) === 'ftyp' || buffer.toString('ascii', 8, 12) === 'ftyp';
    const isHtml = hex.startsWith('3c21') || hex.startsWith('3c68');
    const isJson = hex.startsWith('7b22');
    return hasFtyp && !isHtml && !isJson;
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

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a YouTube link or search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Fetching video... 🎬" }, { quoted: msg });

                const resolvedUrl = await resolveUrlOrSearch(query);
                if (!resolvedUrl) return await sock.sendMessage(jid, { text: "❌ No results found." }, { quoted: msg });

                let downloadUrl = "";
                let title = "YouTube Video";

                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/youtube?url=${encodeURIComponent(resolvedUrl)}`);
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
                        const response = await fetch(`https://apis.davidcyril.name.ng/download/ytmp4?url=${encodeURIComponent(resolvedUrl)}`);
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

                const videoBuffer = await fetchBuffer(downloadUrl);
                if (videoBuffer && isValidMp4(videoBuffer)) {
                    try {
                        await sock.sendMessage(jid, { video: videoBuffer, mimetype: 'video/mp4', caption: `🎥 *Title:* ${title}` }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(jid, { document: videoBuffer, mimetype: 'video/mp4', fileName: `${title}.mp4`, caption: `🎥 *Title:* ${title}\n\n⚠️ _Sent as raw document due to player codec limits._` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { text: "❌ *Playback Limit Exceeded:* YouTube delivered a stream format exceeding mobile decoding profiles. Try downloading as standard audio instead." }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download video." }, { quoted: msg });
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
                const videoBuffer = await fetchBuffer(downloadUrl);
                if (videoBuffer && isValidMp4(videoBuffer)) {
                    try {
                        await sock.sendMessage(jid, { video: videoBuffer, mimetype: 'video/mp4', caption: caption }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(jid, { document: videoBuffer, mimetype: 'video/mp4', fileName: `${title}.mp4`, caption: `${caption}\n\n⚠️ _Sent as raw document due to player codec limits._` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { text: "❌ *Playback Limit Exceeded:* YouTube delivered a stream format exceeding mobile decoding profiles. Try downloading as standard audio instead." }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download video." }, { quoted: msg });
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

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a Facebook link or search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Downloading Facebook video... 📥" }, { quoted: msg });

                const resolvedUrl = await resolveUrlOrSearch(query);
                if (!resolvedUrl) return;

                if (resolvedUrl.includes("youtube.com") || resolvedUrl.includes("youtu.be")) {
                    const commandsList = require('../commands');
                    return await commandsList[`${settings.prefix}ytmp4`](sock, msg, resolvedUrl, { isOwner: false });
                }

                const response = await fetch(`https://apis.davidcyril.name.ng/facebook2?url=${encodeURIComponent(resolvedUrl)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.video) return await sock.sendMessage(jid, { text: "❌ Failed to parse Facebook video." }, { quoted: msg });

                const title = data.video.title || "Facebook Video";
                const downloads = data.video.downloads || [];
                const downloadUrl = downloads.find(d => d.quality === 'hd')?.downloadUrl || downloads.find(d => d.quality === 'sd')?.downloadUrl || downloads[0]?.downloadUrl;

                if (!downloadUrl) throw new Error();

                const videoBuffer = await fetchBuffer(downloadUrl);
                if (videoBuffer) {
                    try {
                        await sock.sendMessage(jid, { video: videoBuffer, mimetype: 'video/mp4', caption: `🎬 *Title:* ${title}` }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(jid, { document: videoBuffer, mimetype: 'video/mp4', fileName: `${title}.mp4`, caption: `🎬 *Title:* ${title}\n\n⚠️ _Sent as raw document due to player codec limits._` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎬 *Title:* ${title}` }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download Facebook video." }, { quoted: msg });
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

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a TikTok link or search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Downloading TikTok... 📥" }, { quoted: msg });

                const resolvedUrl = await resolveUrlOrSearch(query);
                if (!resolvedUrl) return;

                if (resolvedUrl.includes("youtube.com") || resolvedUrl.includes("youtu.be")) {
                    const commandsList = require('../commands');
                    return await commandsList[`${settings.prefix}ytmp4`](sock, msg, resolvedUrl, { isOwner: false });
                }

                const response = await fetch(`https://apis.davidcyril.name.ng/download/tiktokv2?url=${encodeURIComponent(resolvedUrl)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ Failed to parse TikTok." }, { quoted: msg });

                const title = data.result.title || "TikTok Video";
                const downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url;

                const videoBuffer = await fetchBuffer(downloadUrl);
                if (videoBuffer) {
                    try {
                        await sock.sendMessage(jid, { video: videoBuffer, mimetype: 'video/mp4', caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(jid, { document: videoBuffer, mimetype: 'video/mp4', fileName: `${title}.mp4`, caption: `🎵 *Title:* ${title}\n\n⚠️ _Sent as raw document due to player codec limits._` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { video: { url: downloadUrl }, mimetype: 'video/mp4', caption: `🎵 *Title:* ${title}` }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download TikTok." }, { quoted: msg });
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

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide an Instagram link or search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Downloading Instagram media... 📥" }, { quoted: msg });

                const resolvedUrl = await resolveUrlOrSearch(query);
                if (!resolvedUrl) return;

                if (resolvedUrl.includes("youtube.com") || resolvedUrl.includes("youtu.be")) {
                    const commandsList = require('../commands');
                    return await commandsList[`${settings.prefix}ytmp4`](sock, msg, resolvedUrl, { isOwner: false });
                }

                const response = await fetch(`https://apis.davidcyril.name.ng/instagram?url=${encodeURIComponent(resolvedUrl)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ Instagram download failed." }, { quoted: msg });

                const downloadUrl = data.result.url || data.result.video || data.result.image || data.result.download_url;
                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");

                const mediaBuffer = await fetchBuffer(downloadUrl);

                if (isVideo) {
                    if (mediaBuffer) {
                        try {
                            await sock.sendMessage(jid, { video: mediaBuffer, caption: `🎬 Instagram Video`, mimetype: 'video/mp4' }, { quoted: msg });
                        } catch (err) {
                            await sock.sendMessage(jid, { document: mediaBuffer, caption: `🎬 Instagram Video`, mimetype: 'video/mp4', fileName: 'instagram-video.mp4' }, { quoted: msg });
                        }
                    } else {
                        await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 Instagram Video`, mimetype: 'video/mp4' }, { quoted: msg });
                    }
                } else {
                    if (mediaBuffer) {
                        await sock.sendMessage(jid, { image: mediaBuffer, caption: `📸 Instagram Image` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, { image: { url: downloadUrl }, caption: `📸 Instagram Image` }, { quoted: msg });
                    }
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download Instagram media." }, { quoted: msg });
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

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a Twitter/X link or search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Downloading Twitter/X media... 📥" }, { quoted: msg });

                const resolvedUrl = await resolveUrlOrSearch(query);
                if (!resolvedUrl) return;

                if (resolvedUrl.includes("youtube.com") || resolvedUrl.includes("youtu.be")) {
                    const commandsList = require('../commands');
                    return await commandsList[`${settings.prefix}ytmp4`](sock, msg, resolvedUrl, { isOwner: false });
                }

                let downloadUrl = "";

                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/twitterV2?url=${encodeURIComponent(resolvedUrl)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            downloadUrl = data.result.video || data.result.image || data.result.download_url || data.result.link;
                        }
                    }
                } catch (e) {}

                if (!downloadUrl) {
                    const response = await fetch(`https://apis.davidcyril.name.ng/download/xdownloader?url=${encodeURIComponent(resolvedUrl)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            downloadUrl = data.result.video || data.result.image || data.result.download_url || data.result.link;
                        }
                    }
                }

                if (!downloadUrl) throw new Error();

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");
                const mediaBuffer = await fetchBuffer(downloadUrl);

                if (isVideo) {
                    if (mediaBuffer) {
                        try {
                            await sock.sendMessage(jid, { video: mediaBuffer, caption: `🎬 Twitter Video`, mimetype: 'video/mp4' }, { quoted: msg });
                        } catch (err) {
                            await sock.sendMessage(jid, { document: mediaBuffer, caption: `🎬 Twitter Video`, mimetype: 'video/mp4', fileName: 'twitter-video.mp4' }, { quoted: msg });
                        }
                    } else {
                        await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 Twitter Video`, mimetype: 'video/mp4' }, { quoted: msg });
                    }
                } else {
                    if (mediaBuffer) {
                        await sock.sendMessage(jid, { image: mediaBuffer, caption: `📸 Twitter Image` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, { image: { url: downloadUrl }, caption: `📸 Twitter Image` }, { quoted: msg });
                    }
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download Twitter/X media." }, { quoted: msg });
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

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a TikTok link or search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Downloading TikTok v2 video... 📥" }, { quoted: msg });

                const resolvedUrl = await resolveUrlOrSearch(query);
                if (!resolvedUrl) return;

                if (resolvedUrl.includes("youtube.com") || resolvedUrl.includes("youtu.be")) {
                    const commandsList = require('../commands');
                    return await commandsList[`${settings.prefix}ytmp4`](sock, msg, resolvedUrl, { isOwner: false });
                }

                const response = await fetch(`https://apis.davidcyril.name.ng/download/tiktokv2?url=${encodeURIComponent(resolvedUrl)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) throw new Error();

                const title = data.result.title || "TikTok Video";
                const downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url;

                const videoBuffer = await fetchBuffer(downloadUrl);
                if (videoBuffer) {
                    try {
                        await sock.sendMessage(jid, { video: videoBuffer, caption: `🎵 *Title:* ${title}`, mimetype: 'video/mp4' }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(jid, { document: videoBuffer, caption: `🎵 *Title:* ${title}`, mimetype: 'video/mp4', fileName: 'tiktok-video.mp4' }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎵 *Title:* ${title}`, mimetype: 'video/mp4' }, { quoted: msg });
                }
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