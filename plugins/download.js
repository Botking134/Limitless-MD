// plugins/downloaded.js
const settings = require('../settings');

// Initialize sessions securely in global memory
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};

// Recursive Helper to automatically unwrap message envelopes safely
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// Helper to safely extract any links matching a specific regex from user inputs/quoted text
function extractLink(text, regex) {
    if (!text) return null;
    const matches = text.match(/(https?:\/\/[^\s]+)/gi);
    if (!matches) return null;
    return matches.find(url => regex.test(url)) || null;
}

// Lightweight cloud uploader with multi-host redundancy for Shazam file uploads
async function uploadToCloud(buffer, mimeType) {
    const ext = mimeType.split('/')[1] || 'bin';
    const filename = `shazam_${Date.now()}.${ext}`;

    try {
        const response = await fetch(`https://pixeldrain.com/api/file/${filename}`, {
            method: 'PUT',
            body: buffer
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.id) {
                return `https://pixeldrain.com/api/file/${data.id}`;
            }
        }
    } catch (err) {
        console.error("Pixeldrain upload failed:", err.message);
    }

    try {
        const formData = new FormData();
        const blob = new Blob([buffer], { type: mimeType });
        formData.append('files[]', blob, filename);

        const response = await fetch('https://qu.ax/upload.php', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.files?.[0]?.url) {
                return data.files[0].url;
            }
        }
    } catch (err) {
        console.error("Quax upload failed:", err.message);
    }

    throw new Error("Cloud upload failed.");
}

