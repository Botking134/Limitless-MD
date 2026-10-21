// helpers/Vault8Engine.js
// Vault 8 in the style of the "An Elmwood Trail" website puzzle (vault8.com/fire).
//
// Fixed rules (same every run):
//   forest -> camp -> four tasks (Silence, Maze, Memory, Conundrum), each giving one item
//   (oil lamp, cloth, wood, matchsticks), returning to camp after each -> "Do you have a fire?"
// Fresh content every run: the layout (which path is right, whisper directions, which
// memories get tested) is randomised by the bot, and the AI writes new scenes, options and
// riddles. The bot itself keeps every correct answer, so the AI can never make a puzzle
// unfair. If the AI is unavailable, built-in pools are used instead.
//
// Harshness: like the original, a wrong input is death. The run ends and a new vault must be
// started. (Only an honest "no" to "Do you have a fire?" just sends you back to camp.)

const LINE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━';
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const ITEMS = { silence: '🏮 oil lamp', maze: '🧵 cloth', memory: '🪵 wood', conundrum: '🔥 matchsticks' };
const TASKS = [
    { id: 'silence', label: 'Swamps: Silence', words: ['silence'] },
    { id: 'maze', label: 'Riverside: Maze', words: ['maze'] },
    { id: 'memory', label: 'Riverside: Memory', words: ['memory'] },
    { id: 'conundrum', label: 'Swamps: Conundrum', words: ['conundrum'] }
];
const FOREST_NODES = 4;
const SILENCE_STEPS = 5;
const MAZE_STEPS = 8;
const RIDDLES = 5;

// A wrong input ends the run.
const die = (where, why) => ({
    finished: true, died: true,
    text: `💀 *VAULT 8: YOU DIED* 💀\n${LINE}\n\n_${where}_\n\n${why}\n\n${LINE}\n❌ *Your run is over. Start a new vault to try again.*`
});

// ─── FALLBACK POOLS (used when the AI is down or returns junk) ──
const FOREST_POOL = [
    { scene: 'The trail splits around a rotting signpost.', options: ['Woods', 'River bank'] },
    { scene: 'A fallen tree blocks the path ahead.', options: ['Go around it', 'Climb over it'] },
    { scene: 'Two rags hang from branches, stirring in a wind you cannot feel.', options: ['Blue flag', 'Red flag'] },
    { scene: 'Behind you, a twig snaps. The trail forks again.', options: ['The other way', 'Keep going'] },
    { scene: 'Mist swallows the path. Two sets of footprints lead off.', options: ['Left prints', 'Right prints'] },
    { scene: 'An old well stands where the trail divides.', options: ['Past the well', 'Behind the well'] },
    { scene: 'A crow watches from a stump. Two trails, both quiet.', options: ['Follow the crow', 'Turn away'] },
    { scene: 'The ground turns soft. One way is stone, one is mud.', options: ['Stone path', 'Mud path'] }
];
const SILENCE_POOL = [
    { scene: 'The swamp reeks of rot. Something large breathes somewhere in the water.', options: ['Long route', 'Wade straight through', 'Run for the trees'], quiet: 0 },
    { scene: 'A rusted fence crosses your way, low to the ground.', options: ['Crawl under it', 'Kick it open', 'Shake it loose'], quiet: 0 },
    { scene: 'Footsteps splash behind you. They are getting closer.', options: ['Stay still', 'Call out', 'Sprint'], quiet: 0 },
    { scene: 'A dirt road appears out of the fog, quiet except for the frogs.', options: ['Road', 'Reeds', 'Open water'], quiet: 0 },
    { scene: 'A car lies wrecked in the weeds, doors hanging open.', options: ['Look around', 'Slam the door', 'Honk the horn'], quiet: 0 },
    { scene: 'Its trunk is jammed shut, and the lid is rusted to the frame.', options: ['Manually open it', 'Pry it with a rock', 'Smash the lock'], quiet: 0 },
    { scene: 'Dry leaves cover the ground ahead like paper.', options: ['Step on the bare dirt', 'Walk over the leaves', 'Jump across'], quiet: 0 },
    { scene: 'A flock of birds sleeps in the branch above the path.', options: ['Slip under it slowly', 'Throw a stone', 'Clap your hands'], quiet: 0 }
];
const RIDDLE_POOL = [
    { q: 'I speak without a mouth and answer only when you call. What am I?', answers: ['echo', 'an echo'], explain: 'An echo repeats what you say, but only after you speak.' },
    { q: 'The more of me you take, the more you leave behind. What am I?', answers: ['footsteps', 'steps', 'footstep'], explain: 'Every step you take leaves a footstep behind.' },
    { q: 'I follow you all day but vanish in the dark. What am I?', answers: ['shadow', 'a shadow', 'your shadow'], explain: 'A shadow needs light to exist.' },
    { q: 'I have hands but cannot clap, and a face but cannot smile. What am I?', answers: ['clock', 'a clock', 'watch', 'a watch'], explain: 'A clock has hands and a face.' },
    { q: 'I can fill a room but take up no space. What am I?', answers: ['light', 'sound', 'silence', 'air'], explain: 'Light, sound and air fill a room without taking up any space.' },
    { q: 'What gets wetter the more it dries?', answers: ['towel', 'a towel'], explain: 'A towel dries you by becoming wet.' },
    { q: 'I have cities but no houses, rivers but no water, and roads but no cars. What am I?', answers: ['map', 'a map'], explain: 'A map shows everything but is none of it.' },
    { q: 'The person who makes me does not want me, the person who buys me does not use me, and the person who uses me never knows it. What am I?', answers: ['coffin', 'a coffin'], explain: 'A coffin is made and bought for someone who will not know.' },
    { q: 'I am light as a feather, yet the strongest person cannot hold me for ten minutes. What am I?', answers: ['breath', 'my breath', 'a breath'], explain: 'Nobody can hold their breath that long.' },
    { q: 'I have a head and a tail but no body. What am I?', answers: ['coin', 'a coin'], explain: 'A coin has a head side and a tail side.' },
    { q: 'What can run but never walks, has a mouth but never talks, and has a bed but never sleeps?', answers: ['river', 'a river'], explain: 'A river has a mouth and a bed.' },
    { q: 'I disappear the moment you say my name. What am I?', answers: ['silence'], explain: 'Say it, and the silence is gone.' }
];
const WHISPER = {
    left: ['A whisper brushes your left ear.', 'The voice murmurs from the left, close and cold.', 'Something hisses your name from the left side of the dark.'],
    right: ['A whisper brushes your right ear.', 'The voice murmurs from the right, close and cold.', 'Something hisses your name from the right side of the dark.']
};

