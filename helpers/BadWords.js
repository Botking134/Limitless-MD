// helpers/BadWords.js
//
// Per-bot, per-group word / phrase filter.
//
// Storage: storage/badwords/<botId>.json  (one file per bot: main bot + every sub-bot).
// That folder is in .gitignore, so `git pull`, `.upgrade` and `git reset --hard` never
// touch it, and writes are atomic (tmp file + rename) so a crash can't corrupt the list.
//
//   { "<groupJid>": { "mode": "warn|delete|kick|off", "words": ["word", "some phrase"] } }

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../storage/badwords');
const MODES = ['warn', 'delete', 'kick', 'off'];
const cache = new Map(); // botId -> data

const botIdOf = (sock) => (sock && sock.__botId) || 'main';
const fileFor = (botId) => path.join(DIR, `${String(botId).replace(/[^\w.-]/g, '_')}.json`);

function load(botId) {
    if (cache.has(botId)) return cache.get(botId);
    let data = {};
    try {
        const p = fileFor(botId);
        if (fs.existsSync(p)) data = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    } catch (e) {
        // Never throw away a list we could not parse: keep it aside and start clean.
        console.error(`⚠️ [BADWORD] unreadable list for ${botId}:`, e.message);
        try { fs.copyFileSync(fileFor(botId), fileFor(botId) + `.corrupt-${Date.now()}`); } catch (_) {}
    }
    cache.set(botId, data);
    return data;
}

function save(botId) {
    try {
        fs.mkdirSync(DIR, { recursive: true });
        const tmp = fileFor(botId) + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(load(botId), null, 2));
        fs.renameSync(tmp, fileFor(botId));
        return true;
    } catch (e) {
        console.error(`⚠️ [BADWORD] could not save list for ${botId}:`, e.message);
        return false;
    }
}

// ── text normalisation ────────────────────────────────────────────
const strip = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const squash = (s) => strip(s).replace(/\s+/g, ' ').trim();
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
const unleet = (s) => s.replace(/[0134-57@$!]/g, (c) => LEET[c]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// whole word / whole phrase only ("ass" must not hit "class"); spaces in a phrase match any whitespace
function toRegex(term) {
    const body = term.split(' ').map(escapeRe).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');
}

function find(text, words) {
    const plain = squash(text);
    if (!plain) return null;
    const leet = unleet(plain);
    for (const w of words) {
        const re = toRegex(w);
        if (re.test(plain)) return w;
        // leetspeak ("b4dw0rd") — only for terms that are plain letters, so numbers in a
        // phrase you add on purpose are never rewritten
        if (/^[a-z ]+$/.test(w) && re.test(leet)) return w;
    }
    return null;
}

// ── public API ────────────────────────────────────────────────────
const groupOf = (sock, jid) => load(botIdOf(sock))[jid];

function getGroup(sock, jid) {
    const g = groupOf(sock, jid);
    return { mode: g?.mode || 'off', words: g?.words ? [...g.words] : [] };
}

function parseTerms(input) {
    // Entries are separated by | (or a new line). Commas are part of the phrase.
    return [...new Set(String(input || '').split(/[|\n]+/).map(squash).filter(Boolean))];
}

function ensure(sock, jid) {
    const data = load(botIdOf(sock));
    if (!data[jid]) data[jid] = { mode: 'off', words: [] };
    return data[jid];
}

function add(sock, jid, terms) {
    const g = ensure(sock, jid);
    const added = terms.filter((t) => !g.words.includes(t));
    g.words.push(...added);
    save(botIdOf(sock));
    return { added, existed: terms.length - added.length };
}

function remove(sock, jid, terms) {
    const g = ensure(sock, jid);
    const before = g.words.length;
    g.words = g.words.filter((w) => !terms.includes(w));
    save(botIdOf(sock));
    return before - g.words.length;
}

function clear(sock, jid) {
    const g = ensure(sock, jid);
    const n = g.words.length;
    g.words = [];
    save(botIdOf(sock));
    return n;
}

function setMode(sock, jid, mode) {
    ensure(sock, jid).mode = mode;
    return save(botIdOf(sock));
}

// Returns { mode, word } when `text` breaks this group's list, else null.
function check(sock, jid, text) {
    const g = groupOf(sock, jid);
    if (!g || !g.words?.length || !MODES.includes(g.mode) || g.mode === 'off') return null;
    const word = find(text, g.words);
    return word ? { mode: g.mode, word } : null;
}

module.exports = { MODES, getGroup, parseTerms, add, remove, clear, setMode, check };
