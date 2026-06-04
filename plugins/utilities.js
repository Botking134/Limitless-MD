// plugins/utilities.js
const settings = require('../settings'); // Up one level to settings.js
const { delay, downloadContentFromMessage } = require('@itsliaaa/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter'); // Standard JJK/Kord sticker compiler [2]

// Helper function to format system uptime
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

// Recursive Helper to automatically unwrap ephemeral, view-once, and document-caption envelopes [2]
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// Helper to crop an image, WebP Sticker, or GIF buffer to a square [2]
async function cropToSquare(buffer) {
    try {
        const { getImageProcessingLibrary } = require('@itsliaaa/baileys');
        const lib = await getImageProcessingLibrary();
        
        if (lib.sharp?.default) {
            return await lib.sharp.default(buffer)
                .resize(512, 512, { fit: 'cover' })
                .toBuffer();
        }
        else if (lib.image?.Transformer) {
            const img = new lib.image.Transformer(buffer);
            return await img.resize(512, 512, 2).png();
        }
        else if (lib.jimp?.Jimp) {
            const img = await lib.jimp.Jimp.read(buffer);
            return await img.cover({ w: 512, h: 512 }).getBuffer('image/png');
        }
    } catch (e) {
        console.error("Square cropping error:", e.message);
    }
    return buffer; 
}

// Helper to convert WebP sticker buffer back to PNG buffer to force EXIF rewrites [2]
async function forceMetadataRewrite(buffer) {
    try {
        const { getImageProcessingLibrary } = require('@itsliaaa/baileys');
        const lib = await getImageProcessingLibrary();
        
        if (lib.sharp?.default) {
            return await lib.sharp.default(buffer).png().toBuffer();
        }
        else if (lib.image?.Transformer) {
            const img = new lib.image.Transformer(buffer);
            return await img.png();
        }
        else if (lib.jimp?.Jimp) {
            const img = await lib.jimp.Jimp.read(buffer);
            return await img.getBuffer('image/png');
        }
    } catch (e) {
        console.error("EXIF force rewrite error:", e.message);
    }
    return buffer; 
}

// Helper to upload media buffer natively to a multi-host pipeline (Bypasses all Node boundary & datacenter blocks) [2]
async function uploadToCloud(buffer, mimeType) {
    const ext = mimeType.split('/')[1] || 'bin';
    const filename = `file_${Date.now()}.${ext}`;

    // 1. Try Pixeldrain PUT (Raw stream - 100% immune to FormData boundary issues) [2]
    try {
        console.log(`🌐 [UPLOADER] Trying Pixeldrain PUT...`);
        const response = await fetch(`https://pixeldrain.com/api/file/${filename}`, {
            method: 'PUT',
            body: buffer
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.id) {
                console.log(`✅ [UPLOADER] Successfully uploaded to Pixeldrain: ${data.id}`);
                return `https://pixeldrain.com/api/file/${data.id}`;
            }
        }
    } catch (err) {
        console.error(`⚠️ [UPLOADER] Pixeldrain PUT failed:`, err.message);
    }

    // 2. Fallback to Pomf Clones using safe Blob appending [2]
    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append('files[]', blob, filename); // Highly compatible boundary construction [2]

    const hosts = [
        'https://qu.ax/upload.php',
        'https://pomf2.lain.la/upload.php'
    ];

    for (const host of hosts) {
        try {
            console.log(`🌐 [UPLOADER] Trying fallback host: ${host}`);
            const response = await fetch(host, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.files?.[0]?.url) {
                    console.log(`✅ [UPLOADER] Successfully uploaded to: ${host}`);
                    return data.files[0].url;
                }
            }
        } catch (err) {
            console.error(`⚠️ [UPLOADER] Host ${host} failed:`, err.message);
        }
    }

    throw new Error("All upload hosts failed.");
}

