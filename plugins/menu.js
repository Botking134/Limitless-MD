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
    
    // Prepare the media attachment natively for the card header
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
_║ ⊱ gojo_
_║ ⊱ debug_
_║ ⊱ summon_
_║ ⊱ read_
_║ ⊱ imagine_
_║ ⊱ lizzy_
_║ ⊱ chatbot_

_❖ ── [ GROUP MANAGEMENT ] ── ❖_
_║ ⊱ gmode_
_║ ⊱ kick_
_║ ⊱ promote_
_║ ⊱ demote_
_║ ⊱ tagall_
_║ ⊱ tag_
_║ ⊱ link_
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

_❖ ── [ TOOLS ] ── ❖_
_║ ⊱ setpp_
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
_║ ⊱ autoviewstatus_
_║ ⊱ statusemoji_
_║ ⊱ autoreactstatus_
_║ ⊱ block_
_║ ⊱ unblock_
_║ ⊱ aza_
_║ ⊱ time_
_║ ⊱ weather_
_║ ⊱ device_
_║ ⊱ livescore_
_║ ⊱ football_

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

_❖ ── [ UTILITIES ] ── ❖_
_║ ⊱ ping_
_║ ⊱ ping2_
_║ ⊱ alive_
_║ ⊱ delete_
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
            // Buffer the audio on the server first to ensure correct mimetype formatting
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
            // Fallback to direct URL if the server download fails
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

    // Generate Satoru Gojo Header Panel
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

        // Shuffle images array to dynamically allocate unique images across slides
        const shuffledImages = [...menuImages].sort(() => 0.5 - Math.random());

        // Define Category slides configurations
        const categories = [
            { name: "AI & CHATBOT 🧠", desc: "Interactive AI assistants & custom engines.", cmd: "menu_ai" },
            { name: "GROUP MANAGEMENT 👥", desc: "Group configurations & administrative controls.", cmd: "menu_group" },
            { name: "TOOLS ⚙️", desc: "Advanced Presence parameters & tracking tools.", cmd: "menu_tools" },
            { name: "DOWNLOADER 📥", desc: "High-speed multi-platform downloaders.", cmd: "menu_download" },
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

        // Compile standard interactive Carousel Message structure
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
        // Fallback to standard text menu if device/connection rejects Interactive Relaying
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
• *Gojo <prompt>* — Speak with Satoru Gojo directly.
• *${settings.prefix}debug <code>* — Auto-diagnoses compile errors & bugs.
• *${settings.prefix}summon <char> <prompt>* — Summons any fictional character.
• *${settings.prefix}read <prompt>* — High-speed Vision image analyzer.
• *${settings.prefix}imagine <prompt>* — Generates premium AI illustrations.
• *${settings.prefix}lizzy <on/off>* — Devoted anime chatbot toggle.
• *${settings.prefix}chatbot <on/off>* — General chat assistance toggle.`;
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

• *${settings.prefix}gmode <open/close>* — Locks/unlocks group conversation flows.
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
• *${settings.prefix}tkick <duration>* — Timed participant ejections.`;
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

• *${settings.prefix}setpp* — Updates profile picture (JID/LID mindful).
• *${settings.prefix}track* — Spatial geographical prefix locator.
• *${settings.prefix}getpp* — Extracts target user profile picture.
• *${settings.prefix}setname* — Modifies bot display username.
• *${settings.prefix}save* — Saves active status media locally.
• *${settings.prefix}tostatus* — Uploads local media/text to status broadcast.
• *${settings.prefix}fw* — Interactive multi-chat forwarder.
• *${settings.prefix}presence* — Presence dashboards overview.
• *${settings.prefix}autotyping / .autorecording* — Active status simulation.
• *${settings.prefix}alwaysonline / .autoread* — Continuous online state.
• *${settings.prefix}antidelete* — Captures and forwards deleted files (LID-mindful).
• *${settings.prefix}antiviewonce* — Automated view-once decryptor (LID-mindful).
• *${settings.prefix}antibug* — Active flood rate-limit protection.
• *${settings.prefix}clear* — Completely empties server chat logs.
• *${settings.prefix}archive / .unarchive* — Archive states controllers.
• *${settings.prefix}autoviewstatus* — Auto-view status triggers.
• *${settings.prefix}statusemoji* — Custom status reaction emoji.
• *${settings.prefix}autoreactstatus* — Auto status reaction triggers.
• *${settings.prefix}block / .unblock* — Native contact blocks.
• *${settings.prefix}aza <set>* — Bank credentials wizard configuration.
• *${settings.prefix}time* — Regional timezone clock calculator.
• *${settings.prefix}weather* — Tropospheric coordinates weather forecast.
• *${settings.prefix}device* — Client hardware OS signature scanner.
• *${settings.prefix}livescore* — Real-time ESPN sports scoreboard.
• *${settings.prefix}football* — ESPN global soccer news wire.`;
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
• *${settings.prefix}ytmp3 / .ytmp4* — Dual-fallback YouTube link downloaders.
• *${settings.prefix}yt <url>* — YouTube v3 multi-format media downloader.
• *${settings.prefix}tt2 <url>* — TikTok v2 watermark-free link downloader.
• *${settings.prefix}img <query> <count>* — Google bulk image downloader.
• *${settings.prefix}song <query>* — Numbered song index selector & downloader.
• *${settings.prefix}video <query>* — YouTube video search downloader.
• *${settings.prefix}fb / .facebook* — Upgraded Facebook2 video downloader.
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
        name: 'menu_owner',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`👑 *APEX ADMINISTRATIVE AUTHORITY* 👑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}diagnose* — Active system compile diagnostic check.
• *${settings.prefix}update <setup/yes/force>* — System updates & force-overwriting.
• *${settings.prefix}update repair* — Silent package registry re-builder (Dev-Only).
• *${settings.prefix}mode <public/private>* — Bot privacy state.
• *${settings.prefix}setsudo / .delsudo* — Sudo users registers.
• *${settings.prefix}addowner / .delowner* — Secondary owners registers.
• *${settings.prefix}restart / .shutdown* — System processes restart/kill.
• *${settings.prefix}ban / .unban* — Global blacklist controllers.
• *${settings.prefix}adddev / .deldev* — Register/remove core developers.
• *${settings.prefix}afk* — Meditation AFK automated auto-responder.
• *${settings.prefix}setvar* — Dynamic variable configurations editor.
• *${settings.prefix}settings* — Displays active global settings card.
• *${settings.prefix}upgrade* — GitHub repository file overwriter (Dev-Only).`;
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
• *${settings.prefix}delete / .del* — Message deletion tool (LID-Safe).
• *${settings.prefix}autoreact* — Automated message reactions.
• *${settings.prefix}speed* — Interactive execution speed meter.
• *${settings.prefix}vv* — Manual view-once media extractor.
• *${settings.prefix}tovv* — Encrypts media into View Once.
• *${settings.prefix}sticker / .crop* — Sticker creation & cropping.
• *${settings.prefix}take / .steal* — Sticker metadata customization.
• *${settings.prefix}setcmd / .delcmd* — Maps commands directly to stickers.
• *${settings.prefix}tourl / .url* — Media file cloud uploaders (Pixeldrain/Quax).
• *${settings.prefix}kamui* — Silent decryption & DM-forwarding View Once.
• *${settings.prefix}addnote / .delnote* — Sticky note managers.
• *${settings.prefix}getnotes / .getnote* — Notes index lookup.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    }
];