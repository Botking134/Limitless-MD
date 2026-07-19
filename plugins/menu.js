// plugins/menu.js
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
// Cleaned up to begin directly with the commands list
const menuText =
`_❖ ── [ AI & CHATBOT ] ── ❖_
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

_❖ ── [ GAMES ] ── ❖_
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

_❖ ── [ GROUP MGT ] ── ❖_
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
_┃ ⊱ kik_
_┃ ⊱ punch_
_┃ ⊱ hifive_
_┃ ⊱ bite_
_┃ ⊱ poke_
_┃ ⊱ dap_
_┃ ⊱ dance_
_┃ ⊱ aura_
_┃ ⊱ lol_

_❖ ── [ OWNER ] ── ❖_
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
_┃ ⊱ currency_
`;

// ─── RENDER TEXT MENU ───────────────────────────────────────────────
async function renderMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());
    const readMore = String.fromCharCode(8206).repeat(4001);
    const randomImage = menuImages[Math.floor(Math.random() * menuImages.length)];

    const menuTextCompiled =
`┌───────────┐
│ 𝐋𝐢𝐦𝐢𝐭𝐥𝐞𝐬𝐬-𝐌𝐃 │
└───────────┘
_𝐎𝐰𝐧𝐞𝐫: ${config.ownerName}_
_𝐔𝐬𝐞𝐫: ${msg.pushName || 'User'}_
_𝐔𝐩𝐭𝐢𝐦𝐞: ${uptime}_
_𝐕𝐞𝐫𝐬𝐢𝐨𝐧: 1.0.0_
════════════════════

┌─────────────────────┐
│ _Throughout Heaven And Earth_ 
│ _I alone am the Honoured one_
└─────────────────────┘
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
`┌─────────────┐
│ *Limitless-MD*
└─────────────┘
_Owner: ${config.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
════════════════════════
_Throughout Heaven And Earth_
┌───────────────────────┐
│ *I alone am the Honoured one* 
└───────────────────────┘

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

    // 5. Interactive Button Interceptor (Prefixless & Self-Healing Fallback)
    {
        name: 'menu_button_handler',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const raw = getRawMessage(msg.message);
            const incomingText = raw?.conversation || raw?.extendedTextMessage?.text || '';

            let buttonId = '';

            // 1. Attempt to extract the standard native flow button ID
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

            // 2. BULLETPROOF FALLBACK: Parse the quoted card context if raw parameters are omitted by the client
            if (!buttonId && incomingText.toLowerCase().includes('explore commands')) {
                const quotedMsg = raw?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quotedMsg) {
                    const rawQuoted = getRawMessage(quotedMsg);
                    const quotedText = (
                        rawQuoted?.conversation || 
                        rawQuoted?.extendedTextMessage?.text || 
                        rawQuoted?.imageMessage?.caption || 
                        rawQuoted?.interactiveMessage?.body?.text ||
                        rawQuoted?.buttonsMessage?.contentText ||
                        ''
                    ).toUpperCase();

                    if (quotedText.includes('AI & CHATBOT')) buttonId = 'menu_ai';
                    else if (quotedText.includes('INTERACTIVE GAMES') || quotedText.includes('GAMES')) buttonId = 'menu_games';
                    else if (quotedText.includes('GROUP MANAGEMENT') || quotedText.includes('GROUP')) buttonId = 'menu_group';
                    else if (quotedText.includes('TOOLS')) buttonId = 'menu_tools';
                    else if (quotedText.includes('DOWNLOADER')) buttonId = 'menu_download';
                    else if (quotedText.includes('FUN & ROLEPLAY') || quotedText.includes('FUN')) buttonId = 'menu_fun';
                    else if (quotedText.includes('OWNER & DEV') || quotedText.includes('OWNER')) buttonId = 'menu_owner';
                    else if (quotedText.includes('UTILITIES')) buttonId = 'menu_utilities';
                }
            }

            if (!buttonId || !buttonId.startsWith('menu_')) return;

            let responseText = "";

            if (buttonId === 'menu_ai') {
                responseText = 
`┌──────────────┐
│ 🧠 AI & CHATBOT  
└──────────────┘

_❖ ─ [ ENGINES ] ─ ❖_

_┃ ⊱ .ai_
_┃ ⊱ .groq_
_┃ ⊱ .gojo_
_┃ ⊱ .debug_
_┃ ⊱ .summon_
_┃ ⊱ .read_
_┃ ⊱ .imagine_
_┃ ⊱ .lizzy_
_┃ ⊱ .chatbot_
_┃ ⊱ .say_

════════════════════════
_Tap another category card to explore more features._`;
            } 
            
            else if (buttonId === 'menu_games') {
                responseText = 
`┌────────┐
│ 🎮 GAMES  
└────────┘

_❖ ─ [ LOBBY & PUZZLES ] ─ ❖_

_┃ ⊱ .games_
_┃ ⊱ .ttt_
_┃ ⊱ .rps_
_┃ ⊱ .guess_
_┃ ⊱ .vault8_
_┃ ⊱ .trivia_
_┃ ⊱ .quiz_
_┃ ⊱ .charade_
_┃ ⊱ .anagram_
_┃ ⊱ .wcg_
_┃ ⊱ .millionaire_
_┃ ⊱ .torf_
_┃ ⊱ .pvp_
_┃ ⊱ .escape_

════════════════════════
_Tap another category card to explore more features._`;
            } 
            
            else if (buttonId === 'menu_group') {
                responseText = 
`┌─────────┐
│ 🔥 GROUP  
└─────────┘

_❖ ─ [ MANAGEMENT ] ─ ❖_

_┃ ⊱ .mute_
_┃ ⊱ .unmute_
_┃ ⊱ .open_
_┃ ⊱ .close_
_┃ ⊱ .lock_
_┃ ⊱ .unlock_
_┃ ⊱ .kick_
_┃ ⊱ .promote_
_┃ ⊱ .demote_
_┃ ⊱ .tagall_
_┃ ⊱ .tag_
_┃ ⊱ .link_
_┃ ⊱ .invite_
_┃ ⊱ .gclink_
_┃ ⊱ .antilink_
_┃ ⊱ .admins_
_┃ ⊱ .antitag_
_┃ ⊱ .antibot_
_┃ ⊱ .warn_
_┃ ⊱ .togcstatus_
_┃ ⊱ .getgpp_
_┃ ⊱ .setgpp_
_┃ ⊱ .welcome_
_┃ ⊱ .goodbye_
_┃ ⊱ .delwelcome_
_┃ ⊱ .delgoodbye_
_┃ ⊱ .poll_
_┃ ⊱ .antigm_
_┃ ⊱ .gclog_
_┃ ⊱ .creategc_
_┃ ⊱ .kickall_
_┃ ⊱ .stopkickall_
_┃ ⊱ .tkick_
_┃ ⊱ .gcjid_
_┃ ⊱ .antispam_
_┃ ⊱ .silence_
_┃ ⊱ .gcalerts_
_┃ ⊱ .antigcstatus_
_┃ ⊱ .spamtag_
_┃ ⊱ .antipromote_
_┃ ⊱ .antidemote_

════════════════════════
_Tap another category card to explore more features._`;
            } 
            
            else if (buttonId === 'menu_tools') {
                responseText = 
`┌────────┐
│ ⚙️ TOOLS  
└────────┘

_❖ ─ [ PRESENCE & REGISTRY ] ─ ❖_

_┃ ⊱ .track_
_┃ ⊱ .getpp_
_┃ ⊱ .setname_
_┃ ⊱ .save_
_┃ ⊱ .tostatus_
_┃ ⊱ .fw_
_┃ ⊱ .presence_
_┃ ⊱ .autotyping_
_┃ ⊱ .autorecording_
_┃ ⊱ .alwaysonline_
_┃ ⊱ .autoread_
_┃ ⊱ .antidelete_
_┃ ⊱ .antiviewonce_
_┃ ⊱ .antibug_
_┃ ⊱ .clear_
_┃ ⊱ .archive_
_┃ ⊱ .unarchive_
_┃ ⊱ .autoviewstatus_
_┃ ⊱ .statusemoji_
_┃ ⊱ .autoreactstatus_
_┃ ⊱ .block_
_┃ ⊱ .unblock_
_┃ ⊱ .aza_
_┃ ⊱ .time_
_┃ ⊱ .weather_
_┃ ⊱ .device_
_┃ ⊱ .ss_
_┃ ⊱ .calc_
_┃ ⊱ .trt_
_┃ ⊱ .translate_
_┃ ⊱ .spam_

════════════════════════
_Tap another category card to explore more features._`;
            } 
            
            else if (buttonId === 'menu_download') {
                responseText = 
`┌───────────┐
│ 📥  DOWNLOAD  
└───────────┘

_❖ ─ [ MEDIA SERVICES ] ─ ❖_

_┃ ⊱ .play_
_┃ ⊱ .ytmp3_
_┃ ⊱ .ytmp4_
_┃ ⊱ .yt_
_┃ ⊱ .tt2_
_┃ ⊱ .img_
_┃ ⊱ .song_
_┃ ⊱ .video_
_┃ ⊱ .fb_
_┃ ⊱ .tt_
_┃ ⊱ .mediafire_
_┃ ⊱ .apk_
_┃ ⊱ .apksearch_
_┃ ⊱ .shazam_
_┃ ⊱ .lyrics_
_┃ ⊱ .gdrive_
_┃ ⊱ .gitclone_
_┃ ⊱ .pinterest_
_┃ ⊱ .subtitle_
_┃ ⊱ .ytmp3doc_
_┃ ⊱ .playdoc_
_┃ ⊱ .spotify_
_┃ ⊱ .spotify2_
_┃ ⊱ .web_
_┃ ⊱ .x2_
_┃ ⊱ .pdf_
_┃ ⊱ .tgs_
_┃ ⊱ .ig_

════════════════════════
_Tap another category card to explore more features._`;
            } 
            
            else if (buttonId === 'menu_fun') {
                responseText = 
`┌──────────┐
│ 🎭 FUN & RP  
└──────────┘

_❖ ─ [ MONOLOGUES & ACTIONS ] ─ ❖_

_┃ ⊱ .bankai_
_┃ ⊱ .dom-exp_
_┃ ⊱ .wyr_
_┃ ⊱ .joke_
_┃ ⊱ .insult_
_┃ ⊱ .roast_
_┃ ⊱ .ship_
_┃ ⊱ .wed_
_┃ ⊱ .propose_
_┃ ⊱ .askout_
_┃ ⊱ .hollow-purple_
_┃ ⊱ .hack_
_┃ ⊱ .arrest_
_┃ ⊱ .liedetector_
_┃ ⊱ .rizz_
_┃ ⊱ .speech_
_┃ ⊱ .slap_
_┃ ⊱ .kill_
_┃ ⊱ .kiss_
_┃ ⊱ .hug_
_┃ ⊱ .kik_
_┃ ⊱ .punch_
_┃ ⊱ .hifive_
_┃ ⊱ .bite_
_┃ ⊱ .poke_
_┃ ⊱ .dap_
_┃ ⊱ .dance_
_┃ ⊱ .aura_
_┃ ⊱ .lol_

════════════════════════
_Tap another category card to explore more features._`;
            } 
            
            else if (buttonId === 'menu_owner') {
                responseText = 
`┌─────────────┐
│ 👑 OWNER & DEV  
└─────────────┘

_❖ ─ [ PARAMETERS & PANELS ] ─ ❖_

_┃ ⊱ .diagnose_
_┃ ⊱ .update_
_┃ ⊱ .mode_
_┃ ⊱ .setsudo_
_┃ ⊱ .delsudo_
_┃ ⊱ .addowner_
_┃ ⊱ .delowner_
_┃ ⊱ .restart_
_┃ ⊱ .shutdown_
_┃ ⊱ .ban_
_┃ ⊱ .unban_
_┃ ⊱ .afk_
_┃ ⊱ .setvar_
_┃ ⊱ .settings_
_┃ ⊱ .antipm_
_┃ ⊱ .reminder_
_┃ ⊱ .remind_
_┃ ⊱ .games_closeall_
_┃ ⊱ .owner_

════════════════════════
_Tap another category card to explore more features._`;
            } 
            
            else if (buttonId === 'menu_utilities') {
                responseText = 
`┌───────────┐
│ 🛠️ UTILITIES  
└───────────┘

_❖ ─ [ CONVERTERS & METRICS ] ─ ❖_

_┃ ⊱ .ping_
_┃ ⊱ .ping2_
_┃ ⊱ .alive_
_┃ ⊱ .delete_
_┃ ⊱ .tdelete_
_┃ ⊱ .autoreact_
_┃ ⊱ .speed_
_┃ ⊱ .vv_
_┃ ⊱ .sticker_
_┃ ⊱ .crop_
_┃ ⊱ .take_
_┃ ⊱ .setcmd_
_┃ ⊱ .delcmd_
_┃ ⊱ .tovv_
_┃ ⊱ .tourl_
_┃ ⊱ .kamui_
_┃ ⊱ .emix_
_┃ ⊱ .smeme_
_┃ ⊱ .addnote_
_┃ ⊱ .delnote_
_┃ ⊱ .getnotes_
_┃ ⊱ .getnote_
_┃ ⊱ .toimg_
_┃ ⊱ .tomp3_
_┃ ⊱ .tomp4_
_┃ ⊱ .binary_
_┃ ⊱ .ocr_
_┃ ⊱ .qr_
_┃ ⊱ .readqr_
_┃ ⊱ .qty_
_┃ ⊱ .currency_

════════════════════════
_Tap another category card to explore more features._`;
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