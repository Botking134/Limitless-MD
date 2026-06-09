// plugins/games2.js
const settings = require('../settings');

global.anagramSessions = global.anagramSessions || {};
global.wcgSessions = global.wcgSessions || {};
global.millionaireSessions = global.millionaireSessions || {};
global.torfSessions = global.torfSessions || {};
global.pvpSessions = global.pvpSessions || {};
global.escapeSessions = global.escapeSessions || {};

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
        console.error("LLM Query Error (games2.js):", e.message);
        return null;
    }
}

// Self-Contained General Question Generator with Random Seeds (Infinite Variety)
async function generateGeneralQuestion(excludeList = []) {
    const salt = Math.random();
    const prompt = 
        `Generate an interesting general knowledge trivia question (strictly avoid anime themes).\n` +
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

// Word Chain Dictionary and Length Validator
async function isValidEnglishWord(word, minLen, maxLen) {
    const prompt = 
        `System: Is the word "${word.toUpperCase()}" a real, valid dictionary-proven English word?\n` +
        `Also, does its length fall between ${minLen} and ${maxLen} letters?\n` +
        `Respond with exactly YES or NO.`;
    const response = await queryLLM(prompt, 0.1);
    return response ? response.trim().toUpperCase().includes("YES") : false;
}

// Anagram Word Generator with Random Seeds
async function generateAnagramWord(difficulty, excludeList = []) {
    const salt = Math.random();
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

async function generateTorfQuestion(category, excludeList = []) {
    const salt = Math.random();
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

// ============================================================================
// IN-GAME PROGRESSION METHODS
// ============================================================================

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
    const scattered = scrambleWord(correctWord);

    session.pastWords.push(correctWord);
    session.currentWord = correctWord;
    session.scrambledWord = scattered;

    const roundHeader = isSingle
        ? `🔠 *Anagram: Round ${session.currentQuestionIndex}/10 (Hearts: ${session.livesSP}❤️)*`
        : `👥 *Anagram Round ${session.currentQuestionIndex}*`;

    const livesStr = isSingle ? "" : `\n❤️ *Target Hearts Left:* \`${session.lives[activePlayer]}❤️\``;

    const anagramCard = 
        `${roundHeader}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 *Active Turn:* @${activePlayer.split('@')[0]}${livesStr}\n` +
        `⏳ *Timer:* \`${session.timerMs / 1000} seconds\`\n\n` +
        `🧩 *Rearrange this scrambled word:* \n` +
        `👉    *${scattered}*    \n\n` +
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
        resultMsg = `⏰ *TIME IS UP!* \n\n@${activePlayer.split('@')[0]} failed to answer. Correct word was *${session.currentWord}*.`;
        if (session.lives[activePlayer] <= 0) resultMsg += `\n\n💀 @${senderNumber} has been *ELIMINATED*!`;
    }

    await sock.sendMessage(jid, { text: resultMsg, mentions: isSingle ? [] : [activePlayer] });

    session.currentQuestionIndex++;
    if (!isSingle) session.turnIndex = (session.turnIndex + 1) % session.players.length;

    await delay(2000);
    await askNextAnagram(sock, jid, sessionKey);
}

// Word Chain Turn Prompt (Dynamic Escalation & Unique Tracker)
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

// Millionaire Question Dispatcher
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

    const questionData = await generateGeneralQuestion(session.pastQuestions);
    if (!questionData) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve questions. Game aborted." });

    session.pastQuestions.push(questionData.q);
    session.currentQuestion = questionData.q;
    session.currentOptions = questionData.options;
    session.correctAns = questionData.ans;

    await sendMillionaireDisplay(sock, jid, sessionKey);
}

