// plugins/akinator.js  (real Akinator engine v4)
// Usage:
//   .aki            -> help
//   .aki start      -> start a game
//   .aki stop       -> stop your game
// Answer by REPLYING to the bot's message: yes | no | idk | prob | probnot  ("back" undoes the last answer)
//
// This plays through the real Akinator (package "akinator-client"), so the questions and the guess come
// from Akinator's own database. Rules kept from before:
//  - ONE guess, then the game is over (whether it was right or not).
//  - After a game the player waits COOLDOWN_MS before starting another.
//
// Akinator's website sits behind Cloudflare, which often blocks server (data-centre) IPs. If starting a
// game fails with an "anti-bot" error, set ONE of these on the host and restart:
//   SCRAPERAPI_KEY  (or config.scraperApiKey)  -> routes the requests through scraperapi.com
//   AKI_PROXY       (or config.akiProxy)       -> e.g. http://user:pass@host:port
// Optional: AKI_LANG (default "en"), AKI_CHILD_MODE=1.

const axios = require('axios');
const config = require('../config');
const { normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('../helpers/Message');
const BotRouter = require('../helpers/BotRouter');

global.akiSessions = global.akiSessions || {};
global.akiCooldowns = global.akiCooldowns || {};

// ─── SETTINGS ────────────────────────────────────────────────────
const MAX_QUESTIONS = 80;               // safety stop; Akinator normally guesses long before this
const COOLDOWN_MS = 2 * 60 * 1000;      // rest after a finished game
const SESSION_TTL = 15 * 60 * 1000;     // 15 min of inactivity ends the game

const ANSWER_WORDS = {
    yes: 'Yes', y: 'Yes',
    no: 'No', n: 'No',
    idk: 'IDontKnow', "i don't know": 'IDontKnow', dontknow: 'IDontKnow',
    prob: 'Probably', probably: 'Probably', p: 'Probably',
    probnot: 'ProbablyNot', 'prob not': 'ProbablyNot', probablynot: 'ProbablyNot', pn: 'ProbablyNot'
};

const GAME_OVER_TEXT = '🏁 *Game over.* The genie is resting for 2 minutes. Play again after that with `aki start`.';

// ─── THE ENGINE ──────────────────────────────────────────────────
let akiModule = null;
async function loadAki() {
    if (akiModule) return akiModule;
    akiModule = await import('akinator-client');
    return akiModule;
}

function clientOptions(mod) {
    const opts = {
        language: process.env.AKI_LANG || mod.Languages?.English || 'en',
        theme: mod.Themes?.Character ?? 1,
        retries: 2
    };
    const scraperApiKey = config.scraperApiKey || process.env.SCRAPERAPI_KEY;
    const proxy = config.akiProxy || process.env.AKI_PROXY;
    if (scraperApiKey) opts.scraperApiKey = scraperApiKey;
    if (proxy) opts.proxy = proxy;
    if (process.env.AKI_CHILD_MODE === '1') opts.childMode = true;
    return opts;
}

const progressOf = (c) => {
    const p = Number(c?.progression ?? c?.progress);
    return Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null;
};

function explainFailure(e) {
    const m = String(e?.message || e);
    if (/anti-?bot|HTML|challenge|403|signature/i.test(m)) {
        return 'Akinator blocked this server (Cloudflare). The owner needs to set SCRAPERAPI_KEY or AKI_PROXY.';
    }
    if (/Cannot find package|not found/i.test(m)) return 'The akinator-client package is not installed on the host.';
    return 'Could not reach Akinator right now.';
}

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
function questionText(session) {
    const prog = progressOf(session.client);
    return (
        `🧞 *AKINATOR*\n\n` +
        `*Q${session.step}:* ${session.question}\n\n` +
        `Reply to this message with: yes | no | idk | prob | probnot\n` +
        `_(${prog !== null ? `I'm ${prog}% sure · ` : ''}"back" undoes your last answer)_`
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

async function sendQuestion(sock, jid, msg, session) {
    const sent = await sock.sendMessage(jid, { text: questionText(session) }, { quoted: msg });
    markMain(session, sent);
    session.state = 'asking';
}

async function sendGuess(sock, jid, msg, session) {
    const win = session.client.winResult || {};
    session.state = 'guessing';
    session.guess = { name: win.name || 'your character', description: win.description || '', photo: win.photo || '' };

    const caption =
        `🧞 *AKINATOR*\n\n` +
        `I think it's... *${session.guess.name}*\n` +
        (session.guess.description ? `_${session.guess.description}_\n` : '') +
        `\nAfter ${session.step - 1} questions 🎯\n\n` +
        `Reply to this message with *yes* if I got it, or *no* if I missed.`;

    let sent;
    if (session.guess.photo) {
        try {
            const img = await axios.get(session.guess.photo, { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            sent = await sock.sendMessage(jid, { image: Buffer.from(img.data), caption }, { quoted: msg });
        } catch (e) {
            console.error('❌ [AKI] sending picture failed:', e.message);
        }
    }
    if (!sent) sent = await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    markMain(session, sent);
}

async function giveUp(sock, jid, msg, key) {
    endSession(key);
    startCooldown(key);
    return sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nI give up, you beat me! 🏳️\n\n${GAME_OVER_TEXT}` }, { quoted: msg });
}

// After the engine answers: either a new question or a guess
async function showNext(sock, jid, msg, key, session, res) {
    const client = session.client;
    const won = res?.won ?? client.won;
    session.question = res?.question ?? client.question;
    session.step += 1;
    if (won) return sendGuess(sock, jid, msg, session);
    if (!session.question || session.step > MAX_QUESTIONS) return giveUp(sock, jid, msg, key);
    return sendQuestion(sock, jid, msg, session);
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

            const session = {
                client: null, step: 1, question: '', guess: null,
                state: 'starting', lastMsgId: '', validIds: new Set(), busy: true, timer: null
            };
            global.akiSessions[key] = session;     // claimed first, so a double tap cannot start two games
            resetTimer(key);
            try {
                await sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nThink of a character (anime, game, cartoon, movie, comic...) and I will guess it!\n\n_Starting..._` }, { quoted: msg });
                const mod = await loadAki();
                session.client = new mod.AkinatorClient(clientOptions(mod));
                const first = await session.client.start();
                session.question = first?.question ?? session.client.question;
                if (!session.question) throw new Error('Akinator returned no question');
                await sendQuestion(sock, jid, msg, session);
            } catch (e) {
                console.error('❌ [AKI] start failed:', e.message);
                endSession(key);
                return sock.sendMessage(jid, { text: `⚠️ ${explainFailure(e)}` }, { quoted: msg });
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
                `I make one guess, and then the game is over.`
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
        if (!session || session.busy || !session.client) return;

        // Must be a reply to my latest Akinator message
        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        if (!quotedMsgId || !session.validIds?.has(quotedMsgId)) return;

        const input = (args || '').toString().trim().toLowerCase();
        session.busy = true;
        resetTimer(key);

        try {
            // ── Reply to the guess: ONE guess, then the game is over ──
            if (session.state === 'guessing') {
                const name = session.guess?.name || 'your character';
                const n = session.step - 1;
                if (input === 'yes' || input === 'y') {
                    endSession(key);
                    startCooldown(key);
                    return await sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nGreat, I got *${name}* in ${n} questions! 🎉\n\n${GAME_OVER_TEXT}` }, { quoted: msg });
                }
                if (input === 'no' || input === 'n') {
                    endSession(key);
                    startCooldown(key);
                    return await sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nMy guess *${name}* was wrong, you beat me! 🏳️\n\n${GAME_OVER_TEXT}` }, { quoted: msg });
                }
                return await hint(sock, jid, msg, session, 'Reply with *yes* or *no*.');
            }

            // ── Reply to a question ──
            const { Answers } = await loadAki();
            if (input === 'back') {
                if (session.step <= 1) return await hint(sock, jid, msg, session, "⚠️ Can't go back any further.");
                const res = await session.client.back();
                session.step -= 1;
                session.question = res?.question ?? session.client.question;
                return await sendQuestion(sock, jid, msg, session);
            }

            const word = ANSWER_WORDS[input];
            if (!word) return await hint(sock, jid, msg, session, 'Reply with: yes | no | idk | prob | probnot');

            const res = await session.client.answer(Answers[word]);
            await showNext(sock, jid, msg, key, session, res);
        } catch (e) {
            console.error('❌ [AKI] answer failed:', e.message);
            await hint(sock, jid, msg, session, `⚠️ ${/anti-?bot|HTML|challenge|403/i.test(String(e.message)) ? explainFailure(e) : 'Akinator had a hiccup. Reply to my last message again, or use `aki stop`.'}`);
        } finally {
            if (global.akiSessions[key]) session.busy = false;
        }
    }
};

module.exports = [
    akiCommand,
    akiAnswerCommand,
    { ...akiCommand, name: 'akinator' }
];
