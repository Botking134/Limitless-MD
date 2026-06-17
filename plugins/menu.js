// plugins/menu.js
const config = require('../config');
const path = require('path');

// ─── HELPER: FORMAT UPTIME ──────────────────────────────────────

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

// ─── MENU IMAGES ──────────────────────────────────────────────────

// Default image pool
const defaultImages = [
    "https://freeimage.host/i/CoXZ9LB",
    "https://freeimage.host/i/CoXQyXV",
    "https://freeimage.host/i/CoXQpzQ",
    "https://freeimage.host/i/CoXQDej",
    "https://freeimage.host/i/CoXZJqP",
    "https://freeimage.host/i/CoXZd11",
    "https://freeimage.host/i/CoXZFdg",
    "https://freeimage.host/i/CoXZ2rF",
    "https://freeimage.host/i/CoXZK7a"
];

// If config.menuImage is set (from .setvar menu_image=url1,url2,...), use it instead.
let menuImages = [...defaultImages];
if (config.menuImage && Array.isArray(config.menuImage) && config.menuImage.length > 0) {
    menuImages = config.menuImage;
}

// ─── HELPER: FETCH IMAGE BUFFER ──────────────────────────────
async function fetchImageBuffer(url) {
    try {
        const response = await fetch(url, { timeout: 5000 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (e) {
        console.error(`[MENU] Failed to fetch image: ${url}`, e.message);
        return null;
    }
}

// ─── UPDATED CREATE CARD ──────────────────────────────────────
async function createCard(sock, title, description, imageUrl, commandId, buttonText) {
    const { prepareWAMessageMedia } = await import('@itsliaaa/baileys');
    
    // Fetch the image buffer first
    const buffer = await fetchImageBuffer(imageUrl);
    if (!buffer) {
        // If image fails, return a card without image (header omitted)
        return {
            header: { hasMediaAttachment: false },
            body: { text: title },
            footer: { text: description },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: "quick_reply",
                        buttonParamsJson: JSON.stringify({
                            display_text: buttonText,
                            id: commandId
                        })
                    }
                ]
            }
        };
    }

    const media = await prepareWAMessageMedia(
        { image: buffer },
        { upload: sock.waUploadToServer }
    );
    
    return {
        header: {
            imageMessage: media.imageMessage,
            hasMediaAttachment: true
        },
        body: { text: title },
        footer: { text: description },
        nativeFlowMessage: {
            buttons: [
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: buttonText,
                        id: commandId
                    })
                }
            ]
        }
    };
}

// ─── UPDATED RENDER CAROUSEL MENU ──────────────────────────────
async function renderCarouselMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());

    const headerText = 
