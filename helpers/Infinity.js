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

// Link the SummaryManager helper
const { recordMessage } = require('./SummaryManager');

/**
 * Extract current active prefix safely supporting arrays.
 * Read fresh every time to support live updates via commands.js and reload().
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
const devOnlyCommands = ['upgrade'];

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
        const rawSender = msg.key.participant || msg.key.remoteJid || '';
        const senderJid = normalizeToJid(rawSender);
        const senderNumber = senderJid.split('@')[0];
        const isGroup = jid.endsWith('@g.us');
        const cleanChatJid = cleanJid(jid); // Cleaned group JID

        // ─── EXTRACT BODY ───
        const { rawMsg, body, trimmedMessageBody, lowerMessage } = extractBodyAndTrim(msg);

        // ─── LINK SUMMARY LOGS ───
        // Records conversation text into memory if group logging is active (bypasses bot commands and self messages)
        if (isGroup && trimmedMessageBody && !trimmedMessageBody.startsWith(activePrefix) && !msg.key.fromMe) {
            recordMessage(jid, msg.pushName || senderNumber, trimmedMessageBody);
        }

        let command;
        let args;

        // ─── HOOKS ─────────────────────────────────────────────────────────────
        const isNoteHandled = await handleNoteSession(sock, msg);
        if (isNoteHandled) return;

        await handleViewOnce(sock, msg);

        const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        
        // Safety check for messageStore presence
        const quotedMsg = (quotedMsgId && global.messageStore) ? global.messageStore[quotedMsgId] : null;

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
        const botLid = config.botLid || (sock.user?.id?.includes('@lid') ? normalizeToJid(sock.user.id) : (config.botLid || ''));

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

        // Dynamic Group Admin lookup to safely prevent rate limiting loops
        let isAdmin = false;
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants || [];
                const senderObj = participants.find(p => cleanJid(p.id) === cleanJid(senderJid));
                isAdmin = !!(senderObj && (senderObj.admin === 'admin' || senderObj.admin === 'superadmin'));
            } catch (e) {
                isAdmin = false;
            }
        }

        const isBanned = (Array.isArray(config.banned) && config.banned.includes(senderJid)) ||
                         (senderPhoneJid && Array.isArray(config.banned) && config.banned.includes(senderPhoneJid));
        if (isBanned) return;
        if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) return;

        const mentionedJids = (contextInfo?.mentionedJid || []).map(j => cleanJid(j));

        // ─── UNIFIED TEXT-GAME REPLY REDIRECTOR ───
        const redirectedGame = handleGameRedirects(sock, msg, contextInfo, trimmedMessageBody);
        if (redirectedGame) {
            command = redirectedGame.command;
            args = redirectedGame.args;
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
        const isUrielCalled = /\buriel\b/i.test(lowerMessage);

        let identifiedAgent = null;

        if (isReplyingToBot && quotedMsgId && global.botMessageAgents && global.botMessageAgents[quotedMsgId]) {
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
            } else if (!identifiedAgent && isUrielCalled) {
                identifiedAgent = 'uriel';
            }
        }

        if (identifiedAgent === 'gojo') {
            const isAsleep = config.gojoGlobalSleep;
            if (isAsleep && !trimmedMessageBody.startsWith(activePrefix)) identifiedAgent = null;
        }

        if (identifiedAgent && !trimmedMessageBody.startsWith(activePrefix)) {
            if (identifiedAgent === 'gojo') {
                command = 'gojo';
                args = trimmedMessageBody;
            } else if (identifiedAgent === 'uriel') {
                command = 'uriel';
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
            const secured = await handleGroupSecurity(sock, msg, body, senderJid, senderNumber, jid, mentionedJids, isAuthorized, isDev, isAdmin);
            if (secured) return;
        }

        // ─── GROUP STATUS PROTECTION ─────────────────────────────
        const isGroupStatus = msg.message?.groupStatusMessageV2 || msg.mtype === "groupStatusMessageV2";
        if (isGroup && isGroupStatus && !msg.key.fromMe && !isAuthorized && !isDev) {
            await handleGroupStatusProtection(sock, msg, cleanChatJid, senderNumber, senderJid, isAuthorized, isDev, isAdmin);
        }

        // ─── ANTIBUG RATE-LIMIT ──────────────────────────────────
        if (config.antibug === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
            const blocked = await handleAntibugSpamLimit(sock, msg, senderJid, senderNumber, jid, isAuthorized, isDev, isAdmin);
            if (blocked) return;
        }

        // ─── ANTISPAM RATE-LIMIT ─────────────────────────────────
        if (isGroup && !isAuthorized && !msg.key.fromMe && !isDev) {
            const spammed = await handleAntispamRateLimit(sock, msg, senderJid, senderNumber, jid, isAuthorized, isDev, isAdmin);
            if (spammed) return;
        }

        // ─── COMMAND EXTRACTION ───
        if (!command) {
            // ─── INTERACTIVE BUTTON INTERCEPTOR ───
            const rawUnwrapped = getRawMessage(msg.message);
            let buttonId = '';

            if (rawUnwrapped?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
                try {
                    const parsed = JSON.parse(rawUnwrapped.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                    buttonId = parsed.id;
                } catch (e) { /* ignore */ }
            } else if (rawUnwrapped?.buttonsResponseMessage?.selectedButtonId) {
                buttonId = rawUnwrapped.buttonsResponseMessage.selectedButtonId;
            } else if (rawUnwrapped?.templateButtonReplyMessage?.selectedId) {
                buttonId = rawUnwrapped.templateButtonReplyMessage.selectedId;
            }

            if (!buttonId && trimmedMessageBody.toLowerCase().includes('explore commands')) {
                const targetQuotedMsg = (quotedMsgId && global.messageStore) ? global.messageStore[quotedMsgId] : null;
                if (targetQuotedMsg) {
                    const rawQuoted = getRawMessage(targetQuotedMsg.message);
                    const quotedText = (
                        rawQuoted?.conversation || 
                        rawQuoted?.extendedTextMessage?.text || 
                        rawQuoted?.imageMessage?.caption || 
                        rawQuoted?.interactiveMessage?.body?.text || 
                        rawQuoted?.buttonsMessage?.contentText ||
                        ''
                    ).toUpperCase();

                    if (quotedText.includes('AI & CHATBOT')) buttonId = 'menu_ai';
                    else if (quotedText.includes('INTERACTIVE GAMES') || quotedText.includes('GAMES')) buttonId = 'menu_games';
                    else if (quotedText.includes('GROUP MANAGEMENT') || quotedText.includes('GROUP')) buttonId = 'menu_group';
                    else if (quotedText.includes('TOOLS')) buttonId = 'menu_tools';
                    else if (quotedText.includes('DOWNLOADER')) buttonId = 'menu_download';
                    else if (quotedText.includes('FUN & ROLEPLAY') || quotedText.includes('FUN')) buttonId = 'menu_fun';
                    else if (quotedText.includes('OWNER & DEV') || quotedText.includes('OWNER')) buttonId = 'menu_owner';
                    else if (quotedText.includes('UTILITIES')) buttonId = 'menu_utilities';
                }
            }

            if (buttonId) {
                command = buttonId.trim().toLowerCase();
                args = '';
            }
        }

        if (!command) {
            if (trimmedMessageBody.startsWith(activePrefix)) {
                const withoutPrefix = trimmedMessageBody.slice(activePrefix.length).trim();
                const spaceIndex = withoutPrefix.indexOf(' ');
                if (spaceIndex === -1) {
                    command = withoutPrefix.toLowerCase();
                    args = '';
                } else {
                    command = withoutPrefix.slice(0, spaceIndex).toLowerCase();
                    args = withoutPrefix.slice(spaceIndex + 1).trim();
                }
            } else if (commands[trimmedMessageBody.toLowerCase()]) {
                command = trimmedMessageBody.toLowerCase();
                args = '';
            }
        }

        if (!command) return;

        // ─── AGENT CONTEXT ─────────────────────────────────────────
        if (command === 'gojo') global.activeAgentContext = 'gojo';
        else if (command === 'uriel') global.activeAgentContext = 'uriel';
        else if (command === 'lizzy_chat') global.activeAgentContext = 'lizzy';
        else if (command === 'chatbot_chat') global.activeAgentContext = 'jarvis';
        else if (command === 'friday_chat') global.activeAgentContext = 'friday';
        else global.activeAgentContext = null;

        const isPublicMode = config.isPublic ?? false;
        const cleanCommand = command.startsWith(activePrefix) ? command.slice(activePrefix.length) : command;

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
            'menu_fun', 'menu_owner', 'menu_utilities', 'silence_ans', 'uriel'
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