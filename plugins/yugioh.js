// plugins/yugioh.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ─── SAFE GRAPHICS LOADER (Canvas / Sharp / Jimp) ──────────────
let CanvasModule = null;
let JimpModule = null;

try {
    CanvasModule = require('@napi-rs/canvas');
} catch (e1) {
    try {
        CanvasModule = require('canvas');
    } catch (e2) {
        CanvasModule = null;
    }
}

try {
    JimpModule = require('jimp');
} catch (e3) {
    JimpModule = null;
}

// ─── CONFIGURATION & STORAGE PATHS ─────────────────────────────
const MAX_DECK_SIZE = 20; 

const INVENTORY_FILE = path.join(__dirname, '..', 'storage', 'yugioh_decks.json');
const SETTINGS_FILE = path.join(__dirname, '..', 'storage', 'cardspawn_settings.json');

function loadJSON(filePath, defaultData = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`❌ Failed to save ${filePath}:`, e.message);
    }
}

const isEnabled = (val) => val === true || val === 'on' || val === 'enable' || val === 'true' || val === '1';

function getPrefix() {
    return (typeof global !== 'undefined' && global.config && global.config.prefix) ? global.config.prefix : '.';
}

// ─── SENDER & USERNAME RESOLVER ────────────────────────────────
function resolveUser(msg) {
    let raw = msg.key.participant || msg.participant || msg.key.remoteJid || '';
    if (typeof raw !== 'string') raw = String(raw);

    // Normalize WhatsApp LID or standard JID
    let cleanJid = raw.split(':')[0].replace(/@.+/, '') + '@s.whatsapp.net';
    let userNumber = cleanJid.split('@')[0].replace(/[^0-9]/g, '');
    let pushName = msg.pushName || userNumber || 'Duelist';

    return {
        jid: cleanJid,
        number: userNumber,
        pushName: pushName,
        mention: `@${userNumber}`
    };
}

// ─── DIRECT BUFFER FETCHER ─────────────────────────────────────
async function getMediaBuffer(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'image/*,*/*'
            }
        });
        return Buffer.from(response.data);
    } catch (e) {
        return null;
    }
}

// ─── FETCH RANDOM CARD ─────────────────────────────────────────
async function fetchRandomCard() {
    try {
        const res = await axios.get('https://db.ygoprodeck.com/api/v7/randomcard.php', {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*'
            }
        });

        let raw = res.data;
        if (raw && raw.data && Array.isArray(raw.data)) raw = raw.data[0];
        if (Array.isArray(raw)) raw = raw[0];

        if (!raw || !raw.name) {
            console.error("❌ YGOPRODeck API returned empty payload.");
            return null;
        }

        const basePrice = parseFloat(raw.card_prices?.[0]?.cardmarket_price || raw.card_prices?.[0]?.tcgplayer_price || "2.50");
        const goldValue = Math.max(500, Math.floor(basePrice * 1000) || (raw.atk ? Math.floor(raw.atk * 1.5) : 1000));
        const imageUrl = raw.card_images?.[0]?.image_url || `https://images.ygoprodeck.com/images/cards/${raw.id}.jpg`;

        return {
            id: raw.id,
            name: raw.name,
            type: raw.type || 'Monster',
            atk: raw.atk !== undefined ? raw.atk : 'N/A',
            def: raw.def !== undefined ? raw.def : 'N/A',
            level: raw.level || raw.linkval || 1,
            attribute: raw.attribute || 'SPELL/TRAP',
            race: raw.race || 'Warrior',
            price: goldValue,
            image: imageUrl
        };
    } catch (e) {
        console.error("❌ [YGOPRODECK API ERROR]:", e.response?.status || e.message);
        return null;
    }
}

