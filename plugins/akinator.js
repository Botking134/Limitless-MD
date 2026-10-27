// plugins/akinator.js  (own-database Akinator, v5)
// Usage:
//   .aki            -> help
//   .aki start      -> start a game
//   .aki stop       -> stop your game
//   .akidb          -> owner tools for the database (stats | learned | find <name> | rm <name> | reload)
// Answer by REPLYING to the bot's message: yes | no | idk | prob | probnot  ("back" undoes the last answer)
//
// The questions, characters and probabilities live in data/akinator/*.json and are played by
// helpers/AkiEngine.js. No website, no API key, no AI. Rules kept from before:
//  - ONE guess, then the game is over (whether it was right or not).
//  - After a game the player waits COOLDOWN_MS before starting another.
// New in this version: after a wrong guess the bot asks who it was, and learns from it.

const { normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('../helpers/Message');
const BotRouter = require('../helpers/BotRouter');
const Engine = require('../helpers/AkiEngine');

global.akiSessions = global.akiSessions || {};
global.akiCooldowns = global.akiCooldowns || {};

// ─── SETTINGS ────────────────────────────────────────────────────
const COOLDOWN_MS = 2 * 60 * 1000;      // rest after a finished game
const SESSION_TTL = 15 * 60 * 1000;     // 15 min of inactivity ends the game

const ANSWER_WORDS = {
    yes: 'yes', y: 'yes', yeah: 'yes', yep: 'yes',
    no: 'no', n: 'no', nope: 'no',
    idk: 'idk', dk: 'idk', "i don't know": 'idk', 'i dont know': 'idk', dontknow: 'idk', "don't know": 'idk', 'dont know': 'idk',
    prob: 'prob', probably: 'prob', p: 'prob', maybe: 'prob',
    probnot: 'probnot', 'prob not': 'probnot', probablynot: 'probnot', 'probably not': 'probnot', pn: 'probnot'
};

const GAME_OVER_TEXT = '🏁 *Game over.* The genie is resting for 2 minutes. Play again after that with `aki start`.';

// ─── HELPERS ─────────────────────────────────────────────────────
function sessionKey(msg) {
    const jid = msg.key.remoteJid;
    const sender = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
    return { jid, sender, key: jid + '_' + sender };
}

function resetTimer(key) {
    const s = global.akiSessions[key];
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => { delete global.akiSessions[key]; }, SESSION_TTL);
}

function endSession(key) {
    const s = global.akiSessions[key];
    if (s && s.timer) clearTimeout(s.timer);
    delete global.akiSessions[key];
}

function startCooldown(key) {
    global.akiCooldowns[key] = Date.now() + COOLDOWN_MS;
}

// NOTE: the word "AKINATOR" must stay in every message below. helpers/GameInterceptors.js
// matches it to route replies to the aki_ans command.
function questionText(session, res) {
    const pct = Math.max(1, Math.min(99, Math.round((res.confidence || 0) * 100)));
    return (
        `🧞 *AKINATOR*\n\n` +
        `*Q${res.step}:* ${res.text}\n\n` +
        `Reply to this message with: yes | no | idk | prob | probnot\n` +
        `_(I'm ${pct}% sure · "back" undoes your last answer)_`
    );
}

// Every message I send that the player may reply to is remembered, so a reply to my latest
// message is never silently ignored.
function markMain(session, sent) {
    session.lastMsgId = sent?.key?.id || '';
    session.validIds = new Set(session.lastMsgId ? [session.lastMsgId] : []);
}
async function hint(sock, jid, msg, session, text) {
    const sent = await sock.sendMessage(jid, { text }, { quoted: msg });
    if (sent?.key?.id) (session.validIds = session.validIds || new Set()).add(sent.key.id);
    return sent;
}

async function sendQuestion(sock, jid, msg, session, res) {
    const sent = await sock.sendMessage(jid, { text: questionText(session, res) }, { quoted: msg });
    markMain(session, sent);
    session.state = 'asking';
}

async function sendGuess(sock, jid, msg, session, res) {
    const ch = res.char;
    session.state = 'guessing';
    const pct = Math.max(1, Math.min(99, Math.round((res.confidence || 0) * 100)));
    const caption =
        `🧞 *AKINATOR*\n\n` +
        `I think it's... *${ch ? ch.name : 'your character'}*\n` +
        (ch && ch.from ? `_${ch.from}_\n` : '') +
        `\nAfter ${res.step} questions 🎯 (${pct}% sure)\n\n` +
        `Reply to this message with *yes* if I got it, or *no* if I missed.`;
    const sent = await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    markMain(session, sent);
}

