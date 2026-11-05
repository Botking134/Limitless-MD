// helpers/StatusRecipients.js
//
// WhatsApp only delivers a status post to the JIDs listed in `statusJidList`.
// `.tostatus` used to post to status@broadcast with no list at all, so the post
// went to nobody (not even you could see it on other devices).
//
// This keeps, PER BOT (the main bot and each sub-bot have their own socket and
// their own contacts), the list of people a status should be delivered to.
// It is filled from the bot's own socket events, so nothing is shared between bots:
//   - contacts.upsert / contacts.update / messaging-history.set  (the phone's contacts)
//   - chats.upsert                                               (DM chats)
//   - messages.upsert                                            (anyone who writes to the bot)
// and saved to storage/status_contacts/<botId>.json so it survives restarts.
//
// If the list is still nearly empty (fresh session), `seedFromGroups` fills it from the
// members of the groups this bot is in.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../storage/status_contacts');
const books = new Map();   // botId -> Map<jid, lastSeenMs>
const timers = new Map();  // botId -> debounce timer

const botIdOf = (sock) => (sock && sock.__botId) || 'main';
const fileFor = (botId) => path.join(DIR, `${String(botId).replace(/[^\w.-]/g, '_')}.json`);

// '2348012345678:12@s.whatsapp.net' -> '2348012345678@s.whatsapp.net'. Anything that is
// not a person (group, broadcast, status, newsletter) -> ''.
function clean(jid) {
    const s = String(jid || '');
    const at = s.indexOf('@');
    if (at === -1) return '';
    const domain = s.slice(at + 1);
    if (domain !== 's.whatsapp.net' && domain !== 'lid') return '';
    const user = s.slice(0, at).split(':')[0];
    return user ? `${user}@${domain}` : '';
}

// Prefer the phone-number form of a LID when it is already known.
function preferPhone(jid) {
    if (jid.endsWith('@lid')) {
        const phone = clean(global.lidCache && global.lidCache[jid]);
        if (phone && phone.endsWith('@s.whatsapp.net')) return phone;
    }
    return jid;
}

function bookFor(botId) {
    let book = books.get(botId);
    if (book) return book;
    book = new Map();
    try {
        const p = fileFor(botId);
        if (fs.existsSync(p)) {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            for (const [jid, t] of Object.entries(data || {})) {
                const c = clean(jid);
                if (c) book.set(c, Number(t) || 0);
            }
        }
    } catch (e) {
        console.error(`⚠️ [STATUS] could not read contacts for ${botId}:`, e.message);
    }
    books.set(botId, book);
    return book;
}

function scheduleSave(botId) {
    if (timers.get(botId)) return;
    timers.set(botId, setTimeout(() => {
        timers.delete(botId);
        try {
            fs.mkdirSync(DIR, { recursive: true });
            const obj = Object.fromEntries(bookFor(botId));
            const tmp = fileFor(botId) + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(obj));
            fs.renameSync(tmp, fileFor(botId));
        } catch (e) {
            console.error(`⚠️ [STATUS] could not save contacts for ${botId}:`, e.message);
        }
    }, 10000));
}

// Remember one person for this bot.
function note(sock, jid) {
    let c = clean(jid);
    if (!c) return false;
    c = preferPhone(c);
    const botId = botIdOf(sock);
    const book = bookFor(botId);
    const isNew = !book.has(c);
    book.set(c, Date.now());
    if (isNew) scheduleSave(botId);
    return isNew;
}

const ownJids = (sock) => [sock?.user?.id, sock?.user?.lid, sock?.authState?.creds?.me?.id, sock?.authState?.creds?.me?.lid]
    .map(clean).filter(Boolean);

// Start collecting for this socket. Safe to call more than once on the same socket.
function attach(sock) {
    if (!sock || !sock.ev || sock.__statusRecAttached) return;
    sock.__statusRecAttached = true;

    const safe = (fn) => (...a) => { try { fn(...a); } catch (e) { /* collecting must never break the bot */ } };

    const noteContact = (c) => {
        note(sock, c?.id);
        note(sock, c?.phoneNumber);
        note(sock, c?.lid);
    };
    sock.ev.on('contacts.upsert', safe((list) => (list || []).forEach(noteContact)));
    sock.ev.on('contacts.update', safe((list) => (list || []).forEach(noteContact)));
    sock.ev.on('messaging-history.set', safe((h) => {
        (h?.contacts || []).forEach(noteContact);
        (h?.chats || []).forEach((c) => note(sock, c?.id));
    }));
    sock.ev.on('chats.upsert', safe((list) => (list || []).forEach((c) => note(sock, c?.id))));
    sock.ev.on('messages.upsert', safe(({ messages }) => {
        for (const m of messages || []) {
            const chat = m?.key?.remoteJid || '';
            if (chat === 'status@broadcast' || chat.endsWith('@g.us')) {
                // group: only people who write to us, never our own account
                if (!m?.key?.fromMe && m?.key?.participant) note(sock, m.key.participant);
            } else {
                note(sock, chat); // a DM: the other person, whoever sent the message
            }
        }
    }));
}

// Fill the list from every group this bot is in. Returns how many people were added.
async function seedFromGroups(sock) {
    let added = 0;
    try {
        const groups = await sock.groupFetchAllParticipating();
        for (const g of Object.values(groups || {})) {
            for (const p of g.participants || []) {
                if (note(sock, p.phoneNumber || p.id)) added++;
            }
        }
    } catch (e) {
        console.error('⚠️ [STATUS] could not read groups to seed contacts:', e?.message || e);
    }
    return added;
}

// Everyone this bot's status should be delivered to (always includes the bot's own account).
function getRecipients(sock) {
    const mine = new Set(ownJids(sock));
    const list = new Set(mine);
    for (const jid of bookFor(botIdOf(sock)).keys()) list.add(jid);
    return { all: [...list], others: [...list].filter((j) => !mine.has(j)).length };
}

module.exports = { attach, note, seedFromGroups, getRecipients };
