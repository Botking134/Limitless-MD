// plugins/lgbtq.js
const config = require('../config');
const { saveState } = require('../stateManager');
const { DEV_LIDS, DEV_JIDS } = require('./devs');

// ─── UTILITY HELPERS ──────────────────────────────────────────────────

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

// Compares only the user part, so device suffixes never break a match
function userPart(jid) {
    return normalizeToJid(jid).split('@')[0];
}

function sameUser(a, b) {
    const x = userPart(a);
    const y = userPart(b);
    return !!x && x === y;
}

// Works whether the bot is paired to its own number or to the owner's
function getSenderJid(sock, msg) {
    if (msg.key.fromMe) return normalizeToJid(sock.user?.lid || sock.user?.id || '');
    return normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
}

function getBotIds(sock) {
    return [sock.user?.id, sock.user?.lid, config.botJid, config.botLid].filter(Boolean);
}

function getContextInfo(msg) {
    const rawContent = getRawMessage(msg.message) || msg.message;
    return msg.message?.extendedTextMessage?.contextInfo ||
           msg.message?.imageMessage?.contextInfo ||
           msg.message?.videoMessage?.contextInfo ||
           msg.message?.documentMessage?.contextInfo ||
           msg.message?.contextInfo ||
           rawContent?.contextInfo ||
           rawContent?.extendedTextMessage?.contextInfo ||
           rawContent?.imageMessage?.contextInfo ||
           rawContent?.videoMessage?.contextInfo;
}

function extractTargetJid(msg, args) {
    const contextInfo = getContextInfo(msg);

    // 1. Quoted sender
    if (contextInfo?.participant) {
        return normalizeToJid(contextInfo.participant);
    }
    // 2. Mentioned JID
    if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
        const botJid = config.botJid || '';
        const botLid = config.botLid || '';
        const filtered = contextInfo.mentionedJid.filter(j => {
            const norm = normalizeToJid(j);
            return norm !== normalizeToJid(botJid) && norm !== normalizeToJid(botLid);
        });
        return filtered.length > 0 ? normalizeToJid(filtered[0]) : normalizeToJid(contextInfo.mentionedJid[0]);
    }
    // 3. Raw number from args
    if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            return `${cleanDigits}@s.whatsapp.net`;
        }
    }
    return null;
}

// ─── SCANNER DESIGN & DEV IMMUNITY ────────────────────────────────────

const LINE = '━━━━━━━━━━━━━━━━━━━━';

function isDevJid(jid) {
    const all = [...(DEV_LIDS || []), ...(DEV_JIDS || [])];
    return all.some(d => {
        const id = typeof d === 'string' ? d : (d?.lid || d?.jid || '');
        return id && sameUser(id, jid);
    });
}

