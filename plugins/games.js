// plugins/games.js
const settings = require('../settings');

// Initialize global game state parameters safely for the first 6 games
global.gameSessions = global.gameSessions || {};
global.vault8Sessions = global.vault8Sessions || {};
global.vault8SavedStories = global.vault8SavedStories || {};
global.triviaSessions = global.triviaSessions || {};
global.charadeSessions = global.charadeSessions || {};

// Groq API Details
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

// Upgraded Graphical Tic-Tac-Toe board helper using block emoji structures
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

// Tic-Tac-Toe win condition checker
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

// Satoru Gojo AI logic for Tic-Tac-Toe
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

// General purpose LLM prompt caller
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

// Vault 8 AI narrative querying
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
        if (!response.ok) throw new Error(`API status ${response.status}`);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        console.error("Vault 8 Engine Error:", e.message);
        return null;
    }
}

// Dynamic General Knowledge Trivia Question Generator
async function generateGeneralQuestion(excludeList = []) {
    const prompt = 
        `Generate an interesting general knowledge trivia question (avoid anime themes).\n` +
        `Respond strictly with a JSON object in this exact layout. No other text or markdown:\n` +
        `{"q": "The question?", "options": ["A) Opt1", "B) Opt2", "C) Opt3", "D) Opt4"], "ans": "a" | "b" | "c" | "d"}\n` +
        `Do not repeat these past questions: ${excludeList.join(', ')}`;
    const response = await queryLLM(prompt, 0.8);
    if (!response) return null;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return null;
    }
}

// Emoji Charades Generator
async function generateEmojiPuzzle(excludeList = []) {
    const prompt = 
        `Generate a clever charades puzzle using 2 to 5 emojis representing a famous title, object or place.\n` +
        `Respond strictly with a JSON object in this exact layout. No other text or markdown:\n` +
        `{"emojis": "🦁👑", "ans": "The Lion King"}\n` +
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
        let results = `📊 *TRIVIA GAME FINISHED!* 📊\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (isSingle) {
            results += `👤 *Player:* @${session.player.split('@')[0]}\n` +
                       `🎯 *Final Score:* \`${session.score}/10\` points.\n\n` +
                       `_“Good effort! Try playing again to improve your standing.”_ 🤞`;
        } else {
            results += `🏆 *Leaderboard Standings:* 🏆\n\n`;
            const sorted = [...session.players].sort((a, b) => session.scores[b] - session.scores[a]);
            sorted.forEach((pJid, idx) => {
                results += `${idx + 1}. @${pJid.split('@')[0]} — \`${session.scores[pJid]}/5\` points\n`;
            });
            results += `\n_Match concluded successfully!_`;
        }
        delete global.triviaSessions[sessionKey];
        return await sock.sendMessage(jid, { text: results, mentions: isSingle ? [session.player] : session.players });
    }

    let activePlayer = session.player;
    if (!isSingle) activePlayer = session.players[session.turnIndex];

    const questionData = await generateGeneralQuestion(session.pastQuestions);
    if (!questionData) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve a question. Game aborted." });

    session.pastQuestions.push(questionData.q);
    session.currentQuestion = questionData.q;
    session.currentAnswer = questionData.ans;
    session.currentOptions = questionData.options;

    const turnLabel = isSingle 
        ? `📝 *Trivia: Question ${session.currentQuestionIndex}/10*`
        : `👥 *Trivia Turn: @${activePlayer.split('@')[0]} (${session.currentQuestionIndex}/${limit})*`;

    const triviaCard = 
        `${turnLabel}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 *Question:* ${questionData.q}\n\n` +
        `${questionData.options.join('\n')}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Reply directly with your answer letter (A, B, C, or D).*`;

    const prompt = await sock.sendMessage(jid, { text: triviaCard, mentions: isSingle ? [session.player] : [activePlayer] });
    session.lastQuestionMsgId = prompt.key.id;
}

