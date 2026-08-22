// plugins/ben10.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { normalizeToJid } = require('../stateManager');

// ─── STORAGE PATHS ─────────────────────────────────────────────
const INVENTORY_FILE = path.join(__dirname, '..', 'storage', 'omnitrix_users.json');
const SETTINGS_FILE = path.join(__dirname, '..', 'storage', 'alienspawn_settings.json');

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

// ─── ROBUST BUFFER FETCHER ─────────────────────────────────────
async function getMediaBuffer(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 8000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'image/*,*/*'
            }
        });
        const buffer = Buffer.from(response.data);
        if (buffer.length < 500) return null;
        return buffer;
    } catch (e) {
        return null;
    }
}

// ─── BEN 10 CARD ROSTER ─────────────────────────────────────────
const ALIEN_DATABASE = [
    {
        id: "heatblast",
        name: "Heatblast",
        species: "Pyronite",
        planet: "Pyros",
        rarity: "Epic",
        power: 3450,
        bounty: 1850,
        image: "https://qu.ax/yQcR.png"
    },
    {
        id: "fourarms",
        name: "Four Arms",
        species: "Tetramand",
        planet: "Khoros",
        rarity: "Rare",
        power: 2900,
        bounty: 1400,
        image: "https://qu.ax/gYvX.png"
    },
    {
        id: "xlr8",
        name: "XLR8",
        species: "Kineceleran",
        planet: "Kinet",
        rarity: "Epic",
        power: 3600,
        bounty: 2100,
        image: "https://qu.ax/uHqj.png"
    },
    {
        id: "diamondhead",
        name: "Diamondhead",
        species: "Petrosapien",
        planet: "Petropia",
        rarity: "Epic",
        power: 3800,
        bounty: 2250,
        image: "https://qu.ax/tJpZ.png"
    },
    {
        id: "upgrade",
        name: "Upgrade",
        species: "Galvanic Mechamorph",
        planet: "Galvan B",
        rarity: "Rare",
        power: 3100,
        bounty: 1650,
        image: "https://qu.ax/kJwM.png"
    },
    {
        id: "waybig",
        name: "Way Big",
        species: "To'kustar",
        planet: "Cosmic Storms",
        rarity: "Legendary",
        power: 6500,
        bounty: 5000,
        image: "https://qu.ax/vLkN.png"
    },
    {
        id: "alienx",
        name: "Alien X",
        species: "Celestialsapien",
        planet: "Forge of Creation",
        rarity: "Celestial",
        power: 9999,
        bounty: 10000,
        image: "https://qu.ax/qWzY.png"
    },
    {
        id: "swampfire",
        name: "Swampfire",
        species: "Methanosian",
        planet: "Methanos",
        rarity: "Epic",
        power: 3700,
        bounty: 2200,
        image: "https://qu.ax/mNpR.png"
    },
    {
        id: "humungousaur",
        name: "Humungousaur",
        species: "Vaxasaurian",
        planet: "Terradino",
        rarity: "Rare",
        power: 3300,
        bounty: 1750,
        image: "https://qu.ax/xTzK.png"
    }
];

global.activeAlienSpawns = global.activeAlienSpawns || {};

function generateCaptcha(length = 5) {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ─── SAFE AUTO-RETRY SPAWNER (Never crashes on bad links) ──────
async function spawnAlienCard(sock, jid) {
    let chosenAlien = null;
    let imageBuffer = null;

    // Shuffle and pick the first alien that buffers successfully
    const shuffled = [...ALIEN_DATABASE].sort(() => 0.5 - Math.random());
    for (const alien of shuffled) {
        imageBuffer = await getMediaBuffer(alien.image);
        if (imageBuffer) {
            chosenAlien = alien;
            break;
        }
    }

    if (!chosenAlien || !imageBuffer) {
        console.error("❌ [BEN10] Could not buffer any alien image.");
        return;
    }

    const captcha = generateCaptcha(5);

    global.activeAlienSpawns[jid] = {
        alien: chosenAlien,
        captcha: captcha,
        spawnedAt: Date.now(),
        expiresAt: Date.now() + (5 * 60 * 1000)
    };

    const cardCaption =
        `🛸 *WILD ALIEN APPEARED!* 🛸\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⭐ *Name*       : ${chosenAlien.name}\n` +
        `🧬 *Species*    : ${chosenAlien.species}\n` +
        `🪐 *Planet*     : ${chosenAlien.planet}\n` +
        `🎖️ *Rarity*     : ${chosenAlien.rarity}\n` +
        `⚔️ *Power*      : ${chosenAlien.power.toLocaleString()}\n` +
        `💰 *Bounty*     : ${chosenAlien.bounty.toLocaleString()} Gold\n\n` +
        `🔒 *Captcha*    : \`${captcha}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Type *.upgrade ${captcha}* to secure DNA sample!_`;

    await sock.sendMessage(jid, {
        image: imageBuffer,
        mimetype: 'image/png',
        caption: cardCaption
    });
}

// ─── BACKGROUND AUTO-SPAWNER (30 Mins) ─────────────────────────
function startAutoSpawner(sock) {
    if (global.alienSpawnerInterval) clearInterval(global.alienSpawnerInterval);
    global.alienSpawnerInterval = setInterval(async () => {
        const settings = loadJSON(SETTINGS_FILE, {});
        const activeGroups = Object.keys(settings).filter(jid => isEnabled(settings[jid]));

        for (const groupJid of activeGroups) {
            try {
                await spawnAlienCard(sock, groupJid);
            } catch (e) {
                console.error(`❌ [BEN10 AUTO] Spawn error in ${groupJid}:`, e.message);
            }
        }
    }, 30 * 60 * 1000);
}

// ─── COMMAND HANDLERS ──────────────────────────────────────────

const alienCommand = {
    name: 'alien',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        await spawnAlienCard(sock, jid);
    }
};

