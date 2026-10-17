// helpers/DownloaderUI.js
//
// One look for every downloader: a status card that updates in place while the
// command works (searching -> downloading -> sending), result cards for captions,
// and a matching error card. Only the LEFT edge carries a line, so nothing
// misaligns in WhatsApp's proportional font.
//
//   const ui = await UI.begin(sock, msg, 'play');   // sends the status card
//   ui.step(1);                                     // edits it: next stage
//   await ui.done();                                // removes it on success
//   await ui.fail('why it failed');                 // turns it into an error card
//
//   UI.card({ icon, title, fields, sections, note, footer })   // result caption

'use strict';

const config = require('../config');

// ─── LOOK ────────────────────────────────────────────────────────
const STYLES = {
    heavy: { top: '┏━━━━━━━━━━━━━━━━━━━', mid: '┣━━━━━━━━━━━━━━━━━━━', bot: '┗━━━━━━━━━━━━━━━━━━━', side: '┃ ' },
    thin:  { top: '╭───────────────────', mid: '├───────────────────', bot: '╰───────────────────', side: '│ ' }
};
const STYLE = 'heavy';   // 'heavy' or 'thin'

const BRAND = '⚡ Limitless-MD';
const WRAP = 38;         // characters per line before long text wraps

// ─── WHAT EACH DOWNLOADER IS CALLED ──────────────────────────────
const KINDS = {
    play:      { icon: '🎧', title: 'SONG DOWNLOADER',      steps: ['Searching', 'Fetching audio', 'Sending'] },
    song:      { icon: '🎧', title: 'SONG DOWNLOADER',      steps: ['Searching', 'Fetching audio', 'Sending'] },
    facebook:  { icon: '📘', title: 'FACEBOOK DOWNLOADER',  steps: ['Reading link', 'Downloading video', 'Sending'] },
    instagram: { icon: '📸', title: 'INSTAGRAM DOWNLOADER', steps: ['Reading link', 'Downloading media', 'Sending'] },
    tiktok:    { icon: '🎵', title: 'TIKTOK DOWNLOADER',    steps: ['Reading link', 'Downloading video', 'Sending'] },
    youtube:   { icon: '▶️', title: 'YOUTUBE DOWNLOADER',   steps: ['Reading link', 'Downloading', 'Sending'] },
    twitter:   { icon: '🐦', title: 'X DOWNLOADER',         steps: ['Reading link', 'Downloading video', 'Sending'] },
    spotify:   { icon: '🟢', title: 'SPOTIFY DOWNLOADER',   steps: ['Reading link', 'Downloading audio', 'Sending'] },
    pinterest: { icon: '📌', title: 'PINTEREST DOWNLOADER', steps: ['Reading link', 'Downloading image', 'Sending'] },
    mediafire: { icon: '📁', title: 'MEDIAFIRE DOWNLOADER', steps: ['Reading link', 'Downloading file', 'Sending'] },
    gdrive:    { icon: '☁️', title: 'DRIVE DOWNLOADER',     steps: ['Reading link', 'Downloading file', 'Sending'] },
    apk:       { icon: '📱', title: 'APK DOWNLOADER',       steps: ['Searching', 'Downloading app', 'Sending'] },
    web:       { icon: '🌐', title: 'WEBSITE DOWNLOADER',   steps: ['Reading site', 'Packing files', 'Sending'] },
    catbox:    { icon: '📦', title: 'CATBOX DOWNLOADER',    steps: ['Reading link', 'Downloading', 'Sending'] },
    lyrics:    { icon: '📝', title: 'LYRICS SEARCH',        steps: ['Searching', 'Preparing'] },
    images:    { icon: '🖼️', title: 'IMAGE SEARCH',         steps: ['Searching', 'Downloading images', 'Sending'] },
    xvid:      { icon: '🎥', title: 'VIDEO SEARCH',         steps: ['Searching', 'Preparing'] },
    obf:       { icon: '🛡️', title: 'OBFUSCATOR',           steps: ['Processing', 'Sending'] },
    tgs:       { icon: '🧩', title: 'STICKER PACKS',        steps: ['Contacting Telegram', 'Preparing'] },
    shazam:    { icon: '🎶', title: 'SONG IDENTIFIER',      steps: ['Preparing audio', 'Listening', 'Matching'] },
    find:      { icon: '🔎', title: 'SONG FINDER',          steps: ['Preparing audio', 'Listening', 'Matching'] }
};
const DEFAULT_KIND = { icon: '⏳', title: 'DOWNLOADER', steps: ['Working', 'Sending'] };

