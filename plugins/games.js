// plugins/games.js
const config = require('../config');
const { saveState, getPhoneJid, normalizeToJid } = require('../stateManager');
const fs = require('fs');
const path = require('path');

// ─── GLOBAL SESSIONS ──────────────────────────────────────────────
global.gameSessions = global.gameSessions || {};
global.vault8Sessions = global.vault8Sessions || {};
global.vault8SavedStories = global.vault8SavedStories || {};
global.triviaSessions = global.triviaSessions || {};
global.charadeSessions = global.charadeSessions || {};

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

// ─── FALLBACK QUIZ QUESTIONS ──────────────────────────────────────

const fallbackQuizQuestions = [
    {
        category: "General Knowledge",
        q: "What is the capital city of France?",
        options: ["A) London", "B) Berlin", "C) Paris", "D) Madrid"]
    },
    {
        category: "Chemistry",
        q: "What is the chemical symbol for the element Oxygen?",
        options: ["A) O", "B) Os", "C) Om", "D) Oc"]
    },
    {
        category: "English",
        q: "What is the antonym of \"generous\"?",
        options: ["A) Kind", "B) Stingy", "C) Brave", "D) Honest"]
    }
];

function getLocalQuestion(category) {
    try {
        const dbPath = path.join(__dirname, '../data/quiz.js');
        let questions = fallbackQuizQuestions;
        if (fs.existsSync(dbPath)) {
            delete require.cache[require.resolve(dbPath)];
            questions = require(dbPath);
        }
        const filtered = questions.filter(q => q.category.toLowerCase() === category.toLowerCase());
        if (filtered.length === 0) return null;
        return filtered[Math.floor(Math.random() * filtered.length)];
    } catch (e) {
        console.error("❌ [PARSER] Failed to resolve quiz question:", e.message);
        return null;
    }
}

// ─── TIC-TAC-TOE HELPERS ─────────────────────────────────────────

function renderCoolTttBoard(board) {
    const symbolsMap = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
    const formatted = board.map((val, idx) => val === ' ' ? symbolsMap[idx] : val);
    return `╔═════╦═════╦═════╗\n` +
           `║  ${formatted[0]}  ║  ${formatted[1]}  ║  ${formatted[2]}  ║\n` +
           `╠═════╬═════╬═════╣\n` +
           `║  ${formatted[3]}  ║  ${formatted[4]}  ║  ${formatted[5]}  ║\n` +
           `╠═════╬═════╬═════╣\n` +
           `║  ${formatted[6]}  ║  ${formatted[7]}  ║  ${formatted[8]}  ║\n` +
           `╚═════╩═════╩═════╝`;
}

function checkTttWinner(board) {
    const wins = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    for (const win of wins) {
        if (board[win[0]] !== ' ' && board[win[0]] === board[win[1]] && board[win[0]] === board[win[2]]) {
            return board[win[0]];
        }
    }
    if (!board.includes(' ')) return 'tie';
    return null;
}

function getGojoTttMove(board, gojoSymbol, opponentSymbol) {
    const wins = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    for (const win of wins) {
        const countGojo = win.filter(idx => board[idx] === gojoSymbol).length;
        const countEmpty = win.filter(idx => board[idx] === ' ').length;
        if (countGojo === 2 && countEmpty === 1) return win.find(idx => board[idx] === ' ');
    }
    for (const win of wins) {
        const countOpponent = win.filter(idx => board[idx] === opponentSymbol).length;
        const countEmpty = win.filter(idx => board[idx] === ' ').length;
        if (countOpponent === 2 && countEmpty === 1) return win.find(idx => board[idx] === ' ');
    }
    if (board[4] === ' ') return 4;
    const available = board.map((val, idx) => val === ' ' ? idx : null).filter(val => val !== null);
    return available[Math.floor(Math.random() * available.length)];
}

// ─── VAULT 8 ENGINE ──────────────────────────────────────────────

async function queryVaultEngine(messages) {
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
            messages: messages,
            temperature: 0.85
        })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

// ─── EMOJI CHARADE GENERATION ────────────────────────────────────

async function generateEmojiPuzzle(excludeList = []) {
    const salt = Math.random() + '_' + Date.now();
    const prompt =
        `Generate an easy-to-medium emoji charades puzzle representing a globally famous movie, cartoon, brand, food, or object.\n` +
        `Respond strictly with a JSON object in this exact layout. No other text or markdown:\n` +
        `{"emojis": "🦁👑", "ans": "The Lion King"}\n` +
        `To ensure uniqueness, use this random seed: ${salt}.\n` +
        `Do not repeat these past ones: ${excludeList.join(', ')}`;
    const response = await queryLLM(prompt, 0.85);
    if (!response) return null;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return null;
    }
}

async function checkAnswerCorrectness(correctAnswer, userGuess) {
    const prompt = `System: Compare correct answer "${correctAnswer}" with guess "${userGuess}". Are they semantically equivalent or highly similar? Respond with exactly YES or NO.`;
    const response = await queryLLM(prompt, 0.1);
    return response ? response.trim().toUpperCase().includes("YES") : false;
}

// ─── QUIZ HELPERS ─────────────────────────────────────────────────

