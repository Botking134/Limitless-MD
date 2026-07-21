// pair.js
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { DEV_LIDS } = require('./plugins/devs');
const { handleDeletion } = require('./helpers/log');
const { handleIncomingMessage } = require('./helpers/Infinity');
const { normalizeToJid } = require('./stateManager');

// ─── READLINE FOR AUTH ──────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ─── TRACK BOT-SENT MESSAGES ──────────────────────────────────
const botSentMessageIds = new Set();

// ─── GLOBAL SESSIONS & CACHES ──────────────────────────────────
global.messageStore = global.messageStore || {};
global.spamTracker = global.spamTracker || {};
global.spamDeletedCount = global.spamDeletedCount || {};
global.azaSessions = global.azaSessions || {};
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};
global.noteSessions = global.noteSessions || {};

// Game Sessions
global.triviaSessions = global.triviaSessions || {};
global.charadeSessions = global.charadeSessions || {};
global.anagramSessions = global.anagramSessions || {};
global.wcgSessions = global.wcgSessions || {};
global.millionaireSessions = global.millionaireSessions || {};
global.torfSessions = global.torfSessions || {};
global.pvpSessions = global.pvpSessions || {};
global.escapeSessions = global.escapeSessions || {};
global.vault8Sessions = global.vault8Sessions || {};

// AI Memory
global.aiMemory = global.aiMemory || {};
global.botMessageAgents = global.botMessageAgents || {};

// Reconnection State Lock variables to prevent multiple concurrent instances
global.isReconnecting = global.isReconnecting || false;
global.reconnectAttempts = global.reconnectAttempts || 0;
global.reconnectTimeout = global.reconnectTimeout || null;

// ─── MAIN BOT STARTER ──────────────────────────────────────────

