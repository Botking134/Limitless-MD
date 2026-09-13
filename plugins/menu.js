// plugins/menu.js
const config = require('../config');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { saveState, normalizeToJid } = require('../stateManager');
const commandDescriptions = require('../helpers/commandDescriptions');
// NOTE: '../commands' is required lazily inside sendHelpList (below), not
// here — commands.js requires every plugin file including this one at
// startup, so a top-level require here would be circular and would hand
// back an incomplete, still-being-built exports object.

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

const menuAudios = [
    "https://files.catbox.moe/pj7qrm.mp3",
    "https://files.catbox.moe/4adjoq.mp3",
    "https://files.catbox.moe/qpwydd.mp3",
    "https://files.catbox.moe/8x6exq.mp3",
    "https://files.catbox.moe/jkxbzh.mp3",
    "https://files.catbox.moe/h75gjf.mp3",
    "https://files.catbox.moe/5nku92.mp3"
];

const menuImages = [
    "https://i.ibb.co/0ps1KT1H/6e475f07c727d798133f2621907cb1aa.jpg",
    "https://i.ibb.co/qLkzRkxq/60e09c407416e9a16153a3a81b476961.jpg",
    "https://i.ibb.co/mdkVnM8/171c68f18891916b8a28d83e79aed1a1.jpg",
    "https://i.ibb.co/jc174Zs/182099dfc7d9da33b491c6777f96472d.jpg",
    "https://i.ibb.co/8nRKVQL4/b7ace5729aed4a88db69b41815f2d12f.jpg",
    "https://i.ibb.co/XfPZx9KJ/9acd61def949393ae0dae459d12a59ed.jpg",
    "https://i.ibb.co/r2D1Wssd/a6c8dac58cbdb4b3e3df8f9d3b6aaeaa.jpg",
    "https://i.ibb.co/Ld6tRtqV/9ef4cbcbaa407583aaefd5e54f6742f6.jpg",
    "https://i.ibb.co/JjbcsLnZ/3d9e7cf8c22e178895518cffc13035ac.jpg",
    "https://i.ibb.co/zWLKzy6N/c7d785c9bf81d4bb8a75547b75f7cd62.jpg"
];

async function fetchImageBuffer(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return Buffer.from(response.data);
    } catch (e) {
        return null;
    }
}

async function createCard(sock, title, description, imageUrl, commandId, buttonText) {
    const { prepareWAMessageMedia } = await import('@itsliaaa/baileys');

    const buffer = await fetchImageBuffer(imageUrl);
    if (!buffer) {
        return {
            header: { hasMediaAttachment: false },
            body: { text: title },
            footer: { text: description },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: "quick_reply",
                        buttonParamsJson: JSON.stringify({ display_text: buttonText, id: commandId })
                    }
                ]
            }
        };
    }

    const media = await prepareWAMessageMedia({ image: buffer }, { upload: sock.waUploadToServer });

    return {
        header: { imageMessage: media.imageMessage, hasMediaAttachment: true },
        body: { text: title },
        footer: { text: description },
        nativeFlowMessage: {
            buttons: [
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({ display_text: buttonText, id: commandId })
                }
            ]
        }
    };
}

