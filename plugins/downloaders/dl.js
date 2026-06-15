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
                if (!response.ok) throw new Error(`Image API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !Array.isArray(data.result)) throw new Error("API response did not return status true or missing result array.");

                const selectedUrls = data.result.slice(0, count);
                if (selectedUrls.length === 0) throw new Error("Resolved image array is empty.");

                for (const imgUrl of selectedUrls) {
                    await sock.sendMessage(jid, { image: { url: imgUrl } });
                }
            } catch (error) {
                logCommandError('img', args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to search images. Diagnostic: ${error.message}` }, { quoted: msg });
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
                if (!response.ok) throw new Error(`Mediafire API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("API response did not report status true or missing result payload.");

                const filename = data.result.filename || "MediaFire File";
                const size = data.result.size || "Unknown Size";
                const downloadUrl = data.result.direct_url || data.result.download_url;

                if (!downloadUrl) throw new Error("Could not extract direct download URL from API.");

                const docBuffer = await fetchBuffer(downloadUrl);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                }
            } catch (error) {
                logCommandError('mediafire', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download MediaFire file. Diagnostic: ${error.message}` }, { quoted: msg });
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

                const response = await fetch(`https://apis.davidcyril.name.ng/download/apk?query=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error(`APK Downloader API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("API response returned status false or invalid result object.");

                const app_name = data.result.name || data.result.title || args;
                const size = data.result.size || "Unknown Size";
                const download_url = data.result.download_url || data.result.link || data.result.url;

                if (!download_url) throw new Error("Failed to retrieve any direct APK download link.");

                const cap = `📦 *APK COMPLETED* 📦\n━━━━━━━━━━━━━━━━━━━\n\n` +
                            `📌 *Name:* ${app_name}\n` +
                            `⚖️ *Size:* ${size}`;

                const apkBuffer = await fetchBuffer(download_url);
                if (apkBuffer) {
                    await sock.sendMessage(jid, { document: apkBuffer, mimetype: "application/vnd.android.package-archive", fileName: `${app_name}.apk`, caption: cap }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: download_url }, mimetype: "application/vnd.android.package-archive", fileName: `${app_name}.apk`, caption: cap }, { quoted: msg });
                }
            } catch (error) {
                logCommandError('apk', args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download APK. Diagnostic: ${error.message}` }, { quoted: msg });
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

                // Direct fallback query optimization
                const response = await fetch(`https://apis.davidcyril.name.ng/download/apk?query=${encodeURIComponent(args)}`);
                if (!response.ok) throw new Error(`APK search returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("No applications found or unsuccessful API status.");

                // If single result is returned directly
                const app = data.result;
                const name = app.name || app.title || "App Match";
                const downloadUrl = app.download_url || app.link || app.url;

                let listCaption = `📦 *APK SEARCH RESULTS* 📦\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                listCaption += `1. *${name}* (Size: ${app.size || 'N/A'})\n`;
                listCaption += `\n💡 *Reply directly with "1" to download this app.*`;

                const prompt = await sock.sendMessage(jid, { text: listCaption }, { quoted: msg });

                global.apkSessions[prompt.key.id] = {
                    query: args,
                    results: [{ name, download_url: downloadUrl }]
                };
            } catch (error) {
                logCommandError('apksearch', args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to search applications. Diagnostic: ${error.message}` }, { quoted: msg });
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
                if (!uploadedUrl) throw new Error("Cloud upload returned an empty URL");

                const response = await fetch(`https://apis.davidcyril.name.ng/shazam?url=${encodeURIComponent(uploadedUrl)}`);
                if (!response.ok) throw new Error(`Shazam API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Shazam API could not identify the audio source.");

                const title = data.result.title || "Unknown Title";
                const artist = data.result.artists || data.result.artist || "Unknown Artist";
                const album = data.result.album || "N/A";
                const release_date = data.result.release_date || "N/A";
                const genre = data.result.genre || "N/A";

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
                logCommandError('shazam', args, error);
                await sock.sendMessage(jid, { text: `❌ Shazam recognition failed. Diagnostic: ${error.message}` }, { quoted: msg });
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
                if (!response.ok) throw new Error(`Lyrics API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Lyrics not found or status returned false.");

                const title = data.result.title || "Lyrics Result";
                const artist = data.result.artist || "Unknown Artist";
                const lyrics = data.result.lyrics || "";

                const lyricsText = `📝 *LYRICS DETECTED*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🎵 *Song:* ${title}\n👤 *Artist:* ${artist}\n\n${lyrics}`;
                await sock.sendMessage(jid, { text: lyricsText }, { quoted: msg });
            } catch (error) {
                logCommandError('lyrics', args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to fetch lyrics. Diagnostic: ${error.message}` }, { quoted: msg });
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
                if (!response.ok) throw new Error(`Google Drive API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Google Drive parsing failed or returned status false.");

                const filename = data.result.filename || "Drive_File";
                const size = data.result.size || "Unknown Size";
                const downloadUrl = data.result.direct_url || data.result.download_url;

                if (!downloadUrl) throw new Error("No download URL returned by Google Drive parser.");

                const docBuffer = await fetchBuffer(downloadUrl);
                if (docBuffer) {
                    await sock.sendMessage(jid, { document: docBuffer, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, fileName: filename, caption: `📁 *File Name:* ${filename}\n⚖️ *Size:* ${size}` }, { quoted: msg });
                }
            } catch (error) {
                logCommandError('gdrive', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to download Google Drive file. Diagnostic: ${error.message}` }, { quoted: msg });
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

                const gitRegex = /github\.com\/([^/]+)\/([^/]+)/i;
                const match = query.match(gitRegex);
                if (!match) throw new Error("Invalid GitHub link format. Unable to isolate user and repository.");

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
                logCommandError('gitclone', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to clone repository. Diagnostic: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 9. PINTEREST DOWNPARSER (.pinterest / .pint)
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
                if (!resolvedUrl) throw new Error("Could not resolve valid URL from input query.");

                const response = await fetch(`https://apis.davidcyril.name.ng/download/pinterest?url=${encodeURIComponent(resolvedUrl)}`);
                if (!response.ok) throw new Error(`Pinterest API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Pinterest parsing operation failed.");

                const downloadUrl = data.result.url || data.result.download_url || data.result.link || data.result.video || data.result.image;
                if (!downloadUrl) throw new Error("No download media found inside Pinterest API payload.");

                const mediaBuffer = await fetchBuffer(downloadUrl);
                const isVideo = downloadUrl.toLowerCase().includes(".mp4") || (data.result.type && data.result.type.toLowerCase().includes("video"));

                if (isVideo) {
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
                logCommandError('pinterest', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to complete Pinterest download. Diagnostic: ${error.message}` }, { quoted: msg });
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
                if (!response.ok) throw new Error(`Subtitle API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.downloadLinks || data.downloadLinks.length === 0) throw new Error("No subtitle records located.");

                const englishSub = data.downloadLinks.find(d => d.language.toLowerCase().includes("english"));
                if (!englishSub || !englishSub.url) throw new Error("No English language subtitle tracks detected.");

                const movieTitle = data.title || args;
                const caption = `🎬 *Subtitle Downloader*\n\n📌 *Title:* ${movieTitle}\n🌐 *Language:* English`;

                const subBuffer = await fetchBuffer(englishSub.url);
                if (subBuffer) {
                    await sock.sendMessage(jid, { document: subBuffer, mimetype: "application/x-subrip", fileName: `${movieTitle}-en.srt`, caption: caption }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: englishSub.url }, mimetype: "application/x-subrip", fileName: `${movieTitle}-en.srt`, caption: caption }, { quoted: msg });
                }
            } catch (error) {
                logCommandError('subtitle', args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to retrieve subtitles. Diagnostic: ${error.message}` }, { quoted: msg });
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
                if (!response.ok) throw new Error(`Web scraper API returned HTTP status ${response.status}`);

                const data = await response.json();
                if (!data.status || !data.result) throw new Error("Web scraper operation reported failure status.");

                const filename = data.result.filename || "website_source.zip";
                const downloadUrl = data.result.download_url || data.result.link;

                if (!downloadUrl) throw new Error("No source asset packaging link generated.");

                const zipBuffer = await fetchBuffer(downloadUrl);
                if (zipBuffer) {
                    await sock.sendMessage(jid, { document: zipBuffer, mimetype: "application/zip", fileName: filename, caption: `📁 *Source Website:* \`${args}\`` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { document: { url: downloadUrl }, mimetype: "application/zip", fileName: filename, caption: `📁 *Source Website:* \`${args}\`` }, { quoted: msg });
                }
            } catch (error) {
                logCommandError('web', args, error);
                await sock.sendMessage(jid, { text: `❌ Failed to package website. Diagnostic: ${error.message}` }, { quoted: msg });
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
                if (!response.ok) throw new Error(`PDF API returned HTTP status ${response.status}`);

                const contentType = response.headers.get('content-type') || '';
                let pdfBuffer = null;
                let fileName = "converted_page.pdf";

                if (contentType.includes('application/pdf')) {
                    const arrayBuffer = await response.arrayBuffer();
                    pdfBuffer = Buffer.from(arrayBuffer);
                } else {
                    const data = await response.json();
                    if (!data.status || !data.result) throw new Error("PDF processing failed.");
                    const downloadUrl = data.result.download_url || data.result.link || data.result.url;
                    if (!downloadUrl) throw new Error("Could not extract PDF direct link from payload.");
                    pdfBuffer = await fetchBuffer(downloadUrl);
                }

                if (!pdfBuffer) throw new Error("Could not download converted PDF buffer.");

                await sock.sendMessage(jid, { 
                    document: pdfBuffer, 
                    mimetype: "application/pdf", 
                    fileName: fileName, 
                    caption: `📄 *PDF Generated:* \`${query}\`` 
                }, { quoted: msg });
            } catch (error) {
                logCommandError('pdf', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to generate PDF document. Diagnostic: ${error.message}` }, { quoted: msg });
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
                if (!response.ok) throw new Error(`Telegram Sticker API returned HTTP status ${response.status}`);

                const contentType = response.headers.get('content-type') || '';
                let fileBuffer = null;
                let fileName = "telegram-stickers.zip";

                if (contentType.includes('application/zip') || contentType.includes('application/octet-stream')) {
                    const arrayBuffer = await response.arrayBuffer();
                    fileBuffer = Buffer.from(arrayBuffer);
                } else {
                    const data = await response.json();
                    if (!data.status || !data.result) throw new Error("Telegram sticker parsing returned failure status.");
                    const downloadUrl = data.result.download_url || data.result.link || data.result.url || data.result.zip;
                    if (!downloadUrl) throw new Error("No download zip URL located in API payload.");
                    fileBuffer = await fetchBuffer(downloadUrl);
                    if (data.result.filename) fileName = data.result.filename;
                }

                if (!fileBuffer) throw new Error("Failed to secure sticker media buffer.");

                await sock.sendMessage(jid, { 
                    document: fileBuffer, 
                    mimetype: "application/zip", 
                    fileName: fileName, 
                    caption: `🎁 *Telegram Sticker Pack Downloaded*` 
                }, { quoted: msg });
            } catch (error) {
                logCommandError('tgs', query, error);
                await sock.sendMessage(jid, { text: `❌ Failed to extract Telegram stickers. Diagnostic: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 14. MEDIA TO DIRECT WEB URL CONVERTER (.tourl / .url)
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
                logCommandError('tourl', '', error);
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