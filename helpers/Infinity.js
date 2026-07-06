// helpers/Infinity.js
const config = require('../config');
const { DEV_LIDS, DEV_JIDS, DEV_PHONE_JIDS } = require('../plugins/devs');
const commands = require('../commands');
const { getPhoneJid, normalizeToJid, saveState } = require('../stateManager');
const { handleViewOnce } = require('./log');

// Sub-module imports
const { getRawMessage, cleanJid, extractBodyAndTrim, readUserStats, saveUserStats } = require('./Message');
const { handleInteractiveSessions, handleDownloaderSessions, handleAfkDeactivation } = require('./SessionManager');
const { isUserSilenced, handleGroupSecurity, handleGroupStatusProtection, handleAntibugSpamLimit, handleAntispamRateLimit } = require('./ChatInterceptors');
const { handleGameRedirects, handleActiveGameAnswers } = require('./GameInterceptors');
const { readGcLogs, saveGcLogs, triggerSummary } = require('./Summary');

const ownerCommands = [
    'diagnose', 'update', 'mode', 'setsudo', 'delsudo',
    'restart', 'shutdown', 'ban', 'unban',
    'afk', 'setvar', 'settings',
    'antipm', 'reminder', 'remind', 'games_closeall', 'owner'
];

const primaryOnlyCommands = ['addowner', 'delowner'];
const devOnlyCommands = ['upgrade'];

// ─── BULLETPROOF COMMAND EXECUTION HELPER ────────────────────────
async function executeBotCommand(cmdName, sock, msg, args, opts) {
    let commandFunction;
    const cleanCmd = cmdName.startsWith(config.prefix) ? cmdName : `${config.prefix}${cmdName}`;
    const baseName = cmdName.startsWith(config.prefix) ? cmdName.slice(config.prefix.length) : cmdName;

    if (typeof commands === 'object' && !Array.isArray(commands)) {
        commandFunction = commands[cleanCmd] || commands[baseName];
    } else if (Array.isArray(commands)) {
        commandFunction = commands.find(c => `.${c.name}` === cleanCmd || c.name === baseName)?.execute;
    }

    if (commandFunction) {
        await commandFunction(sock, msg, args, opts);
        return true;
    }
    return false;
}

