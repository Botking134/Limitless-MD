// pair.js
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { DEV_LIDS, DEV_JIDS, DEV_PHONE_JIDS } = require('./plugins/devs');
const { handleDeletion } = require('./helpers/log');
const { handleIncomingMessage } = require('./helpers/Infinity');
const { normalizeToJid, getPhoneJid, loadState } = require('./stateManager');

// ─── INITIALIZE STATE ON BOOT ──────────────────────────────────
try { loadState(); } catch (e) { console.error("⚠️ State load error:", e.message); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ─── TRACKERS & DEDUPLICATION ──────────────────────────────────
const botSentMessageIds = new Set();
const processedEventsCache = new Map();
let hasSentBootReport = false;
let activeSocketInstance = null;

function isDuplicateEvent(key) {
    const now = Date.now();
    if (processedEventsCache.has(key)) {
        const timestamp = processedEventsCache.get(key);
        if (now - timestamp < 300000) return true; // 5 min TTL
    }
    processedEventsCache.set(key, now);
    if (processedEventsCache.size > 2000) {
        const oldestKey = processedEventsCache.keys().next().value;
        processedEventsCache.delete(oldestKey);
    }
    return false;
}

const isEnabled = (val) => val === true || val === 'on' || val === 'enable' || val === 'true' || val === '1';

// ─── MEDIA FETCHER ─────────────────────────────────────────────
async function fetchMediaBuffer(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length < 500) return null;
        return buffer;
    } catch (e) {
        return null;
    }
}

// ─── GLOBAL SESSIONS & CACHES ──────────────────────────────────
global.messageStore = global.messageStore || {};
global.spamTracker = global.spamTracker || {};
global.spamDeletedCount = global.spamDeletedCount || {};
global.azaSessions = global.azaSessions || {};
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};
global.noteSessions = global.noteSessions || {};

global.triviaSessions = global.triviaSessions || {};
global.charadeSessions = global.charadeSessions || {};
global.anagramSessions = global.anagramSessions || {};
global.wcgSessions = global.wcgSessions || {};
global.millionaireSessions = global.millionaireSessions || {};
global.torfSessions = global.torfSessions || {};
global.pvpSessions = global.pvpSessions || {};
global.escapeSessions = global.escapeSessions || {};
global.vault8Sessions = global.vault8Sessions || {};

global.aiMemory = global.aiMemory || {};
global.botMessageAgents = global.botMessageAgents || {};

global.isReconnecting = global.isReconnecting || false;
global.reconnectAttempts = global.reconnectAttempts || 0;
global.reconnectTimeout = global.reconnectTimeout || null;

// ─── MAIN BOT STARTER ──────────────────────────────────────────

