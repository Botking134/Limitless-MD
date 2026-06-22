// plugins/games2.js
const config = require('../config');
const { saveState, getPhoneJid, normalizeToJid } = require('../stateManager');
const fs = require('fs');
const path = require('path');

// ─── GLOBAL SESSIONS ──────────────────────────────────────────────
global.anagramSessions = global.anagramSessions || {};
global.wcgSessions = global.wcgSessions || {};
global.millionaireSessions = global.millionaireSessions || {};
global.torfSessions = global.torfSessions || {};
global.pvpSessions = global.pvpSessions || {};
global.escapeSessions = global.escapeSessions || {};

// ─── GROQ API HELPER ─────────────────────────────────────────────
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

async function queryLLM(prompt, temperature = 0.8) {
    const apiKey = config.groqApiKey;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set in config or .env");
    const response = await fetch(GROQ_BASE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: temperature
        })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── HELPERS ──────────────────────────────────────────────────────

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

async function resolveToPhoneJid(sock, jid) {
    if (!jid) return '';
    if (jid.endsWith('@s.whatsapp.net')) return jid;
    if (jid.endsWith('@lid')) {
        try {
            const res = await sock.findUserId(jid);
            if (res && res.phoneNumber) return `${res.phoneNumber}@s.whatsapp.net`;
        } catch (e) { /* ignore */ }
    }
    const num = jid.split('@')[0].split(':')[0];
    return `${num}@s.whatsapp.net`;
}

// ─── FALLBACK MILLIONAIRE QUESTIONS ─────────────────────────────

const fallbackMillionaireQuestions = [
    {
        category: "General Anime",
        q: "What is the name of the protagonist in \"One Piece\"?",
        options: ["A) Roronoa Zoro", "B) Sanji", "C) Monkey D. Luffy", "D) Portgas D. Ace"]
    },
    {
        category: "General Anime",
        q: "In \"Attack on Titan\", what is the name of the titan that breaks Wall Maria?",
        options: ["A) Armored Titan", "B) Female Titan", "C) Colossal Titan", "D) Beast Titan"]
    }
];

function getLocalQuestion(filename, category) {
    try {
        const dbPath = path.join(__dirname, '../data/', filename);
        let questions = fallbackMillionaireQuestions;

        if (fs.existsSync(dbPath)) {
            delete require.cache[require.resolve(dbPath)];
            questions = require(dbPath);
        }

        const filtered = questions.filter(q => q.category.toLowerCase() === category.toLowerCase());
        if (filtered.length === 0) return null;

        return filtered[Math.floor(Math.random() * filtered.length)];
    } catch (e) {
        console.error(`❌ [PARSER] Failed to resolve ${filename} question:`, e.message);
        return null;
    }
}

// ─── WORD VALIDATION ─────────────────────────────────────────────

async function isValidEnglishWord(word, minLen, maxLen) {
    const prompt =
        `System: Is the word "${word.toUpperCase()}" a real, valid dictionary-proven English word?\n` +
        `Also, does its length fall between ${minLen} and ${maxLen} letters?\n` +
        `Respond with exactly YES or NO.`;
    const response = await queryLLM(prompt, 0.1);
    return response ? response.trim().toUpperCase().includes("YES") : false;
}

// ─── ANAGRAM HELPERS ─────────────────────────────────────────────

async function generateAnagramWord(difficulty, excludeList = []) {
    const salt = Math.random() + '_' + Date.now();
    let charLimit = "3 to 5 letters";
    if (difficulty === 'medium') charLimit = "6 to 8 letters";
    if (difficulty === 'hard') charLimit = "9 or more letters";

    const prompt =
        `Generate a single dictionary English word that has exactly ${charLimit}.\n` +
        `Respond strictly with a JSON object in this layout. No other text:\n` +
        `{"word": "WORDS"}\n` +
        `To ensure uniqueness, use this random seed: ${salt}.\n` +
        `Do not repeat these past words: ${excludeList.join(', ')}`;
    const response = await queryLLM(prompt, 0.85);
    if (!response) return null;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return null;
    }
}

function scrambleWord(word) {
    const arr = word.toUpperCase().split('');
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const scrambled = arr.join('');
    if (scrambled === word && word.length > 1) return scrambleWord(word);
    return scrambled;
}

// ─── TRUE/FALSE HELPERS ─────────────────────────────────────────

async function generateTorfQuestion(category, excludeList = []) {
    const salt = Math.random() + '_' + Date.now();
    const prompt =
        `Generate an interesting True or False statement under the category: "${category}".\n` +
        `Respond strictly with a JSON object in this exact layout. No other text or markdown:\n` +
        `{"q": "The statement...", "ans": "true" | "false", "explanation": "Brief context explanation"}\n` +
        `To ensure uniqueness, use this random seed: ${salt}.\n` +
        `Do not repeat these past statements: ${excludeList.join(', ')}`;
    const response = await queryLLM(prompt, 0.85);
    if (!response) return null;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return null;
    }
}

// ─── MILLIONAIRE HELPERS ─────────────────────────────────────────

async function askNextMillionaireQuestion(sock, jid, sessionKey) {
    const session = global.millionaireSessions[sessionKey];
    if (session.timerId) clearTimeout(session.timerId);

    if (session.step > 15) {
        const winCard =
            `🏆 *WHO WANTS TO BE A MILLIONAIRE: VICTORY!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🎉 Congratulations @${session.player.split('@')[0]}!\n` +
            `💰 You solved all 15 questions and won the grand prize of *₦1,500,000*! 👑`;
        delete global.millionaireSessions[sessionKey];
        return await sock.sendMessage(jid, { text: winCard, mentions: [session.player] });
    }

    const questionData = getLocalQuestion('millionaire.js', session.category);
    if (!questionData) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve question from database. Game aborted." });

    session.currentQuestion = questionData.q;
    session.currentOptions = questionData.options;

    await sendMillionaireDisplay(sock, jid, sessionKey);
}

async function sendMillionaireDisplay(sock, jid, sessionKey) {
    const session = global.millionaireSessions[sessionKey];
    if (session.timerId) clearTimeout(session.timerId);

    const optionsText = session.currentOptions.map(opt => {
        const letter = opt.charAt(0).toLowerCase();
        if (session.eliminatedOptions.includes(letter)) return `🚫 *[ELIMINATED]*`;
        return opt;
    }).join('\n');

    const gameCard =
        `👑 *WHO WANTS TO BE A MILLIONAIRE* 👑\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 *Question ${session.step}/15:* \n\n` +
        `${session.currentQuestion}\n\n` +
        `${optionsText}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 *Current Value:* \`₦${session.money.toLocaleString()} WAT\`\n` +
        `⌛ *Timer:* \`20 seconds\`\n\n` +
        `👉 *Reply with answer letter (A, B, C, or D), or trigger a lifeline:*`;

    const buttonList = [];
    if (session.lifelines.phone) buttonList.push({ buttonId: `${config.prefix}millionaire_life phone`, buttonText: { displayText: 'Phone a Friend 📞' }, type: 1 });
    if (session.lifelines.fifty) buttonList.push({ buttonId: `${config.prefix}millionaire_life fifty`, buttonText: { displayText: '50/50 👑' }, type: 1 });
    if (session.lifelines.audience) buttonList.push({ buttonId: `${config.prefix}millionaire_life audience`, buttonText: { displayText: 'Ask Group 📊' }, type: 1 });
    buttonList.push({ buttonId: `${config.prefix}millionaire_life walk`, buttonText: { displayText: 'Walk Away 💰' }, type: 1 });

    const buttons = { text: gameCard, buttons: buttonList, headerType: 1 };
    const prompt = await sock.sendMessage(jid, buttons);
    session.lastQuestionMsgId = prompt.key.id;

    session.timerId = setTimeout(async () => {
        await handleMillionaireTimeout(sock, jid, sessionKey);
    }, 20000);
}

