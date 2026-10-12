// helpers/BotRouter.js
//
// The main bot and every sub-bot run in ONE process, share the same global
// session / game tables, and are often members of the same group, so a single
// WhatsApp message is delivered to all of them. Without routing, each bot
// handled the same reply or game answer, which is why wizards, games and the
// AI agents got "intertwined" (steps out of order, duplicate replies, state
// advanced twice).
//
// Two rules, applied once in helpers/Infinity.js so no plugin has to change:
//
//  1. Reply routing - a reply to a message that one of OUR bots sent is only
//     handled by that bot.
//  2. One-shot claims - for shared-state work (game answers) the first bot to
//     reach a message claims it; the others skip it. The claim is synchronous,
//     so two bots can never both win.

// botId -> Set of bare ids (phone number and LID parts) that account answers to.
const identities = new Map();

function bare(jid) {
    return (jid || '').split('@')[0].split(':')[0];
}

// Call at the top of every incoming message; cheap and idempotent.
function registerBotIdentity(sock) {
    const botId = sock.__botId || 'main';
    const set = identities.get(botId) || new Set();
    const me = sock.user || sock.authState?.creds?.me || {};
    [me.id, me.lid, sock.authState?.creds?.me?.id, sock.authState?.creds?.me?.lid]
        .map(bare)
        .filter(Boolean)
        .forEach(id => set.add(id));
    identities.set(botId, set);
}

// Which of our bots owns this JID? null = it's not one of our bots.
function botIdFor(jid) {
    const id = bare(jid);
    if (!id) return null;
    for (const [botId, set] of identities) {
        if (set.has(id)) return botId;
    }
    return null;
}

// False only when the message replies to a message sent by a DIFFERENT one of our bots.
function isAddressedToThisBot(sock, quotedParticipantJid) {
    if (!quotedParticipantJid) return true;
    const owner = botIdFor(quotedParticipantJid);
    if (!owner) return true;
    return owner === (sock.__botId || 'main');
}

// First caller for a given (scope, chat, message id) gets true; everyone else false.
const claims = new Map();
const CLAIM_TTL_MS = 2 * 60 * 1000;

function claimMessage(scope, chatJid, messageId) {
    if (!messageId) return true;
    const key = `${scope}|${chatJid}|${messageId}`;
    const now = Date.now();

    if (claims.size > 500) {
        for (const [k, t] of claims) if (now - t > CLAIM_TTL_MS) claims.delete(k);
    }
    if (claims.has(key)) return false;
    claims.set(key, now);
    return true;
}

module.exports = { registerBotIdentity, botIdFor, isAddressedToThisBot, claimMessage };
