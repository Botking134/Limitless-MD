// pair.js
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { DEV_LIDS, DEV_JIDS, DEV_PHONE_JIDS } = require('./plugins/devs');
const { handleDeletion } = require('./helpers/log');
const { handleIncomingMessage } = require('./helpers/Infinity');
const { normalizeToJid, getPhoneJid, loadState, warmLidCache, getPushName } = require('./stateManager');
const ActivityManager = require('./helpers/ActivityManager');
const BotContext = require('./helpers/BotContext');
const { generateMemberCard, buildCaption } = require('./helpers/WelcomeCardManager');

// ─── INITIALIZE STATE ON BOOT ──────────────────────────────────
try { loadState(); } catch (e) { console.error("⚠️ State load error:", e.message); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ─── TRACKERS & DEDUPLICATION ──────────────────────────────────
const botSentMessageIds = new Set();
const processedEventsCache = new Map();
let hasSentBootReport = false;
let activeSocketInstance = null;

global.pairingStatus = global.pairingStatus || {
    status: 'initializing',
    qrRaw: null,
    qrImage: null,
    pairingCode: null,
    phoneNumber: null,
    lastUpdate: Date.now(),
    errorMessage: null,
    user: null,
    registered: false
};

function isDuplicateEvent(key) {
    const now = Date.now();
    if (processedEventsCache.has(key)) {
        const timestamp = processedEventsCache.get(key);
        if (now - timestamp < 300000) return true; // 5 min TTL
    }
    processedEventsCache.set(key, now);
    if (processedEventsCache.size > 2000) {
        const oldestKey = processedEventsCache.keys().next().value;
        processedEventsCache.delete(oldestKey);
    }
    return false;
}

const isEnabled = (val) => val === true || val === 'on' || val === 'enable' || val === 'true' || val === '1';

// This fork adds heavy LID-awareness (it even ships its own 'lid-mapping.update' event),
// so participant/author entries on group-participants.update can arrive as either a plain
// JID string OR a richer object (e.g. { id, lid, jid }). Blindly calling String() on an
// object produces the literal text "[object Object]" — which is exactly the bug reported
// in welcome/promote/demote alerts ("@[object Object] promoted to Admin..."). This safely
// extracts the real identifier regardless of which shape actually comes through.
function resolveParticipantIdentifier(entry) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') {
        return entry.jid || entry.id || entry.lid || entry.phoneNumber || entry.number || '';
    }
    return entry ? String(entry) : '';
}

// ─── MEDIA FETCHER ─────────────────────────────────────────────
async function fetchMediaBuffer(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length < 500) return null;
        return buffer;
    } catch (e) {
        return null;
    }
}

// ─── GLOBAL SESSIONS & CACHES ──────────────────────────────────
global.messageStore = global.messageStore || {};
global.spamTracker = global.spamTracker || {};
global.spamDeletedCount = global.spamDeletedCount || {};
global.azaSessions = global.azaSessions || {};
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};
global.noteSessions = global.noteSessions || {};

global.triviaSessions = global.triviaSessions || {};
global.charadeSessions = global.charadeSessions || {};
global.anagramSessions = global.anagramSessions || {};
global.wcgSessions = global.wcgSessions || {};
global.millionaireSessions = global.millionaireSessions || {};
global.torfSessions = global.torfSessions || {};
global.pvpSessions = global.pvpSessions || {};
global.escapeSessions = global.escapeSessions || {};
global.vault8Sessions = global.vault8Sessions || {};

global.aiMemory = global.aiMemory || {};
global.botMessageAgents = global.botMessageAgents || {};

global.isReconnecting = global.isReconnecting || false;
global.reconnectAttempts = global.reconnectAttempts || 0;
global.reconnectTimeout = global.reconnectTimeout || null;

// ─── MAIN BOT STARTER ──────────────────────────────────────────

async function requestPairingCode(phoneNumber) {
    if (!activeSocketInstance) {
        throw new Error("Bot socket engine is not initialized yet. Please wait a few seconds.");
    }
    const cleanNumber = String(phoneNumber || '').replace(/[^0-9]/g, '');
    if (!cleanNumber || cleanNumber.length < 7) {
        throw new Error("Invalid phone number. Please include country code, e.g. 2347059092107");
    }

    global.pairingStatus.status = 'requesting_code';
    global.pairingStatus.phoneNumber = cleanNumber;
    global.pairingStatus.errorMessage = null;
    global.pairingStatus.lastUpdate = Date.now();

    try {
        const code = await activeSocketInstance.requestPairingCode(cleanNumber, "INFINITY");
        global.pairingStatus.status = 'pairing_code_ready';
        global.pairingStatus.pairingCode = code;
        global.pairingStatus.lastUpdate = Date.now();
        console.log(`\n🔑 [PAIRING CODE] Generated for ${cleanNumber}: \x1b[32m\x1b[1m${code}\x1b[0m\n`);
        return code;
    } catch (error) {
        global.pairingStatus.status = 'error';
        global.pairingStatus.errorMessage = error.message || "Failed to request pairing code";
        global.pairingStatus.lastUpdate = Date.now();
        console.error("❌ Failed to request pairing code:", error.message);
        throw error;
    }
}

function getPairingStatus() {
    return {
        ...global.pairingStatus,
        botName: config.botName,
        prefix: config.prefix,
        ownerNumber: config.ownerNumber,
        uptime: process.uptime()
    };
}

