// plugins/menu.js
const settings = require('../settings');
const path = require('path');

// Helper function to format system uptime
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

// Satoru Gojo Menu Graphics list
const menuImages = [
    "https://iili.io/CFIJoDg.jpg",
    "https://iili.io/CFIJfUB.jpg",
    "https://iili.io/CFIJnOF.jpg",
    "https://iili.io/CFIJBHP.jpg",
    "https://iili.io/CFIJTiv.jpg",
    "https://iili.io/CFIJRlp.jpg",
    "https://iili.io/CFIJYJI.jpg",
    "https://iili.io/CFIJlbn.jpg",
    "https://iili.io/CFIJ1xs.jpg"
];

// Helper to compile a WhatsApp Carousel card with media attachments
async function createCard(sock, title, description, imageUrl, commandId, buttonText) {
    const { prepareWAMessageMedia } = await import('@itsliaaa/baileys');
    
    const media = await prepareWAMessageMedia(
        { image: { url: imageUrl } }, 
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

// Render Standard Text Menu
async function renderMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());
    const readMore = String.fromCharCode(8206).repeat(4001);
    const randomImage = menuImages[Math.floor(Math.random() * menuImages.length)];

    const menuText = 
`┌──────────────────┐
│   *Limitless-MD*   │
└──────────────────┘
_Owner: ${settings.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
════════════════════════════════
_Throughout Heaven And Earth 🌏_
┌──────────────────────────────┐
│ _I alone am the Honoured one_ │
└──────────────────────────────┘
${readMore}
_❖ ── [ AI & CHATBOT ] ── ❖_
_║ ⊱ ai_
_║ ⊱ groq_
_║ ⊱ gojo_ (rise/sleep)
_║ ⊱ debug_
_║ ⊱ summon_
_║ ⊱ read_
_║ ⊱ imagine_
_║ ⊱ lizzy_
_║ ⊱ chatbot_
_║ ⊱ say_

_❖ ── [ INTERACTIVE GAMES ] ── ❖_
_║ ⊱ games_ (Unified Lobby)
_║ ⊱ ttt_
_║ ⊱ rps_
_║ ⊱ guess_
_║ ⊱ vault8_
_║ ⊱ trivia_
_║ ⊱ quiz_
_║ ⊱ charade_ / .sharade
_║ ⊱ anagram_
_║ ⊱ wcg_
_║ ⊱ millionaire_
_║ ⊱ torf_
_║ ⊱ pvp_
_║ ⊱ escape_

_❖ ── [ GROUP MANAGEMENT ] ── ❖_
_║ ⊱ mute_
_║ ⊱ unmute_
_║ ⊱ open_
_║ ⊱ close_
_║ ⊱ lock_
_║ ⊱ unlock_
_║ ⊱ kick_
_║ ⊱ promote_
_║ ⊱ demote_
_║ ⊱ tagall_
_║ ⊱ tag_
_║ ⊱ link_
_║ ⊱ invite_
_║ ⊱ gclink_
_║ ⊱ antilink_
_║ ⊱ admins_
_║ ⊱ antitag_
_║ ⊱ antibot_
_║ ⊱ warn_
_║ ⊱ togcstatus_
_║ ⊱ getgpp_
_║ ⊱ setpp_
_║ ⊱ welcome_
_║ ⊱ goodbye_
_║ ⊱ delwelcome_
_║ ⊱ delgoodbye_
_║ ⊱ poll_
_║ ⊱ antigm_
_║ ⊱ gclog_
_║ ⊱ creategc_
_║ ⊱ kickall_
_║ ⊱ stopkickall_
_║ ⊱ tkick_
_║ ⊱ gcjid_
_║ ⊱ antispam_
_║ ⊱ silence_
_║ ⊱ gcalerts_
_║ ⊱ antigcstatus_
_║ ⊱ spamtag_
_║ ⊱ antipromote_
_║ ⊱ antidemote_

_❖ ── [ TOOLS ] ── ❖_
_║ ⊱ track_
_║ ⊱ getpp_
_║ ⊱ setname_
_║ ⊱ save_
_║ ⊱ tostatus_
_║ ⊱ fw_
_║ ⊱ presence_
_║ ⊱ autotyping_
_║ ⊱ autorecording_
_║ ⊱ alwaysonline_
_║ ⊱ autoread_
_║ ⊱ antidelete_
_║ ⊱ antidelete_log_
_║ ⊱ antiviewonce_
_║ ⊱ antibug_
_║ ⊱ clear_
_║ ⊱ archive_
_║ ⊱ unarchive_
_║ ⊱ autoviewstatus_ / .autovs
_║ ⊱ statusemoji_
_║ ⊱ autoreactstatus_ / .autors
_║ ⊱ block_
_║ ⊱ unblock_
_║ ⊱ aza_
_║ ⊱ time_
_║ ⊱ weather_ (AI Search)
_║ ⊱ device_
_║ ⊱ ss_
_║ ⊱ calc_
_║ ⊱ trt_ (AI dependent)
_║ ⊱ translate_
_║ ⊱ spam_
_║ ⊱ livescore_ / .live (AI Search)
_║ ⊱ score_ (AI Search)

_❖ ── [ DOWNLOADER ] ── ❖_
_║ ⊱ play_
_║ ⊱ ytmp3_
_║ ⊱ ytmp4_
_║ ⊱ yt_
_║ ⊱ tt2_
_║ ⊱ img_
_║ ⊱ song_
_║ ⊱ video_
_║ ⊱ fb_
_║ ⊱ tt_
_║ ⊱ mediafire_
_║ ⊱ apk_
_║ ⊱ apksearch_
_║ ⊱ shazam_
_║ ⊱ lyrics_
_║ ⊱ gdrive_
_║ ⊱ gitclone_
_║ ⊱ pinterest_
_║ ⊱ subtitle_
_║ ⊱ ytmp3doc_
_║ ⊱ playdoc_
_║ ⊱ spotify_
_║ ⊱ spotify2_
_║ ⊱ web_
_║ ⊱ x2_

_❖ ── [ FUN & ROLEPLAY ] ── ❖_
_║ ⊱ bankai_
_║ ⊱ dom-exp_
_║ ⊱ wyr_
_║ ⊱ joke_
_║ ⊱ insult_
_║ ⊱ roast_
_║ ⊱ ship_
_║ ⊱ wed_
_║ ⊱ propose_
_║ ⊱ askout_
_║ ⊱ hollow-purple_
_║ ⊱ hack_
_║ ⊱ arrest_
_║ ⊱ liedetector_
_║ ⊱ rizz_
_║ ⊱ speech_
_║ ⊱ slap_
_║ ⊱ kill_
_║ ⊱ kiss_
_║ ⊱ hug_
_║ ⊱ kik_
_║ ⊱ punch_
_║ ⊱ hifive_
_║ ⊱ bite_
_║ ⊱ poke_

_❖ ── [ OWNER & DEV ] ── ❖_
_║ ⊱ diagnose_
_║ ⊱ update_
_║ ⊱ mode_
_║ ⊱ setsudo_
_║ ⊱ delsudo_
_║ ⊱ addowner_
_║ ⊱ delowner_
_║ ⊱ restart_
_║ ⊱ shutdown_
_║ ⊱ ban_
_║ ⊱ unban_
_║ ⊱ adddev_
_║ ⊱ deldev_
_║ ⊱ afk_
_║ ⊱ setvar_
_║ ⊱ settings_
_║ ⊱ antipm_
_║ ⊱ reminder_
_║ ⊱ remind_
_║ ⊱ activegames_

_❖ ── [ UTILITIES ] ── ❖_
_║ ⊱ ping_
_║ ⊱ ping2_
_║ ⊱ alive_
_║ ⊱ delete_
_║ ⊱ tdelete_
_║ ⊱ autoreact_
_║ ⊱ speed_
_║ ⊱ vv_
_║ ⊱ sticker_
_║ ⊱ crop_
_║ ⊱ take_
_║ ⊱ setcmd_
_║ ⊱ delcmd_
_║ ⊱ tovv_
_║ ⊱ tourl_
_║ ⊱ kamui_
_║ ⊱ vvs_
_║ ⊱ emix_ / .emojimix
_║ ⊱ smeme_ / .stickermeme
_║ ⊱ addnote_
_║ ⊱ delnote_
_║ ⊱ getnotes_
_║ ⊱ getnote_`;

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

// Render Interactive Carousel Card Menu
async function renderCarouselMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());

    const headerText = 
