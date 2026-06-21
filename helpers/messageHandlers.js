// helpers/messageHandlers.js
const config = require('../config');
const { DEV_LIDS, DEV_JIDS } = require('../devs');
const commands = require('../commands');
const { getPhoneJid, normalizeToJid, saveState } = require('../stateManager');
const { getRawMessage, handleViewOnce } = require('./log');
const fs = require('fs');
const path = require('path');

const notesPath = path.join(__dirname, '../storage/notes.json');

// ─── PERMISSION MATRIX ──────────────────────────────────────────
const ownerCommands = [
    'diagnose', 'update', 'mode', 'setsudo', 'delsudo',
    'restart', 'shutdown', 'ban', 'unban',
    'afk', 'setvar', 'settings',
    'antipm', 'reminder', 'remind', 'games_closeall', 'owner'
];

const primaryOnlyCommands = ['addowner', 'delowner'];
const devOnlyCommands = ['upgrade'];

// ─── NOTE HELPERS ───────────────────────────────────────────────

function readNotes() {
    try {
        if (fs.existsSync(notesPath)) return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
    } catch (e) { /* ignore */ }
    return {};
}

function saveNotes(notes) {
    try {
        const dir = path.dirname(notesPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

async function handleNoteSession(sock, msg) {
    try {
        const jid = msg.key.remoteJid;
        const rawContent = getRawMessage(msg.message);
        const text = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
        const quotedMsgId = rawContent?.contextInfo?.stanzaId;

        if (quotedMsgId && global.noteSessions && global.noteSessions[quotedMsgId]) {
            const session = global.noteSessions[quotedMsgId];
            const noteName = text.trim();
            if (!noteName) return false;

            const notes = readNotes();
            notes[jid] = notes[jid] || {};
            notes[jid][noteName.toLowerCase()] = {
                title: noteName,
                content: session.content,
                author: session.author,
                time: Date.now()
            };
            saveNotes(notes);
            delete global.noteSessions[quotedMsgId];
            await sock.sendMessage(jid, { text: `✅ Note successfully saved as *${noteName}*!` }, { quoted: msg });
            return true;
        }
    } catch (e) {
        console.error("Note session handler error:", e);
    }
    return false;
}

// ─── INTERACTIVE SESSIONS HANDLER ──────────────────────────────
async function handleInteractiveSessions(sock, msg) {
    const jid = msg.key.remoteJid;
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsgId = contextInfo?.stanzaId;

    if (!quotedMsgId) return false;

    const text = rawMsg?.conversation || rawMsg?.extendedTextMessage?.text || '';

    // ─── 1. AZA SESSION ───────────────────────────────────────────
    if (global.azaSessions && global.azaSessions[quotedMsgId]) {
        const session = global.azaSessions[quotedMsgId];
        if (session.step === 1) {
            const account = text.trim();
            if (!account || account.length < 5) {
                await sock.sendMessage(jid, { text: "❌ Account number must be at least 5 digits. Please try again." });
                return true;
            }
            session.account = account;
            session.step = 2;
            const prompt = await sock.sendMessage(jid, { text: "🏦 *Step 2:* Please reply with the *Bank Name*." });
            global.azaSessions[prompt.key.id] = session;
            delete global.azaSessions[quotedMsgId];
            return true;
        }
        if (session.step === 2) {
            const bank = text.trim();
            if (!bank) {
                await sock.sendMessage(jid, { text: "❌ Bank name cannot be empty. Please try again." });
                return true;
            }
            session.bank = bank;
            session.step = 3;
            const prompt = await sock.sendMessage(jid, { text: "🏦 *Step 3:* Please reply with the *Account Name*." });
            global.azaSessions[prompt.key.id] = session;
            delete global.azaSessions[quotedMsgId];
            return true;
        }
        if (session.step === 3) {
            const name = text.trim();
            if (!name) {
                await sock.sendMessage(jid, { text: "❌ Account name cannot be empty. Please try again." });
                return true;
            }
            config.aza = { set: true, account: session.account, bank: session.bank, name: name };
            const { saveState } = require('../stateManager');
            saveState();
            await sock.sendMessage(jid, {
                text: `✅ *Bank details saved successfully!*\n\n🏦 *Bank:* ${session.bank}\n💳 *Account:* ${session.account}\n👤 *Name:* ${name}`
            });
            delete global.azaSessions[quotedMsgId];
            return true;
        }
        delete global.azaSessions[quotedMsgId];
        return true;
    }

    // ─── 2. REMINDER SESSION ──────────────────────────────────────
    if (global.reminderSessions && global.reminderSessions[quotedMsgId]) {
        const session = global.reminderSessions[quotedMsgId];
        const title = text.trim();
        if (!title) {
            await sock.sendMessage(jid, { text: "❌ Reminder title cannot be empty." });
            return true;
        }
        const { readReminders, saveReminders } = require('../plugins/owner');
        const reminders = readReminders();
        reminders.push({
            jid: session.jid,
            title: title,
            text: session.text,
            triggerTime: Date.now() + session.durationMs,
            timeSet: session.timeSet,
            durationStr: session.durationStr
        });
        saveReminders(reminders);
        await sock.sendMessage(jid, { text: `✅ *Reminder Set!*\n\n📌 *Title:* ${title}\n⏳ *Duration:* ${session.durationStr}\n\nI'll remind you then.` });
        delete global.reminderSessions[quotedMsgId];
        return true;
    }

    // ─── 3. CANCEL SESSION ──────────────────────────────────────
    if (global.cancelSessions && global.cancelSessions[quotedMsgId]) {
        const num = parseInt(text.trim());
        if (isNaN(num)) {
            await sock.sendMessage(jid, { text: "❌ Please enter a valid number from the list." });
            return true;
        }
        const { readReminders, saveReminders } = require('../plugins/owner');
        const reminders = readReminders();
        if (num < 1 || num > reminders.length) {
            await sock.sendMessage(jid, { text: `❌ Invalid index. Please choose between 1 and ${reminders.length}.` });
            return true;
        }
        const removed = reminders.splice(num - 1, 1);
        saveReminders(reminders);
        await sock.sendMessage(jid, { text: `✅ *Reminder Cancelled:* "${removed[0].title}"` });
        delete global.cancelSessions[quotedMsgId];
        return true;
    }

    // ─── 4. FORWARD SESSION ──────────────────────────────────────
    if (global.forwardSessions && global.forwardSessions[quotedMsgId]) {
        const target = text.trim().replace(/[^0-9]/g, '');
        if (target.length < 7) {
            await sock.sendMessage(jid, { text: "❌ Please enter a valid phone number (at least 7 digits)." });
            return true;
        }
        const targetJid = `${target}@s.whatsapp.net`;
        const session = global.forwardSessions[quotedMsgId];
        try {
            await sock.sendMessage(targetJid, { forward: session.msgToForward });
            await sock.sendMessage(jid, { text: `✅ Message forwarded to ${targetJid}` });
            delete global.forwardSessions[quotedMsgId];
        } catch (e) {
            await sock.sendMessage(jid, { text: `❌ Forward failed: ${e.message}` });
        }
        return true;
    }

    return false;
}

// ─── DOWNLOADER INTERACTIVE SESSIONS ────────────────────────────
async function handleDownloaderSessions(sock, msg) {
    const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
    if (!senderJid) return false;

    const rawMsg = getRawMessage(msg.message);
    const text = rawMsg?.conversation || rawMsg?.extendedTextMessage?.text || '';

    if (global.downloaderSessions && global.downloaderSessions[senderJid]) {
        const session = global.downloaderSessions[senderJid];
        const num = parseInt(text.trim());
        if (!isNaN(num) && num >= 1 && num <= session.results.length) {
            const index = num - 1;
            const item = session.results[index];

            clearTimeout(session.timeout);
            delete global.downloaderSessions[senderJid];

            const jid = msg.key.remoteJid;

            try {
                const axios = require('axios');
                async function downloadBuffer(url) {
                    const res = await axios({ url, method: 'GET', responseType: 'arraybuffer' });
                    return Buffer.from(res.data);
                }
                if (session.type === 'song') {
                    const buffer = await downloadBuffer(item.download || item.url);
                    await sock.sendMessage(jid, {
                        audio: buffer,
                        mimetype: 'audio/mp4',
                        ptt: false,
                        caption: item.title || 'Song'
                    });
                } else if (session.type === 'apk') {
                    const buffer = await downloadBuffer(item.download || item.url);
                    await sock.sendMessage(jid, {
                        document: buffer,
                        fileName: (item.name || 'app') + '.apk',
                        mimetype: 'application/vnd.android.package-archive'
                    });
                }
                return true;
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Download failed: ${e.message}` });
                return true;
            }
        }
    }
    return false;
}

// ─── AFK DEACTIVATION ──────────────────────────────────────────
async function handleAfkDeactivation(sock, msg) {
    const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
    if (!senderJid) return false;

    if (config.afk && config.afk[senderJid]) {
        delete config.afk[senderJid];
        saveState();
        await sock.sendMessage(msg.key.remoteJid, {
            text: `👋 *Welcome back!* Your AFK mode has been deactivated.`
        }, { quoted: msg });
        return true;
    }
    return false;
}

// ─── SECURITY POLICY HELPER ────────────────────────────────────
async function applySecurityPolicy(sock, msg, policy, senderJid, senderNumber, jid, violationReason) {
    if (!policy || policy === 'off') return;

    if (policy === 'delete') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.sendMessage(jid, {
                text: `❌ *Message Deleted:* @${senderNumber} violated ${violationReason} rules.`,
                mentions: [senderJid]
            });
        } catch (e) { /* ignore */ }
    } else if (policy === 'warn') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            const warnKey = `${jid}_${senderNumber}`;
            config.warns[warnKey] = (config.warns[warnKey] || 0) + 1;
            const count = config.warns[warnKey];
            const threshold = config.warnThreshold || 5;

            if (count >= threshold) {
                await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                await sock.sendMessage(jid, {
                    text: `👋 @${senderNumber} kicked. Warnings exceeded (${count}/${threshold}) for violating ${violationReason} rules.`,
                    mentions: [senderJid]
                });
                config.warns[warnKey] = 0;
            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ @${senderNumber} ${violationReason} is not allowed here! (${count}/${threshold})`,
                    mentions: [senderJid]
                });
            }
            saveState();
        } catch (e) { /* ignore */ }
    } else if (policy === 'kick') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
            await sock.sendMessage(jid, {
                text: `👋 Exorcised @${senderNumber} for violating ${violationReason} rules.`,
                mentions: [senderJid]
            });
        } catch (e) { /* ignore */ }
    }
}

