// plugins/group.js
const settings = require('../settings'); // Up one level to settings.js
const { saveSettings } = require('../settingsSaver'); // Save straight to settings.js
const commands = require('../commands'); // Access command registry for redirection

// Timed tasks, group status, and mass-actions storage
if (!global.tkickTimers) global.tkickTimers = {};
if (!global.kickallActive) global.kickallActive = {};
if (!global.groupTimers) global.groupTimers = {};

// Reusable Helper to resolve any JID (such as LID) to standard Phone format
async function resolveToPhoneJid(sock, jid) {
    if (!jid) return '';
    if (jid.endsWith('@s.whatsapp.net')) return jid;
    if (jid.endsWith('@lid')) {
        try {
            const res = await sock.findUserId(jid);
            if (res && res.phoneNumber) {
                return res.phoneNumber;
            }
        } catch (e) {
            console.error("Failed to resolve LID JID to Phone:", e.message);
        }
    }
    const num = jid.split('@')[0].split(':')[0];
    return `${num}@s.whatsapp.net`;
}

// Reusable Helper to verify if the sender has admin/owner rights (LID-Safe)
async function verifyPermissions(sock, msg, jid, isOwner) {
    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants;

    const senderJid = msg.key.participant || msg.key.remoteJid || '';
    
    let sender = participants.find(p => p.id === senderJid);
    if (!sender && msg.key.hasLid) {
        sender = participants.find(p => p.id.split('@')[0] === senderJid.split('@')[0]);
    }

    const isSenderAdmin = sender ? (sender.admin !== null) : false;
    return isOwner || isSenderAdmin;
}

// Helper function to parse execution duration strings safely (e.g. 30m, 2h, 1d)
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

