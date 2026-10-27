// helpers/AkiEngine.js
// Akinator's own brain. Pure JavaScript, no network, no AI.
//
// Data lives in data/akinator/ (edit these files by hand whenever you like):
//   aki-questions.json   the question bank   (id, tier, scope, text, askIf, ...)
//   aki-characters.json  the characters      (name, from, kind, pop, plays, p = chance of "Yes" per question, in %)
//   aki-games.json       a capped log of finished games (used for statistics only)
//   backups/             rolling copies of aki-characters.json
//
// How a game works
//   - Every character has a chance (0-100) of a "Yes" for each question. Missing = defaultP (a small number).
//   - Each answer multiplies every character's score by how well it fits that answer. A mismatch lowers a
//     character, it never knocks it out, so one wrong answer from the player does not break the game.
//   - The next question is the one that tells the remaining candidates apart best (information gain).
//   - After a game the characters are nudged toward the answers given. Unknown characters are added.

const fs = require('fs');
const path = require('path');

// The data folder: AKI_DATA_DIR if set, otherwise database/akinator or data/akinator (whichever has the files).
const DIR = (() => {
    const root = path.join(__dirname, '..');
    const candidates = [process.env.AKI_DATA_DIR, path.join(root, 'database', 'akinator'), path.join(root, 'data', 'akinator')].filter(Boolean);
    return candidates.find(d => fs.existsSync(path.join(d, 'aki-questions.json'))) || candidates[0];
})();
const Q_FILE = 'aki-questions.json';
const C_FILE = 'aki-characters.json';
const G_FILE = 'aki-games.json';

// ─── SETTINGS ────────────────────────────────────────────────────
// (kept in one object so they are easy to tune)
const T = {
    MIN_Q_EARLY: 10,       // a very sure guess is allowed from here
    MIN_Q: 12,             // a normal guess is allowed from here
    MAX_Q: 28,             // after this many questions the best guess is made anyway
    SURE_EARLY: 0.85,      // confidence needed to guess at MIN_Q_EARLY
    SURE: 0.6,             // confidence needed to guess at MIN_Q
    LEAD: 3,               // the best candidate must beat the runner-up by this factor
    LIK_FLOOR: 0.15,       // the worst a single answer can hurt a character
    MIN_GAIN: 0.004,       // stop asking when no question tells anyone apart any more
    LEARN_FLOOR: 8,        // learning steps start at 1/(plays+LEARN_FLOOR)
};
const SIGS_KEPT = 3;          // remembered missed games per character
const SIG_MIN = 5;            // answers in common needed before a remembered game counts
const SIG_BOOST = 0.8;        // strength of that boost
const LEARNED_DEFAULT = 25;   // chance used for questions a learned character has no answer for yet
const NEW_CHAR_YES = 92, NEW_CHAR_PROB = 72, NEW_CHAR_PROBNOT = 28, NEW_CHAR_NO = 8;
const BACKUP_EVERY_MS = 30 * 60 * 1000;
const BACKUPS_KEPT = 3;
const GAMES_KEPT = 400;
const SAVE_DELAY_MS = 4000;

// answer name -> value on the 0-100 scale (idk is skipped everywhere)
const ANSWER_VALUE = { yes: 100, prob: 75, probnot: 25, no: 0 };

// ─── FILE HELPERS ────────────────────────────────────────────────
function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// write to a temp file and rename it over the real one, so a crash never leaves half a file
function writeJsonAtomic(file, text) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
}

function stamp() {
    const d = new Date();
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}

// ─── THE DATABASE ────────────────────────────────────────────────
class AkiDB {
    constructor(dir = DIR) {
        this.dir = dir;
        this.questions = [];
        this.qById = new Map();
        this.chars = [];
        this.defaultP = 5;
        this.games = [];
        this.dirty = false;
        this.timer = null;
        this.mtime = { q: 0, c: 0 };
        this.lastBackup = 0;
        this.loaded = false;
    }

