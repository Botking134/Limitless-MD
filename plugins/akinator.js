// plugins/akinator.js  (Groq-powered Akinator)
// Usage:
//   .aki            -> help
//   .aki start      -> start a game
//   .aki stop       -> stop your game
// Answer by REPLYING to the bot's message with: yes | no | idk | prob | probnot
// ("back" undoes your last answer)
// The bot asks up to 35 questions, but guesses earlier when it is confident.
// The final guess is sent with a picture found through Pinterest search.

const axios = require('axios');
const config = require('../config');
const { normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('../helpers/Message');

global.akiSessions = global.akiSessions || {};

// ─── SETTINGS ────────────────────────────────────────────────────
const MAX_QUESTIONS = 35;
const MIN_QUESTIONS_BEFORE_GUESS = 8;
const MIN_CONFIDENCE = 80;
const SESSION_TTL = 15 * 60 * 1000; // 15 min of inactivity ends the game
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b']; // tried in order
const PINTEREST_SEARCH = 'https://apis.davidcyril.name.ng/search/pinterest';

const ANSWER_MAP = {
    yes: 'Yes', y: 'Yes',
    no: 'No', n: 'No',
    idk: "Don't know", "i don't know": "Don't know", dontknow: "Don't know",
    prob: 'Probably', probably: 'Probably', p: 'Probably',
    probnot: 'Probably not', 'prob not': 'Probably not', probablynot: 'Probably not', pn: 'Probably not'
};

const SYSTEM_PROMPT =
`You are Akinator, the genie who guesses the FICTIONAL character the player is thinking of (anime, manga, cartoons, games, movies, comics, etc. Most players pick anime characters).
Rules:
- Ask ONE short yes/no question at a time to narrow the character down.
- Never repeat or reword a question that was already asked.
- Start broad (gender, human or not, which medium, hair, powers, role) then get specific.
- Use the answers (Yes, No, Don't know, Probably, Probably not) consistently.
- When you are at least ${MIN_CONFIDENCE}% sure, make a guess instead of asking another question.
- Never guess before ${MIN_QUESTIONS_BEFORE_GUESS} questions have been answered.
- Never guess a name that is on the "already wrong" list.
- Once ${MAX_QUESTIONS} questions have been answered you MUST guess.
Reply with ONLY one JSON object and nothing else:
{"type":"question","text":"<your question>"}
or
{"type":"guess","name":"<character name>","from":"<series or game>","confidence":<0-100>}`;

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

// NOTE: the word "AKINATOR" must stay in every message below. helpers/GameInterceptors.js
// matches it to route replies to the aki_ans command.
function questionText(session) {
    const n = session.answers.length + 1;
    return (
        `🧞 *AKINATOR*\n\n` +
        `*Q${n}:* ${session.currentQ}\n\n` +
        `Reply to this message with: yes | no | idk | prob | probnot\n` +
        `_(Question ${n} of ${MAX_QUESTIONS})_`
    );
}

function transcript(session) {
    const lines = session.answers.map((x, i) => `Q${i + 1}: ${x.q} -> ${x.a}`);
    let text = lines.length ? lines.join('\n') : '(no questions asked yet)';
    text += `\n\nQuestions answered so far: ${session.answers.length}`;
    if (session.wrong.length) text += `\nAlready wrong guesses (never guess these): ${session.wrong.join(', ')}`;
    return text;
}

async function callGroq(userContent) {
    const apiKey = config.groqApiKey;
    if (!apiKey) throw new Error('GROQ API key is not set in config');
    let lastErr;
    for (const model of GROQ_MODELS) {
        try {
            const res = await axios.post(GROQ_URL, {
                model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userContent }
                ],
                temperature: 0.4,
                max_tokens: 250,
                response_format: { type: 'json_object' }
            }, {
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 30000
            });
            return res.data?.choices?.[0]?.message?.content || '';
        } catch (e) {
            lastErr = e;
            // Try the next model on "model not found / bad request" style errors
            const status = e.response?.status;
            if (status && ![400, 404].includes(status)) break;
        }
    }
    throw lastErr || new Error('Groq request failed');
}