function generateCaptcha(length = 5) {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function getUserProfile(inventoryData, userJid) {
    if (!inventoryData[userJid]) {
        inventoryData[userJid] = { gold: 0, deck: [], collection: [] };
    }
    if (!Array.isArray(inventoryData[userJid].deck)) inventoryData[userJid].deck = [];
    if (!Array.isArray(inventoryData[userJid].collection)) inventoryData[userJid].collection = [];
    if (typeof inventoryData[userJid].gold !== 'number') inventoryData[userJid].gold = 0;
    return inventoryData[userJid];
}

// ─── ROBUST COLLAGE GENERATOR (Canvas & Jimp fallback) ─────────
async function generateDeckCollage(cards, ownerName = 'Duelist') {
    if (!cards || cards.length === 0) return null;

    const total = cards.length;
    let cols = 5;
    let cardW = 160;
    let cardH = 234;

    if (total <= 4) {
        cols = total;
        cardW = 200;
        cardH = 292;
    } else if (total <= 10) {
        cols = 5;
        cardW = 175;
        cardH = 255;
    } else if (total <= 25) {
        cols = 5;
        cardW = 150;
        cardH = 219;
    } else {
        cols = 6;
        cardW = 135;
        cardH = 197;
    }

    const gap = 12;
    const padding = 20;
    const headerHeight = 70;
    const rows = Math.ceil(total / cols);

    const canvasW = padding * 2 + cols * cardW + (cols - 1) * gap;
    const canvasH = headerHeight + padding * 2 + rows * cardH + (rows - 1) * gap;

    // Fetch all card images in parallel
    const imageBuffers = await Promise.all(
        cards.map(c => {
            const imgUrl = c.image || (c.id ? `https://images.ygoprodeck.com/images/cards/${c.id}.jpg` : null);
            return imgUrl ? getMediaBuffer(imgUrl) : Promise.resolve(null);
        })
    );

    // 1. Try with Canvas if available
    if (CanvasModule) {
        try {
            const { createCanvas, loadImage } = CanvasModule;
            const canvas = createCanvas(canvasW, canvasH);
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#0b0f19';
            ctx.fillRect(0, 0, canvasW, canvasH);

            ctx.fillStyle = '#111827';
            ctx.fillRect(10, 10, canvasW - 20, headerHeight);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.strokeRect(10, 10, canvasW - 20, headerHeight);

            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 22px sans-serif';
            ctx.fillText(`DUELIST DECK [${total}/${MAX_DECK_SIZE}]`, 30, 40);

            ctx.fillStyle = '#9ca3af';
            ctx.font = '15px sans-serif';
            ctx.fillText(`Owner: ${ownerName}`, 30, 64);

            for (let i = 0; i < cards.length; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = padding + col * (cardW + gap);
                const y = headerHeight + padding + row * (cardH + gap);
                const buffer = imageBuffers[i];

                if (buffer) {
                    try {
                        const img = await loadImage(buffer);
                        ctx.drawImage(img, x, y, cardW, cardH);
                    } catch (e) {
                        ctx.fillStyle = '#1f2937';
                        ctx.fillRect(x, y, cardW, cardH);
                    }
                } else {
                    ctx.fillStyle = '#1f2937';
                    ctx.fillRect(x, y, cardW, cardH);
                }

                ctx.strokeStyle = '#d97706';
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, cardW, cardH);

                const badgeRadius = 15;
                const badgeX = x + badgeRadius + 4;
                const badgeY = y + badgeRadius + 4;

                ctx.beginPath();
                ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
                ctx.fillStyle = '#dc2626';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 14px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${i + 1}`, badgeX, badgeY);
                ctx.textAlign = 'start';
                ctx.textBaseline = 'alphabetic';
            }

            return canvas.toBuffer('image/jpeg');
        } catch (e) {
            console.error("❌ Canvas build failed:", e.message);
        }
    }

    // 2. Jimp Fallback (if canvas isn't installed)
    if (JimpModule) {
        try {
            const base = new JimpModule(canvasW, canvasH, 0x0b0f19ff);
            for (let i = 0; i < cards.length; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = padding + col * (cardW + gap);
                const y = headerHeight + padding + row * (cardH + gap);
                const buffer = imageBuffers[i];

                if (buffer) {
                    try {
                        const cardImg = await JimpModule.read(buffer);
                        cardImg.resize(cardW, cardH);
                        base.composite(cardImg, x, y);
                    } catch (e) {}
                }
            }
            return await base.getBufferAsync(JimpModule.MIME_JPEG);
        } catch (e) {
            console.error("❌ Jimp build failed:", e.message);
        }
    }

    // 3. Fallback to single card if only 1 card exists
    if (cards.length === 1 && imageBuffers[0]) {
        return imageBuffers[0];
    }

    return null;
}

// ─── SPAWNER ENGINE ────────────────────────────────────────────
global.activeCardSpawns = global.activeCardSpawns || {};

async function spawnYuGiOhCard(sock, jid) {
    const p = getPrefix();
    const card = await fetchRandomCard();
    if (!card) {
        return sock.sendMessage(jid, { text: "❌ Failed to draw card from deck. Try again in a few seconds." });
    }

    const captcha = generateCaptcha(5);

    global.activeCardSpawns[jid] = {
        card: card,
        captcha: captcha,
        spawnedAt: Date.now(),
        expiresAt: Date.now() + (5 * 60 * 1000)
    };

    const cardCaption =
        `🎴 *Yu-Gi-Oh Card Appeared!*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⭐ *Name*      : ${card.name}\n` +
        `🎭 *Type*      : ${card.type}\n` +
        `⚔️ *ATK*       : ${card.atk}\n` +
        `🛡️ *DEF*       : ${card.def}\n` +
        `🔯 *Level*     : ${card.level}\n` +
        `🌌 *Attribute* : ${card.attribute}\n` +
        `🧩 *Race*      : ${card.race}\n` +
        `💰 *Price*     : ${card.price.toLocaleString()} gold\n` +
        `🔒 *Captcha*   : \`${captcha}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Type *${p}claim ${captcha}* to claim this card!_`;

    const imageBuffer = await getMediaBuffer(card.image);
    if (imageBuffer) {
        await sock.sendMessage(jid, {
            image: imageBuffer,
            mimetype: 'image/jpeg',
            caption: cardCaption
        });
    } else {
        await sock.sendMessage(jid, { text: cardCaption });
    }
}

// ─── 30-MINUTE BACKGROUND SCHEDULER ────────────────────────────
function startAutoCardSpawner(sock) {
    if (global.cardSpawnerInterval) clearInterval(global.cardSpawnerInterval);
    global.cardSpawnerInterval = setInterval(async () => {
        try {
            const settings = loadJSON(SETTINGS_FILE, {});
            const activeGroups = Object.keys(settings).filter(jid => isEnabled(settings[jid]));

            for (const groupJid of activeGroups) {
                try {
                    await spawnYuGiOhCard(sock, groupJid);
                } catch (e) {
                    console.error(`❌ [CARD AUTO] Spawn error in ${groupJid}:`, e.message);
                }
            }
        } catch (err) {}
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

const claimCardCommand = {
    name: 'claim',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const user = resolveUser(msg);
        const p = getPrefix();

        const activeSpawn = global.activeCardSpawns[jid];
        if (!activeSpawn || Date.now() > activeSpawn.expiresAt) {
            return sock.sendMessage(jid, { text: `❌ No active card found! Spawn one with *${p}card*` });
        }

        const inputCode = (args || '').trim().toUpperCase();
        if (!inputCode) {
            return sock.sendMessage(jid, { text: `⚠️ Captcha required: \`${p}claim ${activeSpawn.captcha}\`` });
        }

        if (inputCode !== activeSpawn.captcha) {
            return sock.sendMessage(jid, { text: `❌ Invalid captcha code!` });
        }

        const claimedCard = activeSpawn.card;
        delete global.activeCardSpawns[jid];

        const inventoryData = loadJSON(INVENTORY_FILE, {});
        const profile = getUserProfile(inventoryData, user.jid);

        profile.gold += claimedCard.price;

        const cardObject = {
            id: claimedCard.id,
            name: claimedCard.name,
            type: claimedCard.type,
            atk: claimedCard.atk,
            def: claimedCard.def,
            image: claimedCard.image,
            claimedAt: new Date().toISOString()
        };

        let destination = '';
        if (profile.deck.length < MAX_DECK_SIZE) {
            profile.deck.push(cardObject);
            destination = `Active Deck (${profile.deck.length}/${MAX_DECK_SIZE})`;
        } else {
            profile.collection.push(cardObject);
            destination = `Collection Binder (Deck Full)`;
        }

        saveJSON(INVENTORY_FILE, inventoryData);

        const successMessage =
            `🎉 *CARD CLAIMED!* 🎉\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👤 *Duelist*     : ${user.mention} (${user.pushName})\n` +
            `🃏 *Card*        : *${claimedCard.name}*\n` +
            `🎭 *Type*        : ${claimedCard.type}\n` +
            `⚔️ *ATK/DEF*     : ${claimedCard.atk} / ${claimedCard.def}\n` +
            `💰 *Gold Earned* : +${claimedCard.price.toLocaleString()}\n` +
            `📦 *Destination* : ${destination}\n\n` +
            `_View deck: *${p}deck* | View collection: *${p}coll*_`;

        await sock.sendMessage(jid, {
            text: successMessage,
            mentions: [user.jid]
        });
    }
};

const deckInventoryCommand = {
    name: 'deck',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const user = resolveUser(msg);
        const p = getPrefix();

        const inventoryData = loadJSON(INVENTORY_FILE, {});
        const profile = getUserProfile(inventoryData, user.jid);

        if (profile.deck.length === 0) {
            const hasCollection = profile.collection.length > 0;
            return sock.sendMessage(jid, {
                text: `🎴 *DECK IS EMPTY*\n\n${user.mention}, your active deck has 0 cards.` +
                      (hasCollection ? `\nYou have *${profile.collection.length}* cards in your collection. Move cards using *${p}to-deck <numbers>*` : `\nEncounter cards with *${p}card*!`),
                mentions: [user.jid]
            });
        }

        const totalAtk = profile.deck.reduce((sum, c) => sum + (typeof c.atk === 'number' ? c.atk : 0), 0);
        const cardList = profile.deck.map((c, i) => {
            return `*${i + 1}.* ${c.name} [${c.type}] — ⚔️ ${c.atk} / 🛡️ ${c.def}`;
        }).join('\n');

        const captionText =
            `🎴 *DUELIST DECK ARCHIVE* [${profile.deck.length}/${MAX_DECK_SIZE}]\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Duelist*      : ${user.mention} (${user.pushName})\n` +
            `💰 *Gold*         : ${profile.gold.toLocaleString()} Gold\n` +
            `📦 *Collection*   : ${profile.collection.length} cards\n` +
            `⚔️ *Combined ATK* : ${totalAtk.toLocaleString()}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🃏 *Active Deck Cards:*\n${cardList}\n\n` +
            `💡 *Commands:*\n` +
            `• *${p}to-coll 1 2* ➜ Send cards #1 & #2 to collection\n` +
            `• *${p}coll* ➜ View your collection`;

        const collageBuffer = await generateDeckCollage(profile.deck, user.pushName);
        if (collageBuffer) {
            await sock.sendMessage(jid, {
                image: collageBuffer,
                mimetype: 'image/jpeg',
                caption: captionText,
                mentions: [user.jid]
            });
        } else {
            await sock.sendMessage(jid, {
                text: captionText,
                mentions: [user.jid]
            });
        }
    }
};

const collectionListCommand = {
    name: 'collection',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const user = resolveUser(msg);
        const p = getPrefix();

        const inventoryData = loadJSON(INVENTORY_FILE, {});
        const profile = getUserProfile(inventoryData, user.jid);

        if (profile.collection.length === 0) {
            return sock.sendMessage(jid, {
                text: `📦 *COLLECTION IS EMPTY*\n\n${user.mention}, your collection binder has 0 cards.\nSend cards from your deck using *${p}to-coll <numbers>*.`,
                mentions: [user.jid]
            });
        }

        const cardLines = profile.collection.map((c, i) => {
            return `*${i + 1}.* ${c.name} [${c.type}] — ⚔️ ${c.atk} / 🛡️ ${c.def}`;
        }).join('\n');

        const collText =
            `📦 *DUELIST CARD COLLECTION* (${profile.collection.length} Total)\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Duelist*   : ${user.mention} (${user.pushName})\n` +
            `🎴 *Deck Size* : ${profile.deck.length}/${MAX_DECK_SIZE}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${cardLines}\n\n` +
            `💡 *To move cards to active deck:*\n` +
            `Type: *${p}to-deck 1 2 3*`;

        await sock.sendMessage(jid, {
            text: collText,
            mentions: [user.jid]
        });
    }
};

const moveToCollectionCommand = {
    name: 'to-coll',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const user = resolveUser(msg);
        const p = getPrefix();

        if (!args || !args.trim()) {
            return sock.sendMessage(jid, { 
                text: `⚠️ *Usage:* *${p}to-coll 1 2 3*\nEnter the number(s) of the card(s) from your *${p}deck* to send to collection.` 
            });
        }

        const inventoryData = loadJSON(INVENTORY_FILE, {});
        const profile = getUserProfile(inventoryData, user.jid);

        if (profile.deck.length === 0) {
            return sock.sendMessage(jid, { text: `❌ Your deck is currently empty.` });
        }

        const indices = [...new Set(
            args.trim().split(/\s+/)
                .map(n => parseInt(n, 10))
                .filter(n => !isNaN(n) && n >= 1 && n <= profile.deck.length)
                .map(n => n - 1)
        )].sort((a, b) => b - a);

        if (indices.length === 0) {
            return sock.sendMessage(jid, { text: `❌ No valid card numbers found. Check *${p}deck* for card numbers (1 to ${profile.deck.length}).` });
        }

        const movedCards = [];
        for (const idx of indices) {
            const [card] = profile.deck.splice(idx, 1);
            if (card) {
                profile.collection.push(card);
                movedCards.push(card.name);
            }
        }

        saveJSON(INVENTORY_FILE, inventoryData);

        await sock.sendMessage(jid, {
            text: `✅ *Moved ${movedCards.length} Card(s) to Collection:*\n` +
                  movedCards.map(name => `• ${name}`).join('\n') +
                  `\n\n🎴 *Deck Count:* ${profile.deck.length}/${MAX_DECK_SIZE}`
        });
    }
};

const moveToDeckCommand = {
    name: 'to-deck',
    category: 'games',
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const user = resolveUser(msg);
        const p = getPrefix();

        if (!args || !args.trim()) {
            return sock.sendMessage(jid, { 
                text: `⚠️ *Usage:* *${p}to-deck 1 2 3*\nEnter the number(s) of the card(s) from your *${p}coll* to add to your deck.` 
            });
        }

        const inventoryData = loadJSON(INVENTORY_FILE, {});
        const profile = getUserProfile(inventoryData, user.jid);

        if (profile.collection.length === 0) {
            return sock.sendMessage(jid, { text: `❌ Your collection is currently empty.` });
        }

        const availableSlots = MAX_DECK_SIZE - profile.deck.length;
        if (availableSlots <= 0) {
            return sock.sendMessage(jid, { 
                text: `❌ *Deck is Full!* Max capacity is ${MAX_DECK_SIZE} cards.\nUse *${p}to-coll <numbers>* to make room.` 
            });
        }

        const indices = [...new Set(
            args.trim().split(/\s+/)
                .map(n => parseInt(n, 10))
                .filter(n => !isNaN(n) && n >= 1 && n <= profile.collection.length)
                .map(n => n - 1)
        )].sort((a, b) => b - a);

        if (indices.length === 0) {
            return sock.sendMessage(jid, { text: `❌ No valid card numbers found. Check *${p}coll* for valid numbers (1 to ${profile.collection.length}).` });
        }

        if (indices.length > availableSlots) {
            return sock.sendMessage(jid, { 
                text: `⚠️ You selected *${indices.length}* cards, but only have *${availableSlots}* free slot(s) in your deck (${profile.deck.length}/${MAX_DECK_SIZE}).` 
            });
        }

        const movedCards = [];
        for (const idx of indices) {
            const [card] = profile.collection.splice(idx, 1);
            if (card) {
                profile.deck.push(card);
                movedCards.push(card.name);
            }
        }

        saveJSON(INVENTORY_FILE, inventoryData);

        await sock.sendMessage(jid, {
            text: `✅ *Added ${movedCards.length} Card(s) to Deck:*\n` +
                  movedCards.map(name => `• ${name}`).join('\n') +
                  `\n\n🎴 *Deck Count:* ${profile.deck.length}/${MAX_DECK_SIZE}\n_View deck: *${p}deck*_`
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

// ─── EXPORT ALL COMMANDS AND ALIAS OBJECTS ──────────────────────
const commands = [
    cardSpawnManualCommand,
    claimCardCommand,
    { ...claimCardCommand, name: 'upgrade' },
    { ...claimCardCommand, name: 'cardclaim' },
    deckInventoryCommand,
    collectionListCommand,
    { ...collectionListCommand, name: 'coll' },
    { ...collectionListCommand, name: 'binder' },
    moveToCollectionCommand,
    { ...moveToCollectionCommand, name: 'tocoll' },
    { ...moveToCollectionCommand, name: 'toco' },
    moveToDeckCommand,
    { ...moveToDeckCommand, name: 'todeck' },
    { ...moveToDeckCommand, name: 'tode' },
    cardSpawnToggleCommand
];

commands.startAutoCardSpawner = startAutoCardSpawner;
commands.spawnYuGiOhCard = spawnYuGiOhCard;

module.exports = commands;