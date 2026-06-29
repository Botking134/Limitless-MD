// plugins/group/group_security.js
const config = require('../../config');
const { saveState, normalizeToJid } = require('../../stateManager');
const { DEV_LIDS } = require('../devs');

// ─── GLOBAL ──────────────────────────────────────────────────────
global.silencedUsers = global.silencedUsers || {};

// ─── HELPERS ──────────────────────────────────────────────────────

function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

function parseTargetUser(msg, args) {
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo ||
                        rawMsg?.extendedTextMessage?.contextInfo ||
                        rawMsg?.imageMessage?.contextInfo ||
                        rawMsg?.videoMessage?.contextInfo ||
                        rawMsg?.stickerMessage?.contextInfo ||
                        rawMsg?.audioMessage?.contextInfo ||
                        rawMsg?.documentMessage?.contextInfo;

    const mentions = contextInfo?.mentionedJid || [];

    if (mentions.length > 0) {
        return cleanJid(mentions[0]);
    }

    if (contextInfo?.participant) {
        return cleanJid(contextInfo.participant);
    }

    if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            return `${cleanDigits}@s.whatsapp.net`;
        }
    }

    return '';
}

function isDeveloper(jid) {
    if (!jid) return false;
    const normalized = cleanJid(jid);
    return DEV_LIDS.includes(normalized);
}

function isOwnerTarget(target) {
    const cleaned = cleanJid(target);
    return cleaned === cleanJid(config.ownerJid) ||
           (config.ownerLid && cleaned === cleanJid(config.ownerLid)) ||
           (config.ownerLids && config.ownerLids.map(cleanJid).includes(cleaned)) ||
           (config.secondaryOwners && config.secondaryOwners.map(cleanJid).includes(cleaned));
}