async function askNextQuizQuestion(sock, jid, sessionKey) {
    const session = global.triviaSessions[sessionKey];
    const isSingle = session.type === 'single';
    const limit = isSingle ? 10 : (session.players.length * 5);

    if (session.currentQuestionIndex > limit) {
        let results = `📊 *QUIZ COMPLETED!* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        if (isSingle) {
            const p1Phone = await resolveToPhoneJid(sock, session.player);
            results += `👤 *Player:* @${p1Phone.split('@')[0]}\n🎯 *Final Score:* \`${session.score}/10\` points.`;
            delete global.triviaSessions[sessionKey];
            return await sock.sendMessage(jid, { text: results, mentions: [p1Phone] });
        } else {
            results += `🏆 *Leaderboard Standings:* \n\n`;
            const sorted = [...session.players].sort((a, b) => session.scores[b] - session.scores[a]);
            const mentionsList = [];
            for (let idx = 0; idx < sorted.length; idx++) {
                const pJid = sorted[idx];
                const pPhone = await resolveToPhoneJid(sock, pJid);
                if (pPhone) {
                    results += `${idx + 1}. @${pPhone.split('@')[0]} — \`${session.scores[pJid]}/5\` points\n`;
                    mentionsList.push(pPhone);
                }
            }
            delete global.triviaSessions[sessionKey];
            return await sock.sendMessage(jid, { text: results, mentions: mentionsList });
        }
    }

    let activePlayer = session.player;
    if (!isSingle) activePlayer = session.players[session.turnIndex];

    const activePhone = await resolveToPhoneJid(sock, activePlayer);

    const questionData = getLocalQuestion(session.category);
    if (!questionData) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve question from quiz database. Game aborted." });

    session.currentQuestion = questionData.q;
    session.currentOptions = questionData.options;

    const quizLabel = isSingle
        ? `📝 *Topic Quiz: Round ${session.currentQuestionIndex}/10*`
        : `👥 *Quiz Turn: @${activePhone.split('@')[0]} (${session.currentQuestionIndex}/${limit})*`;

    const quizCard =
        `${quizLabel}\n` +
        `📂 *Category:* \`${session.category}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 *Question:* ${questionData.q}\n\n` +
        `${questionData.options.join('\n')}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Reply directly with your answer letter (A, B, C, or D) to proceed.*`;

    const prompt = await sock.sendMessage(jid, { text: quizCard, mentions: [activePhone] });
    session.lastQuestionMsgId = prompt.key.id;
}

// ─── CHARADE HELPERS ──────────────────────────────────────────────

async function askNextCharadePuzzle(sock, jid, sessionKey) {
    const session = global.charadeSessions[sessionKey];

    if (session.currentQuestionIndex > 10) {
        const pPhone = await resolveToPhoneJid(sock, session.player);
        const results = `🏆 *CHARADES CONCLUDED!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `👤 *Player:* @${pPhone.split('@')[0]}\n` +
                        `🎯 *Final Score:* \`${session.score}/10\` points.`;
        delete global.charadeSessions[sessionKey];
        return await sock.sendMessage(jid, { text: results, mentions: [pPhone] });
    }

    const puzzleData = await generateEmojiPuzzle(session.pastPuzzles);
    if (!puzzleData) return await sock.sendMessage(jid, { text: "❌ Failed to generate emoji puzzle. Game aborted." });

    session.pastPuzzles.push(puzzleData.emojis);
    session.currentEmojiCombo = puzzleData.emojis;
    session.currentCorrectAnswer = puzzleData.ans;

    const charadeCard =
        `🎭 *Emoji Charades: Round ${session.currentQuestionIndex}/10* 🎭\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🧩 *Analyze the combination:* \n\n` +
        `👉    ${puzzleData.emojis}    👈\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *What phrase does this represent? Reply to this message with your guess!*`;

    const prompt = await sock.sendMessage(jid, { text: charadeCard });
    session.lastQuestionMsgId = prompt.key.id;
}

// ─── VAULT 8 TURN HANDLER ────────────────────────────────────────

