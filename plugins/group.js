// plugins/group.js
const settings = require('../settings'); 
const { saveSettings } = require('../helpers/settingsSaver'); 
const { saveState } = require('../stateManager'); 

function parseTarget(msg, args) {
    const getRawMessage = (message) => {
        if (!message) return null;
        if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
        if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
        if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
        if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
        if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
        return message;
    };

    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || 
                        rawMsg?.extendedTextMessage?.contextInfo || 
                        rawMsg?.imageMessage?.contextInfo || 
                        rawMsg?.videoMessage?.contextInfo || 
                        rawMsg?.stickerMessage?.contextInfo || 
                        rawMsg?.audioMessage?.contextInfo || 
                        rawMsg?.documentMessage?.contextInfo;

    const quotedParticipant = contextInfo?.participant;
    let target = '';

    if (quotedParticipant) {
        target = quotedParticipant.split('@')[0].split(':')[0];
    } else if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
        const botJid = settings.botJid || '';
        const filteredMention = contextInfo.mentionedJid.find(jid => !jid.includes(botJid));
        const selectedJid = filteredMention || contextInfo.mentionedJid[0];
        target = selectedJid.split('@')[0].split(':')[0];
    } else if (args) {
        target = args.replace(/[^0-9]/g, '');
    }
    return target;
}

module.exports = [
    // 1. PROMOTE COMMAND
    {
        name: 'promote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];

            try {
                const metadata = await sock.groupMetadata(jid);
                const participants = metadata.participants || [];
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                
                const isBotAdmin = participants.find(p => p.id.split(':')[0] + '@s.whatsapp.net' === botJid)?.admin;
                const isSenderAdmin = participants.find(p => p.id.split('@')[0].split(':')[0] === senderNumber)?.admin || isOwner || isSudo || isDev;

                if (!isBotAdmin) return await sock.sendMessage(jid, { text: "❌ I need to be an administrator to perform this action." }, { quoted: msg });
                if (!isSenderAdmin) return await sock.sendMessage(jid, { text: "❌ This command is restricted to administrators." }, { quoted: msg });

                const targetNumber = parseTarget(msg, args);
                if (!targetNumber) return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user (@user), or type their number." }, { quoted: msg });

                const targetJid = targetNumber + '@s.whatsapp.net';
                await sock.groupParticipantsUpdate(jid, [targetJid], "promote");
                await sock.sendMessage(jid, { text: `👑 @${targetNumber} promoted to Admin!`, mentions: [targetJid] }, { quoted: msg });
            } catch (e) {
                console.error("Promote Error:", e.message);
            }
        }
    },

    // 2. KICK COMMAND
    {
        name: 'kick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];

            try {
                const metadata = await sock.groupMetadata(jid);
                const participants = metadata.participants || [];
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                
                const isBotAdmin = participants.find(p => p.id.split(':')[0] + '@s.whatsapp.net' === botJid)?.admin;
                const isSenderAdmin = participants.find(p => p.id.split('@')[0].split(':')[0] === senderNumber)?.admin || isOwner || isSudo || isDev;

                if (!isBotAdmin) return await sock.sendMessage(jid, { text: "❌ I need to be an administrator to perform this action." }, { quoted: msg });
                if (!isSenderAdmin) return await sock.sendMessage(jid, { text: "❌ This command is restricted to administrators." }, { quoted: msg });

                const targetNumber = parseTarget(msg, args);
                if (!targetNumber) return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user (@user), or type their number." }, { quoted: msg });

                const targetJid = targetNumber + '@s.whatsapp.net';
                await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                await sock.sendMessage(jid, { text: `👋 Exorcised @${targetNumber} from this domain.`, mentions: [targetJid] }, { quoted: msg });
            } catch (e) {
                console.error("Kick Error:", e.message);
            }
        }
    },

    // 3. DEMOTE COMMAND
    {
        name: 'demote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];

            try {
                const metadata = await sock.groupMetadata(jid);
                const participants = metadata.participants || [];
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                
                const isBotAdmin = participants.find(p => p.id.split(':')[0] + '@s.whatsapp.net' === botJid)?.admin;
                const isSenderAdmin = participants.find(p => p.id.split('@')[0].split(':')[0] === senderNumber)?.admin || isOwner || isSudo || isDev;

                if (!isBotAdmin) return await sock.sendMessage(jid, { text: "❌ I need to be an administrator to perform this action." }, { quoted: msg });
                if (!isSenderAdmin) return await sock.sendMessage(jid, { text: "❌ This command is restricted to administrators." }, { quoted: msg });

                const targetNumber = parseTarget(msg, args);
                if (!targetNumber) return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user (@user), or type their number." }, { quoted: msg });

                const targetJid = targetNumber + '@s.whatsapp.net';
                await sock.groupParticipantsUpdate(jid, [targetJid], "demote");
                await sock.sendMessage(jid, { text: `🛡️ @${targetNumber} demoted back to Member.`, mentions: [targetJid] }, { quoted: msg });
            } catch (e) {
                console.error("Demote Error:", e.message);
            }
        }
    },

    // 4. TAGALL COMMAND
    {
        name: 'tagall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];

            try {
                const metadata = await sock.groupMetadata(jid);
                const participants = metadata.participants || [];
                const isSenderAdmin = participants.find(p => p.id.split('@')[0].split(':')[0] === senderNumber)?.admin || isOwner || isSudo || isDev;

                if (!isSenderAdmin) return await sock.sendMessage(jid, { text: "❌ This command is restricted to administrators." }, { quoted: msg });

                let list = `📢 *ATTENTION EVERYONE* 📢\n\n`;
                if (args) list += `📝 *Note:* _${args}_\n\n`;

                const mentions = [];
                participants.forEach(p => {
                    list += `• @${p.id.split('@')[0].split(':')[0]}\n`;
                    mentions.push(p.id);
                });

                await sock.sendMessage(jid, { text: list, mentions: mentions }, { quoted: msg });
            } catch (e) {}
        }
    },

    // 5. TAG COMMAND
    {
        name: 'tag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0].split(':')[0];

            try {
                const metadata = await sock.groupMetadata(jid);
                const participants = metadata.participants || [];
                const isSenderAdmin = participants.find(p => p.id.split('@')[0].split(':')[0] === senderNumber)?.admin || isOwner || isSudo || isDev;

                if (!isSenderAdmin) return await sock.sendMessage(jid, { text: "❌ This command is restricted to administrators." }, { quoted: msg });

                const text = args || "Ping! ⚡";
                const mentions = participants.map(p => p.id);

                await sock.sendMessage(jid, { text: text, mentions: mentions });
            } catch (e) {}
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'tagall') aliases.push({ ...cmd, name: 'everyone' });
    if (cmd.name === 'kick') aliases.push({ ...cmd, name: 'remove' });
});
module.exports.push(...aliases);