async function clearAuthSession() {
    const authFolder = path.join(__dirname, 'storage', 'session_auth');
    try {
        if (activeSocketInstance) {
            activeSocketInstance.ev.removeAllListeners();
            if (activeSocketInstance.ws) activeSocketInstance.ws.close();
            activeSocketInstance = null;
        }
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }
        global.pairingStatus.status = 'unregistered';
        global.pairingStatus.registered = false;
        global.pairingStatus.qrImage = null;
        global.pairingStatus.qrRaw = null;
        global.pairingStatus.pairingCode = null;
        global.pairingStatus.user = null;
        global.pairingStatus.lastUpdate = Date.now();
        console.log("🧹 [SESSION] Auth storage cleared successfully.");
        return true;
    } catch (e) {
        console.error("❌ [SESSION] Failed to clear auth storage:", e.message);
        throw e;
    }
}

async function restartBot() {
    if (activeSocketInstance) {
        try {
            activeSocketInstance.ev.removeAllListeners();
            if (activeSocketInstance.ws) activeSocketInstance.ws.close();
        } catch (e) {}
        activeSocketInstance = null;
    }
    hasSentBootReport = false;
    global.reconnectAttempts = 0;
    global.isReconnecting = false;
    if (global.reconnectTimeout) {
        clearTimeout(global.reconnectTimeout);
        global.reconnectTimeout = null;
    }
    return startBot();
}

function getActiveSocket() {
    return activeSocketInstance;
}

// ─── SHARED HANDLERS (main bot + sub-bots) ────────────────────────
// These used to be inline closures inside startBot(), so only the main
// socket ever had them — sub-bots (helpers/SubBotManager.js) never got
// join/leave/promote/demote alerts, antijoin, welcome/goodbye cards, or
// deletion handling, even with those settings switched on. Lifted to
// module scope so any socket can use them.
// ─── USERNAME-RENDERING MENTIONS (gcalerts) ───────────────────────
// WhatsApp shows a member's display name for an @mention only when the
// mentioned JID is their @lid form (that's why .addowner shows usernames);
// mentioning the phone-number JID shows a bare number. The alert handler
// resolves everything to phone JIDs for its logic (kicks, dedupe, join
// tracking), so this finds the matching @lid purely for the mention. The
// text token (@digits) must use the same digits as the mentioned JID or
// WhatsApp won't turn it into a pill.
function findParticipantLid(raw, entry, phoneJid, metadata) {
    const asLid = (v) => {
        if (!v || typeof v !== 'string') return '';
        const n = normalizeToJid(v);
        return n && n.endsWith('@lid') ? n : '';
    };
    if (asLid(raw)) return asLid(raw);
    if (entry && typeof entry === 'object' && asLid(entry.lid)) return asLid(entry.lid);
    const match = metadata?.participants?.find(x => {
        const id = x?.id ? normalizeToJid(x.id) : '';
        const ph = x?.phoneNumber ? normalizeToJid(x.phoneNumber) : '';
        return id === phoneJid || ph === phoneJid;
    });
    if (match) {
        if (asLid(match.lid)) return asLid(match.lid);
        if (asLid(match.id)) return asLid(match.id);
    }
    for (const [lid, phone] of Object.entries(global.lidCache || {})) {
        if (phone === phoneJid && lid.endsWith('@lid')) return lid;
    }
    return '';
}

// build(usePill) returns the message content. Tries the username-rendering
// (@lid) version first; if that send throws, retries once with the plain
// phone-number version so an alert is never lost over how it's mentioned.
async function sendPillAlert(sock, jid, build, hasPill) {
    try {
        return await sock.sendMessage(jid, build(!!hasPill));
    } catch (e) {
        if (!hasPill) throw e;
        console.error('⚠️ [GCALERTS] @lid mention send failed, retrying with phone-number mention:', e.message);
        return await sock.sendMessage(jid, build(false));
    }
}

