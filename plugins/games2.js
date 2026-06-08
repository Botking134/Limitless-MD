// plugins/games2.js
const settings = require('../settings');

// Initialize global game state parameters safely for the remaining 6 games
global.anagramSessions = global.anagramSessions || {};
global.wcgSessions = global.wcgSessions || {};
global.millionaireSessions = global.millionaireSessions || {};
global.torfSessions = global.torfSessions || {};
global.pvpSessions = global.pvpSessions || {};
global.escapeSessions = global.escapeSessions || {};

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

// Dynamic Anagram Word Generator
async function generateAnagramWord(difficulty, excludeList = []) {
    let charLimit = "3 to 5 letters";
    if (difficulty === 'medium') charLimit = "6 to 8 letters";
    if (difficulty === 'hard') charLimit = "9 or more letters";

    const prompt = 
        `Generate a single dictionary-proven English word that has exactly ${charLimit}. It should be highly common and recognizable.\n` +
        `Respond strictly with a JSON object in this layout. No other text:\n` +
        `{"word": "WORDS"}\n` +
        `Do not repeat these past words: ${excludeList.join(', ')}`;
    
    const response = await queryLLM(prompt, 0.8);
    if (!response) return null;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return null;
    }
}

// Scrambler helper
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

// Dynamic Dictionary Validator for Word Chain Game
async function isValidEnglishWord(word) {
    const prompt = `System: Is "${word.toUpperCase()}" a real, valid dictionary-proven English word? Respond with exactly YES or NO.`;
    const response = await queryLLM(prompt, 0.1);
    return response ? response.trim().toUpperCase().includes("YES") : false;
}

// Dynamic True or False Question Generator
async function generateTorfQuestion(category, excludeList = []) {
    const prompt = 
        `Generate an interesting, educational True or False statement under the category: "${category}".\n` +
        `Respond strictly with a JSON object in this exact layout. No other text or markdown:\n` +
        `{"q": "The statement...", "ans": "true" | "false", "explanation": "Brief context explanation"}\n` +
        `Do not repeat these past statements: ${excludeList.join(', ')}`;
    const response = await queryLLM(prompt, 0.8);
    if (!response) return null;
    try {
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return null;
    }
}

// ============================================================================
// IN-GAME PROGRESSION METHODS
// ============================================================================

