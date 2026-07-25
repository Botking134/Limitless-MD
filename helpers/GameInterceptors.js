// helpers/GameInterceptors.js
const config = require('../config');
const { getRawMessage, cleanJid } = require('./Message');
const { normalizeToJid } = require('../stateManager');

/**
 * Handles text reply redirections for text-based games by matching card headers.
 */
function handleGameRedirects(sock, msg, contextInfo, trimmedMessageBody) {
    if (!contextInfo || !contextInfo.quotedMessage) return null;

    const quotedRaw = getRawMessage(contextInfo.quotedMessage) || contextInfo.quotedMessage;
    
    const quotedText = (
        quotedRaw?.conversation || 
        quotedRaw?.extendedTextMessage?.text || 
        quotedRaw?.imageMessage?.caption || 
        quotedRaw?.videoMessage?.caption || 
        quotedRaw?.interactiveMessage?.body?.text ||
        quotedRaw?.interactiveMessage?.header?.title ||
        quotedRaw?.interactiveMessage?.footer?.text ||
        quotedRaw?.templateMessage?.hydratedTemplate?.hydratedContentText ||
        quotedRaw?.buttonsMessage?.contentText ||
        quotedRaw?.documentMessage?.caption ||
        ''
    ).toUpperCase();

    if (quotedText) {
        const gameRedirects = [
            { pattern: 'VAULT 8:', cmd: 'vault8' },
            { pattern: 'ESCAPE ROOM:', cmd: 'escape' },
            { pattern: 'CURSED ENERGY CONCENTRATION', cmd: 'guess' },
            { pattern: 'CURSED ENERGY CLUE', cmd: 'guess' },
            { pattern: 'WHO WANTS TO BE A MILLIONAIRE', cmd: 'millionaire' },
            { pattern: 'TIC-TAC-TOE', cmd: 'ttt' },
            { pattern: 'ROCK PAPER SCISSORS', cmd: 'rps' },
            { pattern: 'TRUE OR FALSE', cmd: 'torf' },
            { pattern: 'EMOJI CHARADES', cmd: 'charade' },
            { pattern: 'CHARADE', cmd: 'charade' },
            { pattern: 'SHARADE', cmd: 'charade' },
            { pattern: 'WORD CHAIN', cmd: 'wcg' },
            { pattern: 'ANAGRAM', cmd: 'anagram' },
            { pattern: 'TOPIC QUIZ:', cmd: 'quiz_ans' },
            { pattern: 'QUIZ TURN:', cmd: 'quiz_ans' },
            { pattern: 'QUIZ CATEGORIES', cmd: 'quiz_cat' },
            { pattern: 'PVP DUEL', cmd: 'pvp' },
            { pattern: 'BATTLE START', cmd: 'pvp' },
            { pattern: 'ATTACK INCOMING', cmd: 'pvp_defend' }
        ];

        for (const redirect of gameRedirects) {
            if (quotedText.includes(redirect.pattern)) {
                return { command: redirect.cmd, args: trimmedMessageBody };
            }
        }
    }
    return null;
}

// ─── ACTIVE GAME INTERACTIVE ANSWER CAPTURER ───────────────────
async function handleActiveGameAnswers(sock, msg, quotedMsgId, trimmedMessageBody, jid, senderJid, senderNumber, executeBotCommand) {
    if (!quotedMsgId) return false;

    const cleanChat = cleanJid(jid);
    const cleanSender = normalizeToJid(senderJid);

    // 1. QUIZ/TRIVIA ANSWER INTERCEPTOR
    const singleKey = cleanChat + '_' + cleanSender;
    const multiKey = cleanChat;
    let activeQuizAnswerKey = '';

    if (global.triviaSessions && global.triviaSessions[singleKey] && global.triviaSessions[singleKey].status === 'playing') {
        activeQuizAnswerKey = singleKey;
    } else if (global.triviaSessions && global.triviaSessions[multiKey] && global.triviaSessions[multiKey].status === 'playing') {
        activeQuizAnswerKey = multiKey;
    }

    if (activeQuizAnswerKey && global.triviaSessions && global.triviaSessions[activeQuizAnswerKey]) {
        const session = global.triviaSessions[activeQuizAnswerKey];
        if (session.status === 'playing' && session.lastQuestionMsgId === quotedMsgId) {
            const ans = trimmedMessageBody.toLowerCase().trim();
            if (['a', 'b', 'c', 'd'].includes(ans)) {
                await executeBotCommand('quiz_ans', sock, msg, ans, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                return true;
            }
        }
    }

    // 2. PVP GAME INTERCEPTOR
    const pvpSessionKey = cleanChat;
    if (global.pvpSessions && global.pvpSessions[pvpSessionKey]) {
        const session = global.pvpSessions[pvpSessionKey];
        if (session.lastQuestionMsgId === quotedMsgId) {
            const ans = trimmedMessageBody.trim();
            const lowerAns = ans.toLowerCase();
            const acceptWords = ['yes', 'y', 'accept', 'play', 'join', 'ok', 'okay'];
            
            const normalizedP1 = normalizeToJid(session.p1);
            const normalizedP2 = normalizeToJid(session.p2);
            const normalizedTurn = normalizeToJid(session.turn);
            const normalizedDefender = normalizeToJid(session.defender);

            if (session.status === 'lobby' && cleanSender !== normalizedP1) {
                if (acceptWords.includes(lowerAns)) {
                    await executeBotCommand('pvp_lobby_accept', sock, msg, ans, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                    return true;
                }
            } else if (session.status === 'p2_choosing' && cleanSender === normalizedP2) {
                await executeBotCommand('pvp_choose', sock, msg, ans, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                return true;
            } else if (session.status === 'fighting' && cleanSender === normalizedTurn) {
                await executeBotCommand('pvp_fight', sock, msg, ans, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                return true;
            } else if (session.status === 'defending' && cleanSender === normalizedDefender) {
                await executeBotCommand('pvp_defend', sock, msg, ans, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                return true;
            }
        }
    }

    return false;
}

module.exports = {
    handleGameRedirects,
    handleActiveGameAnswers
};