async function handleGroupParticipantsUpdate(sock, anu) {
        try {
            if (!anu || !anu.id || !anu.participants || !anu.participants.length) return;

            const jid = normalizeToJid(anu.id);
            const participants = anu.participants;
            const action = anu.action;

            const alertsPath = path.join(__dirname, 'storage', 'gcalerts.json');
            let data = { welcome: {}, goodbye: {}, promote: {}, demote: {}, customWelcome: {}, customGoodbye: {}, antijoin: {}, antipromote: {}, antidemote: {}, overkill: {} };
            try {
                if (fs.existsSync(alertsPath)) data = JSON.parse(fs.readFileSync(alertsPath, 'utf-8'));
            } catch (e) {
                console.error('⚠️ [GROUP-PARTICIPANTS.UPDATE] gcalerts.json is corrupt/unreadable, falling back to defaults:', e.message);
            }

            let groupName = 'Group';
            let metadata = null;
            try {
                metadata = await sock.groupMetadata(jid);
                groupName = metadata?.subject || 'Group';
                // Free win: this metadata already lists every current member's lid+id
                // pair. Caching all of them now (not just whoever this one event is
                // about) means a future leave/remove for any of them can resolve
                // instantly from cache instead of hitting the exact race condition
                // that breaks resolution on the way out — WhatsApp can already have
                // dropped a leaving member from the roster by the time this handler
                // runs, so metadata fetched *at* that moment often can't help them
                // specifically, but everyone else here right now still can be.
                warmLidCache(metadata);
            } catch (e) {
                console.error(`⚠️ [GROUP-PARTICIPANTS.UPDATE] Failed to fetch metadata for ${jid}:`, e.message);
            }

            const botJid = normalizeToJid(sock.user?.id || '').split(':')[0].split('@')[0] + '@s.whatsapp.net';
            const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';

            let rawActor = resolveParticipantIdentifier(anu.author);
            let actorJid = '';
            let actorResolved = true;
            if (rawActor) {
                actorJid = await getPhoneJid(sock, rawActor, jid, metadata);
                if (!actorJid || actorJid.endsWith('@lid')) {
                    // Absolute last resort — same old behavior, but now only reached if
                    // getPhoneJid's local-metadata AND live API lookup both genuinely failed.
                    // NOTE: getPhoneJid's own last line returns the raw @lid JID rather than
                    // '' on failure, so the old `if (!actorJid)` check here never actually
                    // fired — an unresolved @lid JID was slipping straight through into
                    // sendMessage()/mentions below. WhatsApp's servers appear to reject a
                    // stanza that mentions a non-@s.whatsapp.net JID, which is what was
                    // killing the socket (reason 500) instead of delivering the welcome/
                    // goodbye card.
                    actorJid = rawActor.split(':')[0].split('@')[0] + '@s.whatsapp.net';
                    actorResolved = false;
                    console.error(`⚠️ [GROUP-PARTICIPANTS.UPDATE] Could not resolve actor LID ${rawActor} to a real phone JID in ${jid}.`);
                }
            }

            const isActorBot = actorJid === botJid || (botLid && rawActor.includes(botLid.split('@')[0]));
            const isActorDev = DEV_LIDS.some(d => rawActor.includes(d.split('@')[0])) || DEV_JIDS.includes(actorJid) || DEV_PHONE_JIDS.includes(actorJid);
            const isActorOwner = actorJid === config.ownerJid || (config.ownerLid && rawActor.includes(config.ownerLid.split('@')[0])) || (Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(actorJid));
            const isActorSudo = Array.isArray(config.sudos) && config.sudos.includes(actorJid);
            const isActorAuthorized = isActorBot || isActorDev || isActorOwner || isActorSudo;

            for (const num of participants) {
                let rawTarget = resolveParticipantIdentifier(num);
                if (!rawTarget) continue;

                let targetJid = await getPhoneJid(sock, rawTarget, jid, metadata);
                let targetResolved = !!targetJid && !targetJid.endsWith('@lid');

                // A brand-new join can fire before WhatsApp's own backend has made
                // that member's LID queryable yet — getPhoneJid's single attempt
                // (cached metadata, then one live findUserId call) genuinely can't
                // do anything about that; it needs a moment, not a smarter lookup.
                // Only worth the delay for 'add': for remove/promote/demote the
                // member already existed in the group before this event, so a
                // fresh-join race doesn't apply the same way.
                if (!targetResolved && action === 'add') {
                    for (const waitMs of [1500, 3000]) {
                        await new Promise(r => setTimeout(r, waitMs));
                        let freshMetadata = null;
                        try { freshMetadata = await sock.groupMetadata(jid); } catch (e) { /* keep the stale one below */ }
                        targetJid = await getPhoneJid(sock, rawTarget, jid, freshMetadata || metadata);
                        targetResolved = !!targetJid && !targetJid.endsWith('@lid');
                        if (targetResolved) {
                            if (freshMetadata) { metadata = freshMetadata; warmLidCache(freshMetadata); }
                            break;
                        }
                    }
                }

                if (!targetResolved) {
                    // Same fix as the actor lookup above — an unresolved @lid JID must not
                    // reach sendMessage()/mentions, since that's what was triggering the
                    // reason-500 disconnects on join/exit. But building a fake "phone number"
                    // out of the LID's own digits and @-mentioning it is its own bug: those
                    // digits aren't a real phone number, so the mention can land on a
                    // completely unrelated, uninvolved WhatsApp account. When resolution
                    // genuinely fails, targetResolved goes false and every message below
                    // switches to a plain, non-mentioning label instead of a fabricated one.
                    targetJid = rawTarget.split(':')[0].split('@')[0] + '@s.whatsapp.net';
                    console.error(`⚠️ [GROUP-PARTICIPANTS.UPDATE] Could not resolve target LID ${rawTarget} to a real phone JID in ${jid}${action === 'add' ? ' (retried twice with delay, still unresolved)' : ''}.`);
                }

                const phoneNumber = targetJid.split('@')[0];
                // A pushName only ever gets learned from a message someone has
                // actually sent (see stateManager.js's pushname cache) — a brand
                // new join with zero prior interaction genuinely has nothing to
                // look up here regardless. But a returning member (rejoining, or
                // someone the bot has seen speak in another group before) often
                // does have one cached, even on a run where resolution itself
                // fails — this is a separate, better source than targetResolved.
                const cachedName = getPushName(rawTarget) || (targetResolved ? getPushName(targetJid) : '');
                const targetLabel = targetResolved
                    ? (cachedName ? `~${cachedName} (@${phoneNumber})` : `@${phoneNumber}`)
                    : (cachedName ? `~${cachedName} (ID unresolved)` : 'a member (ID unresolved)');
                const targetMentions = targetResolved ? [targetJid] : [];

                // Username-rendering identity for the @mention (see findParticipantLid).
                const pillLid = targetResolved ? findParticipantLid(rawTarget, num, targetJid, metadata) : '';
                const hasPill = !!pillLid;
                const pillDigits = hasPill ? pillLid.split('@')[0] : phoneNumber;
                const pillLabel = hasPill ? `@${pillDigits}` : targetLabel;
                const pillMentions = targetResolved ? [pillLid || targetJid] : [];
                const actorLid = (actorResolved && actorJid) ? findParticipantLid(rawActor, null, actorJid, metadata) : '';

                const eventSignature = `${jid}_${targetJid}_${action}`;
                if (isDuplicateEvent(eventSignature)) continue;

                try {

                if (action === 'add') {
                    const isAntijoinOn = isEnabled(data.antijoin?.[jid]) || isEnabled(config.antijoin?.[jid]);
                    if (isAntijoinOn && !isActorAuthorized) {
                        try {
                            await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                            await sendPillAlert(sock, jid, (p) => ({
                                text: `🔒 *Anti-Join Protection active!* Expelled ${p ? pillLabel : targetLabel}.`,
                                mentions: p ? pillMentions : targetMentions
                            }), hasPill);
                            continue;
                        } catch (e) {
                            // Was a silent empty catch — a failed kick (e.g. bad
                            // target JID from a metadata fetch that failed during
                            // a reconnect, or the bot lacking admin) looked
                            // identical to antijoin doing nothing at all, with
                            // zero trace anywhere. Falls through to the normal
                            // welcome flow below rather than staying silent.
                            console.error(`⚠️ [ANTIJOIN] Failed to expel ${targetJid} in ${jid}:`, e.message);
                            try {
                                await sendPillAlert(sock, jid, (p) => ({
                                    text: `⚠️ *Anti-Join Protection triggered but failed to expel* ${p ? pillLabel : targetLabel} — I likely need to be a group admin here, or couldn't resolve their identity in time.`,
                                    mentions: p ? pillMentions : targetMentions
                                }), hasPill);
                            } catch (e2) {}
                        }
                    }

                    // Baseline for "activity since joining" is captured regardless of
                    // whether the welcome card is enabled, so .rank/goodbye stats stay accurate.
                    try { ActivityManager.registerJoin(jid, targetJid); } catch (e) {}

                    const isWelcomeOn = isEnabled(data.welcome?.[jid]) || isEnabled(config.welcome?.[jid]);
                    if (isWelcomeOn) {
                        const memberCount = metadata?.participants?.length || 0;
                        const buildWelcome = (p) => buildCaption({
                            type: 'welcome',
                            phoneNumber: p ? pillDigits : phoneNumber,
                            groupName,
                            memberCount,
                            customMessage: data.customWelcome?.[jid] || null
                        });

                        // Text goes out first and unconditionally — this is the same
                        // lightweight shape as every other alert in this file (antijoin,
                        // antipromote, promote) and is what actually needs to land. The
                        // image card is a nice-to-have sent as a decoupled follow-up:
                        // building it involves a full sharp render plus a fresh WhatsApp
                        // media-upload round-trip, which is a much bigger ask of the
                        // socket than a text mention and appears to be what was tripping
                        // WhatsApp's flood protection (reason 500) during join/exit
                        // bursts. If the image fails now, it just logs and stops — no
                        // second send is attempted on a socket that may already be dead,
                        // which is what was silently swallowing both messages before.
                        try {
                            await sendPillAlert(sock, jid, (p) => ({ text: buildWelcome(p), mentions: p ? pillMentions : targetMentions }), hasPill);
                        } catch (textErr) {
                            console.error('⚠️ [WELCOME TEXT] Failed to send:', textErr.message);
                        }

                        try {
                            const cardImage = await generateMemberCard(sock, {
                                type: 'welcome',
                                targetJid,
                                displayName: targetLabel,
                                groupName,
                                memberCount
                            });
                            await sock.sendMessage(jid, { image: cardImage, mimetype: 'image/jpeg', mentions: targetMentions });
                        } catch (cardErr) {
                            console.error('⚠️ [WELCOME CARD] Image follow-up failed (text already sent):', cardErr.message);
                        }
                    }
                } else if (action === 'remove') {
                    const isGoodbyeOn = isEnabled(data.goodbye?.[jid]) || isEnabled(config.goodbye?.[jid]);
                    if (isGoodbyeOn) {
                        const memberCount = metadata?.participants?.length || 0;
                        const { activityPercent } = ActivityManager.getLeaveStats(jid, targetJid);
                        const buildGoodbye = (p) => buildCaption({
                            type: 'goodbye',
                            phoneNumber: p ? pillDigits : phoneNumber,
                            groupName,
                            memberCount,
                            activityPercent,
                            customMessage: data.customGoodbye?.[jid] || null
                        });

                        // Same reasoning as the welcome path above: text first and always,
                        // image as a decoupled best-effort follow-up.
                        try {
                            await sendPillAlert(sock, jid, (p) => ({ text: buildGoodbye(p), mentions: p ? pillMentions : targetMentions }), hasPill);
                        } catch (textErr) {
                            console.error('⚠️ [GOODBYE TEXT] Failed to send:', textErr.message);
                        }

                        try {
                            const cardImage = await generateMemberCard(sock, {
                                type: 'goodbye',
                                targetJid,
                                displayName: targetLabel,
                                groupName,
                                memberCount
                            });
                            await sock.sendMessage(jid, { image: cardImage, mimetype: 'image/jpeg', mentions: targetMentions });
                        } catch (cardErr) {
                            console.error('⚠️ [GOODBYE CARD] Image follow-up failed (text already sent):', cardErr.message);
                        }
                    }
                } else if (action === 'promote') {
                    let handledByProtection = false;
                    if (!isActorAuthorized) {
                        const antipromoteMode = data.antipromote?.[jid] || 'off';
                        const overkillArmed = isEnabled(data.overkill?.[jid]);
                        if (antipromoteMode === 'overkill' || overkillArmed) {
                            handledByProtection = true;
                            try {
                                const { triggerEmergencyPurge } = require('./plugins/gcalerts');
                                await triggerEmergencyPurge(sock, jid, actorJid || targetJid);
                            } catch (e) { console.error('❌ [OVERKILL PURGE ERROR]:', e.message); }
                        } else if (antipromoteMode === 'on') {
                            handledByProtection = true;
                            try {
                                // Demote both the person who got promoted AND whoever promoted them
                                // without authorization — punishing only the victim would leave the
                                // rogue admin free to just promote someone else again. Separate calls
                                // so one failing (e.g. actor is the group's real creator, who can't
                                // be demoted) doesn't block the other from going through.
                                await sock.groupParticipantsUpdate(jid, [targetJid], "demote");
                                if (actorJid && actorJid !== targetJid) {
                                    try { await sock.groupParticipantsUpdate(jid, [actorJid], "demote"); } catch (e) {}
                                }

                                const includeActor = actorJid && actorJid !== targetJid;
                                const buildProt = (p) => {
                                    const aTok = ((p && actorLid) ? actorLid : (actorJid || '')).split('@')[0];
                                    const aMention = (p && actorLid) ? actorLid : actorJid;
                                    const base = p ? pillMentions : targetMentions;
                                    const list = includeActor && actorResolved ? [...base, aMention] : base;
                                    const line = includeActor
                                        ? (actorResolved ? ` @${aTok} (the promoter) was also demoted.` : ` The promoter (ID unresolved) was also demoted.`)
                                        : '';
                                    return {
                                        text: `🛡️ *Anti-Promote Protection!* Unauthorized promotion of ${p ? pillLabel : targetLabel} was reverted.${line}`,
                                        mentions: list
                                    };
                                };
                                await sendPillAlert(sock, jid, buildProt, hasPill || !!actorLid);
                            } catch (e) { console.error('❌ [ANTIPROMOTE REVERT ERROR]:', e.message); }
                        }
                    }

                    if (!handledByProtection) {
                        const isPromoteOn = isEnabled(data.promote?.[jid]) || isEnabled(config.promote?.[jid]);
                        if (isPromoteOn) {
                            await sendPillAlert(sock, jid, (p) => ({
                                text: `👑 *PROMOTION ALERT!*

🎉 ${p ? pillLabel : targetLabel} promoted to Admin in *${groupName}*!`,
                                mentions: p ? pillMentions : targetMentions
                            }), hasPill);
                        }
                    }
                } else if (action === 'demote') {
                    let handledByProtection = false;
                    if (!isActorAuthorized) {
                        const antidemoteMode = data.antidemote?.[jid] || 'off';
                        const overkillArmed = isEnabled(data.overkill?.[jid]);
                        if (antidemoteMode === 'overkill' || overkillArmed) {
                            handledByProtection = true;
                            try {
                                const { triggerEmergencyPurge } = require('./plugins/gcalerts');
                                await triggerEmergencyPurge(sock, jid, actorJid || targetJid);
                            } catch (e) { console.error('❌ [OVERKILL PURGE ERROR]:', e.message); }
                        } else if (antidemoteMode === 'on') {
                            handledByProtection = true;
                            try {
                                // Restore the demoted victim's admin status AND demote whoever
                                // demoted them without authorization.
                                await sock.groupParticipantsUpdate(jid, [targetJid], "promote");
                                if (actorJid && actorJid !== targetJid) {
                                    try { await sock.groupParticipantsUpdate(jid, [actorJid], "demote"); } catch (e) {}
                                }

                                const includeActor = actorJid && actorJid !== targetJid;
                                const buildProt = (p) => {
                                    const aTok = ((p && actorLid) ? actorLid : (actorJid || '')).split('@')[0];
                                    const aMention = (p && actorLid) ? actorLid : actorJid;
                                    const base = p ? pillMentions : targetMentions;
                                    const list = includeActor && actorResolved ? [...base, aMention] : base;
                                    const line = includeActor
                                        ? (actorResolved ? ` @${aTok} (the demoter) was also demoted.` : ` The demoter (ID unresolved) was also demoted.`)
                                        : '';
                                    return {
                                        text: `🛡️ *Anti-Demote Protection!* Unauthorized demotion of ${p ? pillLabel : targetLabel} was reverted.${line}`,
                                        mentions: list
                                    };
                                };
                                await sendPillAlert(sock, jid, buildProt, hasPill || !!actorLid);
                            } catch (e) { console.error('❌ [ANTIDEMOTE REVERT ERROR]:', e.message); }
                        }
                    }

                    if (!handledByProtection) {
                        const isDemoteOn = isEnabled(data.demote?.[jid]) || isEnabled(config.demote?.[jid]);
                        if (isDemoteOn) {
                            await sendPillAlert(sock, jid, (p) => ({
                                text: `🛡️ *DEMOTION ALERT!*

👋 ${p ? pillLabel : targetLabel} demoted to Member in *${groupName}*.`,
                                mentions: p ? pillMentions : targetMentions
                            }), hasPill);
                        }
                    }
                }

                } catch (participantErr) {
                    console.error(`❌ [GROUP-PARTICIPANTS.UPDATE] Failed processing ${targetJid} (${action}) in ${jid}:`, participantErr.message, '\n', participantErr.stack);
                }
            }
        } catch (e) {
            console.error('❌ [GROUP-PARTICIPANTS.UPDATE] Handler crashed:', e.message, '\n', e.stack);
        }
}