const menuText =
`_❖ ── [ AI & CHATBOT ] ── ❖_
_┃ ⊱ ai_
_┃ ⊱ groq_
_┃ ⊱ gojo_
_┃ ⊱ debug_
_┃ ⊱ summon_
_┃ ⊱ read_
_┃ ⊱ imagine_
_┃ ⊱ lizzy_
_┃ ⊱ aizen_
_┃ ⊱ say_

_❖ ── [ GAMES ] ── ❖_
_┃ ⊱ games_
_┃ ⊱ ttt_
_┃ ⊱ rps_
_┃ ⊱ guess_
_┃ ⊱ vault8_
_┃ ⊱ quiz_
_┃ ⊱ charade_
_┃ ⊱ anagram_
_┃ ⊱ wcg_
_┃ ⊱ millionaire_
_┃ ⊱ torf_
_┃ ⊱ pvp_
_┃ ⊱ escape_

_❖ ── [ GROUP MGT ] ── ❖_
_┃ ⊱ mute_
_┃ ⊱ unmute_
_┃ ⊱ kick_
_┃ ⊱ promote_
_┃ ⊱ demote_
_┃ ⊱ tagall_
_┃ ⊱ tag_
_┃ ⊱ link_
_┃ ⊱ antilink_
_┃ ⊱ admins_
_┃ ⊱ antitag_
_┃ ⊱ antibot_
_┃ ⊱ warn_
_┃ ⊱ welcome_
_┃ ⊱ goodbye_
_┃ ⊱ poll_
_┃ ⊱ antigm_
_┃ ⊱ gclog_
_┃ ⊱ antispam_
_┃ ⊱ silence_
_┃ ⊱ gcalerts_
_┃ ⊱ antipromote_
_┃ ⊱ antidemote_
_┃ ⊱ overkill_
_┃ ⊱ antijoin_
_┃ ⊱ gfilter_

_❖ ── [ TOOLS ] ── ❖_
_┃ ⊱ search_ (AI Command Finder)
_┃ ⊱ track_
_┃ ⊱ getpp_
_┃ ⊱ setname_
_┃ ⊱ save_
_┃ ⊱ tostatus_
_┃ ⊱ fw_
_┃ ⊱ presence_
_┃ ⊱ autotyping_
_┃ ⊱ autorecording_
_┃ ⊱ alwaysonline_
_┃ ⊱ autoread_
_┃ ⊱ antidelete_
_┃ ⊱ antiviewonce_
_┃ ⊱ antibug_
_┃ ⊱ clear_
_┃ ⊱ autoviewstatus_
_┃ ⊱ statusemoji_
_┃ ⊱ autoreactstatus_
_┃ ⊱ block_
_┃ ⊱ unblock_
_┃ ⊱ aza_
_┃ ⊱ time_
_┃ ⊱ weather_
_┃ ⊱ device_
_┃ ⊱ ss_
_┃ ⊱ calc_
_┃ ⊱ trt_
_┃ ⊱ spam_
_┃ ⊱ pfilter_
_┃ ⊱ filters_
_┃ ⊱ delfilter_

_❖ ── [ DOWNLOADER ] ── ❖_
_┃ ⊱ play_
_┃ ⊱ yt_
_┃ ⊱ img_
_┃ ⊱ song_
_┃ ⊱ fb_
_┃ ⊱ tt_
_┃ ⊱ mediafire_
_┃ ⊱ apk_
_┃ ⊱ shazam_
_┃ ⊱ lyrics_
_┃ ⊱ gdrive_
_┃ ⊱ gitclone_
_┃ ⊱ pinterest_
_┃ ⊱ spotify_
_┃ ⊱ web_
_┃ ⊱ tgs_
_┃ ⊱ ig_

_❖ ── [ FUN ] ── ❖_
_┃ ⊱ bankai_
_┃ ⊱ dom-exp_
_┃ ⊱ wyr_
_┃ ⊱ joke_
_┃ ⊱ insult_
_┃ ⊱ roast_
_┃ ⊱ ship_
_┃ ⊱ wed_
_┃ ⊱ propose_
_┃ ⊱ askout_
_┃ ⊱ hollow-purple_
_┃ ⊱ hack_
_┃ ⊱ arrest_
_┃ ⊱ liedetector_
_┃ ⊱ rizz_
_┃ ⊱ speech_
_┃ ⊱ slap_
_┃ ⊱ kill_
_┃ ⊱ kiss_
_┃ ⊱ hug_
_┃ ⊱ dance_
_┃ ⊱ aura_
_┃ ⊱ lol_

_❖ ── [ OWNER ] ── ❖_
_┃ ⊱ prefix_ (Prefix Reminder)
_┃ ⊱ diagnose_
_┃ ⊱ update_
_┃ ⊱ mode_
_┃ ⊱ setsudo_
_┃ ⊱ delsudo_
_┃ ⊱ addowner_
_┃ ⊱ delowner_
_┃ ⊱ restart_
_┃ ⊱ shutdown_
_┃ ⊱ ban_
_┃ ⊱ unban_
_┃ ⊱ afk_
_┃ ⊱ setvar_
_┃ ⊱ settings_
_┃ ⊱ antipm_
_┃ ⊱ reminder_

_❖ ── [ UTILITIES ] ── ❖_
_┃ ⊱ ping_
_┃ ⊱ alive_
_┃ ⊱ delete_
_┃ ⊱ tdelete_
_┃ ⊱ autoreact_
_┃ ⊱ speed_
_┃ ⊱ sticker_
_┃ ⊱ crop_
_┃ ⊱ take_
_┃ ⊱ smeme_
_┃ ⊱ packname_
_┃ ⊱ fixpack_
_┃ ⊱ unpack_
_┃ ⊱ tourl_
_┃ ⊱ kamui_
_┃ ⊱ addnote_
_┃ ⊱ delnote_
_┃ ⊱ getnotes_
_┃ ⊱ toimg_
_┃ ⊱ tomp3_
_┃ ⊱ tomp4_
_┃ ⊱ binary_
_┃ ⊱ ocr_
_┃ ⊱ qr_
_┃ ⊱ readqr_
_┃ ⊱ qty_
_┃ ⊱ currency_
`;

async function renderMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());
    const prefixVal = Array.isArray(config.prefix) ? (config.prefix[0] || '.') : (config.prefix || '.');
    const pushName = msg.pushName || 'User';

    const fullMenu =
