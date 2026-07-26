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

// Reconnection State Locks
global.isReconnecting = global.isReconnecting || false;
global.reconnectAttempts = global.reconnectAttempts || 0;
global.reconnectTimeout = global.reconnectTimeout || null;
global.alwaysOnlineInterval = global.alwaysOnlineInterval || null;

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
                if (sock.user && sock.user.id) {
                    const rawJid = sock.user.id.split(':')[0] || sock.user.id;
                    config.botJid = normalizeToJid(rawJid);
                    console.log('📌 Bot JID:', config.botJid);

                    if (config.botJid.endsWith('@lid')) {
                        config.botLid = config.botJid;
                    }
                }

                const ownerLid = "139780398567572@lid";
                config.ownerLid = ownerLid;
                config.ownerLids = config.ownerLids || [];
                if (!config.ownerLids.includes(ownerLid)) {
                    config.ownerLids.push(ownerLid);
                }

                config.devLids = [...DEV_LIDS];

                // Send Status Report Card
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
                        if (typeof fetch === 'function') {
                            await fetch("https://1.1.1.1", { method: 'HEAD', signal: controller.signal });
                        }
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

                    const botJid = config.botJid || sock.user?.id;
                    if (botJid && (botJid.endsWith('@s.whatsapp.net') || botJid.endsWith('@lid'))) {
                        console.log(`📨 Sending image status report to: ${botJid}`);
                        await sock.sendMessage(botJid, { 
                            image: { url: "https://qu.ax/I6tKC" },
                            caption: statusCard 
                        });
                        console.log(`✅ [SYSTEM] Connection status report image dispatched.`);
                    }
                } catch (err) {
                    console.error("[WARNING] Failed to send connection report:", err.message);
                }

                // Managed Always-Online Presence Timer
                if (global.alwaysOnlineInterval) clearInterval(global.alwaysOnlineInterval);
                global.alwaysOnlineInterval = setInterval(async () => {
                    if (config.presence && config.presence.alwaysonline?.all) {
                        try { await sock.sendPresenceUpdate('available'); } catch (e) { /* ignore */ }
                    }
                }, 15000);

                console.log('✅ [SYSTEM] All connection tasks completed successfully.');

            } catch (openError) {
                console.error('❌ [FATAL] Unhandled error during connection.open:', openError);
            }
        }

        // ─── Handle Disconnection ──────────────────────────────
        if (connection === 'close') {
            if (global.reconnectTimeout) clearTimeout(global.reconnectTimeout);

            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.error('❌ Disconnected. Reason code:', reason);

            if (reason === DisconnectReason.loggedOut || reason === DisconnectReason.forbidden) {
                console.log('❌ [SESSION] Credentials invalid or logged out. Cleaning storage...');
                try {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                } catch (e) { /* ignore */ }
                process.exit(1);
            }

            if (reason === DisconnectReason.connectionReplaced) {
                console.log('❌ [SOCKET] Connection replaced by another stream. Terminating...');
                process.exit(1);
            }

            if (global.reconnectAttempts >= 5) {
                console.error('❌ [SYSTEM] Connection failed 5 consecutive times. Exiting...');
                process.exit(1);
            }

            if (global.isReconnecting) return;

            global.isReconnecting = true;
            const baseDelay = 5000;
            const maxDelay = 60000;
            const delayTime = Math.min(baseDelay * Math.pow(2, global.reconnectAttempts), maxDelay);
            
            global.reconnectAttempts++;
            console.log(`🔄 Connection lost. Reconnecting in ${delayTime / 1000}s (Attempt: ${global.reconnectAttempts}/5)...`);

            global.reconnectTimeout = setTimeout(() => {
                global.isReconnecting = false;
                startBot();
            }, delayTime);
        }
    });

    // ─── GROUP PARTICIPANTS UPDATE (Security & Alerts Router) ───
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const jid = anu.id;
            const participants = anu.participants;
            const action = anu.action;

            const alertsPath = path.join(__dirname, 'storage', 'gcalerts.json');
            let data = { welcome: {}, goodbye: {}, promote: {}, demote: {}, customWelcome: {}, customGoodbye: {}, antijoin: {}, antipromote: {}, antidemote: {}, overkill: {} };
            try {
                if (fs.existsSync(alertsPath)) {
                    data = JSON.parse(fs.readFileSync(alertsPath, 'utf-8'));
                }
            } catch (e) { /* ignore */ }

            let groupName = 'Group';
            let metadata = null;
            try {
                metadata = await sock.groupMetadata(jid);
                groupName = metadata?.subject || 'Group';
            } catch (e) { /* ignore */ }

            const botJid = normalizeToJid(sock.user?.id || '');
            const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';

            // Resolve Actor (Author) JID
            let actorJid = normalizeToJid(anu.author || '');
            if (actorJid && metadata?.participants) {
                const cleanActor = actorJid.split('@')[0].split(':')[0];
                const actorObj = metadata.participants.find(p => {
                    const pId = p.id ? p.id.split('@')[0].split(':')[0] : '';
                    const pLid = p.lid ? p.lid.split('@')[0].split(':')[0] : '';
                    return pId === cleanActor || pLid === cleanActor;
                });
                if (actorObj?.id) {
                    actorJid = normalizeToJid(actorObj.id);
                }
            }

            if (actorJid.endsWith('@lid')) {
                const resolvedActor = await getPhoneJid(sock, actorJid, jid);
                if (resolvedActor && resolvedActor.endsWith('@s.whatsapp.net')) {
                    actorJid = resolvedActor;
                }
            }

            const isActorBot = actorJid === botJid || (botLid && actorJid === botLid);
            const isActorDev = DEV_LIDS.includes(actorJid) || DEV_JIDS.includes(actorJid) || DEV_PHONE_JIDS.includes(actorJid);
            const isActorOwner = actorJid === config.ownerJid || (config.ownerLid && actorJid === config.ownerLid) || (Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(actorJid));
            const isActorSudo = (Array.isArray(config.sudos) && config.sudos.includes(actorJid)) || (Array.isArray(config.sudoLids) && config.sudoLids.includes(actorJid));
            
            const isActorAuthorized = isActorBot || isActorDev || isActorOwner || isActorSudo;

            const triggerEmergencyOverkill = async (executorJid) => {
                try {
                    const groupMeta = metadata || await sock.groupMetadata(jid);
                    const targetsToDemote = [];

                    for (const p of groupMeta.participants) {
                        const pJid = normalizeToJid(p.id);
                        if (p.admin === 'admin' || p.admin === 'superadmin') {
                            const isExempt = pJid === botJid || pJid === botLid ||
                                             DEV_LIDS.includes(pJid) || DEV_JIDS.includes(pJid) || DEV_PHONE_JIDS.includes(pJid) ||
                                             pJid === config.ownerJid || pJid === config.ownerLid ||
                                             (Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(pJid)) ||
                                             (Array.isArray(config.sudos) && config.sudos.includes(pJid));

                            if (!isExempt) targetsToDemote.push(pJid);
                        }
                    }

                    if (targetsToDemote.length > 0) {
                        await sock.groupParticipantsUpdate(jid, targetsToDemote, "demote");
                    }

                    await sock.groupSettingUpdate(jid, 'announcement');
                    await sock.groupSettingUpdate(jid, 'locked');

                    const alertText =
                        `🚨 *OVERKILL EMERGENCY CONTAINMENT ACTIVATED* 🚨\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `⚠️ *Threat Neutralized:* \`${targetsToDemote.length}\` non-exempt admins demoted.\n` +
                        `🔒 *Status:* Group closed to Admins-Only and settings locked.\n` +
                        `👤 *Violator:* @${executorJid ? executorJid.split('@')[0] : 'Unknown'}\n\n` +
                        `_System operations will resume once verified by Satoru Gojo's creator._`;

                    await sock.sendMessage(jid, { text: alertText, mentions: executorJid ? [executorJid] : [] });
                } catch (err) {
                    console.error("❌ [OVERKILL] Automated lockdown failed:", err.message);
                }
            };

            for (const num of participants) {
                let targetJid = normalizeToJid(num);

                // Guaranteed Group Participants LID-to-Phone Translator
                if (metadata?.participants) {
                    const cleanNum = num.split('@')[0].split(':')[0];
                    const matchedP = metadata.participants.find(p => {
                        const pId = p.id ? p.id.split('@')[0].split(':')[0] : '';
                        const pLid = p.lid ? p.lid.split('@')[0].split(':')[0] : '';
                        return pId === cleanNum || pLid === cleanNum;
                    });
                    if (matchedP && matchedP.id) {
                        targetJid = normalizeToJid(matchedP.id);
                    }
                }

                if (targetJid.endsWith('@lid')) {
                    const resolvedTarget = await getPhoneJid(sock, targetJid, jid);
                    if (resolvedTarget && resolvedTarget.endsWith('@s.whatsapp.net')) {
                        targetJid = resolvedTarget;
                    }
                }
                const number = targetJid.split('@')[0];

                // ─── 1. MEMBER ADDED / JOINED ───
                if (action === 'add') {
                    const antijoinPolicy = data.antijoin?.[jid] || config.antijoin?.[jid] || 'off';
                    const joinedSelfViaLink = !anu.author || normalizeToJid(anu.author) === targetJid;

                    let isActorAdmin = false;
                    if (metadata?.participants && actorJid) {
                        const actorObj = metadata.participants.find(p => normalizeToJid(p.id) === actorJid);
                        isActorAdmin = !!(actorObj && (actorObj.admin === 'admin' || actorObj.admin === 'superadmin'));
                    }

                    if (antijoinPolicy === 'on' && !isActorAuthorized && (joinedSelfViaLink || !isActorAdmin)) {
                        try {
                            await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                            await sock.sendMessage(jid, { 
                                text: `🔒 *Anti-Join Protection active!* Expelled @${number}.`,
                                mentions: [targetJid]
                            });
                        } catch (e) { /* ignore */ }
                        continue;
                    }

                    const welStatus = data.welcome?.[jid] || 'off';
                    if (welStatus === 'on') {
                        const customMsg = data.customWelcome?.[jid] || `Welcome @user to @group! 🌸`;
                        const formattedMsg = customMsg
                            .replace(/@user/g, `@${number}`)
                            .replace(/@group/g, groupName);

                        await sock.sendMessage(jid, { text: formattedMsg, mentions: [targetJid] });
                    }
                } 
                // ─── 2. MEMBER REMOVED ───
                else if (action === 'remove') {
                    const gbStatus = data.goodbye?.[jid] || 'off';
                    if (gbStatus === 'on') {
                        const customMsg = data.customGoodbye?.[jid] || `Goodbye @user! 🥀`;
                        const formattedMsg = customMsg
                            .replace(/@user/g, `@${number}`)
                            .replace(/@group/g, groupName);

                        await sock.sendMessage(jid, { text: formattedMsg, mentions: [targetJid] });
                    }
                } 
                // ─── 3. MEMBER PROMOTED TO ADMIN ───
                else if (action === 'promote') {
                    const antipromotePolicy = data.antipromote?.[jid] || config.antipromote?.[jid] || 'off';
                    const isOverkillOn = data.overkill?.[jid] === 'on' || config.overkill?.[jid] === 'on' || antipromotePolicy === 'overkill';

                    // Anti-Promote Rollback
                    if (antipromotePolicy !== 'off' && !isActorAuthorized && !isActorBot) {
                        try {
                            await sock.groupParticipantsUpdate(jid, [targetJid], "demote");
                            if (actorJid) {
                                try { await sock.groupParticipantsUpdate(jid, [actorJid], "demote"); } catch (e) { /* ignore */ }
                            }

                            await sock.sendMessage(jid, {
                                text: `🛡️ *Anti-Promote Triggered!* Rolled back unauthorized promotion of @${number}.`,
                                mentions: actorJid ? [targetJid, actorJid] : [targetJid]
                            });
                        } catch (err) {
                            console.error("❌ [SECURITY] Anti-Promote enforcement failed:", err.message);
                        }

                        // Independent Overkill Check
                        if (isOverkillOn) {
                            await triggerEmergencyOverkill(actorJid);
                        }
                        continue;
                    }

                    // Independent Overkill trigger if enabled on any unauthorized promo
                    if (isOverkillOn && !isActorAuthorized && !isActorBot) {
                        await triggerEmergencyOverkill(actorJid);
                        continue;
                    }

                    const promStatus = data.promote?.[jid] || 'off';
                    if (promStatus === 'on') {
                        await sock.sendMessage(jid, {
                            text: `👑 *PROMOTION ALERT!* \n\n🎉 @${number} promoted to Admin in *${groupName}*!`,
                            mentions: [targetJid]
                        });
                    }
                } 
                // ─── 4. ADMIN DEMOTED TO MEMBER ───
                else if (action === 'demote') {
                    const antidemotePolicy = data.antidemote?.[jid] || config.antidemote?.[jid] || 'off';
                    const isOverkillOn = data.overkill?.[jid] === 'on' || config.overkill?.[jid] === 'on' || antidemotePolicy === 'overkill';

                    // Anti-Demote Rollback
                    if (antidemotePolicy !== 'off' && !isActorAuthorized && !isActorBot) {
                        try {
                            await sock.groupParticipantsUpdate(jid, [targetJid], "promote");
                            if (actorJid) {
                                try { await sock.groupParticipantsUpdate(jid, [actorJid], "demote"); } catch (e) { /* ignore */ }
                            }

                            await sock.sendMessage(jid, {
                                text: `🛡️ *Anti-Demote Triggered!* Restored admin status of @${number}.`,
                                mentions: actorJid ? [targetJid, actorJid] : [targetJid]
                            });
                        } catch (err) {
                            console.error("❌ [SECURITY] Anti-Demote enforcement failed:", err.message);
                        }

                        // Independent Overkill Check
                        if (isOverkillOn) {
                            await triggerEmergencyOverkill(actorJid);
                        }
                        continue;
                    }

                    // Independent Overkill trigger if enabled on any unauthorized demote
                    if (isOverkillOn && !isActorAuthorized && !isActorBot) {
                        await triggerEmergencyOverkill(actorJid);
                        continue;
                    }

                    const demStatus = data.demote?.[jid] || 'off';
                    if (demStatus === 'on') {
                        await sock.sendMessage(jid, {
                            text: `🛡️ *DEMOTION ALERT!* \n\n👋 @${number} demoted back to Member in *${groupName}*.`,
                            mentions: [targetJid]
                        });
                    }
                }
            }
        } catch (e) {
            console.error("❌ [ALERTS] Failed to process group update event:", e.message);
        }
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
        } catch (e) { /* ignore */ }
    });

    // ─── MESSAGES UPSERT ──────────────────────────────────────────
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        if (chatUpdate.messages && chatUpdate.messages[0]) {
            const m = chatUpdate.messages[0];
            if (m.key && m.key.id && m.message) {
                global.messageStore[m.key.id] = m;
                const storeKeys = Object.keys(global.messageStore);
                if (storeKeys.length > 2000) {
                    delete global.messageStore[storeKeys[0]];
                }
            }
        }

        await handleIncomingMessage(sock, chatUpdate, botSentMessageIds);
    });
}

module.exports = { startBot };