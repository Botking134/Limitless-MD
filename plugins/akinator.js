// plugins/akinator.js  (Groq-powered Akinator)
// Usage:
//   .aki            -> help
//   .aki start      -> start a game
//   .aki stop       -> stop your game
// Answer by REPLYING to the bot's message with: yes | no | idk | prob | probnot
// ("back" undoes your last answer)
//
// The genie asks up to MAX_QUESTIONS questions and makes ONE guess, only when it is
// sure (enough questions asked, high confidence, and the guess passes a second
// fact-check against every answer). After that guess the game is over and the
// command cools down for exactly 2 minutes.

const axios = require('axios');
const config = require('../config');
const { normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('../helpers/Message');

global.akiSessions = global.akiSessions || {};
global.akiCooldowns = global.akiCooldowns || {};

// ─── SETTINGS ────────────────────────────────────────────────────
const MAX_QUESTIONS = 40;               // at this point it must guess
const MIN_QUESTIONS_BEFORE_GUESS = 20;  // never guess before this many answers
const MIN_CONFIDENCE = 90;              // model's own confidence needed to guess
const MAX_VERIFY_REJECTIONS_BEFORE_PATIENCE = 4;
const SESSION_TTL = 15 * 60 * 1000;     // 15 min of inactivity ends the game
const COOLDOWN_MS = 2 * 60 * 1000;      // EXACTLY 2 minutes after the genie's guess
const COOLDOWN_SCOPE = 'user';          // 'user' = per player, 'chat' = per chat, 'global' = everyone
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant']; // tried in order
const GROQ_DEADLINE_MS = 45000;         // stop trying more models/variants after this long
const PINTEREST_SEARCH = 'https://apis.davidcyril.name.ng/search/pinterest';

const ANSWER_MAP = {
    yes: 'Yes', y: 'Yes',
    no: 'No', n: 'No',
    idk: "Don't know", "i don't know": "Don't know", dontknow: "Don't know",
    prob: 'Probably', probably: 'Probably', p: 'Probably',
    probnot: 'Probably not', 'prob not': 'Probably not', probablynot: 'Probably not', pn: 'Probably not'
};

const SYSTEM_PROMPT =
`You are Akinator, the genie who guesses the FICTIONAL character the player is thinking of. Players pick characters from anime, manga, DC, Marvel, cartoons, comics, games, movies and series. They very often pick a SPECIFIC FORM, VERSION, SUIT or ALTERNATE of a famous character (for example "Cosmic Armor Superman", "Super Saiyan Blue Goku", "Zombie Spider-Man", "Mark 85 Iron Man").

How to play:
- Ask ONE short yes/no question at a time. Never repeat or reword a question that was already asked.
- Questions 1-6: establish the medium/universe (anime, DC, Marvel, video game, cartoon, movie...), gender, species (human, alien, robot, animal, god...), and hero or villain.
- Then narrow down with powers, abilities, costume or armor, appearance, origin, team, role and signature items.
- Before guessing a famous character, ask whether the player means a special form, version, suit, alternate universe or power-up of that character. Different forms of one character are different answers.
- Yes and No answers are strong evidence. Probably and Probably not are weak evidence. Don't know is no evidence. NEVER name a character that contradicts a Yes or No answer.
- Keep a shortlist of the 3 most likely characters in "candidates" and keep it consistent with every answer so far.
- Guess ONLY when you are at least ${MIN_CONFIDENCE}% sure AND at least ${MIN_QUESTIONS_BEFORE_GUESS} questions have been answered. You only get ONE guess, so do not guess to hurry things along.
- Never guess a name on the "rejected" list. Once ${MAX_QUESTIONS} questions have been answered you MUST guess.
Reply with ONLY one JSON object and nothing else:
{"type":"question","text":"<your question>","candidates":["<name>","<name>","<name>"]}
or
{"type":"guess","name":"<character name, including the specific form if any>","from":"<series, universe or game>","confidence":<0-100>,"candidates":["<name>","<name>"]}`;

const VERIFY_PROMPT =
`You are a strict fact-checker for an Akinator-style guessing game. You are given the questions asked, the player's answers, and a proposed guess.
Check the guess against EVERY answer. Yes and No are strong evidence. Probably and Probably not are weak. Don't know is no evidence.
Fail the guess if the character clearly contradicts any Yes/No answer, or if you do not know the character well enough to be sure it fits. Players may mean a specific form or version of a character, so also say if a different form fits better.
Reply with ONLY one JSON object and nothing else:
{"fits":true or false,"contradictions":["<short reason>"],"better_candidates":["<name>"]}`;

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

// ─── COOLDOWN (starts when the genie makes its guess) ────────────
function cooldownKey(jid, sender) {
    if (COOLDOWN_SCOPE === 'chat') return jid;
    if (COOLDOWN_SCOPE === 'global') return 'all';
    return sender;
}

function cooldownLeft(jid, sender) {
    const k = cooldownKey(jid, sender);
    const until = global.akiCooldowns[k];
    if (!until) return 0;
    const left = until - Date.now();
    if (left <= 0) { delete global.akiCooldowns[k]; return 0; }
    return left;
}

function startCooldown(jid, sender) {
    const k = cooldownKey(jid, sender);
    const until = Date.now() + COOLDOWN_MS;
    global.akiCooldowns[k] = until;
    const t = setTimeout(() => { if (global.akiCooldowns[k] === until) delete global.akiCooldowns[k]; }, COOLDOWN_MS + 1000);
    if (t.unref) t.unref();
}

function formatLeft(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

// NOTE: the word "AKINATOR" must stay in every question message below. helpers/GameInterceptors.js
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
    if (session.candidates.length) text += `\nYour current shortlist: ${session.candidates.join(', ')}`;
    if (session.rejected.length) text += `\nRejected guesses (never guess these): ${session.rejected.map(r => r.name).join(', ')}`;
    return text;
}

// "gpt-oss"-style models think before answering, and that thinking counts
// against the token limit (the old fixed 250 could run out mid-answer).
const isReasoningModel = (model) => /gpt-oss|qwen3|deepseek-r1/i.test(model);

// Turns an axios error into the one line that actually explains it.
function describeError(e) {
    const d = e.response?.data;
    const err = d?.error;
    const reason = err
        ? [err.code || err.type, err.message].filter(Boolean).join(' - ')
        : (typeof d === 'string' ? d : d ? JSON.stringify(d) : '');
    return `${e.response?.status || 'ERR'} ${String(reason || e.message).replace(/\s+/g, ' ').slice(0, 300)}`;
}

// Tries each model, and for each model a few request shapes from strictest to
// plainest. Groq's JSON mode answers HTTP 400 ("json_validate_failed") whenever
// the model's text is not perfectly valid JSON, so a plain request is tried
// next, and when the 400 carries the model's own text we use that directly.
async function callGroq(userContent, systemPrompt = SYSTEM_PROMPT) {
    const apiKey = config.groqApiKey;
    if (!apiKey) throw new Error('GROQ API key is not set in config');
    const started = Date.now();
    let lastErr;

    for (const model of GROQ_MODELS) {
        const base = {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            temperature: 0.4
        };
        const json = { response_format: { type: 'json_object' } };
        const variants = isReasoningModel(model)
            ? [
                { ...base, max_completion_tokens: 1500, reasoning_effort: 'low', ...json },
                { ...base, max_completion_tokens: 1500, reasoning_effort: 'low' },
                { ...base, max_completion_tokens: 1500 }
              ]
            : [
                { ...base, max_tokens: 400, ...json },
                { ...base, max_tokens: 400 }
              ];

        for (const body of variants) {
            if (Date.now() - started > GROQ_DEADLINE_MS) break;
            try {
                const res = await axios.post(GROQ_URL, body, {
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    timeout: 20000
                });
                const content = res.data?.choices?.[0]?.message?.content || '';
                if (content.trim()) return content;
                lastErr = new Error(`Empty reply from ${model}`);
                console.error(`❌ [AKI] Groq ${model}: empty reply`);
            } catch (e) {
                lastErr = e;
                console.error(`❌ [AKI] Groq ${model}${body.response_format ? ' (json mode)' : ''}: ${describeError(e)}`);
                // Groq attaches the model's text to a JSON-mode failure: use it if it parses.
                const salvaged = e.response?.data?.error?.failed_generation;
                if (salvaged && parseJson(salvaged)) return salvaged;
            }
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

// Second opinion: does the proposed guess really fit every answer?
// If the check itself cannot run, the guess is allowed (it must not block the game).
async function verifyGuess(session, guess) {
    const prompt =
        transcript(session) +
        `\n\nProposed guess: ${guess.name}${guess.from ? ` (${guess.from})` : ''}` +
        `\n\nReply with the JSON now.`;
    try {
        const data = parseJson(await callGroq(prompt, VERIFY_PROMPT));
        if (!data || typeof data.fits !== 'boolean') return { fits: true, contradictions: [], better: [] };
        return {
            fits: data.fits,
            contradictions: Array.isArray(data.contradictions) ? data.contradictions.map(String).slice(0, 3) : [],
            better: Array.isArray(data.better_candidates) ? data.better_candidates.map(String).slice(0, 3) : []
        };
    } catch (e) {
        console.error('⚠️ [AKI] guess check unavailable, allowing the guess:', e.message);
        return { fits: true, contradictions: [], better: [] };
    }
}

function rememberCandidates(session, data) {
    if (Array.isArray(data.candidates)) {
        const list = data.candidates.map(x => String(x).trim()).filter(Boolean).slice(0, 5);
        if (list.length) session.candidates = list;
    }
}

// Returns { type: 'question', text } or { type: 'guess', name, from } or { type: 'giveup' }
async function nextStep(session) {
    const answered = session.answers.length;
    const mustGuess = answered >= MAX_QUESTIONS;
    const askedSet = new Set(session.answers.map(x => norm(x.q)));
    let hint = '';
    let lastGuess = null;

    for (let attempt = 0; attempt < 4; attempt++) {
        const prompt = transcript(session) + (hint ? `\n\n${hint}` : '') + '\n\nReply with the JSON now.';
        const data = parseJson(await callGroq(prompt));
        if (!data) { hint = 'Your last reply was not valid JSON. Reply with ONLY the JSON object.'; continue; }
        rememberCandidates(session, data);

        if (data.type === 'guess' && data.name) {
            const name = String(data.name).trim();
            const from = String(data.from || '').trim();
            lastGuess = { type: 'guess', name, from };

            if (mustGuess) return lastGuess;

            const rejected = session.rejected.find(r => norm(r.name) === norm(name));
            if (rejected && answered - rejected.at < 5) {
                hint = `${name} was already rejected by the fact-check. Ask more questions before suggesting anyone.`; continue;
            }
            if (answered < MIN_QUESTIONS_BEFORE_GUESS) {
                hint = `Too early to guess (${answered} of ${MIN_QUESTIONS_BEFORE_GUESS} questions). Ask another yes/no question.`; continue;
            }
            if (Number(data.confidence || 0) < MIN_CONFIDENCE) {
                hint = `You are not confident enough (need ${MIN_CONFIDENCE}%). Ask another question that separates your shortlist.`; continue;
            }

            const check = await verifyGuess(session, lastGuess);
            if (!check.fits) {
                session.rejected.push({ name, at: answered });
                const why = check.contradictions.length ? check.contradictions.join('; ') : 'it does not fit the answers well enough';
                hint = `A fact-check rejected ${name}: ${why}.` +
                       (check.better.length ? ` Characters that may fit better: ${check.better.join(', ')}.` : '') +
                       ` Do not guess yet. Ask a question that separates the remaining candidates, including special forms or versions.`;
                console.log(`[AKI] fact-check rejected "${name}" at ${answered} answers: ${why}`);
                continue;
            }
            return lastGuess;
        }

        if (data.type === 'question' && data.text) {
            if (mustGuess) { hint = `${MAX_QUESTIONS} questions are answered. You MUST guess now.`; continue; }
            if (askedSet.has(norm(data.text))) { hint = 'That question was already asked. Ask a different one.'; continue; }
            return { type: 'question', text: String(data.text).trim() };
        }

        hint = 'Invalid format. Reply with ONLY one JSON object of type "question" or "guess".';
    }

    // Out of attempts. At the question limit we must still answer.
    if (mustGuess) {
        if (lastGuess) return lastGuess;
        if (session.candidates[0]) return { type: 'guess', name: session.candidates[0], from: '' };
        return { type: 'giveup' };
    }
    const fallbacks = [
        'Is your character from an anime?', 'Is your character male?', 'Is your character human?',
        'Does your character have special powers?', 'Is your character a villain?',
        'Does your character use a weapon?', 'Does your character have a cellphone?',
        'Is your character a main character?', 'Does your character fly?',
        'Does your character wear armor or a special suit?', 'Is your character from a comic book?',
        'Is your character a special form or version of another character?'
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

// The ONE guess. The game ends here and the 2-minute cooldown starts the moment
// the guess is sent (so "2 minutes" is measured from the guess itself).
async function sendGuess(sock, jid, msg, key, session, guess) {
    const { sender } = sessionKey(msg);
    const caption =
        `🧞 *AKINATOR*\n\n` +
        `I think it's... *${guess.name}*\n` +
        (guess.from ? `_${guess.from}_\n` : '') +
        `\nGuessed in ${session.answers.length} questions 🎯\n\n` +
        `🏁 *Game over.* The genie is resting for 2 minutes. Play again after that with \`aki start\`.`;

    // Stop the game first, so nothing can answer it while the picture loads.
    endSession(key);

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
    startCooldown(jid, sender);
    return sent;
}

// Ask the model for the next step and send it
async function advance(sock, jid, msg, key, session) {
    const step = await nextStep(session);
    if (step.type === 'guess') return sendGuess(sock, jid, msg, key, session, step);
    if (step.type === 'giveup') {
        const { sender } = sessionKey(msg);
        endSession(key);
        const sent = await sock.sendMessage(jid, { text: '🧞 *AKINATOR*\n\nI give up, you beat me! 🏳️\n\n🏁 *Game over.* The genie is resting for 2 minutes.' }, { quoted: msg });
        startCooldown(jid, sender);
        return sent;
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
        const { jid, sender, key } = sessionKey(msg);
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
            const left = cooldownLeft(jid, sender);
            if (left > 0) {
                return sock.sendMessage(jid, { text: `⏳ The genie is resting. Try again in *${formatLeft(left)}*.` }, { quoted: msg });
            }
            const session = {
                answers: [], candidates: [], rejected: [], currentQ: '',
                state: 'asking', lastMsgId: '', busy: true, timer: null
            };
            global.akiSessions[key] = session;
            resetTimer(key);
            try {
                await sock.sendMessage(jid, { text: '🧞 *AKINATOR*\n\nThink of a character (anime, DC, Marvel, game, cartoon...) and I will guess it in up to ' + MAX_QUESTIONS + ' questions!\n\n_I only get one guess, so I take my time._' }, { quoted: msg });
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
                `Answer by replying to my message with:\nyes | no | idk | prob | probnot\n` +
                `(\`back\` undoes your last answer)\n\n` +
                `I ask up to ${MAX_QUESTIONS} questions and make *one* guess when I'm sure. ` +
                `After my guess the game ends and I rest for 2 minutes.`
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

        // Must be a reply to my latest Akinator question
        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        if (!quotedMsgId || quotedMsgId !== session.lastMsgId) return;

        const input = (args || '').toString().trim().toLowerCase();
        session.busy = true;
        resetTimer(key);

        try {
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