`┌──────────────┐
│  *${config.botName || 'Limitless-MD'}*
└──────────────┘
_👑 Owner: ${config.ownerName || 'Unknown'}_
_👤 User: ${pushName}_
_⏱️ Uptime: ${uptime}_
_🔑 Prefix: [ ${prefixVal} ]_
════════════════════════
> Throughout Heaven And Earth
┌───────────────────┐
│ *I alone am the Honoured one* 
└───────────────────┘

${menuText}`;

    const randomImage = menuImages[Math.floor(Math.random() * menuImages.length)];
    const imageBuffer = await fetchImageBuffer(randomImage);

    if (imageBuffer) {
        await sock.sendMessage(jid, {
            image: imageBuffer,
            mimetype: 'image/jpeg',
            caption: fullMenu
        }, { quoted: msg });
    } else {
        await sock.sendMessage(jid, { text: fullMenu }, { quoted: msg });
    }
}

// Shared list of categories so the picker and nothing else has to repeat it
const menuCategories = [
    { name: "AI & CHATBOT 🧠", desc: "Interactive AI assistants & custom engines.", cmd: "menu_ai" },
    { name: "INTERACTIVE GAMES 🎮", desc: "Lobbies, turn-based puzzles, quizzes, and duels.", cmd: "menu_games" },
    { name: "GROUP MANAGEMENT 🔥", desc: "Group configurations & administrative controls.", cmd: "menu_group" },
    { name: "TOOLS ⚙️", desc: "Advanced Presence parameters & tracking tools.", cmd: "menu_tools" },
    { name: "DOWNLOADER 📥", desc: "High-speed multi-platform downloaders.", cmd: "menu_download" },
    { name: "FUN & ROLEPLAY 🎭", desc: "Monologues, animations, and interactive cards.", cmd: "menu_fun" },
    { name: "OWNER & DEV 👑", desc: "Private developer config & panel variables panel.", cmd: "menu_owner" },
    { name: "UTILITIES 🛠️", desc: "Converter tools & network latencies.", cmd: "menu_utilities" }
];

// Sends `text` plus exactly one "⬅️ Back to Menu" button that returns to the
// category picker. Used by every submenu (menu_ai, menu_games, etc.) so
// browsing categories never takes more than one tap to reverse.
async function sendWithBackButton(sock, msg, text) {
    const jid = msg.key.remoteJid;
    try {
        const { generateWAMessageFromContent, proto } = await import('@itsliaaa/baileys');
        const rawBotJid = sock.user?.id || sock.user?.jid || jid;
        const cleanBotUserJid = rawBotJid.split('@')[0].split(':')[0] + '@s.whatsapp.net';

        const messageContent = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    interactiveMessage: {
                        body: { text },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "quick_reply",
                                    buttonParamsJson: JSON.stringify({ display_text: "⬅️ Back to Menu", id: "menu_main" })
                                }
                            ]
                        }
                    }
                }
            }
        };

        const msgProto = generateWAMessageFromContent(jid, proto.Message.fromObject(messageContent), { userJid: cleanBotUserJid });
        await sock.relayMessage(jid, msgProto.message, { messageId: msgProto.key.id });
    } catch (e) {
        // If the button fails to attach for some reason, still get the
        // actual menu text out rather than losing it.
        console.error('❌ [MENU] Back-button send failed, falling back to plain text:', e.message);
        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
}

// The default, everyday menu: one message, one button that opens a native
// list of all 8 categories. This replaced an earlier version that sent each
// category as its own message — 8 rapid-fire messages in a row is exactly
// the pattern that gets automated accounts flagged as spam, even though each
// individual message was harmless. A single list message with several rows
// is the standard, expected way to offer many options in WhatsApp bots.
async function renderCategoryPicker(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());

    const headerText =