`┌──────────────────┐
│   *Limitless-MD*   │
└──────────────────┘
_Owner: ${settings.ownerName}_
_User: ${msg.pushName || 'User'}_
_Uptime: ${uptime}_
_Version: 1.0.0_
════════════════════════════════
_Throughout Heaven And Earth 🌏_
┌──────────────────────────────┐
│ _I alone am the Honoured one_ │
└──────────────────────────────┘\n\n_Swipe through the cards below to explore command categories._ 🔮`;

    try {
        const { generateWAMessageFromContent } = await import('@itsliaaa/baileys');
        await sock.sendMessage(jid, { text: "Channelling Infinity Domain... 🌀" }, { quoted: msg });

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

module.exports = [
    // STANDARD TEXT MENU (.menu / .list)
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

    // CAROUSEL CARD MENU (.menu2 / .list2)
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

    // SUB-MENU DECORATIVE RESPONSE LISTENERS (Silent & Prefixless Native Triggers)
    {
        name: 'menu_ai',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`🧠 *INFINITY CORE: AI & CHATBOTS* 🧠
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}ai <prompt>* — Solves complex queries.
• *${settings.prefix}groq <prompt>* — High-speed dynamic model completions.
• *Gojo <prompt>* — Speak with Satoru Gojo directly (supports 'rise'/'sleep').
• *${settings.prefix}debug <code>* — Auto-diagnoses compile errors & bugs.
• *${settings.prefix}summon <char> <prompt>* — Summons any fictional character.
• *${settings.prefix}read <prompt>* — High-speed Vision image analyzer.
• *${settings.prefix}imagine <prompt>* — Generates premium AI illustrations.
• *${settings.prefix}lizzy <on/off>* — Devoted anime chatbot toggle.
• *${settings.prefix}chatbot <on/off>* — General chat assistance toggle.
• *${settings.prefix}say <text>* — Convert text to custom audio voice note.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_games',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`🎮 *DOMAIN INTERACTIVE GAMES* 🎮
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}games* — Unified Public Game Lobby portal.
• *${settings.prefix}ttt* — Play Tic-Tac-Toe (AI/Multiplayer).
• *${settings.prefix}rps* — Play Rock-Paper-Scissors against Gojo.
• *${settings.prefix}guess* — Guess Gojo's Cursed Energy amount.
• *${settings.prefix}vault8* — Creepy text-RPG terminal simulator.
• *${settings.prefix}trivia* — General knowledge Trivia (Single/Multiplayer).
• *${settings.prefix}quiz <category>* — Categorized dynamic quiz module.
• *${settings.prefix}charade* / *sharade* — Guess the Emoji Phrase.
• *${settings.prefix}anagram* — Scrambled Anagram solver (Single/Multiplayer).
• *${settings.prefix}wcg* — Turn-based Word Chain game lobby.
• *${settings.prefix}millionaire* — Interactive 15-question Millionaire.
• *${settings.prefix}torf* — Dynamic True/False category quiz.
• *${settings.prefix}pvp* — 1v1 turn-based battle with parry countdowns.
• *${settings.prefix}escape* — Procedural Escape Room text adventure.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_group',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`👥 *DOMAIN EXPANSION: GROUP MODS* 👥
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}mute <duration>* — Locks/unlocks group conversation flows.
• *${settings.prefix}kick / .promote / .demote* — User state management.
• *${settings.prefix}tagall / .tag* — Dynamic tags or ghost tags all members.
• *${settings.prefix}link* — Fetches active invitation link.
• *${settings.prefix}antilink <on/off>* — Blocks or warns link spam.
• *${settings.prefix}admins* — Summons all group administrators.
• *${settings.prefix}antitag <on/off>* — Restricts non-admin bot mentions.
• *${settings.prefix}antibot <on/off>* — Auto-deletes or ejects secondary bots.
• *${settings.prefix}warn* — Issues admin warnings (auto-kicks at 5 marks).
• *${settings.prefix}antigm <on/off>* — Discards group status mentions.
• *${settings.prefix}gclog <on/off/check>* — Conversation logger & AI summarizer.
• *${settings.prefix}creategc <name>* — Automatically instantiates a new group.
• *${settings.prefix}kickall* — Exorcises all non-admin targets (Owner Only).
• *${settings.prefix}stopkickall* — Aborts the active exorcism sequence.
• *${settings.prefix}tkick <duration>* — Timed participant ejections.
• *${settings.prefix}gcjid* — Extract group cryptographic JID.
• *${settings.prefix}antispam <on/off/trig>* — Rate-limiting spam shield.
• *${settings.prefix}silence <-s/-m/all>* — Auto-delete chat constraints.
• *${settings.prefix}gcalerts <promote/demote/welcome/goodbye> <on/off>* — Real-time event notifications.
• *${settings.prefix}antigcstatus <warn/delete/kick/off>* — Blocks unapproved status posts.
• *${settings.prefix}spamtag <count> <text>* — Repeatedly tags group members with mentions.
• *${settings.prefix}antipromote <on/off>* — Demotes promoters and targets on unsanctioned promotions.
• *${settings.prefix}antidemote <on/off>* — Instant demotion of unapproved demoters and re-promotion of the victim.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_tools',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`⚙️ *LIMITLESS SPATIAL TOOLS* ⚙️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}track* — Spatial geographical prefix locator (Supports Kenya prefix).
• *${settings.prefix}getpp* — Extracts target user profile picture.
• *${settings.prefix}setname* — Modifies bot display username.
• *${settings.prefix}save* — Saves active status media locally.
• *${settings.prefix}tostatus* — Uploads local media/text to status broadcast.
• *${settings.prefix}fw* — Interactive multi-chat forwarder.
• *${settings.prefix}presence* — Presence dashboards overview.
• *${settings.prefix}autotyping / .autorecording* — Active status simulation.
• *${settings.prefix}alwaysonline / .autoread* — Continuous online state.
• *${settings.prefix}antidelete* — Captures and forwards deleted files.
• *${settings.prefix}antidelete_log* — Configures delete logs destination.
• *${settings.prefix}antiviewonce* — Automated view-once decryptor.
• *${settings.prefix}antibug* — Active flood rate-limit protection.
• *${settings.prefix}clear* — Completely empties server chat logs.
• *${settings.prefix}archive / .unarchive* — Archive states controllers.
• *${settings.prefix}autoviewstatus* / *autovs* — Auto-view status triggers.
• *${settings.prefix}statusemoji* — Custom status reaction emoji.
• *${settings.prefix}autoreactstatus* / *autors* — Auto status reaction triggers.
• *${settings.prefix}block / .unblock* — Native contact blocks.
• *${settings.prefix}aza <set>* — Bank credentials wizard configuration.
• *${settings.prefix}time* — Regional timezone clock calculator.
• *${settings.prefix}weather* — Live weather analytics (Gemini Search-grounded).
• *${settings.prefix}device* — Client hardware OS signature scanner.
• *${settings.prefix}ss <url>* — Render high-speed website screenshot.
• *${settings.prefix}calc <expr>* — Secure mathematical expression evaluator.
• *${settings.prefix}trt <route/text> <lang>* — AI-dependent context translator (Gemini).
• *${settings.prefix}spam <count> <text/reply>* — Repeatedly loops/spams text or media.
• *${settings.prefix}livescore* / *live* — Ongoing matches live scoreboard tracker (Gemini Search-grounded).
• *${settings.prefix}score <teams> <league> <D/M/Y>* — Historical sports past score finder (Gemini Search-grounded).`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_download',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`📥 *CURSED TECHNIQUE: DOWNLOADERS* 📥
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}play <query>* — Song downloader with clean metadata artwork.
• *${settings.prefix}ytmp3 / .ytmp4* — Dual-fallback YouTube downloaders.
• *${settings.prefix}yt <url>* — YouTube v3 multi-format media downloader.
• *${settings.prefix}tt2 <url>* — TikTok v2 watermark-free link downloader.
• *${settings.prefix}img <query> <count>* — Google bulk image downloader.
• *${settings.prefix}song <query>* — Numbered song index selector & downloader.
• *${settings.prefix}video <query>* — YouTube video search downloader (mobile-optimized).
• *${settings.prefix}fb / .facebook* — Facebook HD video downloader.
• *${settings.prefix}tt / .tiktok* — Watermark-free TikTok downloader.
• *${settings.prefix}mediafire* — MediaFire file document downloader.
• *${settings.prefix}apk <query>* — Direct APK application downloader.
• *${settings.prefix}apksearch <query>* — Numbered APK search list downloader.
• *${settings.prefix}shazam* — Identifies quoted audio & offers download.
• *${settings.prefix}lyrics <query>* — Detailed lyrics scraper.
• *${settings.prefix}gdrive* — Google Drive file document downloader.
• *${settings.prefix}gitclone* — GitHub repository master branch zip-cloner.
• *${settings.prefix}pinterest / .pint* — Pinterest video/image downloader.
• *${settings.prefix}subtitle* — Movie English subtitles .srt document downloader.
• *${settings.prefix}ytmp3doc / .ytmp4doc* — YouTube documents downloaders.
• *${settings.prefix}playdoc / .videodoc* — YouTube search document downloaders.
• *${settings.prefix}spotify / .spotify2* — Spotify v1 and v2 music downloaders.
• *${settings.prefix}web* — Website assets zipper and downloader.
• *${settings.prefix}x2 / .xdl2* — Twitter/X video and image downloader.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_fun',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`🎭 *UNLIMITED VOID: FUN & ROLEPLAY* 🎭
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}bankai <name>* — Search character Bankai details.
• *${settings.prefix}dom-exp <name>* — Search JJK Cursed Domain expansion.
• *${settings.prefix}wyr* — Spawn interactive Would You Rather poll.
• *${settings.prefix}joke* — Drop witty dad-jokes or funny giggles.
• *${settings.prefix}insult / .roast* — Expose subject with witty roasts.
• *${settings.prefix}ship <@user>* — Match two members with love compatibility.
• *${settings.prefix}wed <@user>* — Host a priest-styled holy matrimony ceremony.
• *${settings.prefix}propose <@user>* — Drop custom proposal cards with Yes/No locks.
• *${settings.prefix}askout <@user>* — Ask someone out with secure feedback gates.
• *${settings.prefix}hollow-purple* — Channel Satoru Gojo's ultimate technique.
• *${settings.prefix}hack <bank/soft>* — Run interactive terminal hex animations.
• *${settings.prefix}arrest <@user>* — Issue a custom arrest warrant & jail them.
• *${settings.prefix}liedetector <@user>* — Biometric truth/lie scanner.
• *${settings.prefix}rizz* — Drops smooth, infinite pick-up lines.
• *${settings.prefix}speech <char>* — Deliver iconic anime monologues.

