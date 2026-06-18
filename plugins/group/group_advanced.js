// plugins/group/group_advanced.js
const config = require('../../config');
const { saveState, normalizeToJid, resolveToPhoneJid } = require('../../stateManager');
const { DEV_LIDS } = require('../../devs');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ─── GLOBALS ──────────────────────────────────────────────────────
global.tkickTimers = global.tkickTimers || {};
global.kickallActive = global.kickallActive || {};
global.groupTimers = global.groupTimers || {};
global.gclogIntervals = global.gclogIntervals || {};

// ─── HELPERS ──────────────────────────────────────────────────────

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

function parseTargetUser(msg, args) {
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo ||
                        rawMsg?.extendedTextMessage?.contextInfo ||
                        rawMsg?.imageMessage?.contextInfo ||
                        rawMsg?.videoMessage?.contextInfo ||
                        rawMsg?.stickerMessage?.contextInfo ||
                        rawMsg?.audioMessage?.contextInfo ||
                        rawMsg?.documentMessage?.contextInfo;

    const mentions = contextInfo?.mentionedJid || [];

    if (mentions.length > 0) {
        return normalizeToJid(mentions[0]);
    }

    if (contextInfo?.participant) {
        return normalizeToJid(contextInfo.participant);
    }

    if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            return `${cleanDigits}@s.whatsapp.net`;
        }
    }

    return '';
}

function isDeveloper(jid) {
    if (!jid) return false;
    const normalized = normalizeToJid(jid);
    return DEV_LIDS.includes(normalized);
}

function isOwnerTarget(target) {
    return target === config.ownerJid ||
           (config.ownerLid && target === config.ownerLid) ||
           (config.ownerLids && config.ownerLids.includes(target)) ||
           (config.secondaryOwners && config.secondaryOwners.includes(target));
}

function parseDuration(str) {
    const match = str.match(/^(\d+)([smh])$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return null;
}

// ─── UPDATED verifyPermissions (Issue 2) ──────────────────────
async function verifyPermissions(sock, msg, jid, isOwner, isDev = false, isSudo = false, commandName = '') {
    const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

    // 1. AUTHORIZATION CHECK
    const isAuthorized = isDev || isOwner || isSudo;
    if (!isAuthorized) return false;

    // 2. EXEMPT COMMANDS
    const exemptCommands = [
        'tag', 'tagall', 'htag', 'admins', 'link', 'invite', 'gclink',
        'gcjid', 'getgpp', 'poll', 'togcstatus', 'togcjid',
        'join', 'exit', 'listonline', 'msgs'
    ];
    if (exemptCommands.includes(commandName.toLowerCase())) {
        return true;
    }

    // 3. BOT ADMIN CHECK
    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants;

    const botJid = normalizeToJid(sock.user.id);
    const botLid = config.botLid || '';

    const botParticipant = participants.find(p => {
        const pId = normalizeToJid(p.id);
        const pLid = p.lid ? normalizeToJid(p.lid) : '';
        return pId === botJid ||
               (botLid && pId === botLid) ||
               (botLid && pLid === botLid) ||
               (pLid && pLid === botJid);
    });
    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

    if (!isBotAdmin) {
        await sock.sendMessage(jid, { text: "❌ I must be an administrator in this group first!" }, { quoted: msg });
        return false;
    }

    // 4. DEVELOPER BYPASS
    if (isDev) {
        return true;
    }

    // 5. SENDER ADMIN CHECK
    let sender = participants.find(p => {
        const pId = normalizeToJid(p.id);
        const pLid = p.lid ? normalizeToJid(p.lid) : '';
        return pId === senderJid || (pLid && pLid === senderJid);
    });
    const isSenderAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';
    if (!isSenderAdmin) {
        await sock.sendMessage(jid, { text: "❌ You must be an administrator in this group to run this command!" }, { quoted: msg });
        return false;
    }

    return true;
}

// ─── GEMINI SUMMARY ─────────────────────────────────────────────
async function queryGeminiText(prompt, logString) {
    const apiKey = config.geminiApiKey;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set in config or .env");

    try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        try {
            const response = await ai.models.generateContent({
                model: "gemini-3.5-flash",
                contents: `${prompt}\n\nHere are the chat logs:\n${logString}`
            });
            return response.text || "Could not generate summary.";
        } catch (sdkErr) {
            const response = await ai.interactions.create({
                model: "gemini-3.5-flash",
                input: `${prompt}\n\nHere are the chat logs:\n${logString}`
            });
            return response.text || response.output || "Could not generate summary.";
        }
    } catch (e) {
        throw new Error(`Gemini SDK error: ${e.message}`);
    }
}