`┌─────────────┐
│ *Limitless-MD*
└─────────────┘
_Owner: ${config.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
════════════════════════
> Throughout Heaven And Earth_
┌───────────────────┐
│ *I alone am the Honoured one* 
└───────────────────┘

_Tap below to browse command categories._ 🔮`;

    let loadingMsg = null;

    try {
        const { generateWAMessageFromContent, proto } = await import('@itsliaaa/baileys');

        loadingMsg = await sock.sendMessage(jid, { text: "▱▱▱▱▱▱▱▱▱▱ Expanding Domain..." }, { quoted: msg });

        const frames = [
            { text: "▰▱▱▱▱▱▱▱▱▱ Channelling Cursed Energy...", delay: 400 },
            { text: "▰▰▰▱▱▱▱▱▱▱ Six Eyes Activating...", delay: 400 },
            { text: "▰▰▰▰▰▱▱▱▱▱ Infinite Void Opening...", delay: 400 },
            { text: "▰▰▰▰▰▰▰▰▰▰ Domain Expansion: Complete! 🌌", delay: 500 }
        ];

        for (const frame of frames) {
            await delay(frame.delay);
            try { await sock.sendMessage(jid, { text: frame.text, edit: loadingMsg.key }); } catch (editErr) {}
        }

        const rawBotJid = sock.user?.id || sock.user?.jid || jid;
        const cleanBotUserJid = rawBotJid.split('@')[0].split(':')[0] + '@s.whatsapp.net';

        // Single header image up top — list rows themselves can't carry
        // per-row images (that's a carousel-only capability, and bundling
        // cards into a carousel is the unreliable part we're avoiding), but
        // one banner image on the message as a whole is well-supported.
        const { prepareWAMessageMedia } = await import('@itsliaaa/baileys');
        const randomImage = menuImages[Math.floor(Math.random() * menuImages.length)];
        const imageBuffer = await fetchImageBuffer(randomImage);
        let header = { hasMediaAttachment: false };
        if (imageBuffer) {
            try {
                const media = await prepareWAMessageMedia({ image: imageBuffer }, { upload: sock.waUploadToServer });
                header = { imageMessage: media.imageMessage, hasMediaAttachment: true };
            } catch (imgErr) {
                console.error('❌ [CATEGORY PICKER] Header image failed, sending without it:', imgErr.message);
            }
        }

        const messageContent = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    interactiveMessage: {
                        header,
                        body: { text: headerText },
                        footer: { text: "Limitless System Menu 🪽" },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "single_select",
                                    buttonParamsJson: JSON.stringify({
                                        title: "📂 View Categories",
                                        sections: [
                                            {
                                                title: "Command Categories",
                                                rows: menuCategories.map(cat => ({
                                                    title: cat.name,
                                                    description: cat.desc,
                                                    id: cat.cmd
                                                }))
                                            }
                                        ]
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };

        const msgProto = generateWAMessageFromContent(jid, proto.Message.fromObject(messageContent), { userJid: cleanBotUserJid });
        await sock.relayMessage(jid, msgProto.message, { messageId: msgProto.key.id });

        if (loadingMsg) {
            try { await sock.sendMessage(jid, { delete: loadingMsg.key }); } catch (e) {}
        }

    } catch (error) {
        console.error("❌ [CATEGORY PICKER ERROR]:", error.message);
        if (loadingMsg) {
            try { await sock.sendMessage(jid, { delete: loadingMsg.key }); } catch (e) {}
        }
        await renderMenu(sock, msg);
    }
}

// The original per-category version — one image+button message per
// category, sent in sequence. Kept available on request, even though it's
// the version most likely to look spammy since it's 8 rapid messages in a
// row. There's no way to fully eliminate that risk while still sending 8
// separate messages — spacing them out (already does 500ms between each)
// helps a little, but the real fix for the spam concern is the picker
// below, not this one. Use sparingly / in your own chats rather than in
// large groups if you're worried about it.
async function renderSequentialCardMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());

    const headerText =
`┌─────────────┐
│ *Limitless-MD*
└─────────────┘
_Owner: ${config.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
════════════════════════
> Throughout Heaven And Earth_
┌───────────────────┐
│ *I alone am the Honoured one* 
└───────────────────┘

_Swipe through the cards below to explore command categories._ 🔮`;

    let loadingMsg = null;

    try {
        const { generateWAMessageFromContent, proto } = await import('@itsliaaa/baileys');

        loadingMsg = await sock.sendMessage(jid, { text: "▱▱▱▱▱▱▱▱▱▱ Expanding Domain..." }, { quoted: msg });

        const frames = [
            { text: "▰▱▱▱▱▱▱▱▱▱ Channelling Cursed Energy...", delay: 400 },
            { text: "▰▰▰▱▱▱▱▱▱▱ Six Eyes Activating...", delay: 400 },
            { text: "▰▰▰▰▰▱▱▱▱▱ Infinite Void Opening...", delay: 400 },
            { text: "▰▰▰▰▰▰▰▰▰▰ Domain Expansion: Complete! 🌌", delay: 500 }
        ];

        for (const frame of frames) {
            await delay(frame.delay);
            try { await sock.sendMessage(jid, { text: frame.text, edit: loadingMsg.key }); } catch (editErr) {}
        }

        try { await sock.sendMessage(jid, { delete: loadingMsg.key }); } catch (e) {}
        await sock.sendMessage(jid, { text: headerText }, { quoted: msg });

        const shuffledImages = [...menuImages].sort(() => 0.5 - Math.random());

        const rawBotJid = sock.user?.id || sock.user?.jid || jid;
        const cleanBotUserJid = rawBotJid.split('@')[0].split(':')[0] + '@s.whatsapp.net';

        for (let i = 0; i < menuCategories.length; i++) {
            const cat = menuCategories[i];
            const card = await createCard(
                sock, cat.name, cat.desc, shuffledImages[i % shuffledImages.length], cat.cmd, "Explore Commands 🔮"
            );

            const messageContent = {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                        interactiveMessage: {
                            header: card.header,
                            body: card.body,
                            footer: card.footer,
                            nativeFlowMessage: card.nativeFlowMessage
                        }
                    }
                }
            };

            try {
                const msgProto = generateWAMessageFromContent(jid, proto.Message.fromObject(messageContent), { userJid: cleanBotUserJid });
                await sock.relayMessage(jid, msgProto.message, { messageId: msgProto.key.id });
            } catch (cardErr) {
                console.error(`❌ [SEQ MENU] Card failed for ${cat.name}:`, cardErr.message);
                const buffer = await fetchImageBuffer(shuffledImages[i % shuffledImages.length]);
                if (buffer) {
                    await sock.sendMessage(jid, { image: buffer, caption: `*${cat.name}*\n${cat.desc}` });
                } else {
                    await sock.sendMessage(jid, { text: `*${cat.name}*\n${cat.desc}` });
                }
            }

            await delay(500);
        }

    } catch (error) {
        console.error("❌ [SEQUENTIAL CARD MENU ERROR]:", error.message);
        if (loadingMsg) {
            try { await sock.sendMessage(jid, { delete: loadingMsg.key }); } catch (e) {}
        }
        await renderMenu(sock, msg);
    }
}