*🎭 Anime Interactive Actions:*
• *${settings.prefix}slap, .kill, .kiss, .hug, .kik, .punch, .hifive, .bite, .poke*`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_owner',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`👑 *APEX ADMINISTRATIVE AUTHORITY* 👑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}diagnose* — Active system compile diagnostic check.
• *${settings.prefix}update <setup/yes/force>* — System updates & force-overwriting.
• *${settings.prefix}mode <public/private>* — Bot privacy state.
• *${settings.prefix}setsudo / .delsudo* — Sudo users registers.
• *${settings.prefix}addowner / .delowner* — Secondary owners registers.
• *${settings.prefix}restart / .shutdown* — System processes restart/kill.
• *${settings.prefix}ban / .unban* — Global blacklist controllers.
• *${settings.prefix}adddev / .deldev* — Register/remove core developers.
• *${settings.prefix}afk* — Meditation AFK automated auto-responder.
• *${settings.prefix}setvar* — Dynamic variable configurations editor.
• *${settings.prefix}settings* — Displays active global settings card.
• *${settings.prefix}antipm <on/off>* — Automated PM DM blocker.
• *${settings.prefix}reminder <timer> <note>* — Persistently register custom cron reminders.
• *${settings.prefix}remind* — Access active scheduled reminders board.
• *${settings.prefix}activegames* — Displays active running game sessions.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_utilities',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`🛠️ *SIX EYES UTILITY STACK* 🛠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}ping / .ping2* — Network latency & speed tracking.
• *${settings.prefix}alive* — System uptime & WAT climate dashboard.
• *${settings.prefix}delete / .dlt* — Message deletion tool (LID-Safe).
• *${settings.prefix}tdelete <timer>* — Scheduled delayed deletion.
• *${settings.prefix}autoreact* — Automated message reactions.
• *${settings.prefix}speed* — Interactive execution speed meter.
• *${settings.prefix}vv* — Manual view-once media extractor.
• *${settings.prefix}tovv* — Encrypts media into View Once.
• *${settings.prefix}sticker / .crop* — Sticker creation & cropping (low-kilobyte optimized).
• *${settings.prefix}take / .steal* — Sticker metadata customization.
• *${settings.prefix}setcmd / .delcmd* — Maps commands directly to stickers.
• *${settings.prefix}tourl / .url* — Media file cloud uploaders.
• *${settings.prefix}kamui* — Silent decryption & DM-forwarding View Once.
• *${settings.prefix}vvs <emoji>* — Trigger decryption kamui via specific emojis.
• *${settings.prefix}emix <emoji1>+<emoji2>* — Combine two emojis into a transparent sticker.
• *${settings.prefix}smeme <top> / <bottom>* — Create stroked impact sticker memes.
• *${settings.prefix}addnote <title> | <content>* — Saves a custom sticky note.
• *${settings.prefix}delnote <title>* — Deletes a specific note.
• *${settings.prefix}getnotes* — Lists all notes saved for this chat.
• *${settings.prefix}getnote <title>* — Retrieves the content of a note.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'menu') {
        aliases.push({ ...cmd, name: 'domain' });
    }
});
module.exports.push(...aliases);