async function sendMillionaireDisplay(sock, jid, sessionKey) {
    const session = global.millionaireSessions[sessionKey];
    if (session.timerId) clearTimeout(session.timerId);

    const currentReward = session.step * 100000;
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

    // Only display active, unused lifelines
    const buttonList = [];
    if (session.lifelines.phone) buttonList.push({ buttonId: `${settings.prefix}millionaire_life phone`, buttonText: { displayText: 'Phone a Friend 📞' }, type: 1 });
    if (session.lifelines.fifty) buttonList.push({ buttonId: `${settings.prefix}millionaire_life fifty`, buttonText: { displayText: '50/50 ✂️' }, type: 1 });
    if (session.lifelines.audience) buttonList.push({ buttonId: `${settings.prefix}millionaire_life audience`, buttonText: { displayText: 'Ask Group 📊' }, type: 1 });
    buttonList.push({ buttonId: `${settings.prefix}millionaire_life walk`, buttonText: { displayText: 'Walk Away 💰' }, type: 1 });

    const buttons = { text: gameCard, buttons: buttonList, headerType: 1 };
    const prompt = await sock.sendMessage(jid, buttons);
    session.lastQuestionMsgId = prompt.key.id;

    session.timerId = setTimeout(async () => {
        await handleMillionaireTimeout(sock, jid, sessionKey);
    }, session.timerMs);
}

async function handleMillionaireTimeout(sock, jid, sessionKey) {
    const session = global.millionaireSessions[sessionKey];
    if (!session) return;

    delete global.millionaireSessions[sessionKey];
    const results = `⏰ *TIME IS UP!* \n\n🔴 *GAME OVER:* You leave with *₦${session.money.toLocaleString()} WAT*. Correct answer was *${session.correctAns.toUpperCase()}*.`;
    await sock.sendMessage(jid, { text: results, mentions: [session.player] });
}

// PVP Power-Scaled Attack/Defense Evaluator
async function evaluatePvpAttack(attackerChar, move) {
    const refereePrompt = 
        `You are the referee of an epic anime/comic 1v1 battle.\n` +
        `The attacker "${attackerChar}" is attempting to execute the move: "${move}".\n\n` +
        `Your task:\n` +
        `1. Determine if this move is a real canonical technique of "${attackerChar}" OR is a standard physical attack/defense (punch, kick, dodge, block).\n` +
        `2. If the move is completely fake or unrelated to "${attackerChar}"'s universe, respond strictly with "INVALID_MOVE".\n` +
        `3. If valid, respond strictly with "VALID_MOVE".`;

    const decision = await queryLLM(refereePrompt, 0.1);
    return decision ? decision.trim().toUpperCase() : "INVALID_MOVE";
}

async function evaluatePvpClash(attackerChar, defenderChar, attackMove, defenseMove) {
    const prompt = 
        `You are the referee of an epic anime/comic 1v1 battle between "${attackerChar}" and "${defenderChar}".\n` +
        `The attacker "${attackerChar}" used the attack move: "${attackMove}".\n` +
        `The defender "${defenderChar}" attempted to defend using: "${defenseMove}".\n\n` +
        `Evaluate the clash strictly according to canon power scaling:\n` +
        `1. Gojo's "Infinity" is an absolute barrier. If "${defenderChar}" is "Satoru Gojo" and uses "Infinity" as a defense, it completely nullifies any standard attack (deals 0 damage) unless "${attackerChar}" has a spatial bypass (like Sukuna's World-Cutting Slash or Domain Amplification).\n` +
        `2. Standard physical punches or kicks should deal extremely low, realistic damage (3-8 HP).\n` +
        `3. Powerful canonical techniques (like Hollow Purple or Rasenshuriken) deal heavy damage (25-35 HP).\n` +
        `4. Describe the clash intensely in 2 lines, and state the damage as "DAMAGE: [number]" at the end.`;

    const result = await queryLLM(prompt, 0.7);
    return result ? result.trim() : null;
}

