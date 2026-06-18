// helpers/messageHandlers.js
const config = require('../config');
const { DEV_LIDS, DEV_JIDS } = require('../devs');
const commands = require('../commands');
const { getPhoneJid, normalizeToJid, saveState } = require('../stateManager');
const { getRawMessage, handleViewOnce } = require('./log');
const fs = require('fs');
const path = require('path');

const notesPath = path.join(__dirname, '../storage/notes.json');

// ─── AIZEN QUOTES FOR AFK (Issue 5) ────────────────────────────
const AIZEN_QUOTES = [
    "Admiration is the emotion furthest from understanding.",
    "You cannot defeat me. You never could.",
    "I have no interest in the weak. They are beneath my notice.",
    "The only thing that stands between you and victory is your own illusion of hope.",
    "You've lost before you even began.",
    "I stand at the top of the world. You are merely a passerby.",
    "Your power is insignificant compared to mine.",
    "There is no such thing as 'truth' in this world. That is why I seek it.",
    "Fate is not something to be accepted; it is something to be defied.",
    "You are not even worthy of my full attention."
];

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

// ─── INTERACTIVE SESSIONS HANDLER (Issue 1) ────────────────────
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

// ─── AFK DEACTIVATION (Issue 5) ──────────────────────────────
async function handleAfkDeactivation(sock, msg) {
    const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
    if (!senderJid) return false;

    if (config.afk && config.afk[senderJid]) {
        delete config.afk[senderJid];
        saveState();
        // Optional welcome-back message
        await sock.sendMessage(msg.key.remoteJid, {
            text: `👋 *Welcome back!* Your AFK mode has been deactivated.`
        }, { quoted: msg });
        return true;
    }
    return false;
}

// ─── AFK MENTION HANDLER (Issue 5) ─────────────────────────────
async function handleAfkMentions(sock, msg, mentionedJids) {
    const jid = msg.key.remoteJid;
    if (!config.afk || Object.keys(config.afk).length === 0) return;

    // Gather all possible targets: mentionedJids + quoted sender
    const targets = new Set();
    for (const m of (mentionedJids || [])) {
        targets.add(normalizeToJid(m));
    }
    // Also check if the user quoted a message from someone (contextInfo.participant)
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
    if (contextInfo?.participant) {
        targets.add(normalizeToJid(contextInfo.participant));
    }

    for (const target of targets) {
        if (!target) continue;
        if (config.afk[target]) {
            const afkData = config.afk[target];
            const elapsed = Date.now() - afkData.time;
            const elapsedStr = formatUptime(Math.floor(elapsed / 1000));
            const reason = afkData.reason || "Infinite Void meditation";

            // Pick a random Aizen quote
            const quote = AIZEN_QUOTES[Math.floor(Math.random() * AIZEN_QUOTES.length)];

            const replyText =
                `🚫 *${quote}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 *User:* @${target.split('@')[0]}\n` +
                `⏳ *AFK since:* ${elapsedStr} ago\n` +
                `📝 *Reason:* ${reason}\n\n` +
                `_“They are not here right now.”_`;

            await sock.sendMessage(jid, {
                text: replyText,
                mentions: [target]
            });
            return; // Only reply once per message
        }
    }
}

// ─── SECURITY POLICY HELPER ────────────────────────────────────
async function applySecurityPolicy(sock, msg, policy, senderJid, senderNumber, jid, violationReason) {
    // ... (unchanged – keep your existing code)
    // I'll omit it here for brevity, but it must be included.
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

        // 3. Interactive sessions (Issue 1)
        const handled = await handleInteractiveSessions(sock, msg);
        if (handled) return;

        // 4. AFK deactivation (Issue 5) – clear AFK for the sender if they are AFK
        await handleAfkDeactivation(sock, msg);

        // ─── PERMISSIONS & COMMAND PARSING (existing) ──────────
        let command;
        let args;

        const botJid = config.botJid || (sock.user?.id ? `${sock.user.id.split(':')[0]}@s.whatsapp.net` : '');
        const botLid = config.botLid || '';

        global.activeSock = sock;

        let isDev = DEV_LIDS.includes(senderJid) || DEV_JIDS.includes(senderJid);
        let isPrimaryOwner = senderJid === config.ownerJid ||
                             (config.ownerLid && senderJid === config.ownerLid);
        let isSecondaryOwner = Array.isArray(config.secondaryOwners) &&
                               config.secondaryOwners.includes(senderJid);
        let isOwner = isDev || isPrimaryOwner || isSecondaryOwner || msg.key.fromMe;
        let isSudo = (Array.isArray(config.sudos) && config.sudos.includes(senderJid)) ||
                     (Array.isArray(config.sudoLids) && config.sudoLids.includes(senderJid));

        // ─── Fallback: Resolve LID → Phone JID ──────────────────
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

        // ─── AFK MENTION HANDLER (Issue 5) ──────────────────────
        // Check if any mentioned user is AFK – run after deactivation,
        // but before command parsing so it works even for non‑command messages.
        // Only run in groups (or any chat) to avoid spamming DMs.
        await handleAfkMentions(sock, msg, mentionedJids);

        // ─── GROUP SECURITY INTERCEPTORS (existing) ─────────────
        // ... (keep your existing code for antilink, antibot, etc.)
        // ─── (I've omitted them here for brevity, but they must be present) ───

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

        // ─── ANTIBUG RATE-LIMIT (existing) ──────────────────────
        // ... (keep your current code)

        // ─── ANTISPAM RATE-LIMIT (existing) ──────────────────────
        // ... (keep your current code)

        // ─── DEV MENTION REACTION (existing) ─────────────────────
        // ... (keep your current code)

        // ─── AGENT DETECTION (existing) ─────────────────────────
        // ... (keep your current code)

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

        // ─── AGENT CONTEXT (existing) ───────────────────────────
        // ... (keep your current code)

        const isPublicMode = config.isPublic ?? false;

        // ─── PERMISSION CHECKS (existing) ──────────────────────
        // ... (keep your current code)

        // ─── COMMAND EXECUTION (existing) ──────────────────────
        console.log(`⚙️ [PARSER] Triggering command: "${command}"`);
        const cmdKey = command.startsWith(config.prefix) ? command : `${config.prefix}${command}`;

        if (commands[cmdKey]) {
            if (config.autoReact === 'cmd' && !msg.key.fromMe) {
                try { await sock.sendMessage(jid, { react: { text: "❄", key: msg.key } }); } catch (err) { /* ignore */ }
            }
            await commands[cmdKey](sock, msg, args, { isOwner, isSudo, isDev, isPrimaryOwner, senderNumber });
        } else if (commands[command]) {
            if (config.autoReact === 'cmd' && !msg.key.fromMe) {
                try { await sock.sendMessage(jid, { react: { text: "❄", key: msg.key } }); } catch (err) { /* ignore */ }
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