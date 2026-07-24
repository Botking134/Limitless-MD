// pair.js
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { DEV_LIDS, DEV_JIDS, DEV_PHONE_JIDS } = require('./plugins/devs');
const { handleDeletion } = require('./helpers/log');
const { handleIncomingMessage } = require('./helpers/Infinity');
const { normalizeToJid, getPhoneJid } = require('./stateManager');

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
                            image: { url: "https://qu.ax/I6tKC" },
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

    // ─── GROUP PARTICIPANTS UPDATE (Active Security Enforcements & Rollbacks) ───
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const jid = anu.id;
            const participants = anu.participants;
            const action = anu.action;

            // Direct persistent storage lookup for group alerts and locks [1.1]
            const alertsPath = path.join(__dirname, 'storage', 'gcalerts.json');
            let data = { welcome: {}, goodbye: {}, promote: {}, demote: {}, customWelcome: {}, customGoodbye: {}, antijoin: {}, antipromote: {}, antidemote: {}, overkill: {} };
            try {
                if (fs.existsSync(alertsPath)) {
                    data = JSON.parse(fs.readFileSync(alertsPath, 'utf-8'));
                }
            } catch (e) { /* ignore */ }

            // Resolve the group's subject name safely
            let groupName = 'Group';
            try {
                const metadata = await sock.groupMetadata(jid);
                groupName = metadata.subject || 'Group';
            } catch (e) { /* ignore */ }

            // Cache Bot Identity parameters
            const botJid = normalizeToJid(sock.user.id);
            const botLid = sock.user.lid ? normalizeToJid(sock.user.lid) : '';

            // Resolve Actor (Author) JID and safely translate LID-to-Phone JID to prevent security false-positives [1.1]
            let actorJid = normalizeToJid(anu.author || '');
            if (actorJid.endsWith('@lid')) {
                const resolvedActor = await getPhoneJid(sock, actorJid, jid);
                if (resolvedActor && resolvedActor.endsWith('@s.whatsapp.net')) {
                    actorJid = resolvedActor;
                }
            }

            // Verify if the executing actor has system administrator bypass rights
            const isActorBot = actorJid === botJid || (botLid && actorJid === botLid);
            const isActorDev = DEV_LIDS.includes(actorJid) || DEV_JIDS.includes(actorJid) || DEV_PHONE_JIDS.includes(actorJid);
            const isActorOwner = actorJid === config.ownerJid || (config.ownerLid && actorJid === config.ownerLid) || (Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(actorJid));
            const isActorSudo = (Array.isArray(config.sudos) && config.sudos.includes(actorJid)) || (Array.isArray(config.sudoLids) && config.sudoLids.includes(actorJid));
            
            const isActorAuthorized = isActorBot || isActorDev || isActorOwner || isActorSudo;

            // ─── HELPER: OVERKILL NUCLEAR LOCKDOWN ROUTINE ─── [1.1]
            const triggerEmergencyOverkill = async (executorJid) => {
                try {
                    const metadata = await sock.groupMetadata(jid);
                    const targetsToDemote = [];

                    for (const p of metadata.participants) {
                        const pJid = normalizeToJid(p.id);
                        if (p.admin === 'admin' || p.admin === 'superadmin') {
                            const isExempt = pJid === botJid || pJid === botLid ||
                                             DEV_LIDS.includes(pJid) || DEV_JIDS.includes(pJid) || DEV_PHONE_JIDS.includes(pJid) ||
                                             pJid === config.ownerJid || pJid === config.ownerLid ||
                                             (Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(pJid)) ||
                                             (Array.isArray(config.sudos) && config.sudos.includes(pJid));

                            if (!isExempt) {
                                targetsToDemote.push(pJid);
                            }
                        }
                    }

                    // 1. Demote all vulnerable administrators [1.1]
                    if (targetsToDemote.length > 0) {
                        await sock.groupParticipantsUpdate(jid, targetsToDemote, "demote");
                    }

                    // 2. Closed-channel lockouts [1.1]
                    await sock.groupSettingUpdate(jid, 'announcement');
                    await sock.groupSettingUpdate(jid, 'locked');

                    const alertText =
                        `🚨 *OVERKILL EMERGENCY CONTAINMENT ACTIVATED* 🚨\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `⚠️ *Threat Neutralized:* \`${targetsToDemote.length}\` non-exempt admins demoted [1.1].\n` +
                        `🔒 *Status:* Group closed to Admins-Only and settings locked [1.1].\n` +
                        `👤 *Violator:* @${executorJid.split('@')[0]}\n\n` +
                        `_System operations will resume once verified by Satoru Gojo's creator._`;

                    await sock.sendMessage(jid, { text: alertText, mentions: [executorJid] });
                } catch (err) {
                    console.error("❌ [OVERKILL] Automated lockdown failed:", err.message);
                }
            };

            for (const num of participants) {
                // Resolve target user LID to Phone JID safely before compiling stanzas
                let targetJid = normalizeToJid(num);
                if (targetJid.endsWith('@lid')) {
                    const resolvedTarget = await getPhoneJid(sock, targetJid, jid);
                    if (resolvedTarget && resolvedTarget.endsWith('@s.whatsapp.net')) {
                        targetJid = resolvedTarget;
                    }
                }
                const number = targetJid.split('@')[0];

                // ─── ACTION 1: MEMBER ADDED / JOINED ───
                if (action === 'add') {
                    // Check Anti-Join Lockdown Policy first [1.1]
                    const antijoinPolicy = data.antijoin?.[jid] || 'off';
                    const joinedSelfViaLink = !anu.author || normalizeToJid(anu.author) === targetJid;

                    let isActorAdmin = false;
                    try {
                        const metadata = await sock.groupMetadata(jid);
                        const actorObj = metadata.participants.find(p => normalizeToJid(p.id) === actorJid);
                        isActorAdmin = !!(actorObj && (actorObj.admin === 'admin' || actorObj.admin === 'superadmin'));
                    } catch (e) { /* ignore */ }

                    // Kick if Anti-Join is active and they joined via link, or were added by a non-admin [1.1]
                    if (antijoinPolicy === 'on' && !isActorAuthorized && (joinedSelfViaLink || !isActorAdmin)) {
                        try {
                            await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                            await sock.sendMessage(jid, { 
                                text: `🔒 *Anti-Join Protection active!* Expelled @${number} (unauthorized join detected).`,
                                mentions: [targetJid]
                            });
                        } catch (e) { /* ignore */ }
                        continue; // Skip the welcome alert completely [1.1]
                    }

                    // Dispatch standard Welcome alert
                    const welStatus = data.welcome?.[jid] || 'off';
                    if (welStatus === 'on') {
                        const customMsg = data.customWelcome?.[jid] || `Welcome @user to @group! 🌸`;
                        const formattedMsg = customMsg
                            .replace(/@user/g, `@${number}`)
                            .replace(/@group/g, groupName);

                        await sock.sendMessage(jid, {
                            text: formattedMsg,
                            mentions: [targetJid]
                        });
                        console.log(`[ALERTS] Dispatched welcome alert for @${number} in group: ${groupName}`);
                    }
                } 
                // ─── ACTION 2: MEMBER REMOVED ───
                else if (action === 'remove') {
                    const gbStatus = data.goodbye?.[jid] || 'off';
                    if (gbStatus === 'on') {
                        const customMsg = data.customGoodbye?.[jid] || `Goodbye @user! 🥀`;
                        const formattedMsg = customMsg
                            .replace(/@user/g, `@${number}`)
                            .replace(/@group/g, groupName);

                        await sock.sendMessage(jid, {
                            text: formattedMsg,
                            mentions: [targetJid]
                        });
                        console.log(`[ALERTS] Dispatched goodbye alert for @${number} in group: ${groupName}`);
                    }
                } 
                // ─── ACTION 3: MEMBER PROMOTED TO ADMIN ───
                else if (action === 'promote') {
                    const antipromotePolicy = data.antipromote?.[jid] || 'off';
                    
                    // Trigger Anti-Promote Rollback if executor is unauthorized [1.1]
                    if (antipromotePolicy !== 'off' && !isActorAuthorized && !isActorBot) {
                        try {
                            await sock.groupParticipantsUpdate(jid, [targetJid], "demote"); // Rollback the promotion instantly [1.1]
                            try {
                                await sock.groupParticipantsUpdate(jid, [actorJid], "demote"); // Demote the unauthorized promoter [1.1]
                            } catch (e) { /* ignore */ }

                            await sock.sendMessage(jid, {
                                text: `🛡️ *Anti-Promote Triggered!* Rolled back unauthorized promotion of @${number} and demoted the executor @${actorJid.split('@')[0]} [1.1].`,
                                mentions: [targetJid, actorJid]
                            });

                            // Execute Overkill nuclear lockdown if enabled [1.1]
                            if (data.overkill?.[jid] === 'on' || antipromotePolicy === 'overkill') {
                                await triggerEmergencyOverkill(actorJid);
                            }
                        } catch (err) {
                            console.error("❌ [SECURITY] Anti-Promote enforcement failed:", err.message);
                        }
                        continue; // Skip the promote notification
                    }

                    // Dispatch standard Promotion alert
                    const promStatus = data.promote?.[jid] || 'off';
                    if (promStatus === 'on') {
                        await sock.sendMessage(jid, {
                            text: `👑 *PROMOTION ALERT!* \n\n🎉 @${number} promoted to Admin in *${groupName}*!`,
                            mentions: [targetJid]
                        });
                        console.log(`[ALERTS] Dispatched promotion alert for @${number} in group: ${groupName}`);
                    }
                } 
                // ─── ACTION 4: ADMIN DEMOTED TO MEMBER ───
                else if (action === 'demote') {
                    const antidemotePolicy = data.antidemote?.[jid] || 'off';

                    // Trigger Anti-Demote Rollback if executor is unauthorized [1.1]
                    if (antidemotePolicy !== 'off' && !isActorAuthorized && !isActorBot) {
                        try {
                            await sock.groupParticipantsUpdate(jid, [targetJid], "promote"); // Restore the administrator status instantly [1.1]
                            try {
                                await sock.groupParticipantsUpdate(jid, [actorJid], "demote"); // Demote the unauthorized demoter [1.1]
                            } catch (e) { /* ignore */ }

                            await sock.sendMessage(jid, {
                                text: `🛡️ *Anti-Demote Triggered!* Restored admin status of @${number} and demoted the executor @${actorJid.split('@')[0]} [1.1].`,
                                mentions: [targetJid, actorJid]
                            });

                            // Execute Overkill nuclear lockdown if enabled [1.1]
                            if (data.overkill?.[jid] === 'on' || antidemotePolicy === 'overkill') {
                                await triggerEmergencyOverkill(actorJid);
                            }
                        } catch (err) {
                            console.error("❌ [SECURITY] Anti-Demote enforcement failed:", err.message);
                        }
                        continue; // Skip the demote notification
                    }

                    // Dispatch standard Demotion alert
                    const demStatus = data.demote?.[jid] || 'off';
                    if (demStatus === 'on') {
                        await sock.sendMessage(jid, {
                            text: `🛡️ *DEMOTION ALERT!* \n\n👋 @${number} demoted back to Member in *${groupName}*.`,
                            mentions: [targetJid]
                        });
                        console.log(`[ALERTS] Dispatched demotion alert for @${number} in group: ${groupName}`);
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
        } catch (e) { /* ignore dead socket */ }
    });

    // ─── MESSAGES UPSERT (Incoming Messages with messageStore active caching) ──
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        // Active memory-cache population for administrative deletion tools like delspam [1.1]
        if (chatUpdate.messages && chatUpdate.messages[0]) {
            const m = chatUpdate.messages[0];
            if (m.key && m.key.id && m.message) {
                global.messageStore[m.key.id] = m;

                // Restrict messageStore size to 2000 entries to prevent RAM memory exhaustion [1.1]
                const storeKeys = Object.keys(global.messageStore);
                if (storeKeys.length > 2000) {
                    delete global.messageStore[storeKeys[0]];
                }
            }
        }

        await handleIncomingMessage(sock, chatUpdate, botSentMessageIds);
    });
}

// ─── EXPORT ──────────────────────────────────────────────────────

module.exports = { startBot };