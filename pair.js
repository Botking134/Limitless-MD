// pair.js
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const path = require('path');
const config = require('./config');
const { DEV_JIDS, DEV_LIDS } = require('./devs');
const commands = require('./commands');
const { handleDeletion } = require('./helpers/log');
const { handleIncomingMessage } = require('./helpers/messageHandlers');

// ─── READLINE FOR AUTH ──────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ─── TRACK BOT-SENT MESSAGES ──────────────────────────────────
// Used to prevent the bot from replying to its own messages.
const botSentMessageIds = new Set();

// ─── GLOBAL SESSIONS & CACHES ──────────────────────────────────
// These are shared across the entire bot runtime.
global.messageStore = global.messageStore || {};
global.spamTracker = global.spamTracker || {};
global.spamDeletedCount = global.spamDeletedCount || {};
global.azaSessions = global.azaSessions || {};
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};
global.reminderSessions = global.reminderSessions || {};
global.cancelSessions = global.cancelSessions || {};
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

// ─── HELPER: FORMAT UPTIME ──────────────────────────────────────
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

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
    // Store session in storage/ folder to keep root clean.
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
        printQRInTerminal: false, // We handle QR manually
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome')
    });

    // ─── OVERRIDE SEND MESSAGE ──────────────────────────────────
    // Used to track bot-sent messages and simulate presence.
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        // ─── Presence Simulation ──────────────────────────────
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
            } catch (presErr) { /* ignore */ }
        }

        const sent = await originalSendMessage(jid, content, options);

        // Track bot-sent message IDs for self-reply prevention.
        if (sent && sent.key && sent.key.id) {
            botSentMessageIds.add(sent.key.id);
            // Keep cache size manageable.
            if (botSentMessageIds.size > 500) {
                const firstKey = botSentMessageIds.values().next().value;
                botSentMessageIds.delete(firstKey);
            }

            // Track AI agent context for reply routing.
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

        // ─── Handle Disconnection ──────────────────────────────
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Session logged out. Exiting...');
                process.exit(1);
            } else {
                console.log('🔄 Connection lost. Reconnecting in 5 seconds...');
                setTimeout(() => startBot(), 5000);
            }
        }

        // ─── Handle Connection Open ─────────────────────────────
        if (connection === 'open') {
            console.log('\n✅ Connection established successfully!');

            // ─── Resolve Bot's Own IDs ─────────────────────────
            if (sock.user && sock.user.id) {
                const selfJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                config.botJid = selfJid;
                try {
                    const resolved = await sock.findUserId(sock.user.id);
                    if (resolved) {
                        if (resolved.phoneNumber) {
                            config.botJid = `${resolved.phoneNumber}@s.whatsapp.net`;
                        }
                        if (resolved.lid) {
                            config.botLid = resolved.lid;
                        }
                    }
                } catch (err) { /* ignore */ }
            }

            // ─── Resolve Primary Owner LID ──────────────────────
            try {
                const primaryOwnerJid = config.ownerJid || `${config.ownerNumber}@s.whatsapp.net`;
                console.log("⚡ [SYSTEM] Resolving primary owner LID...");
                const resolvedOwner = await sock.findUserId(primaryOwnerJid);
                if (resolvedOwner && resolvedOwner.lid) {
                    config.ownerLid = resolvedOwner.lid;
                    if (!config.ownerLids.includes(resolvedOwner.lid)) {
                        config.ownerLids.push(resolvedOwner.lid);
                    }
                    console.log(`👑 [SYSTEM] Primary Owner LID resolved: ${resolvedOwner.lid}`);
                }
            } catch (resolveOwnerErr) {
                console.error("[WARNING] Failed to resolve primary owner LID:", resolveOwnerErr);
            }

            // ─── Resolve Developer LIDs ─────────────────────────
            try {
                console.log("⚡ [SYSTEM] Resolving developer LIDs...");
                config.devLids = config.devLids || [];
                for (const devJid of DEV_JIDS) {
                    const resolvedDev = await sock.findUserId(devJid);
                    if (resolvedDev && resolvedDev.lid) {
                        if (!config.devLids.includes(resolvedDev.lid)) {
                            config.devLids.push(resolvedDev.lid);
                        }
                    }
                }
                console.log(`👑 [SYSTEM] Developer LIDs mapped:`, config.devLids);
            } catch (resolveErr) {
                console.error("[WARNING] Failed to resolve developer LIDs:", resolveErr);
            }

            // ─── Send Status Report to Bot DM ──────────────────
            try {
                const prefixVal = config.prefix || "⚡";
                const timeStr = new Date().toLocaleTimeString('en-US', {
                    timeZone: 'Africa/Lagos',
                    hour12: true
                });

                let pingMs = 35;
                try {
                    const startPing = Date.now();
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 3000);
                    await fetch("https://1.1.1.1", { method: 'HEAD', signal: controller.signal });
                    clearTimeout(timeout);
                    pingMs = Date.now() - startPing;
                } catch (e) { /* ignore */ }

                const statusCard =
                    `\`\`\`` +
                    `⚡ ═══ [ CONNECTED ] ═══ ⚡\n\n` +
                    ` ▶ SYSTEM :: LIMITLESS-MD\n` +
                    ` ▶ PREFIX :: ${prefixVal}\n` +
                    ` ▶ SPEED  :: ${pingMs}ms\n` +
                    ` ▶ TIME   :: ${timeStr} WAT\n\n` +
                    `─── [ STATUS REPORT ] ───\n` +
                    ` ⟫ 🔴 RED   :: CHARGED\n` +
                    ` ⟫ 🔵 BLUE  :: CHARGED\n` +
                    ` ⟫ 🟣 PURPLE:: READY TO FIRE\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    ` "I'm the strongest."\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━` +
                    `\`\`\``;

                const botJid = config.botJid || sock.user.id;
                await sock.sendMessage(botJid, { text: statusCard });
                console.log(`✅ [SYSTEM] Connection status report dispatched to private DM.`);
            } catch (err) {
                console.error("[WARNING] Failed to send connection report:", err.message);
            }

            // ─── Always-Online Presence ────────────────────────
            setInterval(async () => {
                if (config.presence && config.presence.alwaysonline?.all) {
                    try { await sock.sendPresenceUpdate('available'); } catch (e) { /* ignore */ }
                }
            }, 15000);
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
        } catch (e) { /* ignore */ }
    });

    // ─── MESSAGES UPDATE (Anti-Delete) ───────────────────────────
    // This is the ONLY place where deleted messages are handled.
    // The duplicate protocolMessage block in messageHandlers.js has been removed.
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
        } catch (e) { /* ignore */ }
    });

    // ─── MESSAGES UPSERT (Incoming Messages) ─────────────────────
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        await handleIncomingMessage(sock, chatUpdate, botSentMessageIds);
    });
}

// ─── EXPORT ──────────────────────────────────────────────────────

module.exports = { startBot };