function parseJson(text) {
    try {
        const m = String(text).match(/\{[\s\S]*\}/);
        return m ? JSON.parse(m[0]) : null;
    } catch (e) {
        return null;
    }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// Returns { type: 'question', text } or { type: 'guess', name, from } or { type: 'giveup' }
async function nextStep(session) {
    const answered = session.answers.length;
    const mustGuess = answered >= MAX_QUESTIONS;
    const askedSet = new Set(session.answers.map(x => norm(x.q)));
    let hint = '';

    for (let attempt = 0; attempt < 3; attempt++) {
        const prompt = transcript(session) + (hint ? `\n\n${hint}` : '') + '\n\nReply with the JSON now.';
        const data = parseJson(await callGroq(prompt));
        if (!data) { hint = 'Your last reply was not valid JSON. Reply with ONLY the JSON object.'; continue; }

        if (data.type === 'guess' && data.name) {
            const wrong = session.wrong.map(norm).includes(norm(data.name));
            const tooEarly = answered < MIN_QUESTIONS_BEFORE_GUESS && !mustGuess;
            const unsure = Number(data.confidence || 0) < MIN_CONFIDENCE && !mustGuess;
            if (wrong) { hint = `${data.name} is already wrong. Guess someone else or ask another question.`; continue; }
            if (tooEarly) { hint = 'Too early to guess. Ask another yes/no question.'; continue; }
            if (unsure) { hint = `You are not confident enough (need ${MIN_CONFIDENCE}%). Ask another question.`; continue; }
            return { type: 'guess', name: String(data.name).trim(), from: String(data.from || '').trim() };
        }

        if (data.type === 'question' && data.text) {
            if (mustGuess) { hint = `${MAX_QUESTIONS} questions are answered. You MUST guess now.`; continue; }
            if (askedSet.has(norm(data.text))) { hint = 'That question was already asked. Ask a different one.'; continue; }
            return { type: 'question', text: String(data.text).trim() };
        }

        hint = 'Invalid format. Reply with ONLY one JSON object of type "question" or "guess".';
    }
    if (mustGuess) return { type: 'giveup' };
    const fallbacks = [
        'Is your character from an anime?', 'Is your character male?', 'Is your character human?',
        'Does your character have special powers?', 'Is your character a villain?',
        'Does your character use a weapon?', 'Does your character have a cellphone?',
        'Is your character a main character?'
    ];
    const pick = fallbacks.find(q => !askedSet.has(norm(q)));
    return pick ? { type: 'question', text: pick } : { type: 'giveup' };
}

async function findPicture(name, from) {
    const query = `${name} ${from}`.trim();
    try {
        const res = await axios.get(PINTEREST_SEARCH, { params: { text: query }, timeout: 15000 });
        const results = res.data?.result;
        if (!res.data?.success || !Array.isArray(results)) return null;
        for (const item of results.slice(0, 5)) {
            if (!item?.image) continue;
            try {
                const img = await axios.get(item.image, {
                    responseType: 'arraybuffer',
                    timeout: 15000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                return Buffer.from(img.data);
            } catch (e) { /* try next picture */ }
        }
    } catch (e) {
        console.error('❌ [AKI] picture search failed:', e.message);
    }
    return null;
}

async function sendQuestion(sock, jid, msg, session) {
    const sent = await sock.sendMessage(jid, { text: questionText(session) }, { quoted: msg });
    session.lastMsgId = sent?.key?.id || '';
    session.state = 'asking';
}

async function sendGuess(sock, jid, msg, session, guess) {
    session.state = 'guessing';
    session.guess = guess;
    const caption =
        `🧞 *AKINATOR*\n\n` +
        `I think it's... *${guess.name}*\n` +
        (guess.from ? `_${guess.from}_\n` : '') +
        `\nGuessed in ${session.answers.length} questions 🎯\n\n` +
        `Reply to this message with *yes* if I got it, or *no* and I'll keep going.`;

    const buffer = await findPicture(guess.name, guess.from);
    let sent;
    if (buffer) {
        try {
            sent = await sock.sendMessage(jid, { image: buffer, caption }, { quoted: msg });
        } catch (e) {
            console.error('❌ [AKI] sending picture failed:', e.message);
        }
    }
    if (!sent) sent = await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    session.lastMsgId = sent?.key?.id || '';
}

// Ask the model for the next step and send it
async function advance(sock, jid, msg, key, session) {
    const step = await nextStep(session);
    if (step.type === 'guess') return sendGuess(sock, jid, msg, session, step);
    if (step.type === 'giveup') {
        endSession(key);
        return sock.sendMessage(jid, { text: '🧞 *AKINATOR*\n\nI give up, you beat me! 🏳️' }, { quoted: msg });
    }
    session.currentQ = step.text;
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
            const session = {
                answers: [], wrong: [], currentQ: '', guess: null,
                state: 'asking', lastMsgId: '', busy: true, timer: null
            };
            global.akiSessions[key] = session;
            resetTimer(key);
            try {
                await sock.sendMessage(jid, { text: '🧞 *AKINATOR*\n\nThink of a character (anime, game, cartoon...) and I will guess it in up to ' + MAX_QUESTIONS + ' questions!' }, { quoted: msg });
                await advance(sock, jid, msg, key, session);
            } catch (e) {
                console.error('❌ [AKI] start failed:', e.message);
                endSession(key);
                return sock.sendMessage(jid, { text: '⚠️ Could not start Akinator right now. Try again in a moment.' }, { quoted: msg });
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
                `I ask up to ${MAX_QUESTIONS} questions, but I guess earlier if I'm sure.`
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
        if (!session || session.busy) return;

        // Must be a reply to my latest Akinator message
        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        if (!quotedMsgId || quotedMsgId !== session.lastMsgId) return;

        const input = (args || '').toString().trim().toLowerCase();
        session.busy = true;
        resetTimer(key);

        try {
            // ── Reply to a guess ──
            if (session.state === 'guessing') {
                if (input === 'yes' || input === 'y') {
                    const n = session.answers.length;
                    const name = session.guess?.name || 'your character';
                    endSession(key);
                    return await sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nGreat, I got *${name}* in ${n} questions! 🎉` }, { quoted: msg });
                }
                if (input === 'no' || input === 'n') {
                    if (session.guess?.name) session.wrong.push(session.guess.name);
                    session.guess = null;
                    if (session.answers.length >= MAX_QUESTIONS) {
                        endSession(key);
                        return await sock.sendMessage(jid, { text: '🧞 *AKINATOR*\n\nI give up, you beat me! 🏳️' }, { quoted: msg });
                    }
                    return await advance(sock, jid, msg, key, session);
                }
                return await sock.sendMessage(jid, { text: 'Reply with *yes* or *no*.' }, { quoted: msg });
            }

            // ── Reply to a question ──
            if (input === 'back') {
                if (!session.answers.length) {
                    return await sock.sendMessage(jid, { text: "⚠️ Can't go back any further." }, { quoted: msg });
                }
                const last = session.answers.pop();
                session.currentQ = last.q;
                return await sendQuestion(sock, jid, msg, session);
            }

            if (!(input in ANSWER_MAP)) {
                return await sock.sendMessage(jid, { text: 'Reply with: yes | no | idk | prob | probnot' }, { quoted: msg });
            }

            session.answers.push({ q: session.currentQ, a: ANSWER_MAP[input] });
            try {
                await advance(sock, jid, msg, key, session);
            } catch (e) {
                session.answers.pop(); // undo so the player can answer again
                throw e;
            }
        } catch (e) {
            console.error('❌ [AKI] answer failed:', e.message);
            await sock.sendMessage(jid, { text: '⚠️ Akinator had a hiccup. Reply to my last message again, or use `aki stop`.' }, { quoted: msg });
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
