// helpers/SessionManager.js

const config = require('../config');
const { saveState } = require('../stateManager');
const fs = require('fs');
const path = require('path');

const remindersPath = path.join(__dirname, '../storage/reminders.json');

// ─── DECOUPLED REMINDERS STORAGE HANDLERS ───────────────────────

function readReminders() {
    try {
        if (fs.existsSync(remindersPath)) {
            return JSON.parse(fs.readFileSync(remindersPath, 'utf-8'));
        }
    } catch (e) { /* ignore */ }
    return [];
}

function saveReminders(reminders) {
    try {
        const dir = path.dirname(remindersPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

// ─── SESSION REGISTER ───────────────────────────────────────────

function registerSession(sessionType, promptId, data) {
    const registries = {
        song: global.songSessions,
        tgs: global.tgsSessions,
        lyrics: global.lyricsSessions,
        xvid: global.xvidSessions
    };
    const registry = registries[sessionType];
    if (registry) {
        registry[promptId] = data;
        // Auto-delete session after 5 minutes to prevent RAM leaks
        setTimeout(() => {
            if (registry[promptId]) delete registry[promptId];
        }, 5 * 60 * 1000);
    }
}

// ─── INTERACTIVE REPLY WIZARDS INTERCEPTOR ──────────────────────

async function handleInteractiveSessions(sock, msg, text, quotedMsgId, jid) {
    if (!quotedMsgId) return false;

    // ─── AZA SESSION ───────────────────────────────────────────
    if (global.azaSessions && global.azaSessions[quotedMsgId]) {
        try {
            const session = global.azaSessions[quotedMsgId];
            if (session.step === 1) {
                const account = text.trim();
                if (!account || account.length < 5) {
                    await sock.sendMessage(jid, { text: "❌ Account number must be at least 5 digits. Please try again." });
                    return true;
                }
                session.account = account;
                session.step = 2;
                try {
                    const prompt = await sock.sendMessage(jid, { text: "🏦 *Step 2:* Please reply with the *Bank Name*." });
                    global.azaSessions[prompt.key.id] = session;
                    delete global.azaSessions[quotedMsgId];
                } catch (sendErr) {
                    console.error("Failed to send Aza Step 2 prompt:", sendErr);
                }
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
                try {
                    const prompt = await sock.sendMessage(jid, { text: "🏦 *Step 3:* Please reply with the *Account Name*." });
                    global.azaSessions[prompt.key.id] = session;
                    delete global.azaSessions[quotedMsgId];
                } catch (sendErr) {
                    console.error("Failed to send Aza Step 3 prompt:", sendErr);
                }
                return true;
            }
            if (session.step === 3) {
                const name = text.trim();
                if (!name) {
                    await sock.sendMessage(jid, { text: "❌ Account name cannot be empty. Please try again." });
                    return true;
                }
                config.aza = { set: true, account: session.account, bank: session.bank, name: name };
                saveState();
                await sock.sendMessage(jid, {
                    text: `✅ *Bank details saved successfully!*\n\n🏦 *Bank:* ${session.bank}\n💳 *Account:* ${session.account}\n👤 *Name:* ${name}`
                });
                delete global.azaSessions[quotedMsgId];
                return true;
            }
            delete global.azaSessions[quotedMsgId];
            return true;
        } catch (err) {
            console.error('[AZA INTERCEPTOR]', err);
            await sock.sendMessage(jid, { text: '❌ An error occurred while processing your Aza session.' });
            delete global.azaSessions[quotedMsgId];
            return true;
        }
    }

    // ─── REMINDER SESSION ──────────────────────────────────────
    if (global.reminderSessions && global.reminderSessions[quotedMsgId]) {
        try {
            const session = global.reminderSessions[quotedMsgId];
            if (!session || !session.durationMs || !session.text) {
                await sock.sendMessage(jid, { text: "❌ Reminder session data is invalid. Please start again." });
                delete global.reminderSessions[quotedMsgId];
                return true;
            }
            const title = text.trim();
            if (!title) {
                await sock.sendMessage(jid, { text: "❌ Reminder title cannot be empty." });
                return true;
            }
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
        } catch (err) {
            console.error('[REMINDER INTERCEPTOR]', err);
            await sock.sendMessage(jid, { text: '❌ Failed to save reminder due to an internal error.' });
            delete global.reminderSessions[quotedMsgId];
            return true;
        }
    }

    // ─── CANCEL SESSION ──────────────────────────────────────
    if (global.cancelSessions && global.cancelSessions[quotedMsgId]) {
        try {
            const num = parseInt(text.trim());
            if (isNaN(num)) {
                await sock.sendMessage(jid, { text: "❌ Please enter a valid number from the list." });
                return true;
            }
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
        } catch (err) {
            console.error('[CANCEL INTERCEPTOR]', err);
            await sock.sendMessage(jid, { text: '❌ Failed to cancel reminder.' });
            delete global.cancelSessions[quotedMsgId];
            return true;
        }
    }

    // ─── FORWARD SESSION (Fixed XML-not-well-formed validation) ──
    if (global.forwardSessions && global.forwardSessions[quotedMsgId]) {
        try {
            const target = text.trim();
            if (!target) return true;
            
            const targetJid = target.endsWith('@g.us') ? target : (target.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
            if (targetJid.length < 8) {
                await sock.sendMessage(jid, { text: "❌ Please enter a valid phone number or group JID." });
                return true;
            }
            const session = global.forwardSessions[quotedMsgId];
            if (!session || !session.msgToForward) {
                await sock.sendMessage(jid, { text: "❌ Forward data missing. Please initiate a new forward." });
                delete global.forwardSessions[quotedMsgId];
                return true;
            }

            const { proto } = await import('@itsliaaa/baileys');
            const fullMessage = proto.WebMessageInfo.create({
                key: {
                    remoteJid: jid,
                    id: session.originalMsgKey,
                    // Participant is strictly forbidden on DM remoteJids
                    participant: jid.endsWith('@g.us') ? session.originalParticipant : undefined
                },
                message: session.msgToForward
            });

            await sock.copyNForward(targetJid, fullMessage, true);
            await sock.sendMessage(jid, { text: `✅ Message forwarded to ${targetJid}` });
            delete global.forwardSessions[quotedMsgId];
            return true;
        } catch (e) {
            console.error('[FORWARD INTERCEPTOR]', e);
            await sock.sendMessage(jid, { text: `❌ Forward failed: ${e.message}` });
            delete global.forwardSessions[quotedMsgId];
            return true;
        }
    }

    return false;
}

// ─── DOWNLOADER INTERACTIVE SESSIONS (Universal loop-router) ────
async function handleDownloaderSessions(sock, msg, text, quotedMsgId) {
    if (!quotedMsgId) return false;

    const registries = [
        { reg: global.songSessions, type: 'song' },
        { reg: global.tgsSessions, type: 'tgs' },
        { reg: global.lyricsSessions, type: 'lyrics' },
        { reg: global.xvidSessions, type: 'xvid' }
    ];

    for (const r of registries) {
        if (r.reg && r.reg[quotedMsgId]) {
            const session = r.reg[quotedMsgId];
            if (session && typeof session.handle === 'function') {
                await session.handle(sock, msg, session, text);
                return true;
            }
        }
    }
    return false;
}

module.exports = {
    readReminders,
    saveReminders,
    registerSession,
    handleInteractiveSessions,
    handleDownloaderSessions
};