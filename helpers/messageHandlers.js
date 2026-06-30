// helpers/messageHandlers.js
const config = require('../config');
const { DEV_LIDS, DEV_JIDS } = require('../plugins/devs');
const commands = require('../commands');
const { getPhoneJid, normalizeToJid, saveState } = require('../stateManager');
const { getRawMessage, handleViewOnce } = require('./log');
const fs = require('fs');
const path = require('path');
const os = require('os'); // Added for temporary directory redirection

// ─── REDIRECT TEMPORARY DIRECTORY ──────────────────────────────────
// Forces all temporary processes (like stickers or ffmpeg conversions)
// to utilize your main 6GB disk space, preventing virtual /tmp partition ENOSPC errors.
const localTempPath = path.join(__dirname, '../storage/temp');
try {
    if (!fs.existsSync(localTempPath)) {
        fs.mkdirSync(localTempPath, { recursive: true });
    }
    os.tmpdir = () => localTempPath;
} catch (e) {
    console.error("Failed to redirect temporary directory path:", e);
}

// ─── IMPORT REMINDER HELPERS ONCE (avoid inline require) ──────
const { readReminders, saveReminders } = require('../plugins/owner');

const notesPath = path.join(__dirname, '../storage/notes.json');
const userStatsPath = path.join(__dirname, '../storage/userStats.json');
const gcLogsPath = path.join(__dirname, '../storage/gclogs.json'); // Dedicated file for chat logging

// ─── PERMISSION MATRIX ──────────────────────────────────────────
const ownerCommands = [
    'diagnose', 'update', 'mode', 'setsudo', 'delsudo',
    'restart', 'shutdown', 'ban', 'unban',
    'afk', 'setvar', 'settings',
    'antipm', 'reminder', 'remind', 'games_closeall', 'owner'
];

const primaryOnlyCommands = ['addowner', 'delowner'];
const devOnlyCommands = ['upgrade'];

// ─── GLOBAL SESSIONS ──────────────────────────────────────────────
global.gitSessions = global.gitSessions || {};

// ─── LOGGING CAPTURE ────────────────────────────────────────────
if (!global.recentLogs || !Array.isArray(global.recentLogs)) {
    global.recentLogs = [];
}

// ─── JID NORMALIZATION HELPER ───────────────────────────────────
function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

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

// ─── DEDICATED GC CHAT LOG HELPERS (Option A) ───────────────────

function readGcLogs() {
    try {
        if (fs.existsSync(gcLogsPath)) return JSON.parse(fs.readFileSync(gcLogsPath, 'utf-8'));
    } catch (e) { /* ignore */ }
    return {};
}

