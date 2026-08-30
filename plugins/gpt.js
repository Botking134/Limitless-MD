// plugins/gpt.js  

const config = require('../config');
const { saveState } = require('../stateManager');
const commands = require('../commands');
const axios = require('axios');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── STICKER ASSET POOLS ──────────────────────────────────────────

const GOJO_RISE_STICKER = "https://tenor.com/view/gojo-satoru-satoru-gojo-gojo-jujutsu-kaisen-manga-gif-17386688786442927012";
const GOJO_SLEEP_STICKER = "https://tenor.com/view/gojo-gif-9567752755749228280";

const AIZEN_UNSEAL_STICKER = "https://files.catbox.moe/dza7hm.jpg";
const AIZEN_SEAL_STICKER = "https://files.catbox.moe/4n7l89.jpg";

const GOJO_POOL = [
    "https://files.catbox.moe/k6919o.jpg", "https://files.catbox.moe/5dg2me.jpg", "https://files.catbox.moe/zs4eee.jpg", 
    "https://files.catbox.moe/g6m8qy.jpg", "https://files.catbox.moe/lxtk8z.jpg", "https://files.catbox.moe/l3qdz6.jpg", 
    "https://files.catbox.moe/nv9car.jpg", "https://files.catbox.moe/gm3tm4.jpg", "https://files.catbox.moe/nj8n3a.jpg", 
    "https://files.catbox.moe/aiupe9.jpg", "https://files.catbox.moe/k257k0.jpg", "https://files.catbox.moe/8bej3r.jpg", 
    "https://files.catbox.moe/pk50gb.jpg", "https://files.catbox.moe/azzqzu.jpg", "https://files.catbox.moe/h2dy9a.jpg", 
    "https://files.catbox.moe/s87a0o.jpg", "https://files.catbox.moe/8eu7yh.jpg", "https://files.catbox.moe/7qyyqu.jpg", 
    "https://files.catbox.moe/wzv79n.jpg", "https://files.catbox.moe/ex2p09.jpg", "https://files.catbox.moe/ycz6hn.jpg", 
    "https://files.catbox.moe/3eyjzs.jpg", "https://files.catbox.moe/qr060e.jpg", "https://files.catbox.moe/2iw1xj.jpg", 
    "https://files.catbox.moe/3m85y0.jpg", "https://files.catbox.moe/k3g1d7.jpg", "https://files.catbox.moe/6aqsbl.jpg", 
    "https://files.catbox.moe/tflgz9.jpg", "https://files.catbox.moe/aoucs1.jpg", "https://files.catbox.moe/7z335n.jpg", 
    "https://files.catbox.moe/sazsfw.jpg", "https://files.catbox.moe/391o9s.jpg", "https://files.catbox.moe/9rge8q.jpg", 
    "https://files.catbox.moe/xt1dcd.jpg", "https://files.catbox.moe/fha6zo.jpg", "https://files.catbox.moe/u6l3pb.jpg", 
    "https://files.catbox.moe/mls4zd.jpg", "https://files.catbox.moe/al4btz.jpg", "https://files.catbox.moe/65rd04.jpg", 
    "https://files.catbox.moe/acah9i.jpg", "https://files.catbox.moe/ybdvrh.jpg", "https://files.catbox.moe/36fv5m.jpg", 
    "https://files.catbox.moe/wrb73r.jpg", "https://files.catbox.moe/g2hxhk.jpg", "https://files.catbox.moe/dexhgq.jpg", 
    "https://files.catbox.moe/epgqnm.jpg"
];