`┌──────────────────┐
│   *Limitless-MD*   │
└──────────────────┘
_Owner: ${config.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
══════════════════════
_Throughout Heaven And Earth 🌏_
┌────────────────────────────────────┐
│ _I alone am the Honoured one_ │
└────────────────────────────────────┘

_Swipe through the cards below to explore command categories._ 🔮`;

    try {
        const { generateWAMessageFromContent, delay } = await import('@itsliaaa/baileys');

        // ─── LOADING ANIMATION ──────────────────────────────────
        const loadingMsg = await sock.sendMessage(jid, { text: "▱▱▱▱▱▱▱▱▱▱ Expanding Domain..." }, { quoted: msg });

        const frames = [
            { text: "▰▱▱▱▱▱▱▱▱▱ Channelling Cursed Energy...", delay: 1000 },
            { text: "▰▰▰▱▱▱▱▱▱▱ Six Eyes Activating...", delay: 1000 },
            { text: "▰▰▰▰▰▱▱▱▱▱ Infinite Void Opening...", delay: 1000 },
            { text: "▰▰▰▰▰▰▰▰▰▰ Domain Expansion: Complete! 🌀", delay: 1500 }
        ];

        for (const frame of frames) {
            await delay(frame.delay);
            try {
                await sock.sendMessage(jid, { text: frame.text, edit: loadingMsg.key });
            } catch (editErr) { /* ignore */ }
        }

        // ─── DELETE LOADING MESSAGE ─────────────────────────────
        try {
            await sock.sendMessage(jid, { delete: loadingMsg.key });
        } catch (e) { /* ignore */ }

        // ─── BUILD CAROUSEL ──────────────────────────────────────
        const shuffledImages = [...menuImages].sort(() => 0.5 - Math.random());

        const categories = [
            { name: "AI & CHATBOT 🧠", desc: "Interactive AI assistants & custom engines.", cmd: "menu_ai" },
            { name: "INTERACTIVE GAMES 🎮", desc: "Lobbies, turn-based puzzles, quizzes, and duels.", cmd: "menu_games" },
            { name: "GROUP MANAGEMENT 👥", desc: "Group configurations & administrative controls.", cmd: "menu_group" },
            { name: "TOOLS ⚙️", desc: "Advanced Presence parameters & tracking tools.", cmd: "menu_tools" },
            { name: "DOWNLOADER 📥", desc: "High-speed multi-platform downloaders.", cmd: "menu_download" },
            { name: "FUN & ROLEPLAY 🎭", desc: "Monologues, animations, and interactive cards.", cmd: "menu_fun" },
            { name: "OWNER & DEV 👑", desc: "Private developer config & panel variables panel.", cmd: "menu_owner" },
            { name: "UTILITIES 🛠️", desc: "Converter tools & network latencies.", cmd: "menu_utilities" }
        ];

        const cards = [];
        for (let i = 0; i < categories.length; i++) {
            const cat = categories[i];
            try {
                const card = await createCard(
                    sock,
                    cat.name,
                    cat.desc,
                    shuffledImages[i % shuffledImages.length],
                    cat.cmd,
                    "Explore Commands 🔮"
                );
                cards.push(card);
            } catch (err) {
                console.error(`[MENU] Failed to create card for ${cat.name}:`, err.message);
                // Fallback: card without image
                cards.push({
                    header: { hasMediaAttachment: false },
                    body: { text: cat.name },
                    footer: { text: cat.desc },
                    nativeFlowMessage: {
                        buttons: [
                            {
                                name: "quick_reply",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "Explore Commands 🔮",
                                    id: cat.cmd
                                })
                            }
                        ]
                    }
                });
            }
        }

        // If no cards were created, fallback to text menu
        if (cards.length === 0) {
            throw new Error("No cards could be created");
        }

        const messageContent = {
            interactiveMessage: {
                body: { text: headerText },
                footer: { text: "Limitless System Menu 🪽" },
                carouselMessage: {
                    cards: cards
                }
            }
        };

        const msgProto = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: messageContent
            }
        }, { userJid: sock.user.id });

        await sock.relayMessage(jid, msgProto.message, { messageId: msgProto.key.id });

    } catch (error) {
        console.error("Carousel Menu Render Error:", error);
        // Fallback to text menu
        await renderMenu(sock, msg);
    }
}

// ─── RENDER TEXT MENU ────────────────────────────────────────────

async function renderMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());
    const readMore = String.fromCharCode(8206).repeat(4001);
    const randomImage = menuImages[Math.floor(Math.random() * menuImages.length)];

    const menuText =