// Unified, Gojo-themed Menu Renderer with dynamic image selection and sequential audio drop [2]
async function renderMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const p = settings.prefix;
    const uptime = formatUptime(process.uptime());

    const menuImages = [
        "https://iili.io/CFIJoDg.jpg",
        "https://iili.io/CFIJfUB.jpg",
        "https://iili.io/CFIJnOF.jpg",
        "https://iili.io/CFIJBHP.jpg",
        "https://iili.io/CFIJTiv.jpg",
        "https://iili.io/CFIJRlp.jpg",
        "https://iili.io/CFIJYJI.jpg",
        "https://iili.io/CFIJlbn.jpg",
        "https://iili.io/CFIJ1xs.jpg"
    ];

    const randomImage = menuImages[Math.floor(Math.random() * menuImages.length)];

    const menuText = 
        `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n` +
        `┃    🔵 LIMITLESS MANUAL 🔴 ┃\n` +
        `┃  "Throughout Heaven & Earth"  ┃\n` +
        `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
        
        `📁 *Utility Commands*\n` +
        `• \`${p}menu\` / \`${p}domain\` — Expand this menu.\n` +
        `• \`${p}ping\` — Check response speed (Cursed Energy) [2].\n` +
        `• \`${p}ping2\` — Check latency (Internal) [2].\n` +
        `• \`${p}alive\` — Verify status with image.\n` +
        `• \`${p}del\` / \`${p}delete\` — Delete the replied message and command [2].\n` +
        `• \`${p}vv\` — Unlock and resend replied View Once image/video.\n` +
        `• \`${p}tovv\` — Convert replied image/video to View Once.\n` +
        `• \`${p}tourl\` / \`${p}url\` — Convert replied media to direct web URL.\n` +
        `• \`${p}sticker\` / \`${p}s\` — Convert replied image/video to sticker.\n` +
        `• \`${p}crop\` — Convert replied image/gif/sticker to cropped square sticker [2].\n` +
        `• \`${p}take\` / \`${p}steal\` — Steal sticker with custom metadata [2].\n` +
        `• \`${p}smeme <top|bottom>\` — Convert replied image to meme sticker.\n` +
        `• \`${p}setcmd <command>\` — Assign custom command to replied sticker [2].\n` +
        `• \`${p}autoreact <on/off/all/cmd>\` — Toggle automated reactions.\n` +
        `• \`Speed\` _(Prefixless)_ — Check bot and network response delay.\n` +
        `• \`Kamui\` _(Prefixless)_ — Decrypt View Once & send silently to DM [2].\n\n` +
        
        `📁 *AI Commands* (Gemini 1.5 Flash)\n` +
        `• \`${p}ai <prompt>\` — General knowledge query.\n` +
        `• \`${p}debug <error/code>\` — Senior Dev bug analysis.\n` +
        `• \`${p}summon <char> <query>\` — Roleplay with any fictional character.\n` +
        `• \`${p}read <prompt>\` — Analyze replied/attached image.\n` +
        `• \`${p}imagine <prompt>\` — Manifest high-res AI imagery.\n` +
        `• \`${p}lizzy <on/off>\` — Toggle submissive Lizzy Chatbot.\n` +
        `• \`Gojo <message>\` _(Prefixless)_ — Direct chat with Gojo.\n` +
        `  _(For you, use \`${p}gojo <message>\` to bypass)_\n\n` +
        
        `📁 *Group Commands*\n` +
        `• \`${p}gmode <open/close> <time>\` — Lock/Unlock group with timed duration [2].\n` +
        `• \`${p}kick <reply/mention>\` — Exorcise a weakling from the group [2].\n` +
        `• \`${p}promote <reply/mention>\` — Elevate regular member to Admin.\n` +
        `• \`${p}demote <reply/mention>\` — Demote Admin back to regular member.\n` +
        `• \`${p}tagall <message>\` — Visible tag summon for everyone.\n` +
        `• \`${p}tag <message>\` — Ghost tag everyone on the replied message.\n` +
        `• \`${p}admins\` — Tag group administrators.\n` +
        `• \`${p}warn\` — Issue warning & delete target message [2].\n` +
        `• \`${p}togcstatus <caption/reply>\` — Send replied text/image/video to group status [2].\n` +
        `• \`${p}antilink <warn/delete/kick/off>\` — Toggle link protection settings.\n` +
        `• \`${p}antitag <on/off>\` — Bar non-admins from tagging the bot.\n` +
        `• \`${p}antibot <on/off>\` — Instantly exorcise other bots in the group [2].\n` +
        `• \`${p}link\` — Fetch group invite link.\n\n` +
        
        `📁 *Owner Commands*\n` +
        `• \`${p}mode <public/private>\` — Change bot privacy.\n` +
        `• \`${p}addowner <reply/number>\` — Grant full owner access.\n` +
        `• \`${p}delowner <reply/number>\` — Remove secondary owner access.\n` +
        `• \`${p}setsudo <reply/number>\` — Grant sudo privileges.\n` +
        `• \`${p}delsudo <reply/number>\` — Remove sudo privileges.\n` +
        `• \`${p}ban <add/remove/list>\` — Globally blacklist users.\n` +
        `• \`${p}afk\` — Toggle AFK responder.\n` +
        `• \`${p}restart\` — Reboot bot systems.\n` +
        `• \`${p}shutdown\` — Kill bot process.\n\n` +
        
        `━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ *Uptime:* ${uptime}\n` +
        `👑 *Owner:* ${settings.ownerName}`;

    try {
        // Send the randomly selected image with the menu text as caption
        await sock.sendMessage(jid, {
            image: { url: randomImage },
            caption: menuText
        }, { quoted: msg });

        // Drop the audio clip immediately after sending the menu [2]
        await sock.sendMessage(jid, {
            audio: { url: "https://qu.ax/sHoAn" },
            mimetype: "audio/mp4",
            ptt: true // Voice note format for automatic inline play [2]
        });

    } catch (error) {
        console.error("Menu Image Render Error:", error);
        await sock.sendMessage(jid, { text: menuText }, { quoted: msg });
    }
}

