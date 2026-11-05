// helpers/QuoteSticker.js
//
// Turns a text message into a "chat bubble" sticker: a dark doodle wallpaper, a WhatsApp-style
// bubble with the sender's profile picture, their name (coloured like WhatsApp does), the text,
// and a time stamp. Drawn entirely with sharp, no external service.
//
//   renderQuoteCard({ name, text, avatar, time, seed })  -> 512x512 PNG buffer
//   resolveName(sock, msg, authorJid, quotedId)          -> best display name we know
//   fetchAvatar(sock, authorJid, groupJid)               -> profile picture buffer or null
//
// A custom wallpaper can be dropped in as data/quote_bg.png (or .jpg / .webp); it is used instead
// of the generated doodle pattern.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SIZE = 512;
const MARGIN = 20;
const AVATAR = 58;
const GAP = 10;
const BUBBLE_X = MARGIN + AVATAR + GAP;
const MAX_BUBBLE_W = SIZE - MARGIN - BUBBLE_X;
const PAD_X = 16;
const PAD_Y = 11;
const MAX_CHARS = 700;

const COLORS = { bubble: '#202c33', text: '#e9edef', time: '#8696a0', wall: '#0b141a' };
// WhatsApp's group name colours: each person always gets the same one.
const NAME_COLORS = ['#06cf9c', '#53bdeb', '#fa6533', '#ffd279', '#ff7eb6', '#b38bff', '#7fd36b', '#ff9d5c', '#5ec8e5', '#e6b0ff'];

// ─── SMALL HELPERS ────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bareId = (jid) => String(jid || '').split('@')[0].split(':')[0];

function hash(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h;
}
const colorFor = (seed) => NAME_COLORS[hash(bareId(seed)) % NAME_COLORS.length];

// WhatsApp formatting -> Pango markup.  *bold*  _italic_  ~strike~  ```mono```
function toMarkup(text) {
    let t = esc(text);
    t = t.replace(/```([\s\S]+?)```/g, '<tt>$1</tt>');
    t = t.replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,!?])/g, '$1<b>$2</b>');
    t = t.replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,!?])/g, '$1<i>$2</i>');
    t = t.replace(/(^|[\s(])~(\S(?:[^~\n]*\S)?)~(?=$|[\s).,!?])/g, '$1<s>$2</s>');
    return t;
}

// Draws a piece of text with real font layout (and colour emoji where the host has the font).
async function textImage(markup, { size, color, bold = false, width }) {
    const out = await sharp({
        text: {
            text: `<span foreground="${color}">${markup}</span>`,
            font: `sans ${bold ? 'bold ' : ''}${size}`,
            width,
            wrap: 'word-char',
            rgba: true,
            dpi: 72,
            spacing: 2
        }
    }).png().toBuffer({ resolveWithObject: true });
    return { input: out.data, width: out.info.width, height: out.info.height };
}