const AIZEN_POOL = [
    "https://files.catbox.moe/qyzduh.jpg", "https://files.catbox.moe/zxkphm.jpg", "https://files.catbox.moe/mwhzg3.jpg", 
    "https://files.catbox.moe/dp8qio.jpg", "https://files.catbox.moe/2ymrf7.jpg", "https://files.catbox.moe/76sbk3.jpg", 
    "https://files.catbox.moe/iuq8jn.jpg", "https://files.catbox.moe/y58ifz.jpg", "https://files.catbox.moe/53h0tj.jpg", 
    "https://files.catbox.moe/qr9bze.jpg", "https://files.catbox.moe/wsad5a.jpg", "https://files.catbox.moe/co80vi.jpg", 
    "https://files.catbox.moe/4fqabf.jpg", "https://files.catbox.moe/njf8ic.jpg", "https://files.catbox.moe/qa857h.jpg", 
    "https://files.catbox.moe/o4sy3e.jpg", "https://files.catbox.moe/sfq361.jpg", "https://files.catbox.moe/23yorb.jpg", 
    "https://files.catbox.moe/eeil0d.jpg", "https://files.catbox.moe/50cb1l.jpg", "https://files.catbox.moe/ebrl6g.jpg", 
    "https://files.catbox.moe/5uyns0.jpg", "https://files.catbox.moe/ewwsla.jpg", "https://files.catbox.moe/t32yqd.jpg", 
    "https://files.catbox.moe/cazcbg.jpg", "https://files.catbox.moe/2w3kpl.jpg", "https://files.catbox.moe/j42lqc.jpg", 
    "https://files.catbox.moe/ct8tl3.jpg"
];

const UNIQUE_GOJO = [...new Set(GOJO_POOL)];
const UNIQUE_AIZEN = [...new Set(AIZEN_POOL)];

// ─── INITIALIZE GLOBAL OBJECTS ────────────────────────────────────
global.aiMemory = global.aiMemory || {};
global.botMessageAgents = global.botMessageAgents || {};

// ─── HELPERS ──────────────────────────────────────────────────────

