// helpers/SubBotManager.js
//
// Lets other people pair THIS bot to their own WhatsApp number via .addbot,
// without deploying their own server. Each accepted number gets its own
// independent Baileys socket + auth folder, but all sub-bots share the
// same command set (commands.js) and config as the main bot — they are
// separate WhatsApp connections, not separate bot personalities.
//
// This is genuinely resource-heavy: every sub-bot is a live WebSocket
// connection with its own reconnect loop. Keep an eye on how many you
// approve if you're on a small host/dyno.

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const config = require('../config');
const { normalizeToJid } = require('../stateManager');

const SUBBOTS_DIR = path.join(__dirname, '../storage/sub_sessions');
const REGISTRY_PATH = path.join(__dirname, '../storage/subbots.json');

// phoneNumber (digits only) -> { sock, ownerJid, status }
global.subBotSockets = global.subBotSockets || new Map();

function readRegistry() {
    try {
        if (fs.existsSync(REGISTRY_PATH)) {
            return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error('⚠️ [SUBBOT] Registry unreadable, resetting:', e.message);
    }
    return {};
}

function saveRegistry(data) {
    try {
        const dir = path.dirname(REGISTRY_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('⚠️ [SUBBOT] Failed to save registry:', e.message);
    }
}

function isActive(phoneNumber) {
    const entry = global.subBotSockets.get(phoneNumber);
    return !!(entry && entry.status === 'connected');
}

function listActive() {
    return [...global.subBotSockets.entries()].map(([number, entry]) => ({
        number,
        status: entry.status,
        ownerJid: entry.ownerJid,
        connectedAt: entry.connectedAt
    }));
}

/**
 * Spins up a new sub-bot socket for phoneNumber and requests a pairing code.
 * onCode(code, qrPngBuffer) fires once the code is ready — the caller
 * (the .addbot command) uses this to message the requester.
 * Resolves once the pairing code has been delivered (not once WA connects).
 */
async function createSubBot(phoneNumber, requesterJid, onCode) {
    if (global.subBotSockets.has(phoneNumber)) {
        throw new Error(`A sub-bot for ${phoneNumber} is already ${isActive(phoneNumber) ? 'connected' : 'pairing'}. Use ${config.prefix}delbot ${phoneNumber} first if you want to re-pair.`);
    }

    const {
        default: makeWASocket,
        useMultiFileAuthState,
        Browsers,
        DisconnectReason
    } = await import('@itsliaaa/baileys');

    const authFolder = path.join(SUBBOTS_DIR, phoneNumber);
    if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false
    });

    const entry = { sock, ownerJid: requesterJid, status: 'pairing', connectedAt: null };
    global.subBotSockets.set(phoneNumber, entry);

    sock.ev.on('creds.update', saveCreds);

    let codeRequested = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (!state.creds.registered && !codeRequested) {
            codeRequested = true;
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    let qrBuffer = null;
                    try {
                        qrBuffer = await QRCode.toBuffer(code, { margin: 2, scale: 8 });
                    } catch (e) { /* QR is a visual nicety — code still works without it */ }
                    onCode(code, qrBuffer);
                } catch (e) {
                    console.error(`❌ [SUBBOT ${phoneNumber}] Pairing code request failed:`, e.message);
                    entry.status = 'failed';
                }
            }, 3000);
        }

        if (connection === 'open') {
            entry.status = 'connected';
            entry.connectedAt = Date.now();
            console.log(`✅ [SUBBOT] ${phoneNumber} connected.`);

            const registry = readRegistry();
            registry[phoneNumber] = { ownerJid: requesterJid, createdAt: registry[phoneNumber]?.createdAt || Date.now() };
            saveRegistry(registry);
        }

        if (connection === 'close') {
            const { Boom } = require('@hapi/boom');
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;

            if (reason === DisconnectReason.loggedOut) {
                console.log(`🧹 [SUBBOT] ${phoneNumber} logged out — removing session.`);
                try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch (e) {}
                const registry = readRegistry();
                delete registry[phoneNumber];
                saveRegistry(registry);
                global.subBotSockets.delete(phoneNumber);
                return;
            }

            // Otherwise reconnect this sub-bot the same way the main bot does.
            entry.status = 'reconnecting';
            setTimeout(() => {
                global.subBotSockets.delete(phoneNumber);
                createSubBot(phoneNumber, requesterJid, () => {}).catch(() => {});
            }, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const { handleIncomingMessage } = require('./Infinity');
            global.subBotSentIds = global.subBotSentIds || new Set();
            await handleIncomingMessage(sock, chatUpdate, global.subBotSentIds);
        } catch (e) {
            console.error(`⚠️ [SUBBOT ${phoneNumber}] Message handling error:`, e.message);
        }
    });

    return sock;
}

/** Tears down and forgets a sub-bot. */
async function removeSubBot(phoneNumber) {
    const entry = global.subBotSockets.get(phoneNumber);
    if (!entry) return false;

    try {
        entry.sock.ev.removeAllListeners();
        if (entry.sock.ws) entry.sock.ws.close();
        await entry.sock.logout().catch(() => {});
    } catch (e) { /* ignore */ }

    const authFolder = path.join(SUBBOTS_DIR, phoneNumber);
    try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch (e) {}

    global.subBotSockets.delete(phoneNumber);
    const registry = readRegistry();
    delete registry[phoneNumber];
    saveRegistry(registry);
    return true;
}

/** Reconnects every previously-registered sub-bot — call this once on boot. */
async function restoreSubBots() {
    const registry = readRegistry();
    const numbers = Object.keys(registry);
    if (numbers.length === 0) return;

    console.log(`🔄 [SUBBOT] Restoring ${numbers.length} sub-bot session(s)...`);
    for (const number of numbers) {
        const authFolder = path.join(SUBBOTS_DIR, number);
        if (!fs.existsSync(authFolder)) {
            delete registry[number];
            continue;
        }
        try {
            await createSubBot(number, registry[number].ownerJid, () => {});
        } catch (e) {
            console.error(`⚠️ [SUBBOT] Failed to restore ${number}:`, e.message);
        }
    }
    saveRegistry(registry);
}

module.exports = { createSubBot, removeSubBot, restoreSubBots, listActive, isActive };