// ─── BACKGROUND ───────────────────────────────────────────────────
function doodleSvg() {
    // A fixed, repeatable scatter of thin outlined shapes, like a chat wallpaper.
    const shapes = [
        (x, y, r) => `<polygon points="0,-12 3.5,-4 12,-3.5 5.5,2 7.5,11 0,6.5 -7.5,11 -5.5,2 -12,-3.5 -3.5,-4" transform="translate(${x} ${y}) rotate(${r})"/>`,
        (x, y, r) => `<path d="M0 8 C-14 -2 -8 -14 0 -6 C8 -14 14 -2 0 8Z" transform="translate(${x} ${y}) rotate(${r})"/>`,
        (x, y, r) => `<circle cx="${x}" cy="${y}" r="9"/>`,
        (x, y, r) => `<path d="M-10 0 Q-5 -9 0 0 T10 0" transform="translate(${x} ${y}) rotate(${r})"/>`,
        (x, y, r) => `<path d="M-9 7 L0 -9 L9 7Z" transform="translate(${x} ${y}) rotate(${r})"/>`,
        (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><circle r="10"/><circle cx="-3.5" cy="-3" r="1"/><circle cx="3.5" cy="-3" r="1"/><path d="M-5 3 Q0 8 5 3"/></g>`,
        (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><rect x="-11" y="-7" width="22" height="14" rx="2"/><path d="M-11 -7 L0 2 L11 -7"/></g>`,
        (x, y, r) => `<path d="M-8 0 H8 M0 -8 V8" transform="translate(${x} ${y}) rotate(${r})"/>`
    ];
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const cell = 64;
    let body = '';
    for (let gy = 0; gy < SIZE / cell + 1; gy++) {
        for (let gx = 0; gx < SIZE / cell + 1; gx++) {
            const x = gx * cell + 12 + rnd() * (cell - 24) + (gy % 2 ? cell / 2 : 0);
            const y = gy * cell + 12 + rnd() * (cell - 24);
            body += shapes[Math.floor(rnd() * shapes.length)](x.toFixed(1), y.toFixed(1), Math.floor(rnd() * 360));
        }
    }
    return Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="${COLORS.wall}"/>
            <g fill="none" stroke="#ffffff" stroke-opacity="0.075" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>
        </svg>`);
}

let backgroundCache = null;
async function background() {
    if (backgroundCache) return backgroundCache;
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
        const file = path.join(__dirname, '../data', `quote_bg.${ext}`);
        if (fs.existsSync(file)) {
            try {
                backgroundCache = await sharp(file).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer();
                return backgroundCache;
            } catch (e) { /* unreadable: use the generated one */ }
        }
    }
    backgroundCache = await sharp(doodleSvg()).png().toBuffer();
    return backgroundCache;
}

// ─── AVATAR ───────────────────────────────────────────────────────
async function circle(buffer, d) {
    const mask = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}"/></svg>`);
    return sharp(buffer).resize(d, d, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

// No picture (or a private one): a coloured circle with the person's first letter.
async function initialAvatar(name, seed, d) {
    const base = await sharp(Buffer.from(
        `<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="${colorFor(seed)}" fill-opacity="0.85"/></svg>`)).png().toBuffer();
    const letter = ([...String(name || '?').replace(/^[^\p{L}\p{N}]+/u, '')][0] || '?').toUpperCase();
    try {
        const t = await textImage(esc(letter), { size: Math.round(d * 0.5), color: '#ffffff', bold: true });
        return sharp(base).composite([{ input: t.input, left: Math.round((d - t.width) / 2), top: Math.round((d - t.height) / 2) }]).png().toBuffer();
    } catch (e) {
        return base;
    }
}

// ─── THE CARD ─────────────────────────────────────────────────────
async function renderQuoteCard({ name, text, avatar = null, time = '', seed = '' }) {
    let body = String(text || '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n{4,}/g, '\n\n\n').trim();
    if (!body) body = ' ';
    if ([...body].length > MAX_CHARS) body = [...body].slice(0, MAX_CHARS).join('') + '…';

    const shownName = [...String(name || 'Unknown')].slice(0, 24).join('');
    const nameImg = await textImage(esc(shownName), { size: 24, color: colorFor(seed || name), bold: true, width: MAX_BUBBLE_W - 2 * PAD_X });
    const timeImg = time ? await textImage(esc(time), { size: 17, color: COLORS.time }) : null;
    const maxBubbleH = SIZE - 2 * MARGIN;

    // Try the biggest comfortable font first and shrink until the whole bubble fits the sticker.
    let textImg = null;
    let bubbleH = 0;
    for (const fontSize of [34, 30, 27, 24, 21, 18, 16, 14]) {
        textImg = await textImage(toMarkup(body), { size: fontSize, color: COLORS.text, width: MAX_BUBBLE_W - 2 * PAD_X });
        bubbleH = PAD_Y + nameImg.height + 4 + textImg.height + 4 + (timeImg ? timeImg.height : 0) + PAD_Y;
        if (bubbleH <= maxBubbleH) break;
    }
    if (bubbleH > maxBubbleH) {
        // Still too tall at the smallest size: cut the text until it fits.
        let chars = [...body];
        while (chars.length > 20 && bubbleH > maxBubbleH) {
            chars = chars.slice(0, Math.floor(chars.length * 0.85));
            textImg = await textImage(toMarkup(chars.join('').trimEnd() + '…'), { size: 14, color: COLORS.text, width: MAX_BUBBLE_W - 2 * PAD_X });
            bubbleH = PAD_Y + nameImg.height + 4 + textImg.height + 4 + (timeImg ? timeImg.height : 0) + PAD_Y;
        }
    }

    const innerW = Math.max(textImg.width, nameImg.width, timeImg ? timeImg.width + 24 : 0);
    const bubbleW = Math.min(MAX_BUBBLE_W, innerW + 2 * PAD_X);
    const bubbleY = Math.round((SIZE - bubbleH) / 2);

    // bubble with a small tail pointing at the avatar
    const r = 18;
    const bubbleSvg = Buffer.from(
        `<svg width="${bubbleW + 12}" height="${bubbleH}" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 ${r} Q12 0 ${12 + r} 0 H${bubbleW + 12 - r} Q${bubbleW + 12} 0 ${bubbleW + 12} ${r} V${bubbleH - r} Q${bubbleW + 12} ${bubbleH} ${bubbleW + 12 - r} ${bubbleH} H${12 + r} Q12 ${bubbleH} 12 ${bubbleH - r} V16 L0 0 L12 4 Z" fill="${COLORS.bubble}"/>
        </svg>`);

    const avatarBuf = avatar
        ? await circle(avatar, AVATAR).catch(() => initialAvatar(name, seed, AVATAR))
        : await initialAvatar(name, seed, AVATAR);

    const layers = [
        { input: bubbleSvg, left: BUBBLE_X - 12, top: bubbleY },
        { input: avatarBuf, left: MARGIN, top: bubbleY + bubbleH - AVATAR - 4 },
        { input: nameImg.input, left: BUBBLE_X + PAD_X, top: bubbleY + PAD_Y },
        { input: textImg.input, left: BUBBLE_X + PAD_X, top: bubbleY + PAD_Y + nameImg.height + 4 }
    ];
    if (timeImg) layers.push({ input: timeImg.input, left: BUBBLE_X + bubbleW - PAD_X - timeImg.width + 4, top: bubbleY + bubbleH - PAD_Y - timeImg.height + 2 });

    return sharp(await background()).composite(layers).png().toBuffer();
}

// ─── WHO WROTE IT ─────────────────────────────────────────────────
function formatTime(tsSeconds) {
    const ms = tsSeconds ? Number(tsSeconds) * 1000 : Date.now();
    return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

function resolveName(sock, msg, authorJid, quotedId) {
    const { getPushName } = require('../stateManager');
    const stored = quotedId && global.messageStore ? global.messageStore[quotedId] : null;
    if (stored && stored.pushName) return stored.pushName;

    const author = bareId(authorJid);
    const cache = global.lidCache || {};
    const forms = new Set([authorJid]);
    if (cache[authorJid]) forms.add(cache[authorJid]);
    for (const [lid, phone] of Object.entries(cache)) if (bareId(phone) === author) forms.add(lid);
    for (const j of forms) {
        const n = getPushName(j);
        if (n) return n;
    }

    const sender = bareId(msg.key.participant || msg.key.remoteJid);
    if (msg.pushName && (author === sender || msg.key.fromMe && author === bareId(sock.user?.id))) return msg.pushName;
    if (author === bareId(sock.user?.id) || author === bareId(sock.user?.lid)) return sock.user?.name || 'Me';
    return /^\d{7,15}$/.test(author) && String(authorJid).endsWith('@s.whatsapp.net') ? `+${author}` : 'Unknown';
}

async function fetchAvatar(sock, authorJid, groupJid) {
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    const candidates = [];
    if (authorJid.endsWith('@lid')) {
        try {
            const { getPhoneJid } = require('../stateManager');
            const phone = await withTimeout(getPhoneJid(sock, authorJid, groupJid), 3000);
            if (phone && phone !== authorJid) candidates.push(phone);
        } catch (e) { /* use the raw jid */ }
    }
    candidates.push(authorJid);

    for (const jid of candidates) {
        try {
            const url = await withTimeout(sock.profilePictureUrl(jid, 'image'), 5000);
            if (!url) continue;
            const res = await withTimeout(fetch(url), 7000);
            if (!res.ok) continue;
            return Buffer.from(await res.arrayBuffer());
        } catch (e) { /* private / no picture: try the next form */ }
    }
    return null;
}

// Pulls the plain text out of a (quoted) message, or '' when it is not a text message.
function textOf(raw) {
    if (!raw) return '';
    if (raw.imageMessage || raw.videoMessage || raw.stickerMessage || raw.audioMessage || raw.documentMessage) return '';
    return raw.conversation || raw.extendedTextMessage?.text || '';
}

// Replaces @1234567 in the text with @Name when we know the name.
function nameMentions(text, mentionedJids, sock, msg) {
    let out = text;
    for (const j of mentionedJids || []) {
        const digits = bareId(j);
        const name = resolveName(sock, msg, j, null);
        if (name && !name.startsWith('+') && name !== 'Unknown') out = out.split(`@${digits}`).join(`@${name}`);
    }
    return out;
}

module.exports = { renderQuoteCard, resolveName, fetchAvatar, formatTime, textOf, nameMentions };