async function handleMillionaireTimeout(sock, jid, sessionKey) {
    const session = global.millionaireSessions[sessionKey];
    if (!session) return;

    delete global.millionaireSessions[sessionKey];
    const results = `⏰ *TIME IS UP!* \n\n*GAME OVER:* You leave with *₦${session.money.toLocaleString()} WAT*.`;
    await sock.sendMessage(jid, { text: results, mentions: [session.player] });
}

// ─── PVP ─────────────────────────────────────────────────────────

// 15. PVP – Start a duel lobby
{
    name: 'pvp',
    isPrefixless: false,
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        if (!isGroup) return await sock.sendMessage(jid, { text: "❌ PvP is group-only." }, { quoted: msg });

        const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
        const senderPhone = await resolveToPhoneJid(sock, senderJid);
        const senderNumber = senderPhone.split('@')[0];

        if (!args) return await sock.sendMessage(jid, { text: "❌ You must specify your character name.\nUsage: `.pvp <character>`" }, { quoted: msg });

        if (global.pvpSessions[jid]) return await sock.sendMessage(jid, { text: "⚠️ A PvP session is already active in this group." }, { quoted: msg });

        const character = args.trim();

        // Create lobby
        global.pvpSessions[jid] = {
            p1: senderJid,
            p2: null,
            p1Char: character,
            p2Char: null,
            p1HP: 100,
            p2HP: 100,
            movesLeft: { [senderJid]: 3 },
            turn: null,
            attacker: null,
            defender: null,
            status: 'lobby',
            lastAttack: '',
            lastQuestionMsgId: '',
            timerId: null
        };

        const lobbyText =
            `⚔️ *PVP DUEL LOBBY* ⚔️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👤 *Player 1:* @${senderNumber} (${character})\n` +
            `🌀 *Status:* Waiting for a challenger...\n\n` +
            `👉 *To join, reply with:* \`${config.prefix}pvp_join <your character>\``;

        const prompt = await sock.sendMessage(jid, { text: lobbyText, mentions: [senderPhone] });
        global.pvpSessions[jid].lastQuestionMsgId = prompt.key.id;

        // Auto-close after 30 seconds
        global.pvpSessions[jid].timerId = setTimeout(async () => {
            const session = global.pvpSessions[jid];
            if (session && session.status === 'lobby') {
                delete global.pvpSessions[jid];
                await sock.sendMessage(jid, { text: "🛑 *Lobby expired:* No challenger joined." });
            }
        }, 30000);
    }
},

// 16. PVP_JOIN – Join the lobby
{
    name: 'pvp_join',
    isPrefixless: false,
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
        const senderPhone = await resolveToPhoneJid(sock, senderJid);
        const senderNumber = senderPhone.split('@')[0];

        const session = global.pvpSessions[jid];
        if (!session || session.status !== 'lobby') return;
        if (session.p2) return await sock.sendMessage(jid, { text: "❌ Already have a challenger." }, { quoted: msg });
        if (senderJid === session.p1) return await sock.sendMessage(jid, { text: "❌ You are the host." }, { quoted: msg });

        if (!args) return await sock.sendMessage(jid, { text: "❌ Specify your character name.\nUsage: `.pvp_join <character>`" }, { quoted: msg });

        const character = args.trim();
        session.p2 = senderJid;
        session.p2Char = character;
        session.movesLeft[senderJid] = 3;
        session.status = 'fighting';
        session.turn = session.p1; // p1 attacks first
        session.attacker = session.p1;
        session.defender = session.p2;
        session.p1HP = 100;
        session.p2HP = 100;

        if (session.timerId) clearTimeout(session.timerId);

        const p1Phone = await resolveToPhoneJid(sock, session.p1);
        const p1Number = p1Phone.split('@')[0];
        const p2Phone = senderPhone;
        const p2Number = senderNumber;

        const startText =
            `⚔️ *BATTLE START!* ⚔️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `👤 ${session.p1Char} (@${p1Number}) vs ${session.p2Char} (@${p2Number})\n` +
            `🛡️ *HP:* \`100/100\` each\n` +
            `⏳ *Moves remaining:* \`3\` each\n\n` +
            `👉 @${p1Number}, it's your turn to attack! Type your attack (any anime/comic move).\n` +
            `📩 *Reply directly to this message with your attack!*`;

        const prompt = await sock.sendMessage(jid, { text: startText, mentions: [p1Phone, p2Phone] });
        session.lastQuestionMsgId = prompt.key.id;
    }
},

// 17. PVP_LOBBY_ACCEPT – Handler for join reply (fallback)
{
    name: 'pvp_lobby_accept',
    isPrefixless: false,
    execute: async (sock, msg, args) => {
        // This is handled by pvp_join logic above, but keep a dummy to avoid errors
        return await sock.sendMessage(msg.key.remoteJid, { text: "Use `.pvp_join <character>` to join." }, { quoted: msg });
    }
},

// 18. PVP_CHOOSE – Not used directly; kept for compatibility
{
    name: 'pvp_choose',
    isPrefixless: false,
    execute: async (sock, msg, args) => {
        // This is handled by the fighting flow; fallback
        return await sock.sendMessage(msg.key.remoteJid, { text: "Invalid command." }, { quoted: msg });
    }
},

