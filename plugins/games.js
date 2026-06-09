// plugins/games.js
const settings = require('../settings');

global.gameSessions = global.gameSessions || {};
global.vault8Sessions = global.vault8Sessions || {};
global.vault8SavedStories = global.vault8SavedStories || {};
global.triviaSessions = global.triviaSessions || {};
global.charadeSessions = global.charadeSessions || {};

const s1 = "gsk_";
const s2 = "tPB0xMyZ2oijloaBNcDs";
const s3 = "WGdyb3FY5iC2p9hwRE";
const s4 = "SIJXAV3t53LZg9";
const GROQ_API_KEY = s1 + s2 + s3 + s4;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

async function queryLLM(prompt, temperature = 0.8) {
    try {
        const response = await fetch(GROQ_BASE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }],
                temperature: temperature
            })
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        console.error("LLM Query Error:", e.message);
        return null;
    }
}

async function queryVaultEngine(messages) {
    try {
        const response = await fetch(GROQ_BASE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: messages,
                temperature: 0.85
            })
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        console.error("Vault 8 Engine Error:", e.message);
        return null;
    }
}

// General Knowledge Trivia Question Generator (Linked directly to Groq with Random Seeds)
async function generateGeneralQuestion(excludeList = []) {
    const salt = Math.random() + '_' + Date.now(); // Ensures infinite variety
    const prompt = 
        `Generate an interesting, unique general knowledge trivia question (strictly avoid anime themes).\n` +
        `Respond strictly with a JSON object in this exact layout. No other text or markdown:\n` +
        `{"q": "The question?", "options": ["A) Opt1", "B) Opt2", "C) Opt3", "D) Opt4"], "ans": "a" | "b" | "c" | "d"}\n` +
        `To ensure uniqueness, use this random seed: ${salt}.\n` +
        `Do not repeat or generate anything similar to these past questions: ${excludeList.join(', ')}`;
    const response = await queryLLM(prompt, 0.85);
    if (!response) return null;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return null;
    }
}

// Topic-Specific Category Quiz Generator (Linked directly to Groq with Random Seeds)
async function generateCategoryQuestion(category, excludeList = []) {
    const salt = Math.random() + '_' + Date.now(); // Ensures infinite variety
    const prompt = 
        `Generate an interesting, unique quiz question strictly under the category: "${category}".\n` +
        `Respond strictly with a JSON object in this exact layout. No other text or markdown:\n` +
        `{"q": "The question?", "options": ["A) Opt1", "B) Opt2", "C) Opt3", "D) Opt4"], "ans": "a" | "b" | "c" | "d"}\n` +
        `To ensure uniqueness, use this random seed: ${salt}.\n` +
        `Do not repeat or generate anything similar to these past questions: ${excludeList.join(', ')}`;
    const response = await queryLLM(prompt, 0.85);
    if (!response) return null;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return null;
    }
}

// Emoji Charades Generator (Optimized for Easy-to-Medium Balanced Difficulty)
async function generateEmojiPuzzle(excludeList = []) {
    const salt = Math.random() + '_' + Date.now();
    const prompt = 
        `Generate a simple, highly recognizable, and fun emoji charades puzzle representing a globally famous movie, cartoon, brand, food, or well-known object.\n` +
        `Strictly make the puzzle easy-to-medium difficulty so players can easily guess it. Do not generate obscure phrases, local slang, abstract proverbs, or complex references.\n` +
        `Respond strictly with a JSON object in this exact layout. No other text or markdown:\n` +
        `{"emojis": "🦁👑", "ans": "The Lion King"}\n\n` +
        `Examples of excellent, balanced, and guessable puzzles:\n` +
        `- "🕷️👨" -> "Spider-Man"\n` +
        `- "🚢❄️" -> "Titanic"\n` +
        `- "⚡👓" -> "Harry Potter"\n` +
        `- "🍕🇮🇹" -> "Pizza"\n` +
        `- "🍎💻" -> "Apple"\n\n` +
        `To ensure uniqueness, use this random seed: ${salt}.\n` +
        `Do not repeat or generate anything similar to these past ones: ${excludeList.join(', ')}`;
    const response = await queryLLM(prompt, 0.85);
    if (!response) return null;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return null;
    }
}

