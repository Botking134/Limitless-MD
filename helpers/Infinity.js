// helpers/Infinity.js
const config = require('../config');
const { DEV_LIDS, DEV_JIDS, DEV_PHONE_JIDS } = require('../plugins/devs');
const commands = require('../commands');
const { getPhoneJid, normalizeToJid, saveState } = require('../stateManager');
const { handleViewOnce } = require('./log');

// Sub-module imports
const { getRawMessage, cleanJid, extractBodyAndTrim } = require('./Message');
const { handleInteractiveSessions, handleDownloaderSessions, handleAfkDeactivation, handleNoteSession } = require('./SessionManager');
const { isUserSilenced, handleGroupSecurity, handleGroupStatusProtection, handleAntibugSpamLimit, handleAntispamRateLimit } = require('./ChatInterceptors');
const { handleGameRedirects, handleActiveGameAnswers } = require('./GameInterceptors');
const { recordMessage } = require('./SummaryManager');

// Custom Message Filter Manager
let handleFilterInterceptor;
try {
    handleFilterInterceptor = require('./FilterManager').handleFilterInterceptor;
} catch (e) {
    handleFilterInterceptor = async () => false;
}

// Granular Permissions Manager (.allow / .disallow)
let isCommandAllowed;
try {
    isCommandAllowed = require('./PermissionManager').isCommandAllowed;
} catch (e) {
    isCommandAllowed = () => false;
}

// ─── IN-MEMORY GROUP METADATA CACHE (60s TTL) ─────────────────────
const groupMetadataCache = new Map();

async function getCachedGroupMetadata(sock, jid) {
    const cached = groupMetadataCache.get(jid);
    if (cached && (Date.now() - cached.time < 60000)) {
        return cached.data;
    }
    try {
        const metadata = await sock.groupMetadata(jid);
        groupMetadataCache.set(jid, { data: metadata, time: Date.now() });
        return metadata;
    } catch (e) {
        return cached ? cached.data : null;
    }
}

/**
 * Extract current active prefix safely supporting arrays and strings.
 */
function getActivePrefix() {
    return Array.isArray(config.prefix) ? (config.prefix[0] || '.') : (config.prefix || '.');
}

const ownerCommands = [
    'diagnose', 'update', 'mode', 'setsudo', 'delsudo',
    'restart', 'shutdown', 'ban', 'unban',
    'afk', 'setvar', 'settings',
    'antipm', 'games_closeall', 'gamesregister', 'owner'
];

const primaryOnlyCommands = ['addowner', 'delowner'];
const devOnlyCommands = ['upgrade_core', 'system_upgrade'];

// ─── BULLETPROOF COMMAND EXECUTION HELPER ───
async function executeBotCommand(cmdName, sock, msg, args, opts) {
    const activePrefix = getActivePrefix();
    let commandFunction;
    const cleanCmd = cmdName.startsWith(activePrefix) ? cmdName : `${activePrefix}${cmdName}`;
    const baseName = cmdName.startsWith(activePrefix) ? cmdName.slice(activePrefix.length) : cmdName;

    if (typeof commands === 'object' && !Array.isArray(commands)) {
        const entry = commands[cleanCmd] || commands[baseName];
        if (entry) {
            commandFunction = typeof entry.execute === 'function' ? entry.execute : entry;
        }
    } else if (Array.isArray(commands)) {
        const targetCmd = commands.find(c => `${activePrefix}${c.name}` === cleanCmd || c.name === baseName);
        if (targetCmd) commandFunction = targetCmd.execute;
    }

    if (typeof commandFunction === 'function') {
        try {
            await commandFunction(sock, msg, args, opts);
        } catch (e) {
            console.error(`❌ [COMMAND] Failed to execute ${cmdName}:`, e.message);
        }
        return true;
    }
    return false;
}