// 19. PVP_FIGHT – Process an attack (called from interceptor)
{
    name: 'pvp_fight',
    isPrefixless: false,
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
        const senderPhone = await resolveToPhoneJid(sock, senderJid);
        const session = global.pvpSessions[jid];
        if (!session || session.status !== 'fighting') return;

        // ─── REPLY GUARD ───
        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) return;

        // Ensure it's the attacker's turn
        if (senderJid !== session.attacker) return await sock.sendMessage(jid, { text: `⏳ Wait your turn!`, mentions: [senderPhone] }, { quoted: msg });

        if (session.timerId) clearTimeout(session.timerId);

        const attackMove = args.trim();
        if (!attackMove) return await sock.sendMessage(jid, { text: "❌ Enter an attack move." }, { quoted: msg });

        // Validate move
        const attackerChar = senderJid === session.p1 ? session.p1Char : session.p2Char;
        const isValid = await evaluatePvpAttack(attackerChar, attackMove);
        if (isValid !== "VALID_MOVE") {
            return await sock.sendMessage(jid, { text: `❌ "${attackMove}" is not a valid attack for ${attackerChar}.` }, { quoted: msg });
        }

        session.lastAttack = attackMove;
        session.status = 'defending';
        session.defender = senderJid === session.p1 ? session.p2 : session.p1;
        session.attacker = senderJid; // keep track

        const defenderPhone = await resolveToPhoneJid(sock, session.defender);
        const defenderNumber = defenderPhone.split('@')[0];
        const attackerNumber = senderPhone.split('@')[0];

        const defendPrompt =
            `💥 *ATTACK INCOMING!* 💥\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `⚔️ *${attackerChar}* (@${attackerNumber}) uses *"${attackMove}"* on @${defenderNumber}!\n\n` +
            `🛡️ *Defender's turn:* Reply with a defensive move (e.g., dodge, block, counter).\n` +
            `⏳ *Timer:* 15 seconds.`;

        const prompt = await sock.sendMessage(jid, { text: defendPrompt, mentions: [defenderPhone, senderPhone] });
        session.lastQuestionMsgId = prompt.key.id;

        // Set timer for defense timeout
        session.timerId = setTimeout(async () => {
            await handlePvpDefenseTimeout(sock, jid);
        }, 15000);
    }
},

// 20. PVP_DEFEND – Process a defense (called from interceptor)
{
    name: 'pvp_defend',
    isPrefixless: false,
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
        const session = global.pvpSessions[jid];
        if (!session || session.status !== 'defending') return;

        // ─── REPLY GUARD ───
        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) return;

        // Ensure it's the defender
        if (senderJid !== session.defender) return await sock.sendMessage(jid, { text: `⏳ You are not the defender!` }, { quoted: msg });

        if (session.timerId) clearTimeout(session.timerId);

        const defenseMove = args.trim();
        if (!defenseMove) return await sock.sendMessage(jid, { text: "❌ Enter a defense move." }, { quoted: msg });

        const attacker = session.attacker;
        const defender = session.defender;
        const attackerChar = attacker === session.p1 ? session.p1Char : session.p2Char;
        const defenderChar = defender === session.p1 ? session.p1Char : session.p2Char;

        // Evaluate the clash
        const evaluation = await evaluatePvpClash(attackerChar, defenderChar, session.lastAttack, defenseMove);

        let damage = 0;
        let report = evaluation ? evaluation.replace(/DAMAGE:\s*\d+/i, '').trim() : "The clash was intense!";

        if (evaluation) {
            const match = evaluation.match(/DAMAGE:\s*(\d+)/i);
            if (match) damage = parseInt(match[1]);
        }

        // Apply damage to defender
        if (defender === session.p1) {
            session.p1HP = Math.max(0, session.p1HP - damage);
        } else {
            session.p2HP = Math.max(0, session.p2HP - damage);
        }

        session.movesLeft[attacker]--;

        const p1Phone = await resolveToPhoneJid(sock, session.p1);
        const p2Phone = await resolveToPhoneJid(sock, session.p2);

        const statusReport =
            `💢 *CLASH RESULT* 💢\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${report}\n\n` +
            `🛡️ *HP Status:*\n` +
            `• ${session.p1Char} (@${p1Phone.split('@')[0]}): \`${session.p1HP} HP\`\n` +
            `• ${session.p2Char} (@${p2Phone.split('@')[0]}): \`${session.p2HP} HP\``;

        await sock.sendMessage(jid, { text: statusReport, mentions: [p1Phone, p2Phone] });

        await delay(2000);

        // Check for game over
        if (await checkPvpGameOver(sock, jid, session)) return;

        // Swap roles: defender becomes attacker for next round
        session.status = 'fighting';
        session.attacker = defender;
        session.defender = attacker;
        session.turn = defender;

        const newAttackerPhone = await resolveToPhoneJid(sock, session.attacker);
        const nextTurnText =
            `👉 It is now @${newAttackerPhone.split('@')[0]}'s turn to attack! Reply to this message with your move.`;

        const prompt = await sock.sendMessage(jid, { text: nextTurnText, mentions: [newAttackerPhone] });
        session.lastQuestionMsgId = prompt.key.id;
    }
},

// ─── ESCAPE ROOM HELPERS ─────────────────────────────────────────

async function promptNextEscapeStep(sock, jid, sessionKey) {
    const session = global.escapeSessions[sessionKey];

    if (session.step > 10) {
        const victoryCard = `🎉 *CONGRATULATIONS: ESCAPED!* 🎉\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🔓 You successfully cleared all 10 stages of the room and survived with *${session.lives}❤️* left!`;
        delete global.escapeSessions[sessionKey];
        return await sock.sendMessage(jid, { text: victoryCard });
    }

    const systemPrompt =
        `You are the master of a creepy Escape Room adventure game.\n` +
        `Generate Stage ${session.step} of 10. Provide exactly 3 choices (1, 2, 3).\n` +
        `If the user's choice is fatal or incorrect, they lose a life. If they lose a life, end with "LIFE_LOST" at the very end.\n` +
        `If they lose all lives, end with "GAME_OVER" at the very end.`;

    const engineResponse = await queryLLM(systemPrompt, 0.8);
    if (!engineResponse) return await sock.sendMessage(jid, { text: "❌ Failed to load next room assets." });

    if (engineResponse.includes("GAME_OVER")) {
        const cleanMsg = engineResponse.replace("GAME_OVER", "").trim();
        const failText = `💀 *STAGE ${session.step}/10: DIED!* 💀\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${cleanMsg}\n\n❌ *GAME OVER: You ran out of hearts!*`;
        delete global.escapeSessions[sessionKey];
        return await sock.sendMessage(jid, { text: failText });
    }

    let livesNotice = `❤️ *Hearts remaining:* \`${session.lives}/5\``;
    if (engineResponse.includes("LIFE_LOST")) {
        session.lives--;
        livesNotice = `💥 *LIFE LOST! Hearts remaining:* \`${session.lives}/5\``;
    }

    const cleanDesc = engineResponse.replace("LIFE_LOST", "").replace("GAME_OVER", "").trim();

    const stageCard =
        `🚪 *ESCAPE ROOM: STAGE ${session.step}/10* 🚪\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${cleanDesc}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Status:* ${livesNotice}\n` +
        `👉 *Reply with your choice (1, 2, or 3) to proceed!*`;

    const prompt = await sock.sendMessage(jid, { text: stageCard });
    session.lastQuestionMsgId = prompt.key.id;
}

// ─── ANAGRAM TURN HELPERS ────────────────────────────────────────