// ─── MAIN MESSAGE DISPATCHER / ROUTER ───────────────────────────
async function handleIncomingMessage(sock, chatUpdate, botSentMessageIds) {
    try {
        if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
        const msg = chatUpdate.messages[0];
        if (!msg || !msg.message) return;

        const jid = msg.key.remoteJid;
        const rawSender = msg.key.participant || msg.key.remoteJid || '';
        const senderJid = normalizeToJid(rawSender);
        const senderNumber = senderJid.split('@')[0];
        const isGroup = jid.endsWith('@g.us');
        const cleanChatJid = cleanJid(jid); // Cleaned group JID

        // ─── EXTRACT BODY (Centralized at the top!) ───
        const { rawMsg, body, trimmedMessageBody, lowerMessage } = extractBodyAndTrim(msg);

        let command;
        let args;

        // ─── HOOKS (Fully optimized top-level placements) ──────────────────────
        const isNoteHandled = await handleNoteSession(sock, msg);
        if (isNoteHandled) return;

        await handleViewOnce(sock, msg);

        const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;

        const handled = await handleInteractiveSessions(sock, msg, trimmedMessageBody, quotedMsgId, cleanChatJid);
        if (handled) return;

        const dlHandled = await handleDownloaderSessions(sock, msg, trimmedMessageBody, quotedMsgId);
        if (dlHandled) return;

        // ─── QUIZ CATEGORY SELECTION ────────────────────────────
        const senderJidCat = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
        const quizSingleKey = jid + '_' + senderJidCat;
        const quizMultiKey = jid;
        let activeQuizKey = '';

        if (global.triviaSessions && global.triviaSessions[quizSingleKey] && global.triviaSessions[quizSingleKey].status === 'awaiting_category') {
            activeQuizKey = quizSingleKey;
        } else if (global.triviaSessions && global.triviaSessions[quizMultiKey] && global.triviaSessions[quizMultiKey].status === 'awaiting_category') {
            activeQuizKey = quizMultiKey;
        }

        if (quotedMsgId && activeQuizKey && global.triviaSessions && global.triviaSessions[activeQuizKey]) {
            const session = global.triviaSessions[activeQuizKey];
            if (session.status === 'awaiting_category' && session.lastQuestionMsgId === quotedMsgId) {
                await executeBotCommand('quiz_cat', sock, msg, trimmedMessageBody, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                return;
            }
        }

        // ─── QUIZ ANSWER INTERCEPTOR ────────────────────────────
        const answered = await handleActiveGameAnswers(sock, msg, quotedMsgId, trimmedMessageBody, jid, senderJid, senderNumber, executeBotCommand);
        if (answered) return;

        await handleAfkDeactivation(sock, msg);

        // ─── PERMISSIONS (Fixed LID/Phone dev array alignments) ─────
        const botJid = config.botJid || (sock.user?.id ? normalizeToJid(sock.user.id) : '');
        const botLid = config.botLid || (sock.user?.id?.includes('@lid') ? normalizeToJid(sock.user.id) : '');

        global.activeSock = sock;

        let isDev = DEV_LIDS.includes(senderJid) || DEV_JIDS.includes(senderJid) || DEV_PHONE_JIDS.includes(senderJid);
        let isPrimaryOwner = senderJid === config.ownerJid ||
                             (config.ownerLid && senderJid === config.ownerLid);
        let isSecondaryOwner = Array.isArray(config.secondaryOwners) &&
                               config.secondaryOwners.includes(senderJid);
        let isOwner = isDev || isPrimaryOwner || isSecondaryOwner || msg.key.fromMe;
        let isSudo = (Array.isArray(config.sudos) && config.sudos.includes(senderJid)) ||
                     (Array.isArray(config.sudoLids) && config.sudoLids.includes(senderJid));

        let senderPhoneJid = '';
        if (senderJid.endsWith('@lid')) {
            if (global.lidCache?.[senderJid]) {
                senderPhoneJid = global.lidCache[senderJid];
            }
            if (!isOwner && !isSudo && !senderPhoneJid) {
                senderPhoneJid = await getPhoneJid(sock, senderJid, jid);
            }
            if (senderPhoneJid) {
                if (DEV_LIDS.includes(senderJid) || DEV_JIDS.includes(senderJid) || DEV_PHONE_JIDS.includes(senderPhoneJid)) isDev = true;
                if (senderPhoneJid === config.ownerJid) isPrimaryOwner = true;
                if (Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(senderPhoneJid)) isSecondaryOwner = true;
                if (Array.isArray(config.sudos) && config.sudos.includes(senderPhoneJid)) isSudo = true;
                isOwner = isDev || isPrimaryOwner || isSecondaryOwner || msg.key.fromMe;
            }
        }

        const isAuthorized = isOwner || isSudo;

        const isBanned = (Array.isArray(config.banned) && config.banned.includes(senderJid)) ||
                         (senderPhoneJid && Array.isArray(config.banned) && config.banned.includes(senderPhoneJid));
        if (isBanned) return;
        if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) return;

        const mentionedJids = (contextInfo?.mentionedJid || []).map(j => cleanJid(j));

        // ─── UNIFIED TEXT-GAME REPLY REDIRECTOR (Fixed payload configurations) ───
        const redirectedGame = handleGameRedirects(sock, msg, contextInfo, trimmedMessageBody);
        if (redirectedGame) {
            command = redirectedGame.command;
            args = redirectedGame.args;
        }

        // ─── USER LEVEL-UP & STATS TRACKER ──────────────────────
        if (isGroup && senderJid && !msg.key.fromMe) {
            const userStats = readUserStats();
            userStats[jid] = userStats[jid] || {};
            userStats[jid][senderJid] = userStats[jid][senderJid] || { msgCount: 0, level: 11 };

            const isCommand = trimmedMessageBody.startsWith(config.prefix);
            if (!isCommand && trimmedMessageBody.length > 0) {
                userStats[jid][senderJid].msgCount += 1;
                const newCount = userStats[jid][senderJid].msgCount;

                const milestones = {
                    15: { index: 10, name: "Human", icon: "🏃", text: "🏃 *TIER UNLOCKED: HUMAN ASCENSION*\n\nPeak physical form achieved! @Username has crossed 15 messages!\n\n• Current Tier: Tier 10: Human\n• Status: Standard human capabilities up to peak athlete level. Durability is strictly human level." },
                    45: { index: 9, name: "Superhuman", icon: "⚡", text: "⚡ *TIER UNLOCKED: WALL BREACHED*\n\nConcrete walls shattered! @Username has crossed 45 messages!\n\n• Current Tier: Tier 9: Superhuman\n• Status: Street-level fighter. Can smash steel, concrete, or small rooms with minor effort." },
                    90: { index: 8, name: "Urban", icon: "🏢", text: "🏢 *TIER UNLOCKED: URBAN CALAMITY*\n\nStructures are collapsing! @Username has crossed 90 messages!\n\n• Current Tier: Tier 8: Urban\n• Status: Destructive force ranging from single buildings to city blocks." },
                    150: { index: 7, name: "Nuclear / Regional", icon: "☄️", text: "☄️ *TIER UNLOCKED: REGIONAL CONSTRAINTS SHATTERED*\n\nTowns and vaporized mountains lie behind them! @Username has scaled to 150 messages!\n\n• Current Tier: Tier 7: Nuclear / Regional\n• Status: Capable of leveling towns, major cities, or vaporizing massive mountain ranges." },
                    250: { index: 6, name: "Global", icon: "🗺️", text: "🗺️ *TIER UNLOCKED: GLOBAL DOMINANCE*\n\nTectonic shockwaves detected! @Username has crossed 250 messages and attained global force!\n\n• Current Tier: Tier 6: Global\n• Status: Tectonic force capable of destroying island nations or continents." },
                    400: { index: 5, name: "Planetary", icon: "🪐", text: "🪐 *TIER UNLOCKED: CELESTIAL COLLAPSE*\n\nMoons and planets shatter in their wake! @Username has crossed 400 messages!\n\n• Current Tier: Tier 5: Planetary\n• Status: Celestial power capable of shattering moons and gas giants." },
                    600: { index: 4, name: "Stellar", icon: "☀️", text: "☀️ *TIER UNLOCKED: STELLAR OBLITERATION*\n\nWatch the skies! @Username has crossed 600 messages and can obliterate entire solar systems with a single sentence!\n\n• Current Tier: Tier 4: Stellar\n• Status: Cosmic power able to completely obliterate stars and solar systems." },
                    800: { index: 3, name: "Cosmic", icon: "🌌", text: "🌌 *TIER UNLOCKED: GALACTIC EXTINATION*\n\nReality is collapsing! @Username has reached 800 messages!\n\n• Current Tier: Tier 3: Cosmic\n• Status: Reality-spanning scale. Can collapse galaxies and physical matter." },
                    900: { index: 2, name: "Multiversal", icon: "🔮", text: "🔮 *TIER UNLOCKED: TIMELINE ANOMALY*\n\nBranching realities are warping! @Username has reached 900 messages!\n\n• Current Tier: Tier 2: Multiversal\n• Status: Manipulates multiple timelines and distinct universes simultaneously." },
                    1000: { index: 1, name: "Extradimensional (Outerversal)", icon: "👁️", text: "👁️ *TIER UNLOCKED: DIMENSIONAL FRAMEWORK ERASED*\n\nThe narrative grid has dissolved! @Username has achieved Outerversal ascension at 1,000 messages!\n\n• Current Tier: Tier 1: Extradimensional (Outerversal)\n• Status: Transcends space, time, and dimensional conceptual frameworks. They exist beyond standard human physics." },
                    1500: { index: 0, name: "Boundless", icon: "👑", text: "👑 *THE FINAL CEILING: BOUNDLESS ASCENSION*\n\nABSOLUTE DIVINITY ACHIEVED! @Username has conquered the maximum peak of 1,500 messages!\n\n• Current Tier: Tier 0: Boundless\n• Status: True omnipotence. Omnipresent, omniscient, and conceptually unreachable. The supreme deity of this chat." }
                };

                if (milestones[newCount]) {
                    const milestone = milestones[newCount];
                    userStats[jid][senderJid].level = milestone.index;

                    const levelupAlertState = config.gcalerts?.levelup?.[jid] || 'off';
                    if (levelupAlertState === 'on') {
                        const targetNum = senderJid.split('@')[0];
                        const cleanMsgText = milestone.text.replace(/@Username/g, `@${targetNum}`);
                        
                        sock.sendMessage(jid, { text: cleanMsgText, mentions: [senderJid] }).catch(err => {
                            console.error("[LEVELUP BROADCAST FAILED]", err.message);
                        });
                    }
                }
                saveUserStats(userStats);
            }
        }

        // ─── LID-SAFE SILENCE CHECK ──────────────────────────────
        if (isGroup) {
            const silenceData = isUserSilenced(global.silencedUsers, jid, senderJid);
            if (silenceData && Date.now() < silenceData.endTime) {
                let shouldMute = false;
                if (silenceData.type === 'all' && !isDev) {
                    shouldMute = true;
                } else if (silenceData.type === 'sticker' && msg.message.stickerMessage && !isDev) {
                    shouldMute = true;
                } else if (silenceData.type === 'message' && !isDev) {
                    const hasMedia = msg.message.imageMessage || msg.message.videoMessage || msg.message.audioMessage || msg.message.documentMessage;
                    if (trimmedMessageBody || hasMedia) shouldMute = true;
                }

                if (shouldMute) {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                    } catch (e) { /* ignore */ }
                    return;
                }
            }
        }

        // ─── AGENT DECLARATIONS & RESOLVING ─────────────────────────
        const cleanBotJid = cleanJid(botJid);
        const cleanBotLid = cleanJid(botLid);

        const botNumber = cleanBotJid ? cleanBotJid.split('@')[0] : '';
        const botLidNumber = cleanBotLid ? cleanBotLid.split('@')[0] : '';

        const isReplyingToBot = (quotedMsgId && botSentMessageIds && botSentMessageIds.has(quotedMsgId)) ||
                               (quotedMsg && quotedMsg.key && quotedMsg.key.fromMe) ||
                               (!isGroup && !msg.key.fromMe && quotedMsgId);

        const mentionsBotInText = (botNumber && lowerMessage.includes(`@${botNumber}`)) || 
                                  (botLidNumber && lowerMessage.includes(`@${botLidNumber}`));

        const isMentioningBot = mentionedJids.some(j => {
            const cj = cleanJid(j);
            return cj === cleanBotJid || (cleanBotLid && cj === cleanBotLid);
        }) || mentionsBotInText;

        const isGojoCalled = /\bgojo\b/i.test(lowerMessage);

        let identifiedAgent = null;

        if (isReplyingToBot && quotedMsgId && global.botMessageAgents[quotedMsgId]) {
            identifiedAgent = global.botMessageAgents[quotedMsgId];
        } else {
            if (Array.isArray(config.lizzyChats) && config.lizzyChats.includes(jid)) {
                identifiedAgent = 'lizzy';
            } else if (Array.isArray(config.chatbotChats) && config.chatbotChats.includes(jid)) {
                identifiedAgent = 'jarvis';
            } else if (Array.isArray(config.fridayChats) && config.fridayChats.includes(jid)) {
                identifiedAgent = 'friday';
            }
            
            if (!identifiedAgent && isGojoCalled) {
                identifiedAgent = 'gojo';
            }
        }

        if (identifiedAgent === 'gojo') {
            const isAsleep = config.gojoGlobalSleep;
            if (isAsleep && !trimmedMessageBody.startsWith(config.prefix)) identifiedAgent = null;
        }

        if (identifiedAgent && !trimmedMessageBody.startsWith(config.prefix)) {
            if (identifiedAgent === 'gojo') {
                command = 'gojo';
                args = trimmedMessageBody;
            } else if (identifiedAgent === 'lizzy') {
                command = 'lizzy_chat';
                args = trimmedMessageBody;
            } else if (identifiedAgent === 'jarvis') {
                command = 'chatbot_chat';
                args = trimmedMessageBody;
            } else if (identifiedAgent === 'friday') {
                command = 'friday_chat';
                args = trimmedMessageBody;
            }
        }

        // ─── DEV MENTION REACTION ────────────────────────────────
        const devLidsSet = new Set(DEV_LIDS);
        const devJidsSet = new Set(DEV_JIDS);
        const devNums = new Set();

        for (const dev of devLidsSet) devNums.add(dev.split('@')[0]);
        for (const dev of devJidsSet) devNums.add(dev.split('@')[0]);

        let isDevMentioned = false;

        for (const mention of mentionedJids) {
            const normalized = normalizeToJid(mention);
            const num = normalized.split('@')[0];
            if (devNums.has(num)) {
                isDevMentioned = true;
                break;
            }
        }

        if (!isDevMentioned) {
            const mentionMatches = trimmedMessageBody.match(/@([0-9]+)/g) || [];
            for (const match of mentionMatches) {
                const num = match.replace('@', '');
                if (devNums.has(num)) {
                    isDevMentioned = true;
                    break;
                }
            }
        }

        if (isDevMentioned && !msg.key.fromMe) {
            (async () => {
                const reactionSequence = ["⚽", "🔥", "🪽", "❄", "🥷🏼"];
                for (const emoji of reactionSequence) {
                    try {
                        await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                    } catch (reactErr) {
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            })().catch(err => console.error("❌ [REACTION] Dev mention animation failed:", err.message));
        }

        // ─── CHAT LOG RECORDING INTERCEPTOR (.gclog - Fixed JID Sync) ────
        if (isGroup && config.gclogActive?.[cleanChatJid]) {
            const gcLogs = readGcLogs();
            if (!gcLogs[cleanChatJid]) gcLogs[cleanChatJid] = [];

            if (trimmedMessageBody && !trimmedMessageBody.startsWith(config.prefix)) {
                const senderName = msg.pushName || senderNumber || 'Unknown';
                gcLogs[cleanChatJid].push({
                    sender: senderName,
                    text: trimmedMessageBody,
                    time: Date.now()
                });

                if (gcLogs[cleanChatJid].length > 1000) {
                    gcLogs[cleanChatJid].shift();
                }

                saveGcLogs(gcLogs);
            }

            if (!global.gclogIntervals) global.gclogIntervals = {};
            if (!global.gclogIntervals[cleanChatJid]) {
                console.log(`🔄 [GCLOG] Re‑creating 3‑hour interval for ${cleanChatJid}`);
                global.gclogIntervals[cleanChatJid] = setInterval(async () => {
                    await triggerSummary(sock, cleanChatJid);
                }, 3 * 60 * 60 * 1000);
            }
        }

        // ─── STATUS BROADCAST ────────────────────────────────────
        if (jid === 'status@broadcast') {
            if (config.autoviewstatus === 'on') {
                try { await sock.readMessages([msg.key]); } catch (e) { /* ignore */ }
            }
            if (config.autoreactstatus === 'on') {
                try {
                    const emoji = config.statusemoji || '❄';
                    await sock.sendMessage('status@broadcast', { react: { text: emoji, key: msg.key } });
                } catch (e) { /* ignore */ }
            }
            return;
        }

        // ─── GROUP SECURITY INTERCEPTORS ─────────────────────────
        if (isGroup && !isAuthorized && !isDev && !msg.key.fromMe) {
            const secured = await handleGroupSecurity(sock, msg, body, senderJid, senderNumber, jid, mentionedJids, isAuthorized, isDev);
            if (secured) return;
        }

        // ─── GROUP STATUS PROTECTION ─────────────────────────────
        const isGroupStatus = msg.message?.groupStatusMessageV2 || msg.mtype === "groupStatusMessageV2";
        if (isGroup && isGroupStatus && !msg.key.fromMe && !isAuthorized && !isDev) {
            await handleGroupStatusProtection(sock, msg, cleanChatJid, senderNumber, senderJid, isAuthorized, isDev);
        }

        // ─── ANTIBUG RATE-LIMIT (Fixed non-silent block warnings) ──
        if (config.antibug === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
            const blocked = await handleAntibugSpamLimit(sock, msg, senderJid, senderNumber, jid);
            if (blocked) return;
        }

        // ─── ANTISPAM RATE-LIMIT (Fixed Legacy Buttons) ──────────
        if (isGroup && !isAuthorized && !msg.key.fromMe && !isDev) {
            const spammed = await handleAntispamRateLimit(sock, msg, senderJid, senderNumber, jid);
            if (spammed) return;
        }

        // ─── COMMAND EXTRACTION ──────────────────────────────────
        if (!command) {
            if (trimmedMessageBody.startsWith(config.prefix)) {
                const spaceIndex = trimmedMessageBody.indexOf(' ');
                if (spaceIndex === -1) {
                    command = trimmedMessageBody.slice(config.prefix.length).toLowerCase();
                    args = '';
                } else {
                    command = trimmedMessageBody.slice(config.prefix.length, spaceIndex).toLowerCase();
                    args = trimmedMessageBody.slice(spaceIndex + 1);
                }
            } else if (commands[trimmedMessageBody.toLowerCase()]) {
                command = trimmedMessageBody.toLowerCase();
                args = '';
            }
        }

        if (!command) return;

        // ─── AGENT CONTEXT ─────────────────────────────────────────
        if (command === 'gojo') global.activeAgentContext = 'gojo';
        else if (command === 'lizzy_chat') global.activeAgentContext = 'lizzy';
        else if (command === 'chatbot_chat') global.activeAgentContext = 'jarvis';
        else if (command === 'friday_chat') global.activeAgentContext = 'friday';
        else global.activeAgentContext = null;

        const isPublicMode = config.isPublic ?? false;
        const cleanCommand = command.startsWith(config.prefix) ? command.slice(config.prefix.length) : command;

        // ─── PERMISSION CHECKS ─────────────────────────────────────
        const isOwnerCmd = ownerCommands.includes(cleanCommand);
        const isDevOnlyCmd = devOnlyCommands.includes(cleanCommand);

        if (isOwnerCmd && isSudo && !isOwner && !isDev) {
            return;
        }

        if (isDevOnlyCmd && !isDev) {
            return;
        }

        const interactiveResponses = [
            'prop_ans', 'ask_ans', 'wed_ans', 'v8_btn', 'purple_ans',
            'quiz_join', 'ttt_join', 'pvp_join', 'anagram_join', 'wcg_join',
            'pvp_lobby_accept', 'pvp_choose', 'pvp_fight', 'pvp_defend',
            'menu_ai', 'menu_games', 'menu_group', 'menu_tools', 'menu_download',
            'menu_fun', 'menu_owner', 'menu_utilities', 'silence_ans'
        ];

        if (!isPublicMode && !isAuthorized && !isDev && !interactiveResponses.includes(command)) {
            return;
        }

        // ─── LOG COMMAND EXECUTION ────────────────────────────────
        if (command) {
            global.recentLogs.push({
                time: new Date().toISOString(),
                level: 'CMD',
                message: `${command} ${args || ''}`.trim()
            });
            if (global.recentLogs.length > 2000) {
                global.recentLogs.shift();
            }
        }

        // ─── COMMAND EXECUTION ─────────────────────────────────────
        console.log(`⚙️ [PARSER] Triggering command: "${command}"`);

        let reactEmoji = "❄";
        if (isDev) reactEmoji = "♾️";
        else if (isOwner) reactEmoji = "🪯";
        else if (isSudo) reactEmoji = "☸️";

        if (config.autoReact === 'cmd' && !msg.key.fromMe) {
            try { await sock.sendMessage(jid, { react: { text: reactEmoji, key: msg.key } }); } catch (err) { /* ignore */ }
        }

        await executeBotCommand(command, sock, msg, args, { isOwner, isSudo, isDev, isPrimaryOwner, senderNumber });

    } catch (err) {
        console.error('Error handling message stream:', err);
        global.recentLogs.push({
            time: new Date().toISOString(),
            level: 'ERROR',
            message: err.message + '\n' + (err.stack || '')
        });
    }
}

module.exports = { handleIncomingMessage };