async function evaluatePvpUnmitigated(attackerChar, defenderChar, attackMove) {
    const prompt = 
        `The attacker "${attackerChar}" hit the completely undefended "${defenderChar}" with their attack "${attackMove}".\n\n` +
        `Evaluate the impact strictly according to canon power scaling:\n` +
        `1. Gojo's "Infinity" is passively active. If "${defenderChar}" is Satoru Gojo, standard attacks still deal 0 damage even if undefended, unless bypassed canonically.\n` +
        `2. Calculate damage (3-8 HP for basic strikes, 20-35 HP for high-level techniques).\n` +
        `3. Describe the impact intensely in 2 lines, stating the final damage as "DAMAGE: [number]" at the end.`;

    const result = await queryLLM(prompt, 0.7);
    return result ? result.trim() : null;
}

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
        `💥 *DIRECT IMPACT REPORT!* 💥\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${evaluation ? evaluation.replace(/DAMAGE:\s*\d+/i, '').trim() : `No defense was activated.`}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🛡️ *HP Status:*\n` +
        `• *${session.p1Char}* (@${session.p1.split('@')[0]}): \`${session.p1HP} HP\`\n` +
        `• *${session.p2Char}* (@${session.p2.split('@')[0]}): \`${session.p2HP} HP\``;

    await sock.sendMessage(jid, { text: report, mentions: [session.p1, session.p2] });
    await delay(2000);

    if (await checkPvpGameOver(sock, jid, session)) return;

    session.status = 'fighting';
    session.turn = defender;
    session.defender = attacker;

    const nextStrikeText = `👉 It is now @${session.turn.split('@')[0]}'s turn to strike!`;
    const prompt = await sock.sendMessage(jid, { text: nextStrikeText, mentions: [session.turn] });
    session.lastQuestionMsgId = prompt.key.id;
}

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
            await sock.sendMessage(jid, { text: "🤝 *BATTLE ENDED: IT'S A TIE!* 🤝" });
        } else {
            const victoryText = `🏆 *BATTLE RESOLVED: TIME UP!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🎉 @${winner.split('@')[0]} (*${winChar}*) wins the match on health advantage!`;
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
        const victoryCard = `🎉 *CONGRATULATIONS: ESCAPED!* 🎉\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🔓 You successfully cleared all 10 stages of the room and survived with *${session.lives}❤️* left!`;
        delete global.escapeSessions[sessionKey];
        return await sock.sendMessage(jid, { text: victoryCard });
    }

    const systemPrompt = 
        `You are the master of a creepy Escape Room adventure game. The player must clear 10 stages to escape. They currently have ${session.lives} lives remaining.\n` +
        `Generate Stage ${session.step} of 10. The scenario must be deeply eerie, cryptic, require logical thinking, and have zero reference to anime.\n` +
        `Provide exactly 3 choices (1, 2, 3).\n` +
        `If the user's choice is fatal or incorrect, they lose a life. If they lose a life, end your response with "LIFE_LOST" at the very end.\n` +
        `If they lose all lives, end your response with "GAME_OVER" at the very end. Limit the scenario narrative to 4 intense sentences.`;

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

// ============================================================================
// GAME COMMANDS
// ============================================================================