// ─── AI CONTENT PACK ─────────────────────────────────────────────
function parseJson(text) {
    try { const m = String(text).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch (e) { return null; }
}
const cleanLabel = (s) => String(s || '').replace(/[*_`~\n]/g, '').trim().slice(0, 28);
const cleanText = (s) => String(s || '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);

async function aiPack(llm) {
    const prompt =
        `You write content for "Vault 8", a tense, quiet, sensory survival puzzle game set at night in a forest, a swamp and a riverside. ` +
        `No gore. Short, eerie, plain sentences. Reply with ONLY one JSON object, no markdown:\n` +
        `{"forest":[{"scene":"<one sentence>","options":["<2-3 word label>","<2-3 word label>"]}, ... exactly ${FOREST_NODES} items],\n` +
        ` "silence":[{"scene":"<one sentence of danger where noise would be fatal>","options":["<quiet choice>","<loud choice>","<loud choice>"],"quiet":0}, ... exactly ${SILENCE_STEPS} items, "quiet" is the 0-based index of the ONLY quiet, careful option],\n` +
        ` "riddles":[{"q":"<a classic-style riddle with a one-word answer>","answers":["<answer>","<synonym>"],"explain":"<one sentence explaining the answer>"}, ... exactly ${RIDDLES} items]}\n` +
        `Be original. Labels under 25 characters. Seed: ${Math.random().toString(36).slice(2)}`;
    const raw = await Promise.race([llm(prompt, 0.95), new Promise((_, rej) => setTimeout(() => rej(new Error('AI timeout')), 30000))]);
    return parseJson(raw);
}

function goodForest(n) {
    return n && cleanText(n.scene) && Array.isArray(n.options) && n.options.length >= 2 &&
        cleanLabel(n.options[0]) && cleanLabel(n.options[1]) && norm(n.options[0]) !== norm(n.options[1]);
}
function goodSilence(n) {
    return n && cleanText(n.scene) && Array.isArray(n.options) && n.options.length >= 3 &&
        n.options.slice(0, 3).every(o => cleanLabel(o)) && new Set(n.options.slice(0, 3).map(norm)).size === 3 &&
        Number.isInteger(n.quiet) && n.quiet >= 0 && n.quiet <= 2;
}
function goodRiddle(r) {
    return r && cleanText(r.q) && Array.isArray(r.answers) && r.answers.map(a => norm(a)).filter(Boolean).length >= 1;
}

function build(count, aiList, good, poolList) {
    const out = [];
    for (const item of (Array.isArray(aiList) ? aiList : [])) { if (good(item)) out.push(item); if (out.length >= count) break; }
    for (const item of shuffle(poolList)) { if (out.length >= count) break; out.push(item); }
    return out;
}

async function makePack(llm) {
    let ai = null;
    try { ai = await aiPack(llm); } catch (e) { console.error('⚠️ [VAULT8] AI content failed, using built-in pools:', e.message); }
    const forestRaw = build(FOREST_NODES, ai?.forest, goodForest, FOREST_POOL);
    const forest = forestRaw.map((n, i) => {
        const labels = [cleanLabel(n.options[0]), cleanLabel(n.options[1])];
        const right = Math.random() < 0.5 ? 0 : 1;           // the bot decides which path is right
        const order = Math.random() < 0.5 ? [0, 1] : [1, 0];  // and which one is listed first
        const options = order.map(k => labels[k]);
        return { scene: i === 0 ? 'You are in the forest. Two paths lay in front of you. Which one do you choose?' : cleanText(n.scene), options, right: options.indexOf(labels[right]) };
    });
    const silence = build(SILENCE_STEPS, ai?.silence, goodSilence, SILENCE_POOL).map(n => {
        const labeled = n.options.slice(0, 3).map((o, i) => ({ label: cleanLabel(o), quiet: i === n.quiet }));
        const opts = shuffle(labeled);
        return { scene: cleanText(n.scene), options: opts.map(o => o.label), quiet: opts.findIndex(o => o.quiet) };
    });
    const riddles = build(RIDDLES, ai?.riddles, goodRiddle, RIDDLE_POOL).map(r => ({
        q: cleanText(r.q), answers: r.answers.map(norm).filter(Boolean), explain: cleanText(r.explain || '')
    }));
    const maze = Array.from({ length: MAZE_STEPS }, () => (Math.random() < 0.5 ? 'left' : 'right'));
    return { forest, silence, riddles, maze, ai: !!ai };
}

// ─── MESSAGES ────────────────────────────────────────────────────
// "VAULT 8:" must stay in every card: helpers/GameInterceptors.js routes replies by it.
const card = (stage, body, hint) =>
    `📁 *VAULT 8: ${stage}*\n${LINE}\n\n${body}\n\n${LINE}\n👉 *${hint}*`;
const optionList = (opts) => opts.map((o, i) => `${i + 1}. ${o}`).join('\n');
const inventory = (s) => {
    const have = TASKS.filter(t => s.items.includes(t.id)).map(t => ITEMS[t.id]);
    return `🎒 Items: ${have.length ? have.join(', ') : 'none'} (${have.length}/4)`;
};

async function say(sock, jid, msg, session, text) {
    const sent = await sock.sendMessage(jid, { text }, { quoted: msg });
    session.lastQuestionMsgId = sent?.key?.id || '';
    return sent;
}

// Matches a typed reply to one of the listed options (by number or by the text).
function matchOption(input, options) {
    const t = norm(input);
    if (!t) return -1;
    const num = parseInt(t, 10);
    if (/^\d+$/.test(t) && num >= 1 && num <= options.length) return num - 1;
    const exact = options.findIndex(o => norm(o) === t);
    if (exact >= 0) return exact;
    const part = options.map((o, i) => (norm(o).includes(t) || t.includes(norm(o))) ? i : -1).filter(i => i >= 0);
    return part.length === 1 ? part[0] : -1;
}

// ─── STAGE PRESENTERS ────────────────────────────────────────────
async function showForest(sock, jid, msg, s) {
    const n = s.pack.forest[s.i];
    return say(sock, jid, msg, s, card('THE FOREST', `${n.scene}\n\n${optionList(n.options)}`, 'Reply with 1 or 2'));
}

async function showCamp(sock, jid, msg, s, intro) {
    s.phase = 'camp';
    const open = TASKS.filter(t => !s.items.includes(t.id));
    let body = `${intro || 'You have reached camp. Where do you go next?'}\n\n${inventory(s)}\n\n`;
    const options = open.map(t => t.label);
    if (!open.length) options.push('Return to the house');
    s.campOptions = open.map(t => t.id).concat(open.length ? [] : ['house']);
    body += optionList(options);
    return say(sock, jid, msg, s, card('CAMP', body, 'Reply with the number or the name'));
}

async function showSilence(sock, jid, msg, s) {
    const n = s.pack.silence[s.i];
    return say(sock, jid, msg, s, card(`SWAMPS: SILENCE (${s.i + 1}/${SILENCE_STEPS})`,
        `${n.scene}\n\n_Do not make a sound._\n\n${optionList(n.options)}`, 'Reply with 1, 2 or 3'));
}

async function showMaze(sock, jid, msg, s) {
    const dir = s.pack.maze[s.i];
    return say(sock, jid, msg, s, card(`RIVERSIDE: MAZE (${s.i + 1}/${MAZE_STEPS})`,
        `The reeds close in on both sides. ${pick(WHISPER[dir])}\n\n_Which way do you go?_`, 'Reply: left or right'));
}

function memoryQuestions(s) {
    const pool = [];
    s.pack.forest.forEach((n, i) => {
        const names = ['first', 'second', 'third', 'fourth'];
        pool.push({ q: `In the forest, at the ${names[i]} fork, which way did you go? _("${n.scene.slice(0, 60)}...")_`.replace(/ _\(".*"\)_$/, ''), answer: n.options[n.right], options: n.options });
    });
    if (s.log.silence.length) {
        const step = s.log.silence[1] || s.log.silence[0];
        pool.push({ q: `In the swamp, you faced: "${step.scene}" What did you choose?`, answer: step.label });
    }
    if (s.log.maze.length >= 3) pool.push({ q: 'In the maze, which way was the third whisper?', answer: s.log.maze[2] });
    if (s.log.maze.length >= 6) pool.push({ q: 'In the maze, which way was the last whisper but two?', answer: s.log.maze[s.log.maze.length - 3] });
    return shuffle(pool).slice(0, 5);
}

async function showMemory(sock, jid, msg, s) {
    const q = s.memory[s.i];
    return say(sock, jid, msg, s, card(`RIVERSIDE: MEMORY (${s.i + 1}/${s.memory.length})`,
        `The water shows your own face, then it speaks.\n\n${q.q}`, 'Type your answer'));
}

async function showRiddle(sock, jid, msg, s) {
    const r = s.pack.riddles[s.i];
    return say(sock, jid, msg, s, card(`SWAMPS: CONUNDRUM (${s.i + 1}/${RIDDLES})`, r.q, 'Type your answer'));
}

// ─── PUBLIC API ──────────────────────────────────────────────────
async function startRun(sock, msg, llm) {
    const jid = msg.key.remoteJid;
    await sock.sendMessage(jid, { text: '👁️ `[SYSTEM] Building a new vault...`' }, { quoted: msg });
    const pack = await makePack(llm);
    const session = {
        phase: 'forest', i: 0, items: [], pack, memory: [], busy: false,
        log: { silence: [], maze: [] }, lastQuestionMsgId: '', campOptions: []
    };
    await showForest(sock, jid, msg, session);
    return session;
}

async function handleTurn(sock, msg, input, session) {
    const jid = msg.key.remoteJid;
    const text = String(input || '').trim();
    if (!text) return;
    const s = session;

    switch (s.phase) {
        case 'forest': {
            const n = s.pack.forest[s.i];
            const k = matchOption(text, n.options);
            if (k < 0 || k !== n.right) return die('The Forest', 'You chose wrong. The trees close in, the path vanishes behind you, and the forest keeps you.');
            s.i++;
            if (s.i >= FOREST_NODES) return showCamp(sock, jid, msg, s, 'Smoke from a dead fire. A tent, a log and silence. You have reached camp. Where do you go next?');
            return showForest(sock, jid, msg, s);
        }

        case 'camp': {
            const open = s.campOptions;
            let k = -1;
            const t = norm(text);
            if (/^\d+$/.test(t)) { const num = parseInt(t, 10); if (num >= 1 && num <= open.length) k = num - 1; }
            if (k < 0) {
                const hits = open.map((id, idx) => (id === 'house' ? /house|home|return/.test(t) : (TASKS.find(x => x.id === id).words.some(w => t.includes(w)) ? idx : -1)))
                    .map((v, idx) => (v === true ? idx : v)).filter(v => v >= 0);
                if (hits.length === 1) k = hits[0];
            }
            if (k < 0) return showCamp(sock, jid, msg, s, 'That is not a place you can go. Where do you go next?');
            const dest = open[k];
            s.i = 0;
            if (dest === 'house') {
                s.phase = 'fire';
                return say(sock, jid, msg, s, card('THE HOUSE',
                    'A cave mouth, a rope, a climb down into the dark. At the bottom, a door, and voices behind it. A figure blocks it.\n\n"Do you have a fire?"', 'Reply: yes or no'));
            }
            s.phase = dest;
            if (dest === 'silence') s.log.silence = [];
            if (dest === 'maze') s.log.maze = [];
            if (dest === 'memory') {
                s.memory = memoryQuestions(s);
                return showMemory(sock, jid, msg, s);
            }
            if (dest === 'silence') return showSilence(sock, jid, msg, s);
            if (dest === 'maze') return showMaze(sock, jid, msg, s);
            return showRiddle(sock, jid, msg, s);
        }

        case 'silence': {
            const n = s.pack.silence[s.i];
            const k = matchOption(text, n.options);
            if (k < 0 || k !== n.quiet) return die('Swamps: Silence', 'Too loud. Something in the water turns toward you. You never see what it was.');
            s.log.silence.push({ scene: n.scene.replace(/[.!?]+$/, ''), label: n.options[k] });
            s.i++;
            if (s.i >= SILENCE_STEPS) {
                s.items.push('silence');
                return showCamp(sock, jid, msg, s, `The swamp lets you go. In the wreck, you find an *oil lamp*. You carry it back to camp.`);
            }
            return showSilence(sock, jid, msg, s);
        }

        case 'maze': {
            const t = norm(text);
            const dir = /^(l|left|1)$/.test(t) ? 'left' : /^(r|right|2)$/.test(t) ? 'right' : null;
            if (!dir || dir !== s.pack.maze[s.i]) return die('Riverside: Maze', 'The whispering stops. The reeds close behind you, and the river takes you.');
            s.log.maze.push(dir);
            s.i++;
            if (s.i >= MAZE_STEPS) {
                s.items.push('maze');
                return showCamp(sock, jid, msg, s, 'The whispers fall silent. In the mud at the end of the maze, you find a scrap of *cloth*. You carry it back to camp.');
            }
            return showMaze(sock, jid, msg, s);
        }

        case 'memory': {
            const q = s.memory[s.i];
            const given = norm(text);
            const want = norm(q.answer);
            const ok = given === want || (want.length > 3 && given.includes(want)) ||
                (q.options && /^\d+$/.test(given) && norm(q.options[parseInt(given, 10) - 1]) === want);
            if (!ok) return die('Riverside: Memory', 'The reflection shakes its head. The water ripples, the memory scatters, and so do you.');
            s.i++;
            if (s.i >= s.memory.length) {
                s.items.push('memory');
                return showCamp(sock, jid, msg, s, 'The water goes still. A branch of dry *wood* floats to your feet. You carry it back to camp.');
            }
            return showMemory(sock, jid, msg, s);
        }

        case 'conundrum': {
            const r = s.pack.riddles[s.i];
            const given = norm(text).replace(/^(a|an|the) /, '');
            const ok = r.answers.some(a => { const x = a.replace(/^(a|an|the) /, ''); return x === given || (x.length > 3 && given === x + 's'); });
            if (!ok) return die('Swamps: Conundrum', 'The swamp stays silent, and then the ground gives way beneath you.');
                        if (r.explain) await sock.sendMessage(jid, { text: `✅ _${r.explain}_` }, { quoted: msg });
            s.i++;
            if (s.i >= RIDDLES) {
                s.items.push('conundrum');
                return showCamp(sock, jid, msg, s, 'The last question is answered. Beneath a rotted log, you find *matchsticks*. You carry them back to camp.');
            }
            return showRiddle(sock, jid, msg, s);
        }

        case 'fire': {
            const t = norm(text);
            if (/^(y|yes|i do|yes i do)$/.test(t)) {
                if (s.items.length < 4) { s.phase = 'camp'; return showCamp(sock, jid, msg, s, 'You lied. The figure sees it, and shoves you back up the rope. Where do you go next?'); }
                return { finished: true, text: card('VICTORY', 'You hold up the lamp, the cloth, the wood and the matchsticks. A spark. A flame.\n\nThe figure steps aside. The door opens, and you walk in to join the others at the table.\n\n🏆 *You made it into the house. Vault 8 is complete.*', 'Play again with the vault8 command') };
            }
            if (/^(n|no)$/.test(t)) return showCamp(sock, jid, msg, s, 'Without fire, you are not let in. You climb back up. Where do you go next?');
            return say(sock, jid, msg, s, card('THE HOUSE', '"Do you have a fire?"', 'Reply: yes or no'));
        }
    }
}

module.exports = { startRun, handleTurn };
