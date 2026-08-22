// plugins/yugioh.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { normalizeToJid } = require('../stateManager');

// ─── STORAGE PATHS ─────────────────────────────────────────────
const INVENTORY_FILE = path.join(__dirname, '..', 'storage', 'yugioh_decks.json');
const SETTINGS_FILE = path.join(__dirname, '..', 'storage', 'cardspawn_settings.json');

function loadJSON(filePath, defaultData = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        return defaultData;
    }
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`❌ Failed to save ${filePath}:`, e.message);
    }
}

const isEnabled = (val) => val === true || val === 'on' || val === 'enable' || val === 'true' || val === '1';

// ─── DIRECT BUFFER FETCHER ─────────────────────────────────────
async function getMediaBuffer(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        return Buffer.from(response.data);
    } catch (e) {
        console.error(`❌ Image fetch failed for ${url}:`, e.message);
        return null;
    }
}

// ─── FETCH RANDOM CARD FROM OFFICIAL YGOPRODECK API ───────────
async function fetchRandomCard() {
    try {
        const res = await axios.get('https://db.ygoprodeck.com/api/v7/randomcard.php', { timeout: 8000 });
        const card = res.data;
        if (!card || !card.name) return null;

        // Calculate gold value based on card market price or ATK
        const basePrice = parseFloat(card.card_prices?.[0]?.cardmarket_price || card.card_prices?.[0]?.tcgplayer_price || "2.50");
        const goldValue = Math.max(500, Math.floor(basePrice * 1000) || (card.atk ? Math.floor(card.atk * 1.5) : 1000));

        return {
            id: card.id,
            name: card.name,
            type: card.type || 'Monster',
            atk: card.atk ?? 'N/A',
            def: card.def ?? 'N/A',
            level: card.level || card.linkval || 1,
            attribute: card.attribute || 'SPELL/TRAP',
            race: card.race || 'Warrior',
            price: goldValue,
            image: card.card_images?.[0]?.image_url || `https://images.ygoprodeck.com/images/cards/${card.id}.jpg`
        };
    } catch (e) {
        console.error("❌ [YGOPRODECK API ERROR]:", e.message);
        return null;
    }
}

global.activeCardSpawns = global.activeCardSpawns || {};

function generateCaptcha(length = 5) {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ─── CARD SPAWNER ENGINE ────────────────────────────────────────
async function spawnYuGiOhCard(sock, jid) {
    const card = await fetchRandomCard();
    if (!card) {
        console.error("❌ Failed to fetch card from YGOPRODeck API.");
        return;
    }

    const imageBuffer = await getMediaBuffer(card.image);
    if (!imageBuffer) {
        console.error("❌ Failed to buffer YGOPRODeck card image.");
        return;
    }

    const captcha = generateCaptcha(5);

    global.activeCardSpawns[jid] = {
        card: card,
        captcha: captcha,
        spawnedAt: Date.now(),
        expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes expiry
    };

    const cardCaption =
        `🎴 *Yu-Gi-Oh Card Appeared!*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⭐ *Name*      : ${card.name}\n` +
        `🎭 *Type*      : ${card.type}\n` +
        `⚔️ *ATK*       : ${card.atk}\n` +
        `🛡️ *DEF*       : ${card.def}\n` +
        `🔯 *Level*     : ${card.level}\n` +
        `🌌 *Attribute* : ${card.attribute}\n` +
        `🧩 *Race*      : ${card.race}\n\n` +
        `💰 *Price*     : ${card.price.toLocaleString()} gold\n` +
        `🔒 *Captcha*   : \`${captcha}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Type *.upgrade ${captcha}* to claim this card!_`;

    await sock.sendMessage(jid, {
        image: imageBuffer,
        mimetype: 'image/jpeg',
        caption: cardCaption
    });
}

// ─── 30-MINUTE BACKGROUND SCHEDULER ────────────────────────────
function startAutoCardSpawner(sock) {
    if (global.cardSpawnerInterval) clearInterval(global.cardSpawnerInterval);
    global.cardSpawnerInterval = setInterval(async () => {
        const settings = loadJSON(SETTINGS_FILE, {});
        const activeGroups = Object.keys(settings).filter(jid => isEnabled(settings[jid]));

        for (const groupJid of activeGroups) {
            try {
                await spawnYuGiOhCard(sock, groupJid);
            } catch (e) {
                console.error(`❌ [CARD AUTO] Spawn error in ${groupJid}:`, e.message);
            }
        }
    }, 30 * 60 * 1000);
}

// ─── COMMAND HANDLERS ──────────────────────────────────────────

const cardSpawnManualCommand = {
    name: 'card',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        await spawnYuGiOhCard(sock, jid);
    }
};