async function askNextAnagram(sock, jid, sessionKey) {
    const session = global.anagramSessions[sessionKey];
    const isSingle = session.type === 'single';

    if (session.timerId) clearTimeout(session.timerId);

    if (!isSingle) {
        session.players = session.players.filter(pJid => session.lives[pJid] > 0);

        if (session.players.length === 1) {
            const winner = session.players[0];
            const msgText = `🏆 *ANAGRAM CHAMPION DECLARED!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🎉 @${winner.split('@')[0]} has won the match as the last survivor!\n🎯 Score: \`${session.scores[winner]}\` points.`;
            delete global.anagramSessions[sessionKey];
            return await sock.sendMessage(jid, { text: msgText, mentions: [winner] });
        }

        if (session.players.length === 0) {
            delete global.anagramSessions[sessionKey];
            return await sock.sendMessage(jid, { text: "💀 *GAME OVER:* All players eliminated!" });
        }

        const limit = session.originalPlayerCount * 5;
        if (session.currentQuestionIndex > limit) {
            const sorted = [...session.players].sort((a, b) => session.scores[b] - session.scores[a]);
            const topScore = session.scores[sorted[0]];
            const tiedPlayers = session.players.filter(pJid => session.scores[pJid] === topScore);

            if (tiedPlayers.length > 1) {
                session.isTieBreaker = true;
                session.players = tiedPlayers;
                session.turnIndex = 0;
            } else {
                const winner = sorted[0];
                const msgText = `🏆 *ANAGRAM MATCH FINISHED!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🎉 Winner: @${winner.split('@')[0]} — \`${session.scores[winner]}\` points`;
                delete global.anagramSessions[sessionKey];
                return await sock.sendMessage(jid, { text: msgText, mentions: [winner] });
            }
        }
    } else {
        if (session.currentQuestionIndex > 10) {
            const results = `📊 *ANAGRAM GAME OVER!* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *Player:* @${session.player.split('@')[0]}\n🎯 *Score:* \`${session.score}/10\``;
            delete global.anagramSessions[sessionKey];
            return await sock.sendMessage(jid, { text: results, mentions: [session.player] });
        }
    }

    let activePlayer = session.player;
    if (!isSingle) {
        if (session.turnIndex >= session.players.length) session.turnIndex = 0;
        activePlayer = session.players[session.turnIndex];
    }

    const wordData = await generateAnagramWord(session.difficulty, session.pastWords);
    if (!wordData) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve word data. Game aborted." });

    const correctWord = wordData.word.toUpperCase().trim();
    const scrambled = scrambleWord(correctWord);

    session.pastWords.push(correctWord);
    session.currentWord = correctWord;
    session.scrambledWord = scrambled;

    const roundHeader = isSingle
        ? `🔠 *Anagram: Round ${session.currentQuestionIndex}/10 (Hearts: ${session.livesSP}❤️)*`
        : `👥 *Anagram Round ${session.currentQuestionIndex}*`;

    const livesStr = isSingle ? "" : `\n❤️ *Target Hearts Left:* \`${session.lives[activePlayer]}❤️\``;

    const anagramCard =
        `${roundHeader}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 *Active Turn:* @${activePlayer.split('@')[0]}${livesStr}\n` +
        `⏳ *Timer:* \`${session.timerMs / 1000} seconds\`\n\n` +
        `🧩 *Rearrange this scrambled word:* \n` +
        `👉    *${scrambled}*    \n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Reply directly to this message with your guess!*`;

    const prompt = await sock.sendMessage(jid, { text: anagramCard, mentions: isSingle ? [session.player] : [activePlayer] });
    session.lastQuestionMsgId = prompt.key.id;

    session.timerId = setTimeout(async () => {
        await handleAnagramTimeout(sock, jid, sessionKey);
    }, session.timerMs);
}

async function handleAnagramTimeout(sock, jid, sessionKey) {
    const session = global.anagramSessions[sessionKey];
    if (!session) return;

    const isSingle = session.type === 'single';
    let activePlayer = session.player;
    if (!isSingle) activePlayer = session.players[session.turnIndex];

    let resultMsg = "";
    if (isSingle) {
        session.livesSP--;
        resultMsg = `⏰ *TIME IS UP!* \n\nThe correct word was *${session.currentWord}*.\n\n❤️ *Lives remaining:* \`${session.livesSP}/3\``;
        if (session.livesSP <= 0) {
            await sock.sendMessage(jid, { text: resultMsg });
            const results = `📊 *ANAGRAM GAME OVER!* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *Player:* @${session.player.split('@')[0]}\n🎯 *Score:* \`${session.score}/10\``;
            delete global.anagramSessions[sessionKey];
            return await sock.sendMessage(jid, { text: results, mentions: [session.player] });
        }
    } else {
        session.lives[activePlayer]--;
        const activeNumber = activePlayer.split('@')[0];
        resultMsg = `⏰ *TIME IS UP!* \n\n@${activeNumber} failed to answer. Correct word was *${session.currentWord}*.`;
        if (session.lives[activePlayer] <= 0) resultMsg += `\n\n💀 @${activeNumber} has been *ELIMINATED*!`;
    }

    await sock.sendMessage(jid, { text: resultMsg, mentions: isSingle ? [] : [activePlayer] });

    session.currentQuestionIndex++;
    if (!isSingle) session.turnIndex = (session.turnIndex + 1) % session.players.length;

    await delay(2000);
    await askNextAnagram(sock, jid, sessionKey);
}

// ─── WORD CHAIN TURN HELPERS ─────────────────────────────────────

async function promptNextWcgTurn(sock, jid) {
    const session = global.wcgSessions[jid];
    if (session.timerId) clearTimeout(session.timerId);

    if (session.players.length === 1) {
        const winner = session.players[0];
        const winCard = `🏆 *WORD CHAIN CHAMPION!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🎉 @${winner.split('@')[0]} has won the match as the ultimate survivor!`;
        delete global.wcgSessions[jid];
        return await sock.sendMessage(jid, { text: winCard, mentions: [winner] });
    }

    if (session.players.length === 0) {
        delete global.wcgSessions[jid];
        return await sock.sendMessage(jid, { text: "💀 *GAME OVER:* Everyone eliminated!" });
    }

    if (session.turnIndex >= session.players.length) session.turnIndex = 0;
    const activePlayer = session.players[session.turnIndex];

    let minLen = 4;
    let maxLen = 5;
    let timeLimit = 20000;
    let modeLabel = "EASY";

    if (session.difficulty === 'dynamic') {
        const round = session.round || 1;
        if (round <= 3) {
            minLen = 4; maxLen = 5; timeLimit = 20000; modeLabel = "EASY (4-5 letters, 20s limit)";
        } else if (round <= 6) {
            minLen = 6; maxLen = 7; timeLimit = 15000; modeLabel = "MEDIUM (6-7 letters, 15s limit)";
        } else {
            minLen = 8; maxLen = 10; timeLimit = 15000; modeLabel = "HARD (8-10 letters, 15s limit)";
        }
    } else {
        if (session.difficulty === 'easy') {
            minLen = 4; maxLen = 5; timeLimit = 20000; modeLabel = "EASY (4-5 letter word)";
        } else if (session.difficulty === 'medium') {
            minLen = 6; maxLen = 7; timeLimit = 15000; modeLabel = "MEDIUM (6-7 letter word)";
        } else if (session.difficulty === 'hard') {
            minLen = 8; maxLen = 10; timeLimit = 15000; modeLabel = "HARD (8-10 letter word)";
        }
    }

    session.minLen = minLen;
    session.maxLen = maxLen;
    session.activeLimitMs = timeLimit;

    let instructions = "";
    if (!session.lastWord) {
        instructions = `👉 Start the chain! Type any valid dictionary English word of *${minLen}-${maxLen} letters* to begin.`;
    } else {
        const targetLetter = session.lastWord.slice(-1).toUpperCase();
        instructions = `👉 Last word was *"${session.lastWord.toUpperCase()}"*. You must reply with an unused *${minLen}-${maxLen} letter word* starting with *"${targetLetter}"*!`;
    }

    const listTurns = session.players.map((p, idx) => `${idx === session.turnIndex ? '👉 ' : '• '}@${p.split('@')[0]}`).join('\n');

    const chainCard =
        `⛓️ *Word Chain: Round ${session.round || 1}* ⛓️\n` +
        `📂 *Tier Mode:* \`${modeLabel}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 *Active turn:* @${activePlayer.split('@')[0]}\n` +
        `⏳ *Timer:* \`${timeLimit / 1000} seconds\`\n\n` +
        `${instructions}\n\n` +
        `📊 *Lineup:*\n${listTurns}\n\n` +
        `👉 *Reply to this message with your word guess!*`;

    const prompt = await sock.sendMessage(jid, { text: chainCard, mentions: session.players });
    session.lastQuestionMsgId = prompt.key.id;

    session.timerId = setTimeout(async () => {
        await handleWcgTimeout(sock, jid);
    }, timeLimit);
}

