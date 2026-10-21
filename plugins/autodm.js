// plugins/autodm.js
// .autodm <number of people> <message>   -> DM the first N members of this group
// .autodm <message>                      -> DM the first 30 members
// .autodm <number> <message> <link/jid>  -> same, for another group (works from a private chat too)
// .autodm stop                           -> stop a run in progress
//
// Anyone already messaged in the last 30 minutes (by this command, in any group)
// is skipped: the command still works, it just moves on to the next people.
// Owner / sudo only. Outside a group chat, a group invite link or group JID is required.
//
// RISK: bulk DMs to people who never wrote to you are exactly what WhatsApp's spam
// detection looks for. The delays below lower the risk but cannot remove it.

const { normalizeToJid } = require('../stateManager');

global.autodmSent = global.autodmSent || {};   // phone jid -> time we messaged them
global.autodmRun = global.autodmRun || null;   // { stop: bool } while a run is active

// ─── SETTINGS ────────────────────────────────────────────────────
const DEFAULT_COUNT = 30;
const MAX_COUNT = 100;                 // hard ceiling per run
const REPEAT_COOLDOWN_MS = 30 * 60 * 1000;  // same person is skipped for 30 minutes
const DELAY_MIN_MS = 8000;             // random wait between two DMs: 8 to 15 seconds
const DELAY_MAX_MS = 15000;
const BREAK_EVERY = 10;                // longer breather after every 10 DMs
const BREAK_MIN_MS = 40000;            // 40 to 70 seconds
const BREAK_MAX_MS = 70000;
const ABORT_AFTER_FAILURES = 3;        // this many failed sends in a row = stop (possible limit/ban)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function pruneSent() {
    const now = Date.now();
    for (const j of Object.keys(global.autodmSent)) {
        if (now - global.autodmSent[j] >= REPEAT_COOLDOWN_MS) delete global.autodmSent[j];
    }
}

// Group members can appear as @lid; we need a real phone JID to start a DM.
async function toPhoneJid(sock, p) {
    const candidates = [p.phoneNumber, p.jid, p.id].filter(Boolean).map(String);
    for (const c of candidates) {
        if (c.endsWith('@s.whatsapp.net')) return c;
        if (/^\d{6,}$/.test(c)) return `${c}@s.whatsapp.net`;
    }
    const lid = candidates.find(c => c.endsWith('@lid'));
    if (lid) {
        try {
            const res = await sock.findUserId(lid);
            if (res && res.phoneNumber) {
                const n = String(res.phoneNumber).replace(/\D/g, '');
                if (n) return `${n}@s.whatsapp.net`;
            }
        } catch (e) { /* cannot resolve */ }
    }
    return null;
}

// Members of the chosen group: the current group, a group JID, or an invite link.
// A JID needs the bot to be in that group. An invite link also works when it is not.
async function resolveParticipants(sock, target, currentJid) {
    if (!target) return (await sock.groupMetadata(currentJid)).participants || [];
    if (target.type === 'jid') {
        try {
            return (await sock.groupMetadata(target.jid)).participants || [];
        } catch (e) {
            throw new Error('the bot is not in that group (or the JID is wrong). Use the invite link instead.');
        }
    }
    let info;
    try {
        info = await sock.groupGetInviteInfo(target.code);
    } catch (e) {
        throw new Error('that invite link is invalid or expired.');
    }
    if (info?.id) {
        try { const m = await sock.groupMetadata(info.id); if (m?.participants?.length) return m.participants; } catch (e) { /* not a member: use invite info */ }
    }
    return info?.participants || [];
}

function estimateMinutes(n) {
    const avg = (DELAY_MIN_MS + DELAY_MAX_MS) / 2;
    const breaks = Math.floor(n / BREAK_EVERY) * ((BREAK_MIN_MS + BREAK_MAX_MS) / 2);
    return Math.max(1, Math.round((n * avg + breaks) / 60000));
}