async function startBot() {
    const {
        default: makeWASocket,
        useMultiFileAuthState,
        delay,
        Browsers,
        DisconnectReason
    } = await import('@itsliaaa/baileys');

    // ─── AUTH STATE ────────────────────────────────────────────────
    const authFolder = path.join(__dirname, 'storage', 'session_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    let targetNumber = null;
    let pairingMode = false;

    // ─── AUTHENTICATION MENU ──────────────────────────────────────
    if (!state.creds.registered) {
        console.log(`
========================================
⚡ AUTHENTICATION REQUIRED
========================================
1. Request Pairing Code (Enter number)
2. Scan QR Code (Display QR)
========================================
`);
        let choice = await question('Select option (1 or 2): ');
        choice = choice.trim();

        if (choice === '1') {
            pairingMode = true;
            console.log('👉 Enter your WhatsApp number with country code:');
            let numberInput = await question('');
            targetNumber = numberInput.replace(/[^0-9]/g, '');
            if (!targetNumber) {
                console.log('❌ Invalid number. Restart and try again.');
                process.exit(1);
            }
            console.log(`\n⏳ Requesting pairing code for ${targetNumber}...\n`);
        } else if (choice === '2') {
            pairingMode = false;
            console.log('\n📱 QR mode selected. Waiting for QR to display...\n');
        } else {
            console.log('❌ Invalid option. Restart and choose 1 or 2.');
            process.exit(1);
        }
    }

    // ─── CREATE SOCKET ─────────────────────────────────────────────
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome')
    });

    // ─── OVERRIDE SEND MESSAGE WITH HUMANIZED DELAYS ────────────────
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        if (config.presence && !jid.endsWith('@broadcast')) {
            const autotypingActive = config.presence.autotyping?.all ||
                config.presence.autotyping?.chats?.includes(jid);
            const autorecordingActive = config.presence.autorecording?.all ||
                config.presence.autorecording?.chats?.includes(jid);
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
            } catch (presErr) { /* ignore dead socket */ }
        }

        let sent;
        try {
            sent = await originalSendMessage(jid, content, options);
        } catch (sendErr) {
            console.error("❌ [SOCKET] sendMessage failed on closed socket:", sendErr.message);
            throw sendErr;
        }

        if (sent && sent.key && sent.key.id) {
            botSentMessageIds.add(sent.key.id);
            if (botSentMessageIds.size > 500) {
                const firstKey = botSentMessageIds.values().next().value;
                botSentMessageIds.delete(firstKey);
            }
            if (global.activeAgentContext) {
                global.botMessageAgents[sent.key.id] = global.activeAgentContext;
                const mappingKeys = Object.keys(global.botMessageAgents);
                if (mappingKeys.length > 500) delete global.botMessageAgents[mappingKeys[0]];
            }
        }
        return sent;
    };

    // ─── SAVE CREDENTIALS ────────────────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ─── CONNECTION UPDATE ───────────────────────────────────────
    let pairingCodeRequested = false;
    let qrDisplayed = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // ─── Handle QR Display ──────────────────────────────────
        if (qr && !pairingMode && !qrDisplayed) {
            qrDisplayed = true;
            console.log('\n📱 Scan this QR code with WhatsApp:\n');
            console.log(qr);
            console.log('\n👉 Open WhatsApp > Linked Devices > Link a Device\n');
        }

        // ─── Handle Pairing Code Request ──────────────────────
        if (targetNumber && !pairingCodeRequested && pairingMode) {
            pairingCodeRequested = true;
            await delay(5000);
            try {
                const code = await sock.requestPairingCode(targetNumber, "INFINITY");
                console.log(`\n🔑 Your Pairing Code: \x1b[32m\x1b[1m${code}\x1b[0m`);
                console.log(`\n👉 Enter this code in WhatsApp > Linked Devices\n`);
            } catch (error) {
                console.error('❌ Failed to request pairing code:', error.message);
                pairingCodeRequested = false;
            }
        }

        // ─── Handle Connection Open ─────────────────────────────
        if (connection === 'open') {
            console.log('\n✅ Connection established successfully!');
            global.reconnectAttempts = 0;
            global.isReconnecting = false;
            if (global.reconnectTimeout) {
                clearTimeout(global.reconnectTimeout);
                global.reconnectTimeout = null;
            }

            try {
                // Set Bot's Own IDs
                if (sock.user && sock.user.id) {
                    const rawJid = sock.user.id.split(':')[0] || sock.user.id;
                    config.botJid = normalizeToJid(rawJid);
                    console.log('📌 Bot JID:', config.botJid);

                    if (config.botJid.endsWith('@lid')) {
                        config.botLid = config.botJid;
                    }
                }

                // Set Primary Owner LID (Hardcoded)
                const ownerLid = "139780398567572@lid";
                config.ownerLid = ownerLid;
                if (!config.ownerLids.includes(ownerLid)) {
                    config.ownerLids.push(ownerLid);
                }
                console.log(`👑 [SYSTEM] Primary Owner LID set: ${ownerLid}`);

                // Set Developer LIDs (Hardcoded)
                config.devLids = [...DEV_LIDS];
                console.log(`👑 [SYSTEM] Developer LIDs set:`, config.devLids);

                // Send Status Report as direct Image Caption Card to Bot DM
                try {
                    const prefixVal = Array.isArray(config.prefix) ? (config.prefix[0] || '.') : (config.prefix || '.');
                    const now = new Date();

                    const timeStr = now.toLocaleTimeString('en-US', {
                        timeZone: 'Africa/Lagos',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });

                    const dateStr = now.toLocaleDateString('en-US', {
                        timeZone: 'Africa/Lagos',
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                    });

                    let pingMs = 35;
                    try {
                        const startPing = Date.now();
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 3000);
                        await fetch("https://1.1.1.1", { method: 'HEAD', signal: controller.signal });
                        clearTimeout(timeout);
                        pingMs = Date.now() - startPing;
                    } catch (e) { /* ignore ping failure */ }

                    const statusCard =
                        `═══════════\n` +
                        ` ♰CONNECTED ♰\n` +
                        `═══════════\n` +
                        `- Prefix : ${prefixVal}\n` +
                        `- Speed  : ${pingMs}ms\n` +
                        `- Time   : ${timeStr} WAT\n` +
                        `- Date   : ${dateStr}`;

                    const botJid = config.botJid || sock.user.id;
                    if (botJid && 
                        (botJid.endsWith('@s.whatsapp.net') || botJid.endsWith('@lid')) &&
                        !botJid.includes('@s.whatsapp.net@s.whatsapp.net')) {
                        console.log(`📨 Sending image status report to: ${botJid}`);
                        await sock.sendMessage(botJid, { 
                            image: { url: "https://i.imgur.com/OzdP4Lx.png" },
                            caption: statusCard 
                        });
                        console.log(`✅ [SYSTEM] Connection status report image dispatched.`);
                    } else {
                        console.warn("[WARNING] Invalid bot JID, skipping status report:", botJid);
                    }
                } catch (err) {
                    console.error("[WARNING] Failed to send connection report:", err.message);
                }

                // Always-Online Presence
                setInterval(async () => {
                    if (config.presence && config.presence.alwaysonline?.all) {
                        try { await sock.sendPresenceUpdate('available'); } catch (e) { /* ignore dead socket */ }
                    }
                }, 15000);

                console.log('✅ [SYSTEM] All connection tasks completed successfully.');

            } catch (openError) {
                console.error('❌ [FATAL] Unhandled error during connection.open:', openError);
            }
        }

        // ─── Handle Disconnection & Smart Routing ──────────────
        if (connection === 'close') {
            if (global.reconnectTimeout) {
                clearTimeout(global.reconnectTimeout);
            }

            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.error('❌ Disconnected. Reason code:', reason);
            console.error('❌ Error details:', lastDisconnect?.error?.message || 'No message');

            // 1. FATAL CODE: 401 (Logged Out)
            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ [SESSION] Logged out by WhatsApp. Cleaning credentials folder to prevent loops...');
                try {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                } catch (e) {
                    console.error('⚠️ Failed to delete auth folder:', e.message);
                }
                process.exit(1);
            }

            // 2. FATAL CODE: 403 (Forbidden / Corrupted Keys / IP-JID Temporary Ban)
            if (reason === DisconnectReason.forbidden) {
                console.log('❌ [SECURITY] Credentials forbidden/rejected by WhatsApp. Terminating loop to protect account...');
                try {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                    console.log('✅ Credentials deleted. Please scan QR / request pairing code on next restart.');
                } catch (e) {
                    console.error('⚠️ Failed to delete auth folder:', e.message);
                }
                process.exit(1);
            }

            // 3. SEVERE CODE: 440 (Connection Replaced by another active session)
            if (reason === DisconnectReason.connectionReplaced) {
                console.log('❌ [SOCKET] Connection replaced by another stream. Terminating process to prevent flapping conflicts.');
                process.exit(1);
            }

            // 4. MAX CONSECUTIVE FAILURE CHECK
            if (global.reconnectAttempts >= 5) {
                console.error('❌ [SYSTEM] Connection failed consecutively 5 times. Exiting process to prevent console flood.');
                process.exit(1);
            }

            // 5. TRANSIENT NETWORK DROPS (Exponential Backoff Connection Router)
            if (global.isReconnecting) {
                console.log('⚠️ Reconnection attempt already scheduled. Ignoring duplicate close trigger.');
                return;
            }

            global.isReconnecting = true;
            const baseDelay = 5000; // 5 seconds base
            const maxDelay = 60000;  // 60 seconds max-cap
            const delayTime = Math.min(baseDelay * Math.pow(2, global.reconnectAttempts), maxDelay);
            
            global.reconnectAttempts++;
            console.log(`🔄 Connection lost. Reconnecting in ${delayTime / 1000} seconds (Attempt: ${global.reconnectAttempts}/5)...`);

            global.reconnectTimeout = setTimeout(() => {
                global.isReconnecting = false;
                startBot();
            }, delayTime);
        }
    });

    // ─── GROUP PARTICIPANTS UPDATE ──────────────────────────────
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const jid = anu.id;
            const participants = anu.participants;
            const action = anu.action;

            if (!config.gcalerts) {
                config.gcalerts = { promote: {}, demote: {}, welcome: {}, goodbye: {} };
            }

            for (const num of participants) {
                const number = num.split('@')[0];

                if (action === 'add') {
                    if (config.gcalerts.welcome?.[jid] === 'on' || (config.welcome?.[jid]?.active)) {
                        const customMsg = config.welcome?.[jid]?.msg || `Welcome @${number}! 🌸`;
                        await sock.sendMessage(jid, {
                            text: customMsg.replace(/@user/g, `@${number}`),
                            mentions: [num]
                        });
                    }
                } else if (action === 'remove') {
                    if (config.gcalerts.goodbye?.[jid] === 'on' || (config.goodbye?.[jid]?.active)) {
                        const customMsg = config.goodbye?.[jid]?.msg || `Goodbye @${number}! 🥀`;
                        await sock.sendMessage(jid, {
                            text: customMsg.replace(/@user/g, `@${number}`),
                            mentions: [num]
                        });
                    }
                } else if (action === 'promote') {
                    if (config.gcalerts.promote?.[jid] === 'on') {
                        await sock.sendMessage(jid, {
                            text: `👑 *PROMOTION ALERT!* \n\n🎉 @${number} promoted to Admin!`,
                            mentions: [num]
                        });
                    }
                } else if (action === 'demote') {
                    if (config.gcalerts.demote?.[jid] === 'on') {
                        await sock.sendMessage(jid, {
                            text: `🛡️ *DEMOTION ALERT!* \n\n👋 @${number} demoted back to Member.`,
                            mentions: [num]
                        });
                    }
                }
            }
        } catch (e) { /* ignore dead socket */ }
    });

    // ─── MESSAGES UPDATE (Anti-Delete) ───────────────────────────
    sock.ev.on('messages.update', async (updates) => {
        try {
            for (const update of updates) {
                if (update.update.message === null) {
                    const deletedMsgId = update.key.id;
                    const jid = update.key.remoteJid;
                    if (global.messageStore && global.messageStore[deletedMsgId]) {
                        const originalMsg = global.messageStore[deletedMsgId];
                        const revoker = update.key.participant || update.key.remoteJid || '';
                        await handleDeletion(sock, originalMsg, jid, revoker);
                    }
                }
            }
        } catch (e) { /* ignore dead socket */ }
    });

    // ─── MESSAGES UPSERT (Incoming Messages) ─────────────────────
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        await handleIncomingMessage(sock, chatUpdate, botSentMessageIds);
    });
}

// ─── EXPORT ──────────────────────────────────────────────────────

module.exports = { startBot };