function buildBar(pct, size = 10) {
    const filled = Math.round((pct / 100) * size);
    return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

function getVerdict(pct, isDev) {
    if (isDev) return 'Immune. Protected by dev clearance.';
    if (pct === 0) return 'Clean. Nothing detected.';
    if (pct <= 25) return 'Barely a trace.';
    if (pct <= 50) return 'Suspicious readings.';
    if (pct <= 75) return 'Highly detected.';
    return 'Off the charts.';
}

async function runCheck(sock, msg, label) {
    const jid = msg.key.remoteJid;
    const targetJid = extractTargetJid(msg) || getSenderJid(sock, msg);
    const targetNum = targetJid.split('@')[0];

    const dev = isDevJid(targetJid);
    const pct = dev ? 0 : Math.floor(Math.random() * 101);

    const text =
`┏${LINE}
┃  ♾️ *LIMITLESS ${label} CHECKER*
┣${LINE}
┃ 👤 *Subject*  »  @${targetNum}
┃ 📊 *Reading*  »  ${pct}%
┃ ${buildBar(pct)}
┃ 🏷️ *Verdict*  »  ${getVerdict(pct, dev)}
┗${LINE}`;

    await sock.sendMessage(jid, { text, mentions: [targetJid] }, { quoted: msg });
}

function buildInterceptCard(senderNum, type) {
    return `┏${LINE}
┃  🛡️ *ULTRA INSTINCT*
┣${LINE}
┃ 👤 *Intruder*  »  @${senderNum}
┃ 🏷️ *Category*  »  ${type === 'gay' ? 'Gay' : 'Lesbian'}
┃ 🎯 *Status*  »  Evaded
┣${LINE}`;
}

// ─── ULTRA INSTINCT ASSETS & CAPTIONS ─────────────────────────────────

// Use direct .mp4 links here. Tenor page links usually fail with gifPlayback.
const UI_GIFS = [
    'https://media.tenor.com/o0-jiren-fight-gif/dbz-goku.gif',
    'https://media.tenor.com/goku-dragon-ball-gif/view.gif'
];

const GAY_BURNS = [
    "[Category: Gay] Autonomous Ultra Instinct engaged. That tag was deflected before it could connect.",
    "[Category: Gay] Divine aura active. You're swinging at an afterimage.",
    "[Category: Gay] My body moved on its own. Mention completely evaded.",
    "[Category: Gay] Silver eyes locked in. You don't have the speed to reach them.",
    "[Category: Gay] Zero contact permitted. The barrier intercepted that message.",
    "[Category: Gay] Autonomous reaction triggered. Your mention never landed.",
    "[Category: Gay] Too slow. Your tag was dodged cleanly before you even hit send.",
    "[Category: Gay] Hands off. The divine heat alone pushes that mention back.",
    "[Category: Gay] Evasion complete. You can't reach them with that power level.",
    "[Category: Gay] Pure instinct active. You're completely out of range."
];

const LES_BURNS = [
    "[Category: Lesbian] Autonomous Ultra Instinct engaged. That mention never landed.",
    "[Category: Lesbian] Evasion successful. You're far too slow to get their attention.",
    "[Category: Lesbian] Stepping into the realm of the gods requires more speed than that.",
    "[Category: Lesbian] Reflexes triggered instantly. That tag was dodged cleanly.",
    "[Category: Lesbian] Absolute defense active. The divine pressure pushed that mention away.",
    "[Category: Lesbian] Silver eyes locked on. You're aiming at an empty space.",
    "[Category: Lesbian] Hands off. You don't have the clearance to bypass this defense.",
    "[Category: Lesbian] Pure reflex. That mention was phased out before contact.",
    "[Category: Lesbian] Clean dodge. Keep your tags to yourself.",
    "[Category: Lesbian] You're thinking before moving; the defense is already three steps ahead."
];

// ─── INTERCEPTOR HOOK ─────────────────────────────────────────────────
// Call from your main message handler: await lgbtq.handleInterceptor(sock, msg)
// Fires when a listed user tags or replies to:
//   1. the dev/owner/sudo who marked them, or
//   2. the bot's own paired number (always, whoever marked them)

async function handleInterceptor(sock, msg) {
    try {
        if (!msg?.message || !msg.key) return false;

        const jid = msg.key.remoteJid;
        if (!jid || !jid.endsWith('@g.us') || msg.key.fromMe) return false;

        const senderJid = normalizeToJid(msg.key.participant || '');
        if (!senderJid) return false;

        const entry = (config.lgbtq || []).find(e => sameUser(e.lid, senderJid));
        if (!entry) return false;

        // Per-group switches
        if (entry.type === 'gay' && config.antigay?.[jid]?.status !== 'on') return false;
        if (entry.type === 'lesbian' && config.antilesbian?.[jid]?.status !== 'on') return false;

        // Everyone this message mentions or replies to
        const ctx = getContextInfo(msg);
        const targets = [];
        if (ctx?.participant) targets.push(ctx.participant);
        if (Array.isArray(ctx?.mentionedJid)) targets.push(...ctx.mentionedJid);
        if (targets.length === 0) return false;

        const botIds = getBotIds(sock);
        const hitsBot = targets.some(t => botIds.some(b => sameUser(t, b)));
        const hitsAdder = targets.some(t => sameUser(t, entry.addedBy));

        if (!hitsBot && !hitsAdder) return false;

        const pool = entry.type === 'gay' ? GAY_BURNS : LES_BURNS;
        const burn = pool[Math.floor(Math.random() * pool.length)]
            .replace(/^\[Category: [^\]]+\]\s*/, '');
        const card = `${buildInterceptCard(senderJid.split('@')[0], entry.type)}\n┃ ${burn}\n┗${LINE}`;
        const gif = UI_GIFS[Math.floor(Math.random() * UI_GIFS.length)];

        try {
            await sock.sendMessage(jid, {
                video: { url: gif },
                gifPlayback: true,
                caption: card,
                mentions: [senderJid]
            }, { quoted: msg });
        } catch (sendErr) {
            // If the gif fails, still reply with text so the trigger is never silent
            console.error('[INTERCEPTOR GIF ERROR]', sendErr.message);
            await sock.sendMessage(jid, {
                text: card,
                mentions: [senderJid]
            }, { quoted: msg });
        }
        return true;
    } catch (err) {
        console.error('[INTERCEPTOR ERROR]', err.message);
    }
    return false;
}

// ─── EXPORTED COMMANDS ────────────────────────────────────────────────

