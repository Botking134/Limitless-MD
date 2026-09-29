// plugins/sharingan.js
//
// Sharingan! — prefixless trigger that answers with an Uchiha line over a GIF
// plus a button row: AFK · Reset AFK · Kamui · Auto-VV · VV · Save · Put off.
//
// This file is only the command/UI layer. All state and logic (AFK sessions,
// AI replies, view-once decryption, sticker building) lives in
// helpers/SharinganManager.js so it survives this plugin being hot-reloaded.
//
// Owner-only throughout: every handler silently ignores anyone else, so a
// bare "wow" or "Sharingan!" from a member does nothing.
const config = require('../config');
const { setVar } = require('../vars');
const SG = require('../helpers/SharinganManager');

const allowed = (ctx) => !!(ctx && (ctx.isOwner || ctx.isDev));
const reply = (sock, msg, text) => SG.trySend(sock, msg.key.remoteJid, { text }, { quoted: msg });

let baileysPromise = null;
const getBaileys = () => baileysPromise || (baileysPromise = import('@itsliaaa/baileys'));

// ─── THE CARD ────────────────────────────────────────────────────
async function sendCard(sock, msg, targetId) {
    const jid = msg.key.remoteJid;
    const p = config.prefix || '';
    // Kamui / VV / Save need to know WHICH message to act on. A button tap can't
    // carry a reply, so if "Sharingan!" was sent as a reply the target's id is
    // baked into those three button ids.
    const arg = targetId ? ` ${targetId}` : '';

    const buttons = [
        ['🕶️ AFK', `${p}sgafk`],
        ['♻️ Reset AFK', `${p}sgreset`],
        ['🌀 Kamui', `${p}sgkamui${arg}`],
        ['👁️ Auto-VV', `${p}sgautovv`],
        ['🔓 VV', `${p}sgvv${arg}`],
        ['💾 Save', `${p}sgsave${arg}`],
        ['🛑 Put off', `${p}sgoff`]
    ];

    const body = `👁️ *${SG.pick(SG.UCHIHA_LINES)}*\n\n${SG.statusLine(sock)}`;

    try {
        const b = await getBaileys();
        let header = { hasMediaAttachment: false };
        try {
            const media = await b.prepareWAMessageMedia(
                { video: { url: SG.toMp4(SG.GIFS.sharingan) }, gifPlayback: true },
                { upload: sock.waUploadToServer }
            );
            header = { hasMediaAttachment: true, videoMessage: media.videoMessage };
        } catch (e) {
            console.error('⚠️ [SHARINGAN] header gif failed, sending card without it:', e.message);
        }

        const content = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        header,
                        body: { text: body },
                        footer: { text: `${config.botName || 'Sharingan'} • eyes open` },
                        nativeFlowMessage: {
                            buttons: buttons.map(([text, id]) => ({
                                name: 'quick_reply',
                                buttonParamsJson: JSON.stringify({ display_text: text, id })
                            }))
                        }
                    }
                }
            }
        };

        const generated = b.generateWAMessageFromContent(jid, b.proto.Message.fromObject(content), { userJid: sock.user.id });
        SG.markOwnSend(generated.key.id);
        await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
    } catch (err) {
        console.error('⚠️ [SHARINGAN] interactive card failed, using plain fallback:', err.message);
        const list = buttons.map(([t, id]) => `• ${t} → \`${id}\``).join('\n');
        await SG.sendGif(sock, jid, SG.GIFS.sharingan, `${body}\n\n${list}`, { quoted: msg });
    }
}

// ─── KAMUI / VV / SAVE RUNNERS ───────────────────────────────────
const ERR = {
    noReply: '❌ Reply to a view-once message first.',
    noLatest: '❌ No view-once message found in this chat.',
    noSaveTarget: '❌ Reply to a message with *Sharingan!* first, then tap Save.',
    notViewOnce: "❌ That isn't a view-once message.",
    failed: "❌ Couldn't decrypt it — the media may have already expired."
};

function resolve(msg, explicitId, { allowLatest }) {
    let target = SG.resolveTarget(msg, explicitId);
    if (!target && allowLatest) target = SG.latestViewOnce(msg.key.remoteJid);
    return target;
}

async function runViewOnceAction(sock, msg, fn, explicitId, isButton) {
    const target = resolve(msg, explicitId, { allowLatest: isButton });
    if (!target) return reply(sock, msg, isButton ? ERR.noLatest : ERR.noReply);
    try {
        const res = await fn(sock, msg, target);
        if (!res.ok) return reply(sock, msg, res.reason === 'notViewOnce' ? ERR.notViewOnce : ERR.failed);
    } catch (e) {
        console.error('⚠️ [SHARINGAN] action failed:', e.message);
        return reply(sock, msg, ERR.failed);
    }
}

async function runSave(sock, msg, explicitId) {
    const target = SG.resolveTarget(msg, explicitId);
    if (!target) return reply(sock, msg, ERR.noSaveTarget);
    try {
        const res = await SG.save(sock, msg, target);
        if (!res.ok) return reply(sock, msg, "❌ Couldn't save that message.");
        await reply(sock, msg, res.how === 'viewonce' ? '💾 Decrypted and saved to your DM.' : '💾 Saved to your DM.');
    } catch (e) {
        console.error('⚠️ [SHARINGAN] save failed:', e.message);
        return reply(sock, msg, "❌ Couldn't save that message.");
    }
}

