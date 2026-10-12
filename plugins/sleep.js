// plugins/sleep.js
// .sleep - the bot stops responding in THIS chat (the process keeps running).
// .wake  - the bot responds again.
//
// State lives in config.sleepChats, a per-bot dynamic key, so putting the main
// bot to sleep never silences a sub-bot (and vice versa). The actual silencing
// happens at the top of helpers/Infinity.js, which drops every message in a
// sleeping chat except the wake command.

const config = require('../config');
const { saveState } = require('../stateManager');

const canControl = ({ isOwner, isSudo, isDev, isAdmin }) => !!(isOwner || isSudo || isDev || isAdmin);

module.exports = [
    {
        name: 'sleep',
        isPrefixless: false,
        category: 'tools',
        description: 'Put the bot to sleep in this chat until .wake',
        execute: async (sock, msg, args, ctx) => {
            const jid = msg.key.remoteJid;

            if (!canControl(ctx || {})) {
                return await sock.sendMessage(jid, { text: "❌ Only the owner, sudo users or group admins can put me to sleep." }, { quoted: msg });
            }

            const current = Array.isArray(config.sleepChats) ? config.sleepChats : [];
            if (current.includes(jid)) return;

            await sock.sendMessage(jid, {
                text: `😴 *Going to sleep in this chat.*\n_I won't respond here until you type_ \`${config.prefix}wake\`_._`
            }, { quoted: msg });

            // Assign a new array: sub-bots without their own settings share the default one.
            config.sleepChats = [...current, jid];
            saveState();
        }
    },
    {
        name: 'wake',
        isPrefixless: false,
        category: 'tools',
        description: 'Wake the bot up in this chat after .sleep',
        execute: async (sock, msg, args, ctx) => {
            const jid = msg.key.remoteJid;

            // Stay silent for anyone who can't wake it, so a sleeping bot stays quiet.
            if (!canControl(ctx || {})) return;

            const current = Array.isArray(config.sleepChats) ? config.sleepChats : [];
            if (!current.includes(jid)) {
                return await sock.sendMessage(jid, { text: "☀️ I'm already awake." }, { quoted: msg });
            }

            config.sleepChats = current.filter(j => j !== jid);
            saveState();

            await sock.sendMessage(jid, { text: "☀️ *I'm awake.* Back in action." }, { quoted: msg });
        }
    }
];
