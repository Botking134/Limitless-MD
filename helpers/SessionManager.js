// helpers/SessionManager.js
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { saveState, normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('./Message');

const notesPath = path.join(__dirname, '../storage/notes.json');

// In-memory AFK notice cooldown tracker (1 alert per chat per 60 seconds)
global.afkNoticeCooldowns = global.afkNoticeCooldowns || {};

// ─── NOTES LOCAL STORAGE HELPERS ─────────────────────────────────

function readNotes() {
    try {
        if (fs.existsSync(notesPath)) {
            const rawData = fs.readFileSync(notesPath, 'utf-8');
            return JSON.parse(rawData);
        }
    } catch (e) {
        console.error("⚠️ [NOTES] Parse failed. Backing up corrupted file.");
        try {
            if (fs.existsSync(notesPath)) {
                fs.renameSync(notesPath, notesPath.replace('.json', '.corrupted.json'));
            }
        } catch (backupErr) { /* ignore */ }
    }
    return {};
}

function saveNotes(notes) {
    try {
        const dir = path.dirname(notesPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

// ─── ACTIVE INTERACTIVE SESSION ROUTER ───────────────────────────

async function handleInteractiveSessions(sock, msg, trimmedMessageBody, quotedMsgId, cleanChatJid) {
    if (!quotedMsgId) return false;

    // 1. Bank Details Setup Wizard (aza)
    if (global.azaSessions && global.azaSessions[quotedMsgId]) {
        const session = global.azaSessions[quotedMsgId];
        const jid = msg.key.remoteJid;

        if (session.step === 1) {
            const account = trimmedMessageBody.replace(/[^0-9]/g, '');
            if (account.length < 5) {
                try {
                    await sock.sendMessage(jid, { text: "❌ Invalid account number. Must be at least 5 digits. Try again by replying to the original prompt." }, { quoted: msg });
                } catch (e) { /* ignore */ }
                return true;
            }
            session.account = account;
            session.step = 2;

            try {
                const nextPrompt = await sock.sendMessage(jid, {
                    text: `🏦 *BANK DETAILS CONFIGURATION WIZARD* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `• *Step 2:* Please reply directly to *this message* with your *Bank Name* (e.g., Kuda, GTBank).`
                }, { quoted: msg });

                global.azaSessions[nextPrompt.key.id] = session;
            } catch (e) { /* ignore */ }

            delete global.azaSessions[quotedMsgId];
            return true;
        }

        if (session.step === 2) {
            const bank = trimmedMessageBody.trim();
            if (!bank) return true;
            
            session.bank = bank;
            session.step = 3;

            try {
                const nextPrompt = await sock.sendMessage(jid, {
                    text: `🏦 *BANK DETAILS CONFIGURATION WIZARD* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `• *Step 3:* Please reply directly to *this message* with your *Account Name* (e.g., John Doe).`
                }, { quoted: msg });

                global.azaSessions[nextPrompt.key.id] = session;
            } catch (e) { /* ignore */ }

            delete global.azaSessions[quotedMsgId];
            return true;
        }

        if (session.step === 3) {
            const name = trimmedMessageBody.trim();
            if (!name) return true;

            config.aza = {
                set: true,
                account: session.account,
                bank: session.bank,
                name: name
            };

            try { saveState(); } catch (e) {}
            delete global.azaSessions[quotedMsgId];

            const successCard =
                `🏦 *BANK DETAILS SAVED SUCCESSFULLY!* 🏦\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *NAME:* \`${name}\`\n` +
                `🏦 *BANK:* \`${session.bank}\`\n` +
                `💳 *ACCOUNT NO:* \`${session.account}\``;

            try {
                await sock.sendMessage(jid, { text: successCard }, { quoted: msg });
            } catch (e) { /* ignore */ }
            return true;
        }
    }

    // 2. Forwarding Wizard (fw)
    if (global.forwardSessions && global.forwardSessions[quotedMsgId]) {
        const session = global.forwardSessions[quotedMsgId];
        const jid = msg.key.remoteJid;

        const cleanTarget = trimmedMessageBody.trim();
        const targetJid = cleanTarget.endsWith('@g.us') ? cleanTarget : (cleanTarget.replace(/[^0-9]/g, '') + '@s.whatsapp.net');

        if (targetJid.length < 8) {
            try {
                await sock.sendMessage(jid, { text: "❌ Invalid target phone number or group JID. Forwarding aborted." }, { quoted: msg });
            } catch (e) { /* ignore */ }
            delete global.forwardSessions[quotedMsgId];
            return true;
        }

        try {
            const { proto } = await import('@itsliaaa/baileys');
            const fullMessage = proto.WebMessageInfo.create({
                key: {
                    remoteJid: jid,
                    id: session.originalMsgKey,
                    participant: jid.endsWith('@g.us') ? session.originalParticipant : undefined
                },
                message: session.msgToForward
            });

            await sock.copyNForward(targetJid, fullMessage, true);
            await sock.sendMessage(jid, { text: `✅ Message forwarded cleanly to ${targetJid}` }, { quoted: msg });
        } catch (e) {
            try {
                await sock.sendMessage(jid, { text: `❌ Forwarding failed: ${e.message}` }, { quoted: msg });
            } catch (err) { /* ignore */ }
        }

        delete global.forwardSessions[quotedMsgId];
        return true;
    }

    return false;
}

// ─── DOWNLOADER SELECTION MANAGER ────────────────────────────────

async function handleDownloaderSessions(sock, msg, trimmedMessageBody, quotedMsgId) {
    if (!quotedMsgId) return false;

    const registries = {
        song: global.songSessions,
        tgs: global.tgsSessions,
        lyrics: global.lyricsSessions,
        xvid: global.xvidSessions
    };

    for (const [key, registry] of Object.entries(registries)) {
        if (registry && registry[quotedMsgId]) {
            const session = registry[quotedMsgId];
            try {
                if (typeof session.handle === 'function') {
                    await session.handle(sock, msg, session, trimmedMessageBody);
                }
            } catch (err) {
                console.error(`❌ Error executing ${key} downloader session handle:`, err.message);
            }
            delete registry[quotedMsgId];
            return true;
        }
    }

    return false;
}

// ─── AFK DEACTIVATION & MENTION ALERTS (Silent Counting) ─────────

async function handleAfkDeactivation(sock, msg) {
    try {
        const jid = msg.key.remoteJid;
        const rawSender = msg.key.participant || msg.key.remoteJid || '';
        const senderJid = normalizeToJid(rawSender);
        const cleanSender = senderJid.split('@')[0].split(':')[0];

        config.afk = config.afk || {};

        // 1. Silent Deactivation when the returning user types ANY message
        const matchedAfkKey = Object.keys(config.afk).find(k => k.split('@')[0].split(':')[0] === cleanSender);

        if (matchedAfkKey) {
            const afkData = config.afk[matchedAfkKey];
            const durationStr = formatDuration(Date.now() - afkData.time);
            delete config.afk[matchedAfkKey];

            try { saveState(); } catch (e) {}

            try {
                await sock.sendMessage(jid, {
                    text: `👋 *Welcome Back @${cleanSender}!*\n\nYou were away for: \`${durationStr}\`. AFK mode deactivated.`,
                    mentions: [senderJid]
                }, { quoted: msg });
            } catch (e) { /* ignore */ }
        }

        // 2. Alert members ONLY if they tag or quote an AFK user (60s Cooldown)
        const rawContent = getRawMessage(msg.message);
        const contextInfo = rawContent?.contextInfo ||
                            rawContent?.extendedTextMessage?.contextInfo ||
                            rawContent?.imageMessage?.contextInfo ||
                            rawContent?.videoMessage?.contextInfo;

        const mentions = (contextInfo?.mentionedJid || []).map(normalizeToJid);
        if (contextInfo?.participant) {
            mentions.push(normalizeToJid(contextInfo.participant));
        }

        const uniqueMentions = [...new Set(mentions)];

        for (const targetJid of uniqueMentions) {
            const targetClean = targetJid.split('@')[0].split(':')[0];
            const afkMatchKey = Object.keys(config.afk).find(k => k.split('@')[0].split(':')[0] === targetClean);

            if (afkMatchKey && targetClean !== cleanSender) {
                const now = Date.now();
                const cooldownKey = `${jid}_${targetClean}`;

                if (global.afkNoticeCooldowns[cooldownKey] && (now - global.afkNoticeCooldowns[cooldownKey] < 60000)) {
                    continue; // Skip alert if within 60s cooldown in this chat
                }

                global.afkNoticeCooldowns[cooldownKey] = now;

                const data = config.afk[afkMatchKey];
                const durationStr = formatDuration(now - data.time);

                const alertText =
                    `💤 *AFK NOTICE* 💤\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *User:* @${targetClean}\n` +
                    `⏳ *Away for:* \`${durationStr}\`\n` +
                    `📝 *Reason:* \`${data.reason}\``;

                try {
                    await sock.sendMessage(jid, { text: alertText, mentions: [targetJid] }, { quoted: msg });
                } catch (e) { /* ignore */ }
            }
        }
    } catch (e) {
        console.error("❌ [AFK HANDLER ERROR]:", e.message);
    }
}

// ─── STICKY NOTES INTERACTIVE ANSWER CAPTURER ────────────────────

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
            try {
                await sock.sendMessage(jid, { text: `✅ Note successfully saved as *${noteName}*!` }, { quoted: msg });
            } catch (e) { /* ignore */ }
            return true;
        }
    } catch (e) {
        console.error("Note session handler error:", e);
    }
    return false;
}

module.exports = {
    readNotes,
    saveNotes,
    handleInteractiveSessions,
    handleDownloaderSessions,
    handleAfkDeactivation,
    handleNoteSession
};