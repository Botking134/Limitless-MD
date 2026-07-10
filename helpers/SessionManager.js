// helpers/SessionManager.js
const config = require('../config');
// CIRCULAR DEPENDENCY FIX: Only import normalizeToJid here.
// saveState is loaded dynamically inside the functions when needed.
const { normalizeToJid } = require('../stateManager');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Added for API and sticker downloads

const remindersPath = path.join(__dirname, '../storage/reminders.json');
const notesPath = path.join(__dirname, '../storage/notes.json');

// ─── SAFE GLOBAL REGISTRY INITIALIZERS ─────────────────────────
global.songSessions = global.songSessions || {};
global.tgsSessions = global.tgsSessions || {};
global.lyricsSessions = global.lyricsSessions || {};
global.xvidSessions = global.xvidSessions || {};
global.noteSessions = global.noteSessions || {};
global.reminderSessions = global.reminderSessions || {};
global.azaSessions = global.azaSessions || {};
global.cancelSessions = global.cancelSessions || {};
global.forwardSessions = global.forwardSessions || {};

// Helper to fetch files as buffers safely
async function fetchBuffer(url) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
}

// ─── DECOUPLED REMINDERS STORAGE HANDLERS ───────────────────────

function readReminders() {
    try {
        if (fs.existsSync(remindersPath)) {
            const data = JSON.parse(fs.readFileSync(remindersPath, 'utf-8'));
            if (Array.isArray(data)) return data; 
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

// ─── DECOUPLED STICKY NOTES STORAGE HANDLERS ─────────────────────

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

// ─── STICKY NOTE SESSION HANDLER ─────────────────────────────────
async function handleNoteSession(sock, msg) {
    try {
        const jid = msg.key.remoteJid;
        const rawContent = getRawMessage(msg.message);
        const text = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
        
        const contextInfo = rawContent?.extendedTextMessage?.contextInfo ||
                            rawContent?.contextInfo ||
                            msg.message?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;

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

// ─── AFK DEACTIVATION INTERCEPTOR ──────────────────────────────
async function handleAfkDeactivation(sock, msg) {
    const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
    if (!senderJid) return false;

    if (config.afk && config.afk[senderJid]) {
        delete config.afk[senderJid];
        
        // LAZY-LOADING FIX: Prevent circular dependency loop crash
        require('../stateManager').saveState();

        await sock.sendMessage(msg.key.remoteJid, {
            text: `👋 *Welcome back!* Your AFK mode has been deactivated.`
        }, { quoted: msg });
        return true;
    }
    return false;
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
        setTimeout(() => {
            if (registry[promptId]) delete registry[promptId];
        }, 5 * 60 * 1000); 
    }
}

// ─── INTERACTIVE REPLY WIZARDS INTERCEPTOR ──────────────────────

async function handleInteractiveSessions(sock, msg, text, quotedMsgId, jid) {
    if (!quotedMsgId) return false;

    // Defensive mapping to safeguard against undefined/type trim errors on media payloads
    const messageText = (text || '').trim();

    // ─── AZA SESSION ───────────────────────────────────────────
    if (global.azaSessions && global.azaSessions[quotedMsgId]) {
        try {
            const session = global.azaSessions[quotedMsgId];
            if (session.step === 1) {
                const account = messageText;
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
                const bank = messageText;
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
                const name = messageText;
                if (!name) {
                    await sock.sendMessage(jid, { text: "❌ Account name cannot be empty. Please try again." });
                    return true;
                }
                config.aza = { set: true, account: session.account, bank: session.bank, name: name };
                
                // LAZY-LOADING FIX: Prevent circular dependency loop crash
                require('../stateManager').saveState();

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
            const title = messageText;
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
            const num = parseInt(messageText);
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

    // ─── FORWARD SESSION (Fixed native copyNForward payload delivery) ──
    if (global.forwardSessions && global.forwardSessions[quotedMsgId]) {
        try {
            const target = messageText;
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

// ─── STABLE DOWNLOADER SESSION REPLIES ───────────────────────────

// Safe split image/caption + audio reply handler
async function handleSongReply(sock, msg, session, text) {
    const jid = msg.key.remoteJid;
    const num = parseInt(text.trim());
    if (isNaN(num)) return;

    const song = session.results[num - 1];
    if (!song) return;

    await sock.sendMessage(jid, { text: "⏳ Downloading and preparing your audio..." }, { quoted: msg });

    try {
        // FIX: Replaced custom missing function extractDownloadUrl with a robust fallback checks to prevent ReferenceErrors
        const downloadUrl = song.download_url || song.download || song.url || song.link || '';
        if (!downloadUrl) throw new Error('No download link found');

        const audioBuffer = await fetchBuffer(downloadUrl);
        let thumbBuffer = null;
        if (song.thumbnail) {
            try { 
                thumbBuffer = await fetchBuffer(song.thumbnail); 
            } catch (e) {
                console.log("[Song Reply] Could not download thumbnail.");
            }
        }

        // 1. Send the thumbnail first as a standalone image message with song details
        if (thumbBuffer) {
            const caption = `🎵 *${song.title}*\n👤 *Artist:* ${song.artist || 'Limitless Music'}\n⏱️ *Duration:* ${song.duration || 'N/A'}`;
            await sock.sendMessage(jid, { image: thumbBuffer, caption: caption }, { quoted: msg });
        }

        // 2. Send the raw audio block separately to avoid WhatsApp Messenger layout errors
        await sock.sendMessage(jid, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            ptt: false
        }, { quoted: msg });

    } catch (err) {
        console.error('[Song Reply Error]:', err.message);
        await sock.sendMessage(jid, { text: `❌ Download failed: ${err.message}` }, { quoted: msg });
    }
}

// Safe WebP static-only sticker downloader reply handler
async function handleTgsReply(sock, msg, session, text) {
    const jid = msg.key.remoteJid;
    const num = parseInt(text.trim());
    if (isNaN(num)) return;

    const stickers = session.stickers || [];
    if (num < 1 || num > stickers.length) {
        return await sock.sendMessage(jid, { 
            text: `❌ Invalid choice. Please reply with a number between 1 and ${stickers.length}.` 
        }, { quoted: msg });
    }

    const sticker = stickers[num - 1];
    if (!sticker) return;

    // Filter out animated/video stickers immediately to prevent server crashes
    if (sticker.is_animated || sticker.is_video) {
        return await sock.sendMessage(jid, { 
            text: "❌ Animated and video stickers are currently not supported. Please choose a static (non-animated) sticker from the list." 
        }, { quoted: msg });
    }

    await sock.sendMessage(jid, { text: "⏳ Fetching sticker from Telegram..." }, { quoted: msg });

    try {
        const token = session.token;
        
        // Fetch filePath from Telegram API
        const fileResponse = await axios.get(`https://api.telegram.org/bot${token}/getFile?file_id=${sticker.file_id}`);
        const fileData = fileResponse.data;
        if (!fileData.ok) {
            throw new Error(fileData.description || 'Failed to locate file path.');
        }

        const filePath = fileData.result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

        // Download WebP buffer
        const stickerResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(stickerResponse.data);

        // Deliver native WebP sticker to WhatsApp
        await sock.sendMessage(jid, { sticker: buffer }, { quoted: msg });

    } catch (err) {
        console.error('[TGS Reply Error]:', err.message);
        await sock.sendMessage(jid, { 
            text: `❌ Failed to download and send sticker: ${err.message}` 
        }, { quoted: msg });
    }
}

// ─── GET RAW MESSAGE FALLBACK ────────────────────────────────────
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

module.exports = {
    readReminders,
    saveReminders,
    registerSession,
    handleInteractiveSessions,
    handleDownloaderSessions,
    handleAfkDeactivation,
    handleNoteSession,
    handleSongReply, // Exported to use in commands
    handleTgsReply  // Exported to use in commands
};