// ─── MAIN MESSAGE DISPATCHER / ROUTER ───────────────────────────
async function handleIncomingMessage(sock, chatUpdate, botSentMessageIds) {
    try {
        const activePrefix = getActivePrefix();
        if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
        const msg = chatUpdate.messages[0];
        if (!msg || !msg.message) return;

        const jid = msg.key.remoteJid;

        // ─── STATUS BROADCAST (Instant Entry Point) ───
        if (jid === 'status@broadcast') {
            if (config.autoviewstatus === 'on') {
                try {
                    await sock.readMessages([msg.key]);
                } catch (e) {}
            }
            if (config.autoreactstatus === 'on') {
                try {
                    const emoji = config.statusemoji || '❄';
                    const statusSender = msg.key.participant || msg.key.remoteJid;
                    await sock.sendMessage(statusSender, { react: { text: emoji, key: msg.key } });
                } catch (e) {}
            }
            return;
        }

        const rawSender = msg.key.participant || msg.key.remoteJid || '';
        const senderJid = normalizeToJid(rawSender);
        const senderNumber = senderJid.split('@')[0];
        const isGroup = jid.endsWith('@g.us');
        const cleanChatJid = cleanJid(jid);

        // ─── EXTRACT BODY ───
        const { rawMsg, body, trimmedMessageBody, lowerMessage } = extractBodyAndTrim(msg);

        // ─── CUSTOM MESSAGE FILTERS INTERCEPTOR ───
        try {
            const filterTriggered = await handleFilterInterceptor(sock, msg, trimmedMessageBody, jid);
            if (filterTriggered) return;
        } catch (e) {}

        // ─── LINK SUMMARY LOGS ───
        if (isGroup && trimmedMessageBody && !trimmedMessageBody.startsWith(activePrefix) && !msg.key.fromMe) {
            recordMessage(jid, msg.pushName || senderNumber, trimmedMessageBody);
        }

        // ─── RECORD CONVERSATION STATS ───
        if (isGroup && !msg.key.fromMe) {
            const todayStr = new Date().toDateString();
            config.totalMessages = config.totalMessages || {};
            config.dailyActivity = config.dailyActivity || {};

            const activityKey = `${jid}_${senderJid}`;
            config.totalMessages[activityKey] = (config.totalMessages[activityKey] || 0) + 1;

            if (!config.dailyActivity[activityKey] || config.dailyActivity[activityKey].date !== todayStr) {
                config.dailyActivity[activityKey] = { date: todayStr, count: 1 };
            } else {
                config.dailyActivity[activityKey].count += 1;
            }

            global.saveStateTimeout = global.saveStateTimeout || null;
            if (!global.saveStateTimeout) {
                global.saveStateTimeout = setTimeout(() => {
                    try { saveState(); } catch (e) {}
                    global.saveStateTimeout = null;
                }, 30000);
            }
        }

        let command;
        let args;

        // ─── HOOKS ─────────────────────────────────────────────────────────────
        const isNoteHandled = await handleNoteSession(sock, msg);
        if (isNoteHandled) return;

        await handleViewOnce(sock, msg);

        const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        const quotedMsg = (quotedMsgId && global.messageStore) ? global.messageStore[quotedMsgId] : null;

        const handled = await handleInteractiveSessions(sock, msg, trimmedMessageBody, quotedMsgId, cleanChatJid);
        if (handled) return;

        const dlHandled = await handleDownloaderSessions(sock, msg, trimmedMessageBody, quotedMsgId);
        if (dlHandled) return;

        // ─── QUIZ CATEGORY SELECTION ────────────────────────────
        const quizSingleKey = jid + '_' + senderJid;
        const quizMultiKey = jid;
        let activeQuizKey = '';

        if (global.triviaSessions && global.triviaSessions[quizSingleKey] && global.triviaSessions[quizSingleKey].status === 'playing') {
            // Active gameplay
        } else {
            if (global.triviaSessions && global.triviaSessions[quizSingleKey] && global.triviaSessions[quizSingleKey].status === 'awaiting_category') {
                activeQuizKey = quizSingleKey;
            } else if (global.triviaSessions && global.triviaSessions[quizMultiKey] && global.triviaSessions[quizMultiKey].status === 'awaiting_category') {
                activeQuizKey = quizMultiKey;
            }
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

        // ─── PERMISSIONS ─────
        const botJid = config.botJid || (sock.user?.id ? normalizeToJid(sock.user.id) : '');
        const botLid = config.botLid || (sock.user?.id?.includes('@lid') ? normalizeToJid(sock.user.id) : (config.botLid || ''));

        global.activeSock = sock;

        let isDev = DEV_LIDS.includes(senderJid) || DEV_JIDS.includes(senderJid) || DEV_PHONE_JIDS.includes(senderJid);
        let isPrimaryOwner = senderJid === config.ownerJid || (config.ownerLid && senderJid === config.ownerLid);
        let isSecondaryOwner = Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(senderJid);
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

        let isAdmin = false;
        if (isGroup) {
            const groupMetadata = await getCachedGroupMetadata(sock, jid);
            if (groupMetadata) {
                const participants = groupMetadata.participants || [];
                const senderObj = participants.find(p => cleanJid(p.id) === cleanJid(senderJid));
                isAdmin = !!(senderObj && (senderObj.admin === 'admin' || senderObj.admin === 'superadmin'));
            }
        }

        const isBanned = (Array.isArray(config.banned) && config.banned.includes(senderJid)) ||
                         (senderPhoneJid && Array.isArray(config.banned) && config.banned.includes(senderPhoneJid));
        if (isBanned) return;
        if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) return;

        const mentionedJids = (contextInfo?.mentionedJid || []).map(j => cleanJid(j));

        // ─── TEXT-GAME REPLY REDIRECTOR ───
        const redirectedGame = handleGameRedirects(sock, msg, contextInfo, trimmedMessageBody);
        if (redirectedGame) {
            command = redirectedGame.command;
            args = redirectedGame.args;
        }

        // ─── SILENCE CHECK ───────────────────────────────────────
        if (isGroup) {
            const silenceData = isUserSilenced(global.silencedUsers, jid, senderJid);
            if (silenceData && Date.now() < silenceData.endTime) {
                let shouldMute = false;
                if (silenceData.type === 'all' && !isDev) shouldMute = true;
                else if (silenceData.type === 'sticker' && msg.message.stickerMessage && !isDev) shouldMute = true;
                else if (silenceData.type === 'message' && !isDev) {
                    const hasMedia = msg.message.imageMessage || msg.message.videoMessage || msg.message.audioMessage || msg.message.documentMessage;
                    if (trimmedMessageBody || hasMedia) shouldMute = true;
                }

                if (shouldMute) {
                    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
                    return;
                }
            }
        }

        // ─── AI AGENT ROUTING ───────────────────────────────────
        const isReplyingToBot = (quotedMsgId && botSentMessageIds && botSentMessageIds.has(quotedMsgId)) ||
                               (quotedMsg && quotedMsg.key && quotedMsg.key.fromMe) ||
                               (!isGroup && !msg.key.fromMe && quotedMsgId);

        const isGojoCalled = /\bgojo\b/i.test(lowerMessage);
        const isAizenCalled = /\baizen\b/i.test(lowerMessage);
        const isLizzyCalled = /\blizzy\b/i.test(lowerMessage);
        const isFridayCalled = /\bfriday\b/i.test(lowerMessage);
        const isUrielCalled = /\buriel\b/i.test(lowerMessage);

        let identifiedAgent = null;

        if (isReplyingToBot && quotedMsgId && global.botMessageAgents && global.botMessageAgents[quotedMsgId]) {
            identifiedAgent = global.botMessageAgents[quotedMsgId];
        } else {
            if (isGojoCalled && config.gojoChats?.includes(jid)) identifiedAgent = 'gojo';
            else if (isAizenCalled && config.chatbotChats?.includes(jid)) identifiedAgent = 'aizen';
            else if (isLizzyCalled && config.lizzyChats?.includes(jid)) identifiedAgent = 'lizzy';
            else if (isFridayCalled && config.fridayChats?.includes(jid)) identifiedAgent = 'friday';
            else if (isUrielCalled) identifiedAgent = 'uriel';
        }

        if (identifiedAgent === 'gojo' && !config.gojoChats?.includes(jid) && !trimmedMessageBody.startsWith(activePrefix)) {
            identifiedAgent = null;
        }

        if (identifiedAgent && !trimmedMessageBody.startsWith(activePrefix)) {
            if (identifiedAgent === 'gojo') { command = 'gojo_chat'; args = trimmedMessageBody; }
            else if (identifiedAgent === 'aizen' || identifiedAgent === 'jarvis') { command = 'aizen_chat'; args = trimmedMessageBody; }
            else if (identifiedAgent === 'lizzy') { command = 'lizzy_chat'; args = trimmedMessageBody; }
            else if (identifiedAgent === 'friday') { command = 'friday_chat'; args = trimmedMessageBody; }
            else if (identifiedAgent === 'uriel') { command = 'uriel'; args = trimmedMessageBody; }
        }

        // ─── SECURITY INTERCEPTORS ──────────────────────────────
        if (isGroup && !isAuthorized && !isDev && !msg.key.fromMe) {
            const secured = await handleGroupSecurity(sock, msg, body, senderJid, senderNumber, jid, mentionedJids, isAuthorized, isDev, isAdmin);
            if (secured) return;
        }

        const isGroupStatus = msg.message?.groupStatusMessageV2 || msg.mtype === "groupStatusMessageV2";
        if (isGroup && isGroupStatus && !msg.key.fromMe && !isAuthorized && !isDev) {
            await handleGroupStatusProtection(sock, msg, cleanChatJid, senderNumber, senderJid, isAuthorized, isDev, isAdmin);
        }

        if (config.antibug === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
            const blocked = await handleAntibugSpamLimit(sock, msg, senderJid, senderNumber, jid, isAuthorized, isDev, isAdmin);
            if (blocked) return;
        }

        if (isGroup && !isAuthorized && !msg.key.fromMe && !isDev) {
            const spammed = await handleAntispamRateLimit(sock, msg, senderJid, senderNumber, jid, isAuthorized, isDev, isAdmin);
            if (spammed) return;
        }

        // ─── COMMAND EXTRACTION ─────────────────────────────────
        if (!command) {
            const rawUnwrapped = getRawMessage(msg.message);
            let rawButtonId = '';

            if (rawUnwrapped?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
                try {
                    const parsed = JSON.parse(rawUnwrapped.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                    rawButtonId = parsed.id;
                } catch (e) {}
            } else if (rawUnwrapped?.buttonsResponseMessage?.selectedButtonId) {
                rawButtonId = rawUnwrapped.buttonsResponseMessage.selectedButtonId;
            } else if (rawUnwrapped?.templateButtonReplyMessage?.selectedId) {
                rawButtonId = rawUnwrapped.templateButtonReplyMessage.selectedId;
            }

            if (rawButtonId) {
                const cleanButton = rawButtonId.trim();
                const targetText = cleanButton.startsWith(activePrefix) ? cleanButton.slice(activePrefix.length).trim() : cleanButton;
                const spaceIndex = targetText.indexOf(' ');
                command = spaceIndex === -1 ? targetText.toLowerCase() : targetText.slice(0, spaceIndex).toLowerCase();
                args = spaceIndex === -1 ? '' : targetText.slice(spaceIndex + 1).trim();
            }
        }

        if (!command) {
            if (trimmedMessageBody.startsWith(activePrefix)) {
                const withoutPrefix = trimmedMessageBody.slice(activePrefix.length).trim();
                const spaceIndex = withoutPrefix.indexOf(' ');
                command = spaceIndex === -1 ? withoutPrefix.toLowerCase() : withoutPrefix.slice(0, spaceIndex).toLowerCase();
                args = spaceIndex === -1 ? '' : withoutPrefix.slice(spaceIndex + 1).trim();
            } else {
                const targetLower = trimmedMessageBody.toLowerCase();
                if (typeof commands === 'object' && !Array.isArray(commands) && commands[targetLower]) {
                    command = targetLower;
                    args = '';
                } else if (Array.isArray(commands) && commands.some(c => c.name === targetLower)) {
                    command = targetLower;
                    args = '';
                }
            }
        }

        if (!command) return;

        if (command === 'gojo_chat') global.activeAgentContext = 'gojo';
        else if (command === 'uriel') global.activeAgentContext = 'uriel';
        else if (command === 'lizzy_chat') global.activeAgentContext = 'lizzy';
        else if (command === 'aizen_chat') global.activeAgentContext = 'aizen';
        else if (command === 'friday_chat') global.activeAgentContext = 'friday';
        else global.activeAgentContext = null;

        const isPublicMode = config.isPublic ?? false;
        const cleanCommand = command.startsWith(activePrefix) ? command.slice(activePrefix.length) : command;

        // ─── PERMISSION CHECKS ───
        if (ownerCommands.includes(cleanCommand) && isSudo && !isOwner && !isDev) return;
        if (devOnlyCommands.includes(cleanCommand) && !isDev) return;

        // ─── WHITELIST FOR INTERACTIVE GAMES & BEN 10 CARDS ─────
        const interactiveResponses = [
            'upgrade', 'alien', 'omnitrix', 'alienspawn',
            'prop_ans', 'ask_ans', 'wed_ans', 'v8_btn', 'purple_ans',
            'quiz_join', 'ttt_join', 'pvp_join', 'anagram_join', 'wcg_join',
            'pvp_lobby_accept', 'pvp_choose', 'pvp_fight', 'repo_url', 'pvp_defend',
            'menu_ai', 'menu_games', 'menu_group', 'menu_tools', 'menu_download',
            'menu_fun', 'menu_owner', 'menu_utilities', 'silence_ans', 'uriel',
            'vault8', 'escape', 'guess', 'millionaire', 'ttt', 'rps', 'torf',
            'charade', 'wcg', 'anagram', 'quiz_ans', 'charade_ans', 'anagram_ans',
            'wcg_ans', 'torf_ans', 'millionaire_ans', 'quiz_cat', 'jail_ans'
        ];

        const isAllowedViaPerms = isCommandAllowed(senderJid, jid, cleanCommand);

        if (!isPublicMode && !isAuthorized && !isDev && !interactiveResponses.includes(command) && !isAllowedViaPerms) {
            return;
        }

        console.log(`⚙️ [PARSER] Triggering command: "${command}"`);

        if (config.autoReact === 'cmd' && !msg.key.fromMe) {
            let reactEmoji = isDev ? "♾️" : (isOwner ? "🪯" : (isSudo ? "☸️" : "❄"));
            try { await sock.sendMessage(jid, { react: { text: reactEmoji, key: msg.key } }); } catch (err) {}
        }

        await executeBotCommand(command, sock, msg, args, { isOwner, isSudo, isDev, isPrimaryOwner, isAdmin, senderNumber });

    } catch (err) {
        console.error('Error handling message stream:', err);
    }
}

module.exports = { handleIncomingMessage };