    // Load (or reload) everything from disk. If a file is damaged the newest backup is used.
    load() {
        const qPath = path.join(this.dir, Q_FILE);
        const cPath = path.join(this.dir, C_FILE);
        const gPath = path.join(this.dir, G_FILE);

        const q = readJson(qPath);
        let c;
        try {
            c = readJson(cPath);
        } catch (e) {
            const bak = this.newestBackup();
            if (!bak) throw new Error(`${C_FILE} is damaged and there is no backup: ${e.message}`);
            console.error(`⚠️ [AKI] ${C_FILE} is damaged (${e.message}); using backup ${path.basename(bak)}`);
            c = readJson(bak);
        }
        let g = { games: [] };
        try { g = readJson(gPath); } catch (e) { /* the log is optional */ }

        this.questions = (q.questions || []).filter(x => x && x.id && x.text);
        this.qById = new Map(this.questions.map(x => [x.id, x]));
        this.defaultP = Number.isFinite(c.defaultP) ? c.defaultP : 5;
        this.chars = (c.characters || []).filter(x => x && x.name).map(x => {
            x.p = x.p || {};
            x.plays = x.plays || 0;
            x.pop = x.pop || 2;
            x.kind = x.kind || 'fiction';
            x._norm = [x.name, ...(x.aliases || [])].map(normName);
            return x;
        });
        this.games = Array.isArray(g.games) ? g.games : [];
        this.mtime = { q: this.stat(qPath), c: this.stat(cPath) };
        this.dirty = false;
        this.loaded = true;
        return this;
    }

    stat(file) {
        try { return fs.statSync(file).mtimeMs; } catch (e) { return 0; }
    }

    // pick up hand edits to the JSON files (called when a game starts)
    refreshIfChanged() {
        if (!this.loaded) return this.load();
        const q = this.stat(path.join(this.dir, Q_FILE));
        const c = this.stat(path.join(this.dir, C_FILE));
        if (q === this.mtime.q && c === this.mtime.c) return this;
        if (this.dirty) console.error('⚠️ [AKI] database files were edited by hand; unsaved learning from the last few seconds is dropped.');
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        try {
            this.load();
            console.log('🔄 [AKI] database reloaded from disk');
        } catch (e) {
            console.error('❌ [AKI] reload failed, keeping the data in memory:', e.message);
            this.mtime = { q, c };
        }
        return this;
    }

    newestBackup() {
        try {
            const dir = path.join(this.dir, 'backups');
            const files = fs.readdirSync(dir).filter(f => f.startsWith('aki-characters.') && f.endsWith('.json')).sort();
            return files.length ? path.join(dir, files[files.length - 1]) : null;
        } catch (e) { return null; }
    }

    markDirty() {
        this.dirty = true;
        if (this.timer) return;
        this.timer = setTimeout(() => { this.timer = null; this.saveSafe(); }, SAVE_DELAY_MS);
        if (this.timer.unref) this.timer.unref();
    }

    saveSafe() {
        try { this.save(); } catch (e) { console.error('❌ [AKI] saving the database failed:', e.message); }
    }

    save() {
        if (!this.dirty) return;
        const cPath = path.join(this.dir, C_FILE);

        // If the file was edited by hand since it was loaded, the hand edit wins: never overwrite it.
        if (this.mtime.c && this.stat(cPath) !== this.mtime.c) {
            console.error('⚠️ [AKI] aki-characters.json was edited by hand; keeping the edit and dropping the last few seconds of learning.');
            this.dirty = false;
            this.load();
            return;
        }

        // rolling backup of the characters file (at most one every 30 minutes, newest 3 kept)
        if (Date.now() - this.lastBackup > BACKUP_EVERY_MS && fs.existsSync(cPath)) {
            try {
                const bdir = path.join(this.dir, 'backups');
                fs.mkdirSync(bdir, { recursive: true });
                fs.copyFileSync(cPath, path.join(bdir, `aki-characters.${stamp()}.json`));
                const old = fs.readdirSync(bdir).filter(f => f.startsWith('aki-characters.') && f.endsWith('.json')).sort();
                while (old.length > BACKUPS_KEPT) fs.unlinkSync(path.join(bdir, old.shift()));
                this.lastBackup = Date.now();
            } catch (e) { console.error('⚠️ [AKI] backup failed:', e.message); }
        }

        const lines = this.chars.map(ch => {
            const { _norm, ...clean } = ch;      // internal fields are never written
            return '    ' + JSON.stringify(clean);
        });
        const text = '{\n  "version": 1,\n  "defaultP": ' + this.defaultP + ',\n  "characters": [\n' + lines.join(',\n') + '\n  ]\n}\n';
        writeJsonAtomic(path.join(this.dir, C_FILE), text);

        const gText = '{\n  "version": 1,\n  "games": [\n' + this.games.map(g => '    ' + JSON.stringify(g)).join(',\n') + '\n  ]\n}\n';
        writeJsonAtomic(path.join(this.dir, G_FILE), gText);

        this.mtime = { q: this.stat(path.join(this.dir, Q_FILE)), c: this.stat(cPath) };
        this.dirty = false;
    }