async function renderCarouselMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());

    const headerText =
`┌─────────────┐
│ *Limitless-MD*
└─────────────┘
_Owner: ${config.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
════════════════════════
> Throughout Heaven And Earth_
┌───────────────────┐
│ *I alone am the Honoured one* 
└───────────────────┘

_Swipe through the cards below to explore command categories._ 🔮`;

    let loadingMsg = null;

    try {
        const { generateWAMessageFromContent, proto } = await import('@itsliaaa/baileys');

        loadingMsg = await sock.sendMessage(jid, { text: "▱▱▱▱▱▱▱▱▱▱ Expanding Domain..." }, { quoted: msg });

        const frames = [
            { text: "▰▱▱▱▱▱▱▱▱▱ Channelling Cursed Energy...", delay: 400 },
            { text: "▰▰▰▱▱▱▱▱▱▱ Six Eyes Activating...", delay: 400 },
            { text: "▰▰▰▰▰▱▱▱▱▱ Infinite Void Opening...", delay: 400 },
            { text: "▰▰▰▰▰▰▰▰▰▰ Domain Expansion: Complete! 🌌", delay: 500 }
        ];

        for (const frame of frames) {
            await delay(frame.delay);
            try { await sock.sendMessage(jid, { text: frame.text, edit: loadingMsg.key }); } catch (editErr) {}
        }

        const shuffledImages = [...menuImages].sort(() => 0.5 - Math.random());

        const categories = [
            { name: "AI & CHATBOT 🧠", desc: "Interactive AI assistants & custom engines.", cmd: "menu_ai" },
            { name: "INTERACTIVE GAMES 🎮", desc: "Lobbies, turn-based puzzles, quizzes, and duels.", cmd: "menu_games" },
            { name: "GROUP MANAGEMENT 🔥", desc: "Group configurations & administrative controls.", cmd: "menu_group" },
            { name: "TOOLS ⚙️", desc: "Advanced Presence parameters & tracking tools.", cmd: "menu_tools" },
            { name: "DOWNLOADER 📥", desc: "High-speed multi-platform downloaders.", cmd: "menu_download" },
            { name: "FUN & ROLEPLAY 🎭", desc: "Monologues, animations, and interactive cards.", cmd: "menu_fun" },
            { name: "OWNER & DEV 👑", desc: "Private developer config & panel variables panel.", cmd: "menu_owner" },
            { name: "UTILITIES 🛠️", desc: "Converter tools & network latencies.", cmd: "menu_utilities" }
        ];

        const cards = [];
        for (let i = 0; i < categories.length; i++) {
            const cat = categories[i];
            const card = await createCard(
                sock, cat.name, cat.desc, shuffledImages[i % shuffledImages.length], cat.cmd, "Explore Commands 🔮"
            );
            cards.push(card);
        }

        // Sanitize bot user JID (strips device ID suffix :12@s.whatsapp.net)
        const rawBotJid = sock.user?.id || sock.user?.jid || jid;
        const cleanBotUserJid = rawBotJid.split('@')[0].split(':')[0] + '@s.whatsapp.net';

        const messageContent = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage: {
                        body: { text: headerText },
                        footer: { text: "Limitless System Menu 🪽" },
                        carouselMessage: { cards: cards }
                    }
                }
            }
        };

        const msgProto = generateWAMessageFromContent(jid, proto.Message.fromObject(messageContent), { userJid: cleanBotUserJid });
        await sock.relayMessage(jid, msgProto.message, { messageId: msgProto.key.id });

        // Clean up animation message ONLY after successful delivery
        if (loadingMsg) {
            try { await sock.sendMessage(jid, { delete: loadingMsg.key }); } catch (e) {}
        }

    } catch (error) {
        console.error("❌ [CAROUSEL MENU ERROR]:", error.message);
        if (loadingMsg) {
            try { await sock.sendMessage(jid, { delete: loadingMsg.key }); } catch (e) {}
        }
        await renderMenu(sock, msg);
    }
}

// ─── EXPORT COMMANDS ──────────────────────────────────────────────

