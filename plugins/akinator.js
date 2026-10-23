// plugins/akinator.js  (AI Akinator v3)
// Usage:
//   .aki            -> help
//   .aki start      -> start a game
//   .aki stop       -> stop your game
// Answer by REPLYING to the bot's message: yes | no | idk | prob | probnot  ("back" undoes the last answer)
//
// How the AI plays:
//  - The AI keeps a RANKED LIST OF CANDIDATES every turn and picks questions that split the top ones.
//  - Q1 is multiple choice (anime / game / movie-TV / cartoon / comic / several).
//  - It plays like the real Akinator: broad traits first, then a FRANCHISE SWEEP ("Is it from Naruto?"
//    one franchise at a time, a "No" removes a whole group), then traits that split what is left.
//  - Every turn the AI is shown a list of CONFIRMED YES / CONFIRMED NO facts that every candidate must fit.
//  - Each question has a TOPIC and every topic has a limit. Reworded repeats are caught by CONCEPT.
//  - It does NOT rush: no guess before MIN_QUESTIONS_BEFORE_GUESS, and early guesses need a big lead.
//  - Before showing a guess, a second AI check looks for answers the guess CONTRADICTS. A clash with an
//    IDENTITY answer (medium, franchise, gender, species, team, role) throws the guess away at once.
//    A clash with a small detail is tolerated once (players make mistakes).
//  - "Probably" / "Don't know" are weak evidence.
//  - NOTEBOOK: the AI has no memory between calls, so it keeps short working notes (who is ruled out and
//    why, what it is trying to settle next) plus its shortlist. The bot hands them back every turn and
//    throws them away when the game ends. The CONFIRMED YES / NO facts always beat the notebook.
//  - Every question must say which candidates it separates ("splits"), so it can't wander off-topic.

