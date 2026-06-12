// pair.js
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const commands = require('./commands');
const settings = require('./settings');
const fs = require('fs');
const path = require('path');

const { handleMessageDeletion } = require('./helpers/antiDelete');
const { handleIncomingMessage } = require('./helpers/messageHandlers');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const botSentMessageIds = new Set();

// Global Caches
global.messageStore = global.messageStore || {};
global.spamTracker = global.spamTracker || {};
global.spamDeletedCount = global.spamDeletedCount || {}; 
global.azaSessions = global.azaSessions || {};
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};
global.reminderSessions = global.reminderSessions || {};
global.cancelSessions = global.cancelSessions || {};

// Global Game Sessions Interceptors
global.triviaSessions = global.triviaSessions || {};
global.charadeSessions = global.charadeSessions || {};
global.anagramSessions = global.anagramSessions || {};
global.wcgSessions = global.wcgSessions || {};
global.millionaireSessions = global.millionaireSessions || {};
global.torfSessions = global.torfSessions || {};
global.pvpSessions = global.pvpSessions || {};
global.escapeSessions = global.escapeSessions || {};
global.vault8Sessions = global.vault8Sessions || {};

// Global AI Session Memory & Outbound Trackers
global.aiMemory = global.aiMemory || {};
global.botMessageAgents = global.botMessageAgents || {};

async function startBot() {
    if (!fs.existsSync(path.join(__dirname, '.git'))) {
        const repoUrl = "https://github.com/Botking134/Limitless-MD.git";
        const { execSync } = require('child_process');
        try {
            execSync(`git init && git remote add origin ${repoUrl} && git fetch origin && (git checkout -f main || git checkout -f master)`);
        } catch (setupError) {}
    }

    const { 
        default: makeWASocket, 
        useMultiFileAuthState, 
        delay, 
        Browsers, 
        DisconnectReason 
    } = await import('@itsliaaa/baileys');

    const BASE_DEVS = [
        "27713655070@s.whatsapp.net", 
        "601129363700@s.whatsapp.net", 
        "2347059092107@s.whatsapp.net", 
        "2347040401291@s.whatsapp.net"
    ];

    if (!Array.isArray(settings.devs)) {
        settings.devs = [...BASE_DEVS];
    } else {
        BASE_DEVS.forEach(dev => {
            if (!settings.devs.includes(dev)) settings.devs.push(dev);
        });
    }

    if (!Array.isArray(settings.devLids)) {
        settings.devLids = [];
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    let targetNumber = null;

    if (!state.creds.registered) {
        console.log('👉 Enter your WhatsApp number with country code:');
        let numberInput = await question('');
        targetNumber = numberInput.replace(/[^0-9]/g, '');
        if (!targetNumber) process.exit(1);
    }

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome')
    });

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

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (targetNumber && !pairingCodeRequested) {
            pairingCodeRequested = true;
            await delay(5000); 
            try {
                const code = await sock.requestPairingCode(targetNumber, "INFINITY");
                console.log(`\n🔑 Your Pairing Code: \x1b[32m\x1b[1m${code}\x1b[0m`);
            } catch (error) {
                pairingCodeRequested = false; 
            }
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                process.exit(1);
            } else {
                setTimeout(() => startBot(), 5000); 
            }
        } else if (connection === 'open') {
            if (sock.user && sock.user.id) {
                const selfJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                settings.botJid = selfJid;
                
                try {
                    const resolved = await sock.findUserId(sock.user.id);
                    if (resolved) {
                        if (resolved.phoneNumber) {
                            settings.botJid = `${resolved.phoneNumber}@s.whatsapp.net`;
                        }
                        if (resolved.lid) {
                            settings.botLid = resolved.lid;
                        }
                    }
                } catch (err) {}
            }

            // Map Developer JIDs to LIDs on startup
            try {
                console.log("⚡ [SYSTEM] Resolving developer LIDs...");
                settings.devLids = settings.devLids || [];
                for (const devJid of settings.devs) {
                    const resolvedDev = await sock.findUserId(devJid);
                    if (resolvedDev && resolvedDev.lid) {
                        if (!settings.devLids.includes(resolvedDev.lid)) {
                            settings.devLids.push(resolvedDev.lid);
                        }
                    }
                }
                console.log(`👑 [SYSTEM] Developer LIDs mapped:`, settings.devLids);
            } catch (resolveErr) {
                console.error("[WARNING] Failed to pre-resolve developer LIDs on boot:", resolveErr);
            }

            setInterval(async () => {
                if (settings.presence && settings.presence.alwaysonline?.all) {
                    try { await sock.sendPresenceUpdate('available'); } catch (e) {}
                }
            }, 15000);
        }
    });

    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const jid = anu.id;
            const participants = anu.participants;
            const action = anu.action;

            if (!settings.gcalerts) {
                settings.gcalerts = { promote: {}, demote: {}, welcome: {}, goodbye: {} };
            }

            for (const num of participants) {
                const number = num.split('@')[0];

                if (action === 'add') {
                    if (settings.gcalerts.welcome?.[jid] === 'on' || (settings.welcome?.[jid]?.active)) {
                        const customMsg = settings.welcome?.[jid]?.msg || `Welcome @${number}! 🌸`;
                        await sock.sendMessage(jid, { text: customMsg.replace(/@user/g, `@${number}`), mentions: [num] });
                    }
                }
                else if (action === 'remove') {
                    if (settings.gcalerts.goodbye?.[jid] === 'on' || (settings.goodbye?.[jid]?.active)) {
                        const customMsg = settings.goodbye?.[jid]?.msg || `Goodbye @${number}! 🥀`;
                        await sock.sendMessage(jid, { text: customMsg.replace(/@user/g, `@${number}`), mentions: [num] });
                    }
                }
                else if (action === 'promote') {
                    if (settings.gcalerts.promote?.[jid] === 'on') {
                        await sock.sendMessage(jid, { text: `👑 *PROMOTION ALERT!* \n\n🎉 @${number} promoted to Admin!`, mentions: [num] });
                    }
                }
                else if (action === 'demote') {
                    if (settings.gcalerts.demote?.[jid] === 'on') {
                        await sock.sendMessage(jid, { text: `🛡️ *DEMOTION ALERT!* \n\n👋 @${number} demoted back to Member.`, mentions: [num] });
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
                        await handleMessageDeletion(sock, originalMsg, jid, update.key.participant || update.key.remoteJid || '');
                    }
                }
            }
        } catch (e) {}
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        await handleIncomingMessage(sock, chatUpdate, botSentMessageIds);
    });
}

module.exports = { startBot };