// Only ONE bot should act on a given group's participant events. If the main
// bot and a sub-bot (or several sub-bots) share a group they all receive the
// same event, and without this every one of them would send its own welcome
// card / alert and race to kick the same person for antijoin.
// Rule: the main bot always wins. Sub-bots wait a staggered moment, then only
// act if no OTHER bot has recently acted for that group (a short lease).
const gpuLeases = new Map(); // groupJid -> { botId, at }
const GPU_LEASE_MS = 60 * 1000;

async function dispatchGroupParticipantsUpdate(sock, anu) {
    const botId = sock.__botId || BotContext.MAIN_ID;
    const groupKey = normalizeToJid(anu?.id || '');

    if (botId !== BotContext.MAIN_ID) {
        const order = [...(global.subBotSockets?.keys() || [])].indexOf(botId);
        await new Promise(r => setTimeout(r, 1500 * (Math.max(order, 0) + 1)));
        const lease = gpuLeases.get(groupKey);
        if (lease && lease.botId !== botId && Date.now() - lease.at < GPU_LEASE_MS) return;
    }

    gpuLeases.set(groupKey, { botId, at: Date.now() });
    // runAsBot scopes every config.<setting> read (welcome, goodbye, antipromote,
    // ...) to THIS bot's own settings, since this handler runs outside the
    // per-message context Infinity.js normally sets up.
    return BotContext.runAsBot(botId, () => handleGroupParticipantsUpdate(sock, anu));
}

