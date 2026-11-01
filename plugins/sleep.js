// plugins/sleep.js
// .sleep (💤) / .-s (😴) - the bot stops responding in THIS chat (the process keeps running).
// .wake  (🥷) / .-w (✨) - the bot responds again.
//
// No messages: the bot just reacts to the command message.
// State lives in config.sleepChats, a per-bot dynamic key, so putting the main
// bot to sleep never silences a sub-bot (and vice versa). The actual silencing
// happens at the top of helpers/Infinity.js, which drops every message in a
// sleeping chat except the wake commands.
//
// Order matters: a sleeping chat swallows everything the bot sends (helpers/SleepGate.js),
// so the sleep reaction goes out BEFORE the chat is put to sleep, and the wake reaction
// goes out AFTER it is woken.

const config = require('../config');
const { saveState } = require('../stateManager');

const canControl = ({ isOwner, isSudo, isDev, isAdmin }) => !!(isOwner || isSudo || isDev || isAdmin);

const react = async (sock, msg, text) => {
    try { await sock.sendMessage(msg.key.remoteJid, { react: { text, key: msg.key } }); } catch (e) { /* best effort */ }
};

const makeSleep = (name, emoji, description) => ({
    name,
    isPrefixless: false,
    category: 'tools',
    description,
    execute: async (sock, msg, args, ctx) => {
        const jid = msg.key.remoteJid;
        if (!canControl(ctx || {})) return await react(sock, msg, '❌');

        const current = Array.isArray(config.sleepChats) ? config.sleepChats : [];
        if (current.includes(jid)) return;

        await react(sock, msg, emoji);   // before sleeping, or the gate would swallow it

        // Assign a new array: sub-bots without their own settings share the default one.
        config.sleepChats = [...current, jid];
        saveState();
    }
});

const makeWake = (name, emoji, description) => ({
    name,
    isPrefixless: false,
    category: 'tools',
    description,
    execute: async (sock, msg, args, ctx) => {
        const jid = msg.key.remoteJid;

        // Stay silent for anyone who can't wake it, so a sleeping bot stays quiet.
        if (!canControl(ctx || {})) return;

        const current = Array.isArray(config.sleepChats) ? config.sleepChats : [];
        if (current.includes(jid)) {
            config.sleepChats = current.filter(j => j !== jid);
            saveState();
        }

        await react(sock, msg, emoji);   // after waking, or the gate would swallow it
    }
});

module.exports = [
    makeSleep('sleep', '💤', 'Put the bot to sleep in this chat until .wake (reacts 💤)'),
    makeSleep('-s', '😴', 'Short for .sleep (reacts 😴)'),
    makeWake('wake', '🥷', 'Wake the bot up in this chat after .sleep (reacts 🥷)'),
    makeWake('-w', '✨', 'Short for .wake (reacts ✨)')
];