async function handleGameTurn(sock, msg, userChoice, sessionKey) {
    const jid = msg.key.remoteJid;
    const session = global.vault8Sessions[sessionKey];

    await sock.sendMessage(jid, { text: "💾 `Processing decision...`" }, { quoted: msg });
    session.step++;

    const turnPrompt =
        `The user chose: "${userChoice}". Evaluate this choice for Step ${session.step} of 20.\n\n` +
        `If their choice leads to death, write a chilling description, and conclude with the exact text "GAME_OVER" at the very end.\n\n` +
        `If they survive, generate Step ${session.step} of 20. Scenario must be brief (2-3 sentences max). Provide 3 new choices (1, 2, 3).\n\n` +
        `If they reach Step 20 and survive, generate a triumphant ending and conclude with "VICTORY" at the very end.`;

    session.history.push({ role: "user", content: turnPrompt });

    const engineResponse = await queryVaultEngine(session.history);
    if (!engineResponse) {
        session.step--;
        return await sock.sendMessage(jid, { text: "❌ Transmission lost inside Vault 8. Try again." }, { quoted: msg });
    }

    session.history.push({ role: "assistant", content: engineResponse });

    if (engineResponse.includes("GAME_OVER")) {
        delete global.vault8Sessions[sessionKey];
        const cleanDeathMsg = engineResponse.replace("GAME_OVER", "").trim();
        const deathCard =
            `💀 *VAULT 8: DIED AT STEP ${session.step}/20* 💀\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${cleanDeathMsg}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `❌ *TERMINAL SIGNAL LOST:* Do you want to try again?`;

        const failButtons = {
            text: deathCard,
            buttons: [
                { buttonId: `${config.prefix}v8_btn play`, buttonText: { displayText: 'Retry 🔄' }, type: 1 },
                { buttonId: `${config.prefix}v8_btn cancel`, buttonText: { displayText: 'Give Up 🛑' }, type: 1 }
            ],
            headerType: 1
        };
        return await sock.sendMessage(jid, failButtons, { quoted: msg });
    }

    if (engineResponse.includes("VICTORY")) {
        delete global.vault8Sessions[sessionKey];
        delete global.vault8SavedStories[sessionKey];
        const cleanVictoryMsg = engineResponse.replace("VICTORY", "").trim();
        const victoryCard =
            `🏆 *VAULT 8: SIMULATION COMPLETED!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${cleanVictoryMsg}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🎉 *CONGRATULATIONS: You survived the horrors of Vault 8!*`;
        return await sock.sendMessage(jid, { text: victoryCard }, { quoted: msg });
    }

    const gameCard =
        `📁 *VAULT 8: STEP ${session.step}/20* 💻\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${engineResponse}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Reply directly to this message to submit your next choice (1, 2, or 3)!*`;

    const prompt = await sock.sendMessage(jid, { text: gameCard }, { quoted: msg });
    session.lastQuestionMsgId = prompt.key.id;
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. TIC-TAC-TOE
    {
        name: 'ttt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            const sessionKey = jid + '_ttt';
            const activeSession = global.gameSessions[sessionKey];
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderPhone = await resolveToPhoneJid(sock, senderJid);
            const senderNumber = senderPhone.split('@')[0];

            if (args && args.toLowerCase().trim() === 'quit') {
                if (!activeSession) return await sock.sendMessage(jid, { text: "❌ No active Tic-Tac-Toe session is running." }, { quoted: msg });
                delete global.gameSessions[sessionKey];
                return await sock.sendMessage(jid, { text: "🛑 Tic-Tac-Toe session abandoned." }, { quoted: msg });
            }

            const inputVal = parseInt(args);
            if (!isNaN(inputVal)) {
                if (!activeSession) return await sock.sendMessage(jid, { text: `❌ No active session is running.` }, { quoted: msg });
                if (activeSession.turn !== senderJid) return await sock.sendMessage(jid, { text: "⏳ Wait your turn!" }, { quoted: msg });

                const spot = inputVal - 1;
                if (spot < 0 || spot > 8 || activeSession.board[spot] !== ' ') return await sock.sendMessage(jid, { text: "❌ Invalid position." }, { quoted: msg });

                const playerSymbol = activeSession.symbols[senderJid];
                activeSession.board[spot] = playerSymbol;

                let winner = checkTttWinner(activeSession.board);
                if (winner) {
                    const finalBoard = renderCoolTttBoard(activeSession.board);
                    delete global.gameSessions[sessionKey];

                    if (winner === 'tie') {
                        return await sock.sendMessage(jid, { text: `🤝 *IT'S A TIE!* \n\n${finalBoard}` }, { quoted: msg });
                    } else {
                        return await sock.sendMessage(jid, { text: `🏆 *VICTORY!* \n\n🎉 @${senderNumber} won the match!\n\n${finalBoard}`, mentions: [senderPhone] }, { quoted: msg });
                    }
                }

                if (activeSession.player2 === 'gojo') {
                    const gojoSymbol = activeSession.symbols['gojo'];
                    const gojoMove = getGojoTttMove(activeSession.board, gojoSymbol, playerSymbol);
                    activeSession.board[gojoMove] = gojoSymbol;

                    winner = checkTttWinner(activeSession.board);
                    const finalBoard = renderCoolTttBoard(activeSession.board);

                    if (winner) {
                        delete global.gameSessions[sessionKey];
                        if (winner === 'tie') {
                            return await sock.sendMessage(jid, { text: `🤝 *IT'S A TIE!* \n\n${finalBoard}` }, { quoted: msg });
                        } else {
                            return await sock.sendMessage(jid, { text: `💀 *DEFEAT!* \n\n${finalBoard}` }, { quoted: msg });
                        }
                    }

                    const prompt = await sock.sendMessage(jid, { text: `🎮 *TIC-TAC-TOE* 🎮\n\n${finalBoard}\n\n👉 Your turn again! Reply directly with a position number (1-9).` }, { quoted: msg });
                    activeSession.lastQuestionMsgId = prompt.key.id;
                } else {
                    activeSession.turn = activeSession.player1 === senderJid ? activeSession.player2 : activeSession.player1;
                    const nextTurnPhone = await resolveToPhoneJid(sock, activeSession.turn);
                    const nextTurnNumber = nextTurnPhone.split('@')[0];
                    const finalBoard = renderCoolTttBoard(activeSession.board);

                    const prompt = await sock.sendMessage(jid, { text: `🎮 *TIC-TAC-TOE* 🎮\n\n${finalBoard}\n\n👉 It is now @${nextTurnNumber}'s turn! Reply directly with a position number (1-9).`, mentions: [nextTurnPhone] }, { quoted: msg });
                    activeSession.lastQuestionMsgId = prompt.key.id;
                }
                return;
            }

            const buttons = {
                text: `🎮 *TIC-TAC-TOE* 🎮\n\nSelect your game format:`,
                buttons: [
                    { buttonId: `${config.prefix}ttt_mode ai`, buttonText: { displayText: 'Play with AI 🤖' }, type: 1 },
                    { buttonId: `${config.prefix}ttt_mode multi`, buttonText: { displayText: 'Multiplayer ⚔️' }, type: 1 }
                ],
                headerType: 1
            };
            await sock.sendMessage(jid, buttons, { quoted: msg });
        }
    },

    // 2. TTT MODE
    {
        name: 'ttt_mode',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderPhone = await resolveToPhoneJid(sock, senderJid);
            const senderNumber = senderPhone.split('@')[0];
            const mode = args ? args.toLowerCase().trim() : '';

            if (mode === 'ai') {
                const sessionKey = jid + '_ttt';
                const initialBoard = renderCoolTttBoard([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ']);

                const prompt = await sock.sendMessage(jid, { text: `🎮 *TIC-TAC-TOE: GOJO CHALLENGE* 🎮\n\n👤 *Player:* @${senderNumber} (❌)\n🤖 *AI:* Gojo (⭕)\n\n${initialBoard}\n\n👉 It is your turn! Reply directly with a position number (1-9).`, mentions: [senderPhone] }, { quoted: msg });

                global.gameSessions[sessionKey] = {
                    board: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
                    player1: senderJid,
                    player2: 'gojo',
                    turn: senderJid,
                    symbols: { [senderJid]: '❌', 'gojo': '⭕' },
                    lastQuestionMsgId: prompt.key.id
                };
            } else if (mode === 'multi') {
                if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Multiplayer modes require an active Group Chat." }, { quoted: msg });

                const sessionKey = jid + '_ttt';
                global.gameSessions[sessionKey] = {
                    board: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
                    player1: senderJid,
                    player2: '',
                    turn: senderJid,
                    symbols: { [senderJid]: '❌' },
                    lastQuestionMsgId: ''
                };

                const searchButtons = {
                    text: `⚔️ *TIC-TAC-TOE DUEL LOBBY* ⚔️\n\n👤 *Player 1:* @${senderNumber}\n🌐 *Status:* Searching for Player 2...\n\n👉 Tap join to enter!`,
                    buttons: [{ buttonId: `${config.prefix}ttt_join`, buttonText: { displayText: 'Join Duel ⚔️' }, type: 1 }],
                    headerType: 1,
                    mentions: [senderPhone]
                };
                await sock.sendMessage(jid, searchButtons, { quoted: msg });
            }
        }
    },

    // 3. TTT JOIN
    {
        name: 'ttt_join',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderPhone = await resolveToPhoneJid(sock, senderJid);
            const senderNumber = senderPhone.split('@')[0];

            const sessionKey = jid + '_ttt';
            const session = global.gameSessions[sessionKey];

            if (!session || session.player2 || session.player1 === senderJid) return;

            session.player2 = senderJid;
            session.symbols[senderJid] = '⭕';

            const player1Phone = await resolveToPhoneJid(sock, session.player1);
            const player1Number = player1Phone.split('@')[0];
            const initialBoard = renderCoolTttBoard([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ']);

            const prompt = await sock.sendMessage(jid, { text: `🎮 *TIC-TAC-TOE DUEL STARTED* 🎮\n\n❌ @${player1Number} vs ⭕ @${senderNumber}\n\n${initialBoard}\n\n👉 It is @${player1Number}'s turn! Reply directly with a position number (1-9).`, mentions: [player1Phone, senderPhone] }, { quoted: msg });
            session.lastQuestionMsgId = prompt.key.id;
        }
    },

    // 4. RPS
    {
        name: 'rps',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                return await sock.sendMessage(jid, { text: `✊ *ROCK PAPER SCISSORS vs GOJO* 🖐️\n\nChoose your weapon:\n• \`${config.prefix}rps rock\` 🪨\n• \`${config.prefix}rps paper\` 📄\n• \`${config.prefix}rps scissors\` ✂️` }, { quoted: msg });
            }

            const playerChoice = args.toLowerCase().trim();
            let cleanChoice = playerChoice;
            if (playerChoice === '🪨') cleanChoice = 'rock';
            if (playerChoice === '📄') cleanChoice = 'paper';
            if (playerChoice === '✂️') cleanChoice = 'scissors';

            const choices = ['rock', 'paper', 'scissors'];
            if (!choices.includes(cleanChoice)) return await sock.sendMessage(jid, { text: "❌ Invalid choice." }, { quoted: msg });

            const gojoChoice = choices[Math.floor(Math.random() * choices.length)];
            const emojis = { rock: "🪨", paper: "📄", scissors: "✂️" };

            let result = "";
            let quote = "";

            if (cleanChoice === gojoChoice) {
                result = "🤝 *DRAW/TIE MATCH* 🤝";
                quote = "“Interesting. Our timing was identical.” 😏";
            } else if (
                (cleanChoice === 'rock' && gojoChoice === 'scissors') ||
                (cleanChoice === 'paper' && gojoChoice === 'rock') ||
                (cleanChoice === 'scissors' && gojoChoice === 'paper')
            ) {
                result = "🏆 *YOU WON!* 🏆";
                quote = "“What? You actually won? Don't expect to bypass my infinity next time!” 🙄";
            } else {
                result = "💀 *YOU LOST!* 💀";
                quote = "“My Six Eyes saw your choice coming from miles away!” 🤞";
            }

            await sock.sendMessage(jid, { text: `✊ *ROCK-PAPER-SCISSORS SHOWDOWN* 🖐️\n\n👤 *You chose:* ${emojis[cleanChoice]} \`${cleanChoice.toUpperCase()}\`\n🤖 *Gojo chose:* ${emojis[gojoChoice]} \`${gojoChoice.toUpperCase()}\`\n\n${result}\n\n💬 Gojo: _${quote}_` }, { quoted: msg });
        }
    },

    // 5. GUESS
    {
        name: 'guess',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid + '_guess';
            const activeSession = global.gameSessions[sessionKey];

            if (!args) {
                if (activeSession) return await sock.sendMessage(jid, { text: `⚠️ Active game running. Guess using \`${config.prefix}guess <number>\`. ${6 - activeSession.attempts} attempts left.` }, { quoted: msg });

                const targetNum = Math.floor(Math.random() * 100) + 1;
                const prompt = await sock.sendMessage(jid, { text: `🌀 *CURSED ENERGY CONCENTRATION* 🌀\n\nI have suppressed a specific quantity of Cursed Energy between *1 and 100*.\n\n👉 Guess the level by replying directly to this message!` }, { quoted: msg });

                global.gameSessions[sessionKey] = {
                    target: targetNum,
                    attempts: 0,
                    lastQuestionMsgId: prompt.key.id
                };
                return;
            }

            if (!activeSession) return await sock.sendMessage(jid, { text: `❌ No active guessing game running.` }, { quoted: msg });

            const userGuess = parseInt(args.trim());
            if (isNaN(userGuess) || userGuess < 1 || userGuess > 100) return await sock.sendMessage(jid, { text: "❌ Please provide a valid integer guess." }, { quoted: msg });

            activeSession.attempts++;

            if (userGuess === activeSession.target) {
                delete global.gameSessions[sessionKey];
                return await sock.sendMessage(jid, { text: `🎉 *TARGET CALIBRATION SUCCESSFUL!* 🎉\n\n🎯 You guessed the exact level: *${userGuess}*!\n⚡ *Attempts used:* \`${activeSession.attempts}/6\`\n\n_“Incredible perception.”_ 🤞` }, { quoted: msg });
            }

            if (activeSession.attempts >= 6) {
                const actualValue = activeSession.target;
                delete global.gameSessions[sessionKey];
                return await sock.sendMessage(jid, { text: `💀 *CONCENTRATION DISPERSED!* 💀\n\nYou ran out of attempts! The correct value was *${actualValue}*.\n\n_“Baka!”_ 🙄` }, { quoted: msg });
            }

            const clue = userGuess < activeSession.target ? "Too LOW! 📈" : "Too HIGH! 📉";
            const updatedPrompt = await sock.sendMessage(jid, { text: `🔮 *Cursed Energy Clue:* \`${clue}\`\n\n• Attempts remaining: \`${6 - activeSession.attempts}/6\`\n\n👉 Reply directly to this message to submit your next guess!` });
            activeSession.lastQuestionMsgId = updatedPrompt.key.id;
        }
    },

    // 6. VAULT 8
    {
        name: 'vault8',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid + '_v8';

            if (global.vault8Sessions[sessionKey] && args) {
                return await handleGameTurn(sock, msg, args, sessionKey);
            }

            const loginFrames = [
                "🌐 `[SYS_LINK] INITIATING HANDSHAKE WITH VAULT8.COM...`",
                "🛰️ `[SYS_LINK] DECRYPTING ONION ROUTERS...`",
                "🔓 `[SECURITY] ROOT BACKDOOR ACCESS GRANTED!`"
            ];

            try {
                let sentMsg = await sock.sendMessage(jid, { text: loginFrames[0] }, { quoted: msg });
                for (let i = 1; i < loginFrames.length; i++) {
                    await delay(1000);
                    await sock.sendMessage(jid, { text: loginFrames[i], edit: sentMsg.key });
                }

                await delay(800);
                const bannerText =
                    `🖥️ *VAULT 8 SECURE INTEL PORTAL* 🖥️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `⚠️ *WARNING:* You are entering a restricted psychological text adventure game. Scenarios are highly dangerous. *Any wrong decision will result in your death.*\n\n` +
                    `Select an option below to proceed:`;

                const buttonMessage = {
                    text: bannerText,
                    buttons: [
                        { buttonId: `${config.prefix}v8_btn play`, buttonText: { displayText: 'Replay Story 🖥️' }, type: 1 },
                        { buttonId: `${config.prefix}v8_btn refresh`, buttonText: { displayText: 'Refresh Story 🔄' }, type: 1 },
                        { buttonId: `${config.prefix}v8_btn cancel`, buttonText: { displayText: 'Cancel 🛑' }, type: 1 }
                    ],
                    headerType: 1
                };

                try { await sock.sendMessage(jid, { delete: sentMsg.key }); } catch (e) { /* ignore */ }
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {
                console.error(err);
            }
        }
    },

    // 7. V8 BTN
    {
        name: 'v8_btn',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid + '_v8';
            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'play' || action === 'retry') {
                const saved = global.vault8SavedStories[sessionKey];

                if (saved) {
                    await sock.sendMessage(jid, { text: "💾 `[SYSTEM] Reloading saved scenario environment...`" }, { quoted: msg });

                    const gameHeader =
                        `📁 *VAULT 8: STEP 1/20 (REPLAY)* 💻\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `${saved.firstStep}\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 *To progress, reply directly to this message with your choice (1, 2, or 3)!*`;

                    const prompt = await sock.sendMessage(jid, { text: gameHeader }, { quoted: msg });

                    global.vault8Sessions[sessionKey] = {
                        step: 1,
                        history: [
                            { role: "system", content: saved.systemPrompt },
                            { role: "assistant", content: saved.firstStep }
                        ],
                        lastQuestionMsgId: prompt.key.id
                    };
                    return;
                } else {
                    await sock.sendMessage(jid, { text: "👁️ `[SYSTEM] Generating new scenario file assets...`" }, { quoted: msg });

                    const systemPrompt =
                        "You are the terminal engine of 'Vault 8', a creepy psychological text adventure game. " +
                        "Generate Step 1 of a creepy text adventure. Describe the dark, cold environment they wake up in. " +
                        "Give them exactly 3 distinct choices (1, 2, 3). Keep scenarios brief and medium-length (maximum of 2-3 sentences), " +
                        "and do not use conversational pleasantries.";

                    const initialSession = [{ role: "system", content: systemPrompt }];
                    const firstStep = await queryVaultEngine(initialSession);
                    if (!firstStep) return await sock.sendMessage(jid, { text: "❌ Connection timeout." }, { quoted: msg });

                    const gameHeader =
                        `📁 *VAULT 8: STEP 1/20* 💻\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `${firstStep}\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 *To progress, reply directly to this message with your choice (1, 2, or 3)!*`;

                    const prompt = await sock.sendMessage(jid, { text: gameHeader }, { quoted: msg });

                    global.vault8SavedStories[sessionKey] = { systemPrompt: systemPrompt, firstStep: firstStep };
                    global.vault8Sessions[sessionKey] = {
                        step: 1,
                        history: [
                            { role: "system", content: systemPrompt },
                            { role: "assistant", content: firstStep }
                        ],
                        lastQuestionMsgId: prompt.key.id
                    };
                    return;
                }
            } else if (action === 'refresh') {
                delete global.vault8Sessions[sessionKey];
                delete global.vault8SavedStories[sessionKey];
                await sock.sendMessage(jid, { text: "🔄 `[SYSTEM] Connection wiped.`" });
                return await commands[`${config.prefix}vault8`]?.execute(sock, msg, '', { isOwner: false });
            } else if (action === 'cancel' || action === 'giveup') {
                delete global.vault8Sessions[sessionKey];
                await sock.sendMessage(jid, { text: "🛑 Terminal connection closed safely." }, { quoted: msg });
            }
        }
    },

    // 8. QUIZ
    {
        name: 'quiz',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderPhone = await resolveToPhoneJid(sock, senderJid);
            const senderNumber = senderPhone.split('@')[0];

            const parts = args ? args.toLowerCase().trim().split(' ') : [];
            const subAction = parts[0] || '';

            if (subAction === 'single' || subAction === 'multi') {
                if (subAction === 'multi' && !isGroup) return await sock.sendMessage(jid, { text: "❌ Multiplayer modes require an active Group Chat." }, { quoted: msg });

                const sessionKey = subAction === 'single' ? (jid + '_' + senderJid) : jid;

                if (global.triviaSessions[sessionKey]) return await sock.sendMessage(jid, { text: "⚠️ Active Quiz session already running." }, { quoted: msg });

                const sessionData = {
                    type: subAction,
                    status: 'awaiting_category',
                    player: senderJid,
                    players: [senderJid],
                    scores: { [senderJid]: 0 },
                    currentQuestionIndex: 1,
                    score: 0,
                    pastQuestions: [],
                    lastQuestionMsgId: ''
                };

                if (subAction === 'multi') {
                    sessionData.status = 'lobby';
                }

                global.triviaSessions[sessionKey] = sessionData;

                const catMenu =
                    `📚 *LIMITLESS QUIZ CATEGORIES* 📚\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `1. General Anime 🏮\n` +
                    `2. Chemistry 🧪\n` +
                    `3. English 📚\n` +
                    `4. Biology 🧬\n` +
                    `5. General Knowledge 🧠\n` +
                    `6. DC 🏴\n` +
                    `7. Marvel 🟥\n` +
                    `8. All Sports ⚽\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `👉 *Please reply directly to this message with the Category Name or Number (1-8) to begin!*`;

                if (subAction === 'single') {
                    const prompt = await sock.sendMessage(jid, { text: catMenu }, { quoted: msg });
                    global.triviaSessions[sessionKey].lastQuestionMsgId = prompt.key.id;
                } else {
                    const lobbyButtons = {
                        text: `👥 *QUIZ MULTIPLAYER LOBBY* 👥\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n• Players Joined: \`1/10\`\n👤 @${senderNumber}\n\n👉 Tap Join to enter!`,
                        buttons: [{ buttonId: `${config.prefix}quiz_join`, buttonText: { displayText: 'Join Lobby 👥' }, type: 1 }],
                        headerType: 1,
                        mentions: [senderPhone]
                    };

                    const lobbyMsg = await sock.sendMessage(jid, lobbyButtons, { quoted: msg });
                    global.triviaSessions[sessionKey].lobbyMsgId = lobbyMsg.key.id;

                    setTimeout(async () => {
                        const session = global.triviaSessions[sessionKey];
                        if (!session || session.status !== 'lobby') return;

                        if (session.players.length < 2) {
                            delete global.triviaSessions[sessionKey];
                            return await sock.sendMessage(jid, { text: "🛑 *Lobby Disbanded: Minimum 2 players required.*" });
                        }

                        session.status = 'awaiting_category';

                        const p1Phone = await resolveToPhoneJid(sock, session.player);
                        const prompt = await sock.sendMessage(jid, { text: `👥 *MULTIPLAYER CATEGORY SELECTION* 👥\n\n@${p1Phone.split('@')[0]}, please choose a category:\n\n${catMenu}`, mentions: [p1Phone] });
                        session.lastQuestionMsgId = prompt.key.id;
                    }, 25000);
                }
                return;
            }

            const buttons = {
                text: `📚 *LIMITLESS QUIZ WORLD* 📚\n\nSelect your game format to proceed:`,
                buttons: [
                    { buttonId: `${config.prefix}quiz single`, buttonText: { displayText: 'Singleplayer 👤' }, type: 1 },
                    { buttonId: `${config.prefix}quiz multi`, buttonText: { displayText: 'Multiplayer 👥' }, type: 1 }
                ],
                headerType: 1
            };
            await sock.sendMessage(jid, buttons, { quoted: msg });
        }
    },

    // 9. QUIZ JOIN
    {
        name: 'quiz_join',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

            const session = global.triviaSessions[jid];
            if (!session || session.status !== 'lobby') return;
            if (session.players.includes(senderJid)) return;

            if (session.players.length >= 10) return;

            session.players.push(senderJid);
            session.scores[senderJid] = 0;

            const joinedCount = session.players.length;

            const phonePlayers = [];
            for (const p of session.players) {
                const phone = await resolveToPhoneJid(sock, p);
                if (phone) phonePlayers.push(phone);
            }

            const listPlayers = phonePlayers.map(p => `👤 @${p.split('@')[0]}`).join('\n');

            const lobbyButtons = {
                text: `👥 *QUIZ MULTIPLAYER LOBBY* 👥\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n• Players: \`${joinedCount}/10\`\n${listPlayers}\n\n👉 Tap Join to enter!`,
                buttons: [{ buttonId: `${config.prefix}quiz_join`, buttonText: { displayText: 'Join Lobby 👥' }, type: 1 }],
                headerType: 1,
                mentions: phonePlayers
            };

            try { await sock.sendMessage(jid, { delete: { remoteJid: jid, id: session.lobbyMsgId, fromMe: true } }); } catch (e) { /* ignore */ }

            const updatedLobby = await sock.sendMessage(jid, lobbyButtons);
            session.lobbyMsgId = updatedLobby.key.id;
        }
    },

    // 10. QUIZ CAT
    {
        name: 'quiz_cat',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

            const singleKey = jid + '_' + senderJid;
            const session = global.triviaSessions[singleKey] || global.triviaSessions[jid];
            if (!session || session.status !== 'awaiting_category') return;

            if (session.type === 'multi' && session.player !== senderJid) return;

            // ─── REPLY GUARD ───
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;
            if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) {
                return; // Not a reply to the game prompt
            }

            const categoryChoice = args.trim().toLowerCase();

            const categoryIndexMap = {
                "1": "general anime",
                "2": "chemistry",
                "3": "english",
                "4": "biology",
                "5": "general knowledge",
                "6": "dc",
                "7": "marvel",
                "8": "all sports"
            };

            const resolvedChoice = categoryIndexMap[categoryChoice] || categoryChoice;

            const validCategories = [
                'English', 'Chemistry', 'General Knowledge', 'Biology',
                'General Anime', 'DC', 'Marvel', 'All Sports'
            ];

            const cleanChoice = resolvedChoice.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();

            const matched = validCategories.find(c => c.toLowerCase() === cleanChoice || c.toLowerCase().includes(cleanChoice));
            if (!matched) {
                return await sock.sendMessage(jid, { text: "❌ Invalid category selection. Please reply with a valid category name or number (1-8)." }, { quoted: msg });
            }

            session.category = matched;
            session.status = 'playing';
            session.turnIndex = 0;

            await sock.sendMessage(jid, { text: `🚀 *Quiz Category set to: "${matched}"* \n\nPreparing Round 1...` });
            await delay(1500);
            await askNextQuizQuestion(sock, jid, (session.type === 'single' ? singleKey : jid));
        }
    },

    // 11. QUIZ ANS
    {
        name: 'quiz_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderPhone = await resolveToPhoneJid(sock, senderJid);
            const senderNumber = senderPhone.split('@')[0];

            const singleKey = jid + '_' + senderJid;
            const session = global.triviaSessions[singleKey] || global.triviaSessions[jid];
            if (!session || session.status !== 'playing') return;

            const isSingle = session.type === 'single';
            if (!isSingle) {
                const activeTurnPlayer = session.players[session.turnIndex];
                if (activeTurnPlayer !== senderJid) return;
            }

            const chosenAnswer = args.trim().toLowerCase();
            if (!['a', 'b', 'c', 'd'].includes(chosenAnswer)) return;

            await sock.sendMessage(jid, { text: "🔍 `Validating your answer...`" }, { quoted: msg });

            const prompt = `
            You are Satoru Gojo, the strongest Jujutsu Sorcerer, hosting a fun trivia game.
            Question: "${session.currentQuestion}"
            Options:
            ${session.currentOptions.join('\n')}
            User Chose Option: "${chosenAnswer.toUpperCase()}"

            Determine if their choice is correct. Respond strictly with a JSON object in this exact format (no other text or markdown):
            {
              "isCorrect": true, // or false
              "correctOption": "C", // the correct letter option (A, B, C, or D)
              "explanation": "A teasing, overconfident, and brief (1-2 sentences) Satoru Gojo explanation of why this option is correct or incorrect."
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
                    explanation: 'I guess the system recorded your answer.'
                };
            }

            let resultLabel = "";
            if (resultData.isCorrect) {
                if (isSingle) session.score++; else session.scores[senderJid]++;
                resultLabel =
                    `✅ *CORRECT!* \n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👁️ *Gojo:* _"${resultData.explanation}"_\n\n` +
                    `🎉 +1 point for @${senderNumber}!`;
            } else {
                resultLabel =
                    `❌ *INCORRECT!* \n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👁️ *Gojo:* _"${resultData.explanation}"_\n\n` +
                    `🙄 Looks like @${senderNumber} missed that one!`;
            }

            await sock.sendMessage(jid, { text: resultLabel, mentions: [senderPhone] }, { quoted: msg });

            session.currentQuestionIndex++;
            if (!isSingle) session.turnIndex = (session.turnIndex + 1) % session.players.length;

            await delay(1500);
            await askNextQuizQuestion(sock, jid, (isSingle ? singleKey : jid));
        }
    },

    // 12. CHARADE
    {
        name: 'charade',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const sessionKey = jid + '_' + senderJid;

            if (global.charadeSessions[sessionKey]) {
                if (args && args.toLowerCase().trim() === 'quit') {
                    delete global.charadeSessions[sessionKey];
                    return await sock.sendMessage(jid, { text: "🛑 Emoji Charades session ended safely." }, { quoted: msg });
                }
                return await sock.sendMessage(jid, { text: `⚠️ Active game running.` }, { quoted: msg });
            }

            global.charadeSessions[sessionKey] = {
                player: senderJid,
                currentQuestionIndex: 1,
                score: 0,
                pastPuzzles: [],
                lastQuestionMsgId: ''
            };

            await sock.sendMessage(jid, { text: "🎭 *Emoji Charades Session Started!* Generating Puzzle 1/10..." }, { quoted: msg });
            await askNextCharadePuzzle(sock, jid, sessionKey);
        }
    },

    // 13. CHARADE ANS
    {
        name: 'charade_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderPhone = await resolveToPhoneJid(sock, senderJid);
            const senderNumber = senderPhone.split('@')[0];
            const sessionKey = jid + '_' + senderJid;

            const session = global.charadeSessions[sessionKey];
            if (!session) return;

            // ─── REPLY GUARD ───
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;
            if (!quotedMsgId || quotedMsgId !== session.lastQuestionMsgId) {
                return; // Not a reply to the game prompt
            }

            const guess = args ? args.trim() : '';
            if (!guess) return;

            await sock.sendMessage(jid, { text: "🔍 `Analyzing your guess...`" }, { quoted: msg });

            const isCorrect = await checkAnswerCorrectness(session.currentCorrectAnswer, guess);

            let feedback = "";
            if (isCorrect) {
                session.score++;
                feedback = `✅ *CORRECT GUESS BY @${senderNumber}!* \n\n🧩 *Puzzle:* ${session.currentEmojiCombo}\n📝 *Correct phrase:* \`"${session.currentCorrectAnswer}"\`\n\n🎉 +1 point!`;
            } else {
                feedback = `❌ *INCORRECT GUESS BY @${senderNumber}!* \n\n🧩 *Puzzle:* ${session.currentEmojiCombo}\n📝 *Correct phrase:* \`"${session.currentCorrectAnswer}"\``;
            }

            await sock.sendMessage(jid, { text: feedback, mentions: [senderPhone] }, { quoted: msg });

            session.currentQuestionIndex++;
            await delay(1500);
            await askNextCharadePuzzle(sock, jid, sessionKey);
        }
    },

    // 14. GAMES LOBBY
    {
        name: 'games',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const prefix = config.prefix || '⚡';

            const portalText =
                `🎮 *INFINITE ARCADE LOBBY* 🎮\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `Welcome to Satoru Gojo's game domain! Select an active game category below to begin:\n\n` +
                `📚 *1. QUIZ* — Complete topic-focused challenges.\n` +
                `🔠 *2. ANAGRAM* — Scrambled letters word puzzle.\n` +
                `🎭 *3. SHARADE* — Guess the phrase from emoji clues.\n` +
                `📜 *4. TORF* — Interactive True or False statements.\n` +
                `💰 *5. MILLIONAIRE* — 15-question Millionaire trivia ladder.\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `👉 *Tap a quick-button below, or type:* \`${prefix}<game_name>\` (e.g. \`${prefix}quiz\`)`;

            const buttons = [
                { buttonId: `${prefix}quiz`, buttonText: { displayText: 'Quiz 🚀' }, type: 1 },
                { buttonId: `${prefix}anagram`, buttonText: { displayText: 'Anagram 🔠' }, type: 1 },
                { buttonId: `${prefix}torf`, buttonText: { displayText: 'True or False 📜' }, type: 1 }
            ];

            const buttonMessage = {
                text: portalText,
                buttons: buttons,
                headerType: 1
            };

            try {
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {
                const fallbackText = `${portalText}\n\n` +
                                     `💡 *Launch Commands:*\n` +
                                     `• Quiz: \`${prefix}quiz\`\n` +
                                     `• Anagram: \`${prefix}anagram\`\n` +
                                     `• Sharade: \`${prefix}sharade\`\n` +
                                     `• Torf: \`${prefix}torf\`\n` +
                                     `• Millionaire: \`${prefix}millionaire\``;
                await sock.sendMessage(jid, { text: fallbackText }, { quoted: msg });
            }
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'ttt') aliases.push({ ...cmd, name: 'tictactoe' });
    if (cmd.name === 'charade') {
        aliases.push({ ...cmd, name: 'charades' });
        aliases.push({ ...cmd, name: 'sharade' });
        aliases.push({ ...cmd, name: 'sharades' });
    }
});
module.exports.push(...aliases);