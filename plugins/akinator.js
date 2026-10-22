// plugins/akinator.js  (AI Akinator v2)
// Usage:
//   .aki            -> help
//   .aki start      -> start a game
//   .aki stop       -> stop your game
// Answer by REPLYING to the bot's message: yes | no | idk | prob | probnot  ("back" undoes the last answer)
//
// How it differs from v1 (which just chatted with the AI):
//  - The AI keeps a RANKED LIST OF CANDIDATES every turn and picks questions that split the top ones.
//  - Q1 is multiple choice (anime / game / movie-TV / cartoon / comic / several).
//  - Each question has a TOPIC and every topic has a limit, so it can't ask four colour questions
//    or three wing questions. Reworded repeats are caught by CONCEPT, not exact text.
//  - Questions must be short and plain (12 words, one yes/no).
//  - It guesses EARLY when a candidate leads, and can guess up to 3 times.
//  - Before showing a guess, a second AI check looks for answers the guess CONTRADICTS.
//    A guess that breaks two or more of your Yes/No answers is thrown away.
//  - "Probably" / "Don't know" are weak evidence, and one wrong answer from the player is tolerated.

const axios = require('axios');
const config = require('../config');
const { normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('../helpers/Message');
const BotRouter = require('../helpers/BotRouter');

global.akiSessions = global.akiSessions || {};
global.akiCooldowns = global.akiCooldowns || {};

// ─── SETTINGS ────────────────────────────────────────────────────
const MAX_QUESTIONS = 25;
const MIN_QUESTIONS_BEFORE_GUESS = 7;
const FORCE_GUESS_AT = 18;            // from here it guesses its best candidate
const MAX_GUESSES = 3;
const QUESTIONS_BETWEEN_GUESSES = 3;
const COOLDOWN_MS = 2 * 60 * 1000;    // rest after a finished game
const SESSION_TTL = 15 * 60 * 1000;   // 15 min of inactivity ends the game

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b']; // tried in order
const PINTEREST_SEARCH = 'https://apis.davidcyril.name.ng/search/pinterest';

// How many questions each topic may use in one game. Costume details share ONE slot ("outfit").
const TOPIC_LIMITS = {
    medium: 1, series: 4, gender: 1, species: 1, role: 1, powers: 3, flight: 1,
    weapon: 1, outfit: 1, hair: 1, age: 1, team: 2, setting: 2, personality: 1, other: 3
};

const ANSWER_MAP = {
    yes: 'Yes', y: 'Yes',
    no: 'No', n: 'No',
    idk: "Don't know", "i don't know": "Don't know", dontknow: "Don't know",
    prob: 'Probably', probably: 'Probably', p: 'Probably',
    probnot: 'Probably not', 'prob not': 'Probably not', probablynot: 'Probably not', pn: 'Probably not'
};

const MEDIUM_CHOICES = [
    { n: '1', label: 'Anime / Manga', words: ['anime', 'manga'] },
    { n: '2', label: 'Video game', words: ['game', 'videogame', 'video game'] },
    { n: '3', label: 'Movie / TV show', words: ['movie', 'tv', 'film', 'show', 'series'] },
    { n: '4', label: 'Cartoon / Western animation', words: ['cartoon', 'animation'] },
    { n: '5', label: 'Comic book', words: ['comic', 'comics'] },
    { n: '6', label: 'Several of these (e.g. Marvel or DC: comics and movies)', words: ['several', 'both', 'many'] }
];

const FALLBACK_QUESTIONS = [
    { topic: 'gender', text: 'Is your character male?' },
    { topic: 'species', text: 'Is your character human?' },
    { topic: 'role', text: 'Is your character a hero?' },
    { topic: 'powers', text: 'Does your character have supernatural powers?' },
    { topic: 'age', text: 'Is your character an adult?' },
    { topic: 'team', text: 'Is your character part of a team or group?' },
    { topic: 'setting', text: 'Is your character from a fantasy or sci-fi world?' },
    { topic: 'personality', text: 'Is your character known for being funny?' }
];

const SYSTEM_PROMPT =
`You are Akinator, a genie who guesses the FICTIONAL character the player is thinking of (anime, manga, games, cartoons, movies, TV, comics).
Each turn you receive the questions asked so far with the player's answers.
Answer strength: Yes/No = strong. Probably/Probably not = weak. Don't know = no information.
Players sometimes make one mistake, so prefer the character that fits MOST answers instead of dropping a candidate over a single contradicting answer.

Every turn:
1. List up to 6 candidate characters that fit the answers (name, series, confidence 0-100). Reconsider ALL answers from scratch each turn. Weigh identity facts (medium, series, role, kind of powers) far above costume details.
2. Pick the next question. It must help tell the top candidates apart.

Question rules:
- ONE plain yes/no question, at most 12 words. No lists of options, no franchise trivia.
- Prefer big questions (series, role, kind of powers, team, setting) over small details (clothes, colors, weapon types). Costume details are a LAST resort.
- Never ask about something already covered, even in different words.
- Give the question a "topic" from: ${Object.keys(TOPIC_LIMITS).join(', ')}.

Reply with ONLY this JSON object:
{"candidates":[{"name":"","from":"","confidence":0}],"topic":"","question":""}`;

const VERIFY_PROMPT =
`You check whether a guessed character fits a player's answers.
You get numbered questions with answers, and a guessed character.
List the numbers of the questions whose Yes/No answer the character CLEARLY contradicts (ignore Probably/Don't know answers).
Reply with ONLY this JSON object: {"contradictions":[1,2]}`;

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

const GAME_OVER_TEXT = '🏁 *Game over.* The genie is resting for 2 minutes. Play again after that with `aki start`.';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// ── Repeat detection by CONCEPT (catches "wings" asked three different ways) ──
const STOP = new Set(['is', 'the', 'character', 'characters', 'a', 'an', 'of', 'does', 'do', 'have', 'has', 'to', 'from', 'in', 'as', 'that', 'this', 'her', 'his', 'their', 'your', 'she', 'he', 'they', 'it', 'are', 'be', 'or', 'and', 'with', 'on', 'by', 'for', 'at', 'you', 'can', 'use', 'part', 'pair', 'primarily', 'any', 'kind']);
const CONCEPTS = {
    fly: ['fly', 'flying', 'flight', 'wing', 'wings'],
    gun: ['gun', 'guns', 'pistol', 'pistols', 'firearm', 'firearms', 'rifle'],
    blade: ['blade', 'blades', 'sword', 'swords', 'knife', 'dagger', 'axe'],
    bow: ['bow', 'arrow', 'arrows'],
    color: ['color', 'colour', 'red', 'blue', 'green', 'yellow', 'purple', 'black', 'white', 'gold', 'golden', 'orange', 'pink', 'silver'],
    armor: ['armor', 'armour', 'mask', 'helmet', 'costume', 'outfit', 'suit', 'uniform', 'cape'],
    insect: ['insect', 'sting', 'stinger', 'stingers', 'antenna', 'antennae', 'bug'],
    size: ['shrink', 'shrinking', 'grow', 'growing', 'size', 'small', 'tiny', 'giant', 'tall', 'short'],
    speed: ['speed', 'fast', 'quickly'],
    strength: ['strength', 'strong'],
    reality: ['reality', 'probability'],
    teleport: ['teleport', 'teleportation'],
    hair: ['hair', 'blonde', 'bald', 'ponytail'],
    glasses: ['glasses', 'spectacles']
};
const WORD_TO_CONCEPT = {};
for (const [concept, words] of Object.entries(CONCEPTS)) for (const w of words) WORD_TO_CONCEPT[w] = concept;

function tokens(text) {
    return norm(text).split(' ').filter(w => w && !STOP.has(w));
}
function conceptsOf(text) {
    const set = new Set();
    for (const w of tokens(text)) if (WORD_TO_CONCEPT[w]) set.add(WORD_TO_CONCEPT[w]);
    return set;
}
function similar(a, b) {
    if (norm(a) === norm(b)) return true;
    const ta = new Set(tokens(a)), tb = new Set(tokens(b));
    const inter = [...ta].filter(w => tb.has(w)).length;
    const union = new Set([...ta, ...tb]).size || 1;
    if (inter / union >= 0.5) return true;
    const ca = conceptsOf(a), cb = conceptsOf(b);
    return [...ca].some(c => cb.has(c));
}

function topicCounts(session) {
    const counts = {};
    for (const x of session.answers) counts[x.topic] = (counts[x.topic] || 0) + 1;
    return counts;
}
function remainingTopics(session) {
    const counts = topicCounts(session);
    return Object.keys(TOPIC_LIMITS).filter(t => (counts[t] || 0) < TOPIC_LIMITS[t]);
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

function choiceText() {
    return (
        `🧞 *AKINATOR*\n\n` +
        `*Q1:* Where is your character from?\n\n` +
        MEDIUM_CHOICES.map(c => `${c.n}️⃣ ${c.label}`).join('\n') +
        `\n\nReply to this message with a number (1-${MEDIUM_CHOICES.length}).`
    );
}

// ─── THE AI ──────────────────────────────────────────────────────
async function callGroq(system, userContent, { maxTokens = 700 } = {}) {
    const apiKey = config.groqApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ API key is not set in config');

    let lastErr;
    for (const model of GROQ_MODELS) {
        const reasoning = /gpt-oss/i.test(model);
        try {
            const res = await axios.post(GROQ_URL, {
                model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: userContent }
                ],
                temperature: 0.3,
                // gpt-oss "thinks" before answering and that counts against the limit, so it needs room
                max_tokens: reasoning ? 2500 : maxTokens,
                response_format: { type: 'json_object' },
                ...(reasoning ? { reasoning_effort: 'low' } : {})
            }, {
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 30000
            });
            const content = (res.data?.choices?.[0]?.message?.content || '').trim();
            if (content) return content;
            lastErr = new Error('Empty answer from the AI');
        } catch (e) {
            lastErr = e;
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

function transcript(session) {
    const lines = session.answers.map((x, i) => `Q${i + 1} [${x.topic}]: ${x.q} -> ${x.a}`);
    return lines.length ? lines.join('\n') : '(no questions asked yet)';
}

function buildPrompt(session, hint) {
    const excluded = [...session.wrong, ...session.rejected];
    let text = transcript(session);
    text += `\n\nQuestions answered so far: ${session.answers.length}`;
    text += `\nTopics you may still ask about: ${remainingTopics(session).join(', ')}`;
    if (excluded.length) text += `\nExcluded characters (never list them as candidates): ${excluded.join(', ')}`;
    if (hint) text += `\n\n${hint}`;
    return text + '\n\nReply with the JSON now.';
}

function cleanCandidates(raw, session) {
    const excluded = [...session.wrong, ...session.rejected].map(norm);
    if (!Array.isArray(raw)) return [];
    return raw
        .map(c => ({ name: String(c?.name || '').trim(), from: String(c?.from || '').trim(), confidence: Number(c?.confidence) || 0 }))
        .filter(c => c.name && !excluded.includes(norm(c.name)))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 6);
}

// Decides if the top candidate is strong enough to guess now.
function wantsGuess(session, cands) {
    const n = session.answers.length;
    if (!cands.length) return false;
    if (n < MIN_QUESTIONS_BEFORE_GUESS) return false;
    if (session.guessesMade > 0 && n - session.lastGuessAt < QUESTIONS_BETWEEN_GUESSES) return false;
    const [top, second] = cands;
    const margin = top.confidence - (second ? second.confidence : 0);
    if (n >= FORCE_GUESS_AT) return true;
    if (top.confidence >= 75) return true;
    if (top.confidence >= 55 && margin >= 20) return true;
    return false;
}

// Returns a problem description (sent back to the AI as a hint) or null when the question is fine.
function checkQuestion(session, data) {
    const text = String(data?.question || '').trim();
    const topic = String(data?.topic || '').toLowerCase().trim();
    if (!text) return 'You must include a "question".';
    if (!TOPIC_LIMITS[topic]) return `The topic must be one of: ${Object.keys(TOPIC_LIMITS).join(', ')}.`;
    if ((topicCounts(session)[topic] || 0) >= TOPIC_LIMITS[topic]) {
        return `The topic "${topic}" is used up. Choose a different topic: ${remainingTopics(session).join(', ')}.`;
    }
    if (text.split(/\s+/).length > 14 || text.length > 100) return 'That question is too long. Use at most 12 words.';
    if (!text.endsWith('?')) return 'The question must end with a question mark.';
    if ((text.match(/\bor\b/gi) || []).length > 1) return 'No lists of options. Ask ONE simple yes/no question.';
    const dup = session.answers.find(a => similar(a.q, text));
    if (dup) return `That is too similar to an earlier question ("${dup.q}"). Ask about something different.`;
    return null;
}

function fallbackQuestion(session) {
    const counts = topicCounts(session);
    return FALLBACK_QUESTIONS.find(f =>
        (counts[f.topic] || 0) < TOPIC_LIMITS[f.topic] && !session.answers.some(a => similar(a.q, f.text))
    ) || null;
}

// Returns { type: 'guess', candidates } | { type: 'question', text, topic } | { type: 'giveup' }
async function nextStep(session, { noGuess = false } = {}) {
    const n = session.answers.length;
    const atCap = n >= MAX_QUESTIONS;
    let hint = '';
    let lastCandidates = [];
    let gotResponse = false;   // did the AI answer at all (even badly)?
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        let data;
        try {
            data = parseJson(await callGroq(SYSTEM_PROMPT, buildPrompt(session, hint)));
            gotResponse = true;
        } catch (e) {
            lastError = e;
            continue;
        }
        if (!data) { hint = 'Reply with ONLY the JSON object.'; continue; }

        const cands = cleanCandidates(data.candidates, session);
        if (cands.length) lastCandidates = cands;

        if (cands.length && !noGuess && (wantsGuess(session, cands) || atCap)) return { type: 'guess', candidates: cands };
        if (atCap) break;

        const problem = checkQuestion(session, data);
        if (problem) { hint = problem; continue; }

        return { type: 'question', text: String(data.question).trim(), topic: String(data.topic).toLowerCase().trim() };
    }

    // The AI never answered (outage, bad key...): say so, instead of limping on with canned questions
    // and then claiming "I give up". The player can simply answer again.
    if (!gotResponse) throw lastError || new Error('The AI did not answer');

    if (atCap) return lastCandidates.length && !noGuess ? { type: 'guess', candidates: lastCandidates } : { type: 'giveup' };
    if (lastCandidates.length && n >= MIN_QUESTIONS_BEFORE_GUESS && !noGuess) return { type: 'guess', candidates: lastCandidates };
    const fb = fallbackQuestion(session);
    if (fb) return { type: 'question', text: fb.text, topic: fb.topic };
    return lastCandidates.length && !noGuess ? { type: 'guess', candidates: lastCandidates } : { type: 'giveup' };
}

// Second opinion: does the guess break the player's firm answers? Fails open (accepts) if the AI is unreachable.
async function guessFits(session, cand) {
    try {
        const prompt = `${session.answers.map((x, i) => `Q${i + 1}: ${x.q} -> ${x.a}`).join('\n')}\n\nGuessed character: ${cand.name}${cand.from ? ` (${cand.from})` : ''}\n\nReply with the JSON now.`;
        const data = parseJson(await callGroq(VERIFY_PROMPT, prompt, { maxTokens: 200 }));
        const bad = Array.isArray(data?.contradictions) ? data.contradictions.filter(x => Number.isFinite(Number(x))) : [];
        return bad.length < 2;   // one clash is tolerated: players make mistakes
    } catch (e) {
        return true;
    }
}

async function pickVerifiedGuess(session, candidates) {
    for (const cand of candidates.slice(0, 3)) {
        if (await guessFits(session, cand)) return cand;
        session.rejected.push(cand.name);   // silently dropped, never shown to the player
    }
    return null;
}

// ─── SENDING ─────────────────────────────────────────────────────
// A reply counts if it answers ANY bot message from the current turn (the question itself or a
// "reply with..." hint), so a player who replies to the latest message is never silently ignored.
function markMain(session, sent) {
    session.lastMsgId = sent?.key?.id || '';
    session.validIds = new Set(session.lastMsgId ? [session.lastMsgId] : []);
}
async function hint(sock, jid, msg, session, text) {
    const sent = await sock.sendMessage(jid, { text }, { quoted: msg });
    if (sent?.key?.id) (session.validIds = session.validIds || new Set()).add(sent.key.id);
    return sent;
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
    markMain(session, sent);
    session.state = 'asking';
}

async function sendGuess(sock, jid, msg, session, guess) {
    session.state = 'guessing';
    session.guess = guess;
    session.guessesMade += 1;
    session.lastGuessAt = session.answers.length;

    const caption =
        `🧞 *AKINATOR*\n\n` +
        `I think it's... *${guess.name}*\n` +
        (guess.from ? `_${guess.from}_\n` : '') +
        `\nGuess ${session.guessesMade} of ${MAX_GUESSES} · after ${session.answers.length} questions 🎯\n\n` +
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
    markMain(session, sent);
}

async function giveUp(sock, jid, msg, key) {
    endSession(key);
    startCooldown(key);
    return sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nI give up, you beat me! 🏳️\n\n${GAME_OVER_TEXT}` }, { quoted: msg });
}

// Ask the AI for the next step and send it
async function advance(sock, jid, msg, key, session) {
    let step = await nextStep(session);
    if (step.type === 'guess') {
        const verified = await pickVerifiedGuess(session, step.candidates);
        if (verified) return sendGuess(sock, jid, msg, session, verified);
        step = await nextStep(session, { noGuess: true });   // every candidate clashed: keep asking
    }
    if (step.type === 'giveup') return giveUp(sock, jid, msg, key);
    session.currentQ = step.text;
    session.currentTopic = step.topic;
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
                return sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nThe genie is resting. Try again in ${Math.ceil(rest / 1000)}s.` }, { quoted: msg });
            }

            const session = {
                answers: [], wrong: [], rejected: [], currentQ: '', currentTopic: '', guess: null,
                guessesMade: 0, lastGuessAt: 0,
                state: 'choice', lastMsgId: '', validIds: new Set(), busy: true, timer: null
            };
            global.akiSessions[key] = session;
            resetTimer(key);
            try {
                await sock.sendMessage(jid, {
                    text: `🧞 *AKINATOR*\n\nThink of a character (anime, DC, Marvel, game, cartoon...) and I will guess it in up to ${MAX_QUESTIONS} questions!\n\n_I can guess up to ${MAX_GUESSES} times, so I won't wait too long._`
                }, { quoted: msg });
                const sent = await sock.sendMessage(jid, { text: choiceText() }, { quoted: msg });
                markMain(session, sent);
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
        if (!quotedMsgId || !session.validIds?.has(quotedMsgId)) return;

        const input = (args || '').toString().trim().toLowerCase();
        session.busy = true;
        resetTimer(key);

        try {
            // ── Q1: where is the character from ──
            if (session.state === 'choice') {
                const picked = MEDIUM_CHOICES.find(c => c.n === input || c.words.includes(input));
                if (!picked) {
                    return await hint(sock, jid, msg, session, `Reply with a number from 1 to ${MEDIUM_CHOICES.length}.`);
                }
                session.answers.push({ q: 'Where is your character from?', a: picked.label, topic: 'medium' });
                return await advance(sock, jid, msg, key, session);
            }

            // ── Reply to a guess ──
            if (session.state === 'guessing') {
                if (input === 'yes' || input === 'y') {
                    const n = session.answers.length;
                    const name = session.guess?.name || 'your character';
                    endSession(key);
                    startCooldown(key);
                    return await sock.sendMessage(jid, { text: `🧞 *AKINATOR*\n\nGreat, I got *${name}* in ${n} questions! 🎉\n\n${GAME_OVER_TEXT}` }, { quoted: msg });
                }
                if (input === 'no' || input === 'n') {
                    if (session.guess?.name) session.wrong.push(session.guess.name);
                    session.guess = null;
                    if (session.guessesMade >= MAX_GUESSES || session.answers.length >= MAX_QUESTIONS) {
                        return await giveUp(sock, jid, msg, key);
                    }
                    return await advance(sock, jid, msg, key, session);
                }
                return await hint(sock, jid, msg, session, 'Reply with *yes* or *no*.');
            }

            // ── Reply to a question ──
            if (input === 'back') {
                if (!session.answers.length) {
                    return await hint(sock, jid, msg, session, "⚠️ Can't go back any further.");
                }
                const last = session.answers.pop();
                if (last.topic === 'medium') {
                    session.state = 'choice';
                    const sent = await sock.sendMessage(jid, { text: choiceText() }, { quoted: msg });
                    markMain(session, sent);
                    return;
                }
                session.currentQ = last.q;
                session.currentTopic = last.topic;
                return await sendQuestion(sock, jid, msg, session);
            }

            if (!(input in ANSWER_MAP)) {
                return await hint(sock, jid, msg, session, 'Reply with: yes | no | idk | prob | probnot');
            }

            session.answers.push({ q: session.currentQ, a: ANSWER_MAP[input], topic: session.currentTopic || 'other' });
            try {
                await advance(sock, jid, msg, key, session);
            } catch (e) {
                session.answers.pop();   // undo so the player can answer again
                throw e;
            }
        } catch (e) {
            console.error('❌ [AKI] answer failed:', e.message);
            await hint(sock, jid, msg, session, '⚠️ Akinator had a hiccup. Reply to my last message again, or use `aki stop`.');
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