const upgradeClaimCommand = {
    name: 'upgrade',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const sender = normalizeToJid(msg.key.participant || msg.key.remoteJid).split(':')[0].split('@')[0] + '@s.whatsapp.net';
        const userNumber = sender.split('@')[0];

        const activeSpawn = global.activeCardSpawns[jid];
        if (!activeSpawn || Date.now() > activeSpawn.expiresAt) {
            return sock.sendMessage(jid, { text: `❌ No active card found! Spawn one with *.card*` });
        }

        const inputCode = (args || '').trim().toUpperCase();
        if (!inputCode) {
            return sock.sendMessage(jid, { text: `⚠️ Captcha code required: \`.upgrade ${activeSpawn.captcha}\`` });
        }

        if (inputCode !== activeSpawn.captcha) {
            return sock.sendMessage(jid, { text: `❌ Invalid captcha code!` });
        }

        const claimedCard = activeSpawn.card;
        delete global.activeCardSpawns[jid];

        const inventoryData = loadJSON(INVENTORY_FILE, {});
        if (!inventoryData[sender]) {
            inventoryData[sender] = { gold: 0, deck: [] };
        }

        inventoryData[sender].gold += claimedCard.price;
        inventoryData[sender].deck.push({
            id: claimedCard.id,
            name: claimedCard.name,
            type: claimedCard.type,
            atk: claimedCard.atk,
            def: claimedCard.def,
            claimedAt: new Date().toISOString()
        });

        saveJSON(INVENTORY_FILE, inventoryData);

        const successMessage =
            `🎉 *CARD CLAIMED!* 🎉\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👤 *Duelist* : @${userNumber}\n` +
            `🃏 *Card*    : *${claimedCard.name}*\n` +
            `🎭 *Type*    : ${claimedCard.type}\n` +
            `⚔️ *ATK/DEF* : ${claimedCard.atk} / ${claimedCard.def}\n` +
            `💰 *Reward*  : +${claimedCard.price.toLocaleString()} Gold\n\n` +
            `_View your deck with *.deck*_`;

        await sock.sendMessage(jid, {
            text: successMessage,
            mentions: [sender]
        });
    }
};

const deckInventoryCommand = {
    name: 'deck',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const sender = normalizeToJid(msg.key.participant || msg.key.remoteJid).split(':')[0].split('@')[0] + '@s.whatsapp.net';
        const userNumber = sender.split('@')[0];

        const inventoryData = loadJSON(INVENTORY_FILE, {});
        const userProfile = inventoryData[sender];

        if (!userProfile || !userProfile.deck || userProfile.deck.length === 0) {
            return sock.sendMessage(jid, { 
                text: `🎴 *DECK EMPTY*\n\n@${userNumber}, you haven't claimed any cards yet. Type *.card* to encounter one!`,
                mentions: [sender]
            });
        }

        const totalAtk = userProfile.deck.reduce((sum, c) => sum + (typeof c.atk === 'number' ? c.atk : 0), 0);
        const cardList = userProfile.deck.slice(-10).map((c, i) => {
            return `${i + 1}. *${c.name}* [${c.type}] — ⚔️ ${c.atk}`;
        }).join('\n');

        const profileText =
            `🎴 *DUELIST DECK ARCHIVE* 🎴\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Duelist*     : @${userNumber}\n` +
            `💰 *Gold*        : ${userProfile.gold.toLocaleString()} Gold\n` +
            `🃏 *Total Cards* : ${userProfile.deck.length}\n` +
            `⚔️ *Total ATK*   : ${totalAtk.toLocaleString()}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📜 *Recent Acquisitions:*\n` +
            `${cardList}`;

        await sock.sendMessage(jid, {
            text: profileText,
            mentions: [sender]
        });
    }
};

const cardSpawnToggleCommand = {
    name: 'cardspawn',
    category: 'games',
    execute: async (sock, msg, args, opts) => {
        const jid = msg.key.remoteJid;
        if (!jid.endsWith('@g.us')) {
            return sock.sendMessage(jid, { text: "❌ Group command only." });
        }

        const { isOwner, isSudo, isDev, isAdmin } = opts || {};
        if (!isOwner && !isSudo && !isDev && !isAdmin) {
            return sock.sendMessage(jid, { text: "⛔ Admin permission required." });
        }

        const option = (args || '').trim().toLowerCase();
        const settings = loadJSON(SETTINGS_FILE, {});
        const isCurrentlyEnabled = isEnabled(settings[jid]);

        if (!option || option === 'status') {
            const status = isCurrentlyEnabled ? "🟢 Enabled" : "🔴 Disabled";
            return sock.sendMessage(jid, { text: `🎴 *Card Spawner:* ${status}` });
        }

        if (option === 'on' || option === 'enable' || option === '1') {
            if (isCurrentlyEnabled) return sock.sendMessage(jid, { text: "ℹ️ Card Spawner is already enabled." });
            settings[jid] = true;
            saveJSON(SETTINGS_FILE, settings);
            startAutoCardSpawner(sock);
            return sock.sendMessage(jid, { text: "✅ *Yu-Gi-Oh Auto-Spawner enabled.*" });
        }

        if (option === 'off' || option === 'disable' || option === '0') {
            if (!isCurrentlyEnabled) return sock.sendMessage(jid, { text: "ℹ️ Card Spawner is already disabled." });
            delete settings[jid];
            saveJSON(SETTINGS_FILE, settings);
            return sock.sendMessage(jid, { text: "🛑 *Yu-Gi-Oh Auto-Spawner disabled.*" });
        }

        return sock.sendMessage(jid, { text: "⚠️ Usage: *.cardspawn on* | *off* | *status*" });
    }
};

module.exports = [
    cardSpawnManualCommand,
    upgradeClaimCommand,
    deckInventoryCommand,
    cardSpawnToggleCommand
];