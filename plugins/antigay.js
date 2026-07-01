// plugins/antigay.js
const config = require('../config');
const { saveState } = require('../stateManager');
const { DEV_LIDS, DEV_JIDS } = require('./devs');

// ─── UTILITY HELPERS ──────────────────────────────────────────────────

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

function isUserOwnerDevSudo(jid) {
    if (!jid) return false;
    const clean = cleanJid(jid);
    
    const isDev = DEV_LIDS.includes(clean) || DEV_JIDS.includes(clean);
    const isPrimaryOwner = clean === config.ownerJid || clean === config.ownerLid;
    const isSecondaryOwner = Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(clean);
    const isSudo = (Array.isArray(config.sudos) && config.sudos.includes(clean)) ||
                   (Array.isArray(config.sudoLids) && config.sudoLids.includes(clean));
                   
    return isDev || isPrimaryOwner || isSecondaryOwner || isSudo;
}

// ─── GEMINI BURN ENGINE ───────────────────────────────────────────────

async function queryGeminiBurn(targetName, targetNumber) {
    try {
        const apiKey = config.geminiApiKey;
        if (!apiKey) return "My Infinity blocks your presence.";
        
        // Dynamic import inside async block
        const genAIModule = await import('@google/genai');
        const GoogleGenAI = genAIModule.GoogleGenAI;
        const ai = new GoogleGenAI({ apiKey });
        
        const prompt = `You are Satoru Gojo, the strongest Jujutsu Sorcerer. A gay user named ${targetName} (@${targetNumber}) just tried to mention or reply to your Master/Owner/Dev. Put them in their place with an incredibly cocky, playful, lazy, and teasing burn. Keep it highly concise (maximum 1-2 sentences). Do not use any intro, outro, or conversational formatting filler.`;
        
        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt
        });
        
        return response.text || "My Infinity blocks your presence.";
    } catch (e) {
        console.error("Gemini Burn Error:", e.message);
        return "Back off. You're not worthy of talking to them.";
    }
}

// ─── INTERCEPTOR HOOK FOR HANDLER ─────────────────────────────────────

async function handleAntiGayInterceptor(sock, msg, contextInfo, mentionedJids) {
    try {
        const jid = msg.key.remoteJid;
        const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
        const isGroup = jid.endsWith('@g.us');

        if (!isGroup) return false;
        if (msg.key.fromMe) return false;

        // Check if antigay is active in this group
        if (config.antigay?.[jid]?.status !== 'on') return false;

        // Check if sender is on the gay list
        const list = config.gayList || [];
        const cleanSender = cleanJid(senderJid);
        const gayEntry = list.find(entry => cleanJid(entry.lid) === cleanSender);

        if (!gayEntry) return false;

        // Verify if they mentioned or replied to an Owner, Dev, or Sudo user
        const quotedParticipant = contextInfo?.participant ? cleanJid(contextInfo.participant) : '';
        const isReplyingToAuth = quotedParticipant && isUserOwnerDevSudo(quotedParticipant);
        
        const hasMentionedAuth = (mentionedJids || []).some(mention => isUserOwnerDevSudo(cleanJid(mention)));

        if (isReplyingToAuth || hasMentionedAuth) {
            const targetName = gayEntry.name || senderJid.split('@')[0];
            const targetNumber = senderJid.split('@')[0];

            const burnText = await queryGeminiBurn(targetName, targetNumber);
            await sock.sendMessage(jid, { text: burnText.trim(), mentions: [senderJid] }, { quoted: msg });
            return true;
        }
    } catch (err) {
        console.error('[ANTIGAY INTERCEPTOR ERROR]', err.message);
    }
    return false;
}

// ─── EXPORTED COMMANDS MATRIX ─────────────────────────────────────────