`┌──────────────────┐
│   *Limitless-MD*   │
└──────────────────┘
_Owner: ${config.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
══════════════════════
_Throughout Heaven And Earth 🌏_
┌────────────────────────────────────┐
│ _I alone am the Honoured one_ │
└────────────────────────────────────┘
${readMore}
_❖ ── [ AI & CHATBOT ] ── ❖_
_┃ ⊱ ai_
_┃ ⊱ groq_
_┃ ⊱ gojo_ (rise/sleep)
_┃ ⊱ debug_
_┃ ⊱ summon_
_┃ ⊱ read_
_┃ ⊱ imagine_
_┃ ⊱ lizzy_
_┃ ⊱ chatbot_
_┃ ⊱ say_

_❖ ── [ INTERACTIVE GAMES ] ── ❖_
_┃ ⊱ games_ (Unified Lobby)
_┃ ⊱ ttt_
_┃ ⊱ rps_
_┃ ⊱ guess_
_┃ ⊱ vault8_
_┃ ⊱ trivia_
_┃ ⊱ quiz_
_┃ ⊱ charade_ / .sharade
_┃ ⊱ anagram_
_┃ ⊱ wcg_
_┃ ⊱ millionaire_
_┃ ⊱ torf_
_┃ ⊱ pvp_
_┃ ⊱ escape_

_❖ ── [ GROUP MANAGEMENT ] ── ❖_
_┃ ⊱ mute_
_┃ ⊱ unmute_
_┃ ⊱ open_
_┃ ⊱ close_
_┃ ⊱ lock_
_┃ ⊱ unlock_
_┃ ⊱ kick_
_┃ ⊱ promote_
_┃ ⊱ demote_
_┃ ⊱ tagall_
_┃ ⊱ tag_
_┃ ⊱ link_
_┃ ⊱ invite_
_┃ ⊱ gclink_
_┃ ⊱ antilink_
_┃ ⊱ admins_
_┃ ⊱ antitag_
_┃ ⊱ antibot_
_┃ ⊱ warn_
_┃ ⊱ togcstatus_
_┃ ⊱ getgpp_
_┃ ⊱ setgpp_
_┃ ⊱ welcome_
_┃ ⊱ goodbye_
_┃ ⊱ delwelcome_
_┃ ⊱ delgoodbye_
_┃ ⊱ poll_
_┃ ⊱ antigm_
_┃ ⊱ gclog_
_┃ ⊱ creategc_
_┃ ⊱ kickall_
_┃ ⊱ stopkickall_
_┃ ⊱ tkick_
_┃ ⊱ gcjid_
_┃ ⊱ antispam_
_┃ ⊱ silence_
_┃ ⊱ gcalerts_
_┃ ⊱ antigcstatus_
_┃ ⊱ spamtag_
_┃ ⊱ antipromote_
_┃ ⊱ antidemote_

_❖ ── [ TOOLS ] ── ❖_
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
_┃ ⊱ archive_
_┃ ⊱ unarchive_
_┃ ⊱ autoviewstatus_ / .autovs
_┃ ⊱ statusemoji_
_┃ ⊱ autoreactstatus_ / .autors
_┃ ⊱ block_
_┃ ⊱ unblock_
_┃ ⊱ aza_
_┃ ⊱ time_
_┃ ⊱ weather_ (AI Search)
_┃ ⊱ device_
_┃ ⊱ ss_
_┃ ⊱ calc_
_┃ ⊱ trt_ (AI dependent)
_┃ ⊱ translate_
_┃ ⊱ spam_
_┃ ⊱ livescore_ / .live (AI Search)
_┃ ⊱ score_ (AI Search)

_❖ ── [ DOWNLOADER ] ── ❖_
_┃ ⊱ play_
_┃ ⊱ ytmp3_
_┃ ⊱ ytmp4_
_┃ ⊱ yt_
_┃ ⊱ tt2_
_┃ ⊱ img_
_┃ ⊱ song_
_┃ ⊱ video_
_┃ ⊱ fb_
_┃ ⊱ tt_
_┃ ⊱ mediafire_
_┃ ⊱ apk_
_┃ ⊱ apksearch_
_┃ ⊱ shazam_
_┃ ⊱ lyrics_
_┃ ⊱ gdrive_
_┃ ⊱ gitclone_
_┃ ⊱ pinterest_
_┃ ⊱ subtitle_
_┃ ⊱ ytmp3doc_
_┃ ⊱ playdoc_
_┃ ⊱ spotify_
_┃ ⊱ spotify2_
_┃ ⊱ web_
_┃ ⊱ x2_
_┃ ⊱ pdf_
_┃ ⊱ tgs_
_┃ ⊱ ig_

_❖ ── [ FUN & ROLEPLAY ] ── ❖_
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
_┃ ⊱ kik_
_┃ ⊱ punch_
_┃ ⊱ hifive_
_┃ ⊱ bite_
_┃ ⊱ poke_
_┃ ⊱ dap_
_┃ ⊱ dance_
_┃ ⊱ aura_
_┃ ⊱ lol_

_❖ ── [ OWNER & DEV ] ── ❖_
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
_┃ ⊱ remind_
_┃ ⊱ games_closeall_
_┃ ⊱ owner_

_❖ ── [ UTILITIES ] ── ❖_
_┃ ⊱ ping_
_┃ ⊱ ping2_
_┃ ⊱ alive_
_┃ ⊱ delete_
_┃ ⊱ tdelete_
_┃ ⊱ autoreact_
_┃ ⊱ speed_
_┃ ⊱ sticker_
_┃ ⊱ crop_
_┃ ⊱ take_
_┃ ⊱ setcmd_
_┃ ⊱ delcmd_
_┃ ⊱ tovv_
_┃ ⊱ tourl_
_┃ ⊱ kamui_
_┃ ⊱ vvs_router_ (hidden)
_┃ ⊱ emix_
_┃ ⊱ smeme_
_┃ ⊱ addnote_
_┃ ⊱ delnote_
_┃ ⊱ getnotes_
_┃ ⊱ getnote_
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

    try {
        await sock.sendMessage(jid, {
            image: { url: randomImage },
            caption: menuText
        }, { quoted: msg });

        const audioUrl = "https://github.com/Botking134/Limitless-MD/raw/refs/heads/master/plugins/AUD-20260604-WA0001.mp3";
        try {
            const audioResponse = await fetch(audioUrl);
            if (audioResponse.ok) {
                const arrayBuffer = await audioResponse.arrayBuffer();
                await sock.sendMessage(jid, {
                    audio: Buffer.from(arrayBuffer),
                    mimetype: "audio/mpeg",
                    ptt: false
                });
            } else {
                throw new Error();
            }
        } catch (audioErr) {
            await sock.sendMessage(jid, {
                audio: { url: audioUrl },
                mimetype: "audio/mpeg",
                ptt: false
            });
        }
    } catch (error) {
        console.error("Menu Image Render Error:", error);
        await sock.sendMessage(jid, { text: menuText }, { quoted: msg });
    }
}

// ─── RENDER CAROUSEL MENU ──────────────────────────────────────

async function renderCarouselMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());

    const headerText =
`┌──────────────────┐
│   *Limitless-MD*   │
└──────────────────┘
_Owner: ${config.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
══════════════════════
_Throughout Heaven And Earth 🌏_
┌────────────────────────────────────┐
│ _I alone am the Honoured one_ │
└────────────────────────────────────┘

_Swipe through the cards below to explore command categories._ 🔮`;

    try {
        const { generateWAMessageFromContent } = await import('@itsliaaa/baileys');
        await sock.sendMessage(jid, { text: "Channelling Infinity Domain... 🌌" }, { quoted: msg });

        const shuffledImages = [...menuImages].sort(() => 0.5 - Math.random());

        const categories = [
            { name: "AI & CHATBOT 🧠", desc: "Interactive AI assistants & custom engines.", cmd: "menu_ai" },
            { name: "INTERACTIVE GAMES 🎮", desc: "Lobbies, turn-based puzzles, quizzes, and duels.", cmd: "menu_games" },
            { name: "GROUP MANAGEMENT 👥", desc: "Group configurations & administrative controls.", cmd: "menu_group" },
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
                sock,
                cat.name,
                cat.desc,
                shuffledImages[i % shuffledImages.length],
                cat.cmd,
                "Explore Commands 🔮"
            );
            cards.push(card);
        }

        const messageContent = {
            interactiveMessage: {
                body: { text: headerText },
                footer: { text: "Limitless System Menu 🪽" },
                carouselMessage: {
                    cards: cards
                }
            }
        };

        const msgProto = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: messageContent
            }
        }, { userJid: sock.user.id });

        await sock.relayMessage(jid, msgProto.message, { messageId: msgProto.key.id });

    } catch (error) {
        console.error("Carousel Menu Render Error:", error);
        await renderMenu(sock, msg);
    }
}

// ─── SUB-MENU HELPERS ───────────────────────────────────────────

function buildSubMenu(commands) {
    return commands.map(c => `_┃ ⊱ ${c}_`).join('\n');
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // Standard Text Menu
    {
        name: 'menu',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderMenu(sock, msg);
        }
    },
    {
        name: 'list',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderMenu(sock, msg);
        }
    },

    // Carousel Menu
    {
        name: 'menu2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderCarouselMenu(sock, msg);
        }
    },
    {
        name: 'list2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderCarouselMenu(sock, msg);
        }
    },

    // ─── SUB-MENUS (Prefixless) ─────────────────────────────────

    // AI & CHATBOT
    {
        name: 'menu_ai',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText =
`🧠 *INFINITY CORE: AI & CHATBOTS* 🧠
────────────────────
• *${config.prefix}ai <prompt>* — Solves complex queries.
• *${config.prefix}groq <prompt>* — High-speed dynamic model completions.
• *Gojo <prompt>* — Speak with Satoru Gojo directly (supports 'rise'/'sleep').
• *${config.prefix}debug <code>* — Auto-diagnoses compile errors & bugs.
• *${config.prefix}summon <char> <prompt>* — Summons any fictional character.
• *${config.prefix}read <prompt>* — High-speed Vision image analyzer.
• *${config.prefix}imagine <prompt>* — Generates premium AI illustrations.
• *${config.prefix}lizzy <on/off>* — Devoted anime chatbot toggle.
• *${config.prefix}chatbot <on/off>* — General chat assistance toggle.
• *${config.prefix}say <text>* — Convert text to custom audio voice note.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },

    // GAMES
    {
        name: 'menu_games',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText =
`🎮 *DOMAIN INTERACTIVE GAMES* 🎮
────────────────────
• *${config.prefix}games* — Unified Public Game Lobby portal.
• *${config.prefix}ttt* — Play Tic-Tac-Toe (AI/Multiplayer).
• *${config.prefix}rps* — Play Rock-Paper-Scissors against Gojo.
• *${config.prefix}guess* — Guess Gojo's Cursed Energy amount.
• *${config.prefix}vault8* — Creepy text-RPG terminal simulator.
• *${config.prefix}trivia* — General knowledge Trivia (Single/Multiplayer).
• *${config.prefix}quiz <category>* — Categorized dynamic quiz module.
• *${config.prefix}charade* / *sharade* — Guess the Emoji Phrase.
• *${config.prefix}anagram* — Scrambled Anagram solver (Single/Multiplayer).
• *${config.prefix}wcg* — Turn-based Word Chain game lobby.
• *${config.prefix}millionaire* — Interactive 15-question Millionaire.
• *${config.prefix}torf* — Dynamic True/False category quiz.
• *${config.prefix}pvp* — 1v1 turn-based battle with parry countdowns.
• *${config.prefix}escape* — Procedural Escape Room text adventure.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },

    // GROUP MANAGEMENT
    {
        name: 'menu_group',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText =
`👥 *DOMAIN EXPANSION: GROUP MODS* 👥
────────────────────
• *${config.prefix}mute <duration>* — Locks/unlocks group conversation flows.
• *${config.prefix}kick / .promote / .demote* — User state management.
• *${config.prefix}tagall / .tag* — Dynamic tags or ghost tags all members.
• *${config.prefix}link* — Fetches active invitation link.
• *${config.prefix}antilink <on/off>* — Blocks or warns link spam.
• *${config.prefix}admins* — Summons all group administrators.
• *${config.prefix}antitag <on/off>* — Restricts non-admin bot mentions.
• *${config.prefix}antibot <on/off>* — Auto-deletes or ejects secondary bots.
• *${config.prefix}warn* — Issues admin warnings (auto-kicks at configured threshold).
• *${config.prefix}antigm <on/off>* — Discards group status mentions.
• *${config.prefix}gclog <on/off/check>* — Conversation logger & AI summarizer.
• *${config.prefix}creategc <name>* — Automatically instantiates a new group.
• *${config.prefix}kickall* — Exorcises all non-admin targets (Owner Only).
• *${config.prefix}stopkickall* — Aborts the active exorcism sequence.
• *${config.prefix}tkick <duration>* — Timed participant ejections.
• *${config.prefix}gcjid* — Extract group cryptographic JID.
• *${config.prefix}antispam <on/off/trig>* — Rate-limiting spam shield.
• *${config.prefix}silence <-s/-m/all>* — Auto-delete chat constraints.
• *${config.prefix}gcalerts <promote/demote/welcome/goodbye> <on/off>* — Real-time event notifications.
• *${config.prefix}antigcstatus <warn/delete/kick/off>* — Blocks unapproved status posts.
• *${config.prefix}spamtag <count> <text>* — Repeatedly tags group members with mentions.
• *${config.prefix}antipromote <on/off>* — Demotes promoters and targets on unsanctioned promotions.
• *${config.prefix}antidemote <on/off>* — Instant demotion of unapproved demoters and re-promotion of the victim.
• *${config.prefix}togcstatus* — Post media/text to group status.
• *${config.prefix}getgpp* — Get group profile picture.
• *${config.prefix}setgpp* — Set group profile picture.
• *${config.prefix}welcome <on/off/set>* — Welcome module.
• *${config.prefix}goodbye <on/off/set>* — Goodbye module.
• *${config.prefix}delwelcome* — Remove welcome config.
• *${config.prefix}delgoodbye* — Remove goodbye config.
• *${config.prefix}poll <question? (opt1/opt2)>* — Create a poll.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },

    // TOOLS
    {
        name: 'menu_tools',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText =
`⚙️ *LIMITLESS SPATIAL TOOLS* ⚙️
────────────────────
• *${config.prefix}track* — Spatial geographical prefix locator (Supports Kenya prefix).
• *${config.prefix}getpp* — Extracts target user profile picture.
• *${config.prefix}setname* — Modifies bot display username.
• *${config.prefix}save* — Saves active status media locally.
• *${config.prefix}tostatus* — Uploads local media/text to status broadcast.
• *${config.prefix}fw* — Interactive multi-chat forwarder.
• *${config.prefix}presence* — Presence dashboards overview.
• *${config.prefix}autotyping / .autorecording* — Active status simulation.
• *${config.prefix}alwaysonline / .autoread* — Continuous online state.
• *${config.prefix}antidelete -g/-pm/-all/-off* — Deleted message logging with scope.
• *${config.prefix}antiviewonce -g/-pm/-all/-off* — ViewOnce decryption with scope.
• *${config.prefix}antibug* — Active flood rate-limit protection.
• *${config.prefix}clear* — Completely empties server chat logs.
• *${config.prefix}archive / .unarchive* — Archive states controllers.
• *${config.prefix}autoviewstatus* / *autovs* — Auto-view status triggers.
• *${config.prefix}statusemoji* — Custom status reaction emoji.
• *${config.prefix}autoreactstatus* / *autors* — Auto status reaction triggers.
• *${config.prefix}block / .unblock* — Native contact blocks.
• *${config.prefix}aza <set>* — Bank credentials wizard configuration.
• *${config.prefix}time* — Regional timezone clock calculator.
• *${config.prefix}weather* — Live weather analytics (Gemini Search-grounded).
• *${config.prefix}device* — Client hardware OS signature scanner.
• *${config.prefix}ss <url>* — Render high-speed website screenshot.
• *${config.prefix}calc <expr>* — Secure mathematical expression evaluator.
• *${config.prefix}trt <route/text> <lang>* — AI-dependent context translator (Gemini).
• *${config.prefix}translate* — Alias for .trt.
• *${config.prefix}spam* — Repeatedly loops/spams text or media.
• *${config.prefix}livescore* / *live* — Ongoing matches live scoreboard tracker.
• *${config.prefix}score <teams> <league> <D/M/Y>* — Historical sports past score finder.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },

    // DOWNLOADER
    {
        name: 'menu_download',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText =
`📥 *CURSED TECHNIQUE: DOWNLOADERS* 📥
────────────────────
• *${config.prefix}play <query>* — Song downloader with clean metadata artwork.
• *${config.prefix}ytmp3 / .ytmp4* — Dual-fallback YouTube downloaders.
• *${config.prefix}yt <url>* — YouTube v3 multi-format media downloader.
• *${config.prefix}tt2 <url>* — TikTok v2 watermark-free link downloader.
• *${config.prefix}img <query> <count>* — Google bulk image downloader.
• *${config.prefix}song <query>* — Numbered song index selector & downloader.
• *${config.prefix}video <query>* — YouTube video search downloader (mobile-optimized).
• *${config.prefix}fb / .facebook* — Facebook HD video downloader.
• *${config.prefix}tt / .tiktok* — Watermark-free TikTok downloader.
• *${config.prefix}mediafire* — MediaFire file document downloader.
• *${config.prefix}apk <query>* — Direct APK application downloader.
• *${config.prefix}apksearch <query>* — Numbered APK search list downloader.
• *${config.prefix}shazam* — Identifies quoted audio & offers download.
• *${config.prefix}lyrics <query>* — Detailed lyrics scraper.
• *${config.prefix}gdrive* — Google Drive file document downloader.
• *${config.prefix}gitclone* — GitHub repository master branch zip-cloner.
• *${config.prefix}pinterest / .pint* — Pinterest video/image downloader.
• *${config.prefix}subtitle* — Movie English subtitles .srt document downloader.
• *${config.prefix}ytmp3doc / .ytmp4doc* — YouTube documents downloaders.
• *${config.prefix}playdoc / .videodoc* — YouTube search document downloaders.
• *${config.prefix}spotify / .spotify2* — Spotify v1 and v2 music downloaders.
• *${config.prefix}web* — Website assets zipper and downloader.
• *${config.prefix}x2 / .xdl2* — Twitter/X video and image downloader.
• *${config.prefix}pdf <url>* — Convert any webpage to PDF document.
• *${config.prefix}tgs <link>* — Download Telegram sticker packs as ZIP.
• *${config.prefix}ig <link>* — Instagram video/image downloader.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },

    // FUN & ROLEPLAY
    {
        name: 'menu_fun',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText =
`🎭 *UNLIMITED VOID: FUN & ROLEPLAY* 🎭
────────────────────
• *${config.prefix}bankai <name>* — Search character Bankai details.
• *${config.prefix}dom-exp / .domain-expansion* — Search JJK Cursed Domain expansion.
• *${config.prefix}wyr* — Spawn interactive Would You Rather poll.
• *${config.prefix}joke* — Drop witty dad-jokes or funny giggles.
• *${config.prefix}insult / .roast* — Expose subject with witty roasts.
• *${config.prefix}ship <@user>* — Match two members with love compatibility.
• *${config.prefix}wed <@user>* — Host a priest-styled holy matrimony ceremony.
• *${config.prefix}propose <@user>* — Drop custom proposal cards with Yes/No locks.
• *${config.prefix}askout <@user>* — Ask someone out with secure feedback gates.
• *${config.prefix}hollow-purple / .purple-tech* — Channel Satoru Gojo's ultimate technique.
• *${config.prefix}hack <bank/soft>* — Run interactive terminal hex animations.
• *${config.prefix}arrest <@user>* — Issue a custom arrest warrant & jail them.
• *${config.prefix}liedetector <@user>* — Biometric truth/lie scanner.
• *${config.prefix}rizz* — Drops smooth, infinite pick-up lines.
• *${config.prefix}speech <char>* — Deliver iconic anime monologues.
• *${config.prefix}slap, .kill, .kiss, .hug, .kik, .punch, .hifive, .bite, .poke, .dap, .dance, .aura, .lol* — Anime action GIFs.
• *${config.prefix}info* — Fetch detailed user intel (LID/Phone/Device).`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },

    // OWNER & DEV
    {
        name: 'menu_owner',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText =
`👑 *APEX ADMINISTRATIVE AUTHORITY* 👑
────────────────────
• *${config.prefix}diagnose* — Active system compile diagnostic check.
• *${config.prefix}update <setup/yes/force>* — System updates & force-overwriting.
• *${config.prefix}mode <public/private>* — Bot privacy state.
• *${config.prefix}setsudo / .delsudo* — Sudo users registers.
• *${config.prefix}addowner / .delowner* — Secondary owners registers.
• *${config.prefix}restart / .shutdown* — System processes restart/kill.
• *${config.prefix}ban / .unban* — Global blacklist controllers.
• *${config.prefix}afk* — Meditation AFK automated auto-responder.
• *${config.prefix}setvar* — Dynamic variable configurations editor.
• *${config.prefix}settings* — Displays active global settings card.
• *${config.prefix}antipm <on/off>* — Automated PM DM blocker.
• *${config.prefix}reminder <timer> <note>* — Persistently register custom cron reminders.
• *${config.prefix}remind* — Access active scheduled reminders board.
• *${config.prefix}games_closeall* — Terminate all active game sessions.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },

    // UTILITIES
    {
        name: 'menu_utilities',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText =
`🛠️ *SIX EYES UTILITY STACK* 🛠️
────────────────────
• *${config.prefix}ping / .ping2* — Network latency & speed tracking.
• *${config.prefix}alive* — System uptime & WAT climate dashboard.
• *${config.prefix}delete / .del / .dlt* — Message deletion tool (LID-Safe).
• *${config.prefix}tdelete / .tdel / .tdlt* — Scheduled delayed deletion.
• *${config.prefix}autoreact* — Automated message reactions.
• *${config.prefix}speed* — Interactive execution speed meter.
• *${config.prefix}sticker / .s* — Standard sticker converter.
• *${config.prefix}crop* — Cropped square sticker.
• *${config.prefix}take / .steal* — Sticker metadata customization.
• *${config.prefix}setcmd / .delcmd* — Maps commands directly to stickers.
• *${config.prefix}tourl / .url* — Media file cloud uploaders.
• *${config.prefix}kamui* — Prefixless ViewOnce decryption (hardcoded).
• *${config.prefix}vvs_router* (hidden) — Dynamic ViewOnce decryption via variable.
• *${config.prefix}emix* — Combine two emojis into a transparent sticker.
• *${config.prefix}smeme* — Create stroked impact sticker memes.
• *${config.prefix}addnote* — Saves a custom sticky note.
• *${config.prefix}delnote* — Deletes a specific note.
• *${config.prefix}getnotes* — Lists all notes saved for this chat.
• *${config.prefix}getnote* — Retrieves the content of a note.
• *${config.prefix}toimg* — Convert static sticker to PNG image.
• *${config.prefix}tomp3* — Convert replied video to MP3 audio (local FFMPEG).
• *${config.prefix}tomp4* — Convert animated sticker to MP4 video.
• *${config.prefix}binary <text or binary>* — Encode or decode binary strings.
• *${config.prefix}ocr <text>* — Render text as a clean image.
• *${config.prefix}qr <text>* — Generate a QR code.
• *${config.prefix}readqr* — Decode a QR code from an image.
• *${config.prefix}qty* — Convert scientific/imperial units.
• *${config.prefix}currency <amount> <from> to <to>* — Live currency conversion.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'menu') {
        aliases.push({ ...cmd, name: 'domain' });
    }
});
module.exports.push(...aliases);