// ─── LID-SAFE SILENCE CHECK ─────────────────────────────────────
function isUserSilenced(silencedUsers, jid, senderJid) {
    if (!silencedUsers || !silencedUsers[jid]) return null;

    const silencedEntries = silencedUsers[jid];
    const senderNum = senderJid.split('@')[0];

    for (const [key, data] of Object.entries(silencedEntries)) {
        const keyNum = key.split('@')[0];
        if (keyNum === senderNum) {
            return data;
        }
    }
    return null;
}

// ─── MAIN MESSAGE HANDLER ──────────────────────────────────────
async function handleIncomingMessage(sock, chatUpdate, botSentMessageIds) {
    try {
        if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
        const msg = chatUpdate.messages[0];
        if (!msg || !msg.message) return;

        const jid = msg.key.remoteJid;
        const rawSender = msg.key.participant || msg.key.remoteJid || '';
        const senderJid = normalizeToJid(rawSender);
        const senderNumber = senderJid.split('@')[0];
        const isGroup = jid.endsWith('@g.us');

        // ─── HOOKS ──────────────────────────────────────────────
        const isNoteSaved = await handleNoteSession(sock, msg);
        if (isNoteSaved) return;

        await handleViewOnce(sock, msg);

        const handled = await handleInteractiveSessions(sock, msg);
        if (handled) return;

        const dlHandled = await handleDownloaderSessions(sock, msg);
        if (dlHandled) return;

        // ─── QUIZ CATEGORY SELECTION ────────────────────────────
        const senderJidCat = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
        const quizSingleKey = jid + '_' + senderJidCat;
        const quizMultiKey = jid;
        let activeQuizKey = '';

        if (global.triviaSessions && global.triviaSessions[quizSingleKey] && global.triviaSessions[quizSingleKey].status === 'awaiting_category') {
            activeQuizKey = quizSingleKey;
        } else if (global.triviaSessions && global.triviaSessions[quizMultiKey] && global.triviaSessions[quizMultiKey].status === 'awaiting_category') {
            activeQuizKey = quizMultiKey;
        }

        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        const trimmedMessage = (rawMsg?.conversation || rawMsg?.extendedTextMessage?.text || '').trim();

        if (quotedMsgId && activeQuizKey && global.triviaSessions && global.triviaSessions[activeQuizKey]) {
            const session = global.triviaSessions[activeQuizKey];
            if (session.status === 'awaiting_category' && session.lastQuestionMsgId === quotedMsgId) {
                await commands['quiz_cat'](sock, msg, trimmedMessage, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                return;
            }
        }

        // ─── QUIZ ANSWER INTERCEPTOR (NEW) ──────────────────────
        const singleKey = jid + '_' + senderJid;
        const multiKey = jid;
        let activeQuizAnswerKey = '';

        if (global.triviaSessions && global.triviaSessions[singleKey] && global.triviaSessions[singleKey].status === 'playing') {
            activeQuizAnswerKey = singleKey;
        } else if (global.triviaSessions && global.triviaSessions[multiKey] && global.triviaSessions[multiKey].status === 'playing') {
            activeQuizAnswerKey = multiKey;
        }

        if (quotedMsgId && activeQuizAnswerKey && global.triviaSessions && global.triviaSessions[activeQuizAnswerKey]) {
            const session = global.triviaSessions[activeQuizAnswerKey];
            if (session.status === 'playing' && session.lastQuestionMsgId === quotedMsgId) {
                const ans = trimmedMessage.toLowerCase().trim();
                if (['a', 'b', 'c', 'd'].includes(ans)) {
                    await commands[`${config.prefix}quiz_ans`](sock, msg, ans, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                    return;
                }
            }
        }

        await handleAfkDeactivation(sock, msg);

        // ─── PERMISSIONS ──────────────────────────────────────────
        let command;
        let args;

        const botJid = config.botJid || (sock.user?.id ? normalizeToJid(sock.user.id) : '');
        const botLid = config.botLid || (sock.user?.id?.includes('@lid') ? normalizeToJid(sock.user.id) : '');

        global.activeSock = sock;

        let isDev = DEV_LIDS.includes(senderJid) || DEV_JIDS.includes(senderJid);
        let isPrimaryOwner = senderJid === config.ownerJid ||
                             (config.ownerLid && senderJid === config.ownerLid);
        let isSecondaryOwner = Array.isArray(config.secondaryOwners) &&
                               config.secondaryOwners.includes(senderJid);
        let isOwner = isDev || isPrimaryOwner || isSecondaryOwner || msg.key.fromMe;
        let isSudo = (Array.isArray(config.sudos) && config.sudos.includes(senderJid)) ||
                     (Array.isArray(config.sudoLids) && config.sudoLids.includes(senderJid));

        let senderPhoneJid = '';
        if (senderJid.endsWith('@lid')) {
            if (global.lidCache?.[senderJid]) {
                senderPhoneJid = global.lidCache[senderJid];
            }
            if (!isOwner && !isSudo && !senderPhoneJid) {
                senderPhoneJid = await getPhoneJid(sock, senderJid, jid);
            }
            if (senderPhoneJid) {
                if (DEV_LIDS.includes(senderJid) || DEV_JIDS.includes(senderJid)) isDev = true;
                if (senderPhoneJid === config.ownerJid) isPrimaryOwner = true;
                if (Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(senderPhoneJid)) isSecondaryOwner = true;
                if (Array.isArray(config.sudos) && config.sudos.includes(senderPhoneJid)) isSudo = true;
                isOwner = isDev || isPrimaryOwner || isSecondaryOwner || msg.key.fromMe;
            }
        }

        const isAuthorized = isOwner || isSudo;

        const isBanned = (Array.isArray(config.banned) && config.banned.includes(senderJid)) ||
                         (senderPhoneJid && Array.isArray(config.banned) && config.banned.includes(senderPhoneJid));
        if (isBanned) return;
        if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) return;

        // ─── EXTRACT BODY ────────────────────────────────────────
        let body = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   msg.message.videoMessage?.caption ||
                   msg.message.buttonsResponseMessage?.selectedButtonId ||
                   msg.message.templateButtonReplyMessage?.selectedId ||
                   '';

        if (msg.message.stickerMessage) {
            const fileHash = msg.message.stickerMessage.fileSha256?.toString('base64');
            if (fileHash && config.stickerCommands && config.stickerCommands[fileHash]) {
                let mapped = config.stickerCommands[fileHash];
                if (!mapped.startsWith(config.prefix) && !['speed', 'kamui', 'gojo'].includes(mapped.toLowerCase())) {
                    mapped = config.prefix + mapped;
                }
                body = mapped;
            }
        }

        const trimmedMessageBody = body.trim();
        const lowerMessage = trimmedMessageBody.toLowerCase();

        global.messageStore[msg.key.id] = msg;
        const storeKeys = Object.keys(global.messageStore);
        if (storeKeys.length > 1000) delete global.messageStore[storeKeys[0]];

        const mentionedJids = contextInfo?.mentionedJid || [];

        // ─── LID-SAFE SILENCE CHECK ──────────────────────────────
        if (isGroup) {
            const silenceData = isUserSilenced(global.silencedUsers, jid, senderJid);
            if (silenceData && Date.now() < silenceData.endTime) {
                let shouldMute = false;
                if (silenceData.type === 'all' && !isDev) {
                    shouldMute = true;
                } else if (silenceData.type === 'sticker' && msg.message.stickerMessage && !isDev) {
                    shouldMute = true;
                } else if (silenceData.type === 'message' && !isDev) {
                    const hasMedia = msg.message.imageMessage || msg.message.videoMessage || msg.message.audioMessage || msg.message.documentMessage;
                    if (trimmedMessageBody || hasMedia) shouldMute = true;
                }

                if (shouldMute) {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                    } catch (e) { /* ignore */ }
                    return;
                }
            }
        }

        // ─── DEV MENTION REACTION ────────────────────────────────
        const devLidsSet = new Set(DEV_LIDS);
        const devJidsSet = new Set(DEV_JIDS);
        const devNums = new Set();

        for (const dev of devLidsSet) {
            devNums.add(dev.split('@')[0]);
        }
        for (const dev of devJidsSet) {
            devNums.add(dev.split('@')[0]);
        }

        let isDevMentioned = false;

        for (const mention of mentionedJids) {
            const normalized = normalizeToJid(mention);
            const num = normalized.split('@')[0];
            if (devNums.has(num)) {
                isDevMentioned = true;
                break;
            }
        }

        if (!isDevMentioned) {
            const mentionMatches = trimmedMessageBody.match(/@([0-9]+)/g) || [];
            for (const match of mentionMatches) {
                const num = match.replace('@', '');
                if (devNums.has(num)) {
                    isDevMentioned = true;
                    break;
                }
            }
        }

        if (isDevMentioned && !msg.key.fromMe) {
            (async () => {
                const reactionSequence = ["⚽", "🔥", "🪽", "❄", "🥷🏼"];
                for (const emoji of reactionSequence) {
                    try {
                        await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                    } catch (reactErr) {
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            })().catch(err => console.error("❌ [REACTION] Dev mention animation failed:", err.message));
        }

        // ─── CHAT LOG RECORDING INTERCEPTOR (.gclog) ──────────────
        if (isGroup && config.gclogActive?.[jid]) {
            if (!config.conversationLogs) config.conversationLogs = {};
            if (!config.conversationLogs[jid]) config.conversationLogs[jid] = [];

            if (trimmedMessageBody && !trimmedMessageBody.startsWith(config.prefix)) {
                const senderName = msg.pushName || senderNumber || 'Unknown';
                config.conversationLogs[jid].push({
                    sender: senderName,
                    text: trimmedMessageBody,
                    time: Date.now()
                });

                if (config.conversationLogs[jid].length > 1000) {
                    config.conversationLogs[jid].shift();
                }

                saveState();
            }

            if (!global.gclogIntervals) global.gclogIntervals = {};
            if (!global.gclogIntervals[jid]) {
                global.gclogIntervals[jid] = setInterval(async () => {
                    const logs = config.conversationLogs?.[jid] || [];
                    if (logs.length === 0) return;

                    const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');
                    const prompt = "Summarize this group conversation logs. You must output exactly 10 bullet points. Keep it concise and neutral. Do not include any intro, outro, or conversational filler.";

                    try {
                        const { GoogleGenAI } = await import('@google/genai');
                        const apiKey = config.geminiApiKey;
                        if (!apiKey) throw new Error("GEMINI_API_KEY not set");

                        const ai = new GoogleGenAI({ apiKey });
                        const response = await ai.models.generateContent({
                            model: "gemini-3.5-flash",
                            contents: `${prompt}\n\nHere are the chat logs:\n${logString}`
                        });
                        const responseText = response.text || "Could not generate summary.";

                        await sock.sendMessage(jid, { text: `📊 *LIMITLESS CONVERSATION SUMMARY (Last 3 Hours):*\n\n${responseText.trim()}` });
                    } catch (err) {
                        console.error("GCLOG summary error:", err.message);
                    }

                    if (config.conversationLogs) config.conversationLogs[jid] = [];
                    saveState();
                }, 3 * 60 * 60 * 1000);
            }
        }

        // ─── STATUS BROADCAST ────────────────────────────────────
        if (jid === 'status@broadcast') {
            if (config.autoviewstatus === 'on') {
                try { await sock.readMessages([msg.key]); } catch (e) { /* ignore */ }
            }
            if (config.autoreactstatus === 'on') {
                try {
                    const emoji = config.statusemoji || '❄';
                    await sock.sendMessage('status@broadcast', { react: { text: emoji, key: msg.key } });
                } catch (e) { /* ignore */ }
            }
            return;
        }

        // ─── GROUP SECURITY INTERCEPTORS ─────────────────────────
        if (isGroup && !isAuthorized && !isDev && !msg.key.fromMe) {
            const antilinkPolicy = config.antilink?.[jid] || 'off';
            const hasLink = /(https?:\/\/)?(www\.)?(chat\.whatsapp\.com\/[a-zA-Z0-9]+|wa\.me\/[0-9]+)/i.test(body) || /https?:\/\/[^\s]+/i.test(body);
            if (hasLink && antilinkPolicy !== 'off') {
                await applySecurityPolicy(sock, msg, antilinkPolicy, senderJid, senderNumber, jid, "Antilink");
                return;
            }

            const antibotPolicy = config.antibot?.[jid] || 'off';
            const isBotSender = msg.key.id.startsWith('BAE5') || msg.key.id.startsWith('3EB0') || msg.key.id.length === 12;
            if (isBotSender && antibotPolicy !== 'off') {
                await applySecurityPolicy(sock, msg, antibotPolicy, senderJid, senderNumber, jid, "Antibot");
                return;
            }

            const antitagPolicy = config.antitag?.[jid] || 'off';
            const isTaggingLarge = mentionedJids.length >= 5;
            const isTaggingEveryone = body.includes('@everyone') || body.includes('@here') || isTaggingLarge;
            if (isTaggingEveryone && antitagPolicy === 'on') {
                await applySecurityPolicy(sock, msg, 'delete', senderJid, senderNumber, jid, "Antitag");
                return;
            }

            const antigmPolicy = config.antigm?.[jid] || 'off';
            const isGroupMention = mentionedJids.includes(jid);
            if (isGroupMention && antigmPolicy !== 'off') {
                await applySecurityPolicy(sock, msg, antigmPolicy, senderJid, senderNumber, jid, "Anti-Group-Mention");
                return;
            }
        }

        // ─── GROUP STATUS PROTECTION ─────────────────────────────
        const isGroupStatus = msg.message?.groupStatusMessageV2 || msg.mtype === "groupStatusMessageV2";
        if (isGroup && isGroupStatus && !msg.key.fromMe && !isAuthorized && !isDev) {
            const policy = config.antigcstatus || 'off';
            if (policy !== 'off') {
                if (policy === 'delete') {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                        await sock.sendMessage(jid, {
                            text: `❌ *Warning @${senderNumber}:* Group status updates are restricted in this domain.`,
                            mentions: [senderJid]
                        });
                    } catch (e) { /* ignore */ }
                } else if (policy === 'warn') {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                        const warnKey = `${jid}_${senderNumber}`;
                        config.warns[warnKey] = (config.warns[warnKey] || 0) + 1;
                        const count = config.warns[warnKey];
                        const threshold = config.warnThreshold || 5;

                        if (count >= threshold) {
                            await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                            await sock.sendMessage(jid, {
                                text: `👋 @${senderNumber} kicked. Warnings exceeded for posting status updates.`,
                                mentions: [senderJid]
                            });
                            config.warns[warnKey] = 0;
                        } else {
                            await sock.sendMessage(jid, {
                                text: `⚠️ @${senderNumber} Status updates are not allowed here! (${count}/${threshold})`,
                                mentions: [senderJid]
                            });
                        }
                        saveState();
                    } catch (e) { /* ignore */ }
                } else if (policy === 'kick') {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                        await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                        await sock.sendMessage(jid, {
                            text: `👋 Exorcised @${senderNumber} for posting status updates.`,
                            mentions: [senderJid]
                        });
                    } catch (e) { /* ignore */ }
                }
                return;
            }
        }

        // ─── ANTIBUG RATE-LIMIT ──────────────────────────────────
        if (config.antibug === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
            const now = Date.now();
            if (!global.spamTracker[senderJid]) global.spamTracker[senderJid] = [];
            global.spamTracker[senderJid].push(now);
            global.spamTracker[senderJid] = global.spamTracker[senderJid].filter(t => now - t <= 3000);

            if (global.spamTracker[senderJid].length >= 5) {
                try {
                    await sock.sendMessage(jid, {
                        text: `can't bypass my infinity? @${senderNumber}`,
                        mentions: [senderJid]
                    }, { quoted: msg });
                    await sock.updateBlockStatus(senderJid, 'block');
                    await sock.chatModify({ delete: true, lastMessages: [msg] }, jid);
                    delete global.spamTracker[senderJid];
                } catch (blockErr) { /* ignore */ }
                return;
            }
        }

        // ─── ANTISPAM RATE-LIMIT ──────────────────────────────────
        const antispamConfig = config.antispam?.[jid];
        if (isGroup && antispamConfig && antispamConfig.status === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
            const rate = antispamConfig.rate || { count: 1, seconds: 2 };
            const now = Date.now();
            global.spamTracker[senderJid] = global.spamTracker[senderJid] || [];
            global.spamTracker[senderJid].push(now);
            global.spamTracker[senderJid] = global.spamTracker[senderJid].filter(t => now - t <= (rate.seconds * 1000));

            if (global.spamTracker[senderJid].length > rate.count) {
                try {
                    await sock.sendMessage(jid, { delete: msg.key });
                    const spamDeleteKey = `${jid}_${senderNumber}`;
                    global.spamDeletedCount[spamDeleteKey] = (global.spamDeletedCount[spamDeleteKey] || 0) + 1;

                    if (global.spamDeletedCount[spamDeleteKey] >= 10) {
                        global.spamDeletedCount[spamDeleteKey] = 0;
                        const alertText = `🚨 *SPAM ATTACK DETECTED* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n@${senderNumber} rate-limit violated!`;
                        const buttonMessage = {
                            text: alertText,
                            buttons: [{
                                buttonId: `${config.prefix}kick @${senderNumber}`,
                                buttonText: { displayText: 'Kick Spammer 🥷' },
                                type: 1
                            }],
                            headerType: 1,
                            mentions: [senderJid]
                        };
                        try { await sock.sendMessage(jid, buttonMessage); } catch (e) {
                            await sock.sendMessage(jid, { text: alertText }, { mentions: [senderJid] });
                        }
                    }
                } catch (e) { /* ignore */ }
                return;
            }
        }

        // ─── ANTIGAY INTERCEPTOR ────────────────────────────────
        const gayCommands = ['gay', 'gaylist', 'gaycheck', 'antigay'];
        const cleanCmd = trimmedMessageBody.replace(config.prefix || '⚡', '').trim().split(' ')[0]?.toLowerCase() || '';
        const isGayCommand = gayCommands.includes(cleanCmd);

        if (!isGayCommand && config.antigay?.[jid] === 'on' && config.gayList && config.gayList.length > 0) {
            const senderNum = senderJid.split('@')[0];
            const isGay = config.gayList.some(entry => entry.lid.split('@')[0] === senderNum);

            if (isGay) {
                const rudeMessages = [
                    "Shut up, you gay fool. Don't tag my master.",
                    "Back off, rainbow boy. You're not worthy.",
                    "My Infinity rejects your gay energy. Stay away.",
                    "You really think you can talk to my master? Gay. 💀",
                    "Don't you have a boyfriend to annoy? Leave me alone.",
                    "Master is busy. Go find your gay club.",
                    "I'd say you're weak, but you're just... gay.",
                    "You're not even worth my Six Eyes. Get lost.",
                    "Master doesn't associate with gay peasants like you.",
                    "Another gay trying to get attention. Blocked."
                ];

                const randomMsg = rudeMessages[Math.floor(Math.random() * rudeMessages.length)];
                await sock.sendMessage(jid, { text: randomMsg, mentions: [senderJid] });
                return; // Stop processing this message
            }
        }

        // ─── AGENT DETECTION ──────────────────────────────────────
        const quotedParticipant = contextInfo?.participant;
        const isReplyingToBot = quotedParticipant === botJid || (botLid && quotedParticipant === botLid) || (!isGroup && !msg.key.fromMe && quotedMsgId);
        const isMentioningBot = mentionedJids.includes(botJid) || (botLid && mentionedJids.includes(botLid));

        const isGojoCalled = /\bgojo\b/i.test(lowerMessage);
        const isLizzyCalled = /\blizzy\b/i.test(lowerMessage);
        const isJarvisCalled = /\bjarvis\b|\bchatbot\b/i.test(lowerMessage);
        const isFridayCalled = /\bfriday\b/i.test(lowerMessage);

        let identifiedAgent = null;

        if (isReplyingToBot && quotedMsgId && global.botMessageAgents[quotedMsgId]) {
            identifiedAgent = global.botMessageAgents[quotedMsgId];
        } else if (isMentioningBot || isReplyingToBot) {
            if (isFridayCalled) identifiedAgent = 'friday';
            else if (isGojoCalled) identifiedAgent = 'gojo';
            else if (isLizzyCalled) identifiedAgent = 'lizzy';
            else if (isJarvisCalled) identifiedAgent = 'jarvis';
            else {
                if (Array.isArray(config.lizzyChats) && config.lizzyChats.includes(jid)) identifiedAgent = 'lizzy';
                else if (Array.isArray(config.chatbotChats) && config.chatbotChats.includes(jid)) identifiedAgent = 'jarvis';
                else identifiedAgent = 'gojo';
            }
        } else {
            if (isFridayCalled) identifiedAgent = 'friday';
            else if (isGojoCalled) identifiedAgent = 'gojo';
            else if (isLizzyCalled) identifiedAgent = 'lizzy';
            else if (isJarvisCalled) identifiedAgent = 'jarvis';
        }

        if (identifiedAgent === 'gojo') {
            const isAsleep = config.gojoGlobalSleep;
            if (isAsleep && !trimmedMessageBody.startsWith(config.prefix)) identifiedAgent = null;
        }

        if (identifiedAgent && !trimmedMessageBody.startsWith(config.prefix)) {
            if (identifiedAgent === 'gojo') {
                command = 'gojo';
                args = trimmedMessageBody;
            } else if (identifiedAgent === 'lizzy') {
                command = 'lizzy_chat';
                args = trimmedMessageBody;
            } else if (identifiedAgent === 'jarvis') {
                command = 'chatbot_chat';
                args = trimmedMessageBody;
            } else if (identifiedAgent === 'friday') {
                command = 'friday_chat';
                args = trimmedMessageBody;
            }
        }

        // ─── COMMAND EXTRACTION ──────────────────────────────────
        if (!command) {
            if (trimmedMessageBody.startsWith(config.prefix)) {
                const spaceIndex = trimmedMessageBody.indexOf(' ');
                if (spaceIndex === -1) {
                    command = trimmedMessageBody.slice(config.prefix.length).toLowerCase();
                    args = '';
                } else {
                    command = trimmedMessageBody.slice(config.prefix.length, spaceIndex).toLowerCase();
                    args = trimmedMessageBody.slice(spaceIndex + 1);
                }
            } else if (commands[trimmedMessageBody.toLowerCase()]) {
                command = trimmedMessageBody.toLowerCase();
                args = '';
            }
        }

        if (!command) return;

        // ─── AGENT CONTEXT ─────────────────────────────────────────
        if (command === 'gojo') global.activeAgentContext = 'gojo';
        else if (command === 'lizzy_chat') global.activeAgentContext = 'lizzy';
        else if (command === 'chatbot_chat') global.activeAgentContext = 'jarvis';
        else if (command === 'friday_chat') global.activeAgentContext = 'friday';
        else global.activeAgentContext = null;

        const isPublicMode = config.isPublic ?? false;
        const cleanCommand = command.startsWith(config.prefix) ? command.slice(config.prefix.length) : command;

        // ─── PERMISSION CHECKS ─────────────────────────────────────
        const isOwnerCmd = ownerCommands.includes(cleanCommand);
        const isDevOnlyCmd = devOnlyCommands.includes(cleanCommand);

        if (isOwnerCmd && isSudo && !isOwner && !isDev) {
            return;
        }

        if (isDevOnlyCmd && !isDev) {
            return;
        }

        const interactiveResponses = [
            'prop_ans', 'ask_ans', 'wed_ans', 'v8_btn', 'purple_ans',
            'quiz_join', 'ttt_join', 'pvp_join', 'anagram_join', 'wcg_join',
            'pvp_lobby_accept', 'pvp_choose', 'pvp_fight', 'pvp_defend',
            'menu_ai', 'menu_games', 'menu_group', 'menu_tools', 'menu_download',
            'menu_fun', 'menu_owner', 'menu_utilities', 'silence_ans'
        ];

        if (!isPublicMode && !isAuthorized && !isDev && !interactiveResponses.includes(command)) {
            return;
        }

        // ─── COMMAND EXECUTION ─────────────────────────────────────
        console.log(`⚙️ [PARSER] Triggering command: "${command}"`);

        const cmdKey = command.startsWith(config.prefix) ? command : `${config.prefix}${command}`;

        if (commands[cmdKey]) {
            if (config.autoReact === 'cmd' && !msg.key.fromMe) {
                try { await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } }); } catch (err) { /* ignore */ }
            }
            await commands[cmdKey](sock, msg, args, { isOwner, isSudo, isDev, isPrimaryOwner, senderNumber });
        } else if (commands[command]) {
            if (config.autoReact === 'cmd' && !msg.key.fromMe) {
                try { await sock.sendMessage(jid, { react: { text: "🔥", key: msg.key } }); } catch (err) { /* ignore */ }
            }
            await commands[command](sock, msg, args, { isOwner, isSudo, isDev, isPrimaryOwner, senderNumber });
        }
    } catch (err) {
        console.error('Error handling message stream:', err);
    }
}

module.exports = { handleIncomingMessage };