// ─── SYSTEM CONFIG & IMPORTS ──────────────────────────────────────
const config = require('../config');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { saveState, normalizeToJid } = require('../stateManager');

// ─── NOTES PATH ──────────────────────────────────────────────────
const notesPath = path.join(__dirname, '../storage/notes.json');

// ─── HELPERS ──────────────────────────────────────────────────────
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

function readNotes() {
    try {
        if (fs.existsSync(notesPath)) return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
    } catch (e) { /* ignore */ }
    return {};
}

function saveNotes(notes) {
    try {
        const dir = path.dirname(notesPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

// Combined audio pool for .menu
const menuAudios = [
    "https://files.catbox.moe/pj7qrm.mp3",
    "https://files.catbox.moe/4adjoq.mp3",
    "https://files.catbox.moe/qpwydd.mp3",
    "https://files.catbox.moe/8x6exq.mp3",
    "https://files.catbox.moe/jkxbzh.mp3",
    "https://files.catbox.moe/h75gjf.mp3",
    "https://files.catbox.moe/5nku92.mp3"
];

// Carousel card cover images
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
        console.error(`[MENU] Failed to fetch image: ${url}`, e.message);
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

// ─── MASTER TEXT MENU ────────────────────────────────────────────────
const menuText =
`┌──────────────────┐
│   *Limitless-MD*   │
└──────────────────┘
_Owner: ${config.ownerName}_
_User: User_
_Version: 1.0.0_
════════════════════════
_Throughout Heaven And Earth _
┌────────────────────────────────────┐
│ _I alone am the Honoured one_ │
└────────────────────────────────────┘

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
_┃ ⊱ weather_
_┃ ⊱ device_
_┃ ⊱ ss_
_┃ ⊱ calc_
_┃ ⊱ trt_
_┃ ⊱ translate_
_┃ ⊱ spam_

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
_┃ ⊱ vv_
_┃ ⊱ sticker_
_┃ ⊱ crop_
_┃ ⊱ take_
_┃ ⊱ setcmd_
_┃ ⊱ delcmd_
_┃ ⊱ tovv_
_┃ ⊱ tourl_
_┃ ⊱ kamui_
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
_┃ ⊱ currency
`;

// ─── RENDER TEXT MENU ───────────────────────────────────────────────
async function renderMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());
    const readMore = String.fromCharCode(8206).repeat(4001);
    const randomImage = menuImages[Math.floor(Math.random() * menuImages.length)];

    const menuTextCompiled =
`┌──────────────────┐
│   *Limitless-MD*   │
└──────────────────┘
_Owner: ${config.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
════════════════════════
_Throughout Heaven And Earth _
┌────────────────────────────────────┐
│ _I alone am the Honoured one_ │
└────────────────────────────────────┘
${readMore}
${menuText}`;

    try {
        await sock.sendMessage(jid, {
            image: { url: randomImage },
            caption: menuTextCompiled
        }, { quoted: msg });
    } catch (error) {
        console.error("Menu Image Render Error:", error);
        await sock.sendMessage(jid, { text: menuTextCompiled }, { quoted: msg });
    }
}

// ─── RENDER CAROUSEL MENU ──────────────────────────────────────────
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
════════════════════════
_Throughout Heaven And Earth_
┌────────────────────────────────────┐
│ _I alone am the Honoured one_ │
└────────────────────────────────────┘

_Swipe through the cards below to explore command categories._ 🔮`;

    try {
        const { generateWAMessageFromContent } = await import('@itsliaaa/baileys');

        const loadingMsg = await sock.sendMessage(jid, { text: "▱▱▱▱▱▱▱▱▱▱ Expanding Domain..." }, { quoted: msg });

        const frames = [
            { text: "▰▱▱▱▱▱▱▱▱▱ Channelling Cursed Energy...", delay: 600 },
            { text: "▰▰▰▱▱▱▱▱▱▱ Six Eyes Activating...", delay: 600 },
            { text: "▰▰▰▰▰▱▱▱▱▱ Infinite Void Opening...", delay: 600 },
            { text: "▰▰▰▰▰▰▰▰▰▰ Domain Expansion: Complete! 🌌", delay: 800 }
        ];

        for (const frame of frames) {
            await delay(frame.delay);
            try {
                await sock.sendMessage(jid, { text: frame.text, edit: loadingMsg.key });
            } catch (editErr) { /* ignore */ }
        }

        try {
            await sock.sendMessage(jid, { delete: loadingMsg.key });
        } catch (e) { /* ignore */ }

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

        if (cards.length === 0) throw new Error("No cards could be created");

        const messageContent = {
            interactiveMessage: {
                body: { text: headerText },
                footer: { text: "Limitless System Menu 🪽" },
                carouselMessage: {
                    cards: cards
                }
            }
        };

        const msgProto = generateWAMessageFromContent(jid, messageContent, { userJid: sock.user.id });
        await sock.relayMessage(jid, msgProto.message, { messageId: msgProto.key.id });

    } catch (error) {
        console.error("Carousel Menu Render Error:", error);
        await renderMenu(sock, msg);
    }
}

// ─── NOTE SESSION HANDLER ───────────────────────────────────────────
async function handleNoteSession(sock, msg) {
    try {
        const jid = msg.key.remoteJid;
        const rawContent = getRawMessage(msg.message);
        const text = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
        const quotedMsgId = rawContent?.contextInfo?.stanzaId;

        if (quotedMsgId && global.noteSessions && global.noteSessions[quotedMsgId]) {
            const session = global.noteSessions[quotedMsgId];
            const noteName = text.trim();
            if (!noteName) return false;

            const notes = readNotes();
            notes[jid] = notes[jid] || {};
            notes[jid][noteName.toLowerCase()] = {
                title: noteName,
                content: session.content,
                author: session.author,
                time: Date.now()
            };
            saveNotes(notes);
            delete global.noteSessions[quotedMsgId];
            await sock.sendMessage(jid, { text: `✅ Note successfully saved as *${noteName}*!` }, { quoted: msg });
            return true;
        }
    } catch (e) {
        console.error("Note session handler error:", e);
    }
    return false;
}

// ─── EXPORT COMMANDS ──────────────────────────────────────────────

module.exports = [
    // 1. .menu
    {
        name: 'menu',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            await renderMenu(sock, msg);

            const randomAudio = menuAudios[Math.floor(Math.random() * menuAudios.length)];
            await sock.sendMessage(jid, {
                audio: { url: randomAudio },
                mimetype: "audio/mpeg",
                ptt: false
            });
        }
    },

    // 2. .list alias for .menu
    {
        name: 'list',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            await renderMenu(sock, msg);

            const randomAudio = menuAudios[Math.floor(Math.random() * menuAudios.length)];
            await sock.sendMessage(jid, {
                audio: { url: randomAudio },
                mimetype: "audio/mpeg",
                ptt: false
            });
        }
    },

    // 3. .menu2 (Carousel Menu)
    {
        name: 'menu2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderCarouselMenu(sock, msg);
        }
    },

    // 4. .list2 alias for .menu2
    {
        name: 'list2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderCarouselMenu(sock, msg);
        }
    },

    // 5. Interactive Button Interceptor (Prefixless)
    {
        name: 'menu_button_handler',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const raw = getRawMessage(msg.message);

            let buttonId = '';
            if (raw?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
                try {
                    const parsed = JSON.parse(raw.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                    buttonId = parsed.id;
                } catch (e) { /* ignore */ }
            } else if (raw?.buttonsResponseMessage?.selectedButtonId) {
                buttonId = raw.buttonsResponseMessage.selectedButtonId;
            } else if (raw?.templateButtonReplyMessage?.selectedId) {
                buttonId = raw.templateButtonReplyMessage.selectedId;
            }

            if (!buttonId || !buttonId.startsWith('menu_')) return;

            // Define Sub-Menus matching button actions
            let responseText = "";

            if (buttonId === 'menu_ai') {
                responseText = 
`🧠 *AI & CHATBOT COMMANDS*

_┃ ⊱ .ai_ (Prompt standard AI assistant)
_┃ ⊱ .groq_ (Groq AI model utility)
_┃ ⊱ .gojo_ [rise/sleep] (Toggle Six Eyes Agent)
_┃ ⊱ .debug_ [code] (Code/Error architect analysis)
_┃ ⊱ .summon_ [char] [query] (Summon character roleplay)
_┃ ⊱ .read_ (Analyze replied image with Groq Vision)
_┃ ⊱ .imagine_ [prompt] (AI visual image generator)
_┃ ⊱ .lizzy_ [on/off] (Toggle Lizzy chatbot)
_┃ ⊱ .chatbot_ [on/off] (Toggle Jarvis chatbot)
_┃ ⊱ .say_ [text] (Synthesize text to audio speech)`;
            } 
            
            else if (buttonId === 'menu_games') {
                responseText = 
`🎮 *INTERACTIVE GAMES DIRECTORY*

_┃ ⊱ .games_ (Open Unified Game Lobby)
_┃ ⊱ .ttt_ (Challenge a player to Tic-Tac-Toe)
_┃ ⊱ .rps_ (Rock Paper Scissors duel)
_┃ ⊱ .guess_ (Guess the target number)
_┃ ⊱ .vault8_ (Step-by-step nuclear text adventure)
_┃ ⊱ .trivia_ (Fast-paced trivia matches)
_┃ ⊱ .quiz_ (Interactive quiz modes)
_┃ ⊱ .charade_ / .sharade (Group guess games)
_┃ ⊱ .anagram_ (Unscramble word configurations)
_┃ ⊱ .wcg_ (Word Chain Game chains)
_┃ ⊱ .millionaire_ (Who wants to be a millionaire ladder)
_┃ ⊱ .torf_ (True or False fast-checks)
_┃ ⊱ .pvp_ (Action turn-based combat)
_┃ ⊱ .escape_ (Escape room text adventure)`;
            } 
            
            else if (buttonId === 'menu_group') {
                responseText = 
`🔥 *GROUP CONFIGURATION & MANAGEMENT*

_┃ ⊱ .mute / .close_ (Restrict group messages to admins)
_┃ ⊱ .unmute / .open_ (Allow everyone to send messages)
_┃ ⊱ .lock_ / .unlock_ (Lock/unlock group settings modification)
_┃ ⊱ .kick_ [reply/mention] (Remove participant)
_┃ ⊱ .promote_ [reply/mention] (Make user admin)
_┃ ⊱ .demote_ [reply/mention] (Demote admin to member)
_┃ ⊱ .tagall_ (Mention every member in the group)
_┃ ⊱ .tag_ (Inline mention tools)
_┃ ⊱ .link / .gclink_ (Get current group invitation link)
_┃ ⊱ .invite_ (Send automatic group invites)
_┃ ⊱ .antilink_ [on/off] (Auto-kick users posting links)
_┃ ⊱ .antitag_ [on/off] (Limit mass tag permissions)
_┃ ⊱ .antibot_ [on/off] (Detect and remove user bots)
_┃ ⊱ .warn_ [reply/mention] (Issue system warnings)
_┃ ⊱ .welcome_ [text] / .goodbye [text] (Toggle joint/leave notices)
_┃ ⊱ .poll_ [title | opt1 | opt2] (Generate native group polls)`;
            } 
            
            else if (buttonId === 'menu_tools') {
                responseText = 
`⚙️ *ADVANCED TOOLS & METRIC PARAMS*

_┃ ⊱ .track_ (Track delivery metrics)
_┃ ⊱ .getpp_ [mention] (Fetch full resolution profile picture)
_┃ ⊱ .setname_ [name] (Modify current WhatsApp display name)
_┃ ⊱ .save_ (Save context content)
_┃ ⊱ .tostatus_ (Route media files directly to status updates)
_┃ ⊱ .presence_ [status] (Composing, Recording, Online settings)
_┃ ⊱ .autotyping_ [on/off] (Fake typing status)
_┃ ⊱ .autorecording_ [on/off] (Fake voice recording status)
_┃ ⊱ .alwaysonline_ [on/off] (Maintain online status)
_┃ ⊱ .autoread_ [on/off] (Auto blue-tick incoming messages)
_┃ ⊱ .antidelete_ [on/off] (Log deleted messages in real-time)
_┃ ⊱ .antiviewonce_ [on/off] (Decrypt and output View-Once media)
_┃ ⊱ .antibug_ [on/off] (Filter large crash character strings)`;
            } 
            
            else if (buttonId === 'menu_download') {
                responseText = 
`📥 *HIGH-SPEED MULTI-PLATFORM DOWNLOADERS*

_┃ ⊱ .play_ [query] (Fetch audio from YouTube)
_┃ ⊱ .ytmp3_ [url] (Convert and download YouTube Audio)
_┃ ⊱ .ytmp4_ [url] (Convert and download YouTube Video)
_┃ ⊱ .song_ [title] (Fetch high-quality audio files)
_┃ ⊱ .video_ [title] (Fetch high-quality video files)
_┃ ⊱ .fb_ [url] (Download Facebook videos)
_┃ ⊱ .tt_ [url] (Download TikTok media without watermarks)
_┃ ⊱ .mediafire_ [url] (Export direct mediafire file links)
_┃ ⊱ .apk_ [name] (Download Android app installer packages)
_┃ ⊱ .shazam_ (Analyze audio to identify tracks)
_┃ ⊱ .lyrics_ [song] (Fetch synchronized track text)
_┃ ⊱ .gdrive_ [url] (Fetch file resources directly from Google Drive)
_┃ ⊱ .pinterest_ [query] (Download pinterest image collections)`;
            } 
            
            else if (buttonId === 'menu_fun') {
                responseText = 
`🎭 *FUN & ROLEPLAY UTILITIES*

_┃ ⊱ .bankai_ (Execute Bankai animation monologues)
_┃ ⊱ .dom-exp_ (Unfold domain expansion templates)
_┃ ⊱ .wyr_ (Play 'Would You Rather' cards)
_┃ ⊱ .joke_ (Get funny randomized jokes)
_┃ ⊱ .roast_ / .insult (Apply conversational roasts)
_┃ ⊱ .ship_ / .wed (Calculate relationship ship meters)
_┃ ⊱ .propose_ / .askout (Trigger interactive roleplay actions)
_┃ ⊱ .hollow-purple_ (Launch Satoru Gojo's ultimate monologue)
_┃ ⊱ .hack_ (Run fake terminal device infiltration displays)
_┃ ⊱ .slap_ / .kill_ / .kiss_ / .hug_ / .punch_ (Express action GIFs)`;
            } 
            
            else if (buttonId === 'menu_owner') {
                responseText = 
`👑 *OWNER & DEV UTILITY CONTROLS*

_┃ ⊱ .diagnose_ (Execute deep system component checks)
_┃ ⊱ .update_ (Pull latest changes from GitHub repositories)
_┃ ⊱ .mode_ [public/private] (Adjust global bot response access)
_┃ ⊱ .setsudo_ [mention] / .delsudo (Assign/revoke system sudo access)
_┃ ⊱ .addowner_ [mention] / .delowner (Assign/revoke system owner access)
_┃ ⊱ .restart_ (Safely reload node system processes)
_┃ ⊱ .shutdown_ (Kill current active daemon processes)
_┃ ⊱ .ban_ / .unban (Block/unblock JIDs from command system)
_┃ ⊱ .setvar_ [key=val] (Hot-reload system environment variables)
_┃ ⊱ .settings_ (Manage overall modular bot behavior panels)`;
            } 
            
            else if (buttonId === 'menu_utilities') {
                responseText = 
`🛠️ *CONVERTERS & UTILITY COMMANDS*

_┃ ⊱ .ping_ / .ping2_ (Test latency response speed in real-time)
_┃ ⊱ .alive_ (View current bot execution structures)
_┃ ⊱ .delete_ (Instantly delete targeted bot replies)
_┃ ⊱ .tdelete_ [duration] (Delete replies with custom delays)
_┃ ⊱ .sticker_ / .crop_ (Convert images/videos into WhatsApp stickers)
_┃ ⊱ .take_ (Steal/modify custom sticker pack attributes)
_┃ ⊱ .tovv_ (Convert images/videos into View-Once messages)
_┃ ⊱ .tourl_ (Generate permanent web host URLs from local files)
_┃ ⊱ .kamui_ (Instantly capture and decrypt View-Once media payloads)
_┃ ⊱ .addnote_ / .getnote_ / .delnote (Local secure notes manager)
_┃ ⊱ .toimg_ / .tomp3_ / .tomp4_ (Convert media formats in-chat)
_┃ ⊱ .ocr_ (Extract readable text strings from images in-chat)
_┃ ⊱ .qr_ / .readqr_ (Generate and read active QR codes)`;
            }

            if (responseText) {
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            }
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'menu') {
        aliases.push({ ...cmd, name: 'list' });
    }
    if (cmd.name === 'menu2') {
        aliases.push({ ...cmd, name: 'list2' });
    }
});
module.exports.push(...aliases);