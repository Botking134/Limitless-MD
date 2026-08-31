// plugins/alien.js
// .alien — spawns a random Ben 10 alien card, pulling art from the Trixdex repo
// (github.com/emiram01/Trixdex, live at trixdex.com), which itself sourced its data
// from the Ben 10 Fandom wiki via MediaWiki's API.

const axios = require('axios');
const aliens = require('../data/aliens');

// Trixdex's images live in its "public/" folder — Vite copies public/ straight to the
// site root unchanged (no filename hashing), so raw.githubusercontent.com serves the
// exact same files at this path.
const TRIXDEX_RAW_BASE = 'https://raw.githubusercontent.com/emiram01/Trixdex/main/public/';

const SERIES_NAMES = {
    OS: 'Original Series',
    AF: 'Alien Force',
    UA: 'Ultimate Alien',
    OV: 'Omniverse'
};

function buildCaption(alien) {
    const seriesLabel = SERIES_NAMES[alien.series] || alien.series;
    return (
        `👽 *ALIEN SPAWNED!*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🛸 *${alien.name}*\n` +
        `🧬 Species: ${alien.species}\n` +
        `🌍 Home Planet: ${alien.homePlanet}\n` +
        `🧍 Body Type: ${alien.body}\n` +
        `📺 First Appeared: ${seriesLabel}\n\n` +
        `📖 ${alien.description}\n\n` +
        `⚡ *Abilities:*\n${alien.abilities.map(a => `• ${a}`).join('\n')}\n\n` +
        `⚠️ *Weaknesses:*\n${alien.weaknesses.map(w => `• ${w}`).join('\n')}`
    );
}

const commands = [
    {
        name: 'alien',
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const alien = aliens[Math.floor(Math.random() * aliens.length)];
            const caption = buildCaption(alien);

            // Try the full art first, fall back to the smaller button/icon art,
            // and if both fail for any reason, still deliver the card as text —
            // never let an image hiccup mean the command silently does nothing.
            const imagePaths = alien.images || [];
            for (const imgPath of imagePaths) {
                try {
                    const url = TRIXDEX_RAW_BASE + imgPath;
                    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
                    await sock.sendMessage(jid, { image: Buffer.from(data), caption }, { quoted: msg });
                    return;
                } catch (e) {
                    // try the next image path, if any
                }
            }

            // No image could be fetched — send the card as text so the command
            // still does something useful.
            await sock.sendMessage(jid, { text: caption }, { quoted: msg });
        }
    }
];

module.exports = commands;