// Deleted-message handling (antidelete). Same one-bot-per-event rule, keyed by
// the deleted message's id.
const deletionClaims = new Map(); // messageId -> botId

async function handleMessagesUpdate(sock, updates) {
    try {
        const botId = sock.__botId || BotContext.MAIN_ID;
        for (const update of updates) {
            if (update?.update?.message !== null) continue;
            const deletedMsgId = update.key.id;
            const jid = update.key.remoteJid;
            if (!(global.messageStore && global.messageStore[deletedMsgId])) continue;

            if (botId !== BotContext.MAIN_ID) {
                const order = [...(global.subBotSockets?.keys() || [])].indexOf(botId);
                await new Promise(r => setTimeout(r, 1500 * (Math.max(order, 0) + 1)));
            }
            const claimedBy = deletionClaims.get(deletedMsgId);
            if (claimedBy && claimedBy !== botId) continue;
            deletionClaims.set(deletedMsgId, botId);
            if (deletionClaims.size > 500) deletionClaims.delete(deletionClaims.keys().next().value);

            const originalMsg = global.messageStore[deletedMsgId];
            const revoker = update.key.participant || update.key.remoteJid || '';
            await BotContext.runAsBot(botId, () => handleDeletion(sock, originalMsg, jid, revoker));
        }
    } catch (e) {}
}