module.exports = [
    // 1. PING COMMAND (Gojo-Themed Dual-Loop Animation) [2]
    {
        name: 'ping',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            try {
                // 1. Measure Network Latency (Corrected string payload) [2]
                const start = Date.now();
                const sentPong = await sock.sendMessage(jid, { text: "🏓 *Pong!!*" }, { quoted: msg });
                const networkPing = Date.now() - start;

                // 2. Initialize the loading message [2]
                const loadingMsg = await sock.sendMessage(jid, { text: "[□□□□]" }, { quoted: msg });
                const frames = ["[□□□□]", "[■□□□]", "[■■□□]", "[■■■□]", "[■■■■]"];
                
                // Loop the 4-box loading animation exactly 2 times [2]
                for (let cycle = 0; cycle < 2; cycle++) {
                    for (const frame of frames) {
                        if (cycle > 0 && frame === "[□□□□]") continue; // Skip first frame on second loop
                        await sock.sendMessage(jid, { text: frame, edit: loadingMsg.key });
                        await delay(600); // 0.6 seconds delay between frames [2]
                    }
                    if (cycle === 0) {
                        // Reset loader back to empty for the second cycle
                        await sock.sendMessage(jid, { text: "[□□□□]", edit: loadingMsg.key });
                        await delay(600);
                    }
                }

                // 3. Edit the loading message to the final metrics [2]
                const cursedEnergy = networkPing * 100;
                await sock.sendMessage(jid, {
                    text: `🌀 *Void speed:* ∞\n` +
                          `🔮 *Cursed Energy:* \`${cursedEnergy}ms\``,
                    edit: loadingMsg.key
                });
            } catch (error) {
                console.error("Ping Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to channel cursed energy." }, { quoted: msg });
            }
        }
    },

    // 2. ALIVE COMMAND
    {
        name: 'alive',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const uptimeString = formatUptime(process.uptime());

            try {
                await sock.sendMessage(jid, {
                    image: { url: "https://iili.io/C3yej7s.jpg" },
                    caption: `I'm still Alive and kicking\n> ${uptimeString}`
                }, { quoted: msg });
            } catch (error) {
                console.error("Alive Command Error:", error);
                await sock.sendMessage(jid, { 
                    text: `I'm still Alive and kicking\n> ${uptimeString}\n\n_(Failed to load visual engine)_` 
                }, { quoted: msg });
            }
        }
    },

    // 3. MENU COMMAND
    {
        name: 'menu',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderMenu(sock, msg);
        }
    },

    // 4. DOMAIN COMMAND
    {
        name: 'domain',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderMenu(sock, msg);
        }
    },

    // 5. MESSAGE DELETER (Double Deletion Engine - LID-Safe) [2]
    {
        name: 'delete',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo;

            if (!quoted || !quoted.stanzaId) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to the message you want to delete." }, { quoted: msg });
            }

            try {
                // Safely resolve bot's LID and JID formats for LID accounts [2]
                const botJid = settings.botJid || (sock.user.id.includes('@lid') ? '' : sock.user.id.replace(/:.*/, '') + '@s.whatsapp.net');
                const botLid = settings.botLid || (sock.user.id.includes('@lid') ? sock.user.id.replace(/:.*/, '') + '@lid' : '');

                const isFromMe = quoted.participant === botJid || (botLid && quoted.participant === botLid);

                // Construct target message payload [2]
                const quotedKey = {
                    remoteJid: jid,
                    id: quoted.stanzaId,
                    fromMe: isFromMe,
                    participant: quoted.participant
                };

                // 1. Delete the replied-to target message [2]
                await sock.sendMessage(jid, { delete: quotedKey });

                // 2. Delete the command message itself (.del) [2]
                try {
                    await sock.sendMessage(jid, { delete: msg.key });
                } catch (err) {
                    // Fail silently inside DMs since you cannot delete other users' texts there [2]
                }
            } catch (error) {
                console.error("Delete Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to delete message. If inside a group, ensure the bot is an administrator." }, { quoted: msg });
            }
        }
    },

    // 6. AUTOREACT MODE TOGGLE
    {
        name: 'autoreact',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❄ *Current Autoreact Setting:* \`${settings.autoReact || 'off'}\`\n\n` +
                          `Available Options:\n` +
                          `• \`${settings.prefix}autoreact cmd\` (or \`on\`) — React with ❄ to commands.\n` +
                          `• \`${settings.prefix}autoreact all\` — React with ❄ to every single message.\n` +
                          `• \`${settings.prefix}autoreact off\` — Disable autoreact.`
                }, { quoted: msg });
            }

            const targetMode = args.toLowerCase().trim();

            if (targetMode === 'cmd' || targetMode === 'on') {
                settings.autoReact = 'cmd';
                await sock.sendMessage(jid, { text: "❄ *Autoreact Mode Updated:* `cmd` (I will react only to active commands)" }, { quoted: msg });
            } else if (targetMode === 'all') {
                settings.autoReact = 'all';
                await sock.sendMessage(jid, { text: "❄ *Autoreact Mode Updated:* `all` (I will react to every single message)" }, { quoted: msg });
            } else if (targetMode === 'off') {
                settings.autoReact = 'off';
                await sock.sendMessage(jid, { text: "❄ *Autoreact Mode Updated:* Disabled" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ Invalid option. Use `cmd`, `all`, or `off`." }, { quoted: msg });
            }
        }
    },

    // 7. PREFIXLESS SPEED COMMAND
    {
        name: 'speed',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            // 1. Sequential Reaction Animation: Cycles through the 5 specified emojis
            const emojis = ["⚡", "❄", "🕴", "🤞", "🥷"];
            for (const emoji of emojis) {
                try {
                    await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                    await delay(300); // 300ms transition delay between reaction updates
                } catch (err) {
                    console.error("Reaction step failed:", err.message);
                }
            }

            // 2. Measure Bot (Internal) Ping
            const msgTime = msg.messageTimestamp * 1000;
            const internalPing = Date.now() - msgTime;

            // 3. Measure Network (Round-trip) Ping
            const start = Date.now();
            const sent = await sock.sendMessage(jid, { text: "⚡" }, { quoted: msg });
            const networkPing = Date.now() - start;

            // 4. Arrogant Gojo statements
            const statements = [
                "Are you crying? Don't worry, I'm simply the strongest. Your perception of time is basically standing still to me.",
                "Speed? Please. I don't run, the space around me just gets out of my way. You're too slow.",
                "You're lucky I'm in a good mood. Otherwise, you wouldn't even see me move.",
                "My Infinity makes your speed look like a joke. Don't compare yourself to me.",
                "To me, your actions look like they are in slow motion. I'm on a completely different level."
            ];
            const selectedStatement = statements[Math.floor(Math.random() * statements.length)];

            // 5. Update the reaction with the final speed report (without trailing explanation labels)
            await sock.sendMessage(jid, {
                text: `🤞 *${selectedStatement}*\n\n` +
                      `> *Cursed amplification:* \`${internalPing}ms\`\n` +
                      `> *Reversed curse technique:* \`${networkPing}ms\``,
                edit: sent.key
            });
        }
    },

    // 8. VIEW ONCE UNLOCKER (.vv) [2]
    {
        name: 'vv',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a View Once image or video." }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);
            let mediaMessage = null;
            let mediaType = "";

            if (rawContent?.imageMessage) {
                mediaMessage = rawContent.imageMessage;
                mediaType = "image";
            } else if (rawContent?.videoMessage) {
                mediaMessage = rawContent.videoMessage;
                mediaType = "video";
            }

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Quoted message is not an image or video." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Extracting from the conceptual void... 👁️🔓" }, { quoted: msg });

                // Stream and download the decrypted media buffer using downloadContentFromMessage [2]
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Resend back as a regular, saveable message [2]
                if (mediaType === "image") {
                    await sock.sendMessage(jid, {
                        image: buffer,
                        caption: mediaMessage.caption || "Unlocked View Once Image 👁️🔓"
                    }, { quoted: msg });
                } else if (mediaType === "video") {
                    const mimeType = mediaMessage.mimetype || "video/mp4";
                    await sock.sendMessage(jid, {
                        video: buffer,
                        mimetype: mimeType,
                        caption: mediaMessage.caption || "Unlocked View Once Video 👁️🔓"
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error("View Once Unlock Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to unlock View Once media." }, { quoted: msg });
            }
        }
    },

    // 9. STANDARD STICKER CONVERTER (.sticker / .s) (Polymorphic Media Detection & Compiled WebP Output) [2]
    {
        name: 'sticker',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            
            // Extract the core media payload, handling standard and ephemeral/view-once wrappers [2]
            let mediaContent = getRawMessage(quoted || msg.message);
            
            let mediaMessage = null;
            let mediaType = "";

            if (mediaContent?.imageMessage) {
                mediaMessage = mediaContent.imageMessage;
                mediaType = "image";
            } else if (mediaContent?.videoMessage) {
                mediaMessage = mediaContent.videoMessage;
                mediaType = "video";
            } else if (mediaContent?.stickerMessage) {
                mediaMessage = mediaContent.stickerMessage;
                mediaType = "sticker";
            }

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to or attach an image or short video." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Formulating sticker... 📃" }, { quoted: msg });

                const mimeType = mediaMessage.mimetype || (mediaType === "image" ? "image/jpeg" : (mediaType === "sticker" ? "image/webp" : "video/mp4"));

                // Download the media stream directly from keys [2]
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Compile the media buffer to a WebP sticker natively using wa-sticker-formatter [2]
                const sticker = new Sticker(buffer, {
                    pack: settings.packName,
                    author: settings.author,
                    type: StickerTypes.FULL,
                    quality: 75
                });

                const stickerBuffer = await sticker.toBuffer();

                // Send the compiled WebP sticker [2]
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });

            } catch (error) {
                console.error("Sticker Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to convert media to sticker." }, { quoted: msg });
            }
        }
    },

    // 10. CROPPED SQUARE STICKER (.crop) (Upgraded to crop GIFs, Images, & Stickers) [2]
    {
        name: 'crop',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const isMedia = msg.message.imageMessage || msg.message.videoMessage || quoted?.imageMessage || quoted?.videoMessage || quoted?.stickerMessage;

            if (!isMedia) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to or attach an image, gif/video, or sticker to crop." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Cropping to square... 📐" }, { quoted: msg });

                let mediaContent = getRawMessage(quoted || msg.message);
                let mediaType = mediaContent?.imageMessage ? "image" : (mediaContent?.videoMessage ? "video" : (mediaContent?.stickerMessage ? "sticker" : ""));

                const targetMessage = mediaType === "image" ? mediaContent.imageMessage : (mediaType === "video" ? mediaContent.videoMessage : mediaContent.stickerMessage);
                const mimeType = targetMessage.mimetype || (mediaType === "image" ? "image/jpeg" : (mediaType === "video" ? "video/mp4" : "image/webp"));

                // Download original stream [2]
                const stream = await downloadContentFromMessage(targetMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Crop the buffer natively to a square sticker using wa-sticker-formatter [2]
                const sticker = new Sticker(buffer, {
                    pack: settings.packName,
                    author: settings.author,
                    type: StickerTypes.CROPPED, // Natively center-crops [2]
                    quality: 75
                });

                const stickerBuffer = await sticker.toBuffer();

                // Send the compiled cropped WebP sticker [2]
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });

            } catch (error) {
                console.error("Crop Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to generate cropped sticker." }, { quoted: msg });
            }
        }
    },

    // 11. METADATA STEALER (.take / .steal) (Upgraded with direct EXIF compilation) [2]
    {
        name: 'take',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);
            const isSticker = rawContent?.stickerMessage;

            if (!isSticker) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to the sticker you want to steal/take." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Stealing metadata... 🥷" }, { quoted: msg });

                const targetMessage = rawContent.stickerMessage;

                // Download sticker stream [2]
                const stream = await downloadContentFromMessage(targetMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Parse custom name/publisher from arguments (Falls back to settings if not provided) [2]
                const parts = args.split('|');
                const packName = parts[0] ? parts[0].trim() : settings.packName;
                const publisher = parts[1] ? parts[1].trim() : settings.author;

                // Re-compile the WebP buffer with new metadata [2]
                const sticker = new Sticker(buffer, {
                    pack: packName,
                    author: publisher,
                    type: StickerTypes.FULL,
                    quality: 100 // Preserves original quality
                });

                const stickerBuffer = await sticker.toBuffer();

                // Send the modified sticker [2]
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });

            } catch (error) {
                console.error("Take Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to customize sticker metadata." }, { quoted: msg });
            }
        }
    },

    // 12. STICKER COMMAND TRIGGERS (.setcmd) [2]
    {
        name: 'setcmd',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;

            // Restrict to Sudo/Owner to prevent system hijacking
            if (!isOwner && !isSudo) {
                return await sock.sendMessage(jid, { text: "❌ Access Denied. Only Owners and Sudo users can set sticker commands." }, { quoted: msg });
            }

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);
            const isSticker = rawContent?.stickerMessage;

            // List command triggers if no arguments are provided
            if (!args) {
                const keys = Object.keys(settings.stickerCommands || {});
                if (keys.length === 0) {
                    return await sock.sendMessage(jid, { 
                        text: `🔮 *Limitless Sticker Commands:*\n\n_No sticker commands registered._\n\n` +
                              `• Use \`${settings.prefix}setcmd <command>\` while replying to a sticker to map it.\n` +
                              `• Use \`${settings.prefix}setcmd del\` while replying to a sticker to delete it.`
                    }, { quoted: msg });
                }
                const list = keys.map((key, i) => `${i + 1}. \`${settings.stickerCommands[key]}\` (Hash: ${key.slice(0, 10)}...)`).join('\n');
                return await sock.sendMessage(jid, { text: `🔮 *Limitless Sticker Commands List:*\n\n${list}` }, { quoted: msg });
            }

            // Ensure our in-memory mappings are initialized [2]
            if (!settings.stickerCommands) {
                settings.stickerCommands = {};
            }

            const action = args.trim();

            if (action.toLowerCase() === 'list') {
                const keys = Object.keys(settings.stickerCommands);
                if (keys.length === 0) {
                    return await sock.sendMessage(jid, { text: "🔮 *No sticker commands currently registered.*" }, { quoted: msg });
                }
                const list = keys.map((key, i) => `${i + 1}. \`${settings.stickerCommands[key]}\` (Hash: ${key.slice(0, 10)}...)`).join('\n');
                return await sock.sendMessage(jid, { text: `🔮 *Limitless Sticker Commands List:*\n\n${list}` }, { quoted: msg });
            }

            // Requires replying to a sticker to add or delete a mapping [2]
            if (!isSticker) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a sticker with this command." }, { quoted: msg });
            }

            const fileHash = rawContent.stickerMessage.fileSha256?.toString('base64');
            if (!fileHash) {
                return await sock.sendMessage(jid, { text: "❌ Failed to read sticker file hash." }, { quoted: msg });
            }

            if (action.toLowerCase() === 'del' || action.toLowerCase() === 'delete' || action.toLowerCase() === 'remove') {
                if (!settings.stickerCommands[fileHash]) {
                    return await sock.sendMessage(jid, { text: "❌ This sticker does not have any assigned command." }, { quoted: msg });
                }
                const removedCmd = settings.stickerCommands[fileHash];
                delete settings.stickerCommands[fileHash];
                return await sock.sendMessage(jid, { text: `✅ Removed sticker command mapping for: \`${removedCmd}\`` }, { quoted: msg });
            }

            // Save the sticker mapping [2]
            settings.stickerCommands[fileHash] = action;
            await sock.sendMessage(jid, { text: `✅ Successfully assigned command \`${action}\` to this sticker.` }, { quoted: msg });
        }
    },

    // 13. REGULAR TO VIEW ONCE CONVERTER (.tovv) [2]
    {
        name: 'tovv',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);
            const isMedia = rawContent?.imageMessage || rawContent?.videoMessage;

            if (!isMedia) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to or attach an image or video." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Encrypting into a fleeting glimpse... 👁️🔒" }, { quoted: msg });

                const mediaType = rawContent.imageMessage ? "image" : "video";
                const targetMessage = rawContent.imageMessage || rawContent.videoMessage;
                const mimeType = targetMessage.mimetype || (mediaType === "image" ? "image/jpeg" : "video/mp4");

                // Download standard media stream [2]
                const stream = await downloadContentFromMessage(targetMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Construct View Once wrapper payload [2]
                const payload = {
                    caption: args || targetMessage.caption || "",
                    viewOnce: true // Wraps natively [2]
                };
                payload[mediaType] = buffer;
                payload.mimetype = mimeType;

                await sock.sendMessage(jid, payload, { quoted: msg });

            } catch (error) {
                console.error("ToVV Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to convert media to View Once." }, { quoted: msg });
            }
        }
    },

    // 14. MEDIA TO DIRECT WEB URL CONVERTER (.tourl / .url) (Restored with Multi-Host Fallback) [2]
    {
        name: 'tourl',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            
            const rawContent = getRawMessage(quoted || msg.message);
            
            let mediaMessage = null;
            let mediaType = "";

            if (rawContent?.imageMessage) { mediaMessage = rawContent.imageMessage; mediaType = "image"; }
            else if (rawContent?.videoMessage) { mediaMessage = rawContent.videoMessage; mediaType = "video"; }
            else if (rawContent?.stickerMessage) { mediaMessage = rawContent.stickerMessage; mediaType = "sticker"; }
            else if (rawContent?.audioMessage) { mediaMessage = rawContent.audioMessage; mediaType = "audio"; }
            else if (rawContent?.documentMessage) { mediaMessage = rawContent.documentMessage; mediaType = "document"; }

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to or attach an image, video, sticker, audio, or document." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Uploading to cloud storage... 🌐" }, { quoted: msg });

                // Stream and download the binary payload [2]
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const mimeType = mediaMessage.mimetype || "application/octet-stream";

                // Upload directly to Cloud using multi-host Pomf logic [2]
                const url = await uploadToCloud(buffer, mimeType);

                await sock.sendMessage(jid, {
                    text: `📦 *Limitless Cloud Link* 🌐\n\n` +
                          `• *Type:* \`${mediaType} (${mimeType.split('/')[1] || 'raw'})\`\n` +
                          `• *Direct URL:* ${url}`
                }, { quoted: msg });

            } catch (error) {
                console.error("ToURL Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to generate cloud link. Ensure your connection is stable." }, { quoted: msg });
            }
        }
    },

    // 15. PREFIXLESS SILENT KAMUI DM DECODER [2]
    {
        name: 'kamui',
        isPrefixless: true,
        execute: async (sock, msg, args, { senderNumber }) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            
            if (!quoted) {
                return; // Silent fail in public group chat [2]
            }
            
            const rawContent = getRawMessage(quoted);
            let mediaMessage = rawContent?.imageMessage || rawContent?.videoMessage;
            let mediaType = rawContent?.imageMessage ? "image" : (rawContent?.videoMessage ? "video" : "");
            
            if (!mediaMessage) {
                return; // Silent fail in public group chat [2]
            }

            try {
                // React with Obito's Sharingan/Kamui visual (the only public feedback) [2]
                await sock.sendMessage(jid, { react: { text: "🌀", key: msg.key } });

                // Download decrypted media stream [2]
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Destination: Target the exact, raw sender JID directly (handles standard and LID formats) [2]
                const targetDmJid = msg.key.participant || msg.key.remoteJid;
                
                if (mediaType === 'image') {
                    await sock.sendMessage(targetDmJid, { image: buffer, caption: "🌀 *Kamui:* Decoded View Once Image" });
                } else {
                    const mimeType = mediaMessage.mimetype || "video/mp4";
                    await sock.sendMessage(targetDmJid, { video: buffer, mimetype: mimeType, caption: "🌀 *Kamui:* Decoded View Once Video" });
                }

            } catch (e) {
                console.error("Kamui Error:", e.message);
                // Silent fail to preserve stealth [2]
            }
        }
    },

    // 16. VIEW ONCE UNLOCKER (.vv) [2]
    {
        name: 'vv',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a View Once image or video." }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);
            let mediaMessage = null;
            let mediaType = "";

            if (rawContent?.imageMessage) {
                mediaMessage = rawContent.imageMessage;
                mediaType = "image";
            } else if (rawContent?.videoMessage) {
                mediaMessage = rawContent.videoMessage;
                mediaType = "video";
            }

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Quoted message is not an image or video." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Extracting from the conceptual void... 👁️🔓" }, { quoted: msg });

                // Stream and download the decrypted media buffer [2]
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Resend back as a regular, saveable message [2]
                if (mediaType === "image") {
                    await sock.sendMessage(jid, {
                        image: buffer,
                        caption: mediaMessage.caption || "Unlocked View Once Image 👁️🔓"
                    }, { quoted: msg });
                } else if (mediaType === "video") {
                    const mimeType = mediaMessage.mimetype || "video/mp4";
                    await sock.sendMessage(jid, {
                        video: buffer,
                        mimetype: mimeType,
                        caption: mediaMessage.caption || "Unlocked View Once Video 👁️🔓"
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error("View Once Unlock Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to unlock View Once media." }, { quoted: msg });
            }
        }
    },

    // 17. BOT LATENCY COMPARISON TEST (.ping2) [2]
    {
        name: 'ping2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            // 1. Send the initial testing reply [2]
            await sock.sendMessage(jid, { text: "Testing..." }, { quoted: msg });

            // 2. Initialize the 8-character block loader message [2]
            const loadingMsg = await sock.sendMessage(jid, { text: "▮▯▯▯▯▯▯▯" }, { quoted: msg });

            // Generate the exact 8 frames programmatically [2]
            const frames = [];
            for (let i = 1; i <= 8; i++) {
                frames.push("▮".repeat(i) + "▯".repeat(8 - i));
            }

            // Loop and edit sequentially through all 8 frames with a 0.7 second delay [2]
            for (const frame of frames) {
                await sock.sendMessage(jid, { text: frame, edit: loadingMsg.key });
                await delay(700); // 0.7 seconds delay [2]
            }

            // 3. Calculate internal bot processing speed [2]
            const msgTime = msg.messageTimestamp * 1000;
            const botSpeed = Date.now() - msgTime;

            // 4. Update the loading message with the final internal latency [2]
            await sock.sendMessage(jid, {
                text: `Latency: \`${botSpeed}ms\``,
                edit: loadingMsg.key
            });
        }
    }
];

// Add structural aliases manually [2]
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') {
        module.exports.push({ ...cmd, name: 's' });
    }
    if (cmd.name === 'take') {
        module.exports.push({ ...cmd, name: 'steal' });
    }
    if (cmd.name === 'tourl') {
        module.exports.push({ ...cmd, name: 'url' });
    }
    if (cmd.name === 'delete') {
        module.exports.push({ ...cmd, name: 'del' });
    }
});
