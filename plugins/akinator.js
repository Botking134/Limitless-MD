// plugins/akinator.js
// Usage:
//   .aki            -> help
//   .aki start      -> start a game
//   .aki stop       -> stop your game
// Answer by REPLYING to the bot's question with: yes | no | idk | prob | probnot
// (Optional: "back" to undo the last answer)

const { normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('../helpers/Message');

const axios = require('axios');

let Aki;
try {
    ({ Aki } = require('aki-api'));
} catch (e) {
    Aki = null;
}

global.akiSessions = global.akiSessions || {};

const ANSWER_MAP = {
    yes: 0, y: 0,
    no: 1, n: 1,
    idk: 2, "i don't know": 2, dontknow: 2,
    prob: 3, probably: 3, p: 3,
    probnot: 4, "prob not": 4, probablynot: 4, pn: 4
};

const SESSION_TTL = 15 * 60 * 1000; // 15 min of inactivity ends the game

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

// NOTE: the word "AKINATOR" must stay in this header. helpers/GameInterceptors.js
// matches it to route replies to the aki_ans command.
function questionText(aki) {
    return (
        `🧞 *AKINATOR*\n\n` +
        `*Q${aki.currentStep + 1}:* ${aki.question}\n\n` +
        `Reply to this message with: yes | no | idk | prob | probnot\n` +
        `_(Progress: ${Math.round(aki.progress)}%)_`
    );
}

async function sendQuestion(sock, jid, msg, session) {
    const sent = await sock.sendMessage(jid, { text: questionText(session.aki) }, { quoted: msg });
    session.lastQuestionMsgId = sent?.key?.id || '';
}

async function sendGuess(sock, jid, msg, session) {
    const aki = session.aki;
    await aki.win();
    const guess = aki.answers && aki.answers[0];
    if (!guess) {
        return sock.sendMessage(jid, { text: '🧞 *AKINATOR*\n\nI give up, you beat me! 🏳️' }, { quoted: msg });
    }
    const caption =
        `🧞 *AKINATOR*\n\n` +
        `I think it's... *${guess.name}*\n` +
        `_${guess.description || ''}_\n\n` +
        `Guessed in ${aki.currentStep} questions 🎯`;
    if (guess.absolute_picture_path) {
        try {
            // Download the picture first so WhatsApp always gets real image bytes
            const res = await axios.get(guess.absolute_picture_path, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            return await sock.sendMessage(jid, { image: Buffer.from(res.data), caption }, { quoted: msg });
        } catch (e) {
            console.error('❌ [AKI] image failed:', e.message);
        }
    }
    return sock.sendMessage(jid, { text: caption }, { quoted: msg });
}

module.exports = [
    {
        name: 'aki',
        aliases: ['akinator'],
        isPrefixless: false,
        description: 'Play Akinator. Use: aki start | aki stop',
        category: 'games',
        usage: 'aki start | aki stop',
        execute: async (sock, msg, args) => {
            const { jid, key } = sessionKey(msg);
            const sub = (args || '').toString().trim().toLowerCase();

            if (sub === 'stop') {
                const s = global.akiSessions[key];
                if (!s) return sock.sendMessage(jid, { text: '❌ You have no active Akinator game.' }, { quoted: msg });
                if (s.timer) clearTimeout(s.timer);
                delete global.akiSessions[key];
                return sock.sendMessage(jid, { text: '🛑 Akinator game stopped.' }, { quoted: msg });
            }

            if (sub === 'start') {
                if (!Aki) {
                    return sock.sendMessage(jid, { text: '⚠️ Akinator needs the `aki-api` package. Run: npm i aki-api' }, { quoted: msg });
                }
                if (global.akiSessions[key]) {
                    return sock.sendMessage(jid, { text: '⚠️ You already have a game running. Reply to my last question, or use `aki stop`.' }, { quoted: msg });
                }
                try {
                    const aki = new Aki({ region: 'en' });
                    await aki.start();
                    const session = { aki, lastQuestionMsgId: '', timer: null };
                    global.akiSessions[key] = session;
                    resetTimer(key);
                    await sendQuestion(sock, jid, msg, session);
                } catch (e) {
                    delete global.akiSessions[key];
                    console.error('❌ [AKI] start failed:', e.message);
                    return sock.sendMessage(jid, { text: '⚠️ Could not reach Akinator right now. Try again in a moment.' }, { quoted: msg });
                }
                return;
            }

            return sock.sendMessage(jid, {
                text:
                    `🧞 *AKINATOR*\n\n` +
                    `Think of a character and I'll guess it!\n\n` +
                    `• \`aki start\` — start a game\n` +
                    `• \`aki stop\` — stop your game\n\n` +
                    `Answer by replying to my question with:\nyes | no | idk | prob | probnot`
            }, { quoted: msg });
        }
    },

    // Called automatically when someone replies to an AKINATOR question
    {
        name: 'aki_ans',
        isPrefixless: false,
        description: 'Internal: answer an Akinator question',
        category: 'games',
        execute: async (sock, msg, args) => {
            const { jid, key } = sessionKey(msg);
            const session = global.akiSessions[key];
            if (!session) return;

            // Must be a reply to the latest question
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;
            if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) return;

            const input = (args || '').toString().trim().toLowerCase();
            const aki = session.aki;

            try {
                if (input === 'back') {
                    if (aki.currentStep <= 0) {
                        return sock.sendMessage(jid, { text: "⚠️ Can't go back any further." }, { quoted: msg });
                    }
                    await aki.back();
                    resetTimer(key);
                    return await sendQuestion(sock, jid, msg, session);
                }

                if (!(input in ANSWER_MAP)) {
                    return sock.sendMessage(jid, { text: 'Reply with: yes | no | idk | prob | probnot' }, { quoted: msg });
                }

                await aki.step(ANSWER_MAP[input]);
                resetTimer(key);

                if (aki.progress >= 80 || aki.currentStep >= 78) {
                    if (session.timer) clearTimeout(session.timer);
                    delete global.akiSessions[key];
                    return await sendGuess(sock, jid, msg, session);
                }

                await sendQuestion(sock, jid, msg, session);
            } catch (e) {
                console.error('❌ [AKI] answer failed:', e.message);
                if (session.timer) clearTimeout(session.timer);
                delete global.akiSessions[key];
                await sock.sendMessage(jid, { text: '⚠️ Akinator session broke. Start again with `aki start`.' }, { quoted: msg });
            }
        }
    }
];

// Alias: .akinator -> .aki
const aliases = [{ ...module.exports[0], name: 'akinator' }];
module.exports.push(...aliases);