// ─── SMALL HELPERS ───────────────────────────────────────────────
function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'N/A';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds) {
    const s = Math.round(Number(seconds));
    if (!Number.isFinite(s) || s <= 0) return 'N/A';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (x) => String(x).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function formatCount(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 'N/A';
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
}

// Breaks long text into lines without splitting words (URLs are left whole).
function wrap(text, width = WRAP) {
    const out = [];
    for (const paragraph of String(text ?? '').split('\n')) {
        let line = '';
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (!words.length) { out.push(''); continue; }   // keep blank lines between paragraphs
        for (const word of words) {
            if (word.length > width || /^https?:\/\//i.test(word)) {
                if (line) { out.push(line); line = ''; }
                out.push(word);
            } else if ((line + ' ' + word).trim().length > width) {
                out.push(line);
                line = word;
            } else {
                line = (line + ' ' + word).trim();
            }
        }
        if (line) out.push(line);
    }
    return out.length ? out : [''];
}

function iconForStep(label) {
    if (/search|read|prepar|process|listen|match|contact|pack/i.test(label)) return '🔎';
    if (/download|fetch/i.test(label)) return '⬇️';
    return '📤';
}

function progressBar(percent) {
    const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
    return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

const style = () => STYLES[STYLE] || STYLES.heavy;
const lines = (arr) => arr.map(l => `${style().side}${l}`.trimEnd());

// ─── CARDS ───────────────────────────────────────────────────────
// fields:   [['Duration', '3:33'], ...]                     -> "◈ Duration  3:33"
// sections: [{ rows: ['text', ...] }, ...]                  -> extra blocks under a divider
// note:     one more line at the bottom (e.g. "Reply with a number")
// footer:   true -> brand line under the box
function card({ icon = '', title = '', fields = [], sections = [], note = '', footer = false } = {}) {
    const s = style();
    const out = [s.top];

    const heading = `${icon ? icon + ' ' : ''}${title}`.trim();
    if (heading) out.push(...lines(wrap(heading, WRAP + 4)));

    if (fields.length) {
        out.push(s.mid);
        for (const [label, value] of fields) {
            if (value === undefined || value === null || value === '') continue;
            const wrapped = wrap(`${value}`, WRAP - String(label).length - 3);
            out.push(...lines([`◈ ${label}  ${wrapped[0]}`, ...wrapped.slice(1).map(l => `   ${l}`)]));
        }
    }

    for (const section of sections) {
        if (!section?.rows?.length) continue;
        out.push(s.mid);
        out.push(...lines(section.rows));
    }

    if (note) {
        out.push(s.mid);
        out.push(...lines(wrap(note)));
    }

    out.push(s.bot);
    if (footer) out.push(`   ${BRAND}`);
    return out.join('\n');
}

// Message for missing input, e.g. "Please provide a Facebook video URL."
function usage(text) {
    const s = style();
    return [s.top, ...lines(['⚠️ MISSING INPUT']), s.mid, ...lines(wrap(text)), s.bot].join('\n');
}

function errorText(message, { title = 'DOWNLOAD FAILED', hint } = {}) {
    const s = style();
    const msg = String(message || 'Something went wrong.').replace(/^API error:\s*/i, '');
    const tip = hint === undefined
        ? (/no .*found|invalid|provide|not found/i.test(msg) ? 'Check the link or name and try again.' : 'Try again in a moment.')
        : hint;
    const body = [...wrap(msg)];
    if (tip) body.push('', `💡 ${tip}`);
    return [s.top, ...lines([`❌ ${title}`]), s.mid, ...lines(body), s.bot].join('\n');
}

// ─── STATUS CARD ─────────────────────────────────────────────────
function statusText(kind, stepIndex = 0, stepsOverride) {
    const k = KINDS[kind] || DEFAULT_KIND;
    const steps = stepsOverride || k.steps;
    const i = Math.max(0, Math.min(stepIndex, steps.length - 1));
    const percent = Math.round(((i + 0.5) / steps.length) * 100);
    const s = style();

    const rows = [];
    for (let j = 0; j < i; j++) rows.push(`✅ ${steps[j]}`);
    rows.push(`${iconForStep(steps[i])} ${steps[i]}…`);
    rows.push(`${progressBar(percent)} ${Math.round(percent / 10) * 10}%`);

    return [s.top, ...lines([`${k.icon} ${k.title}`]), s.mid, ...lines(rows), s.bot].join('\n');
}

// Sends the status card and returns a controller for it. Never throws: if the
// bot can't send or edit, the command carries on without a status card.
async function begin(sock, msg, kind, { steps } = {}) {
    const jid = msg.key.remoteJid;
    const k = KINDS[kind] || DEFAULT_KIND;
    const stepList = steps || k.steps;
    let key = null;
    let finished = false;

    try {
        const sent = await sock.sendMessage(jid, { text: statusText(kind, 0, stepList) }, { quoted: msg });
        key = sent?.key || null;
    } catch (e) { /* no status card */ }

    const edit = async (text) => {
        if (!key) return false;
        try { await sock.sendMessage(jid, { text, edit: key }); return true; } catch (e) { return false; }
    };

    return {
        key,

        // Move the card to the next stage (0-based index).
        async step(index) {
            if (finished) return;
            await edit(statusText(kind, index, stepList));
        },

        // Success: the result is already in the chat, so the status card goes away.
        async done() {
            if (finished) return;
            finished = true;
            if (!key) return;
            try { await sock.sendMessage(jid, { delete: key }); } catch (e) { /* leave it */ }
        },

        // Replace the card with final text (e.g. a result list people reply to).
        async finish(text) {
            finished = true;
            if (!(await edit(text))) {
                try { await sock.sendMessage(jid, { text }, { quoted: msg }); } catch (e) { /* ignore */ }
            }
        },

        // Failure: the card becomes an error card.
        async fail(message, opts = {}) {
            finished = true;
            const text = errorText(message, { title: opts.title || (k.title.includes('SEARCH') ? 'SEARCH FAILED' : 'DOWNLOAD FAILED'), hint: opts.hint });
            if (!(await edit(text))) {
                try { await sock.sendMessage(jid, { text }, { quoted: msg }); } catch (e) { /* ignore */ }
            }
        }
    };
}

module.exports = {
    begin, statusText, card, usage, errorText,
    formatBytes, formatDuration, formatCount, wrap,
    KINDS, BRAND
};