async function handleWcgTimeout(sock, jid) {
    const session = global.wcgSessions[jid];
    if (!session) return;

    const eliminatedPlayer = session.players[session.turnIndex];
    session.players.splice(session.turnIndex, 1);

    await sock.sendMessage(jid, {
        text: `⏰ *TIME IS UP!* \n\n💀 @${eliminatedPlayer.split('@')[0]} failed to submit a word and has been *ELIMINATED*!`,
        mentions: [eliminatedPlayer]
    });

    session.round = (session.round || 1) + 1;
    await delay(2000);
    await promptNextWcgTurn(sock, jid);
}

// ─── STANDARDIZED JID PARSER ────────────────────────────────────

function parseTarget(msg, args) {
    if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            return `${cleanDigits}@s.whatsapp.net`;
        }
    }

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
        return mentions[0].split(':')[0] + (mentions[0].includes('@lid') ? '@lid' : '@s.whatsapp.net');
    } else if (contextInfo?.participant) {
        const part = contextInfo.participant;
        return part.split(':')[0] + (part.includes('@lid') ? '@lid' : '@s.whatsapp.net');
    }
    return '';
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. ANAGRAM
    {
        name: 'anagram',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let difficulty = "easy";
            if (args) {
                const opt = args.toLowerCase().trim();
                if (['easy', 'medium', 'hard'].includes(opt)) difficulty = opt;
            }

            const buttons = {
                text: `🔠 *ANAGRAMS* 🔠\n\n*Difficulty Mode:* \`${difficulty.toUpperCase()}\`\n\nSelect your game format to proceed:`,
                buttons: [
                    { buttonId: `${config.prefix}anagram_mode single ${difficulty}`, buttonText: { displayText: 'Singleplayer 👤' }, type: 1 },
                    { buttonId: `${config.prefix}anagram_mode multi ${difficulty}`, buttonText: { displayText: 'Multiplayer 👥' }, type: 1 }
                ],
                headerType: 1
            };
            await sock.sendMessage(jid, buttons, { quoted: msg });
        }
    },

    // 2. ANAGRAM MODE
    {
        name: 'anagram_mode',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderNumber = senderJid.split('@')[0];

            const parts = args ? args.toLowerCase().trim().split(' ') : [];
            const mode = parts[0] || 'single';
            const difficulty = parts[1] || 'easy';

            let timerMs = 30000;
            if (difficulty === 'medium') timerMs = 20000;
            if (difficulty === 'hard') timerMs = 15000;

            const sessionKey = mode === 'single' ? (jid + '_' + senderJid) : jid;

            if (global.anagramSessions[sessionKey]) return await sock.sendMessage(jid, { text: "⚠️ Active Anagram session already running." }, { quoted: msg });

            if (mode === 'single') {
                global.anagramSessions[sessionKey] = {
                    type: 'single',
                    difficulty: difficulty,
                    timerMs: timerMs,
                    player: senderJid,
                    score: 0,
                    livesSP: 3,
                    currentQuestionIndex: 1,
                    pastWords: [],
                    lastQuestionMsgId: '',
                    timerId: null
                };

                await sock.sendMessage(jid, { text: `🚀 *Anagram initialized!* Starting round 1/10...` }, { quoted: msg });
                await askNextAnagram(sock, jid, sessionKey);
            } else {
                if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Multiplayer modes require Group Chat." }, { quoted: msg });

                global.anagramSessions[sessionKey] = {
                    type: 'multi',
                    status: 'lobby',
                    difficulty: difficulty,
                    timerMs: timerMs,
                    players: [senderJid],
                    scores: { [senderJid]: 0 },
                    lives: { [senderJid]: 3 },
                    currentQuestionIndex: 1,
                    turnIndex: 0,
                    pastWords: [],
                    lastQuestionMsgId: '',
                    timerId: null,
                    isTieBreaker: false
                };

                const lobbyButtons = {
                    text: `👥 *ANAGRAM MULTIPLAYER LOBBY* 👥\n\n*Difficulty:* \`${difficulty.toUpperCase()}\`\n\n• Players Joined: \`1/4\`\n👤 @${senderNumber}\n\n👉 Tap Join below!`,
                    buttons: [{ buttonId: `${config.prefix}anagram_join`, buttonText: { displayText: 'Join Match 🎮' }, type: 1 }],
                    headerType: 1,
                    mentions: [senderJid]
                };

                const lobbyMsg = await sock.sendMessage(jid, lobbyButtons, { quoted: msg });
                global.anagramSessions[sessionKey].lobbyMsgId = lobbyMsg.key.id;

                setTimeout(async () => {
                    const session = global.anagramSessions[sessionKey];
                    if (!session || session.status !== 'lobby') return;

                    if (session.players.length < 2) {
                        delete global.anagramSessions[sessionKey];
                        return await sock.sendMessage(jid, { text: "🛑 *Lobby Disbanded: Minimum 2 players required.*" });
                    }

                    session.status = 'playing';
                    session.originalPlayerCount = session.players.length;
                    await sock.sendMessage(jid, { text: `🔔 *LOBBY CLOSED!* Starting match with ${session.players.length} players...`, mentions: session.players });
                    await askNextAnagram(sock, jid, sessionKey);
                }, 30000);
            }
        }
    },

    // 3. ANAGRAM JOIN
    {
        name: 'anagram_join',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderNumber = senderJid.split('@')[0];

            const session = global.anagramSessions[jid];
            if (!session || session.status !== 'lobby') return;
            if (session.players.includes(senderJid)) return;

            if (session.players.length >= 4) return await sock.sendMessage(jid, { text: `❌ Sorry @${senderNumber}, the lobby is full!`, mentions: [senderJid] }, { quoted: msg });

            session.players.push(senderJid);
            session.scores[senderJid] = 0;
            session.lives[senderJid] = 3;

            const joinedCount = session.players.length;
            const listPlayers = session.players.map(p => `👤 @${p.split('@')[0]}`).join('\n');

            const lobbyButtons = {
                text: `👥 *ANAGRAM MULTIPLAYER LOBBY* 👥\n\n• Players: \`${joinedCount}/4\`\n${listPlayers}\n\n👉 Tap Join below!`,
                buttons: [{ buttonId: `${config.prefix}anagram_join`, buttonText: { displayText: 'Join Match 🎮' }, type: 1 }],
                headerType: 1,
                mentions: session.players
            };

            try { await sock.sendMessage(jid, { delete: { remoteJid: jid, id: session.lobbyMsgId, fromMe: true } }); } catch (e) { /* ignore */ }

            const updatedLobby = await sock.sendMessage(jid, lobbyButtons);
            session.lobbyMsgId = updatedLobby.key.id;

            if (joinedCount === 4) {
                session.status = 'playing';
                session.originalPlayerCount = 4;
                await sock.sendMessage(jid, { text: `🔥 *LOBBY FULL (4/4)!* Starting match instantly...`, mentions: session.players });
                await askNextAnagram(sock, jid, jid);
            }
        }
    },

    // 4. ANAGRAM ANS
    {
        name: 'anagram_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderNumber = senderJid.split('@')[0];

            const sessionKey = jid.endsWith('@g.us') ? jid : jid + '_' + senderJid;
            const session = global.anagramSessions[sessionKey];
            if (!session) return;

            // ─── REPLY GUARD ───
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;
            if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) {
                return; // Not a reply to the game prompt
            }

            const isSingle = session.type === 'single';
            if (!isSingle) {
                const activeTurnPlayer = session.players[session.turnIndex];
                if (activeTurnPlayer !== senderJid) return await sock.sendMessage(jid, { text: `⚠️ Wait your turn! Only @${activeTurnPlayer.split('@')[0]} is authorized to guess right now.`, mentions: [activeTurnPlayer] }, { quoted: msg });
            }

            if (session.timerId) clearTimeout(session.timerId);

            const guess = args.toUpperCase().trim();
            const correctWord = session.currentWord;

            let resultLabel = "";
            if (guess === correctWord) {
                if (isSingle) session.score++; else session.scores[senderJid]++;
                resultLabel = `✅ *CORRECT GUESS BY @${senderNumber}!* +1 point. 🎉`;
            } else {
                if (isSingle) {
                    session.livesSP--;
                    resultLabel = `❌ *INCORRECT GUESS BY @${senderNumber}!* Correct word was *${correctWord}*.\n\n👤 *Player:* @${session.player.split('@')[0]}\n🎯 *Remaining Hearts:* \`${session.livesSP}/3\``;
                    if (session.livesSP <= 0) {
                        await sock.sendMessage(jid, { text: resultLabel, mentions: [senderJid] }, { quoted: msg });
                        const results = `📊 *ANAGRAM GAME OVER!* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *Player:* @${session.player.split('@')[0]}\n🎯 *Final Score:* \`${session.score}/10\``;
                        delete global.anagramSessions[sessionKey];
                        return await sock.sendMessage(jid, { text: results, mentions: [session.player] });
                    }
                } else {
                    session.lives[senderJid]--;
                    resultLabel = `❌ *INCORRECT GUESS BY @${senderNumber}!* Correct word was *${correctWord}*.\n\n❤️ *Remaining Hearts:* \`${session.lives[senderJid]}/3\``;
                    if (session.lives[senderJid] <= 0) resultLabel += `\n\n💀 @${senderNumber} has been *ELIMINATED*!`;
                }
            }

            await sock.sendMessage(jid, { text: resultLabel, mentions: [senderJid] }, { quoted: msg });

            session.currentQuestionIndex++;
            if (!isSingle) session.turnIndex = (session.turnIndex + 1) % session.players.length;

            await delay(1500);
            await askNextAnagram(sock, jid, sessionKey);
        }
    },

    // 5. WORD CHAIN GAME
    {
        name: 'wcg',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderNumber = senderJid.split('@')[0];

            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Word Chain is a multiplayer group-only module." }, { quoted: msg });
            if (global.wcgSessions[jid]) return await sock.sendMessage(jid, { text: "⚠️ Active Word Chain lobby already running." }, { quoted: msg });

            let difficulty = "dynamic";
            if (args) {
                const opt = args.toLowerCase().trim();
                if (['easy', 'medium', 'hard'].includes(opt)) difficulty = opt;
            }

            global.wcgSessions[jid] = {
                status: 'lobby',
                difficulty: difficulty,
                players: [senderJid],
                turnIndex: 0,
                round: 1,
                lastWord: '',
                usedWords: [],
                lastQuestionMsgId: '',
                timerId: null
            };

            const lobbyButtons = {
                text: `⛓️ *WORD CHAIN GAME LOBBY* ⛓️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `*Configuration:* \`${difficulty.toUpperCase()}\`\n` +
                      `• Joined: \`1/10\`\n👤 @${senderNumber}\n\n👉 Tap Join to enter the chain!`,
                buttons: [{ buttonId: `${config.prefix}wcg_join`, buttonText: { displayText: 'Join Chain ⛓️' }, type: 1 }],
                headerType: 1,
                mentions: [senderJid]
            };

            const lobbyMsg = await sock.sendMessage(jid, lobbyButtons, { quoted: msg });
            global.wcgSessions[jid].lobbyMsgId = lobbyMsg.key.id;

            setTimeout(async () => {
                const session = global.wcgSessions[jid];
                if (!session || session.status !== 'lobby') return;

                if (session.players.length < 2) {
                    delete global.wcgSessions[jid];
                    return await sock.sendMessage(jid, { text: "🛑 *Lobby Disbanded: Minimum 2 players required.*" });
                }

                session.status = 'playing';
                await sock.sendMessage(jid, { text: `🔔 *LOBBY CLOSED!* Starting match with ${session.players.length} players...`, mentions: session.players });
                await promptNextWcgTurn(sock, jid);
            }, 30000);
        }
    },

    // 6. WCG JOIN
    {
        name: 'wcg_join',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

            const session = global.wcgSessions[jid];
            if (!session || session.status !== 'lobby') return;
            if (session.players.includes(senderJid)) return;

            if (session.players.length >= 10) return await sock.sendMessage(jid, { text: `❌ Lobby full!`, mentions: [senderJid] }, { quoted: msg });

            session.players.push(senderJid);
            const joinedCount = session.players.length;
            const listPlayers = session.players.map(p => `👤 @${p.split('@')[0]}`).join('\n');

            const lobbyButtons = {
                text: `⛓️ *WORD CHAIN GAME LOBBY* ⛓️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n• Joined: \`${joinedCount}/10\`\n${listPlayers}\n\n👉 Tap Join to enter!`,
                buttons: [{ buttonId: `${config.prefix}wcg_join`, buttonText: { displayText: 'Join Chain ⛓️' }, type: 1 }],
                headerType: 1,
                mentions: session.players
            };

            try { await sock.sendMessage(jid, { delete: { remoteJid: jid, id: session.lobbyMsgId, fromMe: true } }); } catch (e) { /* ignore */ }

            const updatedLobby = await sock.sendMessage(jid, lobbyButtons);
            session.lobbyMsgId = updatedLobby.key.id;
        }
    },

    // 7. WCG ANS
    {
        name: 'wcg_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

            const session = global.wcgSessions[jid];
            if (!session || session.status !== 'playing') return;

            // ─── REPLY GUARD ───
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;
            if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) {
                return; // Not a reply to the game prompt
            }

            const activePlayer = session.players[session.turnIndex];
            if (activePlayer !== senderJid) return await sock.sendMessage(jid, { text: `⚠️ Wait your turn! Only @${activePlayer.split('@')[0]} is authorized to submit a word chain now.`, mentions: [activePlayer] }, { quoted: msg });

            if (session.timerId) clearTimeout(session.timerId);

            const word = args.trim().toUpperCase();

            if (!word) {
                session.players.splice(session.turnIndex, 1);
                await sock.sendMessage(jid, { text: `💀 @${senderJid.split('@')[0]} failed to submit a word and has been *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                session.round++;
                await delay(1500);
                return await promptNextWcgTurn(sock, jid);
            }

            if (session.lastWord) {
                const targetLetter = session.lastWord.slice(-1).toUpperCase();
                if (word.charAt(0) !== targetLetter) {
                    session.players.splice(session.turnIndex, 1);
                    await sock.sendMessage(jid, { text: `💀 @${senderJid.split('@')[0]} submitted a word starting with the wrong letter! (Must start with *"${targetLetter}"*). \n\n🔴 *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                    session.round++;
                    await delay(1500);
                    return await promptNextWcgTurn(sock, jid);
                }
            }

            if (session.usedWords.includes(word)) {
                session.players.splice(session.turnIndex, 1);
                await sock.sendMessage(jid, { text: `💀 @${senderJid.split('@')[0]} submitted a word that has already been used! \n\n🔴 *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                session.round++;
                await delay(1500);
                return await promptNextWcgTurn(sock, jid);
            }

            await sock.sendMessage(jid, { text: "🔍 `Validating word structure...`" }, { quoted: msg });
            const isValid = await isValidEnglishWord(word, session.minLen, session.maxLen);

            if (!isValid) {
                session.players.splice(session.turnIndex, 1);
                await sock.sendMessage(jid, { text: `💀 *"${word}"* is not a valid dictionary word matching length bounds of *${session.minLen}-${session.maxLen} letters*! \n\n🔴 *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                session.round++;
                await delay(1500);
                return await promptNextWcgTurn(sock, jid);
            }

            session.lastWord = word;
            session.usedWords.push(word);

            await sock.sendMessage(jid, { text: `✅ *Word Accepted:* "${word}"` }, { quoted: msg });

            session.turnIndex = (session.turnIndex + 1) % session.players.length;
            session.round++;

            await delay(1500);
            await promptNextWcgTurn(sock, jid);
        }
    },

    // 8. TRUE OR FALSE
    {
        name: 'torf',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid + '_torf';

            if (global.torfSessions[sessionKey]) {
                return await sock.sendMessage(jid, { text: "⚠️ You already have an active True or False session running." }, { quoted: msg });
            }

            const category = args ? args.trim() : 'General Knowledge';
            const puzzle = await generateTorfQuestion(category);
            if (!puzzle) return await sock.sendMessage(jid, { text: "❌ Failed to generate True/False question." }, { quoted: msg });

            const card = `📜 *TRUE OR FALSE* 📜\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                         `📂 *Category:* \`${category}\`\n` +
                         `💡 *Statement:* ${puzzle.q}\n\n` +
                         `👉 *Reply with "true" or "false" directly to this message to submit your answer!*`;

            const prompt = await sock.sendMessage(jid, { text: card }, { quoted: msg });

            global.torfSessions[sessionKey] = {
                correctAnswer: puzzle.ans.toLowerCase(),
                explanation: puzzle.explanation,
                lastQuestionMsgId: prompt.key.id
            };
        }
    },

    // 9. TORF ANS
    {
        name: 'torf_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid + '_torf';
            const session = global.torfSessions[sessionKey];
            if (!session) return;

            // ─── REPLY GUARD ───
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;
            if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) {
                return; // Not a reply to the game prompt
            }

            const userAns = args.trim().toLowerCase();
            const correct = session.correctAnswer;

            let result = "";
            if (userAns === correct) {
                result = `✅ *CORRECT!* \n\nℹ️ *Context:* ${session.explanation}`;
            } else {
                result = `❌ *INCORRECT!* \n\nℹ️ *Context:* ${session.explanation}`;
            }

            delete global.torfSessions[sessionKey];
            await sock.sendMessage(jid, { text: result }, { quoted: msg });
        }
    },

    // 10. MILLIONAIRE
    {
        name: 'millionaire',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid;

            if (global.millionaireSessions[sessionKey]) {
                return await sock.sendMessage(jid, { text: "⚠️ You already have an active Millionaire session running." }, { quoted: msg });
            }

            global.millionaireSessions[sessionKey] = {
                status: 'playing',
                player: senderJid,
                step: 1,
                money: 0,
                category: 'General Anime',
                eliminatedOptions: [],
                lifelines: { phone: true, fifty: true, audience: true },
                timerMs: 20000,
                timerId: null
            };

            await sock.sendMessage(jid, { text: "👑 *Starting Who Wants to Be a Millionaire!* Preparing Question 1..." }, { quoted: msg });
            await askNextMillionaireQuestion(sock, jid, sessionKey);
        }
    },

    // 11. MILLIONAIRE ANS
    {
        name: 'millionaire_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid;
            const session = global.millionaireSessions[sessionKey];
            if (!session) return;

            // ─── REPLY GUARD ───
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;
            if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) {
                return; // Not a reply to the game prompt
            }

            if (session.timerId) clearTimeout(session.timerId);

            const ans = args.trim().toLowerCase();

            const prompt =
                `You are the charismatic, suspenseful host of the "Who Wants to Be a Millionaire" trivia game.
            Question: "${session.currentQuestion}"
            Options:
            ${session.currentOptions.join('\n')}
            User Chose Option: "${ans.toUpperCase()}"

            Determine if their choice is correct. Respond strictly with a JSON object in this exact format (no other text or markdown):
            {
              "isCorrect": true, // or false
              "correctOption": "C", // the correct letter option (A, B, C, or D)
              "explanation": "A suspenseful, brief (1-2 sentences) game-show host response explaining the context of the answer."
            }
            `;

            const verification = await queryLLM(prompt, 0.2);
            let resultData = { isCorrect: false, correctOption: '', explanation: '' };
            try {
                const cleanJson = verification.replace(/```json/g, '').replace(/```/g, '').trim();
                resultData = JSON.parse(cleanJson);
            } catch (e) {
                const isYes = verification ? verification.trim().toUpperCase().includes("YES") : false;
                resultData = {
                    isCorrect: isYes,
                    correctOption: '?',
                    explanation: 'The system has logged your answer.'
                };
            }

            if (resultData.isCorrect) {
                const values = [0, 5000, 10000, 20000, 50000, 100000, 150000, 250000, 350000, 500000, 750000, 1000000, 1250000, 1500000, 2000000, 5000000];
                session.money = values[session.step];
                const feedbackText =
                    `✅ *CORRECT!* \n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🎙️ *Host:* _"${resultData.explanation}"_\n\n` +
                    `💰 *You have won:* \`₦${session.money.toLocaleString()} WAT\`! 🎉`;

                await sock.sendMessage(jid, { text: feedbackText }, { quoted: msg });
                session.step++;
                session.eliminatedOptions = [];
                await delay(3000);
                await askNextMillionaireQuestion(sock, jid, sessionKey);
            } else {
                delete global.millionaireSessions[sessionKey];
                const feedbackText =
                    `❌ *INCORRECT!* \n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🎙️ *Host:* _"${resultData.explanation}"_\n\n` +
                    `💀 *GAME OVER:* You leave with \`₦${session.money.toLocaleString()} WAT\`.`;

                await sock.sendMessage(jid, { text: feedbackText }, { quoted: msg });
            }
        }
    },

    // 12. MILLIONAIRE LIFE
    {
        name: 'millionaire_life',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid;
            const session = global.millionaireSessions[sessionKey];
            if (!session) return;

            const choice = args ? args.toLowerCase().trim() : '';

            if (choice === 'fifty') {
                if (!session.lifelines.fifty) return;
                session.lifelines.fifty = false;

                const wrongOptions = ['a', 'b', 'c', 'd'].filter(opt => {
                    const line = session.currentOptions.find(o => o.toLowerCase().startsWith(opt));
                    return line && !line.includes("correct");
                });

                const shuffled = wrongOptions.sort(() => 0.5 - Math.random());
                session.eliminatedOptions.push(shuffled[0], shuffled[1]);

                await sock.sendMessage(jid, { text: "👑 *Lifeline Activated: 50/50* \n\nTwo incorrect options have been eliminated." }, { quoted: msg });
                await sendMillionaireDisplay(sock, jid, sessionKey);
            } else if (choice === 'phone') {
                if (!session.lifelines.phone) return;
                session.lifelines.phone = false;
                session.status = 'calling';

                const prompt = await sock.sendMessage(jid, { text: "📞 *Lifeline Activated: Phone a Friend* \n\nPlease reply directly to this message with your friend's phone number." }, { quoted: msg });
                session.lastQuestionMsgId = prompt.key.id;
            } else if (choice === 'audience') {
                if (!session.lifelines.audience) return;
                session.lifelines.audience = false;

                const audiencePrompt = `Question: "${session.currentQuestion}"\nOptions:\n${session.currentOptions.join('\n')}\nProvide a realistic audience vote percentage split for options A, B, C, D totaling 100%. Highlight the correct option slightly higher. format as list.`;
                const response = await queryLLM(audiencePrompt, 0.7);

                await sock.sendMessage(jid, { text: `📊 *Lifeline Activated: Ask the Audience* \n\n${response}` }, { quoted: msg });
                await sendMillionaireDisplay(sock, jid, sessionKey);
            } else if (choice === 'walk') {
                delete global.millionaireSessions[sessionKey];
                await sock.sendMessage(jid, { text: `💰 *Walked Away Safely!* \n\nYou voluntarily left the game and secured a grand prize of *₦${session.money.toLocaleString()} WAT*!` }, { quoted: msg });
            }
        }
    },

    // 13. MILLIONAIRE CALL
    {
        name: 'millionaire_call',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid;
            const session = global.millionaireSessions[sessionKey];
            if (!session || session.status !== 'calling') return;

            const targetNum = args.replace(/[^0-9]/g, '');
            if (targetNum.length < 5) return;

            const friendJid = `${targetNum}@s.whatsapp.net`;
            session.status = 'waiting_friend_decision';
            session.friendJid = friendJid;

            const inviteCard =
                `📞 *WHO WANTS TO BE A MILLIONAIRE: HELP DESK* 📞\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 @${senderJid.split('@')[0]} has called you for assistance on this question:\n\n` +
                `💡 "${session.currentQuestion}"\n\n` +
                `${session.currentOptions.join('\n')}\n\n` +
                `👉 *Reply to this message with 'yes' or 'no' if you are ready to help!*`;

            const prompt = await sock.sendMessage(jid, { text: inviteCard, mentions: [friendJid, senderJid] }, { quoted: msg });
            session.lastQuestionMsgId = prompt.key.id;
        }
    },

    // 14. MILLIONAIRE DECISION
    {
        name: 'millionaire_decision',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid;
            const session = global.millionaireSessions[sessionKey];
            if (!session || session.status !== 'waiting_friend_decision') return;

            const decision = args.toLowerCase().trim();

            if (decision === 'yes') {
                const helperPrompt =
                    `Question: "${session.currentQuestion}"\nOptions:\n${session.currentOptions.join('\n')}\nGive a helpful, confident answer advice suggestion. Keep it very brief (1-2 sentences).`;
                const advice = await queryLLM(helperPrompt, 0.7);

                await sock.sendMessage(jid, {
                    text: `📞 *Advice Received from @${session.friendJid.split('@')[0]}:* \n\n_"${advice}"_`,
                    mentions: [session.friendJid]
                }, { quoted: msg });
                session.status = 'playing';
                await sendMillionaireDisplay(sock, jid, sessionKey);
            } else if (decision === 'no') {
                await sock.sendMessage(jid, {
                    text: `📞 @${session.friendJid.split('@')[0]} declined to help. Retrying standard layout...`,
                    mentions: [session.friendJid]
                }, { quoted: msg });
                session.status = 'playing';
                await sendMillionaireDisplay(sock, jid, sessionKey);
            }
        }
    },

    // 15. ESCAPE ROOM
    {
        name: 'escape',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid;

            if (global.escapeSessions[sessionKey]) {
                return await sock.sendMessage(jid, { text: "⚠️ You already have an active Escape Room session running." }, { quoted: msg });
            }

            global.escapeSessions[sessionKey] = {
                player: senderJid,
                step: 1,
                lives: 5,
                lastQuestionMsgId: ''
            };

            await sock.sendMessage(jid, { text: "🚪 *Channelling Escape Room Domain... Loading Stage 1.*" }, { quoted: msg });
            await promptNextEscapeStep(sock, jid, sessionKey);
        }
    },

    // 16. ESCAPE ANS
    {
        name: 'escape_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid;
            const session = global.escapeSessions[sessionKey];
            if (!session) return;

            // ─── REPLY GUARD ───
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;
            if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) {
                return; // Not a reply to the game prompt
            }

            session.step++;
            await delay(1000);
            await promptNextEscapeStep(sock, jid, sessionKey);
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'anagram') aliases.push({ ...cmd, name: 'anagrams' });
    if (cmd.name === 'wcg') {
        aliases.push({ ...cmd, name: 'wrg' });
        aliases.push({ ...cmd, name: 'wordchain' });
    }
});
module.exports.push(...aliases);