// Full alphabetical command list with descriptions. Requires '../commands'
// lazily (see note near the top of this file) so the live, currently
// registered set of commands is what gets listed — new commands show up
// automatically without this needing to be hand-updated.
async function sendHelpList(sock, msg) {
    const jid = msg.key.remoteJid;
    const commands = require('../commands');

    const names = Object.keys(commands)
        .filter(k => k !== 'reload')
        .sort((a, b) => a.localeCompare(b));

    const prefixVal = Array.isArray(config.prefix) ? (config.prefix[0] || '.') : (config.prefix || '.');

    const lines = names.map(name => {
        const entry = commands[name];
        const desc = commandDescriptions[name] || 'No description available yet.';
        const showPrefix = entry?.isPrefixless ? '' : prefixVal;
        return `▸ *${showPrefix}${name}* — ${desc}`;
    });

    const header = `📖 *ALL COMMANDS (${names.length})* — alphabetical\n_Prefix: [ ${prefixVal} ] — prefixless commands are shown without one_\n`;

    // Chunk so this never becomes one unreadable wall of text, and so it
    // stays well under any single-message size concerns regardless of how
    // many commands get added later.
    const CHUNK_SIZE = 4000;
    let chunks = [];
    let current = header;
    for (const line of lines) {
        if (current.length + line.length + 1 > CHUNK_SIZE) {
            chunks.push(current);
            current = '';
        }
        current += line + '\n';
    }
    if (current.trim().length) chunks.push(current);

    for (let i = 0; i < chunks.length; i++) {
        const suffix = chunks.length > 1 ? `\n_(${i + 1}/${chunks.length})_` : '';
        await sock.sendMessage(jid, { text: chunks[i] + suffix }, i === 0 ? { quoted: msg } : {});
        if (i < chunks.length - 1) await delay(400);
    }
}

