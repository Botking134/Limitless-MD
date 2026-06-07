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

// Global bank details wizard session tracker
global.azaSessions = global.azaSessions || {};

// Global song search and download sessions
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};

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

// Unified Message Deletion Logger Helper
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
                console.log('❌ Session logged out. Please clear session_auth/ directory and re-pair.');
                process.exit(1);
            } else {
                console.log('🔄 Reconnecting system socket engine immediately...');
                startBot();
            }
        } else if (connection === 'open') {
            console.log(`\n========================================`);
            console.log(`✅ ${settings.botName.toUpperCase()} IS ONLINE AND OPERATIONAL`);
            console.log(`========================================\n`);
        }
    });

    // Main Stream Event Handler
    sock.ev.on('messages.upsert', async (m) => {
        try {
            if (m.type !== 'notify') return;
            const msg = m.messages[0];
            if (!msg.message) return;

            const jid = msg.key.remoteJid;
            
            // Auto View Status feature handling
            if (jid === 'status@broadcast') {
                if (settings.autoviewstatus === 'on') {
                    try {
                        await sock.readMessages([msg.key]);
                        console.log(`👁️ [STATUS] Natively viewed status from: ${msg.pushName || 'Unknown Contact'}`);
                        if (settings.statusemoji && settings.statusemoji !== 'off') {
                            await sock.sendMessage(jid, { react: { text: settings.statusemoji, key: msg.key } }, { statusForward: true });
                        }
                    } catch (statusErr) {
                        console.error("Auto Status Reader Error:", statusErr.message);
                    }
                }
                return;
            }

            if (msg.key.fromMe) return;

            // --- ANTI-PM INTERCEPTOR LOGIC ---
            const isPrivateChat = !jid.endsWith('@g.us');
            const senderCleanNum = jid.split('@')[0];
            const isOwnerOrSudo = settings.ownerNumber.includes(senderCleanNum) || 
                                  (settings.owners || []).includes(senderCleanNum) || 
                                  (settings.sudo || []).includes(senderCleanNum) ||
                                  (settings.devs || []).includes(senderCleanNum);

            if (settings.antipm && isPrivateChat && !isOwnerOrSudo) {
                try {
                    await sock.sendMessage(jid, { text: "🚫 *System Guard:* Private Message Protection mode is active. You have been automatically blocked." });
                    await sock.updateBlockStatus(jid, 'block');
                    console.log(`🛡️ [ANTI-PM] Instantly blocked user: ${jid}`);
                    return; // Halt execution chain entirely
                } catch (blockErr) {
                    console.error("❌ Failed to enforce Anti-PM block sequence:", blockErr.message);
                }
            }
            // ----------------------------------

            // In-memory message store mapping for Anti-delete tools
            const msgId = msg.key.id;
            if (!global.messageStore[jid]) global.messageStore[jid] = {};
            global.messageStore[jid][msgId] = JSON.parse(JSON.stringify(msg));

            // Clean data up regularly to prevent high RAM memory leak crashes
            const keys = Object.keys(global.messageStore[jid]);
            if (keys.length > 200) {
                delete global.messageStore[jid][keys[0]];
            }

            // Route execution if standard text structure is found
            const rawContent = getRawMessage(msg.message);
            const textContent = rawContent?.conversation || 
                                rawContent?.extendedTextMessage?.text || 
                                rawContent?.imageMessage?.caption || 
                                rawContent?.videoMessage?.caption || 
                                '';

            const trimmedMessage = textContent.trim();
            
            // Check for Protocol Message Deletions
            if (rawContent?.protocolMessage?.type === 3 || rawContent?.protocolMessage?.type === 'REVOKE') {
                const deletedKey = rawContent.protocolMessage.key;
                if (deletedKey) {
                    const chatId = deletedKey.remoteJid;
                    const savedMessageInstance = global.messageStore[chatId]?.[deletedKey.id];
                    if (savedMessageInstance) {
                        const revoker = msg.key.participant || msg.key.remoteJid || '';
                        await handleMessageDeletion(sock, savedMessageInstance, chatId, revoker);
                    }
                }
                return;
            }

            // Identify variables needed for security handlers
            const isGroup = jid.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            let isDev = settings.devs.includes(senderNumber) || (msg.key.hasLid && settings.devLids.includes(senderJid));
            let isOwner = settings.ownerNumber.includes(senderNumber) || (settings.owners || []).includes(senderNumber);
            let isSudo = (settings.sudo || []).includes(senderNumber);
            let isAuthorized = isOwner || isSudo || isDev;

            // Dynamic Anti-link / Anti-tag protections check
            if (isGroup && !isAuthorized) {
                const groupMetadata = await sock.groupMetadata(jid);
                const admins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                const isSenderAdmin = admins.includes(senderJid);

                if (!isSenderAdmin) {
                    // 1. Antilink validation
                    const activeAntilinkAction = settings.antilink?.[jid];
                    if (activeAntilinkAction && activeAntilinkAction !== 'off') {
                        const linkRegex = /chat\.whatsapp\.com\/[a-zA-Z0-9]{20,26}/i;
                        if (linkRegex.test(trimmedMessage)) {
                            console.log(`🛡️ [ANTILINK] Caught group invitation link in chat: ${jid}`);
                            try {
                                await sock.sendMessage(jid, { delete: msg.key });
                                if (activeAntilinkAction === 'kick') {
                                    await sock.groupParticipantsUpdate(jid, [senderJid], 'remove');
                                } else if (activeAntilinkAction === 'warn') {
                                    const warnKey = `${jid}_${senderNumber}`;
                                    settings.warns = settings.warns || {};
                                    settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
                                    saveSettings(settings);
                                    
                                    if (settings.warns[warnKey] >= 5) {
                                        await sock.sendMessage(jid, { text: `🚫 @${senderNumber} reached maximum warning threshold (5/5). Executing termination sequence.`, mentions: [senderJid] });
                                        await sock.groupParticipantsUpdate(jid, [senderJid], 'remove');
                                        delete settings.warns[warnKey];
                                        saveSettings(settings);
                                    } else {
                                        await sock.sendMessage(jid, { text: `⚠️ @${senderNumber} links are prohibited here! Warning Issued: (${settings.warns[warnKey]}/5)`, mentions: [senderJid] });
                                    }
                                }
                                return; // Kill stream immediately
                            } catch (linkActionErr) {
                                console.error("Antilink action enforcement failed:", linkActionErr.message);
                            }
                        }
                    }

                    // 2. Antitag validation
                    const isAntitagActive = settings.antitag?.[jid] === 'on';
                    const contextInfo = rawContent?.extendedTextMessage?.contextInfo || rawContent?.imageMessage?.contextInfo || rawContent?.videoMessage?.contextInfo;
                    if (isAntitagActive && contextInfo) {
                        const mentionsCount = contextInfo.mentionedJid?.length || 0;
                        const isMassMention = mentionsCount >= (groupMetadata.participants.length * 0.7) || contextInfo.mentionedJid?.includes(jid);
                        
                        if (isMassMention) {
                            console.log(`🛡️ [ANTITAG] Mass-mention behavior caught in chat: ${jid}`);
                            try {
                                await sock.sendMessage(jid, { delete: msg.key });
                                await sock.groupParticipantsUpdate(jid, [senderJid], 'remove');
                                return;
                            } catch (tagActionErr) {
                                console.error("Antitag enforcement kick failed:", tagActionErr.message);
                            }
                        }
                    }
                }
            }

            // Parse Prefix execution mechanics
            let command = null;
            let args = '';

            const activePrefix = settings.prefix || '⚡';
            if (trimmedMessage.startsWith(activePrefix)) {
                const withoutPrefix = trimmedMessage.slice(activePrefix.length).trim();
                const firstSpaceIndex = withoutPrefix.indexOf(' ');
                
                if (firstSpaceIndex !== -1) {
                    command = activePrefix + withoutPrefix.slice(0, firstSpaceIndex).toLowerCase();
                    args = withoutPrefix.slice(firstSpaceIndex + 1).trim();
                } else {
                    command = activePrefix + withoutPrefix.toLowerCase();
                    args = '';
                }
            } else {
                // Parse Prefixless commands registry directly
                const firstSpaceIndex = trimmedMessage.indexOf(' ');
                let cleanWord = firstSpaceIndex !== -1 ? trimmedMessage.slice(0, firstSpaceIndex).toLowerCase() : trimmedMessage.toLowerCase();
                
                if (commands[cleanWord]) {
                    command = cleanWord;
                    args = firstSpaceIndex !== -1 ? trimmedMessage.slice(firstSpaceIndex + 1).trim() : '';
                }
            }

            // Chatbot automation triggers fallback
            if (!command && settings.lizzyChats && settings.lizzyChats.includes(jid)) {
                const isChatbotActive = true;
                let isMentioningBot = false;
                let isReplyingToBot = false;

                const botCleanJid = sock.user.id ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : '';
                const botCleanLid = sock.user.id ? (sock.user.id.split(':')[1] ? sock.user.id.split(':')[0]+'@lid' : '') : '';

                const mentionedJids = rawContent?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                if (botCleanJid && mentionedJids.includes(botCleanJid)) isMentioningBot = true;
                if (botCleanLid && mentionedJids.includes(botCleanLid)) isMentioningBot = true;

                const quotedMsgContext = rawContent?.extendedTextMessage?.contextInfo;
                if (quotedMsgContext && quotedMsgContext.stanzaId) {
                    if (botSentMessageIds.has(quotedMsgContext.stanzaId)) {
                        isReplyingToBot = true;
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

            // Global Bot Privacy Mode Guard (Owner & Sudo Authorized Only in Private Mode)
            if (command) {
                const isPublicMode = settings.isPublic ?? false;
                if (!isPublicMode && !isAuthorized) {
                    return; // Silently ignore unauthorized executions
                }
            }

            console.log(`⚙️ [PARSER] Triggering command: \"${command}\"`);

            if (commands[command]) {
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