function parseDuration(str) {
    if (!str) return null;
    const match = str.match(/^(\d+)([smh])$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return null;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── UPDATED verifyPermissions ──────────────────────
async function verifyPermissions(sock, msg, jid, isOwner, isDev = false, isSudo = false, commandName = '') {
    const senderJid = cleanJid(msg.key.participant || msg.key.remoteJid || '');

    if (isDev) {
        return true;
    }

    const isAuthorized = isOwner || isSudo;
    if (!isAuthorized) return false;

    const exemptCommands = [
        'tag', 'tagall', 'htag', 'admins', 'link', 'invite', 'gclink',
        'gcjid', 'getgpp', 'poll', 'togcstatus', 'togcjid',
        'join', 'exit', 'listonline', 'msgs'
    ];
    if (exemptCommands.includes(commandName.toLowerCase())) {
        return true;
    }

    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants;

    const botJid = sock.user?.id ? cleanJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? cleanJid(sock.user.lid) : (config.botLid || '');

    const botParticipant = participants.find(p => {
        const pId = cleanJid(p.id);
        const pLid = p.lid ? cleanJid(p.lid) : '';
        return (botJid && (pId === botJid || pLid === botJid)) ||
               (botLid && (pId === botLid || pLid === botLid));
    });
    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

    if (!isBotAdmin) {
        await sock.sendMessage(jid, { text: "❌ I must be an administrator in this group first!" }, { quoted: msg });
        return false;
    }

    let sender = participants.find(p => {
        const pId = cleanJid(p.id);
        const pLid = p.lid ? cleanJid(p.lid) : '';
        return pId === senderJid || (pLid && pLid === senderJid);
    });
    const isSenderAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';
    if (!isSenderAdmin) {
        await sock.sendMessage(jid, { text: "❌ You must be an administrator in this group to run this command!" }, { quoted: msg });
        return false;
    }

    return true;
}

// ─── SECURITY POLICY HELPER ────────────────────────────────────
async function applySecurityPolicy(sock, msg, policy, senderJid, senderNumber, jid, violationReason) {
    if (!policy || policy === 'off') return;

    if (policy === 'delete') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.sendMessage(jid, {
                text: `❌ *Message Deleted:* @${senderNumber} violated ${violationReason} rules.`,
                mentions: [senderJid]
            });
        } catch (e) { /* ignore */ }
    } else if (policy === 'warn') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            const warnKey = `${jid}_${senderNumber}`;
            config.warns = config.warns || {};
            config.warns[warnKey] = (config.warns[warnKey] || 0) + 1;
            const count = config.warns[warnKey];
            const threshold = config.warnThreshold || 5;

            if (count >= threshold) {
                await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                await sock.sendMessage(jid, {
                    text: `👋 @${senderNumber} kicked. Warnings exceeded (${count}/${threshold}) for violating ${violationReason} rules.`,
                    mentions: [senderJid]
                });
                config.warns[warnKey] = 0;
            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ @${senderNumber} ${violationReason} is not allowed here! (${count}/${threshold})`,
                    mentions: [senderJid]
                });
            }
            saveState();
        } catch (e) { /* ignore */ }
    } else if (policy === 'kick') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
            await sock.sendMessage(jid, {
                text: `👋 Exorcised @${senderNumber} for violating ${violationReason} rules.`,
                mentions: [senderJid]
            });
        } catch (e) { /* ignore */ }
    }
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

const securityCommands = [
    // 1. ANTILINK
    {
        name: 'antilink',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'antilink');
            if (!isAuthorized) return;

            if (!args) {
                const current = config.antilink[jid] || 'off';
                const prompt = `🔮 *Limitless Antilink Settings:* (Current: \`${current}\`)\n\nSelect an option:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}antilink delete`, buttonText: { displayText: 'Delete' }, type: 1 },
                        { buttonId: `${config.prefix}antilink warn`, buttonText: { displayText: 'Warn' }, type: 1 },
                        { buttonId: `${config.prefix}antilink off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            const action = args.toLowerCase().trim();

            if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                config.antilink[jid] = action;
                saveState();
                await sock.sendMessage(jid, { text: `🔒 *Antilink updated:* \`${action.toUpperCase()}\`` }, { quoted: msg });
            }
        }
    },

    // 2. ANTITAG
    {
        name: 'antitag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'antitag');
            if (!isAuthorized) return;

            if (!args) {
                const current = config.antitag[jid] || 'off';
                const prompt = `🔮 *Limitless Antitag Setting:* (Current: \`${current}\`)\n\nSelect an option below:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}antitag on`, buttonText: { displayText: 'Enable' }, type: 1 },
                        { buttonId: `${config.prefix}antitag off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            const action = args.toLowerCase().trim();

            if (action === 'on') {
                config.antitag[jid] = 'on';
                await sock.sendMessage(jid, { text: "🔒 *Antitag Activated.*" }, { quoted: msg });
            } else if (action === 'off') {
                config.antitag[jid] = 'off';
                await sock.sendMessage(jid, { text: "🔓 *Antitag Deactivated.*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 3. ANTIBOT
    {
        name: 'antibot',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'antibot');
            if (!isAuthorized) return;

            if (!args) {
                const current = config.antibot[jid] || 'off';
                const prompt = `🔮 *Limitless Antibot Setting:* (Current: \`${current}\`)\n\nSelect an option:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}antibot delete`, buttonText: { displayText: 'Delete' }, type: 1 },
                        { buttonId: `${config.prefix}antibot warn`, buttonText: { displayText: 'Warn' }, type: 1 },
                        { buttonId: `${config.prefix}antibot off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            const action = args.toLowerCase().trim();

            if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                config.antibot[jid] = action;
                saveState();
                await sock.sendMessage(jid, { text: `🔒 *Antibot updated:* \`${action.toUpperCase()}\`` }, { quoted: msg });
            }
        }
    },

    // 4. ANTI GROUP MENTION (antigm)
    {
        name: 'antigm',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'antigm');
            if (!isAuthorized) return;

            if (!args) {
                const current = config.antigm[jid] || 'off';
                const prompt = `🔮 *Limitless Antigm Settings:* (Current: \`${current}\`)\n\nSelect an option:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}antigm delete`, buttonText: { displayText: 'Delete' }, type: 1 },
                        { buttonId: `${config.prefix}antigm warn`, buttonText: { displayText: 'Warn' }, type: 1 },
                        { buttonId: `${config.prefix}antigm off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            const action = args.toLowerCase().trim();

            if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                config.antigm[jid] = action;
                saveState();
                await sock.sendMessage(jid, { text: `🔒 *Antigm updated:* \`${action.toUpperCase()}\`` }, { quoted: msg });
            }
        }
    },

    // 5. ANTISPAM
    {
        name: 'antispam',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'antispam');
            if (!isAuthorized) return;

            if (!config.antispam) config.antispam = {};

            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'on') {
                config.antispam[jid] = config.antispam[jid] || { status: 'on', rate: { count: 1, seconds: 2 } };
                config.antispam[jid].status = 'on';
                saveState();
                return await sock.sendMessage(jid, { text: "🔒 *Antispam Activated.*" }, { quoted: msg });
            }

            if (action === 'off') {
                if (config.antispam[jid]) config.antispam[jid].status = 'off';
                saveState();
                return await sock.sendMessage(jid, { text: "🔓 *Antispam Deactivated.*" }, { quoted: msg });
            }

            if (action.startsWith('trig')) {
                const param = action.replace('trig', '').trim();
                const match = param.match(/^(\d+)\/(\d+)s$/);

                if (!match) return await sock.sendMessage(jid, { text: "❌ Format: .antispam trig 1/2s" }, { quoted: msg });

                const count = parseInt(match[1]);
                const seconds = parseInt(match[2]);

                config.antispam[jid] = config.antispam[jid] || { status: 'on' };
                config.antispam[jid].rate = { count, seconds };
                config.antispam[jid].status = 'on';
                saveState();

                return await sock.sendMessage(jid, { text: `✅ *Spam threshold modified:* \`${count} messages per ${seconds}s\`.` }, { quoted: msg });
            }

            const current = config.antispam[jid]?.status || 'off';
            const rate = config.antispam[jid]?.rate ? `${config.antispam[jid].rate.count}/${config.antispam[jid].rate.seconds}s` : '1/2s';
            const prompt = `🛡️ *Antispam Moderation Panel:* (Status: \`${current.toUpperCase()}\`)\nThreshold: \`${rate}\``;
            await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
        }
    },

    // 6. ANTIGCSTATUS
    {
        name: 'antigcstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'antigcstatus');
            if (!isAuthorized) return;

            if (!config.antigcstatus) {
                config.antigcstatus = 'off';
            }

            if (!args) {
                const current = config.antigcstatus || 'off';
                const prompt = `🛡️ *Anti-Status Protection Panel (antigcstatus)* 🛡️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                               `Status: \`${current.toUpperCase()}\`\n\n` +
                               `Select a moderate policy below:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}antigcstatus warn`, buttonText: { displayText: 'Warn ⚠️' }, type: 1 },
                        { buttonId: `${config.prefix}antigcstatus delete`, buttonText: { displayText: 'Delete 🗑️' }, type: 1 },
                        { buttonId: `${config.prefix}antigcstatus kick`, buttonText: { displayText: 'Kick 🛑' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            const action = args.toLowerCase().trim();

            if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                config.antigcstatus = action;
                saveState();
                await sock.sendMessage(jid, { text: `🔒 *Anti-Status Protection updated:* \`${action.toUpperCase()}\`` }, { quoted: msg });
            }
        }
    },

    // 7. ANTIPROMOTE (Polished & Prepared)
    {
        name: 'antipromote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'antipromote');
            if (!isAuthorized) return;

            if (!config.antipromote) config.antipromote = {};

            const action = args ? args.toLowerCase().trim() : '';
            if (action === 'on') {
                config.antipromote[jid] = 'on';
                await sock.sendMessage(jid, { text: "🔒 *Antipromote Protection Activated!* Unsanctioned promotions will result in the immediate demotion of both the target and the promoter." }, { quoted: msg });
            } else if (action === 'off') {
                config.antipromote[jid] = 'off';
                await sock.sendMessage(jid, { text: "🔓 *Antipromote Protection Disabled.*" }, { quoted: msg });
            } else {
                const current = config.antipromote[jid] || 'off';
                await sock.sendMessage(jid, { text: `🛡️ *Antipromote Security Status:* \`${current.toUpperCase()}\`` }, { quoted: msg });
            }
            saveState();
        }
    },

    // 8. ANTIDEMOTE (Polished & Prepared)
    {
        name: 'antidemote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'antidemote');
            if (!isAuthorized) return;

            if (!config.antidemote) config.antidemote = {};

            const action = args ? args.toLowerCase().trim() : '';
            if (action === 'on') {
                config.antidemote[jid] = 'on';
                await sock.sendMessage(jid, { text: "🔒 *Antidemote Protection Activated!* Unsanctioned demotions of administrators will result in instant demotion of the demoter and re-promotion of the victim." }, { quoted: msg });
            } else if (action === 'off') {
                config.antidemote[jid] = 'off';
                await sock.sendMessage(jid, { text: "🔓 *Antidemote Protection Disabled.*" }, { quoted: msg });
            } else {
                const current = config.antidemote[jid] || 'off';
                await sock.sendMessage(jid, { text: `🛡️ *Antidemote Security Status:* \`${current.toUpperCase()}\`` }, { quoted: msg });
            }
            saveState();
        }
    },

    // 9. WARN
    {
        name: 'warn',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'warn');
            if (!isAuthorized) return;

            const targetJid = parseTargetUser(msg, args);
            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please mention a target user or reply to their message to warn." }, { quoted: msg });
            }

            const targetNumber = targetJid.split('@')[0];
            const botJid = config.botJid || (sock.user.id.split(':')[0] + '@s.whatsapp.net');

            if (isDeveloper(targetJid)) {
                return await sock.sendMessage(jid, { text: "🛡️ *Immunity Triggered:* Cannot restrict a Core Developer of this domain." }, { quoted: msg });
            }

            if (isOwnerTarget(targetJid)) {
                return await sock.sendMessage(jid, { text: "❌ You cannot warn a registered system owner." }, { quoted: msg });
            }

            const rawMsg = getRawMessage(msg.message);
            const quoted = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            if (quoted && quoted.stanzaId) {
                try {
                    await sock.sendMessage(jid, {
                        delete: {
                            remoteJid: jid,
                            id: quoted.stanzaId,
                            fromMe: targetJid === botJid,
                            participant: targetJid
                        }
                    });
                } catch (e) { /* ignore */ }
            }

            const warnKey = `${jid}_${targetNumber}`;
            config.warns = config.warns || {};
            config.warns[warnKey] = (config.warns[warnKey] || 0) + 1;
            const count = config.warns[warnKey];
            const threshold = config.warnThreshold || 5;

            if (count >= threshold) {
                try {
                    await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                    await sock.sendMessage(jid, { text: `Sayonara! @${targetNumber} (${count}/${threshold} warnings)`, mentions: [targetJid] });
                    config.warns[warnKey] = 0;
                } catch (err) { /* ignore */ }
            } else {
                await sock.sendMessage(jid, { text: `⚠️ *Warning Issued:* @${targetNumber}\n\n*Warns:* ${count}/${threshold}`, mentions: [targetJid] });
            }
            saveState();
        }
    },

    // 10. SILENCE
    {
        name: 'silence',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'silence');
            if (!isAuthorized) return;

            const targetJid = parseTargetUser(msg, args);
            if (!targetJid || targetJid === cleanJid(msg.key.participant || msg.key.remoteJid || '')) {
                return await sock.sendMessage(jid, { text: "❌ Specify a user to silence." }, { quoted: msg });
            }

            if (isDeveloper(targetJid)) {
                return await sock.sendMessage(jid, { text: "🛡️ *Immunity Triggered:* Cannot restrict a Core Developer of this domain." }, { quoted: msg });
            }

            if (isOwnerTarget(targetJid)) {
                return await sock.sendMessage(jid, { text: "❌ You cannot silence a registered system owner." }, { quoted: msg });
            }

            const targetNum = targetJid.split('@')[0];
            const cleanArgs = args ? args.replace(/@[^ ]+/g, '').trim() : '';
            const parts = cleanArgs.split(' ');

            let mode = '';
            let timerStr = '1h';

            if (parts[0]) {
                if (['-s', '-m', 'all'].includes(parts[0])) {
                    mode = parts[0];
                    if (parts[1]) timerStr = parts[1];
                } else {
                    timerStr = parts[0];
                }
            }

            const durationMs = parseDuration(timerStr) || 3600000;

            if (!mode) {
                const prompt = `⛓️ *Silence Detention Panel:* @${targetNum}\n\nSelect type:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}silence_ans sticker ${targetNum} ${timerStr}`, buttonText: { displayText: 'Stickers Only' }, type: 1 },
                        { buttonId: `${config.prefix}silence_ans message ${targetNum} ${timerStr}`, buttonText: { displayText: 'Messages' }, type: 1 },
                        { buttonId: `${config.prefix}silence_ans all ${targetNum} ${timerStr}`, buttonText: { displayText: 'Silence All' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid]
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            let mappedType = 'all';
            if (mode === '-s') mappedType = 'sticker';
            if (mode === '-m') mappedType = 'message';

            global.silencedUsers[jid] = global.silencedUsers[jid] || {};
            global.silencedUsers[jid][cleanJid(targetJid)] = { type: mappedType, endTime: Date.now() + durationMs };

            await sock.sendMessage(jid, {
                text: `⛓️ *Target @${targetNum} silenced:* \`${mappedType.toUpperCase()}\` for *${timerStr}*.`,
                mentions: [targetJid]
            }, { quoted: msg });
        }
    },

    // 11. SILENCE_ANS (Button handler)
    {
        name: 'silence_ans',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'silence');
            if (!isAuthorized) return;

            const parts = args.split(' ');
            const type = parts[0]?.toLowerCase().trim();
            const targetNum = parts[1]?.trim();
            const timerStr = parts[2]?.trim() || '1h';

            if (!type || !targetNum) return;

            const targetJid = `${targetNum}@s.whatsapp.net`;
            if (isDeveloper(targetJid)) {
                return await sock.sendMessage(jid, { text: "🛡️ *Immunity Triggered:* Cannot restrict a Core Developer of this domain." }, { quoted: msg });
            }

            if (isOwnerTarget(targetJid)) {
                return await sock.sendMessage(jid, { text: "❌ You cannot silence a registered system owner." }, { quoted: msg });
            }

            const durationMs = parseDuration(timerStr) || 3600000;

            global.silencedUsers[jid] = global.silencedUsers[jid] || {};
            global.silencedUsers[jid][cleanJid(targetJid)] = { type: type, endTime: Date.now() + durationMs };

            await sock.sendMessage(jid, {
                text: `⛓️ *Target @${targetNum} silenced:* \`${type.toUpperCase()}\` for *${timerStr}*.`,
                mentions: [targetJid]
            }, { quoted: msg });
        }
    },

    // 12. UNSILENCE
    {
        name: 'unsilence',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'unsilence');
            if (!isAuthorized) return;

            const targetJid = parseTargetUser(msg, args);
            if (!targetJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

            const targetNum = targetJid.split('@')[0];
            const cleanedTarget = cleanJid(targetJid);

            if (global.silencedUsers[jid] && global.silencedUsers[jid][cleanedTarget]) {
                delete global.silencedUsers[jid][cleanedTarget];
                await sock.sendMessage(jid, {
                    text: `⛓️ *Target @${targetNum} unsilenced.*`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, {
                    text: `❌ Target @${targetNum} is not currently silenced.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            }
        }
    },

    // ─── DELSPAM ─────────────────────────────────────────────────────
    {
        name: 'delspam',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'delspam');
            if (!isAuthorized) return;

            // Get target from mention/reply/args safely
            const targetJid = parseTargetUser(msg, args);
            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please mention or reply to the target user." }, { quoted: msg });
            }

            // Parse count from args
            let count = 10;
            if (args) {
                const parts = args.trim().split(/\s+/);
                for (const part of parts) {
                    const num = parseInt(part);
                    if (!isNaN(num) && num > 0) {
                        count = Math.min(num, 50);
                        break;
                    }
                }
            }

            // Get messages from global store for this chat and target sender
            const store = global.messageStore || {};
            const messages = Object.values(store)
                .filter(m => {
                    const mJid = m.key.remoteJid;
                    const sender = normalizeToJid(m.key.participant || m.key.remoteJid || '');
                    return mJid === jid && cleanJid(sender) === cleanJid(targetJid);
                })
                .sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

            if (messages.length === 0) {
                return await sock.sendMessage(jid, {
                    text: `❌ No recent messages found from @${targetJid.split('@')[0]} in the message store.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            }

            // Determine how many to delete (most recent first)
            const toDelete = messages.slice(-Math.min(count, messages.length));

            let deletedCount = 0;
            for (const msgToDelete of toDelete) {
                try {
                    await sock.sendMessage(jid, { delete: msgToDelete.key });
                    deletedCount++;
                    // Remove from store to avoid double deletion
                    if (global.messageStore && global.messageStore[msgToDelete.key.id]) {
                        delete global.messageStore[msgToDelete.key.id];
                    }
                    await delay(300);
                } catch (e) { /* ignore */ }
            }

            await sock.sendMessage(jid, {
                text: `🧹 *Spam Cleanup Complete!*\n\n👤 *Target:* @${targetJid.split('@')[0]}\n🗑️ *Deleted:* \`${deletedCount}/${toDelete.length}\` messages`,
                mentions: [targetJid]
            }, { quoted: msg });
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
securityCommands.forEach(cmd => {
    if (cmd.name === 'antilink') aliases.push({ ...cmd, name: 'infinity' });
});
securityCommands.push(...aliases);

module.exports = securityCommands;