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
`🧠 *AI & CHATBOT COMMANDS* 🧠
━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}ai <prompt>* — Solves queries and questions.
• *Gojo <prompt>* (Prefixless) — Speaks directly to Satoru Gojo.
• *${settings.prefix}debug <code>* — Analyzes code snippets and fixes bugs.
• *${settings.prefix}summon <char> <prompt>* — Speaks as any fictional character.
• *${settings.prefix}read <prompt>* — Analyzes the attached or replied image (Vision).
• *${settings.prefix}imagine <prompt>* — Generates high-quality images via AI.
• *${settings.prefix}lizzy <on/off>* — Toggles the devoted anime chatbot.
• *${settings.prefix}chatbot <on/off>* — Toggles standard chat assistance.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_group',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`👥 *GROUP MANAGEMENT COMMANDS* 👥
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}gmode <open/close>* — Locks or unlocks chat capabilities.
• *${settings.prefix}kick / .promote / .demote* — Administrative management.
• *${settings.prefix}tagall / .tag* — Active or ghost tags all members.
• *${settings.prefix}link* — Fetches active group invitation links.
• *${settings.prefix}antilink <on/off>* — Restricts or warns on link spam.
• *${settings.prefix}admins* — Summons administrative operators.
• *${settings.prefix}antitag <on/off>* — Discards non-admin bot mentions.
• *${settings.prefix}antibot <on/off>* — Prevents secondary bots from joining.
• *${settings.prefix}warn* — Admin warnings (auto-kicks at 5 marks).
• *${settings.prefix}antigm <on/off>* — Discards group status mentions.
• *${settings.prefix}gclog <on/off/check>* — Dynamic chat logger & summarizer.
• *${settings.prefix}creategc <name>* — Instantly spawns a new WhatsApp group.
• *${settings.prefix}tkick <duration>* — Timed user ejection.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_tools',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`⚙️ *SYSTEM TOOL COMMANDS* ⚙️
━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}setpp* — Sets custom bot profile avatar.
• *${settings.prefix}track* — Spatial geographical prefix triangulation.
• *${settings.prefix}getpp* — Retrieves the target profile picture.
• *${settings.prefix}setname* — Sets display profile username.
• *${settings.prefix}save* — Extracts and saves status media locally.
• *${settings.prefix}tostatus* — Pushes local media to status broadcast.
• *${settings.prefix}fw* — Dynamic interactive multi-chat forwarder.
• *${settings.prefix}presence* — Checks configuration of presence automation.
• *${settings.prefix}autotyping / .autorecording* — Presence simulation.
• *${settings.prefix}alwaysonline / .autoread* — Online and read automation.
• *${settings.prefix}antidelete* — Captures and forwards deleted files/messages.
• *${settings.prefix}antiviewonce* — Automatic view-once decryption.
• *${settings.prefix}antibug* — Spawning flood protection filters.
• *${settings.prefix}clear* — Completely cleans panel chat flows.
• *${settings.prefix}archive / .unarchive* — Archive state managers.
• *${settings.prefix}autoviewstatus* — Automatic status viewing module.
• *${settings.prefix}statusemoji* — Configures status reaction emoji.
• *${settings.prefix}autoreactstatus* — Automatic status reaction module.
• *${settings.prefix}block / .unblock* — Native WhatsApp contact managers.
• *${settings.prefix}aza <set>* — Bank credentials interactive setup.
• *${settings.prefix}time* — Evaluates regional clock zones.
• *${settings.prefix}weather* — Live geographical weather analytics.
• *${settings.prefix}device* — Cryptographic hardware client signature scanner.
• *${settings.prefix}livescore* — Live ESPN sports scoreboard.
• *${settings.prefix}football* — Current ESPN global news wire.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_download',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`📥 *DOWNLOADER COMMANDS* 📥
━━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}play <query>* — High-speed song downloader with artwork.
• *${settings.prefix}ytmp3 / .ytmp4* — YouTube audio & video link downloaders.
• *${settings.prefix}img <query> <count>* — Google image downloader.
• *${settings.prefix}song <query>* — Interactive song search results list.
• *${settings.prefix}video <query>* — YouTube video search downloader.
• *${settings.prefix}fb / .facebook* — Facebook video link extractor.
• *${settings.prefix}tt / .tiktok* — Watermark-free TikTok video downloader.
• *${settings.prefix}mediafire* — MediaFire file downloader.
• *${settings.prefix}apk <name>* — Interactive APK downloader list.
• *${settings.prefix}shazam* — Quoted audio/video track recognition.
• *${settings.prefix}lyrics <query>* — Detailed lyrics extractor.
• *${settings.prefix}gdrive* — Google Drive file downloader.
• *${settings.prefix}gitclone* — Repository zipball downloader.
• *${settings.prefix}pinterest* — Pinterest video/image downloader.
• *${settings.prefix}subtitle* — Movie English srt downloader.
• *${settings.prefix}ytmp3doc / .ytmp4doc* — Document format link downloaders.
• *${settings.prefix}playdoc / .videodoc* — Document format search downloaders.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_owner',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`👑 *ADMIN & DEV COMMANDS* 👑
━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}diagnose* — Dynamic system compile diagnostic check.
• *${settings.prefix}update <setup/yes/force>* — System updates & force pulling.
• *${settings.prefix}update repair* — Rebuilds package registry (Dev-Only).
• *${settings.prefix}mode <public/private>* — Bot privacy controls.
• *${settings.prefix}setsudo / .delsudo* — Sudo user configuration.
• *${settings.prefix}addowner / .delowner* — Secondary owner registers.
• *${settings.prefix}restart / .shutdown* — System engine restart/sleep triggers.
• *${settings.prefix}ban / .unban* — System blacklist controllers.
• *${settings.prefix}adddev / .deldev* — Register/remove core developers.
• *${settings.prefix}afk* — Meditation AFK automated mention auto-responder.
• *${settings.prefix}setvar* — Dynamic variable editor.
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
`🛠️ *UTILITIES COMMANDS* 🛠️
━━━━━━━━━━━━━━━━━━━━━━━━━

• *${settings.prefix}ping / .ping2* — Network latency & speed analyzers.
• *${settings.prefix}alive* — Checks online uptime status.
• *${settings.prefix}delete / .del* — Message delete tool (LID-Safe).
• *${settings.prefix}autoreact* — Configures automated reactions.
• *${settings.prefix}speed* — Interactive latency evaluation.
• *${settings.prefix}vv* — Manually decrypts quoted View Once media.
• *${settings.prefix}tovv* — Encrypts replied media into View Once.
• *${settings.prefix}sticker / .crop* — WebP sticker creation and cropping.
• *${settings.prefix}take / .steal* — WebP sticker metadata personalization.
• *${settings.prefix}setcmd / .delcmd* — Maps commands directly to stickers.
• *${settings.prefix}tourl / .url* — Media file cloud uploaders (Pixeldrain/Quax).
• *${settings.prefix}kamui* — Silent decryption & DM-forwarding View Once.
• *${settings.prefix}addnote / .delnote* — Sticky note managers.
• *${settings.prefix}getnotes / .getnote* — Retrieving personal notes.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    }
];