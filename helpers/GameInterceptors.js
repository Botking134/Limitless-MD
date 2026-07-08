// helpers/GameInterceptors.js
const config = require('../config');

// Helper to safely resolve nested raw message contents
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// Upgraded to safely normalize base JIDs and handle both LID and multi-device platforms
function normalizeToJid(id) {
    if (!id) return '';
    const clean = id.split(':')[0].split('@')[0];
    const domain = id.includes('@lid') ? '@lid' : '@s.whatsapp.net';
    return clean + domain;
}

// Handles text reply redirections for Vault 8, Escape, Guess, Millionaire, TTT, Anagrams, etc.
function handleGameRedirects(sock, msg, contextInfo, trimmedMessageBody) {
    // Guard: If there is no quoted message payload, exit immediately
    if (!contextInfo || !contextInfo.quotedMessage) return null;

    const quotedRaw = getRawMessage(contextInfo.quotedMessage) || contextInfo.quotedMessage;
    
    // Upgraded to extract text from standard, button, template, document, and interactive formats
    const quotedText = quotedRaw?.conversation || 
                       quotedRaw?.extendedTextMessage?.text || 
                       quotedRaw?.imageMessage?.caption || 
                       quotedRaw?.videoMessage?.caption || 
                       quotedRaw?.interactiveMessage?.body?.text ||
                       quotedRaw?.interactiveMessage?.header?.title ||
                       quotedRaw?.interactiveMessage?.footer?.text ||
                       quotedRaw?.templateMessage?.hydratedTemplate?.hydratedContentText ||
                       quotedRaw?.buttonsMessage?.contentText ||
                       quotedRaw?.documentMessage?.caption ||
                       '';

    if (quotedText) {
        const quotedUpper = quotedText.toUpperCase();
        
        const gameRedirects = [
            { pattern: 'VAULT 8: STEP', cmd: 'vault8' },
            { pattern: 'ESCAPE: STEP', cmd: 'escape' },
            { pattern: 'GUESS THE NUMBER', cmd: 'guess' },
            { pattern: 'MILLIONAIRE', cmd: 'millionaire' },
            { pattern: 'TIC-TAC-TOE', cmd: 'ttt' },
            { pattern: 'TIC TAC TOE', cmd: 'ttt' },
            { pattern: 'ROCK PAPER SCISSORS', cmd: 'rps' },
            { pattern: 'TRUE OR FALSE', cmd: 'torf' },
            { pattern: 'CHARADE', cmd: 'charade' },
            { pattern: 'SHARADE', cmd: 'charade' },
            { pattern: 'WORD CHAIN GAME', cmd: 'wcg' },
            { pattern: 'ANAGRAM', cmd: 'anagram' },
            { pattern: 'WORD SCRAMBLE', cmd: 'scramble' },
            { pattern: 'SCRAMBLE', cmd: 'scramble' },
            { pattern: 'MATH QUIZ', cmd: 'math' },
            { pattern: 'SOLVE THE', cmd: 'math' },
            { pattern: 'HANGMAN', cmd: 'hangman' },
            { pattern: 'BLACKJACK', cmd: 'blackjack' },
            { pattern: 'CHESS', cmd: 'chess' }
        ];

        for (const redirect of gameRedirects) {
            if (quotedUpper.includes(redirect.pattern)) {
                return { command: redirect.cmd, args: trimmedMessageBody };
            }
        }
    }
    return null;
}

// ─── ACTIVE GAME INTERACTIVE ANSWER CAPTURER ───────────────────
async function handleActiveGameAnswers(sock, msg, quotedMsgId, trimmedMessageBody, jid, senderJid, senderNumber, executeBotCommand) {
    if (!quotedMsgId) return false;

    const cleanJid = jid.split('@')[0] + (jid.includes('@g.us') ? '@g.us' : '@s.whatsapp.net');
    const cleanSender = normalizeToJid(senderJid);

    // 1. QUIZ/TRIVIA ANSWER INTERCEPTOR
    const singleKey = cleanJid + '_' + cleanSender;
    const multiKey = cleanJid;
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

    // 2. PVP GAME INTERCEPTOR (With safe, normalized multi-device JID comparison)
    const pvpSessionKey = cleanJid;
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