async function triggerSummary(sock, jid) {
    const logs = config.conversationLogs?.[jid] || [];
    if (logs.length === 0) return;

    const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');
    const prompt = "You are Satoru Gojo. Summarize this group conversation logs. You must output exactly 10 bullet points. Keep your tone playful, cocky, and engaging. Do not include any intro, outro, or conversational filler.";

    try {
        const responseText = await queryGeminiText(prompt, logString);
        await sock.sendMessage(jid, { text: `🤞 *LIMITLESS DOMAIN 3-HOUR CONVERSATION SUMMARY:*\n\n${responseText.trim()}` });

        if (config.conversationLogs) config.conversationLogs[jid] = [];
        saveState();
    } catch (err) {
        console.error("Auto summary failed:", err);
    }
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. WELCOME
    {
        name: 'welcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'welcome');
            if (!isAuthorized) return;

            if (!config.welcome) config.welcome = {};

            const parts = args ? args.split(' ') : [];
            const subAction = parts[0] ? parts[0].toLowerCase().trim() : '';

            if (subAction === 'on') {
                config.welcome[jid] = config.welcome[jid] || { active: true, msg: "" };
                config.welcome[jid].active = true;

                if (!config.gcalerts) config.gcalerts = { promote: {}, demote: {}, welcome: {}, goodbye: {} };
                config.gcalerts.welcome = config.gcalerts.welcome || {};
                config.gcalerts.welcome[jid] = 'on';

                saveState();
                return await sock.sendMessage(jid, { text: "✅ Welcoming sequence activated for new members." }, { quoted: msg });
            }

            if (subAction === 'off') {
                config.welcome[jid] = config.welcome[jid] || { active: false, msg: "" };
                config.welcome[jid].active = false;

                if (!config.gcalerts) config.gcalerts = { promote: {}, demote: {}, welcome: {}, goodbye: {} };
                config.gcalerts.welcome = config.gcalerts.welcome || {};
                config.gcalerts.welcome[jid] = 'off';

                saveState();
                return await sock.sendMessage(jid, { text: "❌ Welcoming sequence deactivated." }, { quoted: msg });
            }

            if (subAction === 'set') {
                const customMsg = parts.slice(1).join(' ').trim();
                if (!customMsg) return await sock.sendMessage(jid, { text: "❌ Provide a custom message." }, { quoted: msg });

                config.welcome[jid] = config.welcome[jid] || { active: true };
                config.welcome[jid].msg = customMsg;
                saveState();
                return await sock.sendMessage(jid, { text: `✅ Custom welcome message set.` }, { quoted: msg });
            }

            const currentStatus = config.welcome[jid]?.active ? "Enabled ✅" : "Disabled ❌";
            const prompt = `🌸 *Welcome Module Configuration:*\n\nStatus: \`${currentStatus}\``;
            await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
        }
    },

    // 2. GOODBYE
    {
        name: 'goodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'goodbye');
            if (!isAuthorized) return;

            if (!config.goodbye) config.goodbye = {};

            const parts = args ? args.split(' ') : [];
            const subAction = parts[0] ? parts[0].toLowerCase().trim() : '';

            if (subAction === 'on') {
                config.goodbye[jid] = config.goodbye[jid] || { active: true, msg: "" };
                config.goodbye[jid].active = true;

                if (!config.gcalerts) config.gcalerts = { promote: {}, demote: {}, welcome: {}, goodbye: {} };
                config.gcalerts.goodbye = config.gcalerts.goodbye || {};
                config.gcalerts.goodbye[jid] = 'on';

                saveState();
                return await sock.sendMessage(jid, { text: "✅ Goodbye notification sequence activated." }, { quoted: msg });
            }

            if (subAction === 'off') {
                config.goodbye[jid] = config.goodbye[jid] || { active: false, msg: "" };
                config.goodbye[jid].active = false;

                if (!config.gcalerts) config.gcalerts = { promote: {}, demote: {}, welcome: {}, goodbye: {} };
                config.gcalerts.goodbye = config.gcalerts.goodbye || {};
                config.gcalerts.goodbye[jid] = 'off';

                saveState();
                return await sock.sendMessage(jid, { text: "❌ Goodbye notification sequence deactivated." }, { quoted: msg });
            }

            if (subAction === 'set') {
                const customMsg = parts.slice(1).join(' ').trim();
                if (!customMsg) return await sock.sendMessage(jid, { text: "❌ Provide custom goodbye message." }, { quoted: msg });

                config.goodbye[jid] = config.goodbye[jid] || { active: true };
                config.goodbye[jid].msg = customMsg;
                saveState();
                return await sock.sendMessage(jid, { text: `✅ Custom goodbye message set.` }, { quoted: msg });
            }

            const currentStatus = config.goodbye[jid]?.active ? "Enabled ✅" : "Disabled ❌";
            const currentMsg = config.goodbye[jid]?.msg || "Goodbye @user! We'll miss you.";
            const prompt = `🌸 *Goodbye Module Configuration:*\n\nStatus: \`${currentStatus}\`\nLayout: _"${currentMsg}"_`;
            await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
        }
    },

    // 3. DELWELCOME
    {
        name: 'delwelcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'delwelcome');
            if (!isAuthorized) return;

            if (config.welcome && config.welcome[jid]) delete config.welcome[jid];
            await sock.sendMessage(jid, { text: "✅ Welcome settings removed." }, { quoted: msg });
            saveState();
        }
    },

    // 4. DELGOODBYE
    {
        name: 'delgoodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'delgoodbye');
            if (!isAuthorized) return;

            if (config.goodbye && config.goodbye[jid]) delete config.goodbye[jid];
            await sock.sendMessage(jid, { text: "✅ Goodbye settings removed." }, { quoted: msg });
            saveState();
        }
    },

    // 5. GCALERTS
    {
        name: 'gcalerts',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'gcalerts');
            if (!isAuthorized) return;

            if (!config.gcalerts) {
                config.gcalerts = { promote: {}, demote: {}, welcome: {}, goodbye: {} };
            }

            const parts = args ? args.toLowerCase().trim().split(' ') : [];
            const sub = parts[0] || '';
            const toggle = parts[1] || '';

            const validSubs = ['promote', 'demote', 'welcome', 'goodbye'];
            if (!validSubs.includes(sub)) {
                const promStatus = config.gcalerts.promote?.[jid] || 'off';
                const demStatus = config.gcalerts.demote?.[jid] || 'off';
                const welStatus = config.gcalerts.welcome?.[jid] || 'off';
                const gbStatus = config.gcalerts.goodbye?.[jid] || 'off';

                return await sock.sendMessage(jid, {
                    text: `🔔 *Group Alerts Dashboard (gcalerts)* 🔔\n` +
                          `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `• *Promote Alert:* \`${promStatus.toUpperCase()}\` (Format: @target was promoted by @actor)\n` +
                          `• *Demote Alert:* \`${demStatus.toUpperCase()}\` (Format: @target was demoted by @actor)\n` +
                          `• *Welcome Alert:* \`${welStatus.toUpperCase()}\` (Linked to .welcome)\n` +
                          `• *Goodbye Alert:* \`${gbStatus.toUpperCase()}\` (Linked to .goodbye)\n\n` +
                          `👉 To toggle: \`${config.prefix}gcalerts <promote/demote/welcome/goodbye> <on/off>\``
                }, { quoted: msg });
            }

            if (toggle !== 'on' && toggle !== 'off') return await sock.sendMessage(jid, { text: `❌ Use 'on' or 'off'.` }, { quoted: msg });

            config.gcalerts[sub] = config.gcalerts[sub] || {};
            config.gcalerts[sub][jid] = toggle;

            if (sub === 'welcome') {
                config.welcome = config.welcome || {};
                config.welcome[jid] = config.welcome[jid] || {};
                config.welcome[jid].active = (toggle === 'on');
            }
            if (sub === 'goodbye') {
                config.goodbye = config.goodbye || {};
                config.goodbye[jid] = config.goodbye[jid] || {};
                config.goodbye[jid].active = (toggle === 'on');
            }

            saveState();

            await sock.sendMessage(jid, { text: `✅ *Alert updated:* ${sub.toUpperCase()} alert is now \`${toggle.toUpperCase()}\`` }, { quoted: msg });
        }
    },

    // 6. GCLOG
    {
        name: 'gclog',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'gclog');
            if (!isAuthorized) return;

            if (!config.gclogActive) config.gclogActive = {};
            if (!config.conversationLogs) config.conversationLogs = {};

            const action = args ? args.toLowerCase().trim() : '';

            if (!action) {
                const current = config.gclogActive[jid] ? 'on' : 'off';
                const activeStatus = current === 'on' ? "Active 🟢" : "Inactive 💤";
                const prompt = `📊 *Group Chat Log (GCLOG) Configuration:*\n\n` +
                               `• *Status:* \`${activeStatus}\`\n\n` +
                               `Select an option below to configure chat logs:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}gclog on`, buttonText: { displayText: 'Turn On 🟢' }, type: 1 },
                        { buttonId: `${config.prefix}gclog off`, buttonText: { displayText: 'Turn Off 💤' }, type: 1 },
                        { buttonId: `${config.prefix}gclog check`, buttonText: { displayText: 'Check Log 📊' }, type: 1 }
                    ],
                    headerType: 1
                };
                try {
                    return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    return await sock.sendMessage(jid, { text: `${prompt}\n\n• \`${config.prefix}gclog on\`\n• \`${config.prefix}gclog off\`\n• \`${config.prefix}gclog check\`` }, { quoted: msg });
                }
            }

            if (action === 'on') {
                config.gclogActive[jid] = true;

                if (global.gclogIntervals[jid]) clearInterval(global.gclogIntervals[jid]);
                global.gclogIntervals[jid] = setInterval(async () => {
                    await triggerSummary(sock, jid);
                }, 3 * 60 * 60 * 1000);

                await sock.sendMessage(jid, { text: "🔒 *GCLOG Activated. Chat recordings have commenced. A 10-point summary will be generated every 3 hours.*" }, { quoted: msg });
                saveState();
                return;
            }

            if (action === 'off') {
                if (global.gclogIntervals[jid]) {
                    clearInterval(global.gclogIntervals[jid]);
                    delete global.gclogIntervals[jid];
                }
                config.gclogActive[jid] = false;
                if (config.conversationLogs[jid]) delete config.conversationLogs[jid];

                await sock.sendMessage(jid, { text: "🔓 *GCLOG Deactivated and logs cleared.*" }, { quoted: msg });
                saveState();
                return;
            }

            if (action === 'check') {
                const logs = config.conversationLogs[jid] || [];
                if (logs.length === 0) return await sock.sendMessage(jid, { text: "📊 No logs found within the current 3-hour window." }, { quoted: msg });

                await sock.sendMessage(jid, { text: "⏳ *Summarizing current logs...*" }, { quoted: msg });
                const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');

                const prompt = "You are Satoru Gojo. Summarize this group conversation logs. You must output exactly 10 bullet points. Keep your tone playful and cocky. Do not include any intro, outro, or conversational filler.";

                try {
                    const responseText = await queryGeminiText(prompt, logString);
                    await sock.sendMessage(jid, { text: `🤞 *LIMITLESS DOMAIN CONVERSATION PREVIEW (Current Window):*\n\n${responseText.trim()}` }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(jid, { text: "❌ Summary generation failed." }, { quoted: msg });
                }
            }
        }
    },

    // 7. CREATEGC
    {
        name: 'creategc',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isAuthorizedMember = isDev || isOwner || isSudo;
            if (!isAuthorizedMember) return;

            if (!args) return await sock.sendMessage(jid, { text: "❌ Provide a group name." }, { quoted: msg });

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid;
                const phoneJid = await resolveToPhoneJid(sock, senderJid);
                if (!phoneJid) return await sock.sendMessage(jid, { text: "❌ Resolution failed." }, { quoted: msg });

                const group = await sock.groupCreate(args, [phoneJid]);
                await sock.sendMessage(jid, { text: `• Name: \`${args}\`\n• ID: \`${group.id}\`` }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 8. KICKALL
    {
        name: 'kickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'kickall');
            if (!isAuthorized) return;

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;

                const botJid = normalizeToJid(sock.user.id);
                const targets = participants.filter(p => {
                    const normId = normalizeToJid(p.id);
                    return normId !== botJid &&
                           !isOwnerTarget(normId) &&
                           !isDeveloper(normId) &&
                           p.admin !== 'superadmin' && p.admin !== 'admin';
                }).map(p => p.id);

                if (targets.length === 0) return await sock.sendMessage(jid, { text: "❌ No non-admin targets found to exorcise." }, { quoted: msg });

                const durationString = args ? args.trim() : '';
                const countdownMs = durationString ? (parseDuration(durationString) || 20000) : 20000;
                const countdownSecs = countdownMs / 1000;

                const text = `🌪 *Channelling Limitless Void... Exorcism sequence initiated.* Removing all members in *${countdownSecs} seconds*.`;
                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${config.prefix}stopkickall`, buttonText: { displayText: 'Stop Exorcism 🛑' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (btnErr) {
                    await sock.sendMessage(jid, { text: `${text}\n\n💡 _Type:_ \`${config.prefix}stopkickall\` to abort.` }, { quoted: msg });
                }

                global.kickallActive[jid] = true;

                await new Promise(resolve => setTimeout(resolve, countdownMs));

                if (!global.kickallActive[jid]) {
                    return;
                }

                await sock.sendMessage(jid, { text: "🌪 *Countdown elapsed. Beginning exorcism...*" });

                for (const target of targets) {
                    if (!global.kickallActive[jid]) {
                        await sock.sendMessage(jid, { text: "🛑 *Exorcism sequence aborted by administrator.*" });
                        break;
                    }
                    try {
                        await sock.groupParticipantsUpdate(jid, [target], "remove");
                        await new Promise(r => setTimeout(r, 1000));
                    } catch (err) {}
                }

                if (global.kickallActive[jid]) {
                    await sock.sendMessage(jid, { text: "✅ *Exorcism complete.*" });
                }
                delete global.kickallActive[jid];
            } catch (error) {}
        }
    },

    // 9. STOPKICKALL
    {
        name: 'stopkickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isAuthorizedMember = isDev || isOwner || isSudo;
            if (!isAuthorizedMember) return;

            if (global.kickallActive[jid]) {
                global.kickallActive[jid] = false;
                await sock.sendMessage(jid, { text: "🛑 *Stopping exorcism...*" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ No active operation running." }, { quoted: msg });
            }
        }
    },

    // 10. TKICK
    {
        name: 'tkick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'tkick');
            if (!isAuthorized) return;

            const target = parseTargetUser(msg, args);

            if (target && isDeveloper(target)) {
                return await sock.sendMessage(jid, { text: "🛡️ *Immunity Triggered:* Cannot restrict a Core Developer of this domain." }, { quoted: msg });
            }

            const cleanTargets = (target && !isOwnerTarget(target)) ? [target] : [];

            const durationString = args ? args.replace(/@[^ ]+/g, '').trim().split(' ')[0] : '';
            if (durationString.toLowerCase() === 'cancel' || durationString.toLowerCase() === 'stop') {
                const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));
                if (activeKeys.length === 0) return await sock.sendMessage(jid, { text: "❌ No pending timed kicks found." }, { quoted: msg });

                activeKeys.forEach(key => {
                    clearTimeout(global.tkickTimers[key].timeoutId);
                    delete global.tkickTimers[key];
                });

                return await sock.sendMessage(jid, { text: "✅ Cancelled all pending timed kicks in this group." }, { quoted: msg });
            }

            if (cleanTargets.length === 0) {
                const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));
                if (activeKeys.length === 0) return await sock.sendMessage(jid, { text: "❌ No pending timed kicks found." }, { quoted: msg });

                let list = "⏳ *PENDING TIMED KICKS:*\n\n";
                activeKeys.forEach((key, idx) => {
                    const task = global.tkickTimers[key];
                    const remainingSec = Math.max(0, Math.floor((task.endTime - Date.now()) / 1000));
                    list += `${idx + 1}. @${task.targetJid.split('@')[0]} — Remaining: *${remainingSec}s*\n`;
                });
                return await sock.sendMessage(jid, { text: list, mentions: activeKeys.map(k => global.tkickTimers[k].targetJid) }, { quoted: msg });
            }

            const durationMs = parseDuration(durationString);
            if (!durationMs) return await sock.sendMessage(jid, { text: "❌ Invalid duration." }, { quoted: msg });

            for (const targetJid of cleanTargets) {
                const timerKey = `${jid}_${targetJid}`;
                if (global.tkickTimers[timerKey]) clearTimeout(global.tkickTimers[timerKey].timeoutId);

                const timeoutId = setTimeout(async () => {
                    try {
                        await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                        await sock.sendMessage(jid, { text: `🌪️ *Timer Elapsed.* Exorcised: @${targetJid.split('@')[0]}`, mentions: [targetJid] });
                    } catch (err) {}
                    delete global.tkickTimers[timerKey];
                }, durationMs);

                global.tkickTimers[timerKey] = { timeoutId, targetJid, endTime: Date.now() + durationMs };
            }

            await sock.sendMessage(jid, { text: `⏳ Timed kick set for target.`, mentions: cleanTargets }, { quoted: msg });
        }
    },

    // 11. JOIN
    {
        name: 'join',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isAuthorized = isDev || isOwner;
            if (!isAuthorized) return;

            if (!args) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid WhatsApp group invite link." }, { quoted: msg });
            }

            const match = args.match(/chat.whatsapp.com\/([a-zA-Z0-9]{15,25})/);
            if (!match) {
                return await sock.sendMessage(jid, { text: "❌ Invalid invite link format." }, { quoted: msg });
            }

            try {
                const code = match[1];
                const joinedJid = await sock.groupAcceptInvite(code);
                await sock.sendMessage(jid, { text: `✅ Joined group successfully! JID: \`${joinedJid}\`` }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to join group: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 12. EXIT
    {
        name: 'exit',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isAuthorized = isDev || isOwner;
            if (!isAuthorized) return;

            const targetJid = args ? args.trim() : jid;
            if (!targetJid.endsWith('@g.us')) {
                return await sock.sendMessage(jid, { text: "❌ Please run this in a group, or specify a valid group JID." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(targetJid, { text: "👋 Deactivating Infinite Void. Leaving group!" });
                await sock.groupLeave(targetJid);
                if (targetJid !== jid) {
                    await sock.sendMessage(jid, { text: "✅ Successfully left group." }, { quoted: msg });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to leave group: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 13. TOGCSTATUS
    {
        name: 'togcstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'togcstatus');
            if (!isAuthorized) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = quoted ? getRawMessage(quoted) : null;

            try {
                const {
                    downloadContentFromMessage,
                    prepareWAMessageMedia,
                    generateWAMessageFromContent,
                    proto
                } = await import('@itsliaaa/baileys');

                let targetJid = jid;
                let sendToStatus = false;

                if (args && args.trim().endsWith('@g.us')) {
                    targetJid = args.trim();
                    sendToStatus = true;
                }

                let messagePayload = {};

                if (rawContent && (rawContent.videoMessage || rawContent.imageMessage || rawContent.audioMessage)) {
                    const mediaType = rawContent.videoMessage ? "video" : (rawContent.imageMessage ? "image" : "audio");
                    const targetMessage = rawContent[mediaType + "Message"];

                    const stream = await downloadContentFromMessage(targetMessage, mediaType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    let mediaOptions = {};
                    if (mediaType === "image") {
                        mediaOptions = { image: buffer, caption: targetMessage.caption || '' };
                    } else if (mediaType === "video") {
                        mediaOptions = { video: buffer, caption: targetMessage.caption || '' };
                    } else if (mediaType === "audio") {
                        mediaOptions = {
                            audio: buffer,
                            mimetype: targetMessage.mimetype,
                            ptt: targetMessage.ptt || false,
                            seconds: targetMessage.seconds
                        };
                    }

                    const preparedMedia = await prepareWAMessageMedia(
                        mediaOptions,
                        { upload: sock.waUploadToServer }
                    );

                    let mediaMessage = {};
                    if (mediaType === "image") mediaMessage = { imageMessage: preparedMedia.imageMessage };
                    else if (mediaType === "video") mediaMessage = { videoMessage: preparedMedia.videoMessage };
                    else if (mediaType === "audio") mediaMessage = { audioMessage: preparedMedia.audioMessage };

                    messagePayload = {
                        groupStatusMessageV2: { message: mediaMessage }
                    };
                } else {
                    const textToSend = args || quoted?.conversation || quoted?.extendedTextMessage?.text || '';
                    if (!textToSend) {
                        return await sock.sendMessage(jid, { text: "❌ Please reply to text or media to post on group status." }, { quoted: msg });
                    }

                    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
                    const bgColor = 0xff000000 + parseInt(randomHex, 16);

                    messagePayload = {
                        groupStatusMessageV2: {
                            message: {
                                extendedTextMessage: {
                                    text: textToSend,
                                    backgroundArgb: bgColor,
                                    font: 2
                                }
                            }
                        }
                    };
                }

                if (sendToStatus) {
                    await sock.sendMessage(jid, { text: `Uploading media to status list for JID: \`${targetJid}\`... 📡` }, { quoted: msg });
                }

                const statusMsg = generateWAMessageFromContent(
                    targetJid,
                    proto.Message.fromObject(messagePayload),
                    { userJid: sock.user.id }
                );

                await sock.relayMessage(
                    targetJid,
                    statusMsg.message,
                    { messageId: statusMsg.key.id }
                );

                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });

            } catch (error) {
                console.error("togcstatus error:", error.message);
                await sock.sendMessage(jid, { text: `❌ Failed to execute command: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 14. TOGCJID
    {
        name: 'togcjid',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'togcjid');
            if (!isAuthorized) return;

            const targetJid = args ? args.trim().split(' ')[0] : '';
            if (!targetJid || !targetJid.endsWith('@g.us')) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid target Group JID.\nUsage: reply to media/text and type `.togcjid 120363xxx@g.us`" }, { quoted: msg });
            }

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = quoted ? getRawMessage(quoted) : null;

            try {
                const {
                    downloadContentFromMessage,
                    prepareWAMessageMedia,
                    generateWAMessageFromContent,
                    proto
                } = await import('@itsliaaa/baileys');

                let messagePayload = {};

                if (rawContent && (rawContent.videoMessage || rawContent.imageMessage || rawContent.audioMessage)) {
                    const mediaType = rawContent.videoMessage ? "video" : (rawContent.imageMessage ? "image" : "audio");
                    const targetMessage = rawContent[mediaType + "Message"];

                    const stream = await downloadContentFromMessage(targetMessage, mediaType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    let mediaOptions = {};
                    if (mediaType === "image") {
                        mediaOptions = { image: buffer, caption: targetMessage.caption || '' };
                    } else if (mediaType === "video") {
                        mediaOptions = { video: buffer, caption: targetMessage.caption || '' };
                    } else if (mediaType === "audio") {
                        mediaOptions = {
                            audio: buffer,
                            mimetype: targetMessage.mimetype,
                            ptt: targetMessage.ptt || false,
                            seconds: targetMessage.seconds
                        };
                    }

                    const preparedMedia = await prepareWAMessageMedia(
                        mediaOptions,
                        { upload: sock.waUploadToServer }
                    );

                    let mediaMessage = {};
                    if (mediaType === "image") mediaMessage = { imageMessage: preparedMedia.imageMessage };
                    else if (mediaType === "video") mediaMessage = { videoMessage: preparedMedia.videoMessage };
                    else if (mediaType === "audio") mediaMessage = { audioMessage: preparedMedia.audioMessage };

                    messagePayload = {
                        groupStatusMessageV2: { message: mediaMessage }
                    };
                } else {
                    const remainingText = args.replace(targetJid, '').trim();
                    const textToSend = remainingText || quoted?.conversation || quoted?.extendedTextMessage?.text || '';
                    if (!textToSend) {
                        return await sock.sendMessage(jid, { text: "❌ Please reply to text or media to post on group status." }, { quoted: msg });
                    }

                    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
                    const bgColor = 0xff000000 + parseInt(randomHex, 16);

                    messagePayload = {
                        groupStatusMessageV2: {
                            message: {
                                extendedTextMessage: {
                                    text: textToSend,
                                    backgroundArgb: bgColor,
                                    font: 2
                                }
                            }
                        }
                    };
                }

                await sock.sendMessage(jid, { text: `Uploading media to status list for target JID: \`${targetJid}\`... 📡` }, { quoted: msg });

                const statusMsg = generateWAMessageFromContent(
                    targetJid,
                    proto.Message.fromObject(messagePayload),
                    { userJid: sock.user.id }
                );

                await sock.relayMessage(
                    targetJid,
                    statusMsg.message,
                    { messageId: statusMsg.key.id }
                );

                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });

            } catch (error) {
                console.error("togcjid error:", error.message);
                await sock.sendMessage(jid, { text: `❌ Failed to execute command: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 15. GETGPP
    {
        name: 'getgpp',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'getgpp');
            if (!isAuthorized) return;

            try {
                const profileUrl = await sock.profilePictureUrl(jid, 'image');
                await sock.sendMessage(jid, { image: { url: profileUrl }, caption: "🖼️ Current Group Profile Picture" }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: "❌ Failed to fetch Group Profile Picture." }, { quoted: msg });
            }
        }
    },

    // 16. SETPP
    {
        name: 'setpp',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'setpp');
            if (!isAuthorized) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted || !quoted.imageMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to an image." }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                await sock.updateProfilePicture(jid, buffer);
                await sock.sendMessage(jid, { text: "✅ Successfully updated Group Profile Picture!" }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: "❌ Failed to update profile picture." }, { quoted: msg });
            }
        }
    },

    // 17. POLL
    {
        name: 'poll',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'poll');
            if (!isAuthorized) return;

            const match = args ? args.match(/^(.+?)\s*\((.+?)\)$/) : null;
            if (!match) return await sock.sendMessage(jid, { text: "❌ Format: Question? (Option1/Option2)" }, { quoted: msg });

            const question = match[1].trim();
            const options = match[2].split('/').map(o => o.trim()).filter(o => o);

            if (options.length < 2) return await sock.sendMessage(jid, { text: "❌ Minimum 2 options required." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { poll: { name: question, values: options, selectableCount: 1 } }, { quoted: msg });
            } catch (e) {}
        }
    },

    // 18. HTAG
    {
        name: 'htag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'htag');
            if (!isAuthorized) return;

            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants.map(p => p.id);

            const quoted = msg.message.extendedTextMessage?.contextInfo;
            let quotedText = '';

            if (quoted && quoted.stanzaId) {
                const qMsg = quoted.quotedMessage;
                quotedText = qMsg?.conversation || qMsg?.extendedTextMessage?.text || qMsg?.imageMessage?.caption || qMsg?.videoMessage?.caption || '';
            }

            const messageText = args ? args : (quotedText ? quotedText : "🤞 *Summoned by Satoru Gojo.*");

            await sock.sendMessage(jid, {
                text: messageText,
                mentions: participants
            });

            try {
                await sock.sendMessage(jid, { delete: msg.key });
            } catch (err) {}
        }
    },

    // 19. SPAMTAG
    {
        name: 'spamtag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'spamtag');
            if (!isAuthorized) return;

            if (!args) {
                return await sock.sendMessage(jid, {
                    text: `❌ *Usage:* \`${config.prefix}spamtag <number> <text>\` or reply directly to a message with \`${config.prefix}spamtag <number>\``
                }, { quoted: msg });
            }

            const parts = args.trim().split(' ');
            const count = parseInt(parts[0]);
            if (isNaN(count) || count < 1) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid loop number." }, { quoted: msg });
            }

            const finalCount = Math.min(count, 30);

            let textToSend = parts.slice(1).join(' ').trim();
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!textToSend && quoted) {
                const rawContent = getRawMessage(quoted);
                textToSend = rawContent?.conversation || rawContent?.extendedTextMessage?.text || rawContent?.imageMessage?.caption || '';
            }

            if (!textToSend) textToSend = "🔔 *Attention Everyone!*";

            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants.map(p => p.id);

            for (let i = 0; i < finalCount; i++) {
                await sock.sendMessage(jid, { text: textToSend, mentions: participants });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'exit') {
        aliases.push({ ...cmd, name: 'leave' });
    }
    if (cmd.name === 'htag') {
        aliases.push({ ...cmd, name: 'ghost' });
    }
});
module.exports.push(...aliases);