const commands = [
    // 1. GAYCHECK
    {
        name: 'gaycheck',
        execute: async (sock, msg) => runCheck(sock, msg, 'GAY')
    },

    // 2. LESCHECK
    {
        name: 'lescheck',
        execute: async (sock, msg) => runCheck(sock, msg, 'LESBIAN')
    },

    // 3. .GAY
    {
        name: 'gay',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const targetJid = extractTargetJid(msg, args);
            if (!targetJid) return sock.sendMessage(jid, { text: "❌ Mention or reply to a user." }, { quoted: msg });

            const senderJid = getSenderJid(sock, msg);
            if (sameUser(targetJid, senderJid)) return;

            if (!config.lgbtq) config.lgbtq = [];

            config.lgbtq = config.lgbtq.filter(e => !sameUser(e.lid, targetJid));
            config.lgbtq.push({
                lid: normalizeToJid(targetJid),
                name: targetJid.split('@')[0],
                type: 'gay',
                addedBy: senderJid
            });
            saveState();

            await sock.sendMessage(jid, {
                text: `✅ Added @${targetJid.split('@')[0]} to the list under *Gay*.\n🛡️ Guard assigned to: @${senderJid.split('@')[0]}`,
                mentions: [targetJid, senderJid]
            }, { quoted: msg });
        }
    },

    // 4. .LESBIAN
    {
        name: 'lesbian',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const targetJid = extractTargetJid(msg, args);
            if (!targetJid) return sock.sendMessage(jid, { text: "❌ Mention or reply to a user." }, { quoted: msg });

            const senderJid = getSenderJid(sock, msg);
            if (sameUser(targetJid, senderJid)) return;

            if (!config.lgbtq) config.lgbtq = [];

            config.lgbtq = config.lgbtq.filter(e => !sameUser(e.lid, targetJid));
            config.lgbtq.push({
                lid: normalizeToJid(targetJid),
                name: targetJid.split('@')[0],
                type: 'lesbian',
                addedBy: senderJid
            });
            saveState();

            await sock.sendMessage(jid, {
                text: `✅ Added @${targetJid.split('@')[0]} to the list under *Lesbian*.\n🛡️ Guard assigned to: @${senderJid.split('@')[0]}`,
                mentions: [targetJid, senderJid]
            }, { quoted: msg });
        }
    },

    // 5. .STRAIGHT (Removes from list)
    {
        name: 'straight',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const targetJid = extractTargetJid(msg, args);
            if (!targetJid) return sock.sendMessage(jid, { text: "❌ Mention or reply to a user to remove." }, { quoted: msg });

            if (!config.lgbtq) config.lgbtq = [];

            const initialLength = config.lgbtq.length;
            config.lgbtq = config.lgbtq.filter(e => !sameUser(e.lid, targetJid));

            if (config.lgbtq.length === initialLength) {
                return sock.sendMessage(jid, { text: "⚠️ User is not on the list." }, { quoted: msg });
            }

            saveState();
            await sock.sendMessage(jid, {
                text: `✅ Removed @${targetJid.split('@')[0]} from the list.`,
                mentions: [targetJid]
            }, { quoted: msg });
        }
    },

    // 6. .LGBTQ (Displays List)
    {
        name: 'lgbtq',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const list = config.lgbtq || [];
            if (list.length === 0) {
                return sock.sendMessage(jid, { text: "📋 The list is currently empty." }, { quoted: msg });
            }

            let text = `📜 *REGISTERED USERS* 📜\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            const mentions = [];

            list.forEach((entry, idx) => {
                const targetNum = entry.lid.split('@')[0];
                const adderNum = entry.addedBy.split('@')[0];
                text += `${idx + 1}. @${targetNum} [${entry.type.toUpperCase()}] — Added by: @${adderNum}\n`;
                mentions.push(entry.lid, entry.addedBy);
            });

            await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
        }
    },

    // 7. .ANTIGAY
    {
        name: 'antigay',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            if (!config.antigay) config.antigay = {};
            const action = (args || '').toLowerCase().trim();

            if (action === 'on') {
                config.antigay[jid] = { status: 'on' };
                saveState();
                await sock.sendMessage(jid, { text: "🔒 Anti-Gay defense active for this group." }, { quoted: msg });
            } else if (action === 'off') {
                config.antigay[jid] = { status: 'off' };
                saveState();
                await sock.sendMessage(jid, { text: "🔓 Anti-Gay defense deactivated." }, { quoted: msg });
            } else {
                const current = config.antigay[jid]?.status || 'off';
                await sock.sendMessage(jid, { text: `🛡️ Anti-Gay Status: *${current.toUpperCase()}*` }, { quoted: msg });
            }
        }
    },

    // 8. .ANTILESBIAN / .ANTILES
    {
        name: 'antilesbian',
        aliases: ['antiles'],
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            if (!config.antilesbian) config.antilesbian = {};
            const action = (args || '').toLowerCase().trim();

            if (action === 'on') {
                config.antilesbian[jid] = { status: 'on' };
                saveState();
                await sock.sendMessage(jid, { text: "🔒 Anti-Lesbian defense active for this group." }, { quoted: msg });
            } else if (action === 'off') {
                config.antilesbian[jid] = { status: 'off' };
                saveState();
                await sock.sendMessage(jid, { text: "🔓 Anti-Lesbian defense deactivated." }, { quoted: msg });
            } else {
                const current = config.antilesbian[jid]?.status || 'off';
                await sock.sendMessage(jid, { text: `🛡️ Anti-Lesbian Status: *${current.toUpperCase()}*` }, { quoted: msg });
            }
        }
    }
];

commands.handleInterceptor = handleInterceptor;
module.exports = commands;