function saveGcLogs(logs) {
    try {
        const dir = path.dirname(gcLogsPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(gcLogsPath, JSON.stringify(logs, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

// ─── USER STATS PERSISTENCE HELPERS (Optimized In-Memory Cache) ───

let cachedUserStats = null;
let isUserStatsDirty = false;

function readUserStats() {
    if (cachedUserStats) return cachedUserStats;
    try {
        if (fs.existsSync(userStatsPath)) {
            cachedUserStats = JSON.parse(fs.readFileSync(userStatsPath, 'utf-8'));
            return cachedUserStats;
        }
    } catch (e) { /* ignore */ }
    cachedUserStats = {};
    return cachedUserStats;
}

function saveUserStats(stats) {
    cachedUserStats = stats;
    isUserStatsDirty = true;
}

// Write the cached stats to disk every 10 seconds only if there were modifications
setInterval(() => {
    if (isUserStatsDirty && cachedUserStats) {
        try {
            const dir = path.dirname(userStatsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(userStatsPath, JSON.stringify(cachedUserStats, null, 2), 'utf-8');
            isUserStatsDirty = false;
        } catch (e) { /* ignore */ }
    }
}, 10000);

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
    // Robust extraction of the quoted message ID
    const contextInfo =
        rawMsg?.contextInfo ||
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.contextInfo;   // conversation reply may have top-level contextInfo
    const quotedMsgId = contextInfo?.stanzaId;

    if (!quotedMsgId) return false;

    const text = (rawMsg?.conversation || rawMsg?.extendedTextMessage?.text || '').trim();

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

    // ─── FORWARD SESSION ──────────────────────────────────────
    if (global.forwardSessions && global.forwardSessions[quotedMsgId]) {
        try {
            const target = text.trim().replace(/[^0-9]/g, '');
            if (target.length < 7) {
                await sock.sendMessage(jid, { text: "❌ Please enter a valid phone number (at least 7 digits)." });
                return true;
            }
            const targetJid = `${target}@s.whatsapp.net`;
            const session = global.forwardSessions[quotedMsgId];
            if (!session || !session.msgToForward) {
                await sock.sendMessage(jid, { text: "❌ Forward data missing. Please initiate a new forward." });
                delete global.forwardSessions[quotedMsgId];
                return true;
            }
            await sock.sendMessage(targetJid, { forward: session.msgToForward });
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

    // ─── GIT SESSIONS ──────────────────────────────────────────
    if (global.gitSessions && global.gitSessions[quotedMsgId]) {
        try {
            const session = global.gitSessions[quotedMsgId];
            const { exec } = require('child_process');

            function execGit(cmd, timeout, callback) {
                const child = exec(cmd, (err, stdout, stderr) => {
                    if (callback) callback(err, stdout, stderr);
                });
                const timer = setTimeout(() => {
                    child.kill();
                    if (callback) callback(new Error('Command timed out'), '', '');
                }, timeout);
                child.on('exit', () => clearTimeout(timer));
            }

            switch (session.action) {
                case 'commit':
                case 'commitpush': {
                    if (!text) {
                        await sock.sendMessage(jid, { text: "❌ Commit message cannot be empty." });
                        return true;
                    }
                    await sock.sendMessage(jid, { text: `⏳ *Committing with message:* "${text}"` });
                    execGit(`git add . && git commit -m "${text}"`, 10000, async (err, stdout) => {
                        if (err) {
                            await sock.sendMessage(jid, { text: `❌ *Commit failed:* ${err.message}` });
                        } else {
                            await sock.sendMessage(jid, { text: `✅ *Committed successfully!*\n${stdout}` });
                            if (session.action === 'commitpush') {
                                await sock.sendMessage(jid, { text: "⏳ *Pushing commits...*" });
                                execGit('git push', 60000, async (pushErr, pushOut) => {
                                    if (pushErr) return await sock.sendMessage(jid, { text: `❌ *Push failed:* ${pushErr.message}` });
                                    await sock.sendMessage(jid, { text: `✅ *Push successful!*\n${pushOut}` });
                                });
                            }
                        }
                    });
                    delete global.gitSessions[quotedMsgId];
                    return true;
                }
                case 'switch': {
                    if (!text) {
                        await sock.sendMessage(jid, { text: "❌ Branch name cannot be empty." });
                        return true;
                    }
                    await sock.sendMessage(jid, { text: `⏳ *Switching to branch "${text}"...*` });
                    execGit(`git checkout ${text}`, 10000, async (err, stdout) => {
                        if (err) return await sock.sendMessage(jid, { text: `❌ *Switch failed:* ${err.message}` });
                        await sock.sendMessage(jid, { text: `✅ *Switched to branch "${text}".*` });
                    });
                    delete global.gitSessions[quotedMsgId];
                    return true;
                }
                case 'newbranch': {
                    if (!text) {
                        await sock.sendMessage(jid, { text: "❌ Branch name cannot be empty." });
                        return true;
                    }
                    await sock.sendMessage(jid, { text: `⏳ *Creating branch "${text}"...*` });
                    execGit(`git checkout -b ${text}`, 10000, async (err, stdout) => {
                        if (err) return await sock.sendMessage(jid, { text: `❌ *Branch creation failed:* ${err.message}` });
                        await sock.sendMessage(jid, { text: `✅ *Created and switched to branch "${text}".*` });
                    });
                    delete global.gitSessions[quotedMsgId];
                    return true;
                }
                case 'revert': {
                    const num = parseInt(text);
                    if (isNaN(num) || num < 1 || num > session.commits.length) {
                        await sock.sendMessage(jid, { text: `❌ Invalid number. Enter 1-${session.commits.length}.` });
                        return true;
                    }
                    const commitHash = session.commits[num - 1].split(' ')[0];
                    await sock.sendMessage(jid, { text: `⏳ *Reverting commit ${commitHash}...*` });
                    execGit(`git revert ${commitHash} --no-edit`, 10000, async (err, stdout) => {
                        if (err) return await sock.sendMessage(jid, { text: `❌ *Revert failed:* ${err.message}` });
                        await sock.sendMessage(jid, { text: `✅ *Reverted commit ${commitHash}.` });
                    });
                    delete global.gitSessions[quotedMsgId];
                    return true;
                }
                case 'force': {
                    if (text !== 'CONFIRM') {
                        await sock.sendMessage(jid, { text: "❌ Force pull cancelled. Type CONFIRM to proceed." });
                        return true;
                    }
                    await sock.sendMessage(jid, { text: "⏳ *Force pulling updates...*" });
                    execGit(`git fetch --all && git reset --hard origin/$(git rev-parse --abbrev-ref HEAD)`, 60000, async (err, stdout) => {
                        if (err) return await sock.sendMessage(jid, { text: `❌ *Force pull failed:* ${err.message}` });
                        await sock.sendMessage(jid, { text: `✅ *Force pull successful!*` });
                    });
                    delete global.gitSessions[quotedMsgId];
                    return true;
                }
                default:
                    delete global.gitSessions[quotedMsgId];
                    return true;
            }
        } catch (err) {
            console.error('[GIT INTERCEPTOR]', err);
            await sock.sendMessage(jid, { text: '❌ Git operation failed internally.' });
            delete global.gitSessions[quotedMsgId];
            return true;
        }
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
                        ptt: false
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
            config.warns = config.warns || {};
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

        let command;
        let args;

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

        const rawMsg = getRawMessage(msg.message) || msg.message;
        
        // Robust contextInfo extraction across various message types to ensure replies are captured
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
                            msg.message?.imageMessage?.contextInfo ||
                            msg.message?.videoMessage?.contextInfo ||
                            msg.message?.documentMessage?.contextInfo ||
                            msg.message?.contextInfo ||
                            rawMsg?.contextInfo;
                            
        const quotedMsgId = contextInfo?.stanzaId;
        const trimmedMessage = (rawMsg?.conversation || rawMsg?.extendedTextMessage?.text || '').trim();

        if (quotedMsgId && activeQuizKey && global.triviaSessions && global.triviaSessions[activeQuizKey]) {
            const session = global.triviaSessions[activeQuizKey];
            if (session.status === 'awaiting_category' && session.lastQuestionMsgId === quotedMsgId) {
                await commands['quiz_cat'](sock, msg, trimmedMessage, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                return;
            }
        }

        // ─── QUIZ ANSWER INTERCEPTOR ────────────────────────────
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

        // ─── PVP INTERCEPTOR ──────────────────────────────────────
        const pvpSessionKey = jid;
        if (quotedMsgId && global.pvpSessions && global.pvpSessions[pvpSessionKey]) {
            const session = global.pvpSessions[pvpSessionKey];
            if (session.lastQuestionMsgId === quotedMsgId) {
                const ans = trimmedMessage.trim();
                const lowerAns = ans.toLowerCase();
                const acceptWords = ['yes', 'y', 'accept', 'play', 'join', 'ok', 'okay'];
                if (session.status === 'lobby' && senderJid !== session.p1) {
                    if (acceptWords.includes(lowerAns)) {
                        command = 'pvp_lobby_accept';
                        args = ans;
                    }
                } else if (session.status === 'p2_choosing' && senderJid === session.p2) {
                    command = 'pvp_choose';
                    args = ans;
                } else if (session.status === 'fighting' && senderJid === session.turn) {
                    command = 'pvp_fight';
                    args = ans;
                } else if (session.status === 'defending' && senderJid === session.defender) {
                    command = 'pvp_defend';
                    args = ans;
                }
            }
        }

        await handleAfkDeactivation(sock, msg);

        // ─── PERMISSIONS ──────────────────────────────────────────
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
        let body = rawMsg?.conversation ||
                   rawMsg?.extendedTextMessage?.text ||
                   rawMsg?.imageMessage?.caption ||
                   rawMsg?.videoMessage?.caption ||
                   msg.message.buttonsResponseMessage?.selectedButtonId ||
                   msg.message.templateButtonReplyMessage?.selectedId ||
                   '';

        // ─── LIST RESPONSE DETECTION (Git menu) ──────────────────
        if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
            const rowId = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
            const parts = rowId.split('_');
            if (parts[0] === 'git') {
                const subcmd = parts.slice(1).join('_');
                body = `${config.prefix}git ${subcmd}`;
            }
        }

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

        const mentionedJids = (contextInfo?.mentionedJid || []).map(j => cleanJid(j));

        // ─── USER LEVEL-UP & STATS TRACKER ──────────────────────
        if (isGroup && senderJid && !msg.key.fromMe) {
            const userStats = readUserStats();
            userStats[jid] = userStats[jid] || {};
            userStats[jid][senderJid] = userStats[jid][senderJid] || { msgCount: 0, level: 11 };

            // Only increment if it's not a command to prevent spamming command exploits
            const isCommand = trimmedMessageBody.startsWith(config.prefix);
            if (!isCommand && trimmedMessageBody.length > 0) {
                userStats[jid][senderJid].msgCount += 1;
                const newCount = userStats[jid][senderJid].msgCount;

                // Define milestone tiers (matching TIER_DATA in group_advanced.js)
                const milestones = {
                    15: { index: 10, name: "Human", icon: "🏃", text: "🏃 *TIER UNLOCKED: HUMAN ASCENSION*\n\nPeak physical form achieved! @Username has crossed 15 messages!\n\n• Current Tier: Tier 10: Human\n• Status: Standard human capabilities up to peak athlete level. Durability is strictly human level." },
                    45: { index: 9, name: "Superhuman", icon: "⚡", text: "⚡ *TIER UNLOCKED: WALL BREACHED*\n\nConcrete walls shattered! @Username has crossed 45 messages!\n\n• Current Tier: Tier 9: Superhuman\n• Status: Street-level fighter. Can smash steel, concrete, or small rooms with minor effort." },
                    90: { index: 8, name: "Urban", icon: "🏢", text: "🏢 *TIER UNLOCKED: URBAN CALAMITY*\n\nStructures are collapsing! @Username has crossed 90 messages!\n\n• Current Tier: Tier 8: Urban\n• Status: Destructive force ranging from single buildings to city blocks." },
                    150: { index: 7, name: "Nuclear / Regional", icon: "☄️", text: "☄️ *TIER UNLOCKED: REGIONAL CONSTRAINTS SHATTERED*\n\nTowns and vaporized mountains lie behind them! @Username has scaled to 150 messages!\n\n• Current Tier: Tier 7: Nuclear / Regional\n• Status: Capable of leveling towns, major cities, or vaporizing massive mountain ranges." },
                    250: { index: 6, name: "Global", icon: "🗺️", text: "🗺️ *TIER UNLOCKED: GLOBAL DOMINANCE*\n\nTectonic shockwaves detected! @Username has crossed 250 messages and attained global force!\n\n• Current Tier: Tier 6: Global\n• Status: Tectonic force capable of destroying island nations or continents." },
                    400: { index: 5, name: "Planetary", icon: "🪐", text: "🪐 *TIER UNLOCKED: CELESTIAL COLLAPSE*\n\nMoons and planets shatter in their wake! @Username has crossed 400 messages!\n\n• Current Tier: Tier 5: Planetary\n• Status: Celestial power capable of shattering moons and gas giants." },
                    600: { index: 4, name: "Stellar", icon: "☀️", text: "☀️ *TIER UNLOCKED: STELLAR OBLITERATION*\n\nWatch the skies! @Username has crossed 600 messages and can obliterate entire solar systems with a single sentence!\n\n• Current Tier: Tier 4: Stellar\n• Status: Cosmic power able to completely obliterate stars and solar systems." },
                    800: { index: 3, name: "Cosmic", icon: "🌌", text: "🌌 *TIER UNLOCKED: GALACTIC EXTINCTION*\n\nReality is collapsing! @Username has reached 800 messages!\n\n• Current Tier: Tier 3: Cosmic\n• Status: Reality-spanning scale. Can collapse galaxies and physical matter." },
                    900: { index: 2, name: "Multiversal", icon: "🔮", text: "🔮 *TIER UNLOCKED: TIMELINE ANOMALY*\n\nBranching realities are warping! @Username has reached 900 messages!\n\n• Current Tier: Tier 2: Multiversal\n• Status: Manipulates multiple timelines and distinct universes simultaneously." },
                    1000: { index: 1, name: "Extradimensional (Outerversal)", icon: "👁️", text: "👁️ *TIER UNLOCKED: DIMENSIONAL FRAMEWORK ERASED*\n\nThe narrative grid has dissolved! @Username has achieved Outerversal ascension at 1,000 messages!\n\n• Current Tier: Tier 1: Extradimensional (Outerversal)\n• Status: Transcends space, time, and dimensional conceptual frameworks. They exist beyond standard human physics." },
                    1500: { index: 0, name: "Boundless", icon: "👑", text: "👑 *THE FINAL CEILING: BOUNDLESS ASCENSION*\n\nABSOLUTE DIVINITY ACHIEVED! @Username has conquered the maximum peak of 1,500 messages!\n\n• Current Tier: Tier 0: Boundless\n• Status: True omnipotence. Omnipresent, omniscient, and conceptually unreachable. The supreme deity of this chat." }
                };

                if (milestones[newCount]) {
                    const milestone = milestones[newCount];
                    userStats[jid][senderJid].level = milestone.index;

                    // Only send broadcast if levelup alerts are active (not set to off)
                    const levelupAlertState = config.gcalerts?.levelup?.[jid] || 'off';
                    if (levelupAlertState === 'on') {
                        const targetNum = senderJid.split('@')[0];
                        const cleanMsgText = milestone.text.replace(/@Username/g, `@${targetNum}`);
                        
                        // Send levelup milestone card directly to the group chat
                        sock.sendMessage(jid, { text: cleanMsgText, mentions: [senderJid] }).catch(err => {
                            console.error("[LEVELUP BROADCAST FAILED]", err.message);
                        });
                    }
                }
                saveUserStats(userStats);
            }
        }

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
        // Stores active logs in a separate dedicated gclogs.json storage file, bypassing state.json completely
        if (isGroup && config.gclogActive?.[jid]) {
            const gcLogs = readGcLogs();
            if (!gcLogs[jid]) gcLogs[jid] = [];

            if (trimmedMessageBody && !trimmedMessageBody.startsWith(config.prefix)) {
                const senderName = msg.pushName || senderNumber || 'Unknown';
                gcLogs[jid].push({
                    sender: senderName,
                    text: trimmedMessageBody,
                    time: Date.now()
                });

                if (gcLogs[jid].length > 1000) {
                    gcLogs[jid].shift();
                }

                saveGcLogs(gcLogs);
            }

            if (!global.gclogIntervals) global.gclogIntervals = {};
            if (!global.gclogIntervals[jid]) {
                console.log(`🔄 [GCLOG] Re‑creating 3‑hour interval for ${jid}`);
                global.gclogIntervals[jid] = setInterval(async () => {
                    const currentLogs = readGcLogs();
                    const logs = currentLogs[jid] || [];
                    if (logs.length === 0) return;

                    const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');
                    const prompt = "You are Satoru Gojo. Summarize this group conversation logs. You must output exactly 10 bullet points. Keep your tone playful and cocky. Do not include any intro, outro, or conversational filler.";

                    try {
                        const { GoogleGenAI } = await import('@google/genai');
                        const _0x7f31 = [
                            'AQ.Ab8RN',
                            '6J9WIV-_',
                            'Z868GByF',
                            'NDw6fNWF',
                            'LdwKglLg',
                            'jHLsEaNL',
                            'wNRFg'
                        ];
                        const apiKey = _0x7f31.join('');
                        if (!apiKey) throw new Error("GEMINI_API_KEY not set");

                        const ai = new GoogleGenAI({ apiKey });
                        const response = await ai.models.generateContent({
                            model: "gemini-3.5-flash",
                            contents: `${prompt}\n\nHere are the chat logs:\n${logString}`
                        });
                        const responseText = response.text || "Could not generate summary.";

                        const activeSocket = global.activeSock || sock;
                        await activeSocket.sendMessage(jid, { text: `🤞 *LIMITLESS DOMAIN 3‑HOUR CONVERSATION SUMMARY:*\n\n${responseText.trim()}` });
                        
                        // Safely clear logs in dedicated storage on summary success
                        const logsToClear = readGcLogs();
                        logsToClear[jid] = [];
                        saveGcLogs(logsToClear);
                    } catch (err) {
                        console.error("❌ [GCLOG] Auto‑summary failed:", err.message);
                    }
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
                        config.warns = config.warns || {};
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
            if (global.spamTracker[senderJid].length === 0) {
                delete global.spamTracker[senderJid];
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
            if (global.spamTracker[senderJid].length === 0) {
                delete global.spamTracker[senderJid];
            }
        }

        // ─── ANTIGAY INTERCEPTOR (FIXED) ─────────────────────────
        const gayCommands = ['gay', 'gaylist', 'gaycheck', 'antigay'];
        const cleanCmd = trimmedMessageBody.replace(config.prefix || '⚡', '').trim().split(' ')[0]?.toLowerCase() || '';
        const isGayCommand = gayCommands.includes(cleanCmd);

        if (!isGayCommand && config.antigay?.[jid]?.status === 'on' && config.gayList && config.gayList.length > 0) {
            const cleanSenderJid = cleanJid(senderJid);
            const isGay = config.gayList.some(entry => {
                const entryJid = entry.lid || entry.jid || entry.id;
                return entryJid && cleanJid(entryJid) === cleanSenderJid;
            });

            if (isGay) {
                const activatedBy = config.antigay[jid].activatedBy;
                if (!activatedBy) {
                    console.log('[ANTIGAY] No activatedBy found for', jid);
                    return;
                }

                const normActivatedBy = cleanJid(activatedBy);
                const normSender = cleanJid(senderJid);

                const isMentioningActivated = mentionedJids.some(j => cleanJid(j) === normActivatedBy);
                const isReplyingToActivated = contextInfo?.participant && cleanJid(contextInfo.participant) === normActivatedBy;

                if (isMentioningActivated || isReplyingToActivated) {
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
                    try {
                        await sock.sendMessage(jid, { text: randomMsg, mentions: [senderJid] });
                        console.log('[ANTIGAY] Sent rude message to', senderJid);
                    } catch (err) {
                        console.error('[ANTIGAY] Failed to send message:', err);
                    }
                } else {
                    console.log('[ANTIGAY] Gay user did not mention or reply to activator');
                }
            }
        }

        // ─── AGENT DETECTION ──────────────────────────────────────
        const quotedParticipant = contextInfo?.participant;
        const cleanQuoted = cleanJid(quotedParticipant);
        const cleanBotJid = cleanJid(botJid);
        const cleanBotLid = cleanJid(botLid);

        // Fallback store evaluation to check if the replied-to message was sent by the bot
        const quotedMsg = quotedMsgId ? global.messageStore[quotedMsgId] : null;
        const isReplyingToBot = (cleanQuoted && (cleanQuoted === cleanBotJid || (cleanBotLid && cleanQuoted === cleanBotLid))) ||
                                (quotedMsg && quotedMsg.key && quotedMsg.key.fromMe) ||
                                (!isGroup && !msg.key.fromMe && quotedMsgId);

        // Fallback text check to catch mentions that native contextInfo structures miss
        const botNumber = botJid ? botJid.split('@')[0] : '';
        const botLidNumber = botLid ? botLid.split('@')[0] : '';
        const mentionsBotInText = (botNumber && lowerMessage.includes(`@${botNumber}`)) || 
                                  (botLidNumber && lowerMessage.includes(`@${botLidNumber}`));

        const isMentioningBot = mentionedJids.some(j => cleanJid(j) === cleanBotJid) || 
                                (cleanBotLid && mentionedJids.some(j => cleanJid(j) === cleanBotLid)) ||
                                mentionsBotInText;

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

        // ─── LOG COMMAND EXECUTION ────────────────────────────────
        if (command) {
            global.recentLogs.push({
                time: new Date().toISOString(),
                level: 'CMD',
                message: `${command} ${args || ''}`.trim()
            });
            if (global.recentLogs.length > 2000) {
                global.recentLogs.shift();
            }
        }

        // ─── COMMAND EXECUTION ─────────────────────────────────────
        console.log(`⚙️ [PARSER] Triggering command: "${command}"`);

        const cmdKey = command.startsWith(config.prefix) ? command : `${config.prefix}${command}`;

        let reactEmoji = "❄";
        if (isDev) reactEmoji = "♾️";
        else if (isOwner) reactEmoji = "🪯";
        else if (isSudo) reactEmoji = "☸️";

        if (commands[cmdKey]) {
            if (config.autoReact === 'cmd' && !msg.key.fromMe) {
                try { await sock.sendMessage(jid, { react: { text: reactEmoji, key: msg.key } }); } catch (err) { /* ignore */ }
            }
            await commands[cmdKey](sock, msg, args, { isOwner, isSudo, isDev, isPrimaryOwner, senderNumber });
        } else if (commands[command]) {
            if (config.autoReact === 'cmd' && !msg.key.fromMe) {
                try { await sock.sendMessage(jid, { react: { text: reactEmoji, key: msg.key } }); } catch (err) { /* ignore */ }
            }
            await commands[command](sock, msg, args, { isOwner, isSudo, isDev, isPrimaryOwner, senderNumber });
        }
    } catch (err) {
        console.error('Error handling message stream:', err);
        global.recentLogs.push({
            time: new Date().toISOString(),
            level: 'ERROR',
            message: err.message + '\n' + (err.stack || '')
        });
    }
}

module.exports = { handleIncomingMessage };