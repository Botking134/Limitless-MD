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

// Helper to calculate AFK elapsed time
function getAfkDuration(ms) {
    const seconds = Math.floor((Date.now() - ms) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
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

    // Dynamically import the ES Module version of Baileys
    const { 
        default: makeWASocket, 
        useMultiFileAuthState, 
        delay, 
        Browsers, 
        DisconnectReason 
    } = await import('@itsliaaa/baileys');

    // DYNAMIC DEV MEMORY MERGE
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

    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
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

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages[0];
            if (!msg.message) return; 

            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0]; 
            const isGroup = jid.endsWith('@g.us');
            
            const botJid = settings.botJid || (sock.user.id.includes('@lid') ? '' : sock.user.id.replace(/:.*/, '') + '@s.whatsapp.net');
            const botLid = settings.botLid || (sock.user.id.includes('@lid') ? sock.user.id.replace(/:.*/, '') + '@lid' : '');

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
            if (isBanned) {
                return;
            }

            if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) {
                return; 
            }

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

            // REAL-TIME USER ACTIVITY TRACKER (.msgs / Active / Inactive logs)
            if (isGroup && !msg.key.fromMe) {
                if (!settings.msgCount) settings.msgCount = {};
                if (!settings.msgCount[jid]) settings.msgCount[jid] = {};
                if (!settings.msgCount[jid][senderJid]) {
                    settings.msgCount[jid][senderJid] = { count: 0, lastMsgTime: 0 };
                }
                
                settings.msgCount[jid][senderJid].count++;
                settings.msgCount[jid][senderJid].lastMsgTime = Date.now();

                // REAL-TIME GROUP CONVERSATION LOGS FOR .gclog
                if (settings.gclogActive?.[jid]) {
                    if (!settings.conversationLogs) settings.conversationLogs = {};
                    if (!settings.conversationLogs[jid]) settings.conversationLogs[jid] = [];
                    
                    const senderName = msg.pushName || senderNumber;
                    settings.conversationLogs[jid].push({
                        sender: senderName,
                        text: trimmedMessage,
                        time: Date.now()
                    });

                    // Keep memory optimized: store last 200 logs
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
            const isAnyDevMentioned = mentionedJids.some(jid => devJids.includes(jid));
            
            if (isGroup && isAnyDevMentioned) {
                const devEmojis = ["⚡", "❄", "🥷", "🤞", "🧘"];
                for (const emoji of devEmojis) {
                    try {
                        await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                        await delay(200);
                    } catch (e) {
                        console.error("Dev reaction error:", e.message);
                    }
                }
            }

            if (!Array.isArray(settings.owners)) {
                settings.owners = [settings.ownerNumber];
            }

            const isOwner = isDev || senderNumber === settings.ownerNumber || settings.owners.includes(senderNumber) || msg.key.fromMe; 
            const isSudo = Array.isArray(settings.sudo) && settings.sudo.includes(senderNumber);
            const isAuthorized = isOwner || isSudo;

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

                if (!isAdmin && !isOwner) {
                    const isOtherBot = !msg.key.fromMe && (
                        (msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) || 
                        (msg.key.id.startsWith('3EB0') && msg.key.id.length === 12) ||
                        msg.key.id.startsWith('KSG') || 
                        msg.key.id.startsWith('Lumina')
                    );

                    const antibotSetting = settings.antibot[jid];
                    if (isOtherBot && antibotSetting && antibotSetting !== 'off') {
                        console.log(`🤖 [ANTIBOT] Detected other bot: ${senderNumber} | Action: ${antibotSetting}`);
                        
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
                                    text: `@${senderNumber}\nBaka! My six eyes perceive All\nYou can't bypass my infinity coz you are so weak!!!`,
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

                // ANTITAG ACTION (Issue 1 Fixed: Separated so it runs for both admins & non-admins)
                const antitagSetting = settings.antitag[jid];
                if (antitagSetting === 'on') {
                    const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
                    
                    const isTaggingBot = mentionedJids.includes(botJid) || 
                                         (botLid && mentionedJids.includes(botLid)) ||
                                         quotedParticipant === botJid || 
                                         (botLid && quotedParticipant === botLid);

                    if (isTaggingBot) {
                        console.log(`🏷️ [ANTITAG] Tag detected from: ${senderNumber} (isAdmin: ${isAdmin})`);
                        
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

            if (lowerMessage.includes('gojo')) {
                command = 'gojo';
                args = trimmedMessage; 
            } 
            else if (lowerMessage.includes('kamui')) {
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
                    command = trimmedMessage.toLowerCase();
                    args = '';
                } else {
                    command = trimmedMessage.slice(0, spaceIndex).toLowerCase();
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
            } else {
                const isLizzyActive = Array.isArray(settings.lizzyChats) && settings.lizzyChats.includes(jid);
                if (isLizzyActive) {
                    const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
                    
                    const isReplyingToBot = quotedParticipant === botJid || (botLid && quotedParticipant === botLid) || (!isGroup && !msg.key.fromMe && msg.message.extendedTextMessage?.contextInfo?.stanzaId);
                    const isMentioningBot = mentionedJids.includes(botJid) || (botLid && mentionedJids.includes(botLid));
                    const containsLizzyName = lowerMessage.includes('lizzy');

                    if (isReplyingToBot || isMentioningBot || containsLizzyName) {
                        command = 'lizzy_chat';
                        args = trimmedMessage;
                    }
                }
                
                if (!command) return; 
            }

            console.log(`⚙️ [PARSER] Triggering command: "${command}"`);

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