// ─── COMMANDS ────────────────────────────────────────────────────
const kamuiRunner = async (sock, msg, args, ctx) => {
    if (!allowed(ctx)) return;
    return runViewOnceAction(sock, msg, SG.kamui, null, false);
};

module.exports = [
    // Prefixless trigger — matched case-insensitively, the "!" is required.
    {
        name: 'sharingan!',
        isPrefixless: true,
        category: 'owner',
        description: 'Awaken the Sharingan: AFK assistant, Kamui, view-once tools',
        permission: 'owner',
        execute: async (sock, msg, args, ctx) => {
            if (!allowed(ctx)) return;
            await sendCard(sock, msg, SG.getQuotedId(msg));
        }
    },

    // Kamui: decrypt a replied-to view-once → your own DM (gif, 3s, media).
    { name: 'kamui', isPrefixless: true, category: 'owner', description: 'Decrypt a replied view-once and send it to your DM', permission: 'owner', execute: kamuiRunner },
    { name: 'wow', isPrefixless: true, category: 'owner', description: 'Alias of kamui', permission: 'owner', execute: kamuiRunner },
    { name: 'whoa', isPrefixless: true, category: 'owner', description: 'Alias of kamui', permission: 'owner', execute: kamuiRunner },

    // ── button handlers (prefixed, owner-only) ──
    {
        name: 'sgafk',
        category: 'owner',
        description: 'Sharingan: arm the AFK assistant',
        permission: 'owner',
        execute: async (sock, msg, args, ctx) => {
            if (!allowed(ctx)) return;
            const r = SG.armAfk(sock);
            const text = r.wasArmed
                ? `🕶️ *AFK is already armed.* ${r.live ? 'It is live right now.' : `It goes live in about ${r.minutesLeft} min of you being quiet.`}`
                : '🕶️ *AFK armed.* I\'ll start answering DMs once you\'ve been quiet for 1 hour — anything you send resets that timer.\n\n♻️ *Reset AFK* goes live immediately • 🛑 *Put off* stops it.';
            await reply(sock, msg, text);
        }
    },
    {
        name: 'sgreset',
        category: 'owner',
        description: 'Sharingan: wipe every DM session and go live immediately',
        permission: 'owner',
        execute: async (sock, msg, args, ctx) => {
            if (!allowed(ctx)) return;
            SG.ignoreActivity(msg.key.id);   // this tap is itself a message from you — don't let it cancel the reset
            const r = SG.resetAfk(sock);
            await reply(sock, msg, `♻️ *AFK reset.* Cleared ${r.cleared} conversation${r.cleared === 1 ? '' : 's'}. I'm live now and will answer every DM until you send a message.`);
        }
    },
    {
        name: 'sgautovv',
        category: 'owner',
        description: 'Sharingan: toggle Auto-VV (auto-forward every view-once to your DM)',
        permission: 'owner',
        execute: async (sock, msg, args, ctx) => {
            if (!allowed(ctx)) return;
            const cur = config.antiviewonce?.mode || 'off';
            const next = cur === 'off' ? 'all' : 'off';
            const value = { ...(config.antiviewonce || {}), mode: next };
            try { setVar('antiviewonce', value); } catch (e) {}
            config.antiviewonce = value;
            await reply(sock, msg, next === 'off'
                ? '👁️ *Auto-VV off.*'
                : '👁️ *Auto-VV on.* Every view-once in groups and DMs is decrypted and sent to your DM.');
        }
    },
    {
        name: 'sgkamui',
        category: 'owner',
        description: 'Sharingan: Kamui button',
        permission: 'owner',
        execute: async (sock, msg, args, ctx) => {
            if (!allowed(ctx)) return;
            return runViewOnceAction(sock, msg, SG.kamui, (args || '').trim() || null, true);
        }
    },
    {
        name: 'sgvv',
        category: 'owner',
        description: 'Sharingan: VV button (reveal a view-once in this chat)',
        permission: 'owner',
        execute: async (sock, msg, args, ctx) => {
            if (!allowed(ctx)) return;
            return runViewOnceAction(sock, msg, SG.vv, (args || '').trim() || null, true);
        }
    },
    {
        name: 'sgsave',
        category: 'owner',
        description: 'Sharingan: Save button',
        permission: 'owner',
        execute: async (sock, msg, args, ctx) => {
            if (!allowed(ctx)) return;
            return runSave(sock, msg, (args || '').trim() || null);
        }
    },
    {
        name: 'sgoff',
        category: 'owner',
        description: 'Sharingan: put it off (AFK assistant and Auto-VV)',
        permission: 'owner',
        execute: async (sock, msg, args, ctx) => {
            if (!allowed(ctx)) return;
            const r = SG.putOff(sock);

            const avvWasOn = (config.antiviewonce?.mode || 'off') !== 'off';
            if (avvWasOn) {
                const value = { ...(config.antiviewonce || {}), mode: 'off' };
                try { setVar('antiviewonce', value); } catch (e) {}
                config.antiviewonce = value;
            }

            const lines = [
                '🛑 *Sharingan deactivated.*',
                `• AFK: ${r.wasOn ? `off (cleared ${r.cleared} conversation${r.cleared === 1 ? '' : 's'})` : 'was already off'}`,
                `• Auto-VV: ${avvWasOn ? 'off' : 'was already off'}`
            ];
            await SG.sendGif(sock, msg.key.remoteJid, SG.GIFS.putOff, lines.join('\n'), { quoted: msg });
        }
    }
];
