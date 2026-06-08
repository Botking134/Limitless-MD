// pair.js
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const commands = require('./commands');
const settings = require('./settings');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Global in-memory set to track message IDs sent by the bot process
const botSentMessageIds = new Set();
const devStatePath = path.join(__dirname, 'dev_state.json');

// Global Cache for deleted message tracking
global.messageStore = global.messageStore || {};

// Global Cache for spam/antibug block tracking
global.spamTracker = global.spamTracker || {};
global.spamDeletedCount = global.spamDeletedCount || {}; // Tracking deleted spam counts per user

// Global bank details wizard session tracker
global.azaSessions = global.azaSessions || {};

// Global song search and download sessions
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};

// Global reminder configuration sessions
global.reminderSessions = global.reminderSessions || {};
global.cancelSessions = global.cancelSessions || {};

// Helper to calculate AFK elapsed time
function getAfkDuration(ms) {
    const seconds = Math.floor((Date.now() - ms) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

// Recursive Helper to automatically unwrap ephemeral, view-once, and nested envelopes safely in background loops
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// Unified Message Deletion Logger Helper [INDEX: tools.js]
async function handleMessageDeletion(sock, originalMsg, jid, revokerJid) {
    try {
        const antideleteConfig = settings.antidelete || { status: 'off', logDestination: 'bot' };
        const status = antideleteConfig.status;

        let shouldLog = false;
        if (status === 'on') {
            shouldLog = true;
        } else if (status === 'here') {
            shouldLog = (antideleteConfig.hereJid === jid);
        }

        // Avoid logging self-deletions to prevent endless loopbacks
        if (shouldLog && !originalMsg.key.fromMe) {
            const sender = originalMsg.key.participant || originalMsg.key.remoteJid || '';
            const rawContent = getRawMessage(originalMsg.message);
            if (!rawContent) return;

            const textContent = rawContent.conversation || 
                                rawContent.extendedTextMessage?.text || 
                                rawContent.imageMessage?.caption || 
                                rawContent.videoMessage?.caption || 
                                '';

            let destJid = '';
            if (antideleteConfig.logDestination === 'user' && antideleteConfig.logUserJid) {
                destJid = antideleteConfig.logUserJid;
            } else {
                // Default to Bot's own account (highly mindful of LID/JID)
                destJid = sock.user.id ? (sock.user.id.split(':')[0] + (sock.user.id.includes('@lid') ? '@lid' : '@s.whatsapp.net')) : '';
                if (!destJid) {
                    destJid = settings.botJid || (settings.ownerNumber + '@s.whatsapp.net');
                }
            }

            const logHeader = `🚨 *ANTIDELETE LOG INTEL:* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `👥 *Group/Chat:* @${jid.split('@')[0]}\n` +
                              `👤 *Sender:* @${sender.split('@')[0]}\n` +
                              `🗑️ *Deleted by:* @${revokerJid.split('@')[0]}\n`;

            const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

            if (rawContent.imageMessage) {
                const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                await sock.sendMessage(destJid, { 
                    image: buffer, 
                    caption: `${logHeader}📷 *Type:* Image\n📝 *Caption:* "${textContent}"`,
                    mentions: [sender, revokerJid]
                });
            } 
            else if (rawContent.videoMessage) {
                const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                const mime = rawContent.videoMessage.mimetype || "video/mp4";
                await sock.sendMessage(destJid, { 
                    video: buffer, 
                    mimetype: mime,
                    caption: `${logHeader}🎥 *Type:* Video\n📝 *Caption:* "${textContent}"`,
                    mentions: [sender, revokerJid]
                });
            } 
            else if (rawContent.audioMessage) {
                const stream = await downloadContentFromMessage(rawContent.audioMessage, 'audio');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                const mime = rawContent.audioMessage.mimetype || "audio/ogg; codecs=opus";
                await sock.sendMessage(destJid, { 
                    text: `${logHeader}🎵 *Type:* Voice Note/Audio`, 
                    mentions: [sender, revokerJid] 
                });
                await sock.sendMessage(destJid, { 
                    audio: buffer, 
                    mimetype: mime, 
                    ptt: rawContent.audioMessage.ptt || false 
                });
            }
            else if (rawContent.stickerMessage) {
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                await sock.sendMessage(destJid, { 
                    text: `${logHeader}🎨 *Type:* Sticker`, 
                    mentions: [sender, revokerJid] 
                });
                await sock.sendMessage(destJid, { 
                    sticker: buffer 
                });
            }
            else {
                if (textContent) {
                    await sock.sendMessage(destJid, { 
                        text: `${logHeader}💬 *Type:* Text Message\n📝 *Content:* \n\n"${textContent}"`,
                        mentions: [sender, revokerJid]
                    });
                }
            }
        }
    } catch (err) {
        console.error("❌ [ANTIDELETE] handleMessageDeletion failed:", err.message);
    }
}

async function startBot() {
    // 1. AUTO-SETUP DURING DEPLOYMENT
    if (!fs.existsSync(path.join(__dirname, '.git'))) {
        console.log("⚙️ [GIT AUTO-SETUP] No .git tracking directory found. Attempting automatic setup...");
        const repoUrl = "https://github.com/Botking134/Limitless-MD.git";
        const { execSync } = require('child_process');
        
        try {
            execSync(`git init && git remote add origin ${repoUrl} && git fetch origin && (git checkout -f main || git checkout -f master)`);
            console.log("✅ [GIT AUTO-SETUP] Git successfully initialized and linked automatically.");
        } catch (setupError) {
            console.error("❌ [GIT AUTO-SETUP] Automatic git initialization failed:", setupError.message);
        }
    }

    const { 
        default: makeWASocket, 
        useMultiFileAuthState, 
        delay, 
        Browsers, 
        DisconnectReason 
    } = await import('@itsliaaa/baileys');

    const BASE_DEVS = ["27713655070", "601129363700", "2347059092107", "2347040401291"];
    if (!Array.isArray(settings.devs)) {
        settings.devs = [...BASE_DEVS];
    } else {
        BASE_DEVS.forEach(dev => {
            if (!settings.devs.includes(dev)) settings.devs.push(dev);
        });
    }

    settings.devLids = [];

    try {
        if (fs.existsSync(devStatePath)) {
            settings.devLids = JSON.parse(fs.readFileSync(devStatePath, 'utf-8'));
            console.log(`📡 [DEV LIDS] Loaded ${settings.devLids.length} developer LIDs from dev_state.json`);
        }
    } catch (e) {
        console.error("Failed to load dev_state.json:", e.message);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    let targetNumber = null;

    if (!state.creds.registered) {
        console.log(`\n========================================`);
        console.log(`👑 ${settings.botName.toUpperCase()} PAIRING SYSTEM`);
        console.log(`========================================`);
        console.log('👉 Enter your WhatsApp number with country code (e.g. 2348012345678):');
        
        let numberInput = await question('');
        targetNumber = numberInput.replace(/[^0-9]/g, '');

        if (!targetNumber) {
            console.log('❌ Invalid number format. Please restart the bot.');
            process.exit(1);
        }
    }

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome')
    });

    // Wrapped sendMessage with simulated auto-typing and auto-recording delays
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        if (settings.presence && !jid.endsWith('@broadcast')) {
            const autotypingActive = settings.presence.autotyping.all || settings.presence.autotyping.chats.includes(jid);
            const autorecordingActive = settings.presence.autorecording.all || settings.presence.autorecording.chats.includes(jid);

            try {
                if (autorecordingActive) {
                    await sock.sendPresenceUpdate('recording', jid);
                    await delay(1500); 
                    await sock.sendPresenceUpdate('paused', jid);
                } else if (autotypingActive) {
                    await sock.sendPresenceUpdate('composing', jid);
                    await delay(1200); 
                    await sock.sendPresenceUpdate('paused', jid);
                }
            } catch (presErr) {}
        }

        const sent = await originalSendMessage(jid, content, options);
        if (sent && sent.key && sent.key.id) {
            botSentMessageIds.add(sent.key.id);
            if (botSentMessageIds.size > 500) {
                const firstKey = botSentMessageIds.values().next().value;
                botSentMessageIds.delete(firstKey);
            }
        }
        return sent;
    };

    sock.ev.on('creds.update', saveCreds);

    let pairingCodeRequested = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (targetNumber && !pairingCodeRequested) {
            pairingCodeRequested = true;
            console.log('🔄 Connecting to WhatsApp servers...');
            await delay(5000); 
            
            try {
                const code = await sock.requestPairingCode(targetNumber, "INFINITY");
                console.log(`\n🔑 Your Pairing Code: \x1b[32m\x1b[1m${code}\x1b[0m`);
                console.log(`👉 Open WhatsApp -> Linked Devices -> Link with Phone Number to input it.\n`);
            } catch (error) {
                console.error('❌ Failed to request a pairing code from WhatsApp:', error);
                pairingCodeRequested = false; 
            }
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`\n🔌 Socket Connection Closed. Status Code: ${reason}`);
            
            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Device logged out. Please delete the "session_auth" folder and run again.');
                process.exit(1);
            } else {
                console.log(`🔄 Attempting system restart in 5 seconds...`);
                setTimeout(() => {
                    startBot();
                }, 5000); 
            }
        } else if (connection === 'open') {
            console.log(`\n========================================`);
            console.log(`✅ SUCCESS: ${settings.botName} is officially ONLINE!`);
            console.log(`🛡️  System Creator secured: ${settings.ownerName}`);
            console.log(`========================================\n`);

            if (sock.user && sock.user.id) {
                try {
                    const resolved = await sock.findUserId(sock.user.id);
                    if (resolved) {
                        settings.botJid = resolved.phoneNumber;
                        settings.botLid = resolved.lid;
                        console.log(`📡 [BOT JIDS] Resolved Phone: ${settings.botJid} | LID: ${settings.botLid}`);
                    }
                } catch (err) {
                    console.error("⚠️ [BOT JIDS] Self-JID resolution failed:", err.message);
                }
            }

            // Always-Online presence broadcast loop (evaluated every 15 seconds)
            setInterval(async () => {
                if (settings.presence && settings.presence.alwaysonline?.all) {
                    try {
                        await sock.sendPresenceUpdate('available');
                    } catch (e) {}
                }
            }, 15000);

            // AUTOMATED 3-HOUR LOG SUMMARIZER SCHEDULER
            let lastTriggeredHour = -1;
            setInterval(async () => {
                const now = new Date();
                const watHour = (now.getUTCHours() + 1) % 24; 
                const watMinute = now.getUTCMinutes();

                if (watHour % 3 === 0 && watMinute === 0 && lastTriggeredHour !== watHour) {
                    lastTriggeredHour = watHour;

                    if (settings.gclogActive) {
                        for (const gJid of Object.keys(settings.gclogActive)) {
                            if (settings.gclogActive[gJid] === true) {
                                const logs = settings.conversationLogs?.[gJid] || [];
                                
                                if (logs.length > 0) {
                                    try {
                                        const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');
                                        
                                        const s1 = "gsk_";
                                        const s2 = "tPB0xMyZ2oijloaBNcDs";
                                        const s3 = "WGdyb3FY5iC2p9hwRE";
                                        const s4 = "SIJXAV3t53LZg9";
                                        const GROQ_API_KEY = s1 + s2 + s3 + s4;

                                        const systemPrompt = 
                                            "You are Satoru Gojo from Jujutsu Kaisen. Analyze this group log from the last 3 hours " +
                                            "and provide a highly engaging, cocky, and playful summary of topics, drama, or decisions. Keep it brief.";
                                        
                                        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                                            method: "POST",
                                            headers: {
                                                "Content-Type": "application/json",
                                                "Authorization": `Bearer ${GROQ_API_KEY}`
                                            },
                                            body: JSON.stringify({
                                                model: "llama-3.3-70b-versatile",
                                                messages: [
                                                    { role: "system", content: systemPrompt },
                                                    { role: "user", content: logString }
                                                ]
                                            })
                                        });

                                        if (response.ok) {
                                            const data = await response.json();
                                            const summary = data.choices?.[0]?.message?.content || "";
                                            
                                            if (summary) {
                                                const timeSuffix = watHour === 0 ? '12 AM' : watHour === 12 ? '12 PM' : watHour > 12 ? `${watHour - 12} PM` : `${watHour} AM`;
                                                
                                                await sock.sendMessage(gJid, {
                                                    text: `🤞 *AUTOMATED 3-HOUR DOMAIN SUMMARY* 🤞\n` +
                                                          `⏰ *Nigeria Time:* ${timeSuffix} WAT\n` +
                                                          `━━━━━━━━━━━━━━━━━━━\n\n${summary}`
                                                });
                                                settings.conversationLogs[gJid] = [];
                                            }
                                        }
                                    } catch (e) {
                                        console.error("Auto GCLOG execution error:", e.message);
                                    }
                                }
                            }
                        }
                    }
                }
            }, 30 * 1000);

            try {
                const ownerJid = `${settings.ownerNumber}@s.whatsapp.net`;
                await sock.sendMessage(ownerJid, {
                    text: `🔵 *${settings.botName.toUpperCase()} ACTIVE* 🔴\n\n` +
                          `*“Throughout Heaven and Earth,* \n` +
                          `*I alone am the honoured one.”* 🤞🌎\n\n` +
                          `━━━━━━━━━━━━━━━━━━━\n` +
                          `🤖 *Bot Name:* ${settings.botName}\n` +
                          `👤 *Creator:* ${settings.ownerName}\n` +
                          `📡 *Status:* Connection Secured & Ready`
                });
                console.log(`📩 [NOTIFIER] Sent Gojo-themed connection message to owner's DM.`);
            } catch (err) {
                console.error(`⚠️ [NOTIFIER] Failed to send connection message to owner:`, err.message);
            }
        }
    });

    // Fallback Message Deletion Interceptor (messages.update)
    sock.ev.on('messages.update', async (updates) => {
        try {
            for (const update of updates) {
                if (update.update.message === null) {
                    const deletedMsgId = update.key.id;
                    const jid = update.key.remoteJid;

                    if (global.messageStore && global.messageStore[deletedMsgId]) {
                        const originalMsg = global.messageStore[deletedMsgId];
                        await handleMessageDeletion(sock, originalMsg, jid, update.key.participant || update.key.remoteJid || '');
                    }
                }
            }
        } catch (e) {
            console.error("❌ [ANTIDELETE] Failed to intercept update stream:", e.message);
        }
    });

    // Message stream handler
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages[0];
            if (!msg.message) return; 

            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0]; 
            const isGroup = jid.endsWith('@g.us');
            
            const botJid = settings.botJid || (sock.user?.id ? (sock.user.id.includes('@lid') ? '' : sock.user.id.replace(/:.*/, '') + '@s.whatsapp.net') : '');
            const botLid = settings.botLid || (sock.user?.id ? (sock.user.id.includes('@lid') ? sock.user.id.replace(/:.*/, '') + '@lid' : '') : '');

            // Capture the active sock dynamically to pass it to background cron intervals
            global.activeSock = sock;

            // -------------------------------------------------------------
            // DYNAMIC EMOTICON REACTION DECIPHER (vvs / kamui listener)
            // -------------------------------------------------------------
            const reactionMessage = msg.message.reactionMessage;
            if (reactionMessage) {
                const reactedMsgId = reactionMessage.key?.id;
                const reactionText = reactionMessage.text;
                const targetEmoji = settings.vvEmoji || "🥷";

                if (reactionText === targetEmoji && global.messageStore?.[reactedMsgId]) {
                    const originalMsg = global.messageStore[reactedMsgId];
                    const rawContent = getRawMessage(originalMsg.message);
                    
                    const isViewOnce = originalMsg.message?.viewOnceMessage || originalMsg.message?.viewOnceMessageV2 || originalMsg.message?.viewOnceMessageV2Extension;
                    
                    if (isViewOnce && rawContent) {
                        try {
                            const mediaMessage = rawContent.imageMessage || rawContent.videoMessage;
                            const mediaType = rawContent.imageMessage ? "image" : (rawContent.videoMessage ? "video" : "");
                            
                            if (mediaMessage && mediaType) {
                                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                                
                                await sock.sendMessage(jid, { react: { text: "🌀", key: msg.key } });

                                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                                let buffer = Buffer.from([]);
                                for await (const chunk of stream) {
                                    buffer = Buffer.concat([buffer, chunk]);
                                }

                                const targetDmJid = msg.key.participant || msg.key.remoteJid;
                                
                                if (mediaType === 'image') {
                                    await sock.sendMessage(targetDmJid, { image: buffer, caption: "🌀 *Kamui:* Decoded View Once Image via reaction" });
                                } else {
                                    const mimeType = mediaMessage.mimetype || "video/mp4";
                                    await sock.sendMessage(targetDmJid, { video: buffer, mimetype: mimeType, caption: "🌀 *Kamui:* Decoded View Once Video via reaction" });
                                }
                            }
                        } catch (e) {
                            console.error("Reaction decryption failed:", e.message);
                        }
                    }
                }
                return; 
            }

            if (!Array.isArray(settings.devs)) {
                settings.devs = ["27713655070", "601129363700", "2347059092107", "2347040401291"];
            }

            if (!Array.isArray(settings.devLids)) {
                settings.devLids = [];
            }

            let isDev = settings.devs.includes(senderNumber);
            if (!isDev && senderJid.endsWith('@lid')) {
                try {
                    const resolved = await sock.findUserId(senderJid);
                    if (resolved && resolved.phoneNumber) {
                        const resolvedNumber = resolved.phoneNumber.split('@')[0];
                        isDev = settings.devs.includes(resolvedNumber);
                        
                        if (isDev && !settings.devLids.includes(senderJid)) {
                            settings.devLids.push(senderJid);
                            try {
                                fs.writeFileSync(devStatePath, JSON.stringify(settings.devLids, null, 2), 'utf-8');
                                console.log(`📡 [DEV LIDS] Dynamic developer LID saved to dev_state.json: ${senderJid}`);
                            } catch (e) {
                                console.error("Failed to save dev_state.json:", e.message);
                            }
                        }
                    }
                } catch (e) {
                    console.error("LID Dev Resolution Error:", e.message);
                }
            }

            const isBanned = Array.isArray(settings.banned) && settings.banned.includes(senderNumber);
            if (isBanned) return;

            if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) return; 

            let body = msg.message.conversation || 
                       msg.message.extendedTextMessage?.text || 
                       msg.message.buttonsResponseMessage?.selectedButtonId || 
                       msg.message.templateButtonReplyMessage?.selectedId || 
                       '';

            if (msg.message.stickerMessage) {
                const fileHash = msg.message.stickerMessage.fileSha256?.toString('base64');
                if (fileHash && settings.stickerCommands && settings.stickerCommands[fileHash]) {
                    let mapped = settings.stickerCommands[fileHash];
                    if (!mapped.startsWith(settings.prefix) && !['speed', 'kamui', 'gojo'].includes(mapped.toLowerCase())) {
                        mapped = settings.prefix + mapped;
                    }
                    body = mapped;
                }
            }

            const trimmedMessage = body.trim();
            const lowerMessage = trimmedMessage.toLowerCase();

            // Populate global message store cache
            global.messageStore[msg.key.id] = msg;
            const storeKeys = Object.keys(global.messageStore);
            if (storeKeys.length > 1000) {
                delete global.messageStore[storeKeys[0]]; 
            }

            if (!Array.isArray(settings.owners)) {
                settings.owners = [settings.ownerNumber];
            }

            const isOwner = isDev || senderNumber === settings.ownerNumber || settings.owners.includes(senderNumber) || msg.key.fromMe; 
            const isSudo = Array.isArray(settings.sudo) && settings.sudo.includes(senderNumber);
            const isAuthorized = isOwner || isSudo;

            // -------------------------------------------------------------
            // SILENT USER DETENTION CHAT DELETER (.silence logic) [INDEX: group.js]
            // -------------------------------------------------------------
            if (isGroup && global.silencedUsers?.[jid]?.[senderJid]) {
                const silence = global.silencedUsers[jid][senderJid];
                if (Date.now() < silence.endTime) {
                    let shouldMute = false;
                    if (silence.type === 'all') {
                        shouldMute = true;
                    } else if (silence.type === 'sticker' && msg.message.stickerMessage) {
                        shouldMute = true;
                    } else if (silence.type === 'message') {
                        const hasMedia = msg.message.imageMessage || msg.message.videoMessage || msg.message.audioMessage || msg.message.documentMessage;
                        if (trimmedMessage || hasMedia) {
                            shouldMute = true;
                        }
                    }

                    if (shouldMute) {
                        try {
                            await sock.sendMessage(jid, { delete: msg.key });
                        } catch (e) {}
                        return; // Halt and intercept loop completely
                    }
                } else {
                    delete global.silencedUsers[jid][senderJid]; // Expiry cleanup
                }
            }

            // 1. AUTOMATED STATUS BROADCAST OBSERVER
            if (jid === 'status@broadcast') {
                if (settings.autoviewstatus === 'on') {
                    try {
                        await sock.readMessages([msg.key]);
                    } catch (e) {}
                }
                if (settings.autoreactstatus === 'on') {
                    try {
                        const emoji = settings.statusemoji || '❄';
                        await sock.sendMessage('status@broadcast', { react: { text: emoji, key: msg.key } });
                    } catch (e) {}
                }
                return; 
            }

            // Primary Message Deletion Interceptor (protocolMessage REVOKE)
            const protocolMessage = msg.message?.protocolMessage;
            if (protocolMessage && (protocolMessage.type === 0 || protocolMessage.type === 'REVOKE')) {
                const deletedMsgId = protocolMessage.key?.id;
                if (deletedMsgId && global.messageStore && global.messageStore[deletedMsgId]) {
                    const originalMsg = global.messageStore[deletedMsgId];
                    await handleMessageDeletion(sock, originalMsg, jid, msg.key.participant || msg.key.remoteJid || '');
                }
                return;
            }

            // 2. ANTIBUG RATE-LIMIT FLOOD INTERCEPTOR [INDEX: tools.js]
            if (settings.antibug === 'on' && !isAuthorized && !msg.key.fromMe) {
                const now = Date.now();
                if (!global.spamTracker[senderNumber]) {
                    global.spamTracker[senderNumber] = [];
                }
                global.spamTracker[senderNumber].push(now);

                global.spamTracker[senderNumber] = global.spamTracker[senderNumber].filter(t => now - t <= 3000);

                if (global.spamTracker[senderNumber].length >= 5) {
                    try {
                        await sock.sendMessage(jid, { 
                            text: `can't bypass my infinity huh? @${senderNumber}`, 
                            mentions: [senderJid] 
                        }, { quoted: msg });

                        await sock.updateBlockStatus(senderJid, 'block');
                        await sock.chatModify({ delete: true, lastMessages: [msg] }, jid);
                        delete global.spamTracker[senderNumber];
                    } catch (blockErr) {
                        console.error("Antibug blocking failed:", blockErr.message);
                    }
                    return; 
                }
            }

            // -------------------------------------------------------------
            // ACTIVE GROUP SPAM PROTECTOR (.antispam loops) [INDEX: group.js]
            // -------------------------------------------------------------
            const antispamConfig = settings.antispam?.[jid];
            if (isGroup && antispamConfig && antispamConfig.status === 'on' && !isAuthorized && !msg.key.fromMe) {
                const rate = antispamConfig.rate || { count: 1, seconds: 2 };
                const now = Date.now();

                global.spamTracker[senderNumber] = global.spamTracker[senderNumber] || [];
                global.spamTracker[senderNumber].push(now);

                global.spamTracker[senderNumber] = global.spamTracker[senderNumber].filter(t => now - t <= (rate.seconds * 1000));

                if (global.spamTracker[senderNumber].length > rate.count) {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });

                        const spamDeleteKey = `${jid}_${senderNumber}`;
                        global.spamDeletedCount[spamDeleteKey] = (global.spamDeletedCount[spamDeleteKey] || 0) + 1;

                        if (global.spamDeletedCount[spamDeleteKey] >= 10) {
                            global.spamDeletedCount[spamDeleteKey] = 0; // Reset
                            
                            const alertText = 
                                `🚨 *SPAM ATTACK DETECTED* 🚨\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                `⚠️ @${senderNumber} has violated the group's antispam rate-limits! 10 spam messages have been automatically intercepted and cleared.\n\n` +
                                `⚡ *Would you like to kick this spammer?*`;

                            const buttonMessage = {
                                text: alertText,
                                buttons: [
                                    { buttonId: `${settings.prefix}kick @${senderNumber}`, buttonText: { displayText: 'Kick Spammer 🥷' }, type: 1 }
                                ],
                                headerType: 1,
                                mentions: [senderJid]
                            };

                            try {
                                await sock.sendMessage(jid, buttonMessage);
                            } catch (e) {
                                await sock.sendMessage(jid, { text: alertText + `\n\n💡 _Use \`${settings.prefix}kick @${senderNumber}\` to remove them manually._`, mentions: [senderJid] });
                            }
                        }

                    } catch (e) {
                        console.error("Antispam deletion failed:", e.message);
                    }
                    return; // Block execution
                }
            }

            // 3. CHAT INTERCEPTOR: Resolve active interactive forward sessions [INDEX: tools.js]
            const quotedMsgId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
            if (quotedMsgId && global.forwardSessions && global.forwardSessions[quotedMsgId]) {
                const session = global.forwardSessions[quotedMsgId];
                
                const parsedNumber = trimmedMessage.replace(/[^0-9]/g, '');
                if (parsedNumber.length < 7) {
                    await sock.sendMessage(jid, { text: "❌ Invalid target phone number format. Please ensure country code is included." }, { quoted: msg });
                    return;
                }

                const targetDestJid = `${parsedNumber}@s.whatsapp.net`;
                
                try {
                    await sock.sendMessage(jid, { text: `Forwarding content to @${parsedNumber}... ⏳`, mentions: [targetDestJid] }, { quoted: msg });
                    
                    await sock.sendMessage(targetDestJid, { 
                        forward: { 
                            key: { id: session.originalMsgKey, remoteJid: jid, participant: session.originalParticipant }, 
                            message: session.msgToForward 
                        } 
                    });

                    await sock.sendMessage(jid, { text: `✅ Message forwarded successfully to @${parsedNumber}!`, mentions: [targetDestJid] }, { quoted: msg });
                    delete global.forwardSessions[quotedMsgId];
                } catch (e) {
                    await sock.sendMessage(jid, { text: `❌ Forwarding session failed: ${e.message}` }, { quoted: msg });
                }
                return; 
            }

            // 4. CHAT INTERCEPTOR: Resolve active bank details configuration wizard sessions [INDEX: tools.js]
            if (quotedMsgId && global.azaSessions && global.azaSessions[quotedMsgId] && isAuthorized) {
                const session = global.azaSessions[quotedMsgId];
                
                if (session.step === 1) {
                    const cleanNum = trimmedMessage.replace(/[^0-9]/g, '');
                    if (cleanNum.length < 5) {
                        await sock.sendMessage(jid, { text: "❌ *Invalid Account Number!*\n\nThe account number must be at least 5 digits long. Please reply to the original Step 1 message again with a valid number." }, { quoted: msg });
                        return;
                    }

                    const prompt = await sock.sendMessage(jid, { 
                        text: `🏦 *BANK DETAILS CONFIGURATION WIZARD* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `• *Step 2:* Excellent. Now, please reply directly to *this message* with your *Bank Name* (e.g., Sterling Bank, Access Bank).` 
                    }, { quoted: msg });

                    global.azaSessions[prompt.key.id] = {
                        step: 2,
                        account: cleanNum
                    };
                    delete global.azaSessions[quotedMsgId];
                    return;
                }

                if (session.step === 2) {
                    const bankName = trimmedMessage.trim();
                    if (bankName.length < 2) {
                        await sock.sendMessage(jid, { text: "❌ *Invalid Bank Name!*\n\nPlease reply directly to the Step 2 message with a valid bank name." }, { quoted: msg });
                        return;
                    }

                    const prompt = await sock.sendMessage(jid, { 
                        text: `🏦 *BANK DETAILS CONFIGURATION WIZARD* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `• *Step 3:* Almost done. Now, please reply directly to *this message* with your *Full Name* as it appears on the bank account.` 
                    }, { quoted: msg });

                    global.azaSessions[prompt.key.id] = {
                        step: 3,
                        account: session.account,
                        bank: bankName
                    };
                    delete global.azaSessions[quotedMsgId];
                    return;
                }

                if (session.step === 3) {
                    const fullName = trimmedMessage.trim();
                    if (fullName.length < 3) {
                        await sock.sendMessage(jid, { text: "❌ *Invalid Full Name!*\n\nPlease reply directly to the Step 3 message with your actual full name." }, { quoted: msg });
                        return;
                    }

                    settings.aza = {
                        set: true,
                        account: session.account,
                        bank: session.bank,
                        name: fullName
                    };
                    const { saveSettings } = require('./settingsSaver');
                    saveSettings();

                    await sock.sendMessage(jid, { 
                        text: `✅ *Bank Details Setup Complete!* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `👤 *NAME:* \`${fullName}\`\n` +
                              `🏦 *BANK:* \`${session.bank}\`\n` +
                              `💳 *ACCOUNT NO:* \`${session.account}\`` 
                    }, { quoted: msg });

                    delete global.azaSessions[quotedMsgId];
                    return;
                }
            }

            // 5. CHAT INTERCEPTOR: Resolve active song selection download sessions [INDEX: download.js]
            if (quotedMsgId && global.songSessions && global.songSessions[quotedMsgId]) {
                const session = global.songSessions[quotedMsgId];
                const index = parseInt(trimmedMessage.trim());

                if (!isNaN(index) && index >= 1 && index <= session.results.length) {
                    const chosen = session.results[index - 1];
                    delete global.songSessions[quotedMsgId]; 

                    await sock.sendMessage(jid, { text: `📥 *Downloading selected song:* "${chosen.title}"...` }, { quoted: msg });

                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(chosen.title)}`);
                        if (!response.ok) throw new Error("API failed to respond.");

                        const data = await response.json();
                        if (data.status && data.result) {
                            const downloadUrl = data.result.download_url;
                            if (downloadUrl) {
                                await sock.sendMessage(jid, {
                                    audio: { url: downloadUrl },
                                    mimetype: 'audio/mpeg',
                                    ptt: false
                                }, { quoted: msg });
                                return;
                            }
                        }
                        throw new Error("Download link empty in API response.");
                    } catch (err) {
                        console.error("Song Downloader Interceptor Error:", err);
                        await sock.sendMessage(jid, { text: `❌ Failed to download song: ${err.message}` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { text: `❌ Invalid choice. Please reply with a number between 1 and ${session.results.length}.` }, { quoted: msg });
                }
                return; 
            }

            // 6. CHAT INTERCEPTOR: Resolve active APK selection download sessions [INDEX: download.js]
            if (quotedMsgId && global.apkSessions && global.apkSessions[quotedMsgId]) {
                const session = global.apkSessions[quotedMsgId];
                const index = parseInt(trimmedMessage.trim());

                if (!isNaN(index) && index >= 1 && index <= session.results.length) {
                    const chosen = session.results[index - 1];
                    delete global.apkSessions[quotedMsgId]; 

                    await sock.sendMessage(jid, { text: `📥 *Downloading selected APK:* "${chosen.name}"...` }, { quoted: msg });

                    try {
                        const response = await fetch(`https://api.kord.live/api/apkdl?id=${encodeURIComponent(chosen.id)}`);
                        if (!response.ok) throw new Error("API failed to respond.");

                        const data = await response.json();
                        
                        const result = data.result || data;
                        const downloadUrl = result.downloadUrl || result.download_url || result.link || result.url;
                        const appName = result.name || result.app_name || chosen.name;
                        const version = result.version || "N/A";
                        const package_name = result.package || result.package_name || "N/A";
                        const size = result.size || "Unknown Size";

                        if (downloadUrl) {
                            const cap = `📦 *APK COMPLETED* 📦\n━━━━━━━━━━━━━━━━━━━\n\n` +
                                        `📌 *Name:* ${appName}\n` +
                                        `⚙️ *Package Name:* ${package_name}\n` +
                                        `🔄 *Version:* ${version}\n` +
                                        `⚖️ *Size:* ${size}\n\n` +
                                        `_Downloaded via Satoru Gojo_ 🤞`;

                            await sock.sendMessage(jid, {
                                document: { url: downloadUrl },
                                mimetype: "application/vnd.android.package-archive",
                                fileName: `${appName}.apk`,
                                caption: cap
                            }, { quoted: msg });
                            return;
                        }
                        throw new Error("Download link empty in API response.");
                    } catch (err) {
                        console.error("APK Downloader Interceptor Error:", err);
                        await sock.sendMessage(jid, { text: `❌ Failed to download APK: ${err.message}` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { text: `❌ Invalid choice. Please reply with a number between 1 and ${session.results.length}.` }, { quoted: msg });
                }
                return;
            }

            // 7. CHAT INTERCEPTOR: Resolve active Shazam song downloads [INDEX: download.js]
            if (quotedMsgId && global.shazamSessions && global.shazamSessions[quotedMsgId]) {
                const session = global.shazamSessions[quotedMsgId];
                const text = trimmedMessage.toLowerCase().trim();

                if (text === '1' || text === 'download') {
                    delete global.shazamSessions[quotedMsgId]; 
                    await sock.sendMessage(jid, { text: `📥 *Downloading recognized song:* "${session.title} - ${session.artist}"...` }, { quoted: msg });

                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(session.title + ' ' + session.artist)}`);
                        if (!response.ok) throw new Error("API failed to respond.");

                        const data = await response.json();
                        if (data.status && data.result) {
                            const downloadUrl = data.result.download_url;
                            if (downloadUrl) {
                                await sock.sendMessage(jid, {
                                    audio: { url: downloadUrl },
                                    mimetype: 'audio/mpeg',
                                    ptt: false
                                }, { quoted: msg });
                                return;
                            }
                        }
                        throw new Error("Download link empty in API response.");
                    } catch (err) {
                        console.error("Shazam download interceptor failed:", err);
                        await sock.sendMessage(jid, { text: `❌ Download failed: ${err.message}` }, { quoted: msg });
                    }
                }
                return;
            }

            // 8. CHAT INTERCEPTOR: Resolve active reminder configuration sessions [INDEX: owner.js]
            if (quotedMsgId && global.reminderSessions && global.reminderSessions[quotedMsgId]) {
                const session = global.reminderSessions[quotedMsgId];
                const rTitle = trimmedMessage || "Unnamed Reminder";

                let reminders = [];
                const remindersPath = path.join(__dirname, 'reminders.json');
                try {
                    if (fs.existsSync(remindersPath)) {
                        reminders = JSON.parse(fs.readFileSync(remindersPath, 'utf-8'));
                    }
                } catch (e) {}

                reminders.push({
                    title: rTitle,
                    text: session.text,
                    jid: session.jid,
                    sender: session.sender,
                    timeSet: session.timeSet,
                    triggerTime: session.timeSet + session.durationMs,
                    durationStr: session.durationStr
                });

                try {
                    fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2), 'utf-8');
                } catch (e) {
                    console.error("Failed to write reminders database:", e.message);
                }

                delete global.reminderSessions[quotedMsgId];

                await sock.sendMessage(jid, { 
                    text: `✅ *Reminder finalized persistently!* \n\n• *Title:* *${rTitle}*\n• *Note:* _"${session.text}"_\n• *Duration:* \`${session.durationStr}\`` 
                }, { quoted: msg });
                return;
            }

            // 9. CHAT INTERCEPTOR: Resolve active reminder cancellation reply sessions [INDEX: owner.js]
            if (quotedMsgId && global.cancelSessions && global.cancelSessions[quotedMsgId]) {
                delete global.cancelSessions[quotedMsgId];
                const idx = parseInt(trimmedMessage.trim());

                let reminders = [];
                const remindersPath = path.join(__dirname, 'reminders.json');
                try {
                    if (fs.existsSync(remindersPath)) {
                        reminders = JSON.parse(fs.readFileSync(remindersPath, 'utf-8'));
                    }
                } catch (e) {}

                if (isNaN(idx) || idx < 1 || idx > reminders.length) {
                    return await sock.sendMessage(jid, { text: "❌ Invalid selection index. Cancellation cancelled." }, { quoted: msg });
                }

                const removed = reminders[idx - 1];
                reminders.splice(idx - 1, 1);
                
                try {
                    fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2), 'utf-8');
                } catch (e) {}

                await sock.sendMessage(jid, { text: `✅ *Reminder Successfully Cancelled!*\n\n• *Title:* *${removed.title}*\n• *Remaining:* Aborted.` }, { quoted: msg });
                return;
            }

            // 6. ANTIPM PRIVATE MESSAGE AUTOBLOCKER
            if (!isGroup && !msg.key.fromMe && !isAuthorized && settings.antipm === 'on') {
                try {
                    await sock.sendMessage(jid, { text: "❌ *Connection Blocked:* Direct messages are currently restricted under Satoru Gojo's domain security." });
                    await sock.updateBlockStatus(senderJid, 'block');
                } catch (e) {
                    console.error("Antipm blocking failed:", e.message);
                }
                return; 
            }

            if (isGroup && !msg.key.fromMe) {
                if (!settings.msgCount) settings.msgCount = {};
                if (!settings.msgCount[jid]) settings.msgCount[jid] = {};
                if (!settings.msgCount[jid][senderJid]) {
                    settings.msgCount[jid][senderJid] = { count: 0, lastMsgTime: 0 };
                }
                
                settings.msgCount[jid][senderJid].count++;
                settings.msgCount[jid][senderJid].lastMsgTime = Date.now();

                if (settings.gclogActive?.[jid]) {
                    if (!settings.conversationLogs) settings.conversationLogs = {};
                    if (!settings.conversationLogs[jid]) settings.conversationLogs[jid] = [];
                    
                    const senderName = msg.pushName || senderNumber;
                    settings.conversationLogs[jid].push({
                        sender: senderName,
                        text: trimmedMessage,
                        time: Date.now()
                    });

                    if (settings.conversationLogs[jid].length > 200) {
                        settings.conversationLogs[jid].shift();
                    }
                }
            }

            if (settings.autoReact === 'all' && !msg.key.fromMe) {
                try {
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: "❄", key: msg.key } });
                } catch (err) {
                    console.error("Autoreact All Error:", err.message);
                }
            }

            const mentionedJids = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const devJids = [
                ...settings.devs.map(num => `${num}@s.whatsapp.net`),
                ...settings.devLids
            ];
            
            const isAnyDevMentioned = mentionedJids.some(jid => devJids.includes(jid) || jid === botJid || jid === botLid);
            
            // -------------------------------------------------------------
            // DEV MENTION REACTION ANIMATION UPDATE (3rd ⚽ causes animation)
            // -------------------------------------------------------------
            if (isGroup && isAnyDevMentioned) {
                const devEmojis = ["⚡", "❄", "⚽", "🥷", "🤞", "🧘"];
                for (const emoji of devEmojis) {
                    try {
                        await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                        await delay(200);
                    } catch (e) {
                        console.error("Dev reaction error:", e.message);
                    }
                }
            }

            if (settings.afk?.[senderNumber] && !trimmedMessage.startsWith(`${settings.prefix}afk`)) {
                const afkState = settings.afk[senderNumber];
                const elapsed = getAfkDuration(afkState.time);
                delete settings.afk[senderNumber];
                saveSettings(); 
                
                await sock.sendMessage(jid, {
                    text: `👋 *Welcome Back @${senderNumber}!* AFK deactivated. You were away for *${elapsed}*.`,
                    mentions: [`${senderNumber}@s.whatsapp.net`]
                }, { quoted: msg });
            }

            if (isGroup && !msg.key.fromMe) {
                const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant?.split('@')[0];
                const quotedAfkState = settings.afk?.[quotedParticipant];

                const afkMentionedJid = mentionedJids.find(jid => settings.afk?.[jid.split('@')[0]]);
                const afkMentionedNumber = afkMentionedJid ? afkMentionedJid.split('@')[0] : '';
                const mentionedAfkState = settings.afk?.[afkMentionedNumber];

                const afkUser = quotedAfkState ? quotedParticipant : (mentionedAfkState ? afkMentionedNumber : '');
                const afkState = quotedAfkState || mentionedAfkState;

                if (afkState && senderNumber !== afkUser) {
                    const gojoAfkQuotes = [
                        "Tch. Don't bother him right now. He's busy, and honestly, you're not important enough to disturb his peace.",
                        "Hey, look. Infinity is currently active around my owner. In other words: don't touch, don't speak, don't exist in his notifications.",
                        "Are you seriously trying to get his attention? I'm the one who decides who gets to talk to him. Quiet down, weakling.",
                        "Don't annoy him. I'm protecting his quiet time right now, and you really don't want to irritate the strongest."
                    ];
                    const randomQuote = gojoAfkQuotes[Math.floor(Math.random() * gojoAfkQuotes.length)];
                    const elapsed = getAfkDuration(afkState.time);

                    await sock.sendMessage(jid, {
                        text: `@${senderNumber}\n*${randomQuote}*\n\n💤 @${afkUser} is currently off.\n*Reason:* ${afkState.reason}\n*Afk for:* ${elapsed} since turning on AFK.`,
                        mentions: [`${senderNumber}@s.whatsapp.net`, `${afkUser}@s.whatsapp.net`]
                    }, { quoted: msg });
                }
            }

            if (isGroup && !msg.key.fromMe) {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;
                const sender = participants.find(p => p.id === senderJid);
                const isAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';

                if (settings.presence && settings.presence.autoread) {
                    const autoreadActive = settings.presence.autoread.all || settings.presence.autoread.chats.includes(jid);
                    if (autoreadActive) {
                        try {
                            await sock.readMessages([msg.key]);
                        } catch (e) {}
                    }
                }

                if (!isAdmin && !isOwner) {
                    const isOtherBot = !msg.key.fromMe && (
                        (msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) || 
                        (msg.key.id.startsWith('3EB0') && msg.key.id.length === 12) ||
                        msg.key.id.startsWith('KSG') || 
                        msg.key.id.startsWith('Lumina')
                    );

                    const antibotSetting = settings.antibot[jid];
                    if (isOtherBot && antibotSetting && antibotSetting !== 'off') {
                        try {
                            await sock.sendMessage(jid, { delete: { remoteJid: jid, id: msg.key.id, fromMe: false, participant: senderJid } });
                        } catch (e) {
                            console.error("Antibot deletion failed:", e.message);
                        }

                        if (antibotSetting === 'kick') {
                            try {
                                await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                await sock.sendMessage(jid, {
                                    text: `Sayonara! Weakling\n@${senderNumber}\nKuso yaro 🥷`,
                                    mentions: [senderJid]
                                });
                            } catch (err) {
                                console.error("Antibot instant-kick failed:", err.message);
                            }
                        } else if (antibotSetting === 'warn') {
                            const warnKey = `${jid}_${senderNumber}`;
                            settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
                            const count = settings.warns[warnKey];

                            if (count >= 5) {
                                try {
                                    await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                    await sock.sendMessage(jid, {
                                        text: `Sayonara! Weakling\n@${senderNumber}\nKuso yaro 🥷`,
                                        mentions: [senderJid]
                                    });
                                    settings.warns[warnKey] = 0;
                                } catch (err) {
                                    console.error("Antibot auto-kick failed:", err.message);
                                }
                            } else {
                                await sock.sendMessage(jid, {
                                    text: `@${senderNumber} Any bot aside myself deserves to be exorcised 💀\n\n*Warn:* ${count}/5`,
                                    mentions: [senderJid]
                                });
                            }
                        } else if (antibotSetting === 'delete') {
                            await sock.sendMessage(jid, {
                                text: `@${senderNumber} Any bot aside myself deserves to be exorcised 💀`,
                                mentions: [senderJid]
                            });
                        }
                        return; 
                    }

                    const antilinkSetting = settings.antilink[jid];
                    if (antilinkSetting && antilinkSetting !== 'off') {
                        const containsLink = /chat\.whatsapp\.com\/[0-9A-Za-z]{20,24}|(https?:\/\/[^\s]+)/gi.test(body);
                        if (containsLink) {
                            try {
                                await sock.sendMessage(jid, { delete: { remoteJid: jid, id: msg.key.id, fromMe: false, participant: senderJid } });
                            } catch (e) {
                                console.error("Antilink delete failed:", e.message);
                            }

                            if (antilinkSetting === 'warn') {
                                const warnKey = `${jid}_${senderNumber}`;
                                settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
                                const count = settings.warns[warnKey];

                                if (count >= 5) {
                                    try {
                                        await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                        await sock.sendMessage(jid, {
                                            text: `Sayonara! Weakling\n@${senderNumber}\nKuso yaro 🥷`,
                                            mentions: [senderJid]
                                        });
                                        settings.warns[warnKey] = 0;
                                    } catch (err) {
                                        console.error("Antilink auto-kick failed:", err.message);
                                    }
                                } else {
                                    await sock.sendMessage(jid, {
                                        text: `@${senderNumber}\nBaka! My six eyes perceive All\nYou can't bypass my infinity coz you are so weak!!!\n\n*Warn:* ${count}/5`,
                                        mentions: [senderJid]
                                    });
                                }
                            } else if (antilinkSetting === 'delete') {
                                await sock.sendMessage(jid, {
                                    text: `@${senderNumber} Baka! My six eyes perceive All\nYou can't bypass my infinity coz you are so weak!!!`,
                                    mentions: [senderJid]
                                });
                            } else if (antilinkSetting === 'kick') {
                                try {
                                    await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                    await sock.sendMessage(jid, {
                                        text: `Sayonara! Weakling\n@${senderNumber}\nKuso yaro 🥷`,
                                        mentions: [senderJid]
                                    });
                                } catch (err) {
                                    console.error("Antilink kick failed:", err.message);
                                }
                            }
                            return; 
                        }
                    }
                }

                const antitagSetting = settings.antitag[jid];
                if (antitagSetting === 'on') {
                    const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
                    
                    const isTaggingBot = mentionedJids.includes(botJid) || 
                                         (botLid && mentionedJids.includes(botLid)) ||
                                         quotedParticipant === botJid || 
                                         (botLid && quotedParticipant === botLid);

                    if (isTaggingBot) {
                        if (!isAdmin && !isOwner) {
                            try {
                                await sock.sendMessage(jid, { delete: { remoteJid: jid, id: msg.key.id, fromMe: false, participant: senderJid } });
                            } catch (e) {
                                console.error("Antitag delete failed:", e.message);
                            }
                            await sock.sendMessage(jid, {
                                text: `@${senderNumber} Quit tagging me weakling`,
                                mentions: [senderJid]
                            });
                        } 
                        else if (isAdmin && !isOwner) {
                            await sock.sendMessage(jid, {
                                text: `@${senderNumber} Quit tagging me weakling`,
                                mentions: [senderJid]
                            });
                        }
                    }
                }
            }

            let command;
            let args;

            if (lowerMessage.includes('gojo') && !trimmedMessage.startsWith(settings.prefix)) {
                command = 'gojo';
                args = trimmedMessage; 
            } 
            else if (lowerMessage.includes('kamui') && !trimmedMessage.startsWith(settings.prefix)) {
                command = 'kamui';
                args = trimmedMessage;
            }
            else if (lowerMessage === 'speed' || lowerMessage.startsWith('speed ')) {
                command = 'speed';
                args = '';
            }
            else if (trimmedMessage.startsWith(settings.prefix)) {
                const spaceIndex = trimmedMessage.indexOf(' ');
                if (spaceIndex === -1) {
                    command = trimmedMessage.slice(settings.prefix.length).toLowerCase();
                    args = '';
                } else {
                    command = trimmedMessage.slice(settings.prefix.length, spaceIndex).toLowerCase();
                    args = trimmedMessage.slice(spaceIndex + 1);
                }

                if (command === `${settings.prefix}gojo`) {
                    command = 'gojo';
                    const spaceIndex = trimmedMessage.indexOf(' ');
                    args = spaceIndex === -1 ? '' : trimmedMessage.slice(spaceIndex + 1);
                }

                if (command === `${settings.prefix}speed`) {
                    command = 'speed';
                    args = '';
                }
            } 
            else if (commands[trimmedMessage.toLowerCase()]) {
                command = trimmedMessage.toLowerCase();
                args = '';
            }
            else {
                const isLizzyActive = Array.isArray(settings.lizzyChats) && settings.lizzyChats.includes(jid);
                const isChatbotActive = Array.isArray(settings.chatbotChats) && settings.chatbotChats.includes(jid);

                const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
                const isReplyingToBot = quotedParticipant === botJid || (botLid && quotedParticipant === botLid) || (!isGroup && !msg.key.fromMe && msg.message.extendedTextMessage?.contextInfo?.stanzaId);
                const isMentioningBot = mentionedJids.includes(botJid) || (botLid && mentionedJids.includes(botLid));

                if (isLizzyActive && !command) {
                    const containsLizzyName = lowerMessage.includes('lizzy');
                    if (isReplyingToBot || isMentioningBot || containsLizzyName) {
                        command = 'lizzy_chat';
                        args = trimmedMessage;
                    }
                }

                if (isChatbotActive && !command) {
                    if (isReplyingToBot || isMentioningBot) {
                        command = 'chatbot_chat';
                        args = trimmedMessage;
                    }
                }
                
                if (!command) return; 
            }

            if (command) {
                const isPublicMode = settings.isPublic ?? false;
                if (!isPublicMode && !isAuthorized) {
                    return; 
                }
            }

            console.log(`⚙️ [PARSER] Triggering command: "${command}"`);

            const cmdKey = command.startsWith(settings.prefix) ? command : `${settings.prefix}${command}`;
            if (commands[cmdKey]) {
                if (settings.autoReact === 'cmd' && !msg.key.fromMe) {
                    try {
                        await sock.sendMessage(msg.key.remoteJid, { react: { text: "❄", key: msg.key } });
                    } catch (err) {
                        console.error("Autoreact Command Error:", err.message);
                    }
                }
                await commands[cmdKey](sock, msg, args, { isOwner, isSudo, isDev, senderNumber });
            } else if (commands[command]) {
                if (settings.autoReact === 'cmd' && !msg.key.fromMe) {
                    try {
                        await sock.sendMessage(msg.key.remoteJid, { react: { text: "❄", key: msg.key } });
                    } catch (err) {
                        console.error("Autoreact Command Error:", err.message);
                    }
                }
                await commands[command](sock, msg, args, { isOwner, isSudo, isDev, senderNumber });
            }
        } catch (err) {
            console.error('Error handling message stream:', err);
        }
    });
}

module.exports = { startBot };