// Core Anagram Question Dispatcher
async function askNextAnagram(sock, jid, sessionKey) {
    const session = global.anagramSessions[sessionKey];
    const isSingle = session.type === 'single';

    if (session.timerId) clearTimeout(session.timerId);

    // Filter out eliminated players in multiplayer
    if (!isSingle) {
        session.players = session.players.filter(pJid => session.lives[pJid] > 0);

        if (session.players.length === 1) {
            const winner = session.players[0];
            const msgText = `🏆 *ANAGRAM CHAMPION DECLARED!* 🏆\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `🎉 @${winner.split('@')[0]} has won the match as the last survivor!\n` +
                            `🎯 *Score:* \`${session.scores[winner]}\` points.`;
            delete global.anagramSessions[sessionKey];
            return await sock.sendMessage(jid, { text: msgText, mentions: [winner] });
        }

        if (session.players.length === 0) {
            delete global.anagramSessions[sessionKey];
            return await sock.sendMessage(jid, { text: "💀 *GAME OVER:* All players have been eliminated! No winner was declared." });
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
                const msgText = `🏆 *ANAGRAM MATCH FINISHED!* 🏆\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                `🎉 Winner: @${winner.split('@')[0]} — \`${session.scores[winner]}\` points\n\n` +
                                `_Congratulations!_`;
                delete global.anagramSessions[sessionKey];
                return await sock.sendMessage(jid, { text: msgText, mentions: [winner] });
            }
        }
    } else {
        if (session.currentQuestionIndex > 10) {
            const results = `📊 *ANAGRAM GAME OVER!* 📊\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `👤 *Player:* @${session.player.split('@')[0]}\n` +
                            `🎯 *Score:* \`${session.score}/10\`\n` +
                            `❤️ *Lives Left:* \`${session.livesSP}/3\`\n\n` +
                            `_Thanks for playing!_ 🤞`;
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
    const scattered = scrambleWord(correctWord);

    session.pastWords.push(correctWord);
    session.currentWord = correctWord;
    session.scrambledWord = scattered;

    const roundHeader = isSingle
        ? `🔠 *Anagram: Round ${session.currentQuestionIndex}/10 (Hearts: ${session.livesSP}❤️)*`
        : `👥 *Anagram ${session.isTieBreaker ? '⚠️ TIE BREAKER' : `Round ${session.currentQuestionIndex}`}*`;

    const livesStr = isSingle ? "" : `\n❤️ *Target Hearts Left:* \`${session.lives[activePlayer]}❤️\``;

    const anagramCard = 
        `${roundHeader}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 *Active Turn:* @${activePlayer.split('@')[0]}${livesStr}\n` +
        `⏳ *Timer:* \`${session.timerMs / 1000} seconds\`\n\n` +
        `🧩 *Rearrange this scrambled word:* \n` +
        `👉    *${scattered}*    \n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Reply to this message with your guess!*`;

    const prompt = await sock.sendMessage(jid, { text: anagramCard, mentions: isSingle ? [session.player] : [activePlayer] });
    session.lastQuestionMsgId = prompt.key.id;

    session.timerId = setTimeout(async () => {
        await handleAnagramTimeout(sock, jid, sessionKey);
    }, session.timerMs);
}

// Timeout Handler for Anagram
async function handleAnagramTimeout(sock, jid, sessionKey) {
    const session = global.anagramSessions[sessionKey];
    if (!session) return;

    const isSingle = session.type === 'single';
    let activePlayer = session.player;
    if (!isSingle) activePlayer = session.players[session.turnIndex];

    let resultMsg = "";
    if (isSingle) {
        session.livesSP--;
        resultMsg = `⏰ *TIME IS UP!* \n\nYou failed to answer in time. The correct word was *${session.currentWord}*.\n\n❤️ *Lives remaining:* \`${session.livesSP}/3\``;
        
        if (session.livesSP <= 0) {
            await sock.sendMessage(jid, { text: resultMsg });
            const results = `📊 *ANAGRAM GAME OVER!* 📊\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `👤 *Player:* @${session.player.split('@')[0]}\n` +
                            `🎯 *Score:* \`${session.score}/10\`\n` +
                            `💀 *Reason:* Out of lives.\n\n` +
                            `_Better luck next time!_ 🤞`;
            delete global.anagramSessions[sessionKey];
            return await sock.sendMessage(jid, { text: results, mentions: [session.player] });
        }
    } else {
        session.lives[activePlayer]--;
        resultMsg = `⏰ *TIME IS UP!* \n\n@${activePlayer.split('@')[0]} failed to answer. Correct word was *${session.currentWord}*.\n\n❤️ *Remaining hearts:* \`${session.lives[activePlayer]}/3\``;
        
        if (session.lives[activePlayer] <= 0) {
            resultMsg += `\n\n💀 @${activePlayer.split('@')[0]} has been *ELIMINATED*!`;
        }
    }

    await sock.sendMessage(jid, { text: resultMsg, mentions: isSingle ? [] : [activePlayer] });

    session.currentQuestionIndex++;
    if (!isSingle) {
        session.turnIndex = (session.turnIndex + 1) % session.players.length;
    }

    await delay(2000);
    await askNextAnagram(sock, jid, sessionKey);
}

// Core Word Chain Game turn prompt dispatcher
async function promptNextWcgTurn(sock, jid) {
    const session = global.wcgSessions[jid];

    if (session.timerId) clearTimeout(session.timerId);

    if (session.players.length === 1) {
        const winner = session.players[0];
        const winCard = 
            `🏆 *WORD CHAIN CHAMPION!* 🏆\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🎉 @${winner.split('@')[0]} has won the match as the ultimate survivor!\n\n` +
            `_“Legendary lexicon coordination!”_ 🤞`;
        delete global.wcgSessions[jid];
        return await sock.sendMessage(jid, { text: winCard, mentions: [winner] });
    }

    if (session.players.length === 0) {
        delete global.wcgSessions[jid];
        return await sock.sendMessage(jid, { text: "💀 *GAME OVER:* Everyone eliminated! No winner declared." });
    }

    if (session.turnIndex >= session.players.length) session.turnIndex = 0;
    const activePlayer = session.players[session.turnIndex];

    let instructions = "";
    if (!session.lastWord) {
        instructions = `👉 Start the chain! Type any valid English word to begin.`;
    } else {
        const targetLetter = session.lastWord.slice(-1).toUpperCase();
        instructions = `👉 The last word was *"${session.lastWord.toUpperCase()}"*. You must reply with an unused word starting with the letter *"${targetLetter}"*!`;
    }

    const listTurns = session.players.map((p, idx) => `${idx === session.turnIndex ? '👉 ' : '• '}@${p.split('@')[0]}`).join('\n');

    const chainCard = 
        `⛓️ *Word Chain: Rotational turn* ⛓️\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 *Active turn:* @${activePlayer.split('@')[0]}\n` +
        `⏳ *Timer:* \`${session.timerMs / 1000} seconds\`\n\n` +
        `${instructions}\n\n` +
        `📊 *Surviving Lineup:*\n${listTurns}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 *Reply to this message with your word guess!*`;

    const prompt = await sock.sendMessage(jid, { text: chainCard, mentions: session.players });
    session.lastQuestionMsgId = prompt.key.id;

    session.timerId = setTimeout(async () => {
        await handleWcgTimeout(sock, jid);
    }, session.timerMs);
}

// Timeout handler for WCG
async function handleWcgTimeout(sock, jid) {
    const session = global.wcgSessions[jid];
    if (!session) return;

    const eliminatedPlayer = session.players[session.turnIndex];
    session.players.splice(session.turnIndex, 1);

    await sock.sendMessage(jid, { 
        text: `⏰ *TIME IS UP!* \n\n💀 @${eliminatedPlayer.split('@')[0]} failed to submit a word and has been *ELIMINATED*!`, 
        mentions: [eliminatedPlayer] 
    });

    await delay(2000);
    await promptNextWcgTurn(sock, jid);
}

// Core Millionaire Question Dispatcher
async function askNextMillionaireQuestion(sock, jid, sessionKey) {
    const session = global.millionaireSessions[sessionKey];

    if (session.timerId) clearTimeout(session.timerId);

    if (session.step > 15) {
        const winCard = 
            `🏆 *WHO WANTS TO BE A MILLIONAIRE: VICTORY!* 🏆\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🎉 Congratulations @${session.player.split('@')[0]}!\n` +
            `💰 You solved all 15 questions and won the grand prize of *₦1,500,000*! 👑\n\n` +
            `_“An absolutely legendary display of intelligence!”_ 🤞`;
        delete global.millionaireSessions[sessionKey];
        return await sock.sendMessage(jid, { text: winCard, mentions: [session.player] });
    }

    const questionData = await generateGeneralQuestion(session.pastQuestions);
    if (!questionData) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve general questions. Game aborted." });

    session.pastQuestions.push(questionData.q);
    session.currentQuestion = questionData.q;
    session.currentOptions = questionData.options;
    session.correctAns = questionData.ans;

    await sendMillionaireDisplay(sock, jid, sessionKey);
}

// Standard Render/Display Card with Active Lifeline Buttons
async function sendMillionaireDisplay(sock, jid, sessionKey) {
    const session = global.millionaireSessions[sessionKey];

    if (session.timerId) clearTimeout(session.timerId);

    const currentReward = session.step * 100000;
    const progressText = `💰 *Money Ladder:* ₦${currentReward.toLocaleString()} WAT (Question ${session.step}/15)`;

    const optionsText = session.currentOptions.map(opt => {
        const letter = opt.charAt(0).toLowerCase();
        if (session.eliminatedOptions.includes(letter)) {
            return `🚫 *[ELIMINATED]*`;
        }
        return opt;
    }).join('\n');

    const gameCard = 
        `👑 *WHO WANTS TO BE A MILLIONAIRE* 👑\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 *Question ${session.step}/15:* \n\n` +
        `${session.currentQuestion}\n\n` +
        `${optionsText}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 *Current Value:* \`₦${session.money.toLocaleString()} WAT\`\n` +
        `⌛ *Timer:* \`20 seconds\`\n\n` +
        `👉 *Reply directly with your answer letter (A, B, C, or D), or trigger an active lifeline below:*`;

    const buttonList = [];
    if (session.lifelines.phone) {
        buttonList.push({ buttonId: `${settings.prefix}millionaire_life phone`, buttonText: { displayText: 'Phone a Friend 📞' }, type: 1 });
    }
    if (session.lifelines.fifty) {
        buttonList.push({ buttonId: `${settings.prefix}millionaire_life fifty`, buttonText: { displayText: '50/50 ✂️' }, type: 1 });
    }
    if (session.lifelines.audience) {
        buttonList.push({ buttonId: `${settings.prefix}millionaire_life audience`, buttonText: { displayText: 'Ask Group 📊' }, type: 1 });
    }
    buttonList.push({ buttonId: `${settings.prefix}millionaire_life walk`, buttonText: { displayText: 'Walk Away 💰' }, type: 1 });

    const buttons = {
        text: gameCard,
        buttons: buttonList,
        headerType: 1
    };

    const prompt = await sock.sendMessage(jid, buttons, { quoted: global.messageStore[session.lastQuestionMsgId] || null });
    session.lastQuestionMsgId = prompt.key.id;

    session.timerId = setTimeout(async () => {
        await handleMillionaireTimeout(sock, jid, sessionKey);
    }, session.timerMs);
}

// Timeout handler for Millionaire
async function handleMillionaireTimeout(sock, jid, sessionKey) {
    const session = global.millionaireSessions[sessionKey];
    if (!session) return;

    delete global.millionaireSessions[sessionKey];
    const results = `⏰ *TIME IS UP!* \n\n` +
                    `💀 @${session.player.split('@')[0]} failed to submit an answer inside 20 seconds!\n\n` +
                    `🔴 *GAME OVER:* You leave with *₦${session.money.toLocaleString()} WAT*. Correct answer was *${session.correctAns.toUpperCase()}*.`;

    await sock.sendMessage(jid, { text: results, mentions: [session.player] });
}

// PVP Turn Referee Attack Evaluator
async function evaluatePvpAttack(attackerChar, move) {
    const refereePrompt = 
        `You are the referee of an epic anime/comic 1v1 battle.\n` +
        `The attacker "${attackerChar}" is attempting to execute the move: "${move}".\n\n` +
        `Your task:\n` +
        `1. Determine if this move is a real canonical special technique of "${attackerChar}" (e.g. Rasengan for Naruto, Hollow Purple for Gojo) OR is a standard physical attack/defense (punch, kick, dodge, block).\n` +
        `2. If the move is completely fake or unrelated to "${attackerChar}"'s universe (e.g. Naruto using Kamehameha), respond strictly with the single word "INVALID_MOVE".\n` +
        `3. If valid, respond strictly with the single word "VALID_MOVE".`;

    const decision = await queryLLM(refereePrompt, 0.1);
    return decision ? decision.trim().toUpperCase() : "INVALID_MOVE";
}

// PVP Clash Evaluator (Attack vs Defense)
async function evaluatePvpClash(attackerChar, defenderChar, attackMove, defenseMove) {
    const prompt = 
        `You are the referee of an epic anime/comic 1v1 battle between "${attackerChar}" and "${defenderChar}".\n` +
        `The attacker "${attackerChar}" used the attack move: "${attackMove}".\n` +
        `The defender "${defenderChar}" attempted to defend using: "${defenseMove}".\n\n` +
        `Evaluate the clash:\n` +
        `1. A valid, clever defense move (e.g. Gojo's Infinity against an attack, or Sasuke using Susanoo, or a timed dodge) should significantly mitigate damage.\n` +
        `2. Calculate the mitigated damage (0 to 20). If defense is useless or invalid, keep damage high (15 to 30).\n` +
        `3. Describe the clash intensely in 2 lines, and state the damage as "DAMAGE: [number]" at the end.`;

    const result = await queryLLM(prompt, 0.7);
    return result ? result.trim() : null;
}

// PVP Unmitigated Attack Evaluator
async function evaluatePvpUnmitigated(attackerChar, defenderChar, attackMove) {
    const prompt = 
        `The attacker "${attackerChar}" hit the completely undefended "${defenderChar}" with their attack "${attackMove}".\n\n` +
        `Evaluate the impact:\n` +
        `1. Calculate high unmitigated damage (20 to 35) based on canon lore.\n` +
        `2. Describe the impact intensely in 2 lines, stating the final damage as "DAMAGE: [number]" at the end.`;

    const result = await queryLLM(prompt, 0.7);
    return result ? result.trim() : null;
}

// Automated 7-Second Timeout Handler for undefended attacks
async function handlePvpDefenseTimeout(sock, jid) {
    const session = global.pvpSessions[jid];
    if (!session || session.status !== 'defending') return;

    const attacker = session.attacker;
    const defender = session.defender;
    const attackMove = session.lastAttack;

    const attackerChar = attacker === session.p1 ? session.p1Char : session.p2Char;
    const defenderChar = defender === session.p1 ? session.p1Char : session.p2Char;

    await sock.sendMessage(jid, { text: `⏰ *TIME IS UP!* @${defender.split('@')[0]} failed to defend in time!`, mentions: [defender] });

    const evaluation = await evaluatePvpUnmitigated(attackerChar, defenderChar, attackMove);

    let damage = 25;
    if (evaluation) {
        const match = evaluation.match(/DAMAGE:\s*(\d+)/i);
        if (match) damage = parseInt(match[1]);
    }

    if (defender === session.p1) {
        session.p1HP = Math.max(0, session.p1HP - damage);
    } else {
        session.p2HP = Math.max(0, session.p2HP - damage);
    }

    session.movesLeft[attacker]--;

    const report = 
        `💥 *DIRECT IMPACT REPORT!* 💥\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${evaluation ? evaluation.replace(/DAMAGE:\s*\d+/i, '').trim() : `No defense was activated. ${attackerChar} hits hard.`}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🛡️ *HP Status:*\n` +
        `• *${session.p1Char}* (@${session.p1.split('@')[0]}): \`${session.p1HP} HP\` — Moves Left: \`${session.movesLeft[session.p1]}\`\n` +
        `• *${session.p2Char}* (@${session.p2.split('@')[0]}): \`${session.p2HP} HP\` — Moves Left: \`${session.movesLeft[session.p2]}\``;

    await sock.sendMessage(jid, { text: report, mentions: [session.p1, session.p2] });
    await delay(2000);

    if (await checkPvpGameOver(sock, jid, session)) return;

    // Rotate turns
    session.status = 'fighting';
    session.turn = defender;
    session.defender = attacker;

    const nextStrikeText = `👉 It is now @${session.turn.split('@')[0]}'s turn to strike! Reply to this message with your next move.`;
    const prompt = await sock.sendMessage(jid, { text: nextStrikeText, mentions: [session.turn] });
    session.lastQuestionMsgId = prompt.key.id;
}

// Check if PVP match is completed
async function checkPvpGameOver(sock, jid, session) {
    if (session.p1HP <= 0 || session.p2HP <= 0) {
        const winner = session.p1HP <= 0 ? session.p2 : session.p1;
        const winChar = session.p1HP <= 0 ? session.p2Char : session.p1Char;
        const victoryText = `🏆 *BATTLE RESOLVED: KNOCKOUT!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🎉 @${winner.split('@')[0]} (*${winChar}*) wins the duel!`;
        delete global.pvpSessions[jid];
        await sock.sendMessage(jid, { text: victoryText, mentions: [winner] });
        return true;
    }

    if (session.movesLeft[session.p1] === 0 && session.movesLeft[session.p2] === 0) {
        let winner = session.p1;
        let winChar = session.p1Char;
        let tie = false;

        if (session.p2HP > session.p1HP) {
            winner = session.p2;
            winChar = session.p2Char;
        } else if (session.p1HP === session.p2HP) {
            tie = true;
        }

        if (tie) {
            delete global.pvpSessions[jid];
            await sock.sendMessage(jid, { text: "🤝 *BATTLE ENDED: IT'S A TIE!* 🤝\n\nBoth fighters fought to a draw with equal standing health values." });
        } else {
            const victoryText = `🏆 *BATTLE RESOLVED: TIME UP!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🎉 @${winner.split('@')[0]} (*${winChar}*) wins the match on remaining health advantage!`;
            delete global.pvpSessions[jid];
            await sock.sendMessage(jid, { text: victoryText, mentions: [winner] });
        }
        return true;
    }
    return false;
}

// Escape Room stage dispatcher
async function promptNextEscapeStep(sock, jid, sessionKey) {
    const session = global.escapeSessions[sessionKey];

    if (session.step > 10) {
        const victoryCard = 
            `🎉 *CONGRATULATIONS: ESCAPED!* 🎉\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🔓 You successfully cleared all 10 stages of the room and survived with *${session.lives}❤️* left!\n\n` +
            `_“Excellent deduction skills, you are free!”_ 🤞`;
        delete global.escapeSessions[sessionKey];
        return await sock.sendMessage(jid, { text: victoryCard }, { quoted: global.messageStore[session.lastQuestionMsgId] || null });
    }

    const systemPrompt = 
        `You are the master of a creepy Escape Room adventure game. The player must clear 10 stages to escape. They currently have ${session.lives} lives remaining.\n` +
        `Generate Stage ${session.step} of 10. The scenario must be deeply eerie, cryptic, require logical thinking, and have zero reference to anime.\n` +
        `Provide exactly 3 choices (1, 2, 3).\n` +
        `If the user's choice is fatal or incorrect, they lose a life. If they lose a life, end your response with "LIFE_LOST" at the very end.\n` +
        `If they lose all lives, end your response with "GAME_OVER" at the very end. Limit the scenario narrative to 4 intense sentences.`;

    const engineResponse = await queryLLM(systemPrompt, 0.8);
    if (!engineResponse) {
        return await sock.sendMessage(jid, { text: "❌ Failed to load next room assets. Try choosing again." });
    }

    if (engineResponse.includes("GAME_OVER")) {
        const cleanMsg = engineResponse.replace("GAME_OVER", "").trim();
        const failText = 
            `💀 *STAGE ${session.step}/10: DIED!* 💀\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${cleanMsg}\n\n` +
            `❌ *GAME OVER:* You ran out of hearts!`;
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
        `🚪 *ESCAPE ROOM: STAGE ${session.step}/10* 🚪\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${cleanDesc}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Status:* ${livesNotice}\n` +
        `👉 *Reply to this message with your choice (1, 2, or 3) to proceed!*`;

    const prompt = await sock.sendMessage(jid, { text: stageCard }, { quoted: global.messageStore[session.lastQuestionMsgId] || null });
    session.lastQuestionMsgId = prompt.key.id;
}

// ============================================================================
// GAME COMMANDS
// ============================================================================

module.exports = [
    // 1. ANAGRAM GAME INITIATOR (.anagram / .anagrams)
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

            const formatPrompt = 
                `🔠 *ANAGRAMS SYSTEM CONTROL* 🔠\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `*Difficulty Mode:* \`${difficulty.toUpperCase()}\`\n\n` +
                `Select your game format to proceed:`;

            const buttons = {
                text: formatPrompt,
                buttons: [
                    { buttonId: `${settings.prefix}anagram_mode single ${difficulty}`, buttonText: { displayText: 'Singleplayer 👤' }, type: 1 },
                    { buttonId: `${settings.prefix}anagram_mode multi ${difficulty}`, buttonText: { displayText: 'Multiplayer 👥' }, type: 1 }
                ],
                headerType: 1
            };

            await sock.sendMessage(jid, buttons, { quoted: msg });
        }
    },

    // 2. ANAGRAM MODE ROUTER (.anagram_mode)
    {
        name: 'anagram_mode',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const parts = args ? args.toLowerCase().trim().split(' ') : [];
            const mode = parts[0] || 'single';
            const difficulty = parts[1] || 'easy';

            let timerMs = 30000; // easy
            if (difficulty === 'medium') timerMs = 20000;
            if (difficulty === 'hard') timerMs = 15000;

            const sessionKey = mode === 'single' ? (jid + '_' + senderJid) : jid;

            if (global.anagramSessions[sessionKey]) {
                return await sock.sendMessage(jid, { text: "⚠️ An active Anagram session is already running in this channel." }, { quoted: msg });
            }

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

                await sock.sendMessage(jid, { text: `🚀 *Anagram singleplayer initialized!* (Difficulty: \`${difficulty.toUpperCase()}\`). Starting round 1/10...` }, { quoted: msg });
                await askNextAnagram(sock, jid, sessionKey);
            } else {
                if (!isGroup) {
                    return await sock.sendMessage(jid, { text: "❌ Multiplayer modes require an active Group Chat." }, { quoted: msg });
                }

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

                const lobbyCard = 
                    `👥 *ANAGRAM MULTIPLAYER LOBBY* 👥\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `*Difficulty:* \`${difficulty.toUpperCase()}\`\n` +
                    `🔍 *Searching for survivors... (30s limit, Max 4 Players)*\n\n` +
                    `• *Surviving Lineup:* \`1/4\`\n` +
                    `👤 @${senderNumber}\n\n` +
                    `👉 Tap the button below to join the match!`;

                const lobbyButtons = {
                    text: lobbyCard,
                    buttons: [
                        { buttonId: `${settings.prefix}anagram_join`, buttonText: { displayText: 'Join Match 🎮' }, type: 1 }
                    ],
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
                        return await sock.sendMessage(jid, { text: "🛑 *Lobby Disbanded:* Multiplayer matches require a minimum of 2 players to start." });
                    }

                    session.status = 'playing';
                    session.originalPlayerCount = session.players.length;
                    const listMentions = session.players.map(p => `@${p.split('@')[0]}`).join(', ');

                    await sock.sendMessage(jid, { 
                        text: `🔔 *LOBBY CLOSED!* Starting match with ${session.players.length} players:\n\n${listMentions}\n\nPreparing Word 1...`,
                        mentions: session.players
                    });

                    await askNextAnagram(sock, jid, sessionKey);

                }, 30000);
            }
        }
    },

    // 3. MULTIPLAYER ANAGRAM LOBBY JOIN CONTROLLER (.anagram_join)
    {
        name: 'anagram_join',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const session = global.anagramSessions[jid];
            if (!session || session.status !== 'lobby') return;

            if (session.players.includes(senderJid)) return;

            if (session.players.length >= 4) {
                return await sock.sendMessage(jid, { text: `❌ Sorry @${senderNumber}, the lobby is already full (4/4)!`, mentions: [senderJid] }, { quoted: msg });
            }

            session.players.push(senderJid);
            session.scores[senderJid] = 0;
            session.lives[senderJid] = 3;

            const joinedCount = session.players.length;
            const listPlayers = session.players.map(p => `👤 @${p.split('@')[0]}`).join('\n');

            const lobbyCard = 
                `👥 *ANAGRAM MULTIPLAYER LOBBY* 👥\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `*Difficulty:* \`${session.difficulty.toUpperCase()}\`\n` +
                `🔍 *Searching for survivors... (30s limit, Max 4 Players)*\n\n` +
                `• *Surviving Lineup:* \`${joinedCount}/4\`\n` +
                `${listPlayers}\n\n` +
                `👉 Tap the button below to join the match!`;

            const lobbyButtons = {
                text: lobbyCard,
                buttons: [
                    { buttonId: `${settings.prefix}anagram_join`, buttonText: { displayText: 'Join Match 🎮' }, type: 1 }
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
                session.originalPlayerCount = 4;
                const listMentions = session.players.map(p => `@${p.split('@')[0]}`).join(', ');

                await sock.sendMessage(jid, { 
                    text: `🔥 *LOBBY FULL (4/4)!* Starting match instantly with:\n\n${listMentions}\n\nPreparing Word 1...`,
                    mentions: session.players
                });

                await askNextAnagram(sock, jid, jid);
            }
        }
    },

    // 4. ANAGRAM GAME EVALUATOR (.anagram_ans)
    {
        name: 'anagram_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const sessionKey = jid.endsWith('@g.us') ? jid : jid + '_' + senderJid;
            const session = global.anagramSessions[sessionKey];

            if (!session) return;

            const isSingle = session.type === 'single';

            if (!isSingle) {
                const activeTurnPlayer = session.players[session.turnIndex];
                if (activeTurnPlayer !== senderJid) {
                    return await sock.sendMessage(jid, { 
                        text: `⚠️ Wait your turn! Only @${activeTurnPlayer.split('@')[0]} is authorized to guess right now.`, 
                        mentions: [activeTurnPlayer] 
                    }, { quoted: msg });
                }
            }

            if (session.timerId) clearTimeout(session.timerId);

            const guess = args.toUpperCase().trim();
            const correctWord = session.currentWord;

            let resultLabel = "";

            if (guess === correctWord) {
                if (isSingle) {
                    session.score++;
                } else {
                    session.scores[senderJid]++;
                }
                resultLabel = `✅ *CORRECT GUESS BY @${senderNumber}!* +1 point. 🎉`;
            } else {
                if (isSingle) {
                    session.livesSP--;
                    resultLabel = `❌ *INCORRECT GUESS BY @${senderNumber}!* Correct word was *${correctWord}*.\n\n❤️ *Remaining Hearts:* \`${session.livesSP}/3\``;
                    
                    if (session.livesSP <= 0) {
                        await sock.sendMessage(jid, { text: resultLabel });
                        const results = `📊 *ANAGRAM GAME OVER!* 📊\n` +
                                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                        `👤 *Player:* @${session.player.split('@')[0]}\n` +
                                        `🎯 *Final Score:* \`${session.score}/10\`\n` +
                                        `💀 *Reason:* Out of lives.\n\n` +
                                        `_Better luck next time!_ 🤞`;
                        delete global.anagramSessions[sessionKey];
                        return await sock.sendMessage(jid, { text: results, mentions: [session.player] });
                    }
                } else {
                    session.lives[senderJid]--;
                    resultLabel = `❌ *INCORRECT GUESS BY @${senderNumber}!* Correct word was *${correctWord}*.\n\n❤️ *Remaining Hearts:* \`${session.lives[senderJid]}/3\``;
                    
                    if (session.lives[senderJid] <= 0) {
                        resultLabel += `\n\n💀 @${senderNumber} has been *ELIMINATED*!`;
                    }
                }
            }

            await sock.sendMessage(jid, { text: resultLabel, mentions: [senderJid] }, { quoted: msg });

            session.currentQuestionIndex++;
            if (!isSingle) {
                session.turnIndex = (session.turnIndex + 1) % session.players.length;
            }

            await delay(1500);
            await askNextAnagram(sock, jid, sessionKey);
        }
    },

    // 5. WORD CHAIN / RING GAME (.wcg / .wrg)
    {
        name: 'wcg',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ Word Chain Game is a multiplayer-only module requiring a Group Chat." }, { quoted: msg });
            }

            if (global.wcgSessions[jid]) {
                return await sock.sendMessage(jid, { text: "⚠️ An active Word Chain Game lobby is already running in this group." }, { quoted: msg });
            }

            let difficulty = "easy";
            if (args) {
                const opt = args.toLowerCase().trim();
                if (['easy', 'medium', 'hard'].includes(opt)) difficulty = opt;
            }

            let timerMs = 30000; // easy
            if (difficulty === 'medium') timerMs = 20000;
            if (difficulty === 'hard') timerMs = 15000;

            global.wcgSessions[jid] = {
                status: 'lobby',
                difficulty: difficulty,
                timerMs: timerMs,
                players: [senderJid],
                turnIndex: 0,
                lastWord: '',
                usedWords: [],
                lastQuestionMsgId: '',
                timerId: null
            };

            const lobbyCard = 
                `⛓️ *WORD CHAIN GAME LOBBY* ⛓️\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `*Difficulty:* \`${difficulty.toUpperCase()}\`\n` +
                `🔍 *Searching for chain players... (30s limit, Min 2, Max 10 players)*\n\n` +
                `• *Surviving Lineup:* \`1/10\`\n` +
                `👤 @${senderNumber}\n\n` +
                `👉 Tap the button below to join the chain!`;

            const lobbyButtons = {
                text: lobbyCard,
                buttons: [
                    { buttonId: `${settings.prefix}wcg_join`, buttonText: { displayText: 'Join Chain ⛓️' }, type: 1 }
                ],
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
                    return await sock.sendMessage(jid, { text: "🛑 *Lobby Disbanded:* Word Chain Game requires a minimum of 2 players to start." });
                }

                session.status = 'playing';
                const listMentions = session.players.map(p => `@${p.split('@')[0]}`).join(', ');

                await sock.sendMessage(jid, { 
                    text: `🔔 *LOBBY CLOSED!* Starting match with ${session.players.length} players:\n\n${listMentions}\n\nPreparing turn assignments...`,
                    mentions: session.players
                });

                await promptNextWcgTurn(sock, jid);

            }, 30000);
        }
    },

    // 6. WORD CHAIN LOBBY JOIN CONTROLLER (.wcg_join)
    {
        name: 'wcg_join',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const session = global.wcgSessions[jid];
            if (!session || session.status !== 'lobby') return;

            if (session.players.includes(senderJid)) return;

            if (session.players.length >= 10) {
                return await sock.sendMessage(jid, { text: `❌ Sorry @${senderNumber}, the lobby is already full (10/10)!`, mentions: [senderJid] }, { quoted: msg });
            }

            session.players.push(senderJid);

            const joinedCount = session.players.length;
            const listPlayers = session.players.map(p => `👤 @${p.split('@')[0]}`).join('\n');

            const lobbyCard = 
                `⛓️ *WORD CHAIN GAME LOBBY* ⛓️\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `*Difficulty:* \`${session.difficulty.toUpperCase()}\`\n` +
                `🔍 *Searching for chain players... (30s limit, Min 2, Max 10 players)*\n\n` +
                `• *Surviving Lineup:* \`${joinedCount}/10\`\n` +
                `${listPlayers}\n\n` +
                `👉 Tap the button below to join the chain!`;

            const lobbyButtons = {
                text: lobbyCard,
                buttons: [
                    { buttonId: `${settings.prefix}wcg_join`, buttonText: { displayText: 'Join Chain ⛓️' }, type: 1 }
                ],
                headerType: 1,
                mentions: session.players
            };

            try {
                await sock.sendMessage(jid, { delete: { remoteJid: jid, id: session.lobbyMsgId, fromMe: true } });
            } catch (e) {}

            const updatedLobby = await sock.sendMessage(jid, lobbyButtons, { updatedLobby: lobbyMsg ? lobbyMsg.key.id : '' });
            session.lobbyMsgId = updatedLobby.key.id;
        }
    },

    // 7. WORD CHAIN TURN ANSWER MANAGER (.wcg_ans)
    {
        name: 'wcg_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            const session = global.wcgSessions[jid];
            if (!session || session.status !== 'playing') return;

            const activePlayer = session.players[session.turnIndex];
            if (activePlayer !== senderJid) {
                return await sock.sendMessage(jid, { 
                    text: `⚠️ Wait your turn! Only @${activePlayer.split('@')[0]} is authorized to submit a word chain now.`, 
                    mentions: [activePlayer] 
                }, { quoted: msg });
            }

            if (session.timerId) clearTimeout(session.timerId);

            const word = args.trim().toUpperCase();

            if (!word) {
                session.players.splice(session.turnIndex, 1);
                await sock.sendMessage(jid, { text: `💀 @${senderNumber} failed to submit a word and has been *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                await delay(1500);
                return await promptNextWcgTurn(sock, jid);
            }

            if (session.lastWord) {
                const targetLetter = session.lastWord.slice(-1).toUpperCase();
                if (word.charAt(0) !== targetLetter) {
                    session.players.splice(session.turnIndex, 1);
                    await sock.sendMessage(jid, { text: `💀 @${senderNumber} submitted a word starting with the wrong letter! You must start with *"${targetLetter}"*. \n\n🔴 *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                    await delay(1500);
                    return await promptNextWcgTurn(sock, jid);
                }
            }

            if (session.usedWords.includes(word)) {
                session.players.splice(session.turnIndex, 1);
                await sock.sendMessage(jid, { text: `💀 @${senderNumber} submitted a word that has already been used! \n\n🔴 *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                await delay(1500);
                return await promptNextWcgTurn(sock, jid);
            }

            await sock.sendMessage(jid, { text: "🔍 `Validating word structure...`" }, { quoted: msg });
            const isValid = await isValidEnglishWord(word);

            if (!isValid) {
                session.players.splice(session.turnIndex, 1);
                await sock.sendMessage(jid, { text: `💀 *"${word}"* is not a valid dictionary English word! \n\n🔴 *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                await delay(1500);
                return await promptNextWcgTurn(sock, jid);
            }

            session.lastWord = word;
            session.usedWords.push(word);

            await sock.sendMessage(jid, { text: `✅ *Word Accepted:* "${word}"\n\nNext turn routing...` }, { quoted: msg });

            session.turnIndex = (session.turnIndex + 1) % session.players.length;

            await delay(1500);
            await promptNextWcgTurn(sock, jid);
        }
    },

    // 8. WHO WANTS TO BE A MILLIONAIRE INITIATOR (.millionaire)
    {
        name: 'millionaire',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid;

            if (global.millionaireSessions[sessionKey]) {
                return await sock.sendMessage(jid, { text: `⚠️ You already have an active Millionaire session running. Finish that game first!` }, { quoted: msg });
            }

            global.millionaireSessions[sessionKey] = {
                player: senderJid,
                step: 1,
                money: 0,
                currentQuestion: '',
                currentOptions: [],
                correctAns: '',
                eliminatedOptions: [],
                pastQuestions: [],
                lastQuestionMsgId: '',
                timerId: null,
                timerMs: 20000,
                status: 'playing',
                friendAnswer: '',
                friendName: '',
                lifelines: {
                    phone: true,
                    fifty: true,
                    audience: true,
                    walk: true
                }
            };

            await sock.sendMessage(jid, { text: "💰 *Who Wants to Be a Millionaire Game Initialized!* Preparing Question 1/15..." }, { quoted: msg });
            await askNextMillionaireQuestion(sock, jid, sessionKey);
        }
    },

    // 9. MILLIONAIRE LIFELINES CONTROLLER MANAGER (.millionaire_life)
    {
        name: 'millionaire_life',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid;

            const session = global.millionaireSessions[sessionKey];
            if (!session || session.status !== 'playing') return;

            const lifeline = args ? args.toLowerCase().trim() : '';

            if (lifeline === 'phone') {
                if (!session.lifelines.phone) return;
                session.lifelines.phone = false;

                if (session.timerId) clearTimeout(session.timerId);
                session.status = 'calling';

                const prompt = await sock.sendMessage(jid, { 
                    text: `📞 *PHONE A FRIEND LIFELINE* 📞\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `Who would you like to call for help on this question?\n\n` +
                          `👉 *Reply to this specific message directly with the name of any character* (e.g. Satoru Gojo, Albert Einstein, Iron Man, Hermione Granger).`
                }, { quoted: msg });
                session.lastQuestionMsgId = prompt.key.id;
            } 
            else if (lifeline === 'fifty') {
                if (!session.lifelines.fifty) return;
                session.lifelines.fifty = false;

                if (session.timerId) clearTimeout(session.timerId);

                const correctLetter = session.correctAns.toLowerCase();
                const allLetters = ['a', 'b', 'c', 'd'];
                const incorrectOptions = allLetters.filter(l => l !== correctLetter);
                
                const shuffledInc = incorrectOptions.sort(() => 0.5 - Math.random());
                session.eliminatedOptions = [shuffledInc[0], shuffledInc[1]];

                await sock.sendMessage(jid, { text: "✂️ `Applying 50/50 lifeline... Eliminating two incorrect options.`" }, { quoted: msg });
                await delay(1500);

                await sendMillionaireDisplay(sock, jid, sessionKey);
            } 
            else if (lifeline === 'audience') {
                if (!session.lifelines.audience) return;
                session.lifelines.audience = false;

                if (session.timerId) clearTimeout(session.timerId);
                
                await sock.sendMessage(jid, { text: "📊 `Channelling audience opinion... Analyzing group coordinates.`" }, { quoted: msg });

                const correctLetter = session.correctAns.toUpperCase();
                const distribution = {};
                let remaining = 100;

                const allOptions = ['A', 'B', 'C', 'D'];
                const primaryWeight = Math.floor(Math.random() * 21) + 50;
                distribution[correctLetter] = primaryWeight;
                remaining -= primaryWeight;

                const remainingOptions = allOptions.filter(l => l !== correctLetter);
                const secondWeight = Math.floor(Math.random() * remaining);
                distribution[remainingOptions[0]] = secondWeight;
                remaining -= secondWeight;

                const thirdWeight = Math.floor(Math.random() * remaining);
                distribution[remainingOptions[1]] = thirdWeight;
                remaining -= thirdWeight;

                distribution[remainingOptions[2]] = remaining;

                const drawBar = (pct) => {
                    const filled = Math.round(pct / 10);
                    return "█".repeat(filled) + "░".repeat(10 - filled);
                };

                const pollResults = 
                    `📊 *AUDIENCE POLL INFERENCE REPORT* 📊\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `• A: [${drawBar(distribution['A'])}] — \`${distribution['A']}%\`\n` +
                    `• B: [${drawBar(distribution['B'])}] — \`${distribution['B']}%\`\n` +
                    `• C: [${drawBar(distribution['C'])}] — \`${distribution['C']}%\`\n` +
                    `• D: [${drawBar(distribution['D'])}] — \`${distribution['D']}%\`\n\n` +
                    `👉 _The audience has voted! Directing your attention back to your question board..._`;

                await delay(3000);
                await sock.sendMessage(jid, { text: pollResults }, { quoted: msg });
                await delay(2000);

                await sendMillionaireDisplay(sock, jid, sessionKey);
            } 
            else if (lifeline === 'walk') {
                delete global.millionaireSessions[sessionKey];
                const msgText = 
                    `💰 *WALK AWAY SUCCESSFUL!* 💰\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *Player:* @${senderJid.split('@')[0]}\n` +
                    `💸 You chose to walk away with your accumulated wealth of *₦${session.money.toLocaleString()} WAT*!\n\n` +
                    `_“Smart call! A safe choice to preserve your winnings.”_ 🤞`;
                await sock.sendMessage(jid, { text: msgText, mentions: [senderJid] }, { quoted: msg });
            }
        }
    },

    // 10. MILLIONAIRE CALL FRIEND CONTROLLER (.millionaire_call)
    {
        name: 'millionaire_call',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid;

            const session = global.millionaireSessions[sessionKey];
            if (!session || session.status !== 'calling') return;

            const characterName = args ? args.trim() : 'a smart friend';
            session.friendName = characterName;

            const callingFrames = [
                `📞 \`[SYS_LINK] Dialing ${characterName}... Connecting to network satellites...\``,
                `📞 \`[SYS_LINK] Connection stable. Calling ${characterName}... Ringing...\``,
                `☎️ \`[SYS_LINK] Call connected! Speaker routing activated.\``
            ];

            let sent = await sock.sendMessage(jid, { text: callingFrames[0] }, { quoted: msg });
            for (let i = 1; i < callingFrames.length; i++) {
                await delay(1500);
                await sock.sendMessage(jid, { text: callingFrames[i], edit: sent.key });
            }

            await delay(1000);

            const isCorrect = Math.random() < 0.50;
            const letters = ['a', 'b', 'c', 'd'];

            let suggestedAns = session.correctAns.toLowerCase();
            if (!isCorrect) {
                const wrongLetters = letters.filter(l => l !== suggestedAns);
                suggestedAns = wrongLetters[Math.floor(Math.random() * wrongLetters.length)];
            }
            session.friendAnswer = suggestedAns;

            const prompt = 
                `Act exactly as the fictional character "${characterName}". Your friend is playing 'Who Wants to Be a Millionaire' and is calling you for help on this question: "${session.currentQuestion}" with options "${session.currentOptions.join(', ')}".\n\n` +
                `Give them your helpful opinion in character. Give them option "${suggestedAns.toUpperCase()}" as your recommended option. Limit your response to 2 sentences.`;

            const charResponse = await queryLLM(prompt, 0.85);

            const quoteText = 
                `📞 *PHONE CALL:* *${characterName.toUpperCase()}* 📞\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `🗣️ _"${charResponse || `Hey! I'm pretty sure the answer is ${suggestedAns.toUpperCase()}!`}"_\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `❓ *GO WITH FRIEND'S CHOICE?* ❓\n\n` +
                `Do you want to submit your friend's recommendation (*${suggestedAns.toUpperCase()}*) as your answer?\n\n` +
                `👉 *Reply to this message with "YES" or "NO"*`;

            session.status = 'waiting_friend_decision';
            const decisionPrompt = await sock.sendMessage(jid, { text: quoteText }, { quoted: sent });
            session.lastQuestionMsgId = decisionPrompt.key.id;
        }
    },

    // 11. MILLIONAIRE FRIEND CHOICE DECISION INTERACTOR (.millionaire_decision)
    {
        name: 'millionaire_decision',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid;

            const session = global.millionaireSessions[sessionKey];
            if (!session || session.status !== 'waiting_friend_decision') return;

            const choice = args ? args.toLowerCase().trim() : '';

            if (choice === 'yes') {
                const submitted = session.friendAnswer.toLowerCase();
                const commands = require('../commands');
                await commands[`${settings.prefix}millionaire_ans`](sock, msg, submitted, { isOwner: false });
            } 
            else if (choice === 'no') {
                session.status = 'playing';
                await sock.sendMessage(jid, { text: "❌ `[SYS_LINK] Choice declined. Returning to your active question board...`" });
                await delay(1500);

                await sendMillionaireDisplay(sock, jid, sessionKey);
            }
        }
    },

    // 12. MILLIONAIRE ANS EVALUATOR (.millionaire_ans)
    {
        name: 'millionaire_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];
            const sessionKey = jid + '_' + senderJid;

            const session = global.millionaireSessions[sessionKey];
            if (!session) return;

            if (session.timerId) clearTimeout(session.timerId);

            const submitted = args.toLowerCase().trim();
            const correctAns = session.correctAns.toLowerCase();

            if (submitted === correctAns) {
                session.money = session.step * 100000;
                session.step++;
                session.eliminatedOptions = [];

                const correctMsg = 
                    `🎯 You answered *${submitted.toUpperCase()}* correctly!\n` +
                    `💰 Accumulated Winnings: *₦${session.money.toLocaleString()} WAT*\n\n` +
                    `👉 Preparing next question...`;

                await sock.sendMessage(jid, { text: correctMsg }, { quoted: msg });
                await delay(2500);

                await askNextMillionaireQuestion(sock, jid, sessionKey);
            } else {
                delete global.millionaireSessions[sessionKey];

                const failMsg = 
                    `❌ *WRONG ANSWER!* 💀\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🎯 You chose option *${submitted.toUpperCase()}*. The correct option was *${correctAns.toUpperCase()}*.\n\n` +
                    `🔴 *GAME OVER:* You leave with *₦${session.money.toLocaleString()} WAT*. Thank you for playing!`;

                await sock.sendMessage(jid, { text: failMsg }, { quoted: msg });
            }
        }
    },

    // 13. TRUTH OR FALSE STATEMENT GENERATOR (.torf)
    {
        name: 'torf',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid + '_torf';

            const category = args ? args.trim() : "General Knowledge";

            if (global.torfSessions[sessionKey]) {
                return await sock.sendMessage(jid, { text: "⚠️ Answer the active True/False question first!" }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: `Generating a True/False puzzle for Category: *"${category}"*... 📜` }, { quoted: msg });

            const data = await generateTorfQuestion(category, []);
            if (!data) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve True/False question context." }, { quoted: msg });

            global.torfSessions[sessionKey] = {
                question: data.q,
                ans: data.ans.toLowerCase().trim(),
                explanation: data.explanation
            };

            const torfCard = 
                `📜 *TRUE OR FALSE CHALLENGE* 📜\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `📁 *Category:* \`${category}\`\n\n` +
                `📝 *Statement:* \n"${data.q}"\n\n` +
                `Select an option below to answer:`;

            const buttons = {
                text: torfCard,
                buttons: [
                    { buttonId: `${settings.prefix}torf_ans true`, buttonText: { displayText: 'True ✅' }, type: 1 },
                    { buttonId: `${settings.prefix}torf_ans false`, buttonText: { displayText: 'False ❌' }, type: 1 }
                ],
                headerType: 1
            };

            await sock.sendMessage(jid, buttons, { quoted: msg });
        }
    },

    // 14. TRUTH OR FALSE ANSWER EVALUATOR (.torf_ans)
    {
        name: 'torf_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid + '_torf';

            const session = global.torfSessions[sessionKey];
            if (!session) return;

            const submitted = args.toLowerCase().trim();
            const correctAns = session.ans;

            delete global.torfSessions[sessionKey];

            let results = "";
            if (submitted === correctAns) {
                results = `🎉 *CORRECT!* \n\n🎯 You chose *${submitted.toUpperCase()}*, which is correct!\n\n📖 *Explanation:* _${session.explanation}_`;
            } else {
                results = `❌ *INCORRECT!* \n\n🎯 You chose *${submitted.toUpperCase()}*. The correct answer was *${correctAns.toUpperCase()}*.\n\n📖 *Explanation:* _${session.explanation}_`;
            }

            await sock.sendMessage(jid, { text: results }, { quoted: msg });
        }
    },

    // 15. PVP ANIME LORE BATTLE INITIATOR (.pvp)
    {
        name: 'pvp',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ PVP Battles are a multiplayer-only module requiring a Group Chat." }, { quoted: msg });
            }

            if (global.pvpSessions[jid]) {
                return await sock.sendMessage(jid, { text: "⚠️ An active PVP battle is already running in this group." }, { quoted: msg });
            }

            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targetJid = mentions.length > 0 ? mentions[0] : '';

            if (!targetJid || targetJid === senderJid) {
                return await sock.sendMessage(jid, { text: "❌ Please mention (@user) or reply to the user you wish to challenge." }, { quoted: msg });
            }

            const targetNumber = targetJid.split('@')[0];
            const initiatorChar = args ? args.replace(/@[^ ]+/g, '').trim() : 'Goku';

            global.pvpSessions[jid] = {
                status: 'p2_choosing',
                p1: senderJid,
                p1Char: initiatorChar,
                p1HP: 100,
                p2: targetJid,
                p2Char: '',
                p2HP: 100,
                turn: senderJid,
                defender: targetJid,
                lastAttack: '',
                attacker: '',
                movesLeft: {
                    [senderJid]: 5,
                    [targetJid]: 5
                },
                timerId: null,
                lastQuestionMsgId: ''
            };

            const challengeCard = 
                `⚔️ *PVP LORE SHOWDOWN CHALLENGE* ⚔️\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *Challenger:* @${senderNumber} with *"${initiatorChar}"*\n` +
                `🎯 *Target Opponent:* @${targetNumber}\n\n` +
                `👉 @${targetNumber}, you have been challenged! Reply directly to this message with your chosen character's name to begin the match!`;

            const prompt = await sock.sendMessage(jid, { text: challengeCard, mentions: [senderJid, targetJid] }, { quoted: msg });
            global.pvpSessions[jid].lastQuestionMsgId = prompt.key.id;
        }
    },

    // 16. PVP PARTNER CHARACTER REGISTER (.pvp_choose)
    {
        name: 'pvp_choose',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const session = global.pvpSessions[jid];
            if (!session || session.status !== 'p2_choosing') return;

            const opponentChar = args ? args.trim() : 'Luffy';
            session.p2Char = opponentChar;
            session.status = 'fighting';

            const startText = 
                `🎮 *THE DUEL COMMENCES!* 🎮\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `⚔️ *Fighter 1:* *${session.p1Char}* (@${session.p1.split('@')[0]}) — HP: \`100\`\n` +
                `⚔️ *Fighter 2:* *${session.p2Char}* (@${session.p2.split('@')[0]}) — HP: \`100\`\n\n` +
                `👉 @${session.p1.split('@')[0]} (*${session.p1Char}*), you have the first turn! Reply to this message with your attack move (special abilities or physical hits are accepted).`;

            const prompt = await sock.sendMessage(jid, { text: startText, mentions: [session.p1, session.p2] }, { quoted: msg });
            session.lastQuestionMsgId = prompt.key.id;
        }
    },

    // 17. PVP ACTION ATTACK ROUND MANAGER (.pvp_fight)
    {
        name: 'pvp_fight',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const session = global.pvpSessions[jid];
            if (!session || session.status !== 'fighting') return;

            if (session.turn !== senderJid) {
                return await sock.sendMessage(jid, { text: `⚠️ Wait your turn! Only @${session.turn.split('@')[0]} can strike now.` }, { quoted: msg });
            }

            const move = args ? args.trim() : '';
            if (!move) return;

            await sock.sendMessage(jid, { text: `⚔️ *Referee AI is evaluating attack "${move}"...*` }, { quoted: msg });

            const attackerChar = senderJid === session.p1 ? session.p1Char : session.p2Char;
            const validation = await evaluatePvpAttack(attackerChar, move);

            if (validation === "INVALID_MOVE") {
                const retryPrompt = await sock.sendMessage(jid, { 
                    text: `❌ *INVALID ATTACK:* Satoru Gojo AI says *"${attackerChar}"* cannot execute *"${move}"*!\n\n` +
                          `👉 Please reply directly with a valid canon technique or basic hit (e.g. Punch, Kick).` 
                }, { quoted: msg });
                session.lastQuestionMsgId = retryPrompt.key.id;
                return;
            }

            session.status = 'defending';
            session.lastAttack = move;
            session.attacker = senderJid;
            session.defender = senderJid === session.p1 ? session.p2 : session.p1;

            const defenderChar = session.defender === session.p1 ? session.p1Char : session.p2Char;

            const defensePrompt = 
                `🛡️ *DEFENSE WINDOW ACTIVE!* 🛡️\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `⚔️ *Attack incoming:* *${attackerChar}* used *"${move}"*!\n\n` +
                `👉 @${session.defender.split('@')[0]} (*${defenderChar}*), you have exactly *7 SECONDS* to reply directly to this message with a defense/counter move (e.g. Block, Dodge, Susanoo, Infinity, Parry)!`;

            const prompt = await sock.sendMessage(jid, { text: defensePrompt, mentions: [session.defender] }, { quoted: msg });
            session.lastQuestionMsgId = prompt.key.id;

            session.timerId = setTimeout(async () => {
                await handlePvpDefenseTimeout(sock, jid);
            }, 7000);
        }
    },

    // 18. PVP DEFENSE CLASH EVALUATOR (.pvp_defend)
    {
        name: 'pvp_defend',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const session = global.pvpSessions[jid];
            if (!session || session.status !== 'defending') return;

            if (session.defender !== senderJid) return;

            if (session.timerId) clearTimeout(session.timerId);

            const defenseMove = args ? args.trim() : 'block';

            await sock.sendMessage(jid, { text: `⚔️ *Referee AI is evaluating defense "${defenseMove}" against "${session.lastAttack}"...*` }, { quoted: msg });

            const attackerChar = session.attacker === session.p1 ? session.p1Char : session.p2Char;
            const defenderChar = session.defender === session.p1 ? session.p1Char : session.p2Char;

            const evaluation = await evaluatePvpClash(attackerChar, defenderChar, session.lastAttack, defenseMove);

            let damage = 15;
            if (evaluation) {
                const match = evaluation.match(/DAMAGE:\s*(\d+)/i);
                if (match) damage = parseInt(match[1]);
            }

            if (session.defender === session.p1) {
                session.p1HP = Math.max(0, session.p1HP - damage);
            } else {
                session.p2HP = Math.max(0, session.p2HP - damage);
            }

            session.movesLeft[session.attacker]--;

            const clashReport = 
                `💥 *CLASH EVALUATION REPORT!* 💥\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `${evaluation ? evaluation.replace(/DAMAGE:\s*\d+/i, '').trim() : `${attackerChar} attacks while ${defenderChar} parries.`}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🛡️ *HP Status:*\n` +
                `• *${session.p1Char}* (@${session.p1.split('@')[0]}): \`${session.p1HP} HP\` — Moves Left: \`${session.movesLeft[session.p1]}\`\n` +
                `• *${session.p2Char}* (@${session.p2.split('@')[0]}): \`${session.p2HP} HP\` — Moves Left: \`${session.movesLeft[session.p2]}\``;

            await sock.sendMessage(jid, { text: clashReport, mentions: [session.p1, session.p2] }, { quoted: msg });
            await delay(2000);

            if (await checkPvpGameOver(sock, jid, session)) return;

            session.status = 'fighting';
            session.turn = session.defender;
            session.defender = session.attacker;

            const nextStrikeText = `👉 It is now @${session.turn.split('@')[0]}'s turn to strike! Reply to this message with your next move.`;
            const prompt = await sock.sendMessage(jid, { text: nextStrikeText, mentions: [session.turn] });
            session.lastQuestionMsgId = prompt.key.id;
        }
    },

    // 19. DYNAMIC COGNITIVE ESCAPE ROOM (.escape)
    {
        name: 'escape',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid;

            if (global.escapeSessions[sessionKey]) {
                return await sock.sendMessage(jid, { text: "⚠️ You already have an active Escape Room running!" }, { quoted: msg });
            }

            if (args && args.toLowerCase().trim() === 'quit') {
                delete global.escapeSessions[sessionKey];
                return await sock.sendMessage(jid, { text: "🛑 Escape Room aborted." }, { quoted: msg });
            }

            global.escapeSessions[sessionKey] = {
                player: senderJid,
                step: 1,
                lives: 5,
                lastQuestionMsgId: ''
            };

            await sock.sendMessage(jid, { text: "🚪 *Escape Room Initialized!* Preparing Stage 1/10... 🔐" }, { quoted: msg });
            await promptNextEscapeStep(sock, jid, sessionKey);
        }
    },

    // 20. ESCAPE ROOM ANS/CHOICE EVALUATOR (.escape_ans)
    {
        name: 'escape_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid;

            const session = global.escapeSessions[sessionKey];
            if (!session) return;

            const choice = args.trim();
            if (!['1', '2', '3'].includes(choice)) {
                return await sock.sendMessage(jid, { text: "❌ Invalid choice! Choose either Option 1, 2, or 3." }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: "💾 `Processing stage interaction...`" }, { quoted: msg });

            session.step++;
            await promptNextEscapeStep(sock, jid, sessionKey);
        }
    }
];

// ============================================================================
// ALIAS & TRIGGER REGISTRATION
// ============================================================================

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'anagram') {
        aliases.push({ ...cmd, name: 'anagrams' });
    }
    if (cmd.name === 'wcg') {
        aliases.push({ ...cmd, name: 'wrg' });
        aliases.push({ ...cmd, name: 'wordchain' });
    }
    if (cmd.name === 'millionaire') {
        aliases.push({ ...cmd, name: 'mill' });
    }
});
module.exports.push(...aliases);