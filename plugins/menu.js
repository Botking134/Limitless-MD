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
    return {
        body: { text: description },
        header: {
            title: title,
            hasMediaAttachment: true,
            imageMessage: (await sock.prepareMessageMedia({ image: { url: imageUrl } }, { upload: sock.waUploadToServer })).imageMessage
        },
        nativeFlowMessage: {
            buttons: [{
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                    display_text: buttonText,
                    id: commandId
                })
            }]
        }
    };
}

module.exports = [
    // MAIN INTERACTIVE INDEX SYSTEM (.menu / .help)
    {
        name: 'menu',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const uptime = formatUptime(process.uptime());

            const mainGreeting = 
                `🤞 *𝖫𝖨𝖬𝖨𝖳𝖫𝖤𝖲𝖲-𝖬𝖣: 𝖳𝖧𝖤 𝖧𝖮𝖭𝖮𝖱𝖤𝖣 𝖮𝖭𝖤* 🤞\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *𝖿𝗐𝗇𝖾𝗋:* ${settings.ownerName}\n` +
                `🤖 *𝖡𝗈𝗍:* ${settings.botName}\n` +
                `⚡ *𝖯𝗋𝖾𝖿𝗂𝗑:* \`${settings.prefix}\`\n` +
                `⏱️ *𝖴𝗉𝗍𝗂𝗆𝖾:* ${uptime}\n\n` +
                `_𝖲𝗐𝗂𝗉𝖾 𝗍𝗁𝗋𝗈𝗎𝗀𝗁 𝗍𝗁𝖾 𝖼𝖺𝗋𝗈𝗎𝗌𝖾𝗅 𝖼𝖺𝗋𝖽𝗌 𝖻𝖾𝗅𝗈𝗐 𝗍𝗈 𝗆𝖺𝗇𝗂𝖿𝖾𝗌𝗍 𝗌𝖾𝗉𝖺𝗋𝖺𝗍𝖾 𝗍𝖾𝖼𝗁𝗇𝗂𝗊𝗎𝖾 𝗅𝗂events._`;

            try {
                const cards = [
                    await createCard(sock, "🧠 SIX EYES INTELLIGENCE", "Access deep AI neural modules, Groq models, and contextual triggers.", menuImages[0], "menu_ai", "Open AI Menu"),
                    await createCard(sock, "🔮 FUN AND GAMES", "Anime techniques, automated matchmaking, interactive games, and Hollow Purple overrides.", menuImages[1], "menu_fun", "Open Fun Menu"),
                    await createCard(sock, "🛡️ DOMAIN BOUNDARIES", "Group administrative overrides, security sweeps, and automated tracking controls.", menuImages[2], "menu_group", "Open Group Menu"),
                    await createCard(sock, "📥 VOID EXTRACTION", "Natively extract and download streaming audio, profiles, videos, and platforms.", menuImages[3], "menu_download", "Open Download Menu"),
                    await createCard(sock, "🛠️ UTILITY CORE STACK", "System metrics, diagnostic pings, sticker tools, and View-Once deciphering matrix arrays.", menuImages[4], "menu_utilities", "Open Utilities Menu"),
                    await createCard(sock, "👑 LIMITLESS AUTOCRACY", "Core configuration variables, direct database edits, and secondary supervisor setups.", menuImages[5], "menu_owner", "Open Owner Menu")
                ];

                await sock.sendMessage(jid, {
                    text: mainGreeting,
                    carouselMessage: { cards }
                }, { quoted: msg });

            } catch (err) {
                console.error("Interactive Carousel System Failure:", err);
                
                // Pure textual fallback option if carousel headers fail execution
                let standardMenu = `🤞 *${settings.botName.toUpperCase()} REBUILT VAULT INDEX* 🤞\n\n`;
                standardMenu += `• *${settings.prefix}menu_ai* — Intelligence Framework\n`;
                standardMenu += `• *${settings.prefix}menu_fun* — Fun & Games\n`;
                standardMenu += `• *${settings.prefix}menu_group* — Domain Protections\n`;
                standardMenu += `• *${settings.prefix}menu_download* — Void Downloader\n`;
                standardMenu += `• *${settings.prefix}menu_utilities* — Core Utility Stack\n`;
                standardMenu += `• *${settings.prefix}menu_owner* — Executive Autocracy Only\n`;
                
                await sock.sendMessage(jid, { text: standardMenu }, { quoted: msg });
            }
        }
    },

    // SUB-MENU CARD READERS
    {
        name: 'menu_ai',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`🧠 *𝖲𝖨𝖷 𝖤𝖸𝖤𝖲 𝖨𝖭𝖳𝖤𝖫𝖫𝖨𝖦𝖤𝖭𝖢𝖤 𝖬𝖤𝖭𝖴* 🧠\n` +
`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`• *${settings.prefix}gpt / .ai* — Query the foundational brain matrix.\n` +
`• *${settings.prefix}lizzy* — Summons a responsive, custom localized personality configuration.\n` +
`• *${settings.prefix}chatbot* — Globally toggles AI automated contextual mention responses.\n\n` +
`_Prefixless options available dynamically via active mention streams._`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_fun',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`🔮 *𝖥𝖴𝖭 𝖠𝖭𝖣 𝖦𝖠𝖬𝖤𝖲* 🔮\n` +
`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`• *${settings.prefix}hollow-purple* — Unleash Satoru Gojo's ultimate cascading incantation. *(🔒 Sudo Only)*\n` +
`• *${settings.prefix}purple-tech* — Alias shortcut trigger for Hollow Purple. *(🔒 Sudo Only)*\n` +
`• *${settings.prefix}bankai* — Query structural Soul Society Archive profiles for Bleach entities.\n` +
`• *${settings.prefix}domain-expansion* — Manifest absolute Jujutsu barrier frameworks.\n` +
`• *${settings.prefix}ship* — Automated percentage matchmaking evaluation module.\n` +
`• *${settings.prefix}wed* — Bind group members under traditional holy matrimony.\n` +
`• *${settings.prefix}propose* — Execute full multi-stage proposal requests via interactive text.\n` +
`• *${settings.prefix}askout* — Nervous confession configuration track for prospective lovers.\n` +
`• *${settings.prefix}wyr* — Spawns structural 'Would You Rather' high-stakes dilemma poll fields.\n` +
`• *${settings.prefix}joke* — Fetch rapid comedic records directly from the database.\n` +
`• *${settings.prefix}insult* — Deploy heavy targeted burns onto tagged targets.\n` +
`• *${settings.prefix}roast* — Deploy a deep comedic burn onto a tagged target.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_group',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`🛡️ *𝖣𝖮𝖬𝖠𝖨𝖭 𝖡𝖮𝖴𝖭𝖣𝖠𝖱𝖸 𝖬𝖠𝖭𝖠𝖦𝖤𝖬𝖤𝖭𝖳* 🛡️\n` +
`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`• *${settings.prefix}kick / .add* — Direct management over participant indices.\n` +
`• *${settings.prefix}promote / .demote* — Rebuild structural channel hierarchies.\n` +
`• *${settings.prefix}gmode <open/close>* — Locks/unlocks group conversation engines for set intervals.\n` +
`• *${settings.prefix}tagall / .tag* — Forced broad broadcast transmission parameters.\n` +
`• *${settings.prefix}admins* — Summons and profiles running admin configurations.\n` +
`• *${settings.prefix}warn / .unwarn* — Track and administer severe system violation warning logs.\n` +
`• *${settings.prefix}antilink / .antitag / .antibot* — Automated protective automated execution scripts.\n` +
`• *${settings.prefix}welcome / .goodbye* — Personalize automated entrance and exit greetings.\n` +
`• *${settings.prefix}tkick / .tkick_cancel_all* — Register delayed kick schedules for specific users.\n` +
`• *${settings.prefix}gclog <on/off/check>* — Real-time group activity indexing and AI summary trackers.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_download',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`📥 *𝖵𝖮𝖨𝖸 𝖬𝖤𝖣𝖨𝖠 𝖤𝖷𝖳𝖱𝖠𝖢𝖳𝖨𝖮𝖭 𝖬𝖤𝖭𝖴* 📥\n` +
`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`• *${settings.prefix}play* — Rapid streaming audio compilation via search keywords.\n` +
`• *${settings.prefix}song / .video* — Target YouTube servers directly for download binaries.\n` +
`• *${settings.prefix}apk* — Fetch explicit Android system packaging archives from safe clouds.\n` +
`• *${settings.prefix}fb / .ig / .tt* — Social media profile and video tracking hooks.\n` +
`• *${settings.prefix}gitclone* — Remote downloads source trees directly from GitHub indices.\n` +
`• *${settings.prefix}pinterest* — Query cloud repositories for graphical inspiration media.\n` +
`• *${settings.prefix}shazam* — Record audio via mic clips to cross-examine global song directories.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_owner',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`👑 *𝖫𝖨𝖬𝖨𝖳𝖫𝖤𝖲𝖲 𝖤𝖷𝖤𝖢𝖴𝖳𝖨𝖵𝖤 𝖬𝖤𝖭𝖴* 👑\n` +
`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`_🔒 Execution authorized for system administrators only._\n\n` +
`• *${settings.prefix}public / .private* — Global privacy visibility status selectors.\n` +
`• *${settings.prefix}addowner / .delowner* — Registers core supervisor identities dynamically.\n` +
`• *${settings.prefix}addsudo / .delsudo* — Appends operators into the Sudo technical wall.\n` +
`• *${settings.prefix}ban / .unban* — Block user segments from accessing bot modules completely.\n` +
`• *${settings.prefix}block / .unblock* — Natively interacts with official WhatsApp infrastructure blocks.\n` +
`• *${settings.prefix}bc / .bcgroups* — Mass broadcast transmission vectors.\n` +
`• *${settings.prefix}setprefix / .setbotname* — Real-time metadata system variable modifications.\n` +
`• *${settings.prefix}diagnose / .status* — Generates an all-inclusive settings dashboard status card.\n` +
`• *${settings.prefix}upgrade* — Direct live remote source tree sync execution with production repository targets.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    },
    {
        name: 'menu_utilities',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subText = 
`🛠️ *𝖲𝖨𝖷 𝖤𝖸𝖤𝖲 𝖴𝖳𝖨𝖫𝖨𝖳𝖸 𝖲𝖳𝖠𝖢𝖪* 🛠️\n` +
`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
`• *${settings.prefix}ping / .ping2* — Network latency & speed tracking.\n` +
`• *${settings.prefix}alive* — System uptime & local climate dashboard updates.\n` +
`• *${settings.prefix}delete / .del* — Safe message extraction and deletion commands.\n` +
`• *${settings.prefix}autoreact* — Toggles structural reaction setups across groups.\n` +
`• *${settings.prefix}speed* — Triggers calculation time metrics.\n` +
`• *${settings.prefix}vv / .tovv* — Decrypt or encrypt WhatsApp View-Once data formats.\n` +
`• *${settings.prefix}sticker / .crop / .take* — Advanced media customization components.\n` +
`• *${settings.prefix}setcmd / .delcmd* — Links custom routines straight to specific stickers.\n` +
`• *${settings.prefix}tourl* — Deploy incoming media into Pixeldrain or Quax clouds.\n` +
`• *${settings.prefix}kamui* — Forwards group view-once assets stealthily directly into your DM.\n` +
`• *${settings.prefix}addnote / .getnote / .delnote* — Lightweight note filing memory bank system.`;
            await sock.sendMessage(jid, { text: subText }, { quoted: msg });
        }
    }
];

// Add structural requested alias triggers dynamically
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'menu') {
        aliases.push({ ...cmd, name: 'help' });
    }
});
module.exports.push(...aliases);
