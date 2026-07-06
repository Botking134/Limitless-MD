// helpers/GameInterceptors.js


const config = require('../config');
const { getRawMessage } = require('./Message');

// Handles text reply redirections for Vault 8, Escape, Guess, Millionaire, TTT, Anagrams, etc.
function handleGameRedirects(sock, msg, quotedMsg, trimmedMessageBody) {
    // Strict null-guard to prevent crashes on non-reply messages
    if (!quotedMsg) return null;

    const quotedRaw = getRawMessage(quotedMsg.message) || quotedMsg.message;
    const quotedText = quotedRaw?.conversation || 
                       quotedRaw?.extendedTextMessage?.text || 
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
            { pattern: 'ANAGRAM', cmd: 'anagram' }
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

    // 1. QUIZ/TRIVIA ANSWER INTERCEPTOR
    const singleKey = jid + '_' + senderJid;
    const multiKey = jid;
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
    const pvpSessionKey = jid;
    if (global.pvpSessions && global.pvpSessions[pvpSessionKey]) {
        const session = global.pvpSessions[pvpSessionKey];
        if (session.lastQuestionMsgId === quotedMsgId) {
            const ans = trimmedMessageBody.trim();
            const lowerAns = ans.toLowerCase();
            const acceptWords = ['yes', 'y', 'accept', 'play', 'join', 'ok', 'okay'];
            
            if (session.status === 'lobby' && senderJid !== session.p1) {
                if (acceptWords.includes(lowerAns)) {
                    await executeBotCommand('pvp_lobby_accept', sock, msg, ans, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                    return true;
                }
            } else if (session.status === 'p2_choosing' && senderJid === session.p2) {
                await executeBotCommand('pvp_choose', sock, msg, ans, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                return true;
            } else if (session.status === 'fighting' && senderJid === session.turn) {
                await executeBotCommand('pvp_fight', sock, msg, ans, { isOwner: false, isSudo: false, isDev: false, senderNumber });
                return true;
            } else if (session.status === 'defending' && senderJid === session.defender) {
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