module.exports = [
    {
        name: 'autodm',
        isPrefixless: false,
        description: 'DM the first N members of the group. Use: autodm <number> <message> | autodm <message> | autodm stop',
        category: 'owner',
        usage: 'autodm <number of people> <message>',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev } = {}) => {
            const jid = msg.key.remoteJid;
            if (!(isOwner || isSudo || isDev)) return;
            let input = (args || '').toString().trim();

            if (/^stop$/i.test(input)) {
                if (!global.autodmRun) return sock.sendMessage(jid, { text: 'ℹ️ No autodm run is active.' }, { quoted: msg });
                global.autodmRun.stop = true;
                return sock.sendMessage(jid, { text: '🛑 Stopping after the current message.' }, { quoted: msg });
            }

            // Optional target group: an invite link or a group JID anywhere in the text (usually last)
            let target = null; // { type: 'link', code } | { type: 'jid', jid }
            const linkM = input.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]{15,})\S*/i);
            const jidM = input.match(/\b(\d{6,}(?:-\d+)?@g\.us)\b/i);
            if (linkM) { target = { type: 'link', code: linkM[1] }; input = input.replace(linkM[0], ' ').replace(/\s+/g, ' ').trim(); }
            else if (jidM) { target = { type: 'jid', jid: jidM[1].toLowerCase() }; input = input.replace(jidM[0], ' ').replace(/\s+/g, ' ').trim(); }

            if (!target && !jid.endsWith('@g.us')) {
                return sock.sendMessage(jid, { text: '❌ Outside a group, add the target group: `autodm <number> <message> <group link or jid>`' }, { quoted: msg });
            }

            // "<number> <message>"  or just "<message>"
            let count = DEFAULT_COUNT;
            let text = input;
            const m = input.match(/^(\d+)\s+([\s\S]+)$/);
            if (m) { count = parseInt(m[1], 10); text = m[2].trim(); }
            else if (/^\d+$/.test(input)) {
                return sock.sendMessage(jid, { text: '❌ Add the message too: `autodm 20 your message here`' }, { quoted: msg });
            }
            if (!text) {
                return sock.sendMessage(jid, {
                    text: `📨 *AUTODM*\n\n\`autodm <number> <message>\` — DM the first N members\n\`autodm <message>\` — DM the first ${DEFAULT_COUNT}\n\`autodm <number> <message> <group link/jid>\` — another group (works in private chat)\n\`autodm stop\` — stop a run\n\nPeople messaged in the last 30 minutes are skipped.`
                }, { quoted: msg });
            }
            if (count < 1) return sock.sendMessage(jid, { text: '❌ The number of people must be at least 1.' }, { quoted: msg });
            let capped = false;
            if (count > MAX_COUNT) { count = MAX_COUNT; capped = true; }

            if (global.autodmRun) {
                return sock.sendMessage(jid, { text: '⏳ An autodm run is already in progress. Wait for it, or use `autodm stop`.' }, { quoted: msg });
            }

            const run = global.autodmRun = { stop: false };
            try {
                // Who is in the group, in group order, minus me and the person who ran the command
                let participants;
                try {
                    participants = await resolveParticipants(sock, target, jid);
                } catch (e) {
                    return sock.sendMessage(jid, { text: `❌ Could not read that group: ${e.message}` }, { quoted: msg });
                }
                if (!participants.length) {
                    return sock.sendMessage(jid, { text: '❌ That group returned no members I can read.' }, { quoted: msg });
                }
                const selfIds = new Set([
                    sock.user?.id && normalizeToJid(sock.user.id),
                    sock.user?.lid && normalizeToJid(sock.user.lid)
                ].filter(Boolean));
                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

                pruneSent();
                const targets = [];
                let skippedRecent = 0, unresolved = 0;
                for (const p of participants) {
                    if (targets.length >= count) break;
                    const ids = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean).map(x => normalizeToJid(String(x)));
                    if (ids.some(x => selfIds.has(x) || x === senderJid)) continue;
                    const phone = await toPhoneJid(sock, p);
                    if (!phone) { unresolved++; continue; }
                    if (selfIds.has(normalizeToJid(phone))) continue;
                    if (global.autodmSent[phone] && Date.now() - global.autodmSent[phone] < REPEAT_COOLDOWN_MS) { skippedRecent++; continue; }
                    targets.push(phone);
                }

                if (!targets.length) {
                    return sock.sendMessage(jid, {
                        text: `ℹ️ Nobody to message.${skippedRecent ? ` ${skippedRecent} member(s) were already messaged in the last 30 minutes.` : ''}${unresolved ? ` ${unresolved} member(s) had no readable number.` : ''}`
                    }, { quoted: msg });
                }

                await sock.sendMessage(jid, {
                    text:
                        `📨 *AUTODM STARTED*\n\n` +
                        `Sending to *${targets.length}* member(s)` +
                        `${capped ? ` (limit is ${MAX_COUNT} per run)` : ''}\n` +
                        `⏱️ About ${DELAY_MIN_MS / 1000}-${DELAY_MAX_MS / 1000}s between people, ~${estimateMinutes(targets.length)} min total\n` +
                        `${skippedRecent ? `⏭️ Skipping ${skippedRecent} messaged in the last 30 min\n` : ''}` +
                        `Use \`autodm stop\` to cancel.`
                }, { quoted: msg });

                let sent = 0, failed = 0, streak = 0, aborted = false;
                for (let i = 0; i < targets.length; i++) {
                    if (run.stop) break;
                    const phone = targets[i];
                    try {
                        await sock.sendMessage(phone, { text });
                        global.autodmSent[phone] = Date.now();
                        sent++; streak = 0;
                    } catch (e) {
                        failed++; streak++;
                        console.error(`❌ [AUTODM] ${phone.split('@')[0]}: ${e.message}`);
                        if (streak >= ABORT_AFTER_FAILURES) { aborted = true; break; }
                    }
                    if (i < targets.length - 1 && !run.stop) {
                        await sleep((i + 1) % BREAK_EVERY === 0 ? rand(BREAK_MIN_MS, BREAK_MAX_MS) : rand(DELAY_MIN_MS, DELAY_MAX_MS));
                    }
                }

                await sock.sendMessage(jid, {
                    text:
                        `${aborted ? '⚠️ *AUTODM ABORTED*' : run.stop ? '🛑 *AUTODM STOPPED*' : '✅ *AUTODM DONE*'}\n\n` +
                        `📤 Sent: *${sent}*\n` +
                        `${failed ? `❌ Failed: *${failed}*\n` : ''}` +
                        `${skippedRecent ? `⏭️ Skipped (messaged <30 min ago): *${skippedRecent}*\n` : ''}` +
                        `${unresolved ? `❓ No readable number: *${unresolved}*\n` : ''}` +
                        `${aborted ? `\n${ABORT_AFTER_FAILURES} failures in a row. Stopped to protect the account, so check whether it is limited.` : ''}`
                }, { quoted: msg });
            } catch (e) {
                console.error('❌ [AUTODM] run failed:', e.message);
                await sock.sendMessage(jid, { text: '⚠️ Autodm failed: ' + e.message }, { quoted: msg });
            } finally {
                global.autodmRun = null;
            }
        }
    }
];