async function giveUp(sock, jid, msg, key) {
    endSession(key);
    startCooldown(key);
    return sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nI have no idea who that is, you beat me! 🏳️\n\n${GAME_OVER_TEXT}` }, { quoted: msg });
}

// After an answer: either a new question or the guess
async function showNext(sock, jid, msg, key, session) {
    const res = session.game.next();
    session.step = res.step;
    if (res.type === 'question') return sendQuestion(sock, jid, msg, session, res);
    if (!res.char) return giveUp(sock, jid, msg, key);
    return sendGuess(sock, jid, msg, session, res);
}

function dbProblem(e) {
    console.error('❌ [AKI] database problem:', e.message);
    return 'The Akinator database could not be loaded. The owner should check the files in data/akinator/.';
}

// ─── COMMANDS ────────────────────────────────────────────────────
const akiCommand = {
    name: 'aki',
    isPrefixless: false,
    description: 'Play Akinator. Use: aki start | aki stop',
    category: 'games',
    usage: 'aki start | aki stop',
    execute: async (sock, msg, args) => {
        const { jid, key } = sessionKey(msg);
        // With several bots in one group, only the first one to see this message answers it.
        if (!BotRouter.claimMessage('aki-cmd', jid, msg.key.id)) return;
        const sub = (args || '').toString().trim().toLowerCase();

        if (sub === 'stop') {
            if (!global.akiSessions[key]) {
                return sock.sendMessage(jid, { text: '❌ You have no active Akinator game.' }, { quoted: msg });
            }
            endSession(key);
            return sock.sendMessage(jid, { text: '🛑 Akinator game stopped.' }, { quoted: msg });
        }

        if (sub === 'start') {
            if (global.akiSessions[key]) {
                return sock.sendMessage(jid, { text: '⚠️ You already have a game running. Reply to my last message, or use `aki stop`.' }, { quoted: msg });
            }
            const rest = (global.akiCooldowns[key] || 0) - Date.now();
            if (rest > 0) {
                const m = Math.floor(rest / 60000), s = Math.ceil((rest % 60000) / 1000);
                return sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nThe genie is resting. Try again in ${m ? `${m}m ` : ''}${s}s.` }, { quoted: msg });
            }

            const session = { game: null, step: 0, guess: null, state: 'starting', lastMsgId: '', validIds: new Set(), busy: true, timer: null };
            global.akiSessions[key] = session;     // claimed first, so a double tap cannot start two games
            resetTimer(key);
            try {
                let db;
                try { db = Engine.getDB(); } catch (e) { endSession(key); return sock.sendMessage(jid, { text: `⚠️ ${dbProblem(e)}` }, { quoted: msg }); }
                session.game = new Engine.AkiGame(db);
                await sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nThink of a character (anime, game, cartoon, movie, comic, or even a real famous person) and I will guess it!` }, { quoted: msg });
                await showNext(sock, jid, msg, key, session);
            } catch (e) {
                console.error('❌ [AKI] start failed:', e.message);
                endSession(key);
                return sock.sendMessage(jid, { text: '⚠️ Akinator had a problem starting. Try again in a moment.' }, { quoted: msg });
            } finally {
                session.busy = false;
            }
            return;
        }

        return sock.sendMessage(jid, {
            text:
                `🧞 *AKINATOR*\n\n` +
                `Think of a character and I'll guess it!\n\n` +
                `• \`aki start\` — start a game\n` +
                `• \`aki stop\` — stop your game\n\n` +
                `Answer by replying to my message with:\nyes | no | idk | prob | probnot\n\n` +
                `I make one guess, and then the game is over. If I miss, tell me who it was and I'll learn.`
        }, { quoted: msg });
    }
};