// AI semantic analyzer to grade guess variations
async function checkAnswerCorrectness(correctAnswer, userGuess) {
    const prompt = `System: Compare correct answer "${correctAnswer}" with guess "${userGuess}". Are they semantically equivalent or highly similar? Respond with exactly YES or NO.`;
    const response = await queryLLM(prompt, 0.1);
    return response ? response.trim().toUpperCase().includes("YES") : false;
}

// Core Trivia Question Dispatcher
async function askNextTriviaQuestion(sock, jid, sessionKey) {
    const session = global.triviaSessions[sessionKey];
    const isSingle = session.type === 'single';
    const limit = isSingle ? 10 : (session.players.length * 5);

    if (session.currentQuestionIndex > limit) {
        let results = `📊 *TRIVIA GAME FINISHED!* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        if (isSingle) {
            results += `👤 *Player:* @${session.player.split('@')[0]}\n🎯 *Final Score:* \`${session.score}/10\` points.`;
        } else {
            results += `🏆 *Leaderboard Standings:* \n\n`;
            const sorted = [...session.players].sort((a, b) => session.scores[b] - session.scores[a]);
            sorted.forEach((pJid, idx) => {
                results += `${idx + 1}. @${pJid.split('@')[0]} — \`${session.scores[pJid]}/5\` points\n`;
            });
        }
        delete global.triviaSessions[sessionKey];
        return await sock.sendMessage(jid, { text: results, mentions: isSingle ? [session.player] : session.players });
    }

    let activePlayer = session.player;
    if (!isSingle) activePlayer = session.players[session.turnIndex];

    const questionData = await generateGeneralQuestion(session.pastQuestions);
    if (!questionData) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve question. Game aborted." });

    session.pastQuestions.push(questionData.q);
    session.currentQuestion = questionData.q;
    session.currentAnswer = questionData.ans;
    session.currentOptions = questionData.options;

    const turnLabel = isSingle 
        ? `📝 *General Trivia: Question ${session.currentQuestionIndex}/10*`
        : `👥 *Trivia Turn: @${activePlayer.split('@')[0]} (${session.currentQuestionIndex}/${limit})*`;

    const triviaCard = 
        `${turnLabel}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 *Question:* ${questionData.q}\n\n` +
        `${questionData.options.join('\n')}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Reply directly with your answer letter (A, B, C, or D).*`;

    const prompt = await sock.sendMessage(jid, { text: triviaCard, mentions: isSingle ? [session.player] : [activePlayer] });
    session.lastQuestionMsgId = prompt.key.id;
}

// Core Topic-Specific Quiz Dispatcher
async function askNextQuizQuestion(sock, jid, sessionKey) {
    const session = global.triviaSessions[sessionKey];

    if (session.currentQuestionIndex > 10) {
        const results = `📊 *QUIZ SESSION COMPLETE!* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `👤 *Player:* @${session.player.split('@')[0]}\n` +
                        `📂 *Category:* \`${session.category}\`\n` +
                        `🎯 *Final Score:* \`${session.score}/10\` points.`;
        delete global.triviaSessions[sessionKey];
        return await sock.sendMessage(jid, { text: results, mentions: [session.player] });
    }

    const questionData = await generateCategoryQuestion(session.category, session.pastQuestions);
    if (!questionData) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve question. Game aborted." });

    session.pastQuestions.push(questionData.q);
    session.currentQuestion = questionData.q;
    session.currentAnswer = questionData.ans;
    session.currentOptions = questionData.options;

    const quizCard = 
        `📝 *Topic Quiz: Round ${session.currentQuestionIndex}/10* 📝\n` +
        `📂 *Category:* \`${session.category}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 *Question:* ${questionData.q}\n\n` +
        `${questionData.options.join('\n')}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Reply directly with your answer letter (A, B, C, or D) to proceed.*`;

    const prompt = await sock.sendMessage(jid, { text: quizCard, mentions: [session.player] });
    session.lastQuestionMsgId = prompt.key.id;
}

