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

async function renderMenu(sock, msg) {
    const jid = msg.key.remoteJid;
    const uptime = formatUptime(process.uptime());
    const readMore = String.fromCharCode(8206).repeat(4001);

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

        await sock.sendMessage(jid, {
            audio: { url: "https://qu.ax/sHoAn" },
            mimetype: "audio/mp4",
            ptt: true 
        });

    } catch (error) {
        console.error("Menu Image Render Error:", error);
        await sock.sendMessage(jid, { text: menuText }, { quoted: msg });
    }
}

module.exports = [
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
    }
];