const upgradeCommand = {
    name: 'upgrade',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const sender = normalizeToJid(msg.key.participant || msg.key.remoteJid).split(':')[0].split('@')[0] + '@s.whatsapp.net';
        const userNumber = sender.split('@')[0];

        const activeSpawn = global.activeAlienSpawns[jid];
        if (!activeSpawn || Date.now() > activeSpawn.expiresAt) {
            return sock.sendMessage(jid, { text: `❌ No active alien found! Spawn one with *.alien*` });
        }

        const inputCode = (args || '').trim().toUpperCase();
        if (!inputCode) {
            return sock.sendMessage(jid, { text: `⚠️ Captcha code required: \`.upgrade ${activeSpawn.captcha}\`` });
        }

        if (inputCode !== activeSpawn.captcha) {
            return sock.sendMessage(jid, { text: `❌ Invalid captcha code!` });
        }

        const claimedAlien = activeSpawn.alien;
        delete global.activeAlienSpawns[jid];

        const inventoryData = loadJSON(INVENTORY_FILE, {});
        if (!inventoryData[sender]) {
            inventoryData[sender] = { gold: 0, aliens: [] };
        }

        inventoryData[sender].gold += claimedAlien.bounty;
        inventoryData[sender].aliens.push({
            id: claimedAlien.id,
            name: claimedAlien.name,
            species: claimedAlien.species,
            rarity: claimedAlien.rarity,
            power: claimedAlien.power,
            capturedAt: new Date().toISOString()
        });

        saveJSON(INVENTORY_FILE, inventoryData);

        const successMessage =
            `🎉 *DNA SAMPLE SECURED!* 🎉\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👤 *Collector*  : @${userNumber}\n` +
            `🧬 *Alien*      : *${claimedAlien.name}* (${claimedAlien.species})\n` +
            `🎖️ *Rarity*     : ${claimedAlien.rarity}\n` +
            `⚔️ *Power*      : +${claimedAlien.power.toLocaleString()}\n` +
            `💰 *Bounty*     : +${claimedAlien.bounty.toLocaleString()} Gold\n\n` +
            `_Check collection with *.omnitrix*_`;

        await sock.sendMessage(jid, {
            text: successMessage,
            mentions: [sender]
        });
    }
};

const omnitrixCommand = {
    name: 'omnitrix',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const sender = normalizeToJid(msg.key.participant || msg.key.remoteJid).split(':')[0].split('@')[0] + '@s.whatsapp.net';
        const userNumber = sender.split('@')[0];

        const inventoryData = loadJSON(INVENTORY_FILE, {});
        const userProfile = inventoryData[sender];

        if (!userProfile || !userProfile.aliens || userProfile.aliens.length === 0) {
            return sock.sendMessage(jid, { 
                text: `📟 *OMNITRIX EMPTY*\n\n@${userNumber}, you haven't collected any aliens yet. Type *.alien* to start!`,
                mentions: [sender]
            });
        }

        const totalPower = userProfile.aliens.reduce((sum, a) => sum + (a.power || 0), 0);
        const uniqueCount = new Set(userProfile.aliens.map(a => a.id)).size;

        const alienList = userProfile.aliens.slice(-10).map((a, i) => {
            return `${i + 1}. *${a.name}* [${a.rarity}] - ⚡ ${a.power}`;
        }).join('\n');

        const profileText =
            `📟 *OMNITRIX ARCHIVE* 📟\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Wielder*     : @${userNumber}\n` +
            `💰 *Gold*        : ${userProfile.gold.toLocaleString()} Gold\n` +
            `🧬 *DNA Samples* : ${userProfile.aliens.length} (${uniqueCount}/${ALIEN_DATABASE.length} Unique)\n` +
            `⚔️ *Total Power* : ${totalPower.toLocaleString()}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📜 *Recent Acquisitions:*\n` +
            `${alienList}`;

        await sock.sendMessage(jid, {
            text: profileText,
            mentions: [sender]
        });
    }
};

const alienSpawnCommand = {
    name: 'alienspawn',
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
            return sock.sendMessage(jid, { text: `🛸 *Alien Spawner:* ${status}` });
        }

        if (option === 'on' || option === 'enable' || option === '1') {
            if (isCurrentlyEnabled) return sock.sendMessage(jid, { text: "ℹ️ Alien Spawner is already enabled." });
            settings[jid] = true;
            saveJSON(SETTINGS_FILE, settings);
            startAutoSpawner(sock);
            return sock.sendMessage(jid, { text: "✅ *Ben 10 Auto-Spawner enabled.*" });
        }

        if (option === 'off' || option === 'disable' || option === '0') {
            if (!isCurrentlyEnabled) return sock.sendMessage(jid, { text: "ℹ️ Alien Spawner is already disabled." });
            delete settings[jid];
            saveJSON(SETTINGS_FILE, settings);
            return sock.sendMessage(jid, { text: "🛑 *Ben 10 Auto-Spawner disabled.*" });
        }

        return sock.sendMessage(jid, { text: "⚠️ Usage: *.alienspawn on* | *off* | *status*" });
    }
};

module.exports = [
    alienCommand,
    upgradeCommand,
    omnitrixCommand,
    alienSpawnCommand
];