// helpers/SleepGate.js
//
// Backs the .sleep / .wake commands. A chat in config.sleepChats is on complete
// standby for that bot: it handles nothing from that chat except .wake, and it
// sends nothing into it.
//
//  - Incoming messages are dropped at the top of helpers/Infinity.js.
//  - Group-participant events and deleted-message events (pair.js) are skipped.
//  - guardSocket() makes the socket itself refuse to send into a sleeping chat,
//    which also silences anything already running (game timers, spam loops,
//    scheduled replies) without having to touch each plugin.
//
// sleepChats is a per-bot setting, so every lookup is scoped to the right bot.

const BotContext = require('./BotContext');
const config = require('../config');

function isSleeping(botId, jid) {
    if (!jid) return false;
    return BotContext.runAsBot(botId, () =>
        Array.isArray(config.sleepChats) && config.sleepChats.includes(jid)
    );
}

// Stand-in result for a send that was swallowed, so callers that read
// `result.key.id` afterwards don't throw.
function suppressedResult(jid) {
    return {
        key: { remoteJid: jid, fromMe: true, id: `SLEEPING${Date.now()}${Math.floor(Math.random() * 1e6)}` },
        message: {},
        suppressed: true
    };
}

// Wraps the socket's outgoing calls once. Safe to call repeatedly.
function guardSocket(sock) {
    if (!sock || sock.__sleepGuarded) return;
    sock.__sleepGuarded = true;

    const send = sock.sendMessage?.bind(sock);
    if (send) {
        sock.sendMessage = (jid, ...rest) =>
            isSleeping(sock.__botId, jid) ? Promise.resolve(suppressedResult(jid)) : send(jid, ...rest);
    }

    const relay = sock.relayMessage?.bind(sock);
    if (relay) {
        sock.relayMessage = (jid, ...rest) =>
            isSleeping(sock.__botId, jid) ? Promise.resolve(suppressedResult(jid).key.id) : relay(jid, ...rest);
    }

    const presence = sock.sendPresenceUpdate?.bind(sock);
    if (presence) {
        sock.sendPresenceUpdate = (type, jid, ...rest) =>
            isSleeping(sock.__botId, jid) ? Promise.resolve() : presence(type, jid, ...rest);
    }
}

module.exports = { isSleeping, guardSocket };