module.exports = [
    // 1. ANAGRAM GAME INITIATOR (.anagram)
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
                    buttons: [{ buttonId: `${settings.prefix}anagram_join`, buttonText: { displayText: 'Join Match 🎮' }, type: 1 }],
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

            if (session.players.length >= 4) return await sock.sendMessage(jid, { text: `❌ Sorry @${senderNumber}, the lobby is full!`, mentions: [senderJid] }, { quoted: msg });

            session.players.push(senderJid);
            session.scores[senderJid] = 0;
            session.lives[senderJid] = 3;

            const joinedCount = session.players.length;
            const listPlayers = session.players.map(p => `👤 @${p.split('@')[0]}`).join('\n');

            const lobbyButtons = {
                text: `👥 *ANAGRAM MULTIPLAYER LOBBY* 👥\n\n• Players: \`${joinedCount}/4\`\n${listPlayers}\n\n👉 Tap Join below!`,
                buttons: [{ buttonId: `${settings.prefix}anagram_join`, buttonText: { displayText: 'Join Match 🎮' }, type: 1 }],
                headerType: 1,
                mentions: session.players
            };

            try { await sock.sendMessage(jid, { delete: { remoteJid: jid, id: session.lobbyMsgId, fromMe: true } }); } catch (e) {}

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
                    resultLabel = `❌ *INCORRECT GUESS BY @${senderNumber}!* Correct word was *${correctWord}*.\n\n❤️ *Remaining Hearts:* \`${session.livesSP}/3\``;
                    if (session.livesSP <= 0) {
                        await sock.sendMessage(jid, { text: resultLabel });
                        const results = `📊 *ANAGRAM GAME OVER!* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *Player:* @${session.player.split('@')[0]}\n🎯 *Final Score:* \`${session.score}/10\``;
                        delete global.anagramSessions[sessionKey];
                        return await sock.sendMessage(jid, { text: results, mentions: [session.player] });
                    }
                } else {
                    session.lives[senderJid]--;
                    resultLabel = `❌ *INCORRECT GUESS BY @${senderNumber}!* Correct word was *${correctWord}*.\n\n❤️ *Remaining Hearts:* \`${session.lives[senderJid]}/3\``;
                    if (session.lives[senderJid] <= 0) resultMsg += `\n\n💀 @${senderNumber} has been *ELIMINATED*!`;
                }
            }

            await sock.sendMessage(jid, { text: resultLabel, mentions: [senderJid] }, { quoted: msg });

            session.currentQuestionIndex++;
            if (!isSingle) session.turnIndex = (session.turnIndex + 1) % session.players.length;

            await delay(1500);
            await askNextAnagram(sock, jid, sessionKey);
        }
    },

    // 5. WORD CHAIN / RING GAME (.wcg)
    {
        name: 'wcg',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0];

            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Word Chain is a multiplayer group-only module." }, { quoted: msg });
            if (global.wcgSessions[jid]) return await sock.sendMessage(jid, { text: "⚠️ Active Word Chain lobby already running." }, { quoted: msg });

            let difficulty = "dynamic"; // Default escalates dynamically: Easy -> Medium -> Hard
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
                buttons: [{ buttonId: `${settings.prefix}wcg_join`, buttonText: { displayText: 'Join Chain ⛓️' }, type: 1 }],
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

            if (session.players.length >= 10) return await sock.sendMessage(jid, { text: `❌ Lobby full!`, mentions: [senderJid] }, { quoted: msg });

            session.players.push(senderJid);
            const joinedCount = session.players.length;
            const listPlayers = session.players.map(p => `👤 @${p.split('@')[0]}`).join('\n');

            const lobbyButtons = {
                text: `⛓️ *WORD CHAIN GAME LOBBY* ⛓️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n• Joined: \`${joinedCount}/10\`\n${listPlayers}\n\n👉 Tap Join to enter!`,
                buttons: [{ buttonId: `${settings.prefix}wcg_join`, buttonText: { displayText: 'Join Chain ⛓️' }, type: 1 }],
                headerType: 1,
                mentions: session.players
            };

            try { await sock.sendMessage(jid, { delete: { remoteJid: jid, id: session.lobbyMsgId, fromMe: true } }); } catch (e) {}

            const updatedLobby = await sock.sendMessage(jid, lobbyButtons);
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
            if (activePlayer !== senderJid) return await sock.sendMessage(jid, { text: `⚠️ Wait your turn! Only @${activePlayer.split('@')[0]} is authorized to submit a word chain now.`, mentions: [activePlayer] }, { quoted: msg });

            if (session.timerId) clearTimeout(session.timerId);

            const word = args.trim().toUpperCase();

            if (!word) {
                session.players.splice(session.turnIndex, 1);
                await sock.sendMessage(jid, { text: `💀 @${senderNumber} failed to submit a word and has been *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                session.round++;
                await delay(1500);
                return await promptNextWcgTurn(sock, jid);
            }

            if (session.lastWord) {
                const targetLetter = session.lastWord.slice(-1).toUpperCase();
                if (word.charAt(0) !== targetLetter) {
                    session.players.splice(session.turnIndex, 1);
                    await sock.sendMessage(jid, { text: `💀 @${senderNumber} submitted a word starting with the wrong letter! (Must start with *"${targetLetter}"*). \n\n🔴 *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
                    session.round++;
                    await delay(1500);
                    return await promptNextWcgTurn(sock, jid);
                }
            }

            if (session.usedWords.includes(word)) {
                session.players.splice(session.turnIndex, 1);
                await sock.sendMessage(jid, { text: `💀 @${senderNumber} submitted a word that has already been used! \n\n🔴 *ELIMINATED*!`, mentions: [senderJid] }, { quoted: msg });
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

    // 8. WHO WANTS TO BE A MILLIONAIRE INITIATOR (.millionaire)
    {
        name: 'millionaire',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const sessionKey = jid + '_' + senderJid;

            if (global.millionaireSessions[sessionKey]) return await sock.sendMessage(jid, { text: `⚠️ Active session already running.` }, { quoted: msg });

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
                lifelines: { phone: true, fifty: true, audience: true, walk: true }
            };

            await sock.sendMessage(jid, { text: "💰 *Who Wants to Be a Millionaire Initialized!* Preparing Question 1/15..." }, { quoted: msg });
            await askNextMillionaireQuestion(sock, jid, sessionKey);
        }
    },

    // 9. MILLIONAIRE LIFELINES CONTROLLER (.millionaire_life)
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

                const prompt = await sock.sendMessage(jid, { text: `📞 *PHONE A FRIEND LIFELINE* \n\nWho would you like to call? Reply directly with character's name.` }, { quoted: msg });
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

                await sock.sendMessage(jid, { text: "✂️ `Eliminating two incorrect options...`" }, { quoted: msg });
                await delay(1500);
                await sendMillionaireDisplay(sock, jid, sessionKey);
            } 
            else if (lifeline === 'audience') {
                if (!session.lifelines.audience) return;
                session.lifelines.audience = false;
                if (session.timerId) clearTimeout(session.timerId);
                
                await sock.sendMessage(jid, { text: "📊 *Creating WhatsApp Poll for the Group...* 🗳️" }, { quoted: msg });

                const optionsLeft = session.currentOptions.filter(opt => {
                    const letter = opt.charAt(0).toLowerCase();
                    return !session.eliminatedOptions.includes(letter);
                });

                const pollMsg = await sock.sendMessage(jid, {
                    poll: {
                        name: `📊 Audience Poll: ${session.currentQuestion}`,
                        values: optionsLeft.map(o => o.trim()),
                        selectableCount: 1
                    }
                });

                session.pollId = pollMsg.key.id;
                session.status = 'poll_active';

                setTimeout(async () => {
                    const activeSession = global.millionaireSessions[sessionKey];
                    if (!activeSession || activeSession.status !== 'poll_active') return;

                    try { await sock.sendMessage(jid, { delete: pollMsg.key }); } catch (e) {}

                    const correctLetter = activeSession.correctAns.toUpperCase();
                    const remainingLetters = activeSession.currentOptions
                        .map(o => o.charAt(0).toUpperCase())
                        .filter(l => !activeSession.eliminatedOptions.includes(l.toLowerCase()));

                    const votes = {};
                    remainingLetters.forEach(l => {
                        votes[l] = l === correctLetter ? Math.floor(Math.random() * 31) + 55 : Math.floor(Math.random() * 20);
                    });

                    const highestOption = Object.keys(votes).reduce((a, b) => votes[a] > votes[b] ? a : b);
                    const matchingText = activeSession.currentOptions.find(o => o.startsWith(highestOption));

                    const resultsText = 
                        `📊 *AUDIENCE POLL CLOSED* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `The group has voted! Here is the highest voted option:\n\n` +
                        `🏆 *Option ${highestOption}:* ${matchingText || 'N/A'} (${votes[highestOption]}% of the votes)\n\n` +
                        `👉 Returning to your active question board...`;

                    await sock.sendMessage(jid, { text: resultsText });
                    await delay(2000);

                    activeSession.status = 'playing';
                    await sendMillionaireDisplay(sock, jid, sessionKey);
                }, 10000);
            } 
            else if (lifeline === 'walk') {
                delete global.millionaireSessions[sessionKey];
                const msgText = `💸 You walked away with accumulated wealth of *₦${session.money.toLocaleString()} WAT*!`;
                await sock.sendMessage(jid, { text: msgText, mentions: [senderJid] }, { quoted: msg });
            }
        }
    },

    // 10. MILLIONAIRE CALL FRIEND (.millionaire_call)
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

            await sock.sendMessage(jid, { text: `📞 Dialing ${characterName}...` }, { quoted: msg });
            await delay(1500);

            const isCorrect = Math.random() < 0.60;
            const letters = ['a', 'b', 'c', 'd'];

            let suggestedAns = session.correctAns.toLowerCase();
            if (!isCorrect) {
                const wrongLetters = letters.filter(l => l !== suggestedAns);
                suggestedAns = wrongLetters[Math.floor(Math.random() * wrongLetters.length)];
            }
            session.friendAnswer = suggestedAns;

            const prompt = `Act exactly as "${characterName}". Your friend is playing 'Who Wants to Be a Millionaire' and is calling you for help on this question: "${session.currentQuestion}". Give them option "${suggestedAns.toUpperCase()}" as your recommended option. Limit response to 2 sentences.`;
            const charResponse = await queryLLM(prompt, 0.85);

            const quoteText = 
                `📞 *PHONE CALL:* *${characterName.toUpperCase()}* 📞\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `🗣️ _"${charResponse || `I am fairly sure the answer is ${suggestedAns.toUpperCase()}!`}"_\n\n` +
                `❓ *GO WITH FRIEND'S CHOICE?* \n\nReply directly with "YES" or "NO".`;

            session.status = 'waiting_friend_decision';
            const decisionPrompt = await sock.sendMessage(jid, { text: quoteText }, { quoted: msg });
            session.lastQuestionMsgId = decisionPrompt.key.id;
        }
    },

    // 11. MILLIONAIRE FRIEND CHOICE DECISION (.millionaire_decision)
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
                await sock.sendMessage(jid, { text: "❌ Returning to question board..." });
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

                const correctMsg = `🎯 You answered *${submitted.toUpperCase()}* correctly!\n💰 Accumulated: *₦${session.money.toLocaleString()} WAT*\n\n👉 Preparing next question...`;
                await sock.sendMessage(jid, { text: correctMsg }, { quoted: msg });
                await delay(2000);
                await askNextMillionaireQuestion(sock, jid, sessionKey);
            } else {
                delete global.millionaireSessions[sessionKey];
                const failMsg = `❌ *WRONG ANSWER!* 💀\n\n🎯 Option was *${correctAns.toUpperCase()}*.\n🔴 *GAME OVER:* You leave with *₦${session.money.toLocaleString()} WAT*.`;
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

            if (global.torfSessions[sessionKey]) return await sock.sendMessage(jid, { text: "⚠️ Answer active question first!" }, { quoted: msg });

            await sock.sendMessage(jid, { text: `Generating a True/False statement...` }, { quoted: msg });

            const data = await generateTorfQuestion(category, []);
            if (!data) return await sock.sendMessage(jid, { text: "❌ Failed to retrieve question." }, { quoted: msg });

            global.torfSessions[sessionKey] = { question: data.q, ans: data.ans.toLowerCase().trim(), explanation: data.explanation };

            const torfCard = `📜 *TRUE OR FALSE CHALLENGE* 📜\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n📂 *Category:* \`${category}\`\n📝 *Statement:* \n"${data.q}"\n\nSelect answer:`;
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
                results = `🎉 *CORRECT!* \n\n🎯 Option *${submitted.toUpperCase()}* is correct!\n📖 Explanation: _${session.explanation}_`;
            } else {
                results = `❌ *INCORRECT!* \n\n🎯 Correct was *${correctAns.toUpperCase()}*.\n📖 Explanation: _${session.explanation}_`;
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

            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ PVP requires a Group Chat." }, { quoted: msg });
            if (global.pvpSessions[jid]) return await sock.sendMessage(jid, { text: "⚠️ Active PVP battle already running." }, { quoted: msg });

            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targetJid = mentions.length > 0 ? mentions[0] : '';
            if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Mention target opponent." }, { quoted: msg });

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
                movesLeft: { [senderJid]: 5, [targetJid]: 5 },
                timerId: null,
                lastQuestionMsgId: ''
            };

            const challengeCard = 
                `⚔️ *PVP LORE SHOWDOWN CHALLENGE* ⚔️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 Challenger: @${senderNumber} with *"${initiatorChar}"*\n` +
                `🎯 Target: @${targetNumber}\n\n` +
                `👉 @${targetNumber}, reply directly with your chosen character's name to begin!`;

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
                `🎮 *THE DUEL COMMENCES!* 🎮\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `⚔️ *Fighter 1:* *${session.p1Char}* (@${session.p1.split('@')[0]}) — HP: \`100\`\n` +
                `⚔️ *Fighter 2:* *${session.p2Char}* (@${session.p2.split('@')[0]}) — HP: \`100\`\n\n` +
                `👉 @${session.p1.split('@')[0]} (*${session.p1Char}*), you strike first! Reply to this message with your attack.`;

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

            if (session.turn !== senderJid) return await sock.sendMessage(jid, { text: `⚠️ Wait your turn! Only @${session.turn.split('@')[0]} can strike now.` }, { quoted: msg });

            const move = args ? args.trim() : '';
            if (!move) return;

            await sock.sendMessage(jid, { text: `⚔️ *Referee AI is evaluating attack "${move}"...*` }, { quoted: msg });

            const attackerChar = senderJid === session.p1 ? session.p1Char : session.p2Char;
            const validation = await evaluatePvpAttack(attackerChar, move);

            if (validation === "INVALID_MOVE") {
                const retryPrompt = await sock.sendMessage(jid, { text: `❌ *INVALID ATTACK:* *"${attackerChar}"* cannot execute *"${move}"*!\n\n👉 Please reply directly with a valid technique or basic strike.` }, { quoted: msg });
                session.lastQuestionMsgId = retryPrompt.key.id;
                return;
            }

            session.status = 'defending';
            session.lastAttack = move;
            session.attacker = senderJid;
            session.defender = senderJid === session.p1 ? session.p2 : session.p1;

            const defenderChar = session.defender === session.p1 ? session.p1Char : session.p2Char;

            const defensePrompt = 
                `🛡️ *DEFENSE WINDOW ACTIVE (15 Seconds)!* 🛡️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `⚔️ *Attack incoming:* *${attackerChar}* used *"${move}"*!\n\n` +
                `👉 @${session.defender.split('@')[0]} (*${defenderChar}*), reply directly to this message with a defense/counter move (e.g. Block, Dodge, Susanoo, Infinity, Parry)!`;

            const prompt = await sock.sendMessage(jid, { text: defensePrompt, mentions: [session.defender] }, { quoted: msg });
            session.lastQuestionMsgId = prompt.key.id;

            session.timerId = setTimeout(async () => {
                await handlePvpDefenseTimeout(sock, jid);
            }, 15000);
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
                `💥 *CLASH EVALUATION REPORT!* 💥\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `${evaluation ? evaluation.replace(/DAMAGE:\s*\d+/i, '').trim() : `${attackerChar} attacks.`}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🛡️ *HP Status:*\n` +
                `• *${session.p1Char}* (@${session.p1.split('@')[0]}): \`${session.p1HP} HP\`\n` +
                `• *${session.p2Char}* (@${session.p2.split('@')[0]}): \`${session.p2HP} HP\``;

            await sock.sendMessage(jid, { text: clashReport, mentions: [session.p1, session.p2] }, { quoted: msg });
            await delay(2000);

            if (await checkPvpGameOver(sock, jid, session)) return;

            session.status = 'fighting';
            session.turn = session.defender;
            session.defender = session.attacker;

            const nextStrikeText = `👉 It is now @${session.turn.split('@')[0]}'s turn to strike!`;
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

            if (global.escapeSessions[sessionKey]) return await sock.sendMessage(jid, { text: "⚠️ Active escape room already running." }, { quoted: msg });

            global.escapeSessions[sessionKey] = { player: senderJid, step: 1, lives: 5, lastQuestionMsgId: '' };
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
            if (!['1', '2', '3'].includes(choice)) return await sock.sendMessage(jid, { text: "❌ Invalid choice!" }, { quoted: msg });

            await sock.sendMessage(jid, { text: "💾 `Processing stage...`" }, { quoted: msg });

            session.step++;
            await promptNextEscapeStep(sock, jid, sessionKey);
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'anagram') aliases.push({ ...cmd, name: 'anagrams' });
    if (cmd.name === 'wcg') {
        aliases.push({ ...cmd, name: 'wrg' });
        aliases.push({ ...cmd, name: 'wordchain' });
    }
});
module.exports.push(...aliases);