    // find a character by name or alias (exact first, then a single whole-word match like "luffy")
    findChar(input) {
        const n = normName(input);
        if (!n) return null;
        let hit = this.chars.find(c => c._norm.includes(n));
        if (hit) return hit;
        const words = this.chars.filter(c => c._norm.some(x => x.split(' ').includes(n)));
        if (words.length === 1) return words[0];
        return null;
    }

    stats() {
        const by = {};
        let learned = 0;
        for (const c of this.chars) {
            by[c.kind] = (by[c.kind] || 0) + 1;
            if (c.source === 'learned') learned++;
        }
        const g = this.games;
        const ok = g.filter(x => x.ok).length;
        return { questions: this.questions.length, characters: this.chars.length, byKind: by, learned, games: g.length, correct: ok };
    }
}

function normName(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

let sharedDb = null;
function getDB() {
    if (!sharedDb) sharedDb = new AkiDB().load();
    else sharedDb.refreshIfChanged();
    return sharedDb;
}

// ─── SCORING ─────────────────────────────────────────────────────
// chance (0-100) that this character gets a "Yes" on this question
function chanceOf(db, ch, q) {
    // fiction-only questions never fit real people and the other way round
    if (q.scope === 'fiction' && ch.kind === 'real') return 1;
    if (q.scope === 'real' && ch.kind !== 'real') return 1;
    const v = ch.p[q.id];
    if (v !== undefined) return v;
    // a character a player taught me only has a few answers on file, so what is missing is treated as "unknown", not "no"
    return ch.source === 'learned' ? LEARNED_DEFAULT : db.defaultP;
}

// how well a character fits one answer (0..1, never below the floor)
function fit(p, a) {
    const f = 1 - Math.abs(a - p) / 100;
    return f < T.LIK_FLOOR ? T.LIK_FLOOR : f;
}

function priorOf(ch) {
    // well-known characters are a little more likely; characters that were played a lot too
    return 1 + 0.25 * (ch.pop - 1) + 0.15 * Math.log(1 + (ch.plays || 0));
}

// ─── ONE GAME ────────────────────────────────────────────────────
class AkiGame {
    constructor(db) {
        this.db = db;
        // The game keeps its own view of the data from the moment it starts, so a hand edit or reload of the
        // files in the middle of a game can never shift the numbers under it.
        this.chars = db.chars;
        this.questions = db.questions;
        this.qById = db.qById;
        this.defaultP = db.defaultP;
        this.answers = [];            // [{ id, a, name }]  a = 0..100, name = yes/no/prob/probnot/idk, a=null for idk
        this.asked = new Set();
        this.logS = this.chars.map(c => Math.log(priorOf(c)));
        this.current = null;          // the question waiting for an answer
        this.guessed = null;          // the character guessed
    }

    // current weights (sum to 1)
    weights() {
        const s = this.sigBonus();
        let max = -Infinity;
        for (const v of s) if (v > max) max = v;
        const w = s.map(v => Math.exp(v - max));
        let sum = 0;
        for (const v of w) sum += v;
        return w.map(v => v / sum);
    }

    // A character the bot once missed keeps the answers the player gave (`sig`). When the answers so far
    // agree with one of those memories the character gets a boost, so a missed character is found next time.
    sigBonus() {
        const out = this.logS.slice();
        const cur = this.answers.filter(a => a.a !== null);
        if (cur.length < SIG_MIN) return out;
        for (let i = 0; i < this.chars.length; i++) {
            const sigs = this.chars[i].sig;
            if (!sigs || !sigs.length) continue;
            let best = 0;
            for (const sg of sigs) {
                let agree = 0, conflict = 0;
                for (const a of cur) {
                    const v = sg[a.id];
                    if (v === undefined) continue;
                    const yes = a.a >= 75;
                    if ((v === 'y' || v === 'p') === yes) agree++; else conflict++;
                }
                if (conflict === 0 && agree >= SIG_MIN) best = Math.max(best, Math.log(1 + SIG_BOOST * agree));
            }
            out[i] += best;
        }
        return out;
    }

    answerOf(id) {
        for (let i = this.answers.length - 1; i >= 0; i--) if (this.answers[i].id === id) return this.answers[i];
        return null;
    }

    // "id=yes" holds when the player said yes/probably, "id=no" when no/probably not. An unknown answer holds for nothing.
    conditionHolds(cond) {
        const [id, want] = String(cond).split('=');
        const ans = this.answerOf(id);
        if (!ans || ans.a === null) return false;
        return want === 'yes' ? ans.a >= 75 : ans.a <= 25;
    }

    // number of characters still "in the race"
    poolSize(w) {
        let max = 0;
        for (const v of w) if (v > max) max = v;
        let n = 0;
        for (const v of w) if (v >= max * 0.02) n++;
        return n;
    }

    // the best next question, or null if none is worth asking
    pickQuestion() {
        const w = this.weights();
        const pool = this.poolSize(w);
        const n = w.length;

        // the very first question is fixed
        if (this.answers.length === 0) {
            const first = this.questions.find(q => q.first);
            if (first) return first;
        }

        // only characters that still matter are scored (faster, and the result is identical)
        let max = 0;
        for (const v of w) if (v > max) max = v;
        const idx = [];
        for (let i = 0; i < n; i++) if (w[i] >= max * 0.0005) idx.push(i);

        let H0 = 0, tot = 0;
        for (const i of idx) tot += w[i];
        for (const i of idx) { const x = w[i] / tot; if (x > 0) H0 -= x * Math.log(x); }

        let best = null, bestGain = T.MIN_GAIN;
        for (const q of this.questions) {
            if (this.asked.has(q.id)) continue;
            if (q.maxPool && pool > q.maxPool) continue;
            if (q.askIf && !q.askIf.every(c => this.conditionHolds(c))) continue;

            // what would "yes" and "no" do to the field?
            let sy = 0, sn = 0;
            const py = new Array(idx.length), pn = new Array(idx.length);
            for (let k = 0; k < idx.length; k++) {
                const p = chanceOf(this, this.chars[idx[k]], q);
                const wy = w[idx[k]] * fit(p, 100);
                const wn = w[idx[k]] * fit(p, 0);
                py[k] = wy; pn[k] = wn; sy += wy; sn += wn;
            }
            const total = sy + sn;
            if (total <= 0) continue;
            const Py = sy / total;
            let Hy = 0, Hn = 0;
            for (let k = 0; k < idx.length; k++) {
                if (sy > 0) { const x = py[k] / sy; if (x > 0) Hy -= x * Math.log(x); }
                if (sn > 0) { const x = pn[k] / sn; if (x > 0) Hn -= x * Math.log(x); }
            }
            const gain = H0 - (Py * Hy + (1 - Py) * Hn);
            const score = gain * (1 + Math.random() * 0.03);   // a touch of randomness so games differ
            if (score > bestGain) { bestGain = score; best = q; }
        }
        return best;
    }

    // wording: if the player already said "not fictional", talk about "your person"
    textOf(q) {
        const f = this.answerOf('fictional');
        if (f && f.a !== null && f.a <= 25) return q.textReal || q.text.replace(/your character/gi, m => (m[0] === 'Y' ? 'Your person' : 'your person'));
        return q.text;
    }

    // What now: ask a question, or make the guess.
    next() {
        const w = this.weights();
        let top = -1, second = -1;
        for (let i = 0; i < w.length; i++) {
            if (top < 0 || w[i] > w[top]) { second = top; top = i; }
            else if (second < 0 || w[i] > w[second]) second = i;
        }
        const n = this.answers.filter(a => a.a !== null).length;
        const conf = top >= 0 ? w[top] : 0;
        const lead = second >= 0 && w[second] > 0 ? w[top] / w[second] : Infinity;

        const guessNow =
            (n >= T.MIN_Q_EARLY && conf >= T.SURE_EARLY) ||
            (n >= T.MIN_Q && conf >= T.SURE && lead >= T.LEAD) ||
            this.answers.length >= T.MAX_Q;

        if (!guessNow) {
            const q = this.pickQuestion();
            if (q) {
                this.current = q;
                return { type: 'question', q, text: this.textOf(q), step: this.answers.length + 1, confidence: conf };
            }
        }
        this.current = null;
        this.guessed = top >= 0 ? this.chars[top] : null;
        return { type: 'guess', char: this.guessed, confidence: conf, step: this.answers.length };
    }

    // record the player's answer to the current question
    answer(name) {
        const q = this.current;
        if (!q) return;
        this.asked.add(q.id);
        const a = ANSWER_VALUE[name];
        if (a === undefined) {
            this.answers.push({ id: q.id, a: null, name: 'idk' });
        } else {
            this.answers.push({ id: q.id, a, name });
                for (let i = 0; i < this.chars.length; i++) this.logS[i] += Math.log(fit(chanceOf(this, this.chars[i], q), a));
        }
        this.current = null;
    }

    // undo the last answer
    back() {
        const last = this.answers.pop();
        if (!last) return false;
        this.asked.delete(last.id);
        this.current = null;
        this.guessed = null;
        this.rebuild();
        return true;
    }

    rebuild() {
        this.logS = this.chars.map(c => Math.log(priorOf(c)));
        for (const ans of this.answers) {
            if (ans.a === null) continue;
            const q = this.qById.get(ans.id);
            if (!q) continue;
            for (let i = 0; i < this.chars.length; i++) this.logS[i] += Math.log(fit(chanceOf(this, this.chars[i], q), ans.a));
        }
    }

    // the best few candidates (for debugging and tests)
    top(k = 5) {
        const w = this.weights();
        return w.map((v, i) => ({ name: this.chars[i].name, w: v })).sort((a, b) => b.w - a.w).slice(0, k);
    }
}

// ─── LEARNING ────────────────────────────────────────────────────
function cleanName(input) {
    const s = String(input || '').replace(/\s+/g, ' ').trim();
    if (s.length < 2 || s.length > 40) return null;
    if (!/^[\p{L}\p{N} .,'’()\-:!&]+$/u.test(s)) return null;
    if (/^(https?:|www\.)/i.test(s)) return null;
    return s;
}

function titleCase(s) {
    return s.split(' ').map(w => (w === w.toLowerCase() || w === w.toUpperCase()) && w.length > 1 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

// Nudge a character toward the answers a player gave.
function nudge(db, ch, answers) {
    const lr = 1 / ((ch.plays || 0) + T.LEARN_FLOOR);
    for (const ans of answers) {
        if (ans.a === null) continue;
        const q = db.qById.get(ans.id);
        if (!q) continue;
        if (q.scope === 'fiction' && ch.kind === 'real') continue;
        if (q.scope === 'real' && ch.kind !== 'real') continue;
        const old = ch.p[q.id] === undefined ? (ch.source === 'learned' ? LEARNED_DEFAULT : db.defaultP) : ch.p[q.id];
        let nv = old + lr * (ans.a - old);
        nv = Math.max(2, Math.min(98, nv));
        ch.p[q.id] = Math.round(nv);
    }
    ch.plays = (ch.plays || 0) + 1;
}

// Called when a game is over.
//   game:   the AkiGame
//   ok:     true if the guess was right
//   actual: (when the guess was wrong) the name the player gave, or null to skip learning
// Returns { learned: 'nudged'|'added'|'none', name }
function finishGame(db, game, ok, actual) {
    // the game may hold an older copy of the data than the live database (after a hand edit), so find the live character
    const guessed = game.guessed;
    const guess = guessed ? (db.chars.find(c => c.id === guessed.id) || null) : null;
    let result = { learned: 'none', name: guessed ? guessed.name : '' };
    const n = game.answers.filter(a => a.a !== null).length;

    if (ok && guess) {
        nudge(db, guess, game.answers);
        result = { learned: 'nudged', name: guess.name };
    } else if (actual) {
        const name = cleanName(actual);
        if (name) {
            const found = db.findChar(name);
            if (found) {
                nudge(db, found, game.answers);
                result = { learned: 'nudged', name: found.name };
            } else {
                const fic = game.answerOf('fictional');
                const kind = fic && fic.a !== null && fic.a <= 25 ? 'real' : 'fiction';
                const p = {};
                // What the player did not get asked is guessed from the closest characters (a blend of the top
                // candidates), so a new character starts out as "someone like them" instead of "nobody".
                const w = game.weights();
                const order = w.map((v, i) => i).sort((a, b) => w[b] - w[a]).slice(0, 8);
                let wsum = 0;
                const bw = order.map(i => { const v = Math.sqrt(w[i]); wsum += v; return v; });
                for (const q of game.questions) {
                    if (q.scope === 'fiction' && kind === 'real') continue;
                    if (q.scope === 'real' && kind !== 'real') continue;
                    let avg = 0;
                    order.forEach((ci, k) => { avg += (bw[k] / wsum) * chanceOf(db, game.chars[ci], q); });
                    p[q.id] = Math.round(Math.max(3, Math.min(97, avg)));
                }
                p.fictional = kind === 'real' ? 1 : 99;
                for (const ans of game.answers) {
                    if (ans.a === null || ans.id === 'fictional') continue;
                    p[ans.id] = ans.name === 'yes' ? NEW_CHAR_YES : ans.name === 'prob' ? NEW_CHAR_PROB : ans.name === 'probnot' ? NEW_CHAR_PROBNOT : NEW_CHAR_NO;
                }
                const nm = titleCase(name);
                const ch = { id: normName(nm).replace(/ /g, '-'), name: nm, from: '', kind, pop: 1, plays: 1, source: 'learned', p };
                ch._norm = [nm].map(normName);
                if (db.chars.some(c => c.id === ch.id)) ch.id += '-' + (db.chars.length + 1);
                db.chars.push(ch);
                result = { learned: 'added', name: nm };
            }
        }
    }

    // remember how this player answered for the character that was missed
    if (!ok && result.learned !== 'none') {
        const target = db.findChar(result.name);
        if (target) {
            const sg = {};
            for (const a of game.answers) if (a.a !== null) sg[a.id] = a.name === 'yes' ? 'y' : a.name === 'prob' ? 'p' : a.name === 'probnot' ? 'x' : 'n';
            target.sig = (target.sig || []).concat([sg]).slice(-SIGS_KEPT);
        }
    }

    db.games.push({
        t: new Date().toISOString().slice(0, 16), n, ok: !!ok,
        guess: guessed ? guessed.name : '', actual: ok ? '' : (actual ? String(actual).slice(0, 40) : ''),
        a: game.answers.map(x => x.id + ':' + (x.name === 'idk' ? '?' : x.name[0] + (x.name === 'probnot' ? 'n' : ''))).join(',')
    });
    if (db.games.length > GAMES_KEPT) db.games.splice(0, db.games.length - GAMES_KEPT);
    db.markDirty();
    return result;
}

// remove a character by name (owner tool). Returns the removed name or null.
function removeChar(db, name) {
    const ch = db.findChar(name);
    if (!ch) return null;
    db.chars.splice(db.chars.indexOf(ch), 1);
    db.markDirty();
    return ch.name;
}

module.exports = { AkiDB, AkiGame, getDB, finishGame, removeChar, normName, cleanName, T, DIR };