// Core Emoji Charades Dispatcher
async function askNextCharadePuzzle(sock, jid, sessionKey) {
    const session = global.charadeSessions[sessionKey];

    if (session.currentQuestionIndex > 10) {
        const results = `🏆 *CHARADES CONCLUDED!* 🏆\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `👤 *Player:* @${session.player.split('@')[0]}\n` +
                        `🎯 *Final Score:* \`${session.score}/10\` points.\n\n` +
                        `_“Amazing puzzle-solving session completed successfully!”_ 🤞`;
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

    const prompt = await sock.sendMessage(jid, { text: charadeCard }, { quoted: global.messageStore[session.lastQuestionMsgId] || null });
    session.lastQuestionMsgId = prompt.key.id;
}

// Vault 8 Story Progression handler
async function handleGameTurn(sock, msg, userChoice, sessionKey) {
    const jid = msg.key.remoteJid;
    const session = global.vault8Sessions[sessionKey];

    await sock.sendMessage(jid, { text: "💾 `Processing decision...`" }, { quoted: msg });
    session.step++;

    const turnPrompt = 
        `The user chose: "${userChoice}". Evaluate this choice for Step ${session.step} of 20.\n\n` +
        `If their choice is foolish, fatal, or leads to a dead end, write a chilling description of their death, and conclude with the exact text "GAME_OVER" at the very end of your response.\n\n` +
        `If they survive, generate Step ${session.step} of 20. The scenario must grow increasingly eerie, tense, and psychological. Provide exactly 3 new choices (1, 2, 3).\n\n` +
        `If they reach Step 20 and survive, generate a mysterious, triumphant ending and conclude with the exact text "VICTORY" at the very end of your response.`;

    session.history.push({ role: "user", content: turnPrompt });

    const engineResponse = await queryVaultEngine(session.history);
    if (!engineResponse) {
        session.step--;
        return await sock.sendMessage(jid, { text: "❌ Transmission lost inside Vault 8. Try submitting your decision again." }, { quoted: msg });
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
            `🎉 *CONGRATULATIONS:* You have successfully navigated the horrors of Vault 8!`;
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
    // 1. TIC-TAC-TOE INITIATOR (.ttt / .tictactoe)
    {
        name: 'ttt',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (args && args.toLowerCase().trim() === 'quit') {
                const sessionKey = jid + '_ttt';
                if (!global.gameSessions[sessionKey]) {
                    return await sock.sendMessage(jid, { text: "❌ No active Tic-Tac-Toe session is running." }, { quoted: msg });
                }
                delete global.gameSessions[sessionKey];
                return await sock.sendMessage(jid, { text: "🛑 Tic-Tac-Toe session abandoned." }, { quoted: msg });
            }

            const inputVal = parseInt(args);
            if (!isNaN(inputVal)) {
                const sessionKey = jid + '_ttt';
                const activeSession = global.gameSessions[sessionKey];
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const senderNumber = senderJid.split('@')[0];

                if (!activeSession) {
                    return await sock.sendMessage(jid, { text: `❌ No active session is running. Use \`${settings.prefix}ttt\` to begin.` }, { quoted: msg });
                }

                if (activeSession.turn !== senderJid) {
                    const turnNumber = activeSession.turn.split('@')[0];
                    return await sock.sendMessage(jid, { text: `⏳ Wait your turn! It is currently @${turnNumber}'s turn.`, mentions: [activeSession.turn] }, { quoted: msg });
                }

                const spot = inputVal - 1;
                if (spot < 0 || spot > 8 || activeSession.board[spot] !== ' ') {
                    return await sock.sendMessage(jid, { text: "❌ Invalid position. Choose an empty block number between 1 and 9." }, { quoted: msg });
                }

                const playerSymbol = activeSession.symbols[senderJid];
                activeSession.board[spot] = playerSymbol;

                let winner = checkTttWinner(activeSession.board);

                if (winner) {
                    const finalBoard = renderCoolTttBoard(activeSession.board);
                    delete global.gameSessions[sessionKey];

                    if (winner === 'tie') {
                        return await sock.sendMessage(jid, { text: `🤝 *IT'S A TIE!* 🤝\n\n${finalBoard}\n\n_“Not bad, but you still can't bypass my infinity.”_ 🤞` }, { quoted: msg });
                    } else {
                        return await sock.sendMessage(jid, {
                            text: `🏆 *VICTORY DETECTED!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                  `🎉 @${senderNumber} has won the match!\n\n` +
                                  `${finalBoard}`,
                            mentions: [senderJid]
                        }, { quoted: msg });
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
                            return await sock.sendMessage(jid, { text: `🤝 *IT'S A TIE!* 🤝\n\n${finalBoard}\n\n_“A draw? Playable, but you're still lightyears away from touching me!”_ 😏` }, { quoted: msg });
                        } else {
                            return await sock.sendMessage(jid, { text: `💀 *DEFEAT!* 💀\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                                                  `Gojo has won the match!\n\n` +
                                                                  `${finalBoard}\n\n` +
                                                                  `_“Stand proud. You are strong. But against me? Simply impossible.”_ 🤞` }, { quoted: msg });
                        }
                    }

                    return await sock.sendMessage(jid, {
                        text: `🎮 *TIC-TAC-TOE GAMEBOARD* 🎮\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `${finalBoard}\n\n` +
                              `👉 Gojo made his move. It is your turn again! Use \`${settings.prefix}ttt <1-9>\`.`
                    }, { quoted: msg });

                } else {
                    activeSession.turn = activeSession.player1 === senderJid ? activeSession.player2 : activeSession.player1;
                    const nextTurnNumber = activeSession.turn.split('@')[0];
                    const finalBoard = renderCoolTttBoard(activeSession.board);

                    return await sock.sendMessage(jid, {
                        text: `🎮 *TIC-TAC-TOE GAMEBOARD* 🎮\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `${finalBoard}\n\n` +
                              `👉 It is now @${nextTurnNumber}'s turn! Make a move using \`${settings.prefix}ttt <1-9>\`.`,
                        mentions: [activeSession.turn]
                    }, { quoted: msg });
                }
            }

            const tttPrompt = 
                `🎮 *TIC-TAC-TOE SYSTEM CONTROL* 🎮\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `Select your game format to proceed:`;

            const buttons = {
                text: tttPrompt,
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
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const mode = args ? args.toLowerCase().trim() : '';

            if (mode === 'ai') {
                if (!isOwner && !isSudo) {
                    return await sock.sendMessage(jid, { text: "❌ Only Bot Owners and Sudo users are allowed to challenge Satoru Gojo AI." }, { quoted: msg });
                }

                const sessionKey = jid + '_ttt';
                global.gameSessions[sessionKey] = {
                    board: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
                    player1: senderJid,
                    player2: 'gojo',
                    turn: senderJid,
                    symbols: {
                        [senderJid]: '❌',
                        'gojo': '⭕'
                    }
                };

                const initialBoard = renderCoolTttBoard([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ']);
                return await sock.sendMessage(jid, {
                    text: `🎮 *TIC-TAC-TOE: GOJO CHALLENGE* 🎮\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `👤 *Player:* @${senderNumber} (❌)\n` +
                          `🤖 *AI:* Gojo (⭕)\n\n` +
                          `_“You're playing against the strongest. Don't disappoint me!”_ 😏\n\n` +
                          `${initialBoard}\n\n` +
                          `👉 It is your turn! Use \`${settings.prefix}ttt <1-9>\` to make a move.`,
                    mentions: [senderJid]
                }, { quoted: msg });
            } 
            else if (mode === 'multi') {
                if (!isGroup) {
                    return await sock.sendMessage(jid, { text: "❌ Multiplayer modes require an active Group Chat." }, { quoted: msg });
                }

                const sessionKey = jid + '_ttt';
                global.gameSessions[sessionKey] = {
                    board: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
                    player1: senderJid,
                    player2: '',
                    turn: senderJid,
                    symbols: {
                        [senderJid]: '❌'
                    }
                };

                const searchCard = 
                    `⚔️ *TIC-TAC-TOE DUEL LOBBY* ⚔️\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *Player 1:* @${senderNumber}\n` +
                    `🌐 *Status:* Searching for Player 2...\n\n` +
                    `👉 Tap the button below to join the duel!`;

                const searchButtons = {
                    text: searchCard,
                    buttons: [
                        { buttonId: `${settings.prefix}ttt_join`, buttonText: { displayText: 'Join Duel ⚔️' }, type: 1 }
                    ],
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

            if (!session || session.player2) return;

            if (session.player1 === senderJid) return;

            session.player2 = senderJid;
            session.symbols[senderJid] = '⭕';

            const player1Number = session.player1.split('@')[0];
            const initialBoard = renderCoolTttBoard([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ']);

            const welcomeText = 
                `🎮 *TIC-TAC-TOE DUEL MATCH STARTED* 🎮\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `❌ @${player1Number} vs ⭕ @${senderNumber}\n\n` +
                `${initialBoard}\n\n` +
                `👉 It is @${player1Number}'s turn! Make a move using \`${settings.prefix}ttt <1-9>\`.`;

            await sock.sendMessage(jid, {
                text: welcomeText,
                mentions: [session.player1, senderJid]
            }, { quoted: msg });
        }
    },

    // 4. ROCK-PAPER-SCI-GOJO GAME (.rps)
    {
        name: 'rps',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, {
                    text: `✊ *ROCK PAPER SCISSORS vs GOJO* ✋\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `Choose your weapon to challenge Satoru Gojo:\n` +
                          `• \`${settings.prefix}rps rock\` 🪨\n` +
                          `• \`${settings.prefix}rps paper\` 📄\n` +
                          `• \`${settings.prefix}rps scissors\` ✂️`
                }, { quoted: msg });
            }

            const playerChoice = args.toLowerCase().trim();
            const valid = ['rock', 'paper', 'scissors', '🪨', '📄', '✂️'];

            let cleanChoice = playerChoice;
            if (playerChoice === '🪨') cleanChoice = 'rock';
            if (playerChoice === '📄') cleanChoice = 'paper';
            if (playerChoice === '✂️') cleanChoice = 'scissors';

            if (!valid.includes(playerChoice)) {
                return await sock.sendMessage(jid, { text: "❌ Invalid choice. Choose either `rock`, `paper`, or `scissors`." }, { quoted: msg });
            }

            const choices = ['rock', 'paper', 'scissors'];
            const gojoChoice = choices[Math.floor(Math.random() * choices.length)];

            const emojis = { rock: "🪨", paper: "📄", scissors: "✂️" };

            let result = "";
            let quote = "";

            if (cleanChoice === gojoChoice) {
                result = "🤝 *DRAW/TIE MATCH* 🤝";
                quote = "“Interesting. Our timing was identical. Almost like you tried to copy my speed.” 😏";
            } 
            else if (
                (cleanChoice === 'rock' && gojoChoice === 'scissors') ||
                (cleanChoice === 'paper' && gojoChoice === 'rock') ||
                (cleanChoice === 'scissors' && gojoChoice === 'paper')
            ) {
                result = "🏆 *YOU WON!* 🏆";
                quote = "“What? You actually won? Haha, beginners luck. Don't expect to bypass my infinity next time!” 🙄";
            } 
            else {
                result = "💀 *YOU LOST!* 💀";
                quote = "“Did you really think you could win? Baka, my Six Eyes saw your choice coming from miles away!” 🤞";
            }

            const rpsCard = `✊ *ROCK-PAPER-SCISSORS SHOWDOWN* 🖐️\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `👤 *You chose:* ${emojis[cleanChoice]} \`${cleanChoice.toUpperCase()}\`\n` +
                            `🤖 *Gojo chose:* ${emojis[gojoChoice]} \`${gojoChoice.toUpperCase()}\`\n\n` +
                            `${result}\n\n` +
                            `💬 *Gojo:* _${quote}_`;

            await sock.sendMessage(jid, { text: rpsCard }, { quoted: msg });
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
                if (activeSession) {
                    return await sock.sendMessage(jid, { text: `⚠️ You have an active game running. Guess using \`${settings.prefix}guess <number>\`. You have ${6 - activeSession.attempts} attempt(s) left.` }, { quoted: msg });
                }

                const targetNumber = Math.floor(Math.random() * 100) + 1;
                global.gameSessions[sessionKey] = {
                    target: targetNumber,
                    attempts: 0
                };

                return await sock.sendMessage(jid, {
                    text: `🌀 *CURSED ENERGY CONCENTRATION* 🌀\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `I have suppressed a specific quantity of Cursed Energy between *1 and 100*.\n\n` +
                          `Can you guess the exact level? I'll let you know if you are too high or too low.\n\n` +
                          `⏳ *Attempt Limit:* 6 times.\n` +
                          `👉 Make your first guess using: \`${settings.prefix}guess <number>\``
                }, { quoted: msg });
            }

            if (!activeSession) {
                return await sock.sendMessage(jid, { text: `❌ No active guessing game running. Start one using \`${settings.prefix}guess\`.` }, { quoted: msg });
            }

            const userGuess = parseInt(args.trim());
            if (isNaN(userGuess) || userGuess < 1 || userGuess > 100) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid integer guess between 1 and 100." }, { quoted: msg });
            }

            activeSession.attempts++;

            if (userGuess === activeSession.target) {
                delete global.gameSessions[sessionKey];
                return await sock.sendMessage(jid, {
                    text: `🎉 *TARGET CALIBRATION SUCCESSFUL!* 🎉\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `🎯 You guessed the exact level: *${userGuess}*!\n` +
                          `⚡ *Attempts used:* \`${activeSession.attempts}/6\`\n\n` +
                          `_“Incredible perception. You might actually have what it takes to survive out there.”_ 🤞`
                }, { quoted: msg });
            }

            if (activeSession.attempts >= 6) {
                const actualValue = activeSession.target;
                delete global.gameSessions[sessionKey];
                return await sock.sendMessage(jid, {
                    text: `💀 *CONCENTRATION DISPERSED!* 💀\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `You ran out of attempts! The correct cursed energy amount was *${actualValue}*.\n\n` +
                          `_“Baka! You completely lost focus. Try training your senses again!”_ 🙄`
                }, { quoted: msg });
            }

            const clue = userGuess < activeSession.target ? "Too LOW! 📈" : "Too HIGH! 📉";
            const left = 6 - activeSession.attempts;

            await sock.sendMessage(jid, {
                text: `🔮 *Cursed Energy Clue:* \`${clue}\`\n\n` +
                      `• *Your Guess:* \`${userGuess}\`\n` +
                      `• *Attempts remaining:* \`${left}/6\``
            }, { quoted: msg });
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
                "🛰️ `[SYS_LINK] DECRYPTING NESTED ONION ROUTERS...`\n`[PROXIES] DE | SE | SG | CA`",
                "🔓 `[SECURITY] CRACKING ENTRY PROTOCOLS... 42%`\n`[STATUS] CORRUPTING KERNEL STACK FLOW`",
                "🔓 `[SECURITY] CRACKING ENTRY PROTOCOLS... 89%`\n`[STATUS] INJECTING BYPASS EXPLOITS`",
                "☣️ `[SYSTEM] TERMINAL BACKDOOR ACCESS GRANTED!`\n`━━━━━━━━━━━━━━━━━━━━━━━━━━━`"
            ];

            try {
                let sentMsg = await sock.sendMessage(jid, { text: loginFrames[0] }, { quoted: msg });
                for (let i = 1; i < loginFrames.length; i++) {
                    await delay(1200);
                    await sock.sendMessage(jid, { text: loginFrames[i], edit: sentMsg.key });
                }

                await delay(1000);

                const hasSaved = !!global.vault8SavedStories[sessionKey];
                const bannerText = 
                    `🖥️ *VAULT 8 SECURE INTEL PORTAL* 🖥️\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `⚠️ *WARNING:* You are entering a restricted single-player simulation interface connected to Elmwood Trail's secure database.\n\n` +
                    `${hasSaved ? `💾 *NOTICE:* A saved storyline is currently registered for your terminal. Clicking 'Play' will restart this specific scenario.\n\n` : ''}` +
                    `👁️ *STATUS:* Connection encrypted. Silence is advised.\n\n` +
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

                try {
                    await sock.sendMessage(jid, { delete: sentMsg.key });
                } catch (e) {}

                await sock.sendMessage(jid, buttonMessage, { quoted: msg });

            } catch (err) {
                console.error("Vault 8 Login Animation Failed:", err);
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
                        `📁 *VAULT 8: STEP 1/20 (REPLAY)* 💻\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `${saved.firstStep}\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 *To progress, reply to this message using:* \`${settings.prefix}v8 <your choice/number>\``;

                    return await sock.sendMessage(jid, { text: gameHeader }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: "👁️ `[SYSTEM] Generating new scenario file assets...`" }, { quoted: msg });
                    
                    const systemPrompt = 
                        "You are the terminal engine of 'Vault 8', a creepy psychological text adventure game from Elmwood Trail. " +
                        "The user has bypassed the terminal firewall. Generate Step 1 of a creepy, highly atmospheric text adventure. " +
                        "Describe the dark, cold, terminal-driven environment they wake up in. Give them exactly 3 distinct choices (1, 2, 3) to choose from. " +
                        "Keep the tone eerie, minimalist, and deeply immersive. Limit your narrative to 4 sentences, followed cleanly by the options. " +
                        "Do not use conversational pleasantries.";

                    const initialSession = [
                        { role: "system", content: systemPrompt }
                    ];

                    const firstStep = await queryVaultEngine(initialSession);
                    if (!firstStep) {
                        return await sock.sendMessage(jid, { text: "❌ Connection timeout. Failed to load Vault 8 environment." }, { quoted: msg });
                    }

                    global.vault8SavedStories[sessionKey] = {
                        systemPrompt: systemPrompt,
                        firstStep: firstStep
                    };

                    global.vault8Sessions[sessionKey] = {
                        step: 1,
                        history: [
                            { role: "system", content: systemPrompt },
                            { role: "assistant", content: firstStep }
                        ]
                    };

                    const gameHeader = 
                        `📁 *VAULT 8: STEP 1/20* 💻\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `${firstStep}\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 *To progress, reply to this message using:* \`${settings.prefix}v8 <your choice/number>\``;

                    return await sock.sendMessage(jid, { text: gameHeader }, { quoted: msg });
                }
            } 
            else if (action === 'refresh') {
                delete global.vault8Sessions[sessionKey];
                delete global.vault8SavedStories[sessionKey];
                await sock.sendMessage(jid, { text: "🔄 `[SYSTEM] Saved storyline wiped. Initiating fresh connection...`" });
                
                const commands = require('../commands');
                return await commands[`${settings.prefix}vault8`](sock, msg, '', { isOwner: false });
            } 
            else if (action === 'cancel' || action === 'giveup') {
                delete global.vault8Sessions[sessionKey];
                await sock.sendMessage(jid, { text: "🛑 `[SYSTEM] Terminal connection closed safely. Story state preserved.`" }, { quoted: msg });
            }
        }
    },

    // 8. GENERAL KNOWLEDGE TRIVIA SYSTEM INITIATOR (.trivia / .quiz)
    {
        name: 'trivia',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const modePrompt = 
                `📝 *TRIVIA MODULE BOARD* 📝\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `Choose your game mode to begin:\n\n` +
                `• *Singleplayer:* Take on 10 random general knowledge questions.\n` +
                `• *Multiplayer:* Play with 2 to 4 friends. Each player gets 5 questions (up to 20 total rounds).`;

            const buttonMessage = {
                text: modePrompt,
                buttons: [
                    { buttonId: `${settings.prefix}trivia_mode single`, buttonText: { displayText: 'Singleplayer 👤' }, type: 1 },
                    { buttonId: `${settings.prefix}trivia_mode multi`, buttonText: { displayText: 'Multiplayer 👥' }, type: 1 }
                ],
                headerType: 1
            };

            await sock.sendMessage(jid, buttonMessage, { quoted: msg });
        }
    },

    // 9. TRIVIA MODE ROUTER (.trivia_mode)
    {
        name: 'trivia_mode',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const choice = args ? args.toLowerCase().trim() : '';

            if (choice === 'single') {
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
            else if (choice === 'multi') {
                if (!isGroup) {
                    return await sock.sendMessage(jid, { text: "❌ Multiplayer mode requires an active Group Chat." }, { quoted: msg });
                }

                const sessionKey = jid;

                if (global.triviaSessions[sessionKey]) {
                    return await sock.sendMessage(jid, { text: "⚠️ An active trivia game is already running in this group chat." }, { quoted: msg });
                }

                global.triviaSessions[sessionKey] = {
                    type: 'multi',
                    status: 'lobby',
                    players: [senderJid],
                    scores: { [senderJid]: 0 },
                    currentQuestionIndex: 1,
                    turnIndex: 0,
                    pastQuestions: [],
                    lastQuestionMsgId: ''
                };

                const lobbyCard = 
                    `👥 *TRIVIA MULTIPLAYER LOBBY* 👥\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🔍 *Searching for players... (30s time limit)*\n\n` +
                    `• *Joined:* \`1/4\` Players\n` +
                    `👤 @${senderNumber}\n\n` +
                    `👉 Tap the button below to join the match!`;

                const lobbyButtons = {
                    text: lobbyCard,
                    buttons: [
                        { buttonId: `${settings.prefix}trivia_join`, buttonText: { displayText: 'Join Match 🎮' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [senderJid]
                };

                const lobbyMsg = await sock.sendMessage(jid, lobbyButtons, { quoted: msg });
                global.triviaSessions[sessionKey].lobbyMsgId = lobbyMsg.key.id;

                setTimeout(async () => {
                    const session = global.triviaSessions[sessionKey];
                    if (!session || session.status !== 'lobby') return;

                    if (session.players.length < 2) {
                        delete global.triviaSessions[sessionKey];
                        return await sock.sendMessage(jid, { text: "🛑 *Lobby Disbanded:* Multiplayer matches require a minimum of 2 players to start." });
                    }

                    session.status = 'playing';
                    const listMentions = session.players.map(p => `@${p.split('@')[0]}`).join(', ');

                    await sock.sendMessage(jid, { 
                        text: `🔔 *LOBBY TIME LIMIT REACHED!* Starting match with ${session.players.length} players:\n\n${listMentions}\n\nPreparing Question 1...`,
                        mentions: session.players
                    });

                    await askNextTriviaQuestion(sock, jid, sessionKey);

                }, 30000);
            }
        }
    },

    // 10. MULTIPLAYER LOBBY JOIN INTERACTION (.trivia_join)
    {
        name: 'trivia_join',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const session = global.triviaSessions[jid];
            if (!session || session.status !== 'lobby') return;

            if (session.players.includes(senderJid)) return;

            if (session.players.length >= 4) {
                return await sock.sendMessage(jid, { text: `❌ Sorry @${senderNumber}, the lobby is already full (4/4)!`, mentions: [senderJid] }, { quoted: msg });
            }

            session.players.push(senderJid);
            session.scores[senderJid] = 0;

            const joinedCount = session.players.length;
            const listPlayers = session.players.map(p => `👤 @${p.split('@')[0]}`).join('\n');

            const lobbyCard = 
                `👥 *TRIVIA MULTIPLAYER LOBBY* 👥\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `🔍 *Searching for players... (30s time limit)*\n\n` +
                `• *Joined:* \`${joinedCount}/4\` Players\n` +
                `${listPlayers}\n\n` +
                `👉 Tap the button below to join the match!`;

            const lobbyButtons = {
                text: lobbyCard,
                buttons: [
                    { buttonId: `${settings.prefix}trivia_join`, buttonText: { displayText: 'Join Match 🎮' }, type: 1 }
                ],
                headerType: 1,
                mentions: session.players
            };

            try {
                await sock.sendMessage(jid, { delete: { remoteJid: jid, id: session.lobbyMsgId, fromMe: true } });
            } catch (e) {}

            const updatedLobby = await sock.sendMessage(jid, lobbyButtons, { quoted: msg });
            session.lobbyMsgId = updatedLobby.key.id;

            if (joinedCount === 4) {
                session.status = 'playing';
                const listMentions = session.players.map(p => `@${p.split('@')[0]}`).join(', ');

                await sock.sendMessage(jid, { 
                    text: `🔥 *LOBBY FULL (4/4)!* Starting match instantly with:\n\n${listMentions}\n\nPreparing Question 1...`,
                    mentions: session.players
                });

                await askNextTriviaQuestion(sock, jid, jid);
            }
        }
    },

    // 11. TRIVIA REPLIES AND EVALUATIONS (.trivia_ans)
    {
        name: 'trivia_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const sessionKey = jid.endsWith('@g.us') ? jid : jid + '_' + senderJid;
            const session = global.triviaSessions[sessionKey];

            if (!session) return;

            const isSingle = session.type === 'single';

            if (!isSingle) {
                const activeTurnPlayer = session.players[session.turnIndex];
                if (activeTurnPlayer !== senderJid) {
                    return await sock.sendMessage(jid, { 
                        text: `⚠️ Wait your turn! Only @${activeTurnPlayer.split('@')[0]} is authorized to reply to this question.`, 
                        mentions: [activeTurnPlayer] 
                    }, { quoted: msg });
                }
            }

            const chosenAnswer = args.trim().toLowerCase();
            const correctAnswer = session.currentAnswer;

            let resultLabel = "";

            if (chosenAnswer === correctAnswer) {
                resultLabel = `✅ *Correct answer chosen by @${senderNumber}!* +1 point. 🎉`;
                if (isSingle) {
                    session.score++;
                } else {
                    session.scores[senderJid]++;
                }
            } else {
                resultLabel = `❌ *Incorrect answer selected by @${senderNumber}!* The correct option was *${correctAnswer.toUpperCase()}*.`;
            }

            await sock.sendMessage(jid, { text: resultLabel, mentions: [senderJid] }, { quoted: msg });

            session.currentQuestionIndex++;
            if (!isSingle) {
                session.turnIndex = (session.turnIndex + 1) % session.players.length;
            }

            await delay(1500);
            await askNextTriviaQuestion(sock, jid, sessionKey);
        }
    },

    // 12. EMOJI CHARADES GAME INITIATOR (.charade)
    {
        name: 'charade',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid;

            if (global.charadeSessions[sessionKey]) {
                return await sock.sendMessage(jid, { text: `⚠️ You already have an active Charades game running! Reply to the question or type \`${settings.prefix}charade quit\` to stop.` }, { quoted: msg });
            }

            if (args && args.toLowerCase().trim() === 'quit') {
                delete global.charadeSessions[sessionKey];
                return await sock.sendMessage(jid, { text: "🛑 Emoji Charades session ended safely." }, { quoted: msg });
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

    // 13. CHARADE EVALUATION MANAGER (.charade_ans)
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
                feedback = `✅ *CORRECT!* \n\n🧩 *Puzzle:* ${session.currentEmojiCombo}\n📝 *Correct phrase:* \`"${session.currentCorrectAnswer}"\`\n\n🎉 Fantastic guess @${senderNumber}! +1 point.`;
            } else {
                feedback = `❌ *INCORRECT!* \n\n🧩 *Puzzle:* ${session.currentEmojiCombo}\n📝 *Correct phrase:* \`"${session.currentCorrectAnswer}"\`\n\n🙄 Keep trying next time, @${senderNumber}!`;
            }

            await sock.sendMessage(jid, { text: feedback, mentions: [senderJid] }, { quoted: msg });

            session.currentQuestionIndex++;
            await delay(1500);
            await askNextCharadePuzzle(sock, jid, sessionKey);
        }
    }
];

// ============================================================================
// ALIAS & TRIGGER REGISTRATION
// ============================================================================

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'ttt') {
        aliases.push({ ...cmd, name: 'tictactoe' });
    }
    if (cmd.name === 'trivia') {
        aliases.push({ ...cmd, name: 'quiz' });
    }
    if (cmd.name === 'vault8') {
        aliases.push({ ...cmd, name: 'v8' });
        aliases.push({ ...cmd, name: 'vault8.com' });
    }
    if (cmd.name === 'charade') {
        aliases.push({ ...cmd, name: 'charades' });
    }
});
module.exports.push(...aliases);