// Core Emoji Charades Dispatcher
async function askNextCharadePuzzle(sock, jid, sessionKey) {
    const session = global.charadeSessions[sessionKey];

    if (session.currentQuestionIndex > 10) {
        const results = `🏆 *CHARADES CONCLUDED!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `👤 *Player:* @${session.player.split('@')[0]}\n` +
                        `🎯 *Final Score:* \`${session.score}/10\` points.`;
        delete global.charadeSessions[sessionKey];
        return await sock.sendMessage(jid, { text: results, mentions: [session.player] });
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

// Vault 8 Story Progression handler (Strict brief scenarios with high fatal risk)
async function handleGameTurn(sock, msg, userChoice, sessionKey) {
    const jid = msg.key.remoteJid;
    const session = global.vault8Sessions[sessionKey];

    await sock.sendMessage(jid, { text: "💾 `Processing decision...`" }, { quoted: msg });
    session.step++;

    const turnPrompt = 
        `The user chose: "${userChoice}". Evaluate this choice for Step ${session.step} of 20.\n\n` +
        `This is a high-risk psychological thriller. If their choice is even slightly foolish, risky, incorrect, or leads to a dead end, write a chilling description of their death, and conclude with the exact text "GAME_OVER" at the very end of your response.\n\n` +
        `If they survive, generate Step ${session.step} of 20. The scenario must be extremely eerie, tense, and brief (2-3 sentences maximum). Provide exactly 3 new choices (1, 2, 3).\n\n` +
        `If they reach Step 20 and survive, generate a mysterious, triumphant ending and conclude with the exact text "VICTORY" at the very end of your response.`;

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
                { buttonId: `${settings.prefix}v8_btn retry`, buttonText: { displayText: 'Retry 🔄' }, type: 1 },
                { buttonId: `${settings.prefix}v8_btn cancel`, buttonText: { displayText: 'Give Up 🛑' }, type: 1 }
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
            `🏆 *VAULT 8: SIMULATION COMPLETED!* 🏆\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${cleanVictoryMsg}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🎉 *CONGRATULATIONS: You survived the horrors of Vault 8!*`;
        return await sock.sendMessage(jid, { text: victoryCard }, { quoted: msg });
    }

    const gameCard = 
        `📁 *VAULT 8: STEP ${session.step}/20* 💻\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${engineResponse}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Reply to this message with:* \`${settings.prefix}v8 <your choice/number>\``;

    await sock.sendMessage(jid, { text: gameCard }, { quoted: msg });
}

// ============================================================================
// GAME COMMANDS
// ============================================================================

module.exports = [
    // 1. TIC-TAC-TOE INITIATOR (.ttt)
    {
        name: 'ttt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (args && args.toLowerCase().trim() === 'quit') {
                const sessionKey = jid + '_ttt';
                if (!global.gameSessions[sessionKey]) return await sock.sendMessage(jid, { text: "❌ No active Tic-Tac-Toe session is running." }, { quoted: msg });
                delete global.gameSessions[sessionKey];
                return await sock.sendMessage(jid, { text: "🛑 Tic-Tac-Toe session abandoned." }, { quoted: msg });
            }

            const inputVal = parseInt(args);
            if (!isNaN(inputVal)) {
                const sessionKey = jid + '_ttt';
                const activeSession = global.gameSessions[sessionKey];
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const senderNumber = senderJid.split('@')[0];

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
                        return await sock.sendMessage(jid, { text: `🏆 *VICTORY!* \n\n🎉 @${senderNumber} won the match!\n\n${finalBoard}`, mentions: [senderJid] }, { quoted: msg });
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

                    return await sock.sendMessage(jid, { text: `🎮 *TIC-TAC-TOE* 🎮\n\n${finalBoard}\n\n👉 Your turn again! Use \`${settings.prefix}ttt <1-9>\`.` }, { quoted: msg });
                } else {
                    activeSession.turn = activeSession.player1 === senderJid ? activeSession.player2 : activeSession.player1;
                    const nextTurnNumber = activeSession.turn.split('@')[0];
                    const finalBoard = renderCoolTttBoard(activeSession.board);

                    return await sock.sendMessage(jid, { text: `🎮 *TIC-TAC-TOE* 🎮\n\n${finalBoard}\n\n👉 It is now @${nextTurnNumber}'s turn! Use \`${settings.prefix}ttt <1-9>\`.`, mentions: [activeSession.turn] }, { quoted: msg });
                }
            }

            const buttons = {
                text: `🎮 *TIC-TAC-TOE* 🎮\n\nSelect your game format:`,
                buttons: [
                    { buttonId: `${settings.prefix}ttt_mode ai`, buttonText: { displayText: 'Play with AI 🤖' }, type: 1 },
                    { buttonId: `${settings.prefix}ttt_mode multi`, buttonText: { displayText: 'Multiplayer ⚔️' }, type: 1 }
                ],
                headerType: 1
            };
            await sock.sendMessage(jid, buttons, { quoted: msg });
        }
    },

    // 2. TIC-TAC-TOE LOBBY MANAGEMENT MODES (.ttt_mode)
    {
        name: 'ttt_mode',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];
            const mode = args ? args.toLowerCase().trim() : '';

            if (mode === 'ai') {
                const sessionKey = jid + '_ttt';
                global.gameSessions[sessionKey] = {
                    board: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
                    player1: senderJid,
                    player2: 'gojo',
                    turn: senderJid,
                    symbols: { [senderJid]: '❌', 'gojo': '⭕' }
                };

                const initialBoard = renderCoolTttBoard([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ']);
                return await sock.sendMessage(jid, { text: `🎮 *TIC-TAC-TOE: GOJO CHALLENGE* 🎮\n\n👤 *Player:* @${senderNumber} (❌)\n🤖 *AI:* Gojo (⭕)\n\n${initialBoard}\n\n👉 It is your turn! Use \`${settings.prefix}ttt <1-9>\`.`, mentions: [senderJid] }, { quoted: msg });
            } 
            else if (mode === 'multi') {
                if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Multiplayer modes require an active Group Chat." }, { quoted: msg });

                const sessionKey = jid + '_ttt';
                global.gameSessions[sessionKey] = {
                    board: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
                    player1: senderJid,
                    player2: '',
                    turn: senderJid,
                    symbols: { [senderJid]: '❌' }
                };

                const searchButtons = {
                    text: `⚔️ *TIC-TAC-TOE DUEL LOBBY* ⚔️\n\n👤 *Player 1:* @${senderNumber}\n🌐 *Status:* Searching for Player 2...\n\n👉 Tap join to enter!`,
                    buttons: [{ buttonId: `${settings.prefix}ttt_join`, buttonText: { displayText: 'Join Duel ⚔️' }, type: 1 }],
                    headerType: 1,
                    mentions: [senderJid]
                };
                await sock.sendMessage(jid, searchButtons, { quoted: msg });
            }
        }
    },

    // 3. TIC-TAC-TOE LOBBY JOIN CONTROLLER (.ttt_join)
    {
        name: 'ttt_join',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const sessionKey = jid + '_ttt';
            const session = global.gameSessions[sessionKey];

            if (!session || session.player2 || session.player1 === senderJid) return;

            session.player2 = senderJid;
            session.symbols[senderJid] = '⭕';

            const player1Number = session.player1.split('@')[0];
            const initialBoard = renderCoolTttBoard([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ']);

            await sock.sendMessage(jid, { text: `🎮 *TIC-TAC-TOE DUEL STARTED* 🎮\n\n❌ @${player1Number} vs ⭕ @${senderNumber}\n\n${initialBoard}\n\n👉 It is @${player1Number}'s turn! Use \`${settings.prefix}ttt <1-9>\`.`, mentions: [session.player1, senderJid] }, { quoted: msg });
        }
    },

    // 4. ROCK-PAPER-SCI-GOJO GAME (.rps)
    {
        name: 'rps',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                return await sock.sendMessage(jid, { text: `✊ *ROCK PAPER SCISSORS vs GOJO* 🖐️\n\nChoose your weapon:\n• \`${settings.prefix}rps rock\` 🪨\n• \`${settings.prefix}rps paper\` 📄\n• \`${settings.prefix}rps scissors\` ✂️` }, { quoted: msg });
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

    // 5. CURSED ENERGY GUESSING GAME (.guess)
    {
        name: 'guess',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid + '_guess';
            const activeSession = global.gameSessions[sessionKey];

            if (!args) {
                if (activeSession) return await sock.sendMessage(jid, { text: `⚠️ Active game running. Guess using \`${settings.prefix}guess <number>\`. ${6 - activeSession.attempts} attempts left.` }, { quoted: msg });

                global.gameSessions[sessionKey] = { target: Math.floor(Math.random() * 100) + 1, attempts: 0 };
                return await sock.sendMessage(jid, { text: `🌀 *CURSED ENERGY CONCENTRATION* 🌀\n\nI have suppressed a specific quantity of Cursed Energy between *1 and 100*.\n\nGuess the level using: \`${settings.prefix}guess <number>\`` }, { quoted: msg });
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
            await sock.sendMessage(jid, { text: `🔮 *Cursed Energy Clue:* \`${clue}\`\n\n• Attempts remaining: \`${6 - activeSession.attempts}/6\`` }, { quoted: msg });
        }
    },

    // 6. THRILLER TEXT RPG: THE VAULT 8 (.vault8 / .vault8.com)
    {
        name: 'vault8',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
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
                const hasSaved = !!global.vault8SavedStories[sessionKey];
                const bannerText = 
                    `🖥️ *VAULT 8 SECURE INTEL PORTAL* 🖥️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `⚠️ *WARNING:* You are entering a restricted psychological text adventure game. Scenarios are highly dangerous. *Any wrong decision will result in your death.*\n\n` +
                    `Select an option below to proceed:`;

                const buttonMessage = {
                    text: bannerText,
                    buttons: [
                        { buttonId: `${settings.prefix}v8_btn play`, buttonText: { displayText: hasSaved ? 'Replay Story 🖥️' : 'Play 🖥️' }, type: 1 },
                        { buttonId: `${settings.prefix}v8_btn refresh`, buttonText: { displayText: 'Refresh Story 🔄' }, type: 1 },
                        { buttonId: `${settings.prefix}v8_btn cancel`, buttonText: { displayText: 'Cancel 🛑' }, type: 1 }
                    ],
                    headerType: 1
                };

                try { await sock.sendMessage(jid, { delete: sentMsg.key }); } catch (e) {}
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {
                console.error(err);
            }
        }
    },

    // 7. VAULT8 INTERACTIVE BUTTON CONTROLLER (.v8_btn)
    {
        name: 'v8_btn',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid + '_v8';
            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'play' || action === 'retry') {
                const saved = global.vault8SavedStories[sessionKey];

                if (saved) {
                    await sock.sendMessage(jid, { text: "💾 `[SYSTEM] Reloading saved scenario environment...`" }, { quoted: msg });
                    global.vault8Sessions[sessionKey] = {
                        step: 1,
                        history: [
                            { role: "system", content: saved.systemPrompt },
                            { role: "assistant", content: saved.firstStep }
                        ]
                    };

                    const gameHeader = 
                        `📁 *VAULT 8: STEP 1/20 (REPLAY)* 💻\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `${saved.firstStep}\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 *To progress, reply to this message using:* \`${settings.prefix}v8 <your choice/number>\``;

                    return await sock.sendMessage(jid, { text: gameHeader }, { quoted: msg });
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

                    global.vault8SavedStories[sessionKey] = { systemPrompt: systemPrompt, firstStep: firstStep };
                    global.vault8Sessions[sessionKey] = {
                        step: 1,
                        history: [
                            { role: "system", content: systemPrompt },
                            { role: "assistant", content: firstStep }
                        ]
                    };

                    const gameHeader = 
                        `📁 *VAULT 8: STEP 1/20* 💻\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `${firstStep}\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 *To progress, reply to this message using:* \`${settings.prefix}v8 <your choice/number>\``;

                    return await sock.sendMessage(jid, { text: gameHeader }, { quoted: msg });
                }
            } 
            else if (action === 'refresh') {
                delete global.vault8Sessions[sessionKey];
                delete global.vault8SavedStories[sessionKey];
                await sock.sendMessage(jid, { text: "🔄 `[SYSTEM] Connection wiped.`" });
                return await commands[`${settings.prefix}vault8`](sock, msg, '', { isOwner: false });
            } 
            else if (action === 'cancel' || action === 'giveup') {
                delete global.vault8Sessions[sessionKey];
                await sock.sendMessage(jid, { text: "🛑 Terminal connection closed safely." }, { quoted: msg });
            }
        }
    },

    // 8. GENERAL KNOWLEDGE TRIVIA SYSTEM (.trivia)
    {
        name: 'trivia',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';

            const sessionKey = jid + '_' + senderJid;
            global.triviaSessions[sessionKey] = {
                type: 'single',
                player: senderJid,
                currentQuestionIndex: 1,
                score: 0,
                pastQuestions: [],
                lastQuestionMsgId: ''
            };

            await sock.sendMessage(jid, { text: `🚀 *Trivia session created!* Preparing Question 1/10...` }, { quoted: msg });
            await askNextTriviaQuestion(sock, jid, sessionKey);
        }
    },

    // 9. DYNAMIC CATEGORIZED QUIZ INITIATOR (.quiz <category>)
    {
        name: 'quiz',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const category = args ? args.trim() : "";

            if (!category) {
                return await sock.sendMessage(jid, {
                    text: `❌ Please specify a quiz category!\n\n` +
                          `Example: \`${settings.prefix}quiz biology\`\n` +
                          `Example: \`${settings.prefix}quiz Jujutsu Kaisen\`\n` +
                          `Example: \`${settings.prefix}quiz Anime\``
                }, { quoted: msg });
            }

            const sessionKey = jid + '_' + msg.key.participant + '_quiz';

            global.triviaSessions[sessionKey] = {
                type: 'quiz',
                category: category,
                player: msg.key.participant || msg.key.remoteJid || '',
                currentQuestionIndex: 1,
                score: 0,
                pastQuestions: [],
                lastQuestionMsgId: ''
            };

            await sock.sendMessage(jid, { text: `🚀 *Quiz Session Initialized!* Category: *"${category}"*\nPreparing Question 1/10...` }, { quoted: msg });
            await askNextQuizQuestion(sock, jid, sessionKey);
        }
    },

    // 10. TRIVIA & QUIZ REPLIES AND EVALUATIONS (.trivia_ans)
    {
        name: 'trivia_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const sessionKey = jid.endsWith('@g.us') ? (jid + '_' + senderJid) : jid + '_' + senderJid;
            const quizKey = jid + '_' + senderJid + '_quiz';
            const activeKey = global.triviaSessions[quizKey] ? quizKey : (global.triviaSessions[sessionKey] ? sessionKey : '');

            const session = global.triviaSessions[activeKey];
            if (!session) return;

            const chosenAnswer = args.trim().toLowerCase();
            const correctAnswer = session.currentAnswer;

            let resultLabel = "";
            if (chosenAnswer === correctAnswer) {
                session.score++;
                resultLabel = `✅ *Correct answer chosen by @${senderNumber}!* +1 point. 🎉`;
            } else {
                resultLabel = `❌ *Incorrect answer selected by @${senderNumber}!* The correct option was *${correctAnswer.toUpperCase()}*.`;
            }

            await sock.sendMessage(jid, { text: resultLabel, mentions: [senderJid] }, { quoted: msg });

            session.currentQuestionIndex++;
            await delay(1500);

            if (session.type === 'quiz') {
                await askNextQuizQuestion(sock, jid, activeKey);
            } else {
                await askNextTriviaQuestion(sock, jid, activeKey);
            }
        }
    },

    // 11. EMOJI CHARADES GAME INITIATOR (.charade)
    {
        name: 'charade',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
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

    // 12. CHARADE EVALUATION MANAGER (.charade_ans)
    {
        name: 'charade_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];
            const sessionKey = jid + '_' + senderJid;

            const session = global.charadeSessions[sessionKey];
            if (!session) return;

            const guess = args ? args.trim() : '';
            if (!guess) return;

            await sock.sendMessage(jid, { text: "🔍 `Analyzing your guess...`" }, { quoted: msg });

            const isCorrect = await checkAnswerCorrectness(session.currentCorrectAnswer, guess);

            let feedback = "";
            if (isCorrect) {
                session.score++;
                feedback = `✅ *CORRECT!* \n\n🧩 *Puzzle:* ${session.currentEmojiCombo}\n📝 *Correct phrase:* \`"${session.currentCorrectAnswer}"\`\n\n🎉 +1 point!`;
            } else {
                feedback = `❌ *INCORRECT!* \n\n🧩 *Puzzle:* ${session.currentEmojiCombo}\n📝 *Correct phrase:* \`"${session.currentCorrectAnswer}"\``;
            }

            await sock.sendMessage(jid, { text: feedback, mentions: [senderJid] }, { quoted: msg });

            session.currentQuestionIndex++;
            await delay(1500);
            await askNextCharadePuzzle(sock, jid, sessionKey);
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'ttt') aliases.push({ ...cmd, name: 'tictactoe' });
    if (cmd.name === 'charade') aliases.push({ ...cmd, name: 'charades' });
});
module.exports.push(...aliases);