// Keeps recent messages so deletions can be recovered. Sub-bots need this too —
// previously only the main bot's upsert handler filled global.messageStore.
function cacheIncomingMessage(m) {
    if (!(m && m.key && m.key.id && m.message)) return;
    global.messageStore = global.messageStore || {};
    global.messageStore[m.key.id] = m;
    const storeKeys = Object.keys(global.messageStore);
    if (storeKeys.length > 2000) delete global.messageStore[storeKeys[0]];
}

async function startBot() {
    if (activeSocketInstance) {
        try {
            activeSocketInstance.ev.removeAllListeners();
            if (activeSocketInstance.ws) activeSocketInstance.ws.close();
        } catch (e) {}
        activeSocketInstance = null;
    }

    const {
        default: makeWASocket,
        useMultiFileAuthState,
        Browsers,
        DisconnectReason
    } = await import('@itsliaaa/baileys');

    const authFolder = path.join(__dirname, 'storage', 'session_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    global.pairingStatus.registered = !!state.creds.registered;
    global.pairingStatus.status = state.creds.registered ? 'connecting' : 'waiting_for_auth';
    global.pairingStatus.lastUpdate = Date.now();

    let targetNumber = null;
    let pairingMode = false;

    // In interactive terminal, allow fast CLI prompt; in web/headless mode, don't block
    if (!state.creds.registered && process.stdin.isTTY) {
        console.log(`
========================================
⚡ AUTHENTICATION REQUIRED
========================================
1. Request Pairing Code (Enter number)
2. Scan QR Code (Display QR)
========================================
(You can also use the Web UI on port 3000 to scan QR or generate code)
`);
        try {
            const promptPromise = question('Select option (1 or 2, or press Enter for QR): ');
            const timeoutPromise = new Promise(r => setTimeout(() => r('timeout'), 8000));
            const choice = await Promise.race([promptPromise, timeoutPromise]);

            if (choice === '1') {
                pairingMode = true;
                console.log('👉 Enter your WhatsApp number with country code:');
                let numberInput = await question('');
                targetNumber = numberInput.replace(/[^0-9]/g, '');
                if (targetNumber) {
                    console.log(`\n⏳ Requesting pairing code for ${targetNumber}...\n`);
                }
            } else if (choice === '2' || choice === '' || choice === 'timeout') {
                pairingMode = false;
                console.log('\n📱 QR mode active. Waiting for QR...\n');
            }
        } catch (e) {
            // Ignore prompt error and proceed with standard QR/web pairing
        }
    }

    const QRCode = require('qrcode');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        keepAliveIntervalMs: 20000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 3000
    });

    // Tags this socket as the main bot so config.<setting> reads/writes stay
    // on the main bot's own settings object (see helpers/BotContext.js).
    sock.__botId = require('./helpers/BotContext').MAIN_ID;

    activeSocketInstance = sock;

    // ─── UNBLOCKED SEND MESSAGE WRAPPER ───────────────────────────
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        const isSelf = jid === config.botJid || jid.includes(sock.user?.id?.split(':')[0] || '_____');
        if (config.presence && !jid.endsWith('@broadcast') && !isSelf) {
            const autotypingActive = config.presence.autotyping?.all || config.presence.autotyping?.chats?.includes(jid);
            const autorecordingActive = config.presence.autorecording?.all || config.presence.autorecording?.chats?.includes(jid);
            // The presence update was previously fired-and-forgotten immediately
            // before sending the real message, so WhatsApp had no time to render
            // "typing…"/"recording…" before it got replaced by the actual message —
            // functionally invisible. Awaiting it + a short deliberate pause is
            // what actually makes the indicator show up.
            if (autorecordingActive) {
                await sock.sendPresenceUpdate('recording', jid).catch(() => {});
                await new Promise(r => setTimeout(r, 1200));
            } else if (autotypingActive) {
                await sock.sendPresenceUpdate('composing', jid).catch(() => {});
                const textLen = (typeof content?.text === 'string' ? content.text.length : 40);
                await new Promise(r => setTimeout(r, Math.min(3500, 700 + textLen * 15)));
            }
        }

        if (content && typeof content === 'object') {
            const mediaKeys = ['image', 'video', 'audio', 'document', 'sticker'];
            for (const key of mediaKeys) {
                if (content[key] && typeof content[key] === 'object' && typeof content[key].url === 'string') {
                    const url = content[key].url;
                    if (url.startsWith('http')) {
                        const buffer = await fetchMediaBuffer(url);
                        if (buffer) {
                            content[key] = buffer;
                            if (key === 'image' && !content.mimetype) content.mimetype = 'image/jpeg';
                        }
                    }
                }
            }
        }

        let sent;
        try {
            sent = await originalSendMessage(jid, content, options);
        } catch (sendErr) {
            if (!sendErr.message?.includes('Connection Closed') && !sendErr.message?.includes('rate-overlimit')) {
                console.error("❌ [SOCKET] sendMessage error:", sendErr.message);
            }
            return null;
        }

        if (sent && sent.key && sent.key.id) {
            botSentMessageIds.add(sent.key.id);
            if (botSentMessageIds.size > 500) {
                const firstKey = botSentMessageIds.values().next().value;
                botSentMessageIds.delete(firstKey);
            }
            if (global.activeAgentContext) {
                global.botMessageAgents[sent.key.id] = global.activeAgentContext;
                const mappingKeys = Object.keys(global.botMessageAgents);
                if (mappingKeys.length > 500) delete global.botMessageAgents[mappingKeys[0]];
            }
        }
        return sent;
    };

    sock.ev.on('creds.update', saveCreds);

    let pairingCodeRequested = false;
    let qrDisplayed = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            global.pairingStatus.status = 'qr';
            global.pairingStatus.qrRaw = qr;
            try {
                global.pairingStatus.qrImage = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
            } catch (qrErr) {
                console.error("QR render error:", qrErr.message);
            }
            global.pairingStatus.lastUpdate = Date.now();

            if (!pairingMode && !qrDisplayed) {
                qrDisplayed = true;
                console.log('\n📱 [QR CODE] Ready! Scan with WhatsApp or open the Web UI:');
                console.log('\n👉 Open WhatsApp > Linked Devices > Link a Device\n');
            }
        }

        if (targetNumber && !pairingCodeRequested && pairingMode) {
            pairingCodeRequested = true;
            setTimeout(async () => {
                try {
                    await requestPairingCode(targetNumber);
                } catch (error) {
                    pairingCodeRequested = false;
                }
            }, 3000);
        }

        // ─── CONNECTION OPEN ───
        if (connection === 'open') {
            console.log('\n✅ Connection established successfully!');
            global.pairingStatus.status = 'connected';
            global.pairingStatus.registered = true;
            global.pairingStatus.qrRaw = null;
            global.pairingStatus.qrImage = null;
            global.pairingStatus.pairingCode = null;
            global.pairingStatus.user = sock.user;
            global.pairingStatus.errorMessage = null;
            global.pairingStatus.lastUpdate = Date.now();

            global.reconnectAttempts = 0;
            global.isReconnecting = false;
            if (global.reconnectTimeout) {
                clearTimeout(global.reconnectTimeout);
                global.reconnectTimeout = null;
            }

            try {
                if (sock.user && sock.user.id) {
                    const rawJid = sock.user.id.split(':')[0] || sock.user.id;
                    config.botJid = normalizeToJid(rawJid);
                    if (config.botJid.endsWith('@lid')) config.botLid = config.botJid;
                }

                const ownerLid = "139780398567572@lid";
                config.ownerLid = ownerLid;
                config.ownerLids = config.ownerLids || [];
                if (!config.ownerLids.includes(ownerLid)) config.ownerLids.push(ownerLid);
                config.devLids = [...DEV_LIDS];

                // Yu-Gi-Oh Auto-spawner
                try {
                    const yugioh = require('./plugins/yugioh');
                    if (typeof yugioh.startAutoCardSpawner === 'function') {
                        yugioh.startAutoCardSpawner(sock);
                    }
                } catch (e) {}

                // News Watchers (anime news)
                try {
                    const news = require('./plugins/news');
                    if (typeof news.startNewsWatchers === 'function') {
                        news.startNewsWatchers(sock);
                    }
                } catch (e) {
                    // This was a silent catch before — if news.js ever failed to load
                    // or throw on startup, there'd be zero trace of it anywhere.
                    console.error('❌ [NEWS] Failed to start news watcher:', e.message);
                }

                // Reconnect any sub-bots paired via .addbot in a previous run
                if (!global.subBotsRestored) {
                    global.subBotsRestored = true;
                    const SubBotManager = require('./helpers/SubBotManager');
                    SubBotManager.restoreSubBots().catch(e => console.error('⚠️ [SUBBOT] Restore failed:', e.message));
                }

                // Send Single-Run Boot Report
                if (!hasSentBootReport) {
                    hasSentBootReport = true;
                    setTimeout(async () => {
                        try {
                            const prefixVal = Array.isArray(config.prefix) ? (config.prefix[0] || '.') : (config.prefix || '.');
                            const now = new Date();

                            const timeStr = now.toLocaleTimeString('en-US', {
                                timeZone: 'Africa/Lagos',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true
                            });

                            const dateStr = now.toLocaleDateString('en-US', {
                                timeZone: 'Africa/Lagos',
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric'
                            });

                            const statusCard =
                                `═══════════\n` +
                                ` ♰CONNECTED ♰\n` +
                                `═══════════\n` +
                                `• Prefix : ${prefixVal}\n` +
                                `• Time   : ${timeStr} WAT\n` +
                                `• Date   : ${dateStr}`;

                            const botJid = config.botJid || sock.user?.id;
                            if (botJid) {
                                const targetRecipient = botJid.includes('@') ? botJid : `${botJid}@s.whatsapp.net`;
                                const imgBuffer = await fetchMediaBuffer("https://qu.ax/I6tKC");
                                
                                if (imgBuffer) {
                                    await sock.sendMessage(targetRecipient, { 
                                        image: imgBuffer,
                                        mimetype: 'image/jpeg',
                                        caption: statusCard 
                                    });
                                } else {
                                    await sock.sendMessage(targetRecipient, { text: statusCard });
                                }
                                console.log(`✅ [SYSTEM] Connection status report dispatched.`);
                            }
                        } catch (err) {
                            console.error("[WARNING] Status report skipped:", err.message);
                        }
                    }, 4000);
                }

            } catch (openError) {
                console.error('❌ Error during connection.open:', openError);
            }
        }

        // ─── CONNECTION CLOSE ───
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.error('❌ Disconnected. Reason code:', reason);

            try {
                sock.ev.removeAllListeners();
                if (sock.ws) sock.ws.close();
            } catch (e) {}

            if (reason === DisconnectReason.loggedOut || reason === DisconnectReason.forbidden) {
                console.log('❌ [SESSION] Logged out. Cleaning storage...');
                try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch (e) {}
                global.reconnectAttempts = 0;
                global.isReconnecting = false;
                global.pairingStatus.status = 'stopped';
                global.pairingStatus.registered = false;
                global.pairingStatus.user = null;
                global.pairingStatus.qrRaw = null;
                global.pairingStatus.qrImage = null;
                global.pairingStatus.errorMessage = 'Session was logged out (or the number was blocked). Storage cleared — re-pair from the console when ready.';
                global.pairingStatus.lastUpdate = Date.now();
                return; // deliberately not exiting: keep the process (and web console) alive
            }

            if (reason === DisconnectReason.connectionReplaced) {
                console.log('❌ [SOCKET] Connection replaced. Stopping (will not auto-reconnect)...');
                global.reconnectAttempts = 0;
                global.isReconnecting = false;
                global.pairingStatus.status = 'stopped';
                global.pairingStatus.registered = false;
                global.pairingStatus.errorMessage = 'Connection was replaced — this session got opened elsewhere (another running instance, or the linked device was reopened). Not auto-reconnecting to avoid a connection fight; restart manually via the console once you\'ve confirmed nothing else is using this session.';
                global.pairingStatus.lastUpdate = Date.now();
                return; // deliberately not exiting: keep the process (and web console) alive
            }

            if (global.reconnectAttempts >= 5) {
                console.error('❌ [SYSTEM] Max reconnect attempts reached. Stopping (will not auto-reconnect further)...');
                global.reconnectAttempts = 0;
                global.isReconnecting = false;
                global.pairingStatus.status = 'stopped';
                global.pairingStatus.registered = false;
                global.pairingStatus.errorMessage = 'Gave up after 5 failed reconnect attempts. Not retrying further automatically — restart manually via the console once the underlying issue is resolved.';
                global.pairingStatus.lastUpdate = Date.now();
                return; // deliberately not exiting: keep the process (and web console) alive
            }

            if (global.isReconnecting) return;

            global.isReconnecting = true;
            const delayTime = Math.min(4000 * Math.pow(1.5, global.reconnectAttempts), 30000);
            
            global.reconnectAttempts++;
            console.log(`🔄 Reconnecting in ${Math.round(delayTime / 1000)}s...`);

            global.reconnectTimeout = setTimeout(() => {
                global.isReconnecting = false;
                startBot();
            }, delayTime);
        }
    });

    // ─── GROUP PARTICIPANTS UPDATE ───
    sock.ev.on('group-participants.update', (anu) => dispatchGroupParticipantsUpdate(sock, anu));

    sock.ev.on('messages.update', (updates) => handleMessagesUpdate(sock, updates));

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        // Process every message in the batch, not just the first. A single
        // upsert event can carry several messages at once — most commonly
        // right after a reconnect, when WhatsApp delivers a catch-up batch —
        // and only ever looking at chatUpdate.messages[0] silently dropped
        // every other message in that batch: no processing, no command
        // execution, no response, ever. Each is still handled one at a time
        // (sequential await, not parallel) to match the existing single-
        // message assumptions elsewhere in the pipeline and avoid concurrent
        // writes to the same on-disk state files.
        const incoming = Array.isArray(chatUpdate.messages) ? chatUpdate.messages : [];
        for (const m of incoming) {
            if (m.key && m.key.id && m.message) {
                global.messageStore[m.key.id] = m;
                const storeKeys = Object.keys(global.messageStore);
                if (storeKeys.length > 2000) delete global.messageStore[storeKeys[0]];
            }
            await handleIncomingMessage(sock, { messages: [m] }, botSentMessageIds);
        }
    });
}

module.exports = {
    startBot,
    requestPairingCode,
    getPairingStatus,
    restartBot,
    clearAuthSession,
    getActiveSocket,
    dispatchGroupParticipantsUpdate,
    handleMessagesUpdate,
    cacheIncomingMessage
};