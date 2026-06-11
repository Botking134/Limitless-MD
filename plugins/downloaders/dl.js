// plugins/dl.js
const settings = require('../../settings');
const axios = require('axios');
const FormData = require('form-data');

global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};

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

async function uploadToCloud(buffer, mimeType) {
    const ext = mimeType.split('/')[1] || 'bin';
    const filename = `file_${Date.now()}.${ext}`;

    try {
        const form = new FormData();
        form.append('files[]', buffer, { filename, contentType: mimeType });
        const response = await axios.post('https://qu.ax/upload.php', form, {
            headers: { ...form.getHeaders() }
        });
        if (response.data?.success && response.data.files?.[0]?.url) {
            return response.data.files[0].url;
        }
    } catch (err) {
        console.error("❌ [UPLOAD] qu.ax failed:", err.message);
    }

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
    } catch (err) {
        console.error("❌ [UPLOAD] catbox failed:", err.message);
    }

    throw new Error("All secure cloud upload hosts failed.");
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
    // 1. IMAGE SEARCH DOWNLOADER (.img)
    {
        name: 'img',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a search query." }, { quoted: msg });

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
                if (!response.ok) throw new Error();

                const urls = await response.json();
                if (!Array.isArray(urls) || urls.length === 0) return await sock.sendMessage(jid, { text: "❌ No images found." }, { quoted: msg });

                const selectedUrls = urls.slice(0, count);
                for (const imgUrl of selectedUrls) {
                    await sock.sendMessage(jid, { image: { url: imgUrl } });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to search images." }, { quoted: msg });
            }
        }
    },

    // 2. MEDIAFIRE FILE DOWNLOADER (.mediafire)
    {
        name: 'mediafire',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a MediaFire link." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Retrieving file parameters... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/mediafire?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ MediaFire parsing failed." }, { quoted: msg });

                const filename = data.result.filename || "MediaFire File";
                const size = data.result.size || "Unknown Size";
                const downloadUrl = data.result.direct_url || data.result.download_url;

                const docBuffer = await fetchBuffer(downloadUrl);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download MediaFire file." }, { quoted: msg });
            }
        }
    },

    // 3. DIRECT APK DOWNLOADER (.apk - Upgraded with Kord Endpoint)
    {
        name: 'apk',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide an application name." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching and packaging APK... 🔍📦" }, { quoted: msg });

                const response = await fetch(`https://api.kord.live/api/apk?q=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (data.error || !data.download_url) return await sock.sendMessage(jid, { text: "❌ Application not found." }, { quoted: msg });

                const { app_name, package_name, size, version, download_url } = data;

                const cap = `📦 *APK COMPLETED* 📦\n━━━━━━━━━━━━━━━━━━━\n\n` +
                            `📌 *Name:* ${app_name}\n` +
                            `⚙️ *Package Name:* ${package_name || "N/A"}\n` +
                            `🔄 *Version:* ${version || "N/A"}\n` +
                            `⚖️ *Size:* ${size || "Unknown Size"}`;

                const apkBuffer = await fetchBuffer(download_url);
                if (apkBuffer) {
                    await sock.sendMessage(jid, { document: apkBuffer, mimetype: "application/vnd.android.package-archive", fileName: `${app_name}.apk`, caption: cap }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: download_url }, mimetype: "application/vnd.android.package-archive", fileName: `${app_name}.apk`, caption: cap }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download APK." }, { quoted: msg });
            }
        }
    },

    // 4. INTERACTIVE APK SEARCHER (.apksearch - Upgraded with Kord Endpoint)
    {
        name: 'apksearch',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide an application search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching app catalog... 🔍" }, { quoted: msg });

                const response = await fetch(`https://api.kord.live/api/apksearch?query=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!Array.isArray(data) || data.length === 0) return await sock.sendMessage(jid, { text: "❌ No matching applications found." }, { quoted: msg });

                const selectedResults = data.slice(0, 10);

                let listCaption = `📦 *APK SEARCH RESULTS* 📦\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                selectedResults.forEach((app, index) => {
                    listCaption += `${index + 1}. *${app.name}* (ID: ${app.id || 'N/A'})\n`;
                });
                listCaption += `\n💡 *Reply directly with the number of the app to download.*`;

                const prompt = await sock.sendMessage(jid, { text: listCaption }, { quoted: msg });

                global.apkSessions[prompt.key.id] = {
                    query: args,
                    results: selectedResults.map(app => ({ name: app.name, id: app.id }))
                };
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to search applications." }, { quoted: msg });
            }
        }
    },

    // 5. AUDIO RECOGNIZER (.shazam - Upgraded & Redundancy Stabilized)
    {
        name: 'shazam',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return await sock.sendMessage(jid, { text: "❌ Please reply directly to an audio or video file." }, { quoted: msg });

            const rawContent = getRawMessage(quoted);
            let mediaMessage = rawContent?.audioMessage || rawContent?.videoMessage;
            let mediaType = rawContent?.audioMessage ? "audio" : (rawContent?.videoMessage ? "video" : "");

            if (!mediaMessage) return await sock.sendMessage(jid, { text: "❌ Quoted message must be a valid audio or video." }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Listening to the track... 🎧" }, { quoted: msg });

                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const mimeType = mediaMessage.mimetype || (mediaType === "audio" ? "audio/ogg" : "video/mp4");
                
                const uploadedUrl = await uploadToCloud(buffer, mimeType);
                if (!uploadedUrl) throw new Error("Cloud upload returned an empty URL");

                let title = "";
                let artist = "";
                let album = "";
                let release_date = "";
                let genre = "";

                try {
                    const response = await fetch(`https://api.kord.live/api/shazam?url=${encodeURIComponent(uploadedUrl)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.status && data.result) {
                            title = data.result.title;
                            artist = data.result.artist;
                            album = data.result.album || "N/A";
                            release_date = data.result.release_date || "N/A";
                            genre = data.result.genres || "N/A";
                        }
                    }
                } catch (e) {}

                if (!title) {
                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/shazam?url=${encodeURIComponent(uploadedUrl)}`);
                        if (response.ok) {
                            const data = await response.json();
                            if (data.status && data.result) {
                                title = data.result.title;
                                artist = data.result.artists || data.result.artist;
                                album = data.result.album || "N/A";
                                release_date = data.result.release_date || "N/A";
                                genre = data.result.genre || "N/A";
                            }
                        }
                    } catch (e) {}
                }

                if (!title) return await sock.sendMessage(jid, { text: "❌ Unable to identify the song." }, { quoted: msg });

                const recognitionCaption = 
                    `🎧 *SHAZAM RECOGNITION* 🎧\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📌 *Title:* ${title || "Unknown"}\n` +
                    `👤 *Artist:* ${artist || "Unknown"}\n` +
                    `📀 *Album:* ${album || "N/A"}\n` +
                    `📅 *Release:* ${release_date || "N/A"}\n` +
                    `🎵 *Genre:* ${genre || "N/A"}\n\n` +
                    `👉 *Reply to this message with "1" or "download" to play this track!*`;

                const prompt = await sock.sendMessage(jid, { text: recognitionCaption }, { quoted: msg });

                global.shazamSessions[prompt.key.id] = { title, artist };
            } catch (error) {
                console.error("Shazam Error:", error.message);
                await sock.sendMessage(jid, { text: `❌ Shazam recognition failed.` }, { quoted: msg });
            }
        }
    },

    // 6. SONG LYRICS FINDER (.lyrics)
    {
        name: 'lyrics',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a song title." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Retrieving song lyrics... 📝" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/lyrics?query=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ Lyrics not found." }, { quoted: msg });

                const title = data.result.title || "Lyrics Result";
                const artist = data.result.artist || "Unknown Artist";
                const lyrics = data.result.lyrics || "";

                const lyricsText = `📝 *LYRICS DETECTED*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🎵 *Song:* ${title}\n👤 *Artist:* ${artist}\n\n${lyrics}`;
                await sock.sendMessage(jid, { text: lyricsText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to fetch lyrics." }, { quoted: msg });
            }
        }
    },

    // 7. GOOGLE DRIVE DOWNLOADER (.gdrive)
    {
        name: 'gdrive',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a Google Drive link." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Retrieving Google Drive file... 📥" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/gdrive?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) return await sock.sendMessage(jid, { text: "❌ Google Drive parsing failed." }, { quoted: msg });

                const filename = data.result.filename || "Drive_File";
                const size = data.result.size || "Unknown Size";
                const downloadUrl = data.result.direct_url || data.result.download_url;

                const docBuffer = await fetchBuffer(downloadUrl);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to download Google Drive file." }, { quoted: msg });
            }
        }
    },

    // 8. GITHUB REPOSITORY CLONER (.gitclone)
    {
        name: 'gitclone',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a GitHub link." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Packing GitHub repository... ⏳" }, { quoted: msg });

                const pathParts = query.split("/");
                const user = pathParts[3];
                const repo = pathParts[4]?.replace(".git", "");

                if (!user || !repo) throw new Error();

                const downloadUrl = `https://api.github.com/repos/${user}/${repo}/zipball`;

                await sock.sendMessage(jid, {
                    document: { url: downloadUrl },
                    mimetype: "application/zip",
                    fileName: `${repo}-master.zip`,
                    caption: `📦 *GitHub Repository:* \`${user}/${repo}\``
                }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to clone repository." }, { quoted: msg });
            }
        }
    },

    // 9. PINTEREST DOWNPARSER (.pinterest)
    {
        name: 'pinterest',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a Pinterest link or search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Downloading Pinterest media... 📥" }, { quoted: msg });

                const resolvedUrl = await resolveUrlOrSearch(query);
                if (!resolvedUrl) return;

                if (resolvedUrl.includes("youtube.com") || resolvedUrl.includes("youtu.be")) {
                    const commandsList = require('../commands');
                    return await commandsList[`${settings.prefix}ytmp4`](sock, msg, resolvedUrl, { isOwner: false });
                }

                const response = await fetch(`https://api.kord.live/api/pinterest?url=${encodeURIComponent(resolvedUrl)}`);
                if (!response.ok) throw new Error();

                const json = await response.json();
                const data = json?.data?.data;
                if (!data) return await sock.sendMessage(jid, { text: "❌ Pinterest parsing failed." }, { quoted: msg });

                const downloads = data.downloads || [];
                const video = downloads.find(v => v.format === "MP4")?.url;
                const thumb = downloads.find(v => v.format === "JPG")?.url;
                const downloadUrl = video || thumb;

                if (!downloadUrl) throw new Error();

                const mediaBuffer = await fetchBuffer(downloadUrl);

                if (video) {
                    if (mediaBuffer) {
                        try {
                            await sock.sendMessage(jid, { video: mediaBuffer, caption: `🎬 Pinterest Video`, mimetype: 'video/mp4' }, { quoted: msg });
                        } catch (err) {
                            await sock.sendMessage(jid, { document: mediaBuffer, mimetype: 'video/mp4', fileName: `pinterest-video.mp4`, caption: `🎬 Pinterest Video\n\n⚠️ _Sent as document due to player limits._` }, { quoted: msg });
                        }
                    } else {
                        await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `🎬 Pinterest Video`, mimetype: 'video/mp4' }, { quoted: msg });
                    }
                } else {
                    if (mediaBuffer) {
                        await sock.sendMessage(jid, { image: mediaBuffer, caption: `📸 Pinterest Image` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, { image: { url: downloadUrl }, caption: `📸 Pinterest Image` }, { quoted: msg });
                    }
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to complete Pinterest download." }, { quoted: msg });
            }
        }
    },

    // 10. SUBTITLE FILE DOWNLOADER (.subtitle)
    {
        name: 'subtitle',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a movie name." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching English subtitles... 🎬" }, { quoted: msg });

                const response = await fetch(`https://api.kord.live/api/subtitle?q=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.downloadLinks || data.downloadLinks.length === 0) return await sock.sendMessage(jid, { text: "❌ Subtitles not found." }, { quoted: msg });

                const englishSub = data.downloadLinks.find(d => d.language.toLowerCase().includes("english"));
                if (!englishSub || !englishSub.url) return await sock.sendMessage(jid, { text: "❌ English subtitles not available." }, { quoted: msg });

                const movieTitle = data.title || args;
                const caption = `🎬 *Subtitle Downloader*\n\n📌 *Title:* ${movieTitle}\n🌐 *Language:* English`;

                const subBuffer = await fetchBuffer(englishSub.url);
                if (subBuffer) {
                    await sock.sendMessage(jid, { document: subBuffer, mimetype: "application/x-subrip", fileName: `${movieTitle}-en.srt`, caption: caption }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: englishSub.url }, mimetype: "application/x-subrip", fileName: `${movieTitle}-en.srt`, caption: caption }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to retrieve subtitles." }, { quoted: msg });
            }
        }
    },

    // 11. WEBSITE DOWNLOADER & PACKER (.web)
    {
        name: 'web',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a website URL." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Downloading and packing website assets... 🌐⏳" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/tools/downloadweb?url=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                if (!data.status || !data.result) throw new Error();

                const filename = data.result.filename || "website_source.zip";
                const downloadUrl = data.result.download_url || data.result.link;

                const zipBuffer = await fetchBuffer(downloadUrl);
                if (zipBuffer) {
                    await sock.sendMessage(jid, { document: zipBuffer, mimetype: "application/zip", fileName: filename, caption: `📁 *Source Website:* \`${args}\`` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, mimetype: "application/zip", fileName: filename, caption: `📁 *Source Website:* \`${args}\`` }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to package website." }, { quoted: msg });
            }
        }
    },

    // 12. MEDIA TO DIRECT WEB URL CONVERTER (.tourl / .url)
    {
        name: 'tourl',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);
            
            let mediaMessage = rawContent?.imageMessage || rawContent?.videoMessage || rawContent?.stickerMessage || rawContent?.audioMessage || rawContent?.documentMessage;
            let mediaType = rawContent?.imageMessage ? "image" : (rawContent?.videoMessage ? "video" : (rawContent?.stickerMessage ? "sticker" : (rawContent?.audioMessage ? "audio" : "document")));

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { 
                    text: "❌ *Invalid Context:* Please reply directly to an image, video, sticker, audio, or document file to generate a URL." 
                }, { quoted: msg });
            }

            const statusMsg = await sock.sendMessage(jid, { text: "⏳ *Channelling media into direct link...*" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const mimeType = mediaMessage.mimetype || "application/octet-stream";
                const url = await uploadToCloud(buffer, mimeType);

                const finalReport = `📦 *DIRECT URL MANIFESTED* 🌐\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                    `🔗 *Link:* ${url}\n` +
                                    `⚖️ *Size:* \`${(buffer.length / (1024 * 1024)).toFixed(2)} MB\`\n\n` +
                                    `_“My six eyes see straight through the data.”_ 🤞`;

                await sock.sendMessage(jid, { text: finalReport, edit: statusMsg.key });
            } catch (error) {
                await sock.sendMessage(jid, { 
                    text: `❌ *Upload Failed:* ${error.message || "Unable to complete cloud stream."}`, 
                    edit: statusMsg.key 
                });
            }
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'gitclone') aliases.push({ ...cmd, name: 'gitdl' });
    if (cmd.name === 'pinterest') aliases.push({ ...cmd, name: 'pint' });
    if (cmd.name === 'tourl') aliases.push({ ...cmd, name: 'url' });
});
module.exports.push(...aliases);