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
                                        `📅 *Published:* ${published || 'N/A'}\n\n` +
                                        `_Channelling audio from upstream... Please wait._ 🤞`;

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

                const response = await fetch(`https://apis.davidcyril.name.ng/youtube?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Failed to parse media details from this link." }, { quoted: msg });
                }

                const title = data.result.title || "YouTube Audio";
                const downloadUrl = data.result.mp3 || data.result.download_url;

                if (!downloadUrl) {
                    throw new Error("Download link empty in API response");
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

                const response = await fetch(`https://apis.davidcyril.name.ng/youtube?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Failed to parse media details from this link." }, { quoted: msg });
                }

                const title = data.result.title || "YouTube Video";
                const downloadUrl = data.result.mp4 || data.result.download_url;

                if (!downloadUrl) {
                    throw new Error("Video download link empty in API response");
                }

                await sock.sendMessage(jid, {
                    video: { url: downloadUrl },
                    caption: `🎥 *Title:* ${title}\n\n_Enjoy your video!_`,
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

                // Loaded dynamically to prevent boot crashes if package is resolving
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

                // Loaded dynamically to prevent boot crashes if package is resolving
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
                                `👁️ *Views:* ${firstVideo.views ? firstVideo.views.toLocaleString() : 'N/A'}\n\n` +
                                `_Channelling video from upstream... Please wait._ 🤞`;

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

                const response = await fetch(`https://apis.davidcyril.name.ng/facebook?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Facebook video parse failed or link is currently unsupported." }, { quoted: msg });
                }

                const downloadUrl = data.result.hd || data.result.sd || data.result.video_url || data.result.download_url;

                if (!downloadUrl) {
                    throw new Error("No download URL found in API response.");
                }

                await sock.sendMessage(jid, {
                    video: { url: downloadUrl },
                    caption: `🎬 *Facebook Downloader Completed*\n\n_Downloaded successfully._ 🤞`,
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

                const response = await fetch(`https://apis.davidcyril.name.ng/tiktok?url=${encodeURIComponent(url)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                if (!data.status || !data.result) {
                    return await sock.sendMessage(jid, { text: "❌ Failed to parse TikTok media links." }, { quoted: msg });
                }

                const title = data.result.title || "TikTok Video";
                const downloadUrl = data.result.video || data.result.noWatermark || data.result.download_url;

                if (!downloadUrl) {
                    throw new Error("No clean MP4 link available inside API response.");
                }

                await sock.sendMessage(jid, {
                    video: { url: downloadUrl },
                    caption: `🎵 *Title:* ${title}\n\n_TikTok downloaded without watermark!_ 🤞`,
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
                    caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}\n\n_Downloaded via Satoru Gojo_ 🤞`
                }, { quoted: msg });

            } catch (error) {
                console.error("MediaFire Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download MediaFire file. Ensure the file size is reasonable and try again." }, { quoted: msg });
            }
        }
    },

    // 10. APK APPLICATION DOWNLOADER (.apk)
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
                await sock.sendMessage(jid, { text: "Searching app catalog... 🔍" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/apksearch?query=${encodeURIComponent(args)}`);
                if (!response.ok) {
                    throw new Error(`API returned status code ${response.status}`);
                }

                const data = await response.json();
                
                let results = [];
                if (Array.isArray(data)) {
                    results = data;
                } else if (data && Array.isArray(data.result)) {
                    results = data.result;
                }

                if (results.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No matching applications found." }, { quoted: msg });
                }

                const selectedResults = results.slice(0, 10);

                let listCaption = `📦 *APK SEARCH RESULTS* 📦\n`;
                listCaption += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                listCaption += `🔍 *Query:* "${args}"\n\n`;

                selectedResults.forEach((app, index) => {
                    listCaption += `${index + 1}. *${app.name || app.title}* (${app.id || app.package || 'N/A'})\n`;
                });

                listCaption += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                listCaption += `💡 *Reply directly to this list message with the number of the app you want to download.* 📥`;

                const prompt = await sock.sendMessage(jid, { text: listCaption }, { quoted: msg });

                global.apkSessions[prompt.key.id] = {
                    query: args,
                    results: selectedResults.map(app => ({
                        name: app.name || app.title,
                        id: app.id || app.package
                    }))
                };

            } catch (error) {
                console.error("APK Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to search application index. Try again later." }, { quoted: msg });
            }
        }
    },

    // 11. AUDIO RECOGNIZER & SUMMONER (.shazam)
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

    // 12. SONG LYRICS FINDER (.lyrics)
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
                                   `${lyrics}\n\n` +
                                   `_Lyrics downloaded successfully._ 🤞`;

                await sock.sendMessage(jid, { text: lyricsText }, { quoted: msg });

            } catch (error) {
                console.error("Lyrics Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to fetch song lyrics. Try again later." }, { quoted: msg });
            }
        }
    },

    // 13. GOOGLE DRIVE DOWNLOADER (.gdrive)
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
                    caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}\n\n_Google Drive completed successfully._ 🤞`
                }, { quoted: msg });

            } catch (error) {
                console.error("GDrive Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download Google Drive file. Ensure file parameters are accessible." }, { quoted: msg });
            }
        }
    },

    // 14. GITHUB REPOSITORY CLONER (.gitclone)
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

            const gcregex = /^(https?:\/\/)?(www\.)?(github\.com)\/.+$/i;
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
                    caption: `📦 *GitHub Repository:* \`${user}/${repo}\`\n\n_Zip package completed successfully._ 🤞`
                }, { quoted: msg });

            } catch (error) {
                console.error("GitClone Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to clone repository. Ensure the repository is public." }, { quoted: msg });
            }
        }
    },

    // 15. PINTEREST DOWNPARSER (.pinterest)
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

                const response = await fetch(`https://apis.davidcyril.name.ng/pinterest?url=${encodeURIComponent(url)}`);
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

                const isVideo = downloadUrl.toLowerCase().includes(".mp4");

                if (isVideo) {
                    await sock.sendMessage(jid, {
                        video: { url: downloadUrl },
                        caption: `🎬 *Pinterest Downloader Completed*\n\n_Downloaded successfully._ 🤞`,
                        mimetype: 'video/mp4'
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, {
                        image: { url: downloadUrl },
                        caption: `📸 *Pinterest Downloader Completed*\n\n_Downloaded successfully._ 🤞`
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error("Pinterest Downloader Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to complete Pinterest download. Try again later." }, { quoted: msg });
            }
        }
    },

    // 16. SUBTITLE FILE DOWNLOADER (.subtitle)
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
                                `🌐 *Language:* English\n\n` +
                                `_Subtitles loaded successfully._ 🤞`;

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

    // 17. DOCUMENT-FORMAT YOUTUBE LINK AUDIO/VIDEO DOWNLOADER (.ytmp3doc / .ytmp4doc)
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
                    caption: `🎵 *Title:* ${title}\n\n_Downloaded as document successfully._ 🤞`
                }, { quoted: msg });

            } catch (error) {
                console.error("YTMP3Doc Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to download audio document. Try again later." }, { quoted: msg });
            }
        }
    },

    // 18. DOCUMENT-FORMAT YOUTUBE SEARCH AUDIO/VIDEO DOWNLOADER (.playdoc / .videodoc)
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

                // Loaded dynamically inside the command execution to prevent startup boot crashes
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
                    caption: `🎵 *Title:* ${title}\n\n_Downloaded as document successfully._ 🤞`
                }, { quoted: msg });

            } catch (error) {
                console.error("PlayDoc Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to process audio document download. Try again later." }, { quoted: msg });
            }
        }
    }
];

// Compile structural aliases safely without modifying the target array mid-iteration
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'fb') {
        aliases.push({ ...cmd, name: 'facebook' });
    }
    if (cmd.name === 'tt') {
        aliases.push({ ...cmd, name: 'tiktok' });
    }
});
module.exports.push(...aliases);