module.exports = [
    {
        name: 'menu',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderMenu(sock, msg);
            const randomAudio = menuAudios[Math.floor(Math.random() * menuAudios.length)];
            await sock.sendMessage(msg.key.remoteJid, { audio: { url: randomAudio }, mimetype: "audio/mpeg", ptt: false });
        }
    },
    {
        name: 'list',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderMenu(sock, msg);
            const randomAudio = menuAudios[Math.floor(Math.random() * menuAudios.length)];
            await sock.sendMessage(msg.key.remoteJid, { audio: { url: randomAudio }, mimetype: "audio/mpeg", ptt: false });
        }
    },
    {
        name: 'menu2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderCategoryPicker(sock, msg);
        }
    },
    {
        name: 'list2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderCategoryPicker(sock, msg);
        }
    },
    {
        name: 'menu3',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderSequentialCardMenu(sock, msg);
        }
    },
    {
        name: 'list3',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderSequentialCardMenu(sock, msg);
        }
    },
    {
        name: 'menu_main',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            await renderCategoryPicker(sock, msg);
        }
    },

    // ─── SEARCH COMMAND (Gemini 3.5 Flash Command Search Engine) ───
    {
        name: 'search',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const query = args ? args.trim() : '';

            if (!query) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Format:* \`${config.prefix}search <what_you_want_to_do>\`\n\n*Examples:*\n• \`${config.prefix}search command for network speed\`\n• \`${config.prefix}search how to download songs\`\n• \`${config.prefix}search lock group chat\`` 
                }, { quoted: msg });
            }

            if (!config.geminiApiKey) {
                return await sock.sendMessage(jid, { text: "❌ Gemini API key is missing in your configuration." }, { quoted: msg });
            }

            const statusMsg = await sock.sendMessage(jid, { text: "Analyzing command archives via Gemini 3.5 Flash... 🔍" }, { quoted: msg });

            try {
                const { GoogleGenAI } = await import('@google/genai');
                const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

                const prompt = 
                    `You are an expert command search engine for the Limitless-MD WhatsApp Bot system.\n` +
                    `Below is the complete master catalog of all commands and categories supported by the bot:\n\n${menuText}\n\n` +
                    `User Query: "${query}"\n\n` +
                    `Task:\n` +
                    `1. Analyze the user's intent and calculate the most accurate matching command(s).\n` +
                    `2. Output a clean, beautiful, and organized card in this exact structure (no conversational intro/outro filler):\n\n` +
                    `🔍 *COMMAND SEARCH RESULT* 🔍\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📌 *Primary Match:* \`.<command_name>\`\n` +
                    `💡 *Function:* [Concise description of what it does]\n` +
                    `👉 *Usage Example:* \`.<command_name> [args]\`\n\n` +
                    `_(Include 1 or 2 alternative relevant commands if applicable)_`;

                const response = await ai.models.generateContent({
                    model: "gemini-3.5-flash",
                    contents: prompt
                });

                const replyText = response.text || response.output || "❌ No matching command found in the system archives.";

                await sock.sendMessage(jid, { text: replyText.trim(), edit: statusMsg.key });

            } catch (err) {
                console.error("❌ [SEARCH COMMAND FAILED]:", err.message);
                await sock.sendMessage(jid, { text: `❌ Search failed: ${err.message}`, edit: statusMsg.key });
            }
        }
    },

    // ─── PREFIX COMMAND (Prefixless Prefix Reminder for Authorized Users) ───
    {
        name: 'prefix',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const isAuthorized = isOwner || isSudo || isDev;
            if (!isAuthorized) return;

            const rawMsg = getRawMessage(msg.message);
            const text = (rawMsg?.conversation || rawMsg?.extendedTextMessage?.text || '').trim().toLowerCase();

            if (!text.startsWith('prefix')) return;

            const activePrefix = Array.isArray(config.prefix) ? (config.prefix[0] || '.') : (config.prefix || '.');

            const responseText =
`{ ${activePrefix} }
Stop being careless dude
Here's your prefix though`;

            await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
        }
    },

    // ─── SUB-MENU BUTTON COMMANDS ──────────────────────────────────
    {
        name: 'menu_ai',
        isPrefixless: true,
        execute: async (sock, msg) => {
            const text = `┌──────────────┐\n│ 🧠 AI & CHATBOT  \n└──────────────┘\n\n_┃ ⊱ .ai_\n_┃ ⊱ .groq_\n_┃ ⊱ .gojo_\n_┃ ⊱ .debug_\n_┃ ⊱ .summon_\n_┃ ⊱ .read_\n_┃ ⊱ .imagine_\n_┃ ⊱ .lizzy_\n_┃ ⊱ .aizen_\n_┃ ⊱ .say_`;
            await sendWithBackButton(sock, msg, text);
        }
    },
    {
        name: 'menu_games',
        isPrefixless: true,
        execute: async (sock, msg) => {
            const text = `┌────────┐\n│ 🎮 GAMES  \n└────────┘\n\n_┃ ⊱ .games_\n_┃ ⊱ .ttt_\n_┃ ⊱ .rps_\n_┃ ⊱ .guess_\n_┃ ⊱ .vault8_\n_┃ ⊱ .quiz_\n_┃ ⊱ .charade_\n_┃ ⊱ .anagram_\n_┃ ⊱ .wcg_\n_┃ ⊱ .millionaire_\n_┃ ⊱ .torf_\n_┃ ⊱ .pvp_\n_┃ ⊱ .escape_`;
            await sendWithBackButton(sock, msg, text);
        }
    },
    {
        name: 'menu_group',
        isPrefixless: true,
        execute: async (sock, msg) => {
            const text = `┌─────────┐\n│ 🔥 GROUP  \n└─────────┘\n\n_┃ ⊱ .mute_\n_┃ ⊱ .unmute_\n_┃ ⊱ .kick_\n_┃ ⊱ .promote_\n_┃ ⊱ .demote_\n_┃ ⊱ .tagall_\n_┃ ⊱ .tag_\n_┃ ⊱ .link_\n_┃ ⊱ .antilink_\n_┃ ⊱ .admins_\n_┃ ⊱ .antitag_\n_┃ ⊱ .antibot_\n_┃ ⊱ .warn_\n_┃ ⊱ .welcome_\n_┃ ⊱ .goodbye_\n_┃ ⊱ .poll_\n_┃ ⊱ .antigm_\n_┃ ⊱ .gclog_\n_┃ ⊱ .antispam_\n_┃ ⊱ .silence_\n_┃ ⊱ .gcalerts_\n_┃ ⊱ .antipromote_\n_┃ ⊱ .antidemote_\n_┃ ⊱ .overkill_\n_┃ ⊱ .antijoin_\n_┃ ⊱ .gfilter_`;
            await sendWithBackButton(sock, msg, text);
        }
    },
    {
        name: 'menu_tools',
        isPrefixless: true,
        execute: async (sock, msg) => {
            const text = `┌────────┐\n│ ⚙️ TOOLS  \n└────────┘\n\n_┃ ⊱ .search_\n_┃ ⊱ .track_\n_┃ ⊱ .getpp_\n_┃ ⊱ .setname_\n_┃ ⊱ .save_\n_┃ ⊱ .tostatus_\n_┃ ⊱ .fw_\n_┃ ⊱ .presence_\n_┃ ⊱ .autotyping_\n_┃ ⊱ .autorecording_\n_┃ ⊱ .alwaysonline_\n_┃ ⊱ .autoread_\n_┃ ⊱ .antidelete_\n_┃ ⊱ .antiviewonce_\n_┃ ⊱ .antibug_\n_┃ ⊱ .clear_\n_┃ ⊱ .autoviewstatus_\n_┃ ⊱ .statusemoji_\n_┃ ⊱ .autoreactstatus_\n_┃ ⊱ .block_\n_┃ ⊱ .unblock_\n_┃ ⊱ .aza_\n_┃ ⊱ .time_\n_┃ ⊱ .weather_\n_┃ ⊱ .device_\n_┃ ⊱ .ss_\n_┃ ⊱ .calc_\n_┃ ⊱ .trt_\n_┃ ⊱ .spam_\n_┃ ⊱ .pfilter_\n_┃ ⊱ .filters_\n_┃ ⊱ .delfilter_`;
            await sendWithBackButton(sock, msg, text);
        }
    },
    {
        name: 'menu_download',
        isPrefixless: true,
        execute: async (sock, msg) => {
            const text = `┌───────────┐\n│ 📥  DOWNLOAD  \n└───────────┘\n\n_┃ ⊱ .play_\n_┃ ⊱ .yt_\n_┃ ⊱ .img_\n_┃ ⊱ .song_\n_┃ ⊱ .fb_\n_┃ ⊱ .tt_\n_┃ ⊱ .mediafire_\n_┃ ⊱ .apk_\n_┃ ⊱ .shazam_\n_┃ ⊱ .lyrics_\n_┃ ⊱ .gdrive_\n_┃ ⊱ .gitclone_\n_┃ ⊱ .pinterest_\n_┃ ⊱ .spotify_\n_┃ ⊱ .web_\n_┃ ⊱ .tgs_\n_┃ ⊱ .ig_`;
            await sendWithBackButton(sock, msg, text);
        }
    },
    {
        name: 'menu_fun',
        isPrefixless: true,
        execute: async (sock, msg) => {
            const text = `┌──────────┐\n│ 🎭 FUN & RP  \n└──────────┘\n\n_┃ ⊱ .bankai_\n_┃ ⊱ .dom-exp_\n_┃ ⊱ .wyr_\n_┃ ⊱ .joke_\n_┃ ⊱ .insult_\n_┃ ⊱ .roast_\n_┃ ⊱ .ship_\n_┃ ⊱ .wed_\n_┃ ⊱ .propose_\n_┃ ⊱ .askout_\n_┃ ⊱ .hollow-purple_\n_┃ ⊱ .hack_\n_┃ ⊱ .arrest_\n_┃ ⊱ .liedetector_\n_┃ ⊱ .rizz_\n_┃ ⊱ .speech_\n_┃ ⊱ .slap_\n_┃ ⊱ .kill_\n_┃ ⊱ .kiss_\n_┃ ⊱ .hug_\n_┃ ⊱ .dance_\n_┃ ⊱ .aura_\n_┃ ⊱ .lol_`;
            await sendWithBackButton(sock, msg, text);
        }
    },
    {
        name: 'menu_owner',
        isPrefixless: true,
        execute: async (sock, msg) => {
            const text = `┌─────────────┐\n│ 👑 OWNER & DEV  \n└─────────────┘\n\n_┃ ⊱ .prefix_\n_┃ ⊱ .diagnose_\n_┃ ⊱ .update_\n_┃ ⊱ .mode_\n_┃ ⊱ .setsudo_\n_┃ ⊱ .delsudo_\n_┃ ⊱ .addowner_\n_┃ ⊱ .delowner_\n_┃ ⊱ .restart_\n_┃ ⊱ .shutdown_\n_┃ ⊱ .ban_\n_┃ ⊱ .unban_\n_┃ ⊱ .afk_\n_┃ ⊱ .setvar_\n_┃ ⊱ .settings_\n_┃ ⊱ .antipm_\n_┃ ⊱ .reminder_`;
            await sendWithBackButton(sock, msg, text);
        }
    },
    {
        name: 'menu_utilities',
        isPrefixless: true,
        execute: async (sock, msg) => {
            const text = `┌───────────┐\n│ 🛠️ UTILITIES  \n└───────────┘\n\n_┃ ⊱ .ping_\n_┃ ⊱ .alive_\n_┃ ⊱ .delete_\n_┃ ⊱ .tdelete_\n_┃ ⊱ .autoreact_\n_┃ ⊱ .speed_\n_┃ ⊱ .sticker_\n_┃ ⊱ .crop_\n_┃ ⊱ .take_\n_┃ ⊱ .smeme_\n_┃ ⊱ .packname_\n_┃ ⊱ .fixpack_\n_┃ ⊱ .unpack_\n_┃ ⊱ .tourl_\n_┃ ⊱ .kamui_\n_┃ ⊱ .addnote_\n_┃ ⊱ .delnote_\n_┃ ⊱ .getnotes_\n_┃ ⊱ .toimg_\n_┃ ⊱ .tomp3_\n_┃ ⊱ .tomp4_\n_┃ ⊱ .binary_\n_┃ ⊱ .ocr_\n_┃ ⊱ .qr_\n_┃ ⊱ .readqr_\n_┃ ⊱ .qty_\n_┃ ⊱ .currency_`;
            await sendWithBackButton(sock, msg, text);
        }
    },
    {
        name: 'help',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await sendHelpList(sock, msg);
        }
    },
    {
        name: 'commands',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await sendHelpList(sock, msg);
        }
    }
];