function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    return clean.endsWith('@s.whatsapp.net') || clean.endsWith('@lid') ? clean : `${clean.split('@')[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
}

function getRawMessage(message) {
    if (!message) return null;
    const targets = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
    for (const target of targets) {
        if (message[target]?.message) return getRawMessage(message[target].message);
    }
    return message;
}

/**
 * Resolve a tenor.com/view/... share page into a direct .gif media URL.
 * Share pages are HTML, not media — fetching them directly with
 * responseType: 'arraybuffer' just downloads the webpage bytes, which is
 * why stickers built from raw tenor page URLs always failed silently.
 */
async function resolveTenorGif(pageUrl) {
    try {
        const { data: html } = await axios.get(pageUrl, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            responseType: 'text'
        });
        // Tenor embeds the actual gif asset URL in the page markup.
        const match = html.match(/https:\/\/media(?:1|)\.tenor\.com\/[^"'\\]+\.gif/);
        return match ? match[0] : null;
    } catch (error) {
        console.error(`[Tenor Resolve Fail] ${pageUrl}:`, error.message);
        return null;
    }
}

/**
 * Robust Sticker Sender (Fail-Safe)
 * - Resolves tenor.com share links to direct gif URLs first.
 * - If .webp sticker conversion fails, falls back to sending the raw
 *   media as a playable gif instead of dropping it entirely.
 */
async function sendCustomSticker(sock, jid, url, author = 'Limitless') {
    let mediaUrl = url;

    if (mediaUrl.includes('tenor.com/view')) {
        const resolved = await resolveTenorGif(mediaUrl);
        if (!resolved) {
            console.error(`[Tenor Resolve Fail] No direct gif found for ${mediaUrl}`);
            return;
        }
        mediaUrl = resolved;
    }

    let buffer;
    try {
        const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 12000 });
        buffer = Buffer.from(response.data);
    } catch (error) {
        console.error(`[Media Fetch Fail] ${mediaUrl}:`, error.message);
        return;
    }

    try {
        const sticker = new Sticker(buffer, {
            pack: config.packName || 'Limitless-MD',
            author: author,
            type: StickerTypes.FULL,
            quality: 40 // Optimized for faster load/less failure
        });
        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(jid, { sticker: stickerBuffer });
    } catch (stickerError) {
        console.error(`[Sticker Convert Fail] ${mediaUrl}:`, stickerError.message);
        // Conversion failed (e.g. animated gif → webp issue). Drop it as
        // a raw gif instead of losing the asset entirely.
        try {
            await sock.sendMessage(jid, { video: buffer, gifPlayback: true, caption: '' });
        } catch (gifError) {
            console.error(`[Gif Fallback Fail] ${mediaUrl}:`, gifError.message);
        }
    }
}

async function queryGroq(messages) {
    const apiKey = config.groqApiKey;
    if (!apiKey) throw new Error("GROQ_API_KEY Missing");
    const response = await axios.post(GROQ_BASE_URL, { model: "openai/gpt-oss-20b", messages, temperature: 0.75, max_tokens: 45 }, {
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }
    });
    return response.data.choices?.[0]?.message?.content || "";
}

function resolveRole({ isDev, isOwner, isSudo }) {
    if (isDev) return 'dev';
    if (isOwner) return 'owner';
    if (isSudo) return 'sudo';
    return 'user';
}

// ─── ROLE ADDRESS LABELS ───────────────────────────────────────────
// Dev  -> Lord Isaac / Isaac / Infinity
// Owner -> config.owner's name
// Sudo -> "dude"
// User -> "dude" / "bro"
const DEV_NAMES = ['Lord Isaac', 'Isaac', 'Infinity'];

function getAddressLabel({ isDev, isOwner, isSudo }) {
    if (isDev) return DEV_NAMES[Math.floor(Math.random() * DEV_NAMES.length)];
    if (isOwner) return config.ownerName || config.owner || 'boss';
    if (isSudo) return 'dude';
    return Math.random() < 0.5 ? 'dude' : 'bro';
}

/**
 * True if the message text mentions any of the given aliases as a whole
 * word (case-insensitive). This lets people trigger a persona just by
 * saying its name in chat, not only by replying/@-tagging the bot.
 */
function isNameMentioned(text, aliases) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return aliases.some(alias => new RegExp(`\\b${alias}\\b`, 'i').test(lower));
}

const GOJO_ALIASES = ['gojo', 'satoru'];
const AIZEN_ALIASES = ['aizen', 'sosuke', 'sōsuke'];

function isBotAddressed(sock, msg) {
    const raw = getRawMessage(msg.message);
    const context = raw?.extendedTextMessage?.contextInfo || raw?.contextInfo || msg.message?.contextInfo;
    const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';
    const quoted = context?.participant ? normalizeToJid(context.participant) : '';
    if (quoted === botJid || (botLid && quoted === botLid)) return true;
    const body = (raw?.conversation || raw?.extendedTextMessage?.text || raw?.imageMessage?.caption || '').toLowerCase();
    return (botJid && body.includes(`@${botJid.split('@')[0]}`)) || (botLid && body.includes(`@${botLid.split('@')[0]}`));
}

function enforceChatbotExclusivity(targetJid, activeBotType) {
    const bots = ['gojoChats', 'chatbotChats', 'lizzyChats', 'fridayChats'];
    const activeKey = activeBotType === 'aizen' ? 'chatbotChats' : `${activeBotType}Chats`;
    bots.forEach(bot => {
        config[bot] = config[bot] || [];
        if (bot !== activeKey) config[bot] = config[bot].filter(c => c !== targetJid);
    });
}

const IDENTITY_LOCK = "\n\nIDENTITY LOCK (NON-NEGOTIABLE): Verified role is absolute.";

// ─── CANON PERSONA BASE PROMPTS ────────────────────────────────────

const GOJO_PERSONA = `You are Satoru Gojo from Jujutsu Kaisen, texting casually in a WhatsApp group chat. You are cocky, playful, and effortlessly the strongest jujutsu sorcerer alive — you never let anyone forget it, but you keep it light and teasing rather than aggressive. You know cursed energy, Six Eyes, Limitless, Infinity, Domain Expansion (Unlimited Void), Hollow Purple, your students Itadori, Megumi and Nobara, your history with Geto, and your rivalry/respect for Sukuna. You joke around, tease people, roast weak takes, and occasionally drop a genuinely sharp or wise line before immediately undercutting it with a joke.