const akiAnswerCommand = {
    name: 'aki_ans',
    isPrefixless: false,
    description: 'Internal: answer an Akinator message',
    category: 'games',
    execute: async (sock, msg, args) => {
        const { jid, key } = sessionKey(msg);
        const session = global.akiSessions[key];
        if (!session || session.busy || !session.game) return;

        // Must be a reply to my latest Akinator message
        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        if (!quotedMsgId || !session.validIds?.has(quotedMsgId)) return;

        const raw = (args || '').toString().trim();
        const input = raw.toLowerCase();
        session.busy = true;
        resetTimer(key);

        try {
            const db = session.game.db;

            // ── Reply to the guess: ONE guess, then the game is over ──
            if (session.state === 'guessing') {
                const ch = session.game.guessed;
                const name = ch ? ch.name : 'your character';
                if (input === 'yes' || input === 'y') {
                    Engine.finishGame(db, session.game, true, null);
                    endSession(key);
                    startCooldown(key);
                    return await sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nGreat, I got *${name}* in ${session.step} questions! 🎉\n\n${GAME_OVER_TEXT}` }, { quoted: msg });
                }
                if (input === 'no' || input === 'n') {
                    session.state = 'teaching';
                    const sent = await sock.sendMessage(jid, {
                        text: `🧞 *AKINATOR*\n\nMy guess *${name}* was wrong, you beat me! 🏳️\n\nWho were you thinking of? Reply to this message with the name, so I can learn it (or reply *skip*).`
                    }, { quoted: msg });
                    markMain(session, sent);
                    return;
                }
                return await hint(sock, jid, msg, session, 'Reply with *yes* or *no*.');
            }

            // ── Reply to "who was it?" ──
            if (session.state === 'teaching') {
                if (input === 'skip' || input === 'no' || input === 'n') {
                    Engine.finishGame(db, session.game, false, null);
                    endSession(key);
                    startCooldown(key);
                    return await sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nOkay, no problem.\n\n${GAME_OVER_TEXT}` }, { quoted: msg });
                }
                if (!Engine.cleanName(raw)) {
                    return await hint(sock, jid, msg, session, 'Please reply with just the name (letters and numbers only), or *skip*.');
                }
                const r = Engine.finishGame(db, session.game, false, raw);
                endSession(key);
                startCooldown(key);
                const learned = r.learned === 'added'
                    ? `I did not know *${r.name}* before. Now I do. 📚`
                    : r.learned === 'nudged'
                        ? `I know *${r.name}*, my questions about them just got better. 📚`
                        : `Thanks!`;
                return await sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\n${learned}\n\n${GAME_OVER_TEXT}` }, { quoted: msg });
            }

            // ── Reply to a question ──
            if (input === 'back') {
                if (!session.game.back()) return await hint(sock, jid, msg, session, "⚠️ Can't go back any further.");
                return await showNext(sock, jid, msg, key, session);
            }

            const word = ANSWER_WORDS[input];
            if (!word) return await hint(sock, jid, msg, session, 'Reply with: yes | no | idk | prob | probnot');

            session.game.answer(word);
            await showNext(sock, jid, msg, key, session);
        } catch (e) {
            console.error('❌ [AKI] answer failed:', e);
            await hint(sock, jid, msg, session, 'Akinator had a hiccup. Reply to my last message again, or use `aki stop`.');
        } finally {
            if (global.akiSessions[key]) session.busy = false;
        }
    }
};

// ─── OWNER TOOLS ─────────────────────────────────────────────────
const akiDbCommand = {
    name: 'akidb',
    isPrefixless: false,
    category: 'owner',
    description: 'Owner: Akinator database tools. Use: akidb stats | learned | find <name> | rm <name> | reload',
    usage: 'akidb stats | learned | find <name> | rm <name> | reload',
    execute: async (sock, msg, args, { isOwner, isDev } = {}) => {
        const jid = msg.key.remoteJid;
        if (!(isOwner || isDev)) return;
        const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
        const text = (args || '').toString().trim();
        const [sub, ...restWords] = text.split(/\s+/);
        const rest = restWords.join(' ');

        let db;
        try { db = Engine.getDB(); } catch (e) { return reply(`⚠️ ${dbProblem(e)}`); }

        switch ((sub || 'stats').toLowerCase()) {
            case 'stats': {
                const s = db.stats();
                const kinds = Object.entries(s.byKind).map(([k, v]) => `${k} ${v}`).join(' · ');
                return reply(
                    `🧞 *AKINATOR DATABASE*\n\n` +
                    `Questions: ${s.questions}\nCharacters: ${s.characters} (${kinds})\n` +
                    `Learned from players: ${s.learned}\n` +
                    `Games logged: ${s.games}${s.games ? ` · guessed right ${s.correct} (${Math.round(100 * s.correct / s.games)}%)` : ''}\n\n` +
                    `Files: data/akinator/`
                );
            }
            case 'learned': {
                const list = db.chars.filter(c => c.source === 'learned');
                if (!list.length) return reply('🧞 No characters learned from players yet.');
                const shown = list.slice(-40).map(c => `• ${c.name} (${c.plays} play${c.plays === 1 ? '' : 's'})`).join('\n');
                return reply(`🧞 *LEARNED CHARACTERS* (${list.length})\n\n${shown}${list.length > 40 ? '\n…and older ones.' : ''}\n\nRemove one with \`akidb rm <name>\`.`);
            }
            case 'find': {
                if (!rest) return reply('Use: akidb find <name>');
                const ch = db.findChar(rest);
                if (!ch) return reply(`🧞 "${rest}" is not in the database.`);
                const top = Object.entries(ch.p).filter(([, v]) => v >= 70).map(([k]) => k).slice(0, 40).join(', ');
                return reply(`🧞 *${ch.name}*${ch.from ? ` (${ch.from})` : ''}\nkind: ${ch.kind} · source: ${ch.source} · plays: ${ch.plays}\n\nStrong "yes" answers: ${top || 'none'}`);
            }
            case 'rm':
            case 'remove': {
                if (!rest) return reply('Use: akidb rm <name>');
                const removed = Engine.removeChar(db, rest);
                return reply(removed ? `🗑️ Removed *${removed}* from the database.` : `🧞 "${rest}" is not in the database.`);
            }
            case 'reload': {
                try { db.load(); return reply(`✅ Reloaded: ${db.questions.length} questions, ${db.chars.length} characters.`); }
                catch (e) { return reply(`❌ Reload failed: ${e.message}`); }
            }
            default:
                return reply('Use: akidb stats | learned | find <name> | rm <name> | reload');
        }
    }
};

module.exports = [
    akiCommand,
    akiAnswerCommand,
    { ...akiCommand, name: 'akinator' },
    akiDbCommand
];