module.exports = [
    // 1. MUSIC PLAYER (.play)
    {
        name: 'play',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a song query.\nExample: \`${settings.prefix}play Alan Walker Faded\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Searching song... 🔍" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(args)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ No results found for your song query." }, { quoted: msg });
                }

                const { title, video_url, thumbnail, duration, views, published, download_url } = data.result;

                const metadataCaption = `🎵 *SONG FOUND* 🎵\n━━━━━━━━━━━━━━━━━━━\n\n` +
                                        `📌 *Title:* ${title}\n` +
                                        `⏳ *Duration:* ${duration}\n` +
                                        `👁️ *Views:* ${views ? views.toLocaleString() : 'N/A'}\n` +
                                        `📅 *Published:* ${published || 'N/A'}`;

                await sock.sendMessage(jid, { 
                    image: { url: thumbnail }, 
                    caption: metadataCaption 
                }, { quoted: msg });

                await sock.sendMessage(jid, {
                    audio: { url: download_url },
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg });

            } catch (error) {
                console.error("Play Command Error:", error);
                await sock.sendMessage(jid, { 
                    text: "❌ Failed to download and process your song. Please try again later." 
                }, { quoted: msg });
            }
        }
    },

    // 2. YOUTUBE MP3 DOWNLOADER (.ytmp3)
    {
        name: 'ytmp3',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let url = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!url && quoted) {
                const rawContent = getRawMessage(quoted);
                url = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
            if (!url || !ytRegex.test(url)) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid YouTube link.\nExample: \`${settings.prefix}ytmp3 https://youtube.com/watch?v=qdpXxGPqW-Y\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Fetching YouTube audio... 📥" }, { quoted: msg });

                let downloadUrl = "";
                let title = "YouTube Audio";

                // Attempt 1: Query primary /youtube/mp33 endpoint
                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/youtube/mp33?url=${encodeURIComponent(url)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            title = data.result.title || "YouTube Audio";
                            downloadUrl = data.result.mp3 || data.result.download_url || data.result.link;
                        }
                    }
                } catch (e) {
                    console.warn("Primary ytmp33 failed, trying fallback...", e.message);
                }

                // Attempt 2: Auto redirect/fallback to /download/ytmp3 endpoint
                if (!downloadUrl) {
                    const response = await fetch(`https://apis.davidcyril.name.ng/download/ytmp3?url=${encodeURIComponent(url)}`);
                    if (!response.ok) {
                        throw new Error(`Fallback API status code ${response.status}`);
                    }
                    const data = await response.json();
                    if (data.status && data.result) {
                        title = data.result.title || "YouTube Audio";
                        downloadUrl = data.result.mp3 || data.result.download_url || data.result.link;
                    }
                }

                if (!downloadUrl) {
                    throw new Error("Unable to fetch audio download stream from both endpoints.");
                }

                await sock.sendMessage(jid, {
                    audio: { url: downloadUrl },
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg });

            } catch (error) {
                console.error("YTMP3 Command Error:", error);
                await sock.sendMessage(jid, { 
                    text: "❌ Failed to download audio. Ensure the link is valid and try again." 
                }, { quoted: msg });
            }
        }
    },

    // 3. YOUTUBE MP4 DOWNLOADER (.ytmp4)
    {
        name: 'ytmp4',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let url = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!url && quoted) {
                const rawContent = getRawMessage(quoted);
                url = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
            if (!url || !ytRegex.test(url)) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid YouTube link.\nExample: \`${settings.prefix}ytmp4 https://youtube.com/watch?v=qdpXxGPqW-Y\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Fetching YouTube video... 🎬" }, { quoted: msg });

                let downloadUrl = "";
                let title = "YouTube Video";

                // Attempt 1: Query primary /youtube/mp444 endpoint
                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/youtube/mp444?url=${encodeURIComponent(url)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            title = data.result.title || "YouTube Video";
                            downloadUrl = data.result.mp4 || data.result.download_url || data.result.link;
                        }
                    }
                } catch (e) {
                    console.warn("Primary ytmp444 failed, trying fallback...", e.message);
                }

                // Attempt 2: Auto redirect/fallback to /download/ytmp4 endpoint
                if (!downloadUrl) {
                    const response = await fetch(`https://apis.davidcyril.name.ng/download/ytmp4?url=${encodeURIComponent(url)}`);
                    if (!response.ok) {
                        throw new Error(`Fallback API status code ${response.status}`);
                    }
                    const data = await response.json();
                    if (data.status && data.result) {
                        title = data.result.title || "YouTube Video";
                        downloadUrl = data.result.mp4 || data.result.download_url || data.result.link;
                    }
                }

                if (!downloadUrl) {
                    throw new Error("Unable to fetch video download stream from both endpoints.");
                }

                await sock.sendMessage(jid, {
                    video: { url: downloadUrl },
                    caption: `🎥 *Title:* ${title}`,
                    mimetype: 'video/mp4'
                }, { quoted: msg });

            } catch (error) {
                console.error("YTMP4 Command Error:", error);
                await sock.sendMessage(jid, { 
                    text: "❌ Failed to download video. Ensure the link is valid and try again." 
                }, { quoted: msg });
            }
        }
    },

    // 4. IMAGE SEARCH DOWNLOADER (.img)
    {
        name: 'img',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a search query.\nExample: \`${settings.prefix}img cute cats 3\`` 
                }, { quoted: msg });
            }

            const parts = args.trim().split(' ');
            const lastPart = parts[parts.length - 1];
            let count = parseInt(lastPart);
            let query = args;

            if (!isNaN(count)) {
                parts.pop();
                query = parts.join(' ').trim();
            } else {
                count = 1; 
            }

            if (count < 1) count = 1;
            if (count > 5) count = 5;

            try {
                await sock.sendMessage(jid, { text: `Searching for "${query}"... 📷` }, { quoted: msg });

                const response = await fetch(`https://api.fdci.se/rep.php?gambar=${encodeURIComponent(query)}`);
                if (!response.ok) {
                    throw new Error(`API status code ${response.status}`);
                }

                const urls = await response.json();
                if (!Array.isArray(urls) || urls.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No images found for your query." }, { quoted: msg });
                }

                const selectedUrls = urls.slice(0, count);
                for (const imgUrl of selectedUrls) {
                    await sock.sendMessage(jid, { image: { url: imgUrl } });
                }

            } catch (error) {
                console.error("Image Command Error:", error);
                await sock.sendMessage(jid, { 
                    text: "❌ Failed to search images. Try again later." 
                }, { quoted: msg });
            }
        }
    },

    // 5. INTERACTIVE SONG SEARCHER (.song)
    {
        name: 'song',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a song query.\nExample: \`${settings.prefix}song Alan Walker Faded\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Searching song index... 🔍" }, { quoted: msg });

                const yts = require('yt-search');
                const results = await yts(args);
                const videos = results.videos || [];

                if (videos.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No search results found for your song query." }, { quoted: msg });
                }

                const selectedResults = videos.slice(0, 10);

                let listCaption = `🎵 *SONG SEARCH RESULTS* 🎵\n`;
                listCaption += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                listCaption += `🔍 *Query:* "${args}"\n\n`;

                selectedResults.forEach((video, index) => {
                    const durationText = video.duration || video.timestamp || "N/A";
                    listCaption += `${index + 1}. *${video.title}* (${durationText})\n`;
                });

                listCaption += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                listCaption += `💡 *Reply directly to this list message with the number of the song you want to download.* 📥`;

                const prompt = await sock.sendMessage(jid, { text: listCaption }, { quoted: msg });

                global.songSessions[prompt.key.id] = {
                    query: args,
                    results: selectedResults.map(v => ({
                        title: v.title,
                        url: v.url
                    }))
                };

            } catch (error) {
                console.error("Song Search Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to complete song search. Try again later." }, { quoted: msg });
            }
        }
    },

    // 6. VIDEO DOWNPARSER (.video)
    {
        name: 'video',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a video search query.\nExample: \`${settings.prefix}video Alan Walker Faded\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Searching video index... 🎥" }, { quoted: msg });

                const yts = require('yt-search');
                const results = await yts(args);
                const videos = results.videos || [];

                if (videos.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No video results found for your query." }, { quoted: msg });
                }

                const firstVideo = videos[0];
                const videoUrl = firstVideo.url;

                const downloadResponse = await fetch(`https://apis.davidcyril.name.ng/youtube?url=${encodeURIComponent(videoUrl)}`);
                if (!downloadResponse.ok) {
                    throw new Error(`Downloader API returned status code ${downloadResponse.status}`);
                }

                const dlData = await downloadResponse.json();
                if (!dlData.status || !dlData.result) {
                    return await sock.sendMessage(jid, { text: "❌ Failed to process video download parameters." }, { quoted: msg });
                }

                const downloadUrl = dlData.result.mp4 || dlData.result.download_url;
                if (!downloadUrl) {
                    throw new Error("No direct MP4 download link found.");
                }

                const duration = firstVideo.duration || firstVideo.timestamp || "N/A";
                const caption = `🎥 *VIDEO FOUND* 🎥\n━━━━━━━━━━━━━━━━━━━\n\n` +
                                `📌 *Title:* ${firstVideo.title}\n` +
                                `⏳ *Duration:* ${duration}\n` +
                                `👁️ *Views:* ${firstVideo.views ? firstVideo.views.toLocaleString() : 'N/A'}`;

                await sock.sendMessage(jid, {
                    video: { url: downloadUrl },
                    caption: caption,
                    mimetype: 'video/mp4'
                }, { quoted: msg });

            } catch (error) {
                console.error("Video Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download and process video. Try again later." }, { quoted: msg });
            }
        }
    },

    // 7. FACEBOOK VIDEO DOWNLOADER (.fb / .facebook)
    {
        name: 'fb',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const fbregex = /^(https?:\/\/)?(www\.)?(fb\.com|facebook\.?com|fb\.watch)\/.+/i;
            const url = extractLink(targetUrl, fbregex);

            if (!url) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid Facebook video link.\nExample: \`${settings.prefix}fb https://facebook.com/.../posts/...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading Facebook video... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/facebook2?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.video) {
                    return await sock.sendMessage(jid, { text: "❌ Facebook video parse failed or link is currently unsupported." }, { quoted: msg });
                }

                const title = data.video.title || "Facebook Video";
                const downloads = data.video.downloads || [];

                const hd = downloads.find(d => d.quality && d.quality.toLowerCase() === 'hd');
                const sd = downloads.find(d => d.quality && d.quality.toLowerCase() === 'sd');
                const downloadUrl = hd?.downloadUrl || sd?.downloadUrl || downloads[0]?.downloadUrl;

                if (!downloadUrl) {
                    throw new Error("No download URL found in API response.");
                }

                await sock.sendMessage(jid, {
                    video: { url: downloadUrl },
                    caption: `🎬 *Title:* ${title}`,
                    mimetype: 'video/mp4'
                }, { quoted: msg });

            } catch (error) {
                console.error("Facebook Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download Facebook video. Ensure the video is public and try again." }, { quoted: msg });
            }
        }
    },

    // 8. TIKTOK VIDEO DOWNLOADER (.tt / .tiktok)
    {
        name: 'tt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const ttregex = /https:\/\/(?:www\.|vm\.|m\.|vt\.)?tiktok\.com\/.+/i;
            const url = extractLink(targetUrl, ttregex);

            if (!url) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid TikTok link.\nExample: \`${settings.prefix}tt https://vm.tiktok.com/...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading TikTok video... 📥" }, { quoted: msg });

                // 1. Resolve short links (vm.tiktok.com) to the full expanded URL on the server first
                let longUrl = url;
                try {
                    const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' });
                    if (headRes.url) {
                        longUrl = headRes.url;
                    }
                } catch (redirectErr) {
                    console.warn("Failed to resolve TikTok redirect, using original URL:", redirectErr.message);
                }

                let downloadUrl = "";
                let title = "TikTok Video";

                // Attempt 1: Upgraded TikSave v2 API (Unified Endpoint)
                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/tiktok2?url=${encodeURIComponent(longUrl)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.video) {
                            title = data.video.title || "TikTok Video";
                            const downloads = data.video.downloads || [];
                            
                            const hd = downloads.find(d => d.quality && d.quality.toLowerCase() === 'hd');
                            const sd = downloads.find(d => d.quality && d.quality.toLowerCase() === 'sd');
                            downloadUrl = hd?.downloadUrl || sd?.downloadUrl || downloads[0]?.downloadUrl;
                        }
                    }
                } catch (err) {
                    console.warn("TikSave v2 API failed, trying legacy route...", err.message);
                }

                // Attempt 2: Legacy TikTok API (Fallback)
                if (!downloadUrl) {
                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/tiktok?url=${encodeURIComponent(longUrl)}`);
                        if (response.ok) {
                            const data = await response.json();
                            const result = data.result || data;
                            if (result) {
                                title = result.title || "TikTok Video";
                                downloadUrl = result.video || result.video_url || result.mp4 || result.download_url || result.url;
                            }
                        }
                    } catch (err) {
                        console.warn("Legacy TikTok API failed, trying Kord/TikSave route...", err.message);
                    }
                }

                // Attempt 3: Kord / TikSave Native API structure check
                if (!downloadUrl) {
                    try {
                        const response = await fetch(`https://api.kord.live/api/tiktok?url=${encodeURIComponent(longUrl)}`);
                        if (response.ok) {
                            const data = await response.json();
                            if (data && data.success && data.data) {
                                title = data.data.title || "TikTok Video";
                                if (Array.isArray(data.data.downloadLinks) && data.data.downloadLinks.length > 0) {
                                    downloadUrl = data.data.downloadLinks[0].link;
                                }
                            }
                        }
                    } catch (err) {
                        console.warn("Kord API route failed, trying multi-platform scraper...", err.message);
                    }
                }

                // Attempt 4: Multi-Platform Scraper (Third-Party Fallback)
                if (!downloadUrl) {
                    try {
                        const response = await fetch(`https://api.sandipbbaruwal.onrender.com/tiktok?url=${encodeURIComponent(longUrl)}`);
                        if (response.ok) {
                            const data = await response.json();
                            downloadUrl = data.video || data.url || data.download_url;
                        }
                    } catch (err) {
                        console.error("All TikTok API endpoints failed:", err.message);
                    }
                }

                if (!downloadUrl) {
                    return await sock.sendMessage(jid, { text: "❌ Failed to parse TikTok download links from all available APIs." }, { quoted: msg });
                }

                await sock.sendMessage(jid, {
                    video: { url: downloadUrl },
                    caption: `🎵 *Title:* ${title}`,
                    mimetype: 'video/mp4'
                }, { quoted: msg });

            } catch (error) {
                console.error("TikTok Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to complete TikTok download. Try again later." }, { quoted: msg });
            }
        }
    },

    // 9. MEDIAFIRE FILE DOWNLOADER (.mediafire)
    {
        name: 'mediafire',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const mfregex = /^(https?:\/\/)?(www\.)?(mediafire\.com)\/.+/i;
            const url = extractLink(targetUrl, mfregex);

            if (!url) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid MediaFire download link.\nExample: \`${settings.prefix}mediafire https://www.mediafire.com/file/...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Retrieving MediaFire file parameters... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/mediafire?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ MediaFire link parsing failed." }, { quoted: msg });
                }

                const filename = data.result.filename || data.result.name || "MediaFire File";
                const size = data.result.size || "Unknown Size";
                const downloadUrl = data.result.direct_url || data.result.download_url || data.result.link;

                if (!downloadUrl) {
                    throw new Error("Direct download link is missing in response parameters.");
                }

                await sock.sendMessage(jid, {
                    document: { url: downloadUrl },
                    fileName: filename,
                    caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}`
                }, { quoted: msg });

            } catch (error) {
                console.error("MediaFire Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download MediaFire file. Ensure the file size is reasonable and try again." }, { quoted: msg });
            }
        }
    },

    // 10. DIRECT APK DOWNLOADER (.apk)
    {
        name: 'apk',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide an application name.\nExample: \`${settings.prefix}apk WhatsApp\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: `Searching and downloading APK for "${args}"... 🔍` }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/download/apk?query=${encodeURIComponent(args)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result || !data.result.download_url) {
                    return await sock.sendMessage(jid, { text: "❌ Application not found on the APK catalog." }, { quoted: msg });
                }

                const { name, package: pkgName, size, version, download_url } = data.result;

                const cap = `📦 *APK COMPLETED* 📦\n━━━━━━━━━━━━━━━━━━━\n\n` +
                            `📌 *Name:* ${name}\n` +
                            `⚙️ *Package Name:* ${pkgName || "N/A"}\n` +
                            `🔄 *Version:* ${version || "N/A"}\n` +
                            `⚖️ *Size:* ${size || "Unknown Size"}`;

                await sock.sendMessage(jid, {
                    document: { url: download_url },
                    mimetype: "application/vnd.android.package-archive",
                    fileName: `${name}.apk`,
                    caption: cap
                }, { quoted: msg });

            } catch (error) {
                console.error("APK Command Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to download APK: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 11. INTERACTIVE APK SEARCHER (.apksearch)
    {
        name: 'apksearch',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide an application search query.\nExample: \`${settings.prefix}apksearch WhatsApp\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Searching app catalog... 🔍" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/apksearch?query=${encodeURIComponent(args)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!Array.isArray(data) || data.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No matching applications found." }, { quoted: msg });
                }

                const selectedResults = data.slice(0, 10);

                let listCaption = `📦 *APK SEARCH RESULTS* 📦\n`;
                listCaption += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                listCaption += `🔍 *Query:* "${args}"\n\n`;

                selectedResults.forEach((app, index) => {
                    listCaption += `${index + 1}. *${app.name}* (${app.id || 'N/A'})\n`;
                });

                listCaption += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                listCaption += `💡 *Reply directly to this list message with the number of the app you want to download.* 📥`;

                const prompt = await sock.sendMessage(jid, { text: listCaption }, { quoted: msg });

                global.apkSessions[prompt.key.id] = {
                    query: args,
                    results: selectedResults.map(app => ({
                        name: app.name,
                        id: app.id
                    }))
                };

            } catch (error) {
                console.error("APKSearch Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to search application index. Try again later." }, { quoted: msg });
            }
        }
    },

    // 12. AUDIO RECOGNIZER & SUMMONER (.shazam)
    {
        name: 'shazam',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return await sock.sendMessage(jid, { 
                    text: "❌ Please reply directly to an audio voice note, file, or video to identify the track." 
                }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);
            let mediaMessage = null;
            let mediaType = "";

            if (rawContent?.audioMessage) {
                mediaMessage = rawContent.audioMessage;
                mediaType = "audio";
            } else if (rawContent?.videoMessage) {
                mediaMessage = rawContent.videoMessage;
                mediaType = "video";
            }

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Quoted message must be a valid audio voice note, song, or video." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Downloading and listening to the track... 🎧🌀" }, { quoted: msg });

                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const mimeType = mediaMessage.mimetype || (mediaType === "audio" ? "audio/ogg" : "video/mp4");
                const uploadedUrl = await uploadToCloud(buffer, mimeType);

                const response = await fetch(`https://apis.davidcyril.name.ng/shazam?url=${encodeURIComponent(uploadedUrl)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Unable to identify the song. Ensure the audio is clear." }, { quoted: msg });
                }

                const { title, artist, album, release_date, genre } = data.result;

                const recognitionCaption = `🎧 *SHAZAM RECOGNITION COMPLETE* 🎧\n` +
                                           `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                           `📌 *Title:* ${title || "Unknown"}\n` +
                                           `👤 *Artist:* ${artist || "Unknown"}\n` +
                                           `📀 *Album:* ${album || "N/A"}\n` +
                                           `📅 *Release:* ${release_date || "N/A"}\n` +
                                           `🎵 *Genre:* ${genre || "N/A"}\n\n` +
                                           `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                           `💡 *Reply directly to this recognition message with "1" or "download" to automatically fetch and play this track!* 📥`;

                const prompt = await sock.sendMessage(jid, { text: recognitionCaption }, { quoted: msg });

                global.shazamSessions[prompt.key.id] = {
                    title: title,
                    artist: artist
                };

            } catch (error) {
                console.error("Shazam Command Error:", error);
                await sock.sendMessage(jid, { text: `❌ Shazam recognition failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 13. SONG LYRICS FINDER (.lyrics)
    {
        name: 'lyrics',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a song title and artist.\nExample: \`${settings.prefix}lyrics Alan Walker Faded\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Retrieving song lyrics... 📝" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/lyrics?query=${encodeURIComponent(args)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Lyrics not found for this query." }, { quoted: msg });
                }

                const title = data.result.title || "Lyrics Result";
                const artist = data.result.artist || "Unknown Artist";
                const lyrics = data.result.lyrics || data.result.lyricsText || "";

                if (!lyrics) {
                    return await sock.sendMessage(jid, { text: "❌ The lyrics are currently blank on the server index." }, { quoted: msg });
                }

                const lyricsText = `📝 *LYRICS DETECTED* 📝\n` +
                                   `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                   `🎵 *Song:* ${title}\n` +
                                   `👤 *Artist:* ${artist}\n\n` +
                                   `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                   `${lyrics}`;

                await sock.sendMessage(jid, { text: lyricsText }, { quoted: msg });

            } catch (error) {
                console.error("Lyrics Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to fetch song lyrics. Try again later." }, { quoted: msg });
            }
        }
    },

    // 14. GOOGLE DRIVE DOWNLOADER (.gdrive)
    {
        name: 'gdrive',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const gdRegex = /^(https?:\/\/)?(drive\.google\.com)\/.+/i;
            const url = extractLink(targetUrl, gdRegex);

            if (!url) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid Google Drive link.\nExample: \`${settings.prefix}gdrive https://drive.google.com/file/d/...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Retrieving Google Drive download stream... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/gdrive?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Failed to parse Google Drive files parameters." }, { quoted: msg });
                }

                const filename = data.result.filename || data.result.name || "Drive_File";
                const size = data.result.size || "Unknown Size";
                const downloadUrl = data.result.direct_url || data.result.download_url || data.result.link;

                if (!downloadUrl) {
                    throw new Error("No download link found in response parameters.");
                }

                await sock.sendMessage(jid, {
                    document: { url: downloadUrl },
                    fileName: filename,
                    caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}`
                }, { quoted: msg });

            } catch (error) {
                console.error("GDrive Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download Google Drive file. Ensure file parameters are accessible." }, { quoted: msg });
            }
        }
    },

    // 15. GITHUB REPOSITORY CLONER (.gitclone)
    {
        name: 'gitclone',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const gcregex = /^(https?:\/\/)?(www\.)?(github\.com)\/.$/i;
            const url = extractLink(targetUrl, gcregex);

            if (!url) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid GitHub repository link.\nExample: \`${settings.prefix}gitclone https://github.com/Botking134/Limitless-MD\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Packing GitHub repository zipball... ⏳" }, { quoted: msg });

                const pathParts = url.split("/");
                const user = pathParts[3];
                const repo = pathParts[4]?.replace(".git", "");

                if (!user || !repo) {
                    throw new Error("Invalid repo path format");
                }

                const downloadUrl = `https://api.github.com/repos/${user}/${repo}/zipball`;

                await sock.sendMessage(jid, {
                    document: { url: downloadUrl },
                    mimetype: "application/zip",
                    fileName: `${repo}-master.zip`,
                    caption: `📦 *GitHub Repository:* \`${user}/${repo}\``
                }, { quoted: msg });

            } catch (error) {
                console.error("GitClone Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to clone repository. Ensure the repository is public." }, { quoted: msg });
            }
        }
    },

    // 16. PINTEREST DOWNPARSER (.pinterest / .pint)
    {
        name: 'pinterest',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const pinregex = /^(https?:\/\/)?(www\.)?(pin\.it|pinterest\.?com)\/.+/i;
            const url = extractLink(targetUrl, pinregex);

            if (!url) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid Pinterest link.\nExample: \`${settings.prefix}pinterest https://pin.it/...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading Pinterest media... 📥" }, { quoted: msg });

                // Upgraded to use the official David Cyril Pinterest endpoint
                const response = await fetch(`https://apis.davidcyril.name.ng/download/pinterest?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Failed to parse Pinterest media links." }, { quoted: msg });
                }

                const downloadUrl = data.result.video || data.result.image || data.result.download_url;
                if (!downloadUrl) {
                    throw new Error("No download media found inside parameters.");
                }

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || data.result.video;

                if (isVideo) {
                    await sock.sendMessage(jid, {
                        video: { url: downloadUrl },
                        caption: `🎬 *Title:* Pinterest Video`,
                        mimetype: 'video/mp4'
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, {
                        image: { url: downloadUrl },
                        caption: `📸 *Title:* Pinterest Image`
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error("Pinterest Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to complete Pinterest download. Try again later." }, { quoted: msg });
            }
        }
    },

    // 17. SUBTITLE FILE DOWNLOADER (.subtitle)
    {
        name: 'subtitle',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a movie name.\nExample: \`${settings.prefix}subtitle Avengers Doomsday\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Searching English subtitles... 🎬" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/subtitle?q=${encodeURIComponent(args)}`);
                if (!response.ok) {
                    throw new Error(`API status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result || !data.result.downloadLinks) {
                    return await sock.sendMessage(jid, { text: "❌ Subtitles not found for this movie query." }, { quoted: msg });
                }

                const links = data.result.downloadLinks;
                const englishSub = links.find(d => d.language.toLowerCase().includes("english"));

                if (!englishSub || !englishSub.url) {
                    return await sock.sendMessage(jid, { text: "❌ English subtitles not available for this movie query." }, { quoted: msg });
                }

                const movieTitle = data.result.title || args;
                const caption = `🎬 *Subtitle Downloader Completed*\n\n` +
                                `📌 *Title:* ${movieTitle}\n` +
                                `🌐 *Language:* English`;

                await sock.sendMessage(jid, {
                    document: { url: englishSub.url },
                    mimetype: "application/x-subrip",
                    fileName: `${movieTitle}-en.srt`,
                    caption: caption
                }, { quoted: msg });

            } catch (error) {
                console.error("Subtitle Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to retrieve subtitles. Try again later." }, { quoted: msg });
            }
        }
    },

    // 18. DOCUMENT-FORMAT YOUTUBE LINK AUDIO/VIDEO DOWNLOADER (.ytmp3doc / .ytmp4doc)
    {
        name: 'ytmp3doc',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let url = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!url && quoted) {
                const rawContent = getRawMessage(quoted);
                url = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
            if (!url || !ytRegex.test(url)) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid YouTube link.\nExample: \`${settings.prefix}ytmp3doc https://youtube.com/watch?v=...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Fetching YouTube audio as document... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/youtube?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Failed to parse media details." }, { quoted: msg });
                }

                const title = data.result.title || "YouTube Audio";
                const downloadUrl = data.result.mp3 || data.result.download_url;

                if (!downloadUrl) {
                    throw new Error("No download stream URL found.");
                }

                await sock.sendMessage(jid, {
                    document: { url: downloadUrl },
                    mimetype: 'audio/mpeg',
                    fileName: `${title}.mp3`,
                    caption: `🎵 *Title:* ${title}`
                }, { quoted: msg });

            } catch (error) {
                console.error("YTMP3Doc Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download audio document. Try again later." }, { quoted: msg });
            }
        }
    },

    // 19. DOCUMENT-FORMAT YOUTUBE SEARCH AUDIO/VIDEO DOWNLOADER (.playdoc / .videodoc)
    {
        name: 'playdoc',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a song query.\nExample: \`${settings.prefix}playdoc Alan Walker Faded\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Searching song index for document... 🔍" }, { quoted: msg });

                const yts = require('yt-search');
                const results = await yts(args);
                const videos = results.videos || [];

                if (videos.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ Song not found." }, { quoted: msg });
                }

                const firstSong = videos[0];

                const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(firstSong.title)}`);
                if (!response.ok) {
                    throw new Error(`API status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Song not found." }, { quoted: msg });
                }

                const { title, download_url } = data.result;

                await sock.sendMessage(jid, {
                    document: { url: download_url },
                    mimetype: 'audio/mpeg',
                    fileName: `${title}.mp3`,
                    caption: `🎵 *Title:* ${title}`
                }, { quoted: msg });

            } catch (error) {
                console.error("PlayDoc Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to process audio document download. Try again later." }, { quoted: msg });
            }
        }
    },

    // 20. INSTAGRAM DOWNLOADER (.ig / .instagram)
    {
        name: 'ig',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const igregex = /^(https?:\/\/)?(www\.)?(ig\.com|instagram\.?com)\/.+/i;
            const url = extractLink(targetUrl, igregex);

            if (!url) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid Instagram link.\nExample: \`${settings.prefix}ig https://www.instagram.com/p/...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading Instagram media... 📥" }, { quoted: msg });

                // Query David Cyril's official /instagram endpoint directly
                const response = await fetch(`https://apis.davidcyril.name.ng/instagram?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Instagram download failed or link is currently unsupported." }, { quoted: msg });
                }

                const downloadUrl = data.result.url || data.result.video || data.result.image || data.result.download_url;
                if (!downloadUrl) {
                    throw new Error("No download stream URL found in API response.");
                }

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");

                if (isVideo) {
                    await sock.sendMessage(jid, {
                        video: { url: downloadUrl },
                        caption: `🎬 *Title:* Instagram Video`,
                        mimetype: 'video/mp4'
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, {
                        image: { url: downloadUrl },
                        caption: `📸 *Title:* Instagram Image`
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error("Instagram Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download Instagram media. Ensure the account is public and try again." }, { quoted: msg });
            }
        }
    },

    // 21. SPOTIFY AUDIO DOWNLOADER (.spotify)
    {
        name: 'spotify',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a Spotify link or song query.\nExample: \`${settings.prefix}spotify Alan Walker Faded\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Searching and fetching Spotify track... 📥" }, { quoted: msg });

                // Query David Cyril's Spotify v1 endpoint
                const response = await fetch(`https://apis.davidcyril.name.ng/spotifydl?query=${encodeURIComponent(args)}`);
                if (!response.ok) {
                    throw new Error(`API status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    throw new Error("No track details found inside parameters.");
                }

                const title = data.result.title || "Spotify Track";
                const artist = data.result.artist || "Unknown Artist";
                const downloadUrl = data.result.download_url || data.result.link;

                if (!downloadUrl) {
                    throw new Error("Download link empty in API response.");
                }

                await sock.sendMessage(jid, {
                    audio: { url: downloadUrl },
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg });

            } catch (error) {
                console.error("Spotify Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download Spotify track. Try again later." }, { quoted: msg });
            }
        }
    },

    // 22. SPOTIFY AUDIO DOWNLOADER V2 (.spotify2)
    {
        name: 'spotify2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a Spotify link or song query.\nExample: \`${settings.prefix}spotify2 Alan Walker Faded\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Searching and fetching Spotify track v2... 📥" }, { quoted: msg });

                // Query David Cyril's Spotify v2 endpoint
                const response = await fetch(`https://apis.davidcyril.name.ng/spotifydl2?query=${encodeURIComponent(args)}`);
                if (!response.ok) {
                    throw new Error(`API status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    throw new Error("No track details found inside parameters.");
                }

                const title = data.result.title || "Spotify Track";
                const artist = data.result.artist || "Unknown Artist";
                const downloadUrl = data.result.download_url || data.result.link;

                if (!downloadUrl) {
                    throw new Error("Download link empty in API response.");
                }

                await sock.sendMessage(jid, {
                    audio: { url: downloadUrl },
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg });

            } catch (error) {
                console.error("Spotify2 Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download Spotify track. Try again later." }, { quoted: msg });
            }
        }
    },

    // 23. WEBSITE DOWNLOADER & PACKER (.web)
    {
        name: 'web',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a website URL.\nExample: \`${settings.prefix}web https://google.com\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading and packing website assets... 🌐⏳" }, { quoted: msg });

                // Query David Cyril's web downloader endpoint directly
                const response = await fetch(`https://apis.davidcyril.name.ng/tools/downloadweb?url=${encodeURIComponent(args)}`);
                if (!response.ok) {
                    throw new Error(`API status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    throw new Error("Website packaging failed.");
                }

                const filename = data.result.filename || "website_source.zip";
                const downloadUrl = data.result.download_url || data.result.link;

                if (!downloadUrl) {
                    throw new Error("No download link returned by server.");
                }

                await sock.sendMessage(jid, {
                    document: { url: downloadUrl },
                    mimetype: "application/zip",
                    fileName: filename,
                    caption: `📁 *Source Website:* \`${args}\``
                }, { quoted: msg });

            } catch (error) {
                console.error("Web Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to package website. Ensure the URL is valid and reachable." }, { quoted: msg });
            }
        }
    },

    // 24. TWITTER VIDEO & IMAGE DOWNLOADER V2 (.x2 / .xdl2)
    {
        name: 'x2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const xregex = /^(https?:\/\/)?(www\.)?(x\.com|twitter\.?com)\/.+/i;
            const url = extractLink(targetUrl, xregex);

            if (!url) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid Twitter/X video link.\nExample: \`${settings.prefix}x2 https://x.com/...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading Twitter/X media... 📥" }, { quoted: msg });

                let downloadUrl = "";

                // Attempt 1: Upgraded Twitter v2 API
                try {
                    const response = await fetch(`https://apis.davidcyril.name.ng/twitterV2?url=${encodeURIComponent(url)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            downloadUrl = data.result.video || data.result.image || data.result.download_url || data.result.link;
                        }
                    }
                } catch (e) {
                    console.warn("TwitterV2 failed, trying fallback xdownloader...", e.message);
                }

                // Attempt 2: Auto redirect/fallback to alternate xdownloader endpoint
                if (!downloadUrl) {
                    const response = await fetch(`https://apis.davidcyril.name.ng/download/xdownloader?url=${encodeURIComponent(url)}`);
                    if (!response.ok) {
                        throw new Error(`Fallback API status code ${response.status}`);
                    }
                    const data = await response.json();
                    if (data.status && data.result) {
                        downloadUrl = data.result.video || data.result.image || data.result.download_url || data.result.link;
                    }
                }

                if (!downloadUrl) {
                    throw new Error("Unable to parse Twitter media from both endpoints.");
                }

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || downloadUrl.includes("video");

                if (isVideo) {
                    await sock.sendMessage(jid, {
                        video: { url: downloadUrl },
                        caption: `🎬 *Title:* Twitter Video`,
                        mimetype: 'video/mp4'
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, {
                        image: { url: downloadUrl },
                        caption: `📸 *Title:* Twitter Image`
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error("Twitter Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download Twitter/X media. Try again later." }, { quoted: msg });
            }
        }
    },

    // 25. YOUTUBE MULTI-FORMAT DOWNLOADER V3 (.yt)
    {
        name: 'yt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let url = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!url && quoted) {
                const rawContent = getRawMessage(quoted);
                url = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
            if (!url || !ytRegex.test(url)) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid YouTube link.\nExample: \`${settings.prefix}yt https://youtube.com/watch?v=...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Fetching YouTube media v3... 📥" }, { quoted: msg });

                // Query David Cyril's official /download/ytv3 endpoint directly
                const response = await fetch(`https://apis.davidcyril.name.ng/download/ytv3?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    throw new Error("YouTube v3 parse failed.");
                }

                const title = data.result.title || "YouTube Media";
                const downloadUrl = data.result.mp4 || data.result.video || data.result.mp3 || data.result.download_url;

                if (!downloadUrl) {
                    throw new Error("No media download stream found.");
                }

                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || data.result.mp4;

                if (isVideo) {
                    await sock.sendMessage(jid, {
                        video: { url: downloadUrl },
                        caption: `🎥 *Title:* ${title}`,
                        mimetype: 'video/mp4'
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, {
                        audio: { url: downloadUrl },
                        mimetype: 'audio/mpeg',
                        ptt: false
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error("YT Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to fetch YouTube media. Ensure the link is valid and try again." }, { quoted: msg });
            }
        }
    },

    // 26. TIKTOK VIDEO DOWNLOADER V2 (.tt2)
    {
        name: 'tt2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            const ttregex = /https:\/\/(?:www\.|vm\.|m\.|vt\.)?tiktok\.com\/.+/i;
            const url = extractLink(targetUrl, ttregex);

            if (!url) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a valid TikTok link.\nExample: \`${settings.prefix}tt2 https://vm.tiktok.com/...\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Downloading TikTok v2 video... 📥" }, { quoted: msg });

                // 1. Resolve short links (vm.tiktok.com) to full expanded URL first
                let longUrl = url;
                try {
                    const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' });
                    if (headRes.url) {
                        longUrl = headRes.url;
                    }
                } catch (redirectErr) {
                    console.warn("Failed to resolve TikTok redirect:", redirectErr.message);
                }

                // Query David Cyril's official /download/tiktokv2 endpoint directly
                const response = await fetch(`https://apis.davidcyril.name.ng/download/tiktokv2?url=${encodeURIComponent(longUrl)}`);
                if (!response.ok) {
                    throw new Error(`API status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    throw new Error("No download media found inside parameters.");
                }

                const title = data.result.title || "TikTok Video";
                const downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url;

                await sock.sendMessage(jid, {
                    video: { url: downloadUrl },
                    caption: `🎵 *Title:* ${title}`,
                    mimetype: 'video/mp4'
                }, { quoted: msg });

            } catch (error) {
                console.error("TikTok v2 Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to complete TikTok v2 download. Try again later." }, { quoted: msg });
            }
        }
    }
];

// Add structural aliases safely via external array collector
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'fb') {
        aliases.push({ ...cmd, name: 'facebook' });
    }
    if (cmd.name === 'tt') {
        aliases.push({ ...cmd, name: 'tiktok' });
    }
    if (cmd.name === 'ig') {
        aliases.push({ ...cmd, name: 'instagram' });
    }
    if (cmd.name === 'gitclone') {
        aliases.push({ ...cmd, name: 'gitdl' });
    }
    if (cmd.name === 'pinterest') {
        aliases.push({ ...cmd, name: 'pint' });
    }
    if (cmd.name === 'x2') {
        aliases.push({ ...cmd, name: 'xdl2' });
    }
});
module.exports.push(...aliases);