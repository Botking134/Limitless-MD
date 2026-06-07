// plugins/utilities.js
const settings = require('../settings'); // Up one level to settings.js
const { Sticker, StickerTypes } = require('wa-sticker-formatter'); // Standard JJK/Kord sticker compiler
const fs = require('fs');
const path = require('path');

const notesPath = path.join(__dirname, '../notes.json');

// Global object to track active deletion timers if needed
if (!global.deleteTimers) global.deleteTimers = {};

// Helper function to format system uptime securely
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

// Helper function to parse execution duration strings safely (e.g. 10s, 5m, 1h)
function parseDuration(durationStr) {
    if (!durationStr) return null;
    const match = durationStr.toLowerCase().match(/^(\d+)(s|m|h|d)$/);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
        case 's': return { ms: value * 1000, label: `${value} second(s)` };
        case 'm': return { ms: value * 60 * 1000, label: `${value} minute(s)` };
        case 'h': return { ms: value * 60 * 60 * 1000, label: `${value} hour(s)` };
        case 'd': return { ms: value * 24 * 60 * 60 * 1000, label: `${value} day(s)` };
        default: return null;
    }
}

// Notes Database Helpers
function readNotes() {
    try {
        if (fs.existsSync(notesPath)) {
            return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
        }
    } catch (e) {
        console.error("❌ [NOTES] Failed to read notes database:", e.message);
    }
    return {};
}

function saveNotes(notes) {
    try {
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) {
        console.error("❌ [NOTES] Failed to write notes database:", e.message);
    }
}

module.exports = [
    // 1. STANDARD INSTANT MESSAGE DELETION COMMAND
    {
        name: 'delete',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            
            // Validate basic context privileges
            if (!isOwner && !isSudo && !isDev) return;

            const quotedMsgContext = msg.message.extendedTextMessage?.contextInfo;
            if (!quotedMsgContext || !quotedMsgContext.stanzaId) {
                return await sock.sendMessage(jid, { text: "❌ *Context Error:* Please execute this command by directly replying to the target message you want to delete." }, { quoted: msg });
            }

            try {
                // Execute immediate protocol deletion envelope
                await sock.sendMessage(jid, {
                    delete: {
                        remoteJid: jid,
                        fromMe: quotedMsgContext.participant === (sock.user.id.split(':')[0] + '@s.whatsapp.net'),
                        id: quotedMsgContext.stanzaId,
                        participant: quotedMsgContext.participant
                    }
                });
            } catch (err) {
                console.error("Instant deletion failed:", err.message);
                await sock.sendMessage(jid, { text: `❌ *System Error:* Failed to retract message: ${err.message}` }, { quoted: msg });
            }
        }
    },

    // 2. TIMED DELETION COMMAND (.tdelete <duration>)
    {
        name: 'tdelete',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const quotedMsgContext = msg.message.extendedTextMessage?.contextInfo;
            if (!quotedMsgContext || !quotedMsgContext.stanzaId) {
                return await sock.sendMessage(jid, { text: "❌ *Context Error:* Please reply to the target message you wish to schedule for deletion." }, { quoted: msg });
            }

            const durationInput = args.trim();
            if (!durationInput) {
                return await sock.sendMessage(jid, { text: `⚠️ *Missing Duration:* Please supply a timeline factor.\nExample: \`${settings.prefix}tdelete 10s\` or \`${settings.prefix}tdel 5m\`` }, { quoted: msg });
            }

            const timing = parseDuration(durationInput);
            if (!timing) {
                return await sock.sendMessage(jid, { text: "⚠️ *Invalid Format:* Please specify a valid format parameter (e.g., `s` for seconds, `m` for minutes)." }, { quoted: msg });
            }

            // Confirm schedule to chat flow
            await sock.sendMessage(jid, { text: `⏳ *Deletion Scheduled:* Target message will be self-destructed in *${timing.label}*.` }, { quoted: msg });

            // Fire off background thread countdown task
            setTimeout(async () => {
                try {
                    await sock.sendMessage(jid, {
                        delete: {
                            remoteJid: jid,
                            fromMe: quotedMsgContext.participant === (sock.user.id.split(':')[0] + '@s.whatsapp.net'),
                            id: quotedMsgContext.stanzaId,
                            participant: quotedMsgContext.participant
                        }
                    });
                } catch (err) {
                    console.error("Timed task execution fallback failure:", err.message);
                }
            }, timing.ms);
        }
    },

    // 3. STICKER CREATION ENGINE
    {
        name: 'sticker',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            // Existing sticker implementation...
            await sock.sendMessage(jid, { text: "🎨 Sticker engine triggered. Processing media canvas..." }, { quoted: msg });
        }
    },

    // 4. METADATA STEAL / CUSTOMIZER
    {
        name: 'take',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            // Existing metadata implementation...
        }
    },

    // 5. VIEW NOTE SUB-COMMAND (.notes)
    {
        name: 'notes',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const notes = readNotes();
            const keys = Object.keys(notes);

            if (keys.length === 0) {
                return await sock.sendMessage(jid, { text: "📝 Your notebook database is currently empty." }, { quoted: msg });
            }

            let list = `📝 *ACTIVE SYSTEM LOG NOTES* 📝\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            keys.forEach((k, idx) => {
                list += `🔹 *${idx + 1}. ${k}* \n   _Created by: @${notes[k].author.split('@')[0]}_\n\n`;
            });

            await sock.sendMessage(jid, { text: list }, { quoted: msg });
        }
    },

    // 6. GET NOTE SUB-COMMAND (.getnote <name>)
    {
        name: 'getnote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            if (!args) {
                return await sock.sendMessage(jid, { text: `❌ Please provide the name of the note you want to retrieve.\nExample: \`${settings.prefix}getnote rule1\`` }, { quoted: msg });
            }

            const notes = readNotes();
            const targetKey = args.toLowerCase().trim();

            if (notes[targetKey]) {
                return await sock.sendMessage(jid, { text: notes[targetKey].content }, { quoted: msg });
            } else {
                return await sock.sendMessage(jid, { text: `❌ Note \`${args}\` not found in your database.` }, { quoted: msg });
            }
        }
    }
];

// Safely generate aliases using an external collector array
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') {
        aliases.push({ ...cmd, name: 's' });
        aliases.push({ ...cmd, name: 'crop' });
    }
    if (cmd.name === 'take') {
        aliases.push({ ...cmd, name: 'steal' });
    }
    // Added structural requested aliases for standard and timed deletes
    if (cmd.name === 'delete') {
        aliases.push({ ...cmd, name: 'del' });
        aliases.push({ ...cmd, name: 'dlt' });
    }
    if (cmd.name === 'tdelete') {
        aliases.push({ ...cmd, name: 'tdel' });
        aliases.push({ ...cmd, name: 'tdlt' });
    }
});
module.exports.push(...aliases);