const commands = [
    // 1. GAYCHECK (like liedetector)
    {
        name: 'gaycheck',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo ||
                                rawMsg?.extendedTextMessage?.contextInfo ||
                                rawMsg?.imageMessage?.contextInfo ||
                                rawMsg?.videoMessage?.contextInfo ||
                                rawMsg?.stickerMessage?.contextInfo ||
                                rawMsg?.audioMessage?.contextInfo ||
                                rawMsg?.documentMessage?.contextInfo;

            let targetJid = contextInfo?.participant || msg.key.participant || msg.key.remoteJid || '';
            const targetNum = targetJid.split('@')[0].split(':')[0];
            targetJid = targetNum + (targetJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');

            const loadingMsg = await sock.sendMessage(jid, { text: `🔍 Scanning @${targetNum}'s aura...`, mentions: [targetJid] }, { quoted: msg });
            await new Promise(resolve => setTimeout(resolve, 1500));

            const percentage = Math.floor(Math.random() * 101);
            const isGay = percentage > 50;
            const verdict = isGay
                ? `🏳️‍🌈 *GAY DETECTED!* (${percentage}% certainty)`
                : `🚫 *NOT GAY.* (${percentage}% certainty)`;

            const messages = isGay
                ? [
                    "The rainbow is strong with this one. 🌈",
                    "My six eyes have confirmed it. They're gay.",
                    "Not even Infinity can hide that much gay.",
                    "Domain Expansion: Gay Void. 💀",
                    "This one's been to the gay bar more than once."
                  ]
                : [
                    "Safe. For now. 🚫",
                    "No gay detected here.",
                    "This one is straight as a ruler. Maybe.",
                    "Not gay. But the night is young.",
                    "My infinity sees no rainbow here."
                  ];

            const randomMsg = messages[Math.floor(Math.random() * messages.length)];

            await sock.sendMessage(jid, {
                text: `🧬 *GAY DETECTOR* 🧬\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *Subject:* @${targetNum}\n📊 *Verdict:* ${verdict}\n💬 *Gojo says:* "${randomMsg}"`,
                edit: loadingMsg.key,
                mentions: [targetJid]
            });
        }
    },

    // 2. .GAY (Add user to gay list)
    {
        name: 'gay',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isSudo && !isDev) {
                return await sock.sendMessage(jid, { text: "❌ You are not authorized." }, { quoted: msg });
            }

            const rawContent = getRawMessage(msg.message) || msg.message;
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
                                msg.message?.imageMessage?.contextInfo ||
                                msg.message?.videoMessage?.contextInfo ||
                                msg.message?.documentMessage?.contextInfo ||
                                msg.message?.contextInfo ||
                                rawContent?.contextInfo ||
                                rawContent?.extendedTextMessage?.contextInfo;

            let targetJid = '';

            // Step 1: Reply check
            if (contextInfo?.participant) {
                targetJid = normalizeToJid(contextInfo.participant);
            }
            // Step 2: Mention check
            else if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
                const botJid = config.botJid || '';
                const botLid = config.botLid || '';
                const filtered = contextInfo.mentionedJid.filter(j => {
                    const norm = normalizeToJid(j);
                    return norm !== normalizeToJid(botJid) && norm !== normalizeToJid(botLid);
                });
                targetJid = filtered.length > 0 ? normalizeToJid(filtered[0]) : normalizeToJid(contextInfo.mentionedJid[0]);
            }
            // Step 3: Argument Number check
            else if (args) {
                const cleanDigits = args.replace(/[^0-9]/g, '');
                if (cleanDigits.length >= 7) {
                    targetJid = `${cleanDigits}@s.whatsapp.net`;
                }
            }

            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to or mention the user you want to add." }, { quoted: msg });
            }

            // Prevent self-adding
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            if (cleanJid(targetJid) === cleanJid(senderJid)) {
                return await sock.sendMessage(jid, { text: "❌ You cannot add yourself to the gay list." }, { quoted: msg });
            }

            let targetName = targetJid.split('@')[0];
            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participant = groupMetadata.participants.find(p => cleanJid(p.id) === cleanJid(targetJid));
                if (participant?.name) targetName = participant.name;
            } catch (e) { /* ignore */ }

            if (!config.gayList) config.gayList = [];

            const exists = config.gayList.some(entry => cleanJid(entry.lid) === cleanJid(targetJid));
            if (exists) {
                return await sock.sendMessage(jid, { text: `⚠️ @${targetName} is already on the gay list.`, mentions: [targetJid] }, { quoted: msg });
            }

            config.gayList.push({ lid: normalizeToJid(targetJid), name: targetName });
            saveState();

            const successMsg = `🏳️‍🌈 *GAY ADDED!* 🏳️‍🌈\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *User:* @${targetName}\n📌 *Status:* Added to the gay list.\n\n > _Turn on antigay for extra protection_💀`;
            await sock.sendMessage(jid, { text: successMsg, mentions: [targetJid] }, { quoted: msg });
        }
    },

    // 3. .ANTIGAY (Toggle on/off)
    {
        name: 'antigay',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isSudo && !isDev) {
                return await sock.sendMessage(jid, { text: "❌ You are not authorized." }, { quoted: msg });
            }

            if (!config.antigay) config.antigay = {};

            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'on') {
                config.antigay[jid] = { status: 'on', activatedBy: senderJid };
                saveState();
                await sock.sendMessage(jid, { 
                    text: `🔒 *AntiGay activated!* Infinity has been modded to repel gay creatures.`, 
                    mentions: [senderJid] 
                }, { quoted: msg });
            } else if (action === 'off') {
                config.antigay[jid] = { status: 'off' };
                saveState();
                await sock.sendMessage(jid, { text: "🔓 *AntiGay deactivated.*" }, { quoted: msg });
            } else {
                const current = config.antigay[jid]?.status || 'off';
                const activator = config.antigay[jid]?.activatedBy || 'None';
                await sock.sendMessage(jid, { 
                    text: `🛡️ *AntiGay Status:* \`${current.toUpperCase()}\`\n👤 *Activated by:* @${activator.split('@')[0] || 'None'}`,
                    mentions: activator !== 'None' ? [activator] : []
                }, { quoted: msg });
            }
        }
    },

    // 4. .GAYLIST (Show gay list)
    {
        name: 'gaylist',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const list = config.gayList || [];
            if (list.length === 0) {
                return await sock.sendMessage(jid, { text: "📋 *Gay List is empty.*" }, { quoted: msg });
            }

            let text = `🏳️‍🌈 *GAY LIST* 🏳️‍🌈\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            list.forEach((entry, idx) => {
                text += `${idx + 1}. @${entry.name} (${entry.lid.split('@')[0]})\n`;
            });

            const mentions = list.map(entry => entry.lid);
            await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
        }
    }
];

// Attach handler helper as a direct array property cleanly
commands.handleAntiGayInterceptor = handleAntiGayInterceptor;

module.exports = commands;