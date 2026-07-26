// plugins/filters.js
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { readFilters, saveFilters, ensureMediaDir, mediaDir } = require('../helpers/FilterManager');

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

async function saveFilterFromMsg(sock, msg, trigger, isGroup) {
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
    const quoted = contextInfo?.quotedMessage;

    if (!quoted) {
        throw new Error("You must reply directly to a message to save it as a filter.");
    }

    const rawContent = getRawMessage(quoted);
    const scopeKey = isGroup ? 'globalGroup' : 'globalPM';
    ensureMediaDir();

    const data = readFilters();
    data[scopeKey] = data[scopeKey] || {};

    const cleanTrigger = trigger.trim().toLowerCase();
    const safeFilename = `filter_${scopeKey}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // 1. Text Message
    const textContent = rawContent?.conversation || rawContent?.extendedTextMessage?.text;
    if (textContent && !rawContent?.imageMessage && !rawContent?.videoMessage && !rawContent?.audioMessage && !rawContent?.stickerMessage && !rawContent?.documentMessage) {
        data[scopeKey][cleanTrigger] = {
            trigger: trigger.trim(),
            type: 'text',
            content: textContent,
            author: msg.pushName || 'User',
            time: Date.now()
        };
        saveFilters(data);
        return;
    }

    // 2. Media Messages
    const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
    let mediaType = null;
    let targetObj = null;
    let ext = 'bin';

    if (rawContent?.imageMessage) {
        mediaType = 'image'; targetObj = rawContent.imageMessage; ext = 'jpg';
    } else if (rawContent?.videoMessage) {
        mediaType = 'video'; targetObj = rawContent.videoMessage; ext = 'mp4';
    } else if (rawContent?.audioMessage) {
        mediaType = 'audio'; targetObj = rawContent.audioMessage; ext = 'mp3';
    } else if (rawContent?.stickerMessage) {
        mediaType = 'sticker'; targetObj = rawContent.stickerMessage; ext = 'webp';
    } else if (rawContent?.documentMessage) {
        mediaType = 'document'; targetObj = rawContent.documentMessage; ext = 'doc';
    }

    if (!mediaType || !targetObj) {
        throw new Error("Unsupported message format.");
    }

    const stream = await downloadContentFromMessage(targetObj, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    const filePath = path.join(mediaDir, `${safeFilename}.${ext}`);
    fs.writeFileSync(filePath, buffer);

    data[scopeKey][cleanTrigger] = {
        trigger: trigger.trim(),
        type: mediaType,
        filePath: filePath,
        mimetype: targetObj.mimetype || '',
        caption: targetObj.caption || '',
        fileName: targetObj.fileName || '',
        ptt: targetObj.ptt || false,
        author: msg.pushName || 'User',
        time: Date.now()
    };

    saveFilters(data);
}

module.exports = [
    // 1. GFILTER (Global Groups)
    {
        name: 'gfilter',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) {
                return await sock.sendMessage(jid, { text: "❌ `.gfilter` can only be set inside Group Chats." }, { quoted: msg });
            }

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) {
                return await sock.sendMessage(jid, { text: "❌ Only Group Admins or Bot Owners can configure group filters." }, { quoted: msg });
            }

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ *Format:* Reply to a message with \`${config.prefix}gfilter <trigger_phrase>\`\nExample: Reply to an image with \`${config.prefix}gfilter hi\`` }, { quoted: msg });
            }

            try {
                await saveFilterFromMsg(sock, msg, args.trim(), true);
                await sock.sendMessage(jid, { text: `✅ *Global Group Filter Saved!* \n\nWhenever anyone types \`"${args.trim()}"\` in *ANY group chat*, I will respond with this message.` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to save filter: ${err.message}` }, { quoted: msg });
            }
        }
    },

    // 2. PFILTER (Global PMs)
    {
        name: 'pfilter',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (jid.endsWith('@g.us')) {
                return await sock.sendMessage(jid, { text: "❌ `.pfilter` can only be set in Private Direct Messages." }, { quoted: msg });
            }

            if (!isOwner && !isDev) return;

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ *Format:* Reply to a message with \`${config.prefix}pfilter <trigger_phrase>\`` }, { quoted: msg });
            }

            try {
                await saveFilterFromMsg(sock, msg, args.trim(), false);
                await sock.sendMessage(jid, { text: `✅ *Global PM Filter Saved!* \n\nWhenever anyone types \`"${args.trim()}"\` in *ANY direct message*, I will respond with this message.` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to save PM filter: ${err.message}` }, { quoted: msg });
            }
        }
    },

    // 3. FILTERS (List active filters)
    {
        name: 'filters',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const scopeKey = isGroup ? 'globalGroup' : 'globalPM';
            const scopeName = isGroup ? 'GROUP' : 'PM';

            const data = readFilters();
            const chatFilters = data[scopeKey] || {};
            const keys = Object.keys(chatFilters);

            if (keys.length === 0) {
                return await sock.sendMessage(jid, { text: `📋 *No active global ${scopeName} filters configured.*` }, { quoted: msg });
            }

            let response = `📋 *ACTIVE GLOBAL ${scopeName} FILTERS* 📋\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            keys.forEach((k, idx) => {
                const item = chatFilters[k];
                response += `${idx + 1}. *"${item.trigger}"* (${item.type.toUpperCase()})\n   _Saved by:_ ${item.author}\n\n`;
            });
            response += `👉 To delete a filter, use: \`${config.prefix}delfilter <trigger>\``;

            await sock.sendMessage(jid, { text: response }, { quoted: msg });
        }
    },

    // 4. DELFILTER (Delete filter)
    {
        name: 'delfilter',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (isGroup && (!isOwner && !isSudo && !isDev && !isAdmin)) return;
            if (!isGroup && (!isOwner && !isDev)) return;

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ *Usage:* \`${config.prefix}delfilter <trigger_phrase>\`` }, { quoted: msg });
            }

            const targetTrigger = args.trim().toLowerCase();
            const scopeKey = isGroup ? 'globalGroup' : 'globalPM';

            const data = readFilters();
            const chatFilters = data[scopeKey];

            if (!chatFilters || !chatFilters[targetTrigger]) {
                return await sock.sendMessage(jid, { text: `❌ No active filter found matching \`"${args.trim()}"\`.` }, { quoted: msg });
            }

            const filterObj = chatFilters[targetTrigger];

            if (filterObj.filePath && fs.existsSync(filterObj.filePath)) {
                try { fs.unlinkSync(filterObj.filePath); } catch (e) { /* ignore */ }
            }

            delete data[scopeKey][targetTrigger];
            saveFilters(data);

            await sock.sendMessage(jid, { text: `✅ Filter \`"${filterObj.trigger}"\` deleted successfully.` }, { quoted: msg });
        }
    }
];