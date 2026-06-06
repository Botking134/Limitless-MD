// plugins/tools.js
const settings = require('../settings');
const path = require('path');

module.exports = [
    // 1. SET BOT PROFILE PICTURE (.setpp) [Mission 3]
    {
        name: 'setpp',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;

            // Strict Security Guard: Only Owners and Developers
            if (!isOwner && !isDev) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted || !quoted.imageMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to an image to set it as the bot's profile picture." }, { quoted: msg });
            }

            try {
                // Dynamically import stream downloader
                const { downloadContentFromMessage } = require('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Updating bot profile picture... 🖼️" }, { quoted: msg });

                const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Resolve Bot's standard JID
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                // Update Profile Picture on Bot's number
                await sock.updateProfilePicture(botJid, buffer);

                await sock.sendMessage(jid, { text: "✅ Satoru Gojo's visual profile has been updated successfully!" }, { quoted: msg });
            } catch (error) {
                console.error("SetPP Command Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to update profile picture: ${error.message}` }, { quoted: msg });
            }
        }
    }
];