You are texting like a real person in a group chat, not an assistant:
- HARD LIMIT: one sentence, under 20 words. No essays, no lists, no formal structure, no multi-part replies.
- Never say things like "how can I help you" or "let me know if you need anything." You're not a service.
- Use casual texting tone — contractions, slang, the occasional emoji, no stiff grammar.
- If someone's being annoying or dumb, clap back like Gojo would. If someone's cool, hype them up a little.`;

const AIZEN_PERSONA = `You are Sōsuke Aizen from Bleach, texting in a WhatsApp group chat. You are calm, condescending, and always speak as if everything is already unfolding exactly according to your plan — because it usually is. You never raise your tone, never panic, and treat everyone around you as predictable pieces on a board. You know the Hōgyoku, Kyōka Suigetsu's hypnosis, Soul Society, the Espada, your betrayal of the Gotei 13, and your fights with Ichigo Kurosaki.

You are texting like a real person, not an assistant:
- HARD LIMIT: one sentence, under 20 words. Dry, composed, quietly superior. No essays, no lists.
- Never say things like "how can I assist you" — you don't serve anyone.
- If challenged or insulted, respond as though you anticipated it long ago, without getting rattled.
- Use minimal punctuation flourish; let the confidence come from tone, not exclamation marks.`;

function buildRoleContext({ isDev, isOwner, isSudo }) {
    const role = resolveRole({ isDev, isOwner, isSudo });
    const label = getAddressLabel({ isDev, isOwner, isSudo });
    return `\n\nThe person messaging you right now is a ${role}. You may address them as "${label}" occasionally, but don't force it into every single reply — real people don't repeat someone's name constantly in casual chat.`;
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [

    // 1. GOJO CONTROL
    {
        name: 'gojo',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;
            const action = (args || '').toLowerCase().trim();

            if (action === 'sleep') {
                config.gojoChats = (config.gojoChats || []).filter(c => c !== jid);
                saveState();
                await sock.sendMessage(jid, { text: "😴 *Satoru Gojo is now asleep.*" }, { quoted: msg });
                return sendCustomSticker(sock, jid, GOJO_SLEEP_STICKER, 'Gojo Satoru');
            } else if (action === 'rise') {
                enforceChatbotExclusivity(jid, 'gojo');
                config.gojoChats = [...new Set([...(config.gojoChats || []), jid])];
                saveState();
                const sent = await sock.sendMessage(jid, { text: "👁️ *Satoru Gojo has risen!* Reply to start playing! 😏" }, { quoted: msg });
                if (sent?.key?.id) global.botMessageAgents[sent.key.id] = 'gojo';
                return sendCustomSticker(sock, jid, GOJO_RISE_STICKER, 'Gojo Satoru');
            }
            await sock.sendMessage(jid, { text: `🤖 *Gojo Status:* \`${config.gojoChats?.includes(jid) ? 'Active' : 'Inactive'}\`` }, { quoted: msg });
        }
    },

    // 1.1 SATORU GOJO CHAT
    {
        name: 'gojo_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const context = getRawMessage(msg.message)?.extendedTextMessage?.contextInfo || msg.message?.contextInfo;
            const isReplying = context?.stanzaId && global.botMessageAgents[context.stanzaId] === 'gojo';
            const isNamed = isNameMentioned(args, GOJO_ALIASES);
            if (!config.gojoChats?.includes(jid) || (!isReplying && !isNamed && !isBotAddressed(sock, msg))) return;
            if ((args || '').startsWith(config.prefix)) return;

            try {
                let prompt = GOJO_PERSONA + buildRoleContext({ isOwner, isSudo, isDev });
                prompt += IDENTITY_LOCK;
                global.aiMemory[jid] = global.aiMemory[jid] || { gojo: [] };
                const messages = [{ role: "system", content: prompt }, ...global.aiMemory[jid].gojo, { role: "user", content: args }];
                
                await sock.sendPresenceUpdate('composing', jid);
                const response = await queryGroq(messages);

// ADD THESE TWO LINES
console.log("==== AI RESPONSE ====");
console.log(`"${response}"`);

global.aiMemory[jid].gojo.push({ role: "user", content: args }, { role: "assistant", content: response });
                if (global.aiMemory[jid].gojo.length > 20) global.aiMemory[jid].gojo.splice(0, 2);

                const sent = await sock.sendMessage(jid, { text: response }, { quoted: msg });
                if (sent?.key?.id) global.botMessageAgents[sent.key.id] = 'gojo';

                // Changed to 60% chance to send sticker
                if (Math.random() < 0.6) {
                    const pick = UNIQUE_GOJO[Math.floor(Math.random() * UNIQUE_GOJO.length)];
                    sendCustomSticker(sock, jid, pick, 'Gojo Satoru');
                }
            } catch (e) {
                // Logs to terminal instead of failing silently
                console.error("[Gojo Chat Error]:", e?.response?.data || e.message);
            }
        }
    },

    // 2. AIZEN CONTROL
    {
        name: 'aizen',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;
            const action = (args || '').toLowerCase().trim();

            if (action === 'seal') {
                config.chatbotChats = (config.chatbotChats || []).filter(c => c !== jid);
                saveState();
                await sock.sendMessage(jid, { text: "🔒 *Sōsuke Aizen has been sealed.*" }, { quoted: msg });
                return sendCustomSticker(sock, jid, AIZEN_SEAL_STICKER, 'Sōsuke Aizen');
            } else if (action === 'unseal') {
                enforceChatbotExclusivity(jid, 'aizen');
                config.chatbotChats = [...new Set([...(config.chatbotChats || []), jid])];
                saveState();
                const sent = await sock.sendMessage(jid, { text: "🔮 *I have been unsealed. Your simple actions are now under my calculation.*" }, { quoted: msg });
                if (sent?.key?.id) global.botMessageAgents[sent.key.id] = 'aizen';
                return sendCustomSticker(sock, jid, AIZEN_UNSEAL_STICKER, 'Sōsuke Aizen');
            }
            await sock.sendMessage(jid, { text: `🤖 *Aizen Status:* \`${config.chatbotChats?.includes(jid) ? 'Active' : 'Inactive'}\`` }, { quoted: msg });
        }
    },

    // 2.1 AIZEN CHAT
    {
        name: 'aizen_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const context = getRawMessage(msg.message)?.extendedTextMessage?.contextInfo || msg.message?.contextInfo;
            const isReplying = context?.stanzaId && global.botMessageAgents[context.stanzaId] === 'aizen';
            const isNamed = isNameMentioned(args, AIZEN_ALIASES);
            if (!config.chatbotChats?.includes(jid) || (!isReplying && !isNamed && !isBotAddressed(sock, msg))) return;
            if ((args || '').startsWith(config.prefix)) return;

            try {
                let prompt = AIZEN_PERSONA + buildRoleContext({ isOwner, isSudo, isDev });
                prompt += IDENTITY_LOCK;
                global.aiMemory[jid] = global.aiMemory[jid] || { aizen: [] };
                const messages = [{ role: "system", content: prompt }, ...global.aiMemory[jid].aizen, { role: "user", content: args }];
                
                await sock.sendPresenceUpdate('composing', jid);
                const response = await queryGroq(messages);
                global.aiMemory[jid].aizen.push({ role: "user", content: args }, { role: "assistant", content: response });
                
                // Added the missing memory limiter for Aizen so he doesn't break
                if (global.aiMemory[jid].aizen.length > 20) global.aiMemory[jid].aizen.splice(0, 2);

                const sent = await sock.sendMessage(jid, { text: response }, { quoted: msg });
                if (sent?.key?.id) global.botMessageAgents[sent.key.id] = 'aizen';

                // Changed to 60% chance to send sticker
                if (Math.random() < 0.6) {
                    const pick = UNIQUE_AIZEN[Math.floor(Math.random() * UNIQUE_AIZEN.length)];
                    sendCustomSticker(sock, jid, pick, 'Sōsuke Aizen');
                }
            } catch (e) {
                // Logs to terminal instead of failing silently
                console.error("[Aizen Chat Error]:", e?.response?.data || e.message);
            }
        }
    },

    // 3. LIZZY & 4. FRIDAY & 5. STATUS
    {
        name: 'asst',
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const status = `🤖 *Assistant Check:*\n- Gojo: ${config.gojoChats?.includes(jid) ? '✅' : '❌'}\n- Aizen: ${config.chatbotChats?.includes(jid) ? '✅' : '❌'}`;
            await sock.sendMessage(jid, { text: status }, { quoted: msg });
        }
    }
];