async function startBot() {
    if (activeSocketInstance) {
        try {
            activeSocketInstance.ev.removeAllListeners();
            if (activeSocketInstance.ws) activeSocketInstance.ws.close();
        } catch (e) {}
        activeSocketInstance = null;
    }

    const {
        default: makeWASocket,
        useMultiFileAuthState,
        Browsers,
        DisconnectReason
    } = await import('@itsliaaa/baileys');

    const authFolder = path.join(__dirname, 'storage', 'session_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    let targetNumber = null;
    let pairingMode = false;

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

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        keepAliveIntervalMs: 20000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 3000
    });

    activeSocketInstance = sock;

    // ─── UNBLOCKED SEND MESSAGE WRAPPER ───────────────────────────
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        const isSelf = jid === config.botJid || jid.includes(sock.user?.id?.split(':')[0] || '_____');
        if (config.presence && !jid.endsWith('@broadcast') && !isSelf) {
            const autotypingActive = config.presence.autotyping?.all || config.presence.autotyping?.chats?.includes(jid);
            const autorecordingActive = config.presence.autorecording?.all || config.presence.autorecording?.chats?.includes(jid);
            if (autorecordingActive) {
                sock.sendPresenceUpdate('recording', jid).catch(() => {});
            } else if (autotypingActive) {
                sock.sendPresenceUpdate('composing', jid).catch(() => {});
            }
        }

        if (content && typeof content === 'object') {
            const mediaKeys = ['image', 'video', 'audio', 'document', 'sticker'];
            for (const key of mediaKeys) {
                if (content[key] && typeof content[key] === 'object' && typeof content[key].url === 'string') {
                    const url = content[key].url;
                    if (url.startsWith('http')) {
                        const buffer = await fetchMediaBuffer(url);
                        if (buffer) {
                            content[key] = buffer;
                            if (key === 'image' && !content.mimetype) content.mimetype = 'image/jpeg';
                        }
                    }
                }
            }
        }

        let sent;
        try {
            sent = await originalSendMessage(jid, content, options);
        } catch (sendErr) {
            if (!sendErr.message?.includes('Connection Closed') && !sendErr.message?.includes('rate-overlimit')) {
                console.error("❌ [SOCKET] sendMessage error:", sendErr.message);
            }
            return null;
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

    sock.ev.on('creds.update', saveCreds);

    let pairingCodeRequested = false;
    let qrDisplayed = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !pairingMode && !qrDisplayed) {
            qrDisplayed = true;
            console.log('\n📱 Scan this QR code with WhatsApp:\n');
            console.log(qr);
            console.log('\n👉 Open WhatsApp > Linked Devices > Link a Device\n');
        }

        if (targetNumber && !pairingCodeRequested && pairingMode) {
            pairingCodeRequested = true;
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(targetNumber, "INFINITY");
                    console.log(`\n🔑 Your Pairing Code: \x1b[32m\x1b[1m${code}\x1b[0m`);
                    console.log(`\n👉 Enter this code in WhatsApp > Linked Devices\n`);
                } catch (error) {
                    console.error('❌ Failed to request pairing code:', error.message);
                    pairingCodeRequested = false;
                }
            }, 4000);
        }

        // ─── CONNECTION OPEN ───
        if (connection === 'open') {
            console.log('\n✅ Connection established successfully!');
            global.reconnectAttempts = 0;
            global.isReconnecting = false;
            if (global.reconnectTimeout) {
                clearTimeout(global.reconnectTimeout);
                global.reconnectTimeout = null;
            }

            try {
                if (sock.user && sock.user.id) {
                    const rawJid = sock.user.id.split(':')[0] || sock.user.id;
                    config.botJid = normalizeToJid(rawJid);
                    if (config.botJid.endsWith('@lid')) config.botLid = config.botJid;
                }

                const ownerLid = "139780398567572@lid";
                config.ownerLid = ownerLid;
                config.ownerLids = config.ownerLids || [];
                if (!config.ownerLids.includes(ownerLid)) config.ownerLids.push(ownerLid);
                config.devLids = [...DEV_LIDS];

                // Yu-Gi-Oh Auto-spawner
                try {
                    const yugioh = require('./plugins/yugioh');
                    if (typeof yugioh.startAutoCardSpawner === 'function') {
                        yugioh.startAutoCardSpawner(sock);
                    }
                } catch (e) {}

                // Send Single-Run Boot Report
                if (!hasSentBootReport) {
                    hasSentBootReport = true;
                    setTimeout(async () => {
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

                            const statusCard =
                                `═══════════\n` +
                                ` ♰CONNECTED ♰\n` +
                                `═══════════\n` +
                                `• Prefix : ${prefixVal}\n` +
                                `• Time   : ${timeStr} WAT\n` +
                                `• Date   : ${dateStr}`;

                            const botJid = config.botJid || sock.user?.id;
                            if (botJid) {
                                const targetRecipient = botJid.includes('@') ? botJid : `${botJid}@s.whatsapp.net`;
                                const imgBuffer = await fetchMediaBuffer("https://qu.ax/I6tKC");
                                
                                if (imgBuffer) {
                                    await sock.sendMessage(targetRecipient, { 
                                        image: imgBuffer,
                                        mimetype: 'image/jpeg',
                                        caption: statusCard 
                                    });
                                } else {
                                    await sock.sendMessage(targetRecipient, { text: statusCard });
                                }
                                console.log(`✅ [SYSTEM] Connection status report dispatched.`);
                            }
                        } catch (err) {
                            console.error("[WARNING] Status report skipped:", err.message);
                        }
                    }, 4000);
                }

            } catch (openError) {
                console.error('❌ Error during connection.open:', openError);
            }
        }

        // ─── CONNECTION CLOSE ───
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.error('❌ Disconnected. Reason code:', reason);

            try {
                sock.ev.removeAllListeners();
                if (sock.ws) sock.ws.close();
            } catch (e) {}

            if (reason === DisconnectReason.loggedOut || reason === DisconnectReason.forbidden) {
                console.log('❌ [SESSION] Logged out. Cleaning storage...');
                try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch (e) {}
                process.exit(1);
            }

            if (reason === DisconnectReason.connectionReplaced) {
                console.log('❌ [SOCKET] Connection replaced. Terminating...');
                process.exit(1);
            }

            if (global.reconnectAttempts >= 5) {
                console.error('❌ [SYSTEM] Max reconnect attempts reached. Exiting...');
                process.exit(1);
            }

            if (global.isReconnecting) return;

            global.isReconnecting = true;
            const delayTime = Math.min(4000 * Math.pow(1.5, global.reconnectAttempts), 30000);
            
            global.reconnectAttempts++;
            console.log(`🔄 Reconnecting in ${Math.round(delayTime / 1000)}s...`);

            global.reconnectTimeout = setTimeout(() => {
                global.isReconnecting = false;
                startBot();
            }, delayTime);
        }
    });

    // ─── GROUP PARTICIPANTS UPDATE ───
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            if (!anu || !anu.id || !anu.participants || !anu.participants.length) return;

            const jid = normalizeToJid(anu.id);
            const participants = anu.participants;
            const action = anu.action;

            const alertsPath = path.join(__dirname, 'storage', 'gcalerts.json');
            let data = { welcome: {}, goodbye: {}, promote: {}, demote: {}, customWelcome: {}, customGoodbye: {}, antijoin: {}, antipromote: {}, antidemote: {}, overkill: {} };
            try {
                if (fs.existsSync(alertsPath)) data = JSON.parse(fs.readFileSync(alertsPath, 'utf-8'));
            } catch (e) {}

            let groupName = 'Group';
            let metadata = null;
            try {
                metadata = await sock.groupMetadata(jid);
                groupName = metadata?.subject || 'Group';
            } catch (e) {}

            const botJid = normalizeToJid(sock.user?.id || '').split(':')[0].split('@')[0] + '@s.whatsapp.net';
            const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';

            let rawActor = anu.author || '';
            let actorJid = rawActor ? normalizeToJid(rawActor).split(':')[0].split('@')[0] + '@s.whatsapp.net' : '';

            if (rawActor.includes('@lid') && metadata?.participants) {
                const cleanLid = rawActor.split('@')[0].split(':')[0];
                const matched = metadata.participants.find(p => p.lid && p.lid.includes(cleanLid));
                if (matched && matched.id) actorJid = matched.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
            }

            const isActorBot = actorJid === botJid || (botLid && rawActor.includes(botLid.split('@')[0]));
            const isActorDev = DEV_LIDS.some(d => rawActor.includes(d.split('@')[0])) || DEV_JIDS.includes(actorJid) || DEV_PHONE_JIDS.includes(actorJid);
            const isActorOwner = actorJid === config.ownerJid || (config.ownerLid && rawActor.includes(config.ownerLid.split('@')[0])) || (Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(actorJid));
            const isActorSudo = Array.isArray(config.sudos) && config.sudos.includes(actorJid);
            const isActorAuthorized = isActorBot || isActorDev || isActorOwner || isActorSudo;

            for (const num of participants) {
                let rawTarget = String(num);
                let targetJid = rawTarget.split(':')[0].split('@')[0] + '@s.whatsapp.net';

                if (rawTarget.includes('@lid') && metadata?.participants) {
                    const cleanLid = rawTarget.split('@')[0].split(':')[0];
                    const matchedP = metadata.participants.find(p => p.lid && p.lid.includes(cleanLid));
                    if (matchedP && matchedP.id) targetJid = matchedP.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
                }

                const phoneNumber = targetJid.split('@')[0];

                const eventSignature = `${jid}_${targetJid}_${action}`;
                if (isDuplicateEvent(eventSignature)) continue;

                if (action === 'add') {
                    const isAntijoinOn = isEnabled(data.antijoin?.[jid]) || isEnabled(config.antijoin?.[jid]);
                    if (isAntijoinOn && !isActorAuthorized) {
                        try {
                            await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                            await sock.sendMessage(jid, { 
                                text: `🔒 *Anti-Join Protection active!* Expelled @${phoneNumber}.`,
                                mentions: [targetJid]
                            });
                            continue;
                        } catch (e) {}
                    }

                    const isWelcomeOn = isEnabled(data.welcome?.[jid]) || isEnabled(config.welcome?.[jid]);
                    if (isWelcomeOn) {
                        const customMsg = data.customWelcome?.[jid] || `Welcome @user to *${groupName}*! 🌸`;
                        const formattedMsg = customMsg.replace(/@user/g, `@${phoneNumber}`).replace(/@group/g, groupName);
                        await sock.sendMessage(jid, { text: formattedMsg, mentions: [targetJid] });
                    }
                } else if (action === 'remove') {
                    const isGoodbyeOn = isEnabled(data.goodbye?.[jid]) || isEnabled(config.goodbye?.[jid]);
                    if (isGoodbyeOn) {
                        const customMsg = data.customGoodbye?.[jid] || `Goodbye @user! 🥀`;
                        const formattedMsg = customMsg.replace(/@user/g, `@${phoneNumber}`).replace(/@group/g, groupName);
                        await sock.sendMessage(jid, { text: formattedMsg, mentions: [targetJid] });
                    }
                } else if (action === 'promote') {
                    const isPromoteOn = isEnabled(data.promote?.[jid]) || isEnabled(config.promote?.[jid]);
                    if (isPromoteOn) {
                        await sock.sendMessage(jid, {
                            text: `👑 *PROMOTION ALERT!*\n\n🎉 @${phoneNumber} promoted to Admin in *${groupName}*!`,
                            mentions: [targetJid]
                        });
                    }
                } else if (action === 'demote') {
                    const isDemoteOn = isEnabled(data.demote?.[jid]) || isEnabled(config.demote?.[jid]);
                    if (isDemoteOn) {
                        await sock.sendMessage(jid, {
                            text: `🛡️ *DEMOTION ALERT!*\n\n👋 @${phoneNumber} demoted to Member in *${groupName}*.`,
                            mentions: [targetJid]
                        });
                    }
                }
            }
        } catch (e) {}
    });

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
        } catch (e) {}
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        if (chatUpdate.messages && chatUpdate.messages[0]) {
            const m = chatUpdate.messages[0];
            if (m.key && m.key.id && m.message) {
                global.messageStore[m.key.id] = m;
                const storeKeys = Object.keys(global.messageStore);
                if (storeKeys.length > 2000) delete global.messageStore[storeKeys[0]];
            }
        }
        await handleIncomingMessage(sock, chatUpdate, botSentMessageIds);
    });
}

module.exports = { startBot };