module.exports = [
    // 1. DYNAMIC MUTE/GMODE SWITCH WITH INTERACTIVE BUTTONS
    {
        name: 'mute',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return;

            const input = args.trim().toLowerCase();

            // Clear existing timers if status changes manually
            if (global.groupTimers[jid]) {
                clearTimeout(global.groupTimers[jid]);
                delete global.groupTimers[jid];
            }

            // Case A: Handling timed duration directly (.mute 1h)
            if (input && input !== 'open' && input !== 'close' && input !== 'lock' && input !== 'unlock') {
                const timing = parseDuration(input);
                if (!timing) {
                    return await sock.sendMessage(jid, { text: `⚠️ *Invalid Format:* Please specify a valid duration string.\nExample: \`${settings.prefix}mute 45m\` or \`${settings.prefix}mute 2h\`` }, { quoted: msg });
                }

                await sock.groupSettingUpdate(jid, 'announcement');
                await sock.sendMessage(jid, { text: `🔒 *Group Muted:* Only administrators can send messages for the next *${timing.label}*.` });

                global.groupTimers[jid] = setTimeout(async () => {
                    await sock.groupSettingUpdate(jid, 'not_announcement');
                    await sock.sendMessage(jid, { text: `🔓 *Timer Expired:* Group has been automatically unmuted. All members can now send messages.` });
                    delete global.groupTimers[jid];
                }, timing.ms);

                return;
            }

            // Case B: Static execution or interactive toggle options (.mute)
            if (input === 'close' || input === 'lock') {
                await sock.groupSettingUpdate(jid, 'announcement');
                return await sock.sendMessage(jid, { text: `🔒 *Group Status Update:* Chat successfully locked. Only admins can send messages.` }, { quoted: msg });
            } 
            
            if (input === 'open' || input === 'unlock') {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                return await sock.sendMessage(jid, { text: `🔓 *Group Status Update:* Chat successfully unlocked. All participants can send messages.` }, { quoted: msg });
            }

            // If no arguments provided, send interactive button toggles
            const groupMetadata = await sock.groupMetadata(jid);
            const isCurrentlyMuted = groupMetadata.announce === true || groupMetadata.announce === 'true';

            const sections = [
                {
                    title: "🔒 Group Moderation Controls",
                    rows: [
                        { title: "Open Group Chat", rowId: `${settings.prefix}mute open`, description: "Allows all participants to send messages." },
                        { title: "Close Group Chat", rowId: `${settings.prefix}mute close`, description: "Restricts messaging strictly to admins." }
                    ]
                }
            ];

            const listMessage = {
                text: `🛡️ *${settings.botName.toUpperCase()} GROUP CONTROLS*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `👥 *Group:* ${groupMetadata.subject}\n` +
                      `📊 *Current Status:* ${isCurrentlyMuted ? '🔒 ADMINS ONLY' : '🔓 OPEN TO ALL'}\n\n` +
                      `Select an automated switch option below to change the live message stream parameters:`,
                footer: "Limitless Automation Control Engine",
                buttonText: "⚡ Toggle Status",
                sections
            };

            await sock.sendMessage(jid, listMessage, { quoted: msg });
        }
    },

    // 2. FETCH GROUP JID COMMAND
    {
        name: 'gcjid',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ *Error:* This command can only be executed within a group chat environment." }, { quoted: msg });
            }

            const groupMetadata = await sock.groupMetadata(jid);
            const jidReport = `🧬 *GROUP IDENTIFIER INTEL* 🧬\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `👥 *Group Name:* ${groupMetadata.subject}\n` +
                              `🆔 *Group JID:* \`${jid}\`\n\n` +
                              `_Tip: You can copy this JID string directly to target this group file parameters for features like Anti-delete logging or targeting modules customly._`;

            await sock.sendMessage(jid, { text: jidReport }, { quoted: msg });
        }
    },

    // 3. STANDARD ADMIN KICK COMMAND
    {
        name: 'kick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return;

            // Target Parser Logic
            let target = '';
            const quotedMsg = msg.message.extendedTextMessage?.contextInfo;
            if (quotedMsg?.participant) {
                target = quotedMsg.participant;
            } else if (quotedMsg?.mentionedJid?.length > 0) {
                target = quotedMsg.mentionedJid[0];
            } else if (args) {
                target = args.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            }

            if (!target) {
                return await sock.sendMessage(jid, { text: "❌ Please mention, reply to, or enter the number of the user you want to kick." }, { quoted: msg });
            }

            try {
                const phoneJid = await resolveToPhoneJid(sock, target);
                await sock.groupParticipantsUpdate(jid, [phoneJid], 'remove');
                await sock.sendMessage(jid, { text: `🎯 Successfully removed @${phoneJid.split('@')[0]} from the group database.`, mentions: [phoneJid] }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to execute user termination sequence: ${err.message}` }, { quoted: msg });
            }
        }
    },

    // 4. AUTOMATED KICK-ALL MEMBERS CRITICAL ROUTINE
    {
        name: 'kickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us') || !isOwner) return;

            if (args.trim().toLowerCase() !== 'confirm') {
                return await sock.sendMessage(jid, { text: `⚠️ *CRITICAL WARNING:* This command will purge *ALL NON-ADMIN MEMBERS* from this group.\n\nTo proceed, execute:\n\`${settings.prefix}kickall confirm\`` }, { quoted: msg });
            }

            try {
                const metadata = await sock.groupMetadata(jid);
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                
                // Isolate non-admin elements
                const targets = metadata.participants
                    .filter(p => p.admin === null && p.id !== botJid)
                    .map(p => p.id);

                if (targets.length === 0) {
                    return await sock.sendMessage(jid, { text: "ℹ️ No non-admin members found inside group tree." }, { quoted: msg });
                }

                await sock.sendMessage(jid, { text: `☣️ *Mass Evacuation Initiated:* Removing ${targets.length} member(s) from runtime session...` });
                
                global.kickallActive[jid] = true;
                for (const target of targets) {
                    if (!global.kickallActive[jid]) break; // Break out if cancellation flag trips
                    const cleanPhone = await resolveToPhoneJid(sock, target);
                    await sock.groupParticipantsUpdate(jid, [cleanPhone], 'remove');
                    await new Promise(r => setTimeout(r, 1000)); // Rate limits delay
                }

                await sock.sendMessage(jid, { text: "✅ Group file cleanup sequence finalized completely." });
                delete global.kickallActive[jid];
            } catch (e) {
                console.error(e);
            }
        }
    }
];

// Add structural aliases and routing triggers dynamically
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'mute') {
        aliases.push({ ...cmd, name: 'open' });
        aliases.push({ ...cmd, name: 'close' });
        aliases.push({ ...cmd, name: 'lock' });
        aliases.push({ ...cmd, name: 'unlock' });
    }
});
module.exports.push(...aliases);