const axios = require('axios');
const config = require('../config');
const { normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('../helpers/Message');
const BotRouter = require('../helpers/BotRouter');

global.akiSessions = global.akiSessions || {};
global.akiCooldowns = global.akiCooldowns || {};

// ─── SETTINGS ────────────────────────────────────────────────────
const MAX_QUESTIONS = 35;
const MIN_QUESTIONS_BEFORE_GUESS = 12;   // never guess before this many answers
const MID_GAME = 20;                     // before this, a guess needs a very big lead
const FORCE_GUESS_AT = 30;               // from here it guesses its best candidate
const MAX_GUESSES = 3;
const QUESTIONS_BETWEEN_GUESSES = 3;
const COOLDOWN_MS = 2 * 60 * 1000;    // rest after a finished game
const SESSION_TTL = 15 * 60 * 1000;   // 15 min of inactivity ends the game

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b']; // tried in order
const PINTEREST_SEARCH = 'https://apis.davidcyril.name.ng/search/pinterest';

// How many questions each topic may use in one game. Costume details share ONE slot ("outfit").
// "series" is the franchise sweep, so it gets the most room.
const TOPIC_LIMITS = {
    medium: 1, series: 7, gender: 1, species: 1, role: 1, powers: 3, flight: 1,
    weapon: 1, outfit: 1, hair: 1, age: 1, team: 2, setting: 2, personality: 2, other: 4
};

// A clash with one of these answers means the guess is wrong, not "the player made a mistake".
const IDENTITY_TOPICS = new Set(['medium', 'series', 'gender', 'species', 'team', 'role']);

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
Each turn you receive the player's answers, grouped as CONFIRMED YES, CONFIRMED NO and weaker hints.
Answer strength: Yes/No = strong. Probably/Probably not = weak. Don't know = no information.

HARD RULES FOR CANDIDATES
- Every candidate must fit ALL the CONFIRMED YES facts and NONE of the CONFIRMED NO facts.
- A "No" to a team, universe or franchise EXCLUDES every member of it. (Example: "No" to "member of the Justice League" rules out Superman, Batman, The Flash, Wonder Woman, Aquaman...)
- A "Yes" to a universe or franchise means ONLY characters from it. (Example: "Yes" to DC Comics and "No" to Marvel.)
- Only if NO candidate fits everything may you list one that breaks a single detail answer.
- Reconsider ALL answers from scratch each turn. Weigh identity facts (medium, series, role, kind of powers) far above costume details.

HOW TO PLAY (this is how the real Akinator wins)
1. Early on, ask broad plain traits: gender, human or not, real or fictional, hair, kind of powers, hero or villain.
2. FRANCHISE SWEEP: ask "Is your character from <popular franchise>?" ONE franchise at a time, most popular first (topic "series"). A "No" removes a whole group. Never ask about a franchise already ruled out or implied.
3. When a franchise or universe is a Yes, ask traits that split ITS members.
4. Do NOT rush. Your "confidence" must be low unless exactly one character fits every answer.

YOUR NOTEBOOK
You get your own notes and shortlist from earlier turns. Use them so you don't re-think old ground, but if they ever clash with the CONFIRMED lists, the CONFIRMED lists win and you must correct the notes.
Write the new notes in "notes" (max 70 words): who is ruled out and the answer that ruled them out, who is still possible, and what you are trying to settle next.

Every turn:
1. List up to 6 candidate characters (name, series, confidence 0-100).
2. Pick the next question. It must help tell the top candidates apart. In "splits", name the candidates it separates (example: "Flash vs Doctor Manhattan") or write "broad trait" if it is an early general question.

Question rules:
- ONE plain yes/no question, at most 12 words. No lists of options.
- Prefer big questions (franchise, role, kind of powers, team, setting) over small details (clothes, colors, weapon types). Costume details are a LAST resort.
- Never ask about something already covered, even in different words.
- Give the question a "topic" from: ${Object.keys(TOPIC_LIMITS).join(', ')}.

Reply with ONLY this JSON object:
{"candidates":[{"name":"","from":"","confidence":0}],"notes":"","topic":"","question":"","splits":""}`;

const VERIFY_PROMPT =
`You check whether a guessed character fits a player's answers.
You get numbered questions with answers, and a guessed character.
List the numbers of the questions whose Yes/No answer the character CLEARLY contradicts (ignore Probably/Don't know answers).
Membership matters: if the answer to "is the character a member of X" is No and the character IS a member of X, that is a contradiction. The same goes for universe, franchise, gender and species questions.
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

// The answers, grouped by strength. LLMs follow an explicit "must fit / must not fit" list
// far better than they follow a plain chat log.
function factSheet(session) {
    const yes = [], no = [], weak = [];
    for (const x of session.answers) {
        if (x.topic === 'medium') yes.push(`Comes from: ${x.a}`);
        else if (x.a === 'Yes') yes.push(x.q);
        else if (x.a === 'No') no.push(x.q);
        else if (x.a === 'Probably' || x.a === 'Probably not') weak.push(`${x.q} -> ${x.a}`);
    }
    const list = (arr) => arr.length ? arr.map(t => `- ${t}`).join('\n') : '- (none yet)';
    let text = `CONFIRMED YES (the character fits ALL of these):\n${list(yes)}\n\nCONFIRMED NO (the character fits NONE of these):\n${list(no)}`;
    if (weak.length) text += `\n\nWEAK HINTS:\n${list(weak)}`;
    return text;
}

function buildPrompt(session, hint) {
    const excluded = [...session.wrong, ...session.rejected];
    let text = factSheet(session);
    if (session.notebook || (session.shortlist && session.shortlist.length)) {
        text += `\n\nYOUR NOTEBOOK (from earlier turns):`;
        if (session.notebook) text += `\n${session.notebook}`;
        if (session.shortlist && session.shortlist.length) text += `\nPrevious shortlist: ${session.shortlist.join('; ')}`;
    }
    text += `\n\nFull log:\n${transcript(session)}`;
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

// ── Notebook ──
const NOTEBOOK_MAX = 700;
function capNotes(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > NOTEBOOK_MAX ? t.slice(t.length - NOTEBOOK_MAX) : t;   // keep the most recent notes
}
function addNote(session, line) {
    session.notebook = capNotes(`${session.notebook || ''} | ${line}`.replace(/^ \| /, ''));
}
function saveNotebook(session, data, cands) {
    if (typeof data?.notes === 'string' && data.notes.trim()) session.notebook = capNotes(data.notes);
    if (cands && cands.length) session.shortlist = cands.slice(0, 4).map(c => `${c.name} (${c.from || '?'}) ${Math.round(c.confidence)}%`);
}

// Decides if the top candidate is strong enough to guess now. The AI's own confidence is
// optimistic, so early guesses need a big lead and nothing is guessed before MIN_QUESTIONS_BEFORE_GUESS.
function wantsGuess(session, cands) {
    const n = session.answers.length;
    if (!cands.length) return false;
    if (n < MIN_QUESTIONS_BEFORE_GUESS) return false;
    if (session.guessesMade > 0 && n - session.lastGuessAt < QUESTIONS_BETWEEN_GUESSES) return false;
    const [top, second] = cands;
    const margin = top.confidence - (second ? second.confidence : 0);
    if (n >= FORCE_GUESS_AT) return true;
    if (n >= MID_GAME) return top.confidence >= 75 && margin >= 20;
    return top.confidence >= 88 && margin >= 30;
}

// Returns a problem description (sent back to the AI as a hint) or null when the question is fine.
function checkQuestion(session, data, cands = []) {
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

    // Relevance: once there is a real shortlist, the question must say which candidates it separates.
    if (session.answers.length >= 6 && cands.length >= 2) {
        const splits = norm(data?.splits);
        const names = cands.slice(0, 4).map(c => norm(c.name)).filter(Boolean);
        const mentionsOne = names.some(nm => splits.includes(nm) || nm.split(' ').some(part => part.length >= 4 && splits.split(' ').includes(part)));
        if (!splits || !mentionsOne) {
            return `In "splits", name which of your top candidates (${names.slice(0, 3).join(', ')}) this question tells apart. If it separates none of them, pick a different question.`;
        }
    }
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

        if (cands.length && !noGuess && (wantsGuess(session, cands) || atCap)) {
            saveNotebook(session, data, cands);
            return { type: 'guess', candidates: cands };
        }
        if (atCap) break;

        const problem = checkQuestion(session, data, cands);
        if (problem) { hint = problem; continue; }

        saveNotebook(session, data, cands);
        return { type: 'question', text: String(data.question).trim(), topic: String(data.topic).toLowerCase().trim() };
    }

    // The AI never answered (outage, bad key...): say so, instead of limping on with canned questions
    // and then claiming "I give up". The player can simply answer again.
    if (!gotResponse) throw lastError || new Error('The AI did not answer');

    if (atCap) return lastCandidates.length && !noGuess ? { type: 'guess', candidates: lastCandidates } : { type: 'giveup' };
    if (lastCandidates.length && n >= FORCE_GUESS_AT && !noGuess) return { type: 'guess', candidates: lastCandidates };
    const fb = fallbackQuestion(session);
    if (fb) return { type: 'question', text: fb.text, topic: fb.topic };
    return lastCandidates.length && !noGuess ? { type: 'guess', candidates: lastCandidates } : { type: 'giveup' };
}

// Second opinion: does the guess break the player's firm answers? Fails open (accepts) if the AI is unreachable.
// A clash with an IDENTITY answer (medium, franchise, gender, species, team, role) rejects the guess at once.
// A clash with a small detail is tolerated once, because players make mistakes.
async function guessFits(session, cand) {
    try {
        const prompt = `${session.answers.map((x, i) => `Q${i + 1}: ${x.q} -> ${x.a}`).join('\n')}\n\nGuessed character: ${cand.name}${cand.from ? ` (${cand.from})` : ''}\n\nReply with the JSON now.`;
        const data = parseJson(await callGroq(VERIFY_PROMPT, prompt, { maxTokens: 200 }));
        const numbers = Array.isArray(data?.contradictions) ? data.contradictions.map(Number).filter(Number.isFinite) : [];
        const clashed = numbers.map(i => session.answers[i - 1]).filter(Boolean);
        if (clashed.some(x => IDENTITY_TOPICS.has(x.topic) && (x.topic === 'medium' || x.a === 'Yes' || x.a === 'No'))) return false;
        return clashed.length < 2;
    } catch (e) {
        return true;
    }
}

async function pickVerifiedGuess(session, candidates) {
    for (const cand of candidates.slice(0, 3)) {
        if (await guessFits(session, cand)) return cand;
        session.rejected.push(cand.name);   // silently dropped, never shown to the player
        addNote(session, `Rejected ${cand.name}: clashes with the confirmed answers.`);
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
                answers: [], wrong: [], rejected: [], notebook: '', shortlist: [], currentQ: '', currentTopic: '', guess: null,
                guessesMade: 0, lastGuessAt: 0,
                state: 'choice', lastMsgId: '', validIds: new Set(), busy: true, timer: null
            };
            global.akiSessions[key] = session;
            resetTimer(key);
            try {
                await sock.sendMessage(jid, {
                    text: `🧞 *AKINATOR*\n\nThink of a character (anime, DC, Marvel, game, cartoon...) and I will guess it in up to ${MAX_QUESTIONS} questions!\n\n_I can guess up to ${MAX_GUESSES} times, but I won't rush: I only guess when I'm sure._`
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
                session.answers.push({ q: 'Where is your character from?', a: picked.label, topic: 'medium', nb: session.notebook });
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
                    if (session.guess?.name) {
                        session.wrong.push(session.guess.name);
                        addNote(session, `Player said NO to ${session.guess.name}.`);
                    }
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
                session.notebook = last.nb || '';   // rewind the notes together with the answer
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

            session.answers.push({ q: session.currentQ, a: ANSWER_MAP[input], topic: session.currentTopic || 'other', nb: session.notebook });
            try {
                await advance(sock, jid, msg, key, session);
            } catch (e) {
                const undone = session.answers.pop();   // undo so the player can answer again
                session.notebook = undone?.nb || '';
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
