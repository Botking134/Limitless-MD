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

    // 1. AZA SESSION
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

    // 2. REMINDER SESSION
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

    // 3. CANCEL SESSION
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

    // 4. FORWARD SESSION
    if (global.forwardSessions && global.forwardSessions[quotedMsgId]) {
        const target = text.trim().replace(/[^0-9]/g, '');
        if (target.length < 7) {
            await sock.sendMessage(jid, { text: "❌ Please enter a valid phone number (at least 7 digits)." });
            return true;
        }
        const targetJid = `${target}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: `✅ Forwarding to ${targetJid}...` });
        delete global.forwardSessions[quotedMsgId];
        return true;
    }

    return false;
}

// ─── DOWNLOADER INTERACTIVE SESSIONS ──────────────────────────
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
                        fileName: item.name + '.apk',
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

// ─── AFK MENTION HANDLER ──────────────────────────────────────
// (unchanged – kept as is)

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

// ─── AUTO-REACT EMOJI CYCLE ────────────────────────────────────
const REACT_EMOJIS = ['🔥', '⚡', '❄', '⚽', '⛩️', '🥷'];
let reactIndex = 0;

// ─── SPAM TRACKER (for antibug) ──────────────────────────────
function isSpamming(senderJid, chatJid) {
    const key = `${senderJid}_${chatJid}`;
    if (!global.spamTracker) global.spamTracker = {};
    if (!global.spamTracker[key]) global.spamTracker[key] = [];

    const now = Date.now();
    // Keep only timestamps within the last 1 second
    const timestamps = global.spamTracker[key].filter(t => now - t < 1000);
    timestamps.push(now);
    global.spamTracker[key] = timestamps;

    // If 2 or more messages in the last 1 second => spam
    return timestamps.length >= 2;
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
        // 1. Note session
        const isNoteSaved = await handleNoteSession(sock, msg);
        if (isNoteSaved) return;

        // 2. ViewOnce
        await handleViewOnce(sock, msg);

        // 3. Interactive sessions
        const handled = await handleInteractiveSessions(sock, msg);
        if (handled) return;

        // 4. Downloader interactive sessions
        const dlHandled = await handleDownloaderSessions(sock, msg);
        if (dlHandled) return;

        // 5. AFK deactivation
        await handleAfkDeactivation(sock, msg);

        // ─── PERMISSIONS & COMMAND PARSING ──────────────────
        let command;
        let args;

        // ─── FIX: Dynamic JID & LID fallback resolution ────
        const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
        const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : (config.botLid || '');

        global.activeSock = sock;

        // ─── DEV DETECTION ─────────────────────────────────────
        let isDev = DEV_LIDS.includes(senderJid) || DEV_JIDS.includes(senderJid);
        let isPrimaryOwner = senderJid === config.ownerJid ||
                             (config.ownerLid && senderJid === config.ownerLid) ||
                             (Array.isArray(config.ownerLids) && config.ownerLids.includes(senderJid));
        let isSecondaryOwner = Array.isArray(config.secondaryOwners) &&
                               config.secondaryOwners.includes(senderJid);
        let isOwner = isDev || isPrimaryOwner || isSecondaryOwner || msg.key.fromMe;
        let isSudo = (Array.isArray(config.sudos) && config.sudos.includes(senderJid)) ||
                     (Array.isArray(config.sudoLids) && config.sudoLids.includes(senderJid));

        // ─── LID → PHONE JID RESOLUTION (for permissions) ──
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

        // ─── BAN CHECK ────────────────────────────────────────────
        const isBanned = (Array.isArray(config.banned) && config.banned.includes(senderJid)) ||
                         (senderPhoneJid && Array.isArray(config.banned) && config.banned.includes(senderPhoneJid));
        if (isBanned) return;
        if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) return;

        // ─── MESSAGE COUNTERS (active/inactive/msgs) ──────────
        if (!config.dailyActivity) config.dailyActivity = {};
        if (!config.totalMessages) config.totalMessages = {};

        const dailyKey = `${jid}_${senderJid}`;
        const totalKey = `${jid}_${senderJid}`;

        // Daily activity
        const today = new Date().toDateString();
        if (!config.dailyActivity[dailyKey] || config.dailyActivity[dailyKey].date !== today) {
            config.dailyActivity[dailyKey] = { date: today, count: 0 };
        }
        config.dailyActivity[dailyKey].count++;

        // Total messages
        config.totalMessages[totalKey] = (config.totalMessages[totalKey] || 0) + 1;

        // Debounce save to avoid frequent writes
        if (!global.saveTimer) {
            global.saveTimer = setTimeout(() => {
                saveState();
                global.saveTimer = null;
            }, 5000);
        }

        // ─── ANTIPM — Block non‑authorized DMs ──────────────────
        if (!isGroup && config.antipm === 'on' && !isAuthorized) {
            try {
                await sock.updateBlockStatus(senderJid, 'block');
                console.log(`🚫 [ANTIPM] Blocked ${senderJid} for DMing the bot.`);
            } catch (e) { /* ignore */ }
            return; // stop processing
        }

        // ─── ANTIBUG (antispam) — Block spammers ──────────────────
        if (config.antibug === 'on' && !isAuthorized) {
            if (isSpamming(senderJid, jid)) {
                try {
                    await sock.updateBlockStatus(senderJid, 'block');
                    console.log(`🐛 [ANTIBUG] Blocked ${senderJid} for spamming (2+ msgs/sec).`);
                } catch (e) { /* ignore */ }
                return; // stop processing
            }
        }

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

        const trimmedMessage = body.trim();
        const lowerMessage = trimmedMessage.toLowerCase();

        global.messageStore[msg.key.id] = msg;
        const storeKeys = Object.keys(global.messageStore);
        if (storeKeys.length > 1000) delete global.messageStore[storeKeys[0]];

        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        const mentionedJids = contextInfo?.mentionedJid || [];

        // ─── HANDLE BUTTON RESPONSES (Deactivate All) ──────────
        const buttonResponse = msg.message?.buttonsResponseMessage;
        if (buttonResponse) {
            const selectedId = buttonResponse.selectedButtonId;
            if (!isOwner && !isSudo && !isDev) {
                await sock.sendMessage(jid, { text: '❌ Only owners/sudos/devs can deactivate chatbots.' });
                return;
            }
            if (selectedId === 'deactivate_all') {
                config.lizzyChats = (config.lizzyChats || []).filter(c => c !== jid);
                config.chatbotChats = (config.chatbotChats || []).filter(c => c !== jid);
                config.fridayChats = (config.fridayChats || []).filter(c => c !== jid);
                saveState();
                await sock.sendMessage(jid, { text: '🔴 *All chatbots deactivated in this chat.*' });
                return;
            }
        }

        // ─── GROUP SECURITY INTERCEPTORS (placeholder) ─────────
        // You can add your existing group protection logic here.

        // ─── AGENT DETECTION ────────────────────────────────────
        const quotedParticipant = contextInfo?.participant ? normalizeToJid(contextInfo.participant) : '';
        const isReplyingToBot = quotedParticipant && (quotedParticipant === botJid || (botLid && quotedParticipant === botLid) || (!isGroup && !msg.key.fromMe && quotedMsgId));
        
        const normalizedMentions = mentionedJids.map(m => normalizeToJid(m));
        const isMentioningBot = normalizedMentions.includes(botJid) || (botLid && normalizedMentions.includes(botLid));

        const isGojoCalled = /\bgojo\b/i.test(lowerMessage);
        const isLizzyCalled = /\blizzy\b/i.test(lowerMessage);
        const isJarvisCalled = /\bjarvis\b|\bchatbot\b/i.test(lowerMessage);
        const isFridayCalled = /\bfriday\b/i.test(lowerMessage);

        let identifiedAgent = null;

        // 1. If replying to a bot message and we have stored agent context
        if (isReplyingToBot && quotedMsgId && global.botMessageAgents[quotedMsgId]) {
            identifiedAgent = global.botMessageAgents[quotedMsgId];
        }
        // 2. If mentioned or replied to, detect by keyword or fallback to active agent
        else if (isMentioningBot || isReplyingToBot) {
            if (isFridayCalled && config.fridayChats?.includes(jid)) {
                identifiedAgent = 'friday';
            } else if (isLizzyCalled && config.lizzyChats?.includes(jid)) {
                identifiedAgent = 'lizzy';
            } else if (isJarvisCalled && config.chatbotChats?.includes(jid)) {
                identifiedAgent = 'jarvis';
            } else if (isGojoCalled && !config.gojoGlobalSleep) {
                identifiedAgent = 'gojo';
            } else {
                // Fallback: use whichever chatbot is active in this chat (only one should be active)
                if (config.lizzyChats?.includes(jid)) identifiedAgent = 'lizzy';
                else if (config.chatbotChats?.includes(jid)) identifiedAgent = 'jarvis';
                else if (config.fridayChats?.includes(jid)) identifiedAgent = 'friday';
                else if (!config.gojoGlobalSleep) identifiedAgent = 'gojo';
            }
        }
        // 3. Standalone keyword triggers (no mention/reply)
        else {
            if (isFridayCalled && config.fridayChats?.includes(jid)) {
                identifiedAgent = 'friday';
            } else if (isLizzyCalled && config.lizzyChats?.includes(jid)) {
                identifiedAgent = 'lizzy';
            } else if (isJarvisCalled && config.chatbotChats?.includes(jid)) {
                identifiedAgent = 'jarvis';
            } else if (isGojoCalled && !config.gojoGlobalSleep) {
                identifiedAgent = 'gojo';
            }
        }

        if (identifiedAgent && !trimmedMessage.startsWith(config.prefix)) {
            if (identifiedAgent === 'gojo') {
                command = 'gojo';
                args = trimmedMessage;
            } else if (identifiedAgent === 'lizzy') {
                command = 'lizzy_chat';
                args = trimmedMessage;
            } else if (identifiedAgent === 'jarvis') {
                command = 'chatbot_chat';
                args = trimmedMessage;
            } else if (identifiedAgent === 'friday') {
                command = 'friday_chat';
                args = trimmedMessage;
            }
        }

        // ─── COMMAND EXTRACTION ──────────────────────────────────
        if (!command) {
            if (trimmedMessage.startsWith(config.prefix)) {
                const spaceIndex = trimmedMessage.indexOf(' ');
                if (spaceIndex === -1) {
                    command = trimmedMessage.slice(config.prefix.length).toLowerCase();
                    args = '';
                } else {
                    command = trimmedMessage.slice(config.prefix.length, spaceIndex).toLowerCase();
                    args = trimmedMessage.slice(spaceIndex + 1);
                }
            } else if (commands[trimmedMessage.toLowerCase()]) {
                command = trimmedMessage.toLowerCase();
                args = '';
            }
        }

        if (!command) return;

        // ─── AGENT CONTEXT ───────────────────────────────────────
        if (command === 'gojo') global.activeAgentContext = 'gojo';
        else if (command === 'lizzy_chat') global.activeAgentContext = 'lizzy';
        else if (command === 'chatbot_chat') global.activeAgentContext = 'jarvis';
        else if (command === 'friday_chat') global.activeAgentContext = 'friday';
        else global.activeAgentContext = null;

        const isPublicMode = config.isPublic ?? false;

        // ─── PERMISSION CHECKS ──────────────────────────────────
        // If not public and not authorized, deny
        // EXCEPT: Allow chatbot interactions (gojo, lizzy, jarvis, friday) even in private mode
        const isChatbotCommand = ['gojo', 'lizzy_chat', 'chatbot_chat', 'friday_chat'].includes(command);
        if (!isPublicMode && !isOwner && !isSudo && !isChatbotCommand) {
            await sock.sendMessage(jid, { text: "🔒 Bot is in private mode. Only owners and sudos can use commands." });
            return;
        }

        // ─── COMMAND EXECUTION ──────────────────────────────────
        console.log(`⚙️ [PARSER] Triggering command: "${command}"`);
        const cmdKey = command.startsWith(config.prefix) ? command : `${config.prefix}${command}`;

        if (commands[cmdKey]) {
            // ─── AUTO-REACT ──────────────────────────────────────
            if (config.autoReact === 'cmd' && !msg.key.fromMe) {
                let reaction = '';
                if (isDev) {
                    reaction = '☣️';
                } else if (isOwner) {
                    reaction = '☯️';
                } else {
                    reaction = REACT_EMOJIS[reactIndex % REACT_EMOJIS.length];
                    reactIndex++;
                }
                try {
                    await sock.sendMessage(jid, { react: { text: reaction, key: msg.key } });
                } catch (err) { /* ignore */ }
            }
            await commands[cmdKey](sock, msg, args, { isOwner, isSudo, isDev, isPrimaryOwner, senderNumber });
        } else if (commands[command]) {
            if (config.autoReact === 'cmd' && !msg.key.fromMe) {
                let reaction = '';
                if (isDev) {
                    reaction = '☣️';
                } else if (isOwner) {
                    reaction = '☯️';
                } else {
                    reaction = REACT_EMOJIS[reactIndex % REACT_EMOJIS.length];
                    reactIndex++;
                }
                try {
                    await sock.sendMessage(jid, { react: { text: reaction, key: msg.key } });
                } catch (err) { /* ignore */ }
            }
            await commands[command](sock, msg, args, { isOwner, isSudo, isDev, isPrimaryOwner, senderNumber });
        }
    } catch (err) {
        console.error('Error handling message stream:', err);
    }
}

// ─── HELPER: FORMAT UPTIME ──────────────────────────────────────
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

module.exports = { handleIncomingMessage };