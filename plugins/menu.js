const config = require('../config');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { saveState, normalizeToJid, getPhoneJid } = require('../stateManager');
const commands = require('../commands');

// ─── NOTES PATH ──────────────────────────────────────────────────
const notesPath = path.join(__dirname, '../storage/notes.json');

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

// ─── HELPERS ──────────────────────────────────────────────────────

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

function parseDuration(str) {
    const match = str.match(/^(\d+)([smh])$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return null;
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

// Container-Safe Groq request handler
async function queryGroq(messages, model = "llama-3.3-70b-versatile") {
    const apiKey = config.groqApiKey;
    
    if (!apiKey) {
        console.error("[GROQ] API key is missing. Please define 'groqApiKey' in your config file.");
        return "Tch, looks like my connection details are missing.";
    }
    
    const response = await axios.post(GROQ_BASE_URL, {
        model,
        messages,
        temperature: 0.7
    }, {
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        }
    });
    return response.data.choices?.[0]?.message?.content || "";
}

// Robust JID, LID, Mention, and Reply Matcher for Gojo
function isBotAddressed(sock, msg) {
    const rawIncoming = getRawMessage(msg.message);
    const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                        rawIncoming?.imageMessage?.contextInfo ||
                        rawIncoming?.videoMessage?.contextInfo ||
                        rawIncoming?.contextInfo ||
                        msg.message?.contextInfo;

    const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : (config.botLid || '');

    const cleanBotJid = botJid ? botJid.split('@')[0] : '';
    const cleanBotLid = botLid ? botLid.split('@')[0] : '';

    // Check replies
    const quotedParticipant = contextInfo?.participant ? normalizeToJid(contextInfo.participant) : '';
    if (quotedParticipant) {
        const cleanQuoted = quotedParticipant.split('@')[0];
        if (quotedParticipant === botJid || quotedParticipant === botLid || cleanQuoted === cleanBotJid || cleanQuoted === cleanBotLid) {
            return true;
        }
    }

    // Check mention metadata array
    const mentions = contextInfo?.mentionedJid || [];
    const normalizedMentions = mentions.map(m => normalizeToJid(m));
    if (normalizedMentions.includes(botJid) || (botLid && normalizedMentions.includes(botLid))) {
        return true;
    }

    // Check text-based mentions
    const body = rawIncoming?.conversation || rawIncoming?.extendedTextMessage?.text || rawIncoming?.imageMessage?.caption || rawIncoming?.videoMessage?.caption || '';
    const lowerMessage = body.toLowerCase();
    if (cleanBotJid && lowerMessage.includes(`@${cleanBotJid}`)) return true;
    if (cleanBotLid && lowerMessage.includes(`@${cleanBotLid}`)) return true;

    return false;
}

async function handleNaturalDelay(sock, jid, responseText, presenceType = 'composing') {
    await sock.sendPresenceUpdate(presenceType, jid);
    const wordCount = responseText.split(/\s+/).length;
    let delayMs = 3000;

    if (wordCount > 100) {
        delayMs = 6000;
    }
    await delay(delayMs);
}

// ─── NOTE SESSION HANDLER (also used by tools/addnote) ────────
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

// ─── MENU IMAGES ──────────────────────────────────────────────────────
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

// ─── HELPER: FETCH IMAGE BUFFER ──
async function fetchImageBuffer(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return Buffer.from(response.data);
    } catch (e) {
        console.error(`[MENU] Failed to fetch image: ${url}`, e.message);
        return null;
    }
}

// ─── HELPER: CREATE CAROUSEL CARD ──────────────────────────────────
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
            { text: "▰▱▱▱▱▱▱▱▱▱ Channelling Cursed Energy...", delay: 1000 },
            { text: "▰▰▰▱▱▱▱▱▱▱ Six Eyes Activating...", delay: 1000 },
            { text: "▰▰▰▰▰▱▱▱▱▱ Infinite Void Opening...", delay: 1000 },
            { text: "▰▰▰▰▰▰▰▰▰▰ Domain Expansion: Complete! 🌌", delay: 1500 }
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

// ─── EXPORT COMMANDS ──────────────────────────────────────────────

module.exports = [
    // 1. GOJO (prefixless - On by default, togglable, connected to .asst, with smart execution layers)
    {
        name: 'gojo',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, senderNumber }) => {
            const jid = msg.key.remoteJid;
            const cleanArgs = args || '';

            // Bypass if it's a prefixed command
            if (cleanArgs.startsWith(config.prefix)) return;

            const cleanQuery = cleanArgs.toLowerCase().startsWith('gojo ') ? cleanArgs.slice(5).trim() : cleanArgs.trim();

            const isAuthorized = isOwner || isSudo || isDev;
            const action = cleanQuery.toLowerCase();

            if (isAuthorized && (action === 'rise' || action === 'sleep')) {
                if (action === 'sleep') {
                    config.gojoGlobalSleep = true;
                    await sock.sendMessage(jid, { text: "😴 *Satoru Gojo is now asleep globally.* (Prefixless triggers disabled bot-wide)" }, { quoted: msg });
                } else if (action === 'rise') {
                    config.gojoGlobalSleep = false;
                    await sock.sendMessage(jid, { text: "👁️ *Satoru Gojo has risen!* (Prefixless triggers activated bot-wide)" }, { quoted: msg });
                }
                saveState();
                return;
            }

            // Gojo is awake by default (unless global sleep configuration is explicitly true)
            if (config.gojoGlobalSleep === true) {
                return;
            }

            // Trigger if directly addressed, mentioned, replied to, or contains his name anywhere in the sentence
            const isAddressed = isBotAddressed(sock, msg) || /\bgojo\b/i.test(cleanArgs);
            if (!isAddressed) return;

            if (!cleanQuery) {
                return await sock.sendMessage(jid, {
                    text: isDev
                        ? "Yo, Master Isaac! You called? What does the creator of Limitless need today? 😏"
                        : (isOwner ? `Yo! What's up, ${config.ownerName}? You need my help? 😏` : "Yo! What's on your mind? 😏")
                }, { quoted: msg });
            }

            try {
                let gojoSystemPrompt =
                    "You are Satoru Gojo, the strongest Jujutsu Sorcerer. " +
                    "Your personality is extremely conversational, playful, lazy, informal, and a massive tease. " +
                    "Frequently refer to yourself as 'the strongest'. Mention your 'Six Eyes' or 'Infinity' naturally. " +
                    "Do NOT repeat greetings. Respond with organic variety. Your reply length must depend on the complexity of the query.\n\n" +
                    "You reside in 'Limitless-MD', a WhatsApp bot. You have the authorization to trigger administrative, conversion, and utility commands on behalf of users by parsing their natural language intent. " +
                    "When a user asks you to perform a task, check if it matches any capability in your command list. Respond normally in-character, but you MUST append a command execution tag at the very end of your response: [CMD: .commandName arguments]\n\n" +
                    "COMMAND TRIGGER DICTIONARY:\n" +
                    "- Show menu / list commands / drop menu: Append '[CMD: .menu]' or '[CMD: .menu2]'\n" +
                    "- Delete a message (reply context): Append '[CMD: .delete]'\n" +
                    "- Delete a message with delay (e.g. 'delete this in 10s', 'delete in 5m'): Append '[CMD: .tdelete duration]' (e.g. [CMD: .tdelete 10s])\n" +
                    "- Convert image/video/gif to sticker: Append '[CMD: .sticker]'\n" +
                    "- Convert sticker to image: Append '[CMD: .toimg]'\n" +
                    "- Convert video/audio to audio/mp3: Append '[CMD: .tomp3]'\n" +
                    "- Convert sticker/gif to video/mp4: Append '[CMD: .tomp4]'\n" +
                    "- Lock/close group: Append '[CMD: .close]'\n" +
                    "- Unlock/open group: Append '[CMD: .open]'\n" +
                    "- Mute chat: Append '[CMD: .mute]'\n\n" +
                    "Here is your command directory:\n" +
                    menuText;

                if (isDev) {
                    gojoSystemPrompt += ` You are speaking directly to your developer, Master Isaac. Address him playfully as 'Master Isaac' or 'Master' with your usual playful, teasing attitude, treating him like a dear friend who created your universe.`;
                } else if (isOwner) {
                    gojoSystemPrompt += ` You are speaking directly to your owner. Address him playfully as '${config.ownerName}' with your usual cocky, teasing attitude, but never refer to him as Master, Infinity, or Isaac.`;
                } else if (isSudo) {
                    gojoSystemPrompt += ` You are speaking directly to a Sudo user. Address him as 'dude'. Never refer to him as Master, Infinity, or Isaac.`;
                }

                global.aiMemory = global.aiMemory || {};
                global.aiMemory[jid] = global.aiMemory[jid] || {};
                global.aiMemory[jid].gojo = global.aiMemory[jid].gojo || [];

                // Append a strict rule reminder to the tail of the current user message
                // This ensures the instruction is the last thing evaluated by the model, greatly improving adherence.
                const ruleReminder = "\n\n(IMPORTANT FORMAT RULE: If I asked you to do something that matches a command like showing the menu, deleting a message, or converting something, you MUST append the exact execution tag at the absolute end of your response, e.g. '[CMD: .menu]' or '[CMD: .sticker]'. If I am only chatting, do not append any tags.)";
                const activeQuery = cleanQuery + ruleReminder;

                const messages = [
                    { role: "system", content: gojoSystemPrompt },
                    ...global.aiMemory[jid].gojo,
                    { role: "user", content: activeQuery }
                ];

                await sock.sendPresenceUpdate('composing', jid);

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                // Save only clean query to memory to avoid feedback loops
                global.aiMemory[jid].gojo.push({ role: "user", content: cleanQuery });
                global.aiMemory[jid].gojo.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].gojo.length > 50) {
                    global.aiMemory[jid].gojo.shift();
                }

                // Parser layer for the Dynamic Command Triggering tag
                const cmdRegex = /\[CMD:\s*(\.[a-zA-Z0-9_-]+.*?)\s*\]/;
                const match = responseText.match(cmdRegex);
                let cleanResponse = responseText;
                let extractedCmd = null;

                if (match) {
                    extractedCmd = match[1].trim();
                    cleanResponse = responseText.replace(cmdRegex, '').trim();
                }

                await handleNaturalDelay(sock, jid, cleanResponse, 'composing');

                const sent = await sock.sendMessage(jid, { text: cleanResponse }, { quoted: msg });
                if (sent?.key?.id) {
                    global.botMessageAgents = global.botMessageAgents || {};
                    global.botMessageAgents[sent.key.id] = 'gojo';
                }

                // Background Executive Command Execution Handler
                if (extractedCmd) {
                    console.log(`[GOJO EXECUTION] Extracted command intent: "${extractedCmd}"`);
                    try {
                        const parts = extractedCmd.split(' ');
                        const cmdName = parts[0]; 
                        const cmdArgs = parts.slice(1).join(' '); 
                        const cleanCmdName = cmdName.startsWith('.') ? cmdName.slice(1) : cmdName;

                        let commandFunction;
                        if (Array.isArray(commands)) {
                            const targetCmd = commands.find(c => c.name === cleanCmdName);
                            if (targetCmd) commandFunction = targetCmd.execute;
                        } else if (typeof commands === 'object' && commands !== null) {
                            const found = commands[cleanCmdName] || commands[cmdName];
                            if (found) {
                                commandFunction = typeof found === 'function' ? found : found.execute;
                            }
                        }

                        if (commandFunction) {
                            console.log(`[GOJO EXECUTION] Calling command "${cleanCmdName}" with arguments: "${cmdArgs}"`);
                            await commandFunction(sock, msg, cmdArgs, { isOwner, isSudo, isDev, senderNumber });
                        } else {
                            console.warn(`[GOJO EXECUTION] Command handler for "${cleanCmdName}" was not found.`);
                        }
                    } catch (cmdErr) {
                        console.error("❌ Gojo dynamic execution failed:", cmdErr.message);
                    }
                }

            } catch (error) {
                await sock.sendMessage(jid, { text: "Tch, looks like something interfered with my Infinity." }, { quoted: msg });
            }
        }
    },

    // 2. .menu (Text Menu – No GIF, 7 Audio Files)
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

    // 3. .list alias for .menu
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

    // 4. .menu2 (Carousel – Loading Animation Only, No Audio)
    {
        name: 'menu2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderCarouselMenu(sock, msg);
        }
    },

    // 5. .list2 alias for .menu2
    {
        name: 'list2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await renderCarouselMenu(sock, msg);
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'delete') {
        aliases.push({ ...cmd, name: 'del' });
        aliases.push({ ...cmd, name: 'dlt' });
    }
    if (cmd.name === 'tdelete') {
        aliases.push({ ...cmd, name: 'tdel' });
        aliases.push({ ...cmd, name: 'tdlt' });
    }
});
module.exports.push(...aliases);