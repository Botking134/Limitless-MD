// plugins/downloaders/dl.js
const settings = require('../../settings');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

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
    let ext = mimeType.split('/')[1] || 'bin';
    ext = ext.split(';')[0].trim();
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

                const response = await fetch(`https://apis.davidcyril.name.ng/googleimage?query=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!data.status || !Array.isArray(data.result)) throw new Error("Image search returned empty result list.");

                const selectedUrls = data.result.slice(0, count);
                for (const imgUrl of selectedUrls) {
                    await sock.sendMessage(jid, { image: { url: imgUrl } });
                }
            } catch (error) {
                logError("img", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to search images. Error: ${error.message}` }, { quoted: msg });
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
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("MediaFire parsing failed.");

                const filename = data.result.filename || "MediaFire File";
                const size = data.result.size || "Unknown Size";
                const downloadUrl = data.result.direct_url || data.result.download_url;

                if (!downloadUrl) throw new Error("Media download link missing.");

                const docBuffer = await fetchBuffer(downloadUrl);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                }
            } catch (error) {
                logError("mediafire", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download MediaFire file. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 3. DIRECT APK DOWNLOADER (.apk)
    {
        name: 'apk',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide an application name." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching and packaging APK... 🔍📦" }, { quoted: msg });

                const response = await fetch(`https://api.kord.live/api/apk?q=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (data.error || !data.download_url) throw new Error(data.error || "APK download link missing.");

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
                logError("apk", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download APK. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 4. INTERACTIVE APK SEARCHER (.apksearch)
    {
        name: 'apksearch',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide an application search query." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching app catalog... 🔍" }, { quoted: msg });

                const response = await fetch(`https://api.kord.live/api/apksearch?query=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!Array.isArray(data) || data.length === 0) throw new Error("APK search empty.");

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
                logError("apksearch", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to search applications. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 5. AUDIO RECOGNIZER (.shazam)
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
                if (!uploadedUrl) throw new Error("Cloud upload servers are completely offline or blocked.");

                let title = "";
                let artist = "";
                let album = "";
                let release_date = "";
                let genre = "";

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

                if (!title) {
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
                }

                if (!title) throw new Error("Identified audio fields empty across secondary networks.");

                const recognitionCaption = 
                    `🎧 *SHAZAM RECOGNITION* 🎧\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📌 *Title:* ${title}\n` +
                    `👤 *Artist:* ${artist}\n` +
                    `📀 *Album:* ${album}\n` +
                    `📅 *Release:* ${release_date}\n` +
                    `🎵 *Genre:* ${genre}\n\n` +
                    `👉 *Reply to this message with "1" or "download" to play this track!*`;

                const prompt = await sock.sendMessage(jid, { text: recognitionCaption }, { quoted: msg });

                global.shazamSessions[prompt.key.id] = { title, artist };
            } catch (error) {
                logError("shazam", '', error);
                await sock.sendMessage(jid, { text: `❌ Shazam recognition failed. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 6. GOOGLE DRIVE DOWNLOADER (.gdrive)
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
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Google Drive parsing failed.");

                const filename = data.result.filename || "Drive_File";
                const size = data.result.size || "Unknown Size";
                const downloadUrl = data.result.direct_url || data.result.download_url;

                if (!downloadUrl) throw new Error("Direct download link values undefined.");

                const docBuffer = await fetchBuffer(downloadUrl);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                }
            } catch (error) {
                logError("gdrive", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Google Drive file. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 7. GITHUB REPOSITORY CLONER (.gitclone)
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

                const gitRegex = /github\.com\/([^/]+)\/([^/]+)/i;
                const match = query.match(gitRegex);
                if (!match) throw new Error("Invalid GitHub repository link format.");

                const user = match[1];
                const repo = match[2].replace(/\.git\/?$/i, "").split(/[?#]/)[0];

                const downloadUrl = `https://api.github.com/repos/${user}/${repo}/zipball`;

                await sock.sendMessage(jid, {
                    document: { url: downloadUrl },
                    mimetype: "application/zip",
                    fileName: `${repo}-master.zip`,
                    caption: `📦 *GitHub Repository:* \`${user}/${repo}\``
                }, { quoted: msg });
            } catch (error) {
                logError("gitclone", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to clone repository. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 8. PINTEREST DOWNPARSER (.pinterest)
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

                const resolvedUrl = await fetch(`https://api.kord.live/api/pinterest?url=${encodeURIComponent(query)}`);
                if (!resolvedUrl.ok) throw new Error(`HTTP Status ${resolvedUrl.status}`);

                const json = await resolvedUrl.json();
                const data = json?.data?.data;
                if (!data) throw new Error("Pinterest parsing operation empty.");

                const downloads = data.downloads || [];
                const video = downloads.find(v => v.format === "MP4")?.url;
                const thumb = downloads.find(v => v.format === "JPG")?.url;
                const downloadUrl = video || thumb;

                if (!downloadUrl) throw new Error("Media link properties resolved empty.");

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
                logError("pinterest", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to complete Pinterest download. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 9. SUBTITLE FILE DOWNLOADER (.subtitle)
    {
        name: 'subtitle',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a movie name." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching English subtitles... 🎬" }, { quoted: msg });

                const response = await fetch(`https://api.kord.live/api/subtitle?q=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!data.downloadLinks || data.downloadLinks.length === 0) throw new Error("Subtitle link array empty.");

                const englishSub = data.downloadLinks.find(d => d.language.toLowerCase().includes("english"));
                if (!englishSub || !englishSub.url) throw new Error("English language subtitle missing.");

                const movieTitle = data.title || args;
                const caption = `🎬 *Subtitle Downloader*\n\n📌 *Title:* ${movieTitle}\n🌐 *Language:* English`;

                const subBuffer = await fetchBuffer(englishSub.url);
                if (subBuffer) {
                    await sock.sendMessage(jid, { document: subBuffer, mimetype: "application/x-subrip", fileName: `${movieTitle}-en.srt`, caption: caption }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: englishSub.url }, mimetype: "application/x-subrip", fileName: `${movieTitle}-en.srt`, caption: caption }, { quoted: msg });
                }
            } catch (error) {
                logError("subtitle", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to retrieve subtitles. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 10. WEBSITE DOWNLOADER & PACKER (.web)
    {
        name: 'web',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a website URL." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Downloading and packing website assets... 🌐⏳" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/tools/downloadweb?url=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Web conversion failed.");

                const filename = data.result.filename || "website_source.zip";
                const downloadUrl = data.result.download_url || data.result.link;

                if (!downloadUrl) throw new Error("Direct zip download URL resolved empty.");

                const zipBuffer = await fetchBuffer(downloadUrl);
                if (zipBuffer) {
                    await sock.sendMessage(jid, { document: zipBuffer, mimetype: "application/zip", fileName: filename, caption: `📁 *Source Website:* \`${args}\`` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, mimetype: "application/zip", fileName: filename, caption: `📁 *Source Website:* \`${args}\`` }, { quoted: msg });
                }
            } catch (error) {
                logError("web", args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to package website. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 11. MEDIA TO DIRECT WEB URL CONVERTER (.tourl / .url)
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
                if (!url) throw new Error("File hosting servers returned null.");

                const finalReport = `📦 *DIRECT URL MANIFESTED* 🌐\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                    `🔗 *Link:* ${url}\n` +
                                    `⚖️ *Size:* \`${(buffer.length / (1024 * 1024)).toFixed(2)} MB\`\n\n` +
                                    `_“My six eyes see straight through the data.”_ 🤞`;

                await sock.sendMessage(jid, { text: finalReport, edit: statusMsg.key });
            } catch (error) {
                logError("tourl", '', error);
                await sock.sendMessage(jid, { 
                    text: `❌ *Upload Failed:* ${error.message || "Unable to complete cloud stream."}`, 
                    edit: statusMsg.key 
                });
            }
        }
    },

    // 12. WEB TO PDF CONVERTER (.pdf)
    {
        name: 'pdf',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a URL to convert to PDF." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Converting webpage to PDF document... 📄⏳" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/tools/pdf?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const contentType = response.headers.get('content-type') || '';
                let pdfBuffer = null;
                let fileName = "converted_page.pdf";

                if (contentType.includes('application/pdf')) {
                    const arrayBuffer = await response.arrayBuffer();
                    pdfBuffer = Buffer.from(arrayBuffer);
                } else {
                    const data = await response.json();
                    if (!data.status || !data.result) throw new Error("Web-to-PDF parser returned failure.");
                    const downloadUrl = data.result.download_url || data.result.link || data.result.url;
                    if (!downloadUrl) throw new Error("No download URL returned.");
                    pdfBuffer = await fetchBuffer(downloadUrl);
                }

                if (!pdfBuffer) throw new Error("Could not download target PDF stream.");

                await sock.sendMessage(jid, { 
                    document: pdfBuffer, 
                    mimetype: "application/pdf", 
                    fileName: fileName, 
                    caption: `📄 *PDF Generated:* \`${query}\`` 
                }, { quoted: msg });
            } catch (error) {
                logError("pdf", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to generate PDF document. Error: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 13. TELEGRAM STICKER DOWNLOADER (.tgs)
    {
        name: 'tgs',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let query = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!query && quoted) {
                const rawContent = getRawMessage(quoted);
                query = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!query) return await sock.sendMessage(jid, { text: "❌ Please provide a Telegram sticker pack URL." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Extracting Telegram sticker data... 📦" }, { quoted: msg });

                const response = await fetch(`https://apis.davidcyril.name.ng/telegram-sticker?url=${encodeURIComponent(query)}`);
                if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

                const contentType = response.headers.get('content-type') || '';
                let fileBuffer = null;
                let fileName = "telegram-stickers.zip";

                if (contentType.includes('application/zip') || contentType.includes('application/octet-stream')) {
                    const arrayBuffer = await response.arrayBuffer();
                    fileBuffer = Buffer.from(arrayBuffer);
                } else {
                    const data = await response.json();
                    if (!data.status || !data.result) throw new Error("Telegram sticker extraction parsed false.");
                    const downloadUrl = data.result.download_url || data.result.link || data.result.url || data.result.zip;
                    if (!downloadUrl) throw new Error("No download link located in JSON package.");
                    fileBuffer = await fetchBuffer(downloadUrl);
                    if (data.result.filename) fileName = data.result.filename;
                }

                if (!fileBuffer) throw new Error("Sticker zip packaging stream empty.");

                await sock.sendMessage(jid, { 
                    document: fileBuffer, 
                    mimetype: "application/zip", 
                    fileName: fileName, 
                    caption: `🎁 *Telegram Sticker Pack Downloaded*` 
                }, { quoted: msg });
            } catch (error) {
                logError("tgs", query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to extract Telegram stickers. Error: ${error.message}` }, { quoted: msg });
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