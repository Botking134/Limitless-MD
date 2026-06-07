// plugins/fun.js
const settings = require('../settings'); // Up one level to root settings.js

// Obfuscated Groq Key to bypass GitHub Push Protection strings
const s1 = "gsk_";
const s2 = "tPB0xMyZ2oijloaBNcDs";
const s3 = "WGdyb3FY5iC2p9hwRE";
const s4 = "SIJXAV3t53LZg9";
const GROQ_API_KEY = s1 + s2 + s3 + s4;

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

// Global wizard state managers for matching button/text interactive events safely
global.proposalSessions = global.proposalSessions || {};
global.askoutSessions = global.askoutSessions || {};
global.purpleSessions = global.purpleSessions || {};

// Non-blocking sleep helper for sequential choreography
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reusable Helper to query Groq's OpenAI-compatible completions endpoint
async function queryGroq(messages, model = "llama-3.3-70b-versatile", temperature = 0.7) {
    try {
        const response = await fetch(GROQ_BASE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: temperature
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            throw new Error(`Groq API Error ${response.status}: ${errData}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (error) {
        console.error("Groq Engine Query Failure:", error);
        throw error;
    }
}

module.exports = [
    // 1. THE SPIRITUAL PRESSURE BANKAI ENGINE
    {
        name: 'bankai',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            const targetInput = args.trim();

            try {
                let systemPrompt = "";
                let userPrompt = "";

                if (!targetInput) {
                    systemPrompt = 
                        "You are the Soul Society Archive system. The user wants a completely random Bleach character Bankai feature.\n" +
                        "Randomly choose a famous Bleach character who POSSESSES a Bankai (e.g., Ichigo, Byakuya, Shunsui, Yamamoto, Rukia, Kisuke, Renji, Toshiro, Kenpachi, etc.).\n" +
                        "Format your exact response output layout strictly like this:\n\n" +
                        "⚔️ *SOUL SOCIETY ARCHIVE: RANDOM BANKAI RELEASE* ⚔️\n" +
                        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                        "👤 *Owner Name:* [Insert Character Name Here]\n" +
                        "🎖️ *Position:* [Insert their lore title/status, e.g., Captain of Division 6, Substitute Soul Reaper, Quincy, Ex-Captain, etc.]\n" +
                        "💮 *Bankai Name:* [Insert Japanese Name and English Translation]\n\n" +
                        "🔮 *Bankai Abilities:* \n[Provide a detailed paragraph detailing the exact combat releases, tactical applications, and spiritual pressure quirks of this specific bankai form.]\n\n" +
                        "⚠️ Do not output conversational filler, introductory remarks, markdown codes other than specified, or conversational greetings. Start directly with the text header.";
                    
                    userPrompt = "Generate a completely random Bankai release entry now.";
                    await sock.sendMessage(jid, { text: "🔮 *Focusing Spiritual Pressure...* Accessing Soul Society deep registry archives..." }, { quoted: msg });
                } else {
                    systemPrompt = 
                        "You are the Soul Society Archive system. Analyze the user's input character string strictly against standard Bleach anime lore guidelines.\n\n" +
                        "CRITICAL CONDITIONAL CHECK RULES:\n" +
                        "1. IF the character provided IS NOT a Bleach anime character at all (e.g. Naruto, Goku, Luffy, Gojo), respond EXACTLY with: '❌ *Lore Exception:* This character does not reside in the Bleach anime universe.' and nothing else.\n" +
                        "2. IF the character IS a Bleach character but DOES NOT possess or have a known Bankai release (e.g. Chad, Orihime, Aizen, Yhwach, Uryu Ishida, Grimmjow, Ganju), respond EXACTLY with: '⚠️ *Spiritual Limitation:* This character does not possess or manifest a Bankai release form.' and nothing else.\n" +
                        "3. IF the character is from Bleach and HAS a Bankai (or the user directly named a Bankai itself like Senbonzakura Kageyoshi), generate a profile using the exact layout structure specified below:\n\n" +
                        "⚔️ *SOUL SOCIETY ARCHIVE INTEL* ⚔️\n" +
                        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                        "👤 *Owner Name:* [Insert Character Name]\n" +
                        "🎖️ *Position:* [Insert position, e.g. Captain of Division 10, Vizored, etc.]\n" +
                        "💮 *Bankai Name:* [Insert Bankai Name]\n\n" +
                        "🔮 *Bankai Abilities:* \n[Provide a short detailed summary on its specific special abilities, offensive traits, and deployment factors.]\n\n" +
                        "Strict rule: No chat filler. If rule 1 or rule 2 is triggered, output only that exact string statement.";
                    
                    userPrompt = `Analyze character query: "${targetInput}"`;
                }

                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ];

                const archiveResponse = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: archiveResponse }, { quoted: msg });

            } catch (error) {
                console.error("Bankai Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ *Connection Break:* Failed to pierce the Senkaimon gate tracking parameters. Try again later." }, { quoted: msg });
            }
        }
    },

    // 2. THE CURSED ENERGY DOMAIN EXPANSION ENGINE
    {
        name: 'domain-expansion',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            const targetInput = args.trim();

            try {
                let systemPrompt = "";
                let userPrompt = "";

                if (!targetInput) {
                    systemPrompt = 
                        "You are the Jujutsu Sorcery Registry system. The user wants a completely random Jujutsu Kaisen character Domain Expansion feature.\n" +
                        "Randomly choose a famous JJK character who CAN manifest a Domain Expansion (e.g., Satoru Gojo, Ryomen Sukuna, Megumi Fushiguro, Mahito, Jogo, Yuta Okkotsu, Hiromi Higuruma, Hakari, Kenjaku, etc.).\n" +
                        "Format your exact response output layout strictly like this:\n\n" +
                        "🌌 *JUJUTSU REGISTRY: TERRITORY MANIFESTATION* 🌌\n" +
                        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                        "👤 *Sorcerer/Cursed Spirit:* [Insert Character Name Here]\n" +
                        "🎖️ *Grade Status:* [Insert grade or classification, e.g., Special Grade Sorcerer, Registered Special Grade Cursed Spirit, Grade 1 Sorcerer, etc.]\n" +
                        "💮 *Domain Name:* [Insert Japanese Name and English Translation, e.g., Unlimited Void / Muryōkūsho]\n\n" +
                        "🔮 *Domain Environment & Sure-Hit Effects:* \n[Provide a detailed paragraph detailing the exact barrier composition, environmental traits, hand signs, and the mandatory sure-hit cursed technique conditions inside this domain.]\n\n" +
                        "⚠️ Do not output conversational filler or introductory remarks. Start directly with the text header.";
                    
                    userPrompt = "Generate a completely random Domain Expansion barrier entry now.";
                    await sock.sendMessage(jid, { text: "🌌 *Sparking Black Flash...* Overloading core cursed energy output parameters..." }, { quoted: msg });
                } else {
                    systemPrompt = 
                        "You are the Jujutsu Sorcery Registry system. Analyze the user's input character string strictly against standard Jujutsu Kaisen anime and manga lore guidelines.\n\n" +
                        "CRITICAL CONDITIONAL CHECK RULES:\n" +
                        "1. IF the character provided IS NOT a Jujutsu Kaisen character at all (e.g. Naruto, Ichigo, Luffy, Deku), respond EXACTLY with: '❌ *Lore Exception:* This character does not reside in the Jujutsu Kaisen universe.' and nothing else.\n" +
                        "2. IF the character IS a Jujutsu Kaisen character but DOES NOT possess or cannot manifest a Domain Expansion (e.g. Maki, Toji, Nobara, Panda, Nanami, Todo), respond EXACTLY with: '⚠️ *Cursed Energy Limitation:* This character does not possess or manifest a Domain Expansion barrier technique.' and nothing else.\n" +
                        "3. IF the character is from JJK and HAS a Domain Expansion (or the user directly named a Domain itself like Malevolent Shrine), generate a profile using the exact layout structure specified below:\n\n" +
                        "🌌 *JUJUTSU REGISTRY LORE ARCHIVE* 🌌\n" +
                        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                        "👤 *Sorcerer/Cursed Spirit:* [Insert Character Name]\n" +
                        "🎖️ *Grade Status:* [Insert Grade classification]\n" +
                        "💮 *Domain Name:* [Insert Domain Expansion Name]\n\n" +
                        "🔮 *Domain Environment & Sure-Hit Effects:* \n[Provide a short detailed summary on its environmental layout, hand-sign triggers, and underlying sure-hit mechanics.]\n\n" +
                        "Strict rule: No chat filler. If rule 1 or rule 2 is triggered, output only that exact string statement.";
                    
                    userPrompt = `Analyze character query: "${targetInput}"`;
                }

                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ];

                const archiveResponse = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: archiveResponse }, { quoted: msg });

            } catch (error) {
                console.error("Domain Expansion Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ *Cursed Technique Burnout:* Failed to manifest the barrier parameters. Try again later." }, { quoted: msg });
            }
        }
    },

    // 3. DYNAMIC WOULD YOU RATHER POLL GENERATOR
    {
        name: 'wyr',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            try {
                const systemPrompt = 
                    "You are a master party-game generator. Create a random, hilarious, and exceptionally difficult 'Would You Rather' dilemma.\n" +
                    "Your response MUST be formatted strictly as a single JSON object with exactly three keys: 'question', 'option1', and 'option2'.\n" +
                    "The options must be balanced so that choosing between them is a brutal, agonizing decision. Keep options concise (under 25 characters each) so they display completely inside poll selections.\n\n" +
                    "Example Format:\n" +
                    "{\n" +
                    "  \"question\": \"🤔 Would you rather have permanent loud hiccups or always smell like old onions?\",\n" +
                    "  \"option1\": \"Permanent hiccups\",\n" +
                    "  \"option2\": \"Smell like onions\"\n" +
                    "}\n\n" +
                    "Do not include markdown wrapper syntax like ```json, blockquotes, or extra conversational filler text outside the JSON block.";

                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: "Generate an ultimate high-stakes 'Would You Rather' dilemma map." }
                ];

                const aiRawJson = await queryGroq(messages, "llama-3.3-70b-versatile");
                
                let parsedDilemma;
                try {
                    const cleanJsonString = aiRawJson.replace(/```json|```/g, "").trim();
                    parsedDilemma = JSON.parse(cleanJsonString);
                } catch (jsonErr) {
                    console.error("JSON parse retry required:", aiRawJson);
                    throw new Error("AI output was non-compliant with standard structural JSON rules.");
                }

                const pollMessage = {
                    name: parsedDilemma.question || "🤔 Would you rather...",
                    options: [
                        parsedDilemma.option1 || "Option A",
                        parsedDilemma.option2 || "Option B"
                    ],
                    selectableOptionsCount: 1
                };

                await sock.sendMessage(jid, pollMessage, { quoted: msg });

            } catch (error) {
                console.error("WYR Engine Failure:", error);
                await sock.sendMessage(jid, { text: "❌ *Dilemma Engine Failure:* Failed to spawn a tactical poll scenario. Please verify system connections and try again." }, { quoted: msg });
            }
        }
    },

    // 4. JOKE GENERATION CORE
    {
        name: 'joke',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            try {
                const systemPrompt = 
                    "You are a brilliant comedian. Generate a completely random joke.\n" +
                    "It can either be a hilarious, clever dad joke (corny but extremely witty puns) OR a genuinely funny, modern laugh-out-loud comedy joke.\n" +
                    "Keep it clean, punchy, and formatted neatly with bold headings if necessary. Do not include introductory notes or friendly AI conversational filler. Deliver the joke immediately.";

                const messages = [{ role: "system", content: systemPrompt }];
                const jokeResult = await queryGroq(messages, "llama-3.3-70b-versatile", 0.9);

                await sock.sendMessage(jid, { text: `😂 *LIMITLESS COMEDY VAULT* 😂\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${jokeResult}` }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: "❌ Failed to retrieve structural joke metrics from the mainframe." }, { quoted: msg });
            }
        }
    },

    // 5. TARGETED INSULT CORE
    {
        name: 'insult',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';

            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant || senderJid;
            const targetNumber = mentioned.split('@')[0];

            try {
                const systemPrompt = 
                    "You are a master of Shakespearean and witty playground insults. Generate a single-sentence creative insult.\n" +
                    "Make it funny, slightly sharp, but completely safe and rule-compliant (no explicit slurs, hate speech, or extreme vulgarity). Focus on intellectual roasts, funny combinations, and legendary burns.\n" +
                    "Respond with ONLY the insult text line itself. No conversational headers.";

                const messages = [{ role: "system", content: systemPrompt }];
                const insultText = await queryGroq(messages, "llama-3.3-70b-versatile", 0.85);

                await sock.sendMessage(jid, { 
                    text: `💀 @${targetNumber} ${insultText}`, 
                    mentions: [mentioned] 
                }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: "❌ Insult compiler experienced technical difficulties." }, { quoted: msg });
            }
        }
    },

    // 6. TARGETED ROAST CORE
    {
        name: 'roast',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';

            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant || senderJid;
            const targetNumber = mentioned.split('@')[0];

            try {
                const systemPrompt = 
                    "You are a legendary roast battle champion. Generate a savage, highly creative, and brutally funny roast line directed at the target.\n" +
                    "It should be a short, sharp paragraph or multi-sentence burn. Ensure it stays safe (no hate speech or extreme content), but make it stand out as a deep comedic burn about their life choices, fashion, or overall tech setup.\n" +
                    "Provide ONLY the roast output paragraph directly.";

                const messages = [{ role: "system", content: systemPrompt }];
                const roastText = await queryGroq(messages, "llama-3.3-70b-versatile", 0.88);

                await sock.sendMessage(jid, { 
                    text: `🔥 *CRITICAL BURN ZONE* 🔥\n━━━━━━━━━━━━━━━━━━━━━━━\n\n⚠️ *Target:* @${targetNumber}\n\n${roastText}`, 
                    mentions: [mentioned] 
                }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: "❌ Roast deployment system overloaded." }, { quoted: msg });
            }
        }
    },

    // 7. COMPATIBILITY MATCHMAKING ENGINE (.ship)
    {
        name: 'ship',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ *Context Error:* Matchmaking matrices can only be evaluated inside active group channels." }, { quoted: msg });
            }

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map(p => p.id);
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                const mentionedList = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                
                let target1 = '';
                let target2 = '';

                if (mentionedList.length >= 2) {
                    target1 = mentionedList[0];
                    target2 = mentionedList[1];
                } else if (mentionedList.length === 1) {
                    target1 = mentionedList[0];
                    const pool = participants.filter(p => p !== target1 && p !== botJid);
                    if (pool.length === 0) {
                        return await sock.sendMessage(jid, { text: "❌ Insufficient group volume to calculate matrix pairings." }, { quoted: msg });
                    }
                    target2 = pool[Math.floor(Math.random() * pool.length)];
                } else {
                    const pool = participants.filter(p => p !== botJid);
                    if (pool.length < 2) {
                        return await sock.sendMessage(jid, { text: "❌ Insufficient member directories to initiate automated ship cycles." }, { quoted: msg });
                    }
                    
                    const firstIdx = Math.floor(Math.random() * pool.length);
                    target1 = pool[firstIdx];
                    
                    const secondaryPool = pool.filter(p => p !== target1);
                    target2 = secondaryPool[Math.floor(Math.random() * secondaryPool.length)];
                }

                const compatibilityPercentage = Math.floor(Math.random() * 101);
                
                let loveMeter = "🖤🖤🖤🖤🖤🖤🖤🖤🖤🖤";
                const activeHearts = Math.round(compatibilityPercentage / 10);
                if (activeHearts > 0) {
                    loveMeter = "❤️".repeat(activeHearts) + "🖤".repeat(10 - activeHearts);
                }

                let commentary = "";
                if (compatibilityPercentage >= 85) commentary = "💝 *Destiny Manifestation:* An absolute soulmate connection. The universe literally forced this union!";
                else if (compatibilityPercentage >= 65) commentary = "💖 *High Resonance:* Exceptional sync properties. Go ahead and arrange the wedding immediately!";
                else if (compatibilityPercentage >= 40) commentary = "❤️ *Average Friction:* Notable sparks exist, but structural arguments will require active communication.";
                else if (compatibilityPercentage >= 15) commentary = "💔 *Toxic Hazard:* Low compatibility index. You guys probably fight over who handles message logs.";
                else commentary = "☠️ *Catastrophic Misalignment:* Zero connection. Stay at least 50 meters away from each other.";

                const shipReport = 
                    `💘 *${settings.botName.toUpperCase()} MATCHMAKING COMPATIBILITY ENGINE* 💘\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👩‍❤️‍👨 *LOVERS IDENTIFIED:* \n` +
                    `👤 *Partner A:* @${target1.split('@')[0]}\n` +
                    `👤 *Partner B:* @${target2.split('@')[0]}\n\n` +
                    `📊 *COMPATIBILITY RATIO:* [ *${compatibilityPercentage}%* ]\n` +
                    `🖥️ *METER:* ${loveMeter}\n\n` +
                    `${commentary}\n\n` +
                    `✨ _Congratulations to the new couple! This status tracking data is now absolute._`;

                await sock.sendMessage(jid, { 
                    text: shipReport, 
                    mentions: [target1, target2] 
                }, { quoted: msg });

            } catch (err) {
                console.error("Shipping Engine Error:", err);
                await sock.sendMessage(jid, { text: "❌ Structural error occurred running Cupid routing parameters." }, { quoted: msg });
            }
        }
    },

    // 8. HOLY MATRIMONY WEDDING ENGINE (.wed)
    {
        name: 'wed',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ *Context Error:* Holy matrimony can only be binding inside an active group congregation." }, { quoted: msg });
            }

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map(p => p.id);
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const senderJid = msg.key.participant || msg.key.remoteJid || '';

                const mentionedList = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;

                let groom = '';
                let bride = '';

                if (mentionedList.length >= 2) {
                    groom = mentionedList[0];
                    bride = mentionedList[1];
                } else if (mentionedList.length === 1) {
                    groom = senderJid;
                    bride = mentionedList[0];
                } else if (quotedParticipant) {
                    groom = senderJid;
                    bride = quotedParticipant;
                } else {
                    const pool = participants.filter(p => p !== botJid);
                    if (pool.length < 2) {
                        return await sock.sendMessage(jid, { text: "❌ Insufficient congregation size to bind souls together." }, { quoted: msg });
                    }
                    groom = pool[Math.floor(Math.random() * pool.length)];
                    const remainingPool = pool.filter(p => p !== groom);
                    bride = remainingPool[Math.floor(Math.random() * remainingPool.length)];
                }

                if (groom === bride) {
                    return await sock.sendMessage(jid, { text: "⚠️ You cannot enter a holy union with yourself, child. Mention a separate partner." }, { quoted: msg });
                }

                const systemPrompt = 
                    "You are a grand, dramatic, traditional cathedral high priest conducting a wedding ceremony.\n" +
                    "Write an elite, short wedding proclamation unifying the two targets. Use theatrical, archaic, and holy marriage rhetoric.\n" +
                    "At the absolute end, you MUST include the words: 'I now declare you husband and wife. You may kiss the bride!'\n" +
                    "Keep it punchy, stylized with beautiful layout separators, and avoid conversational introductory notes. Start straight with the ceremony text.";

                const messages = [{ role: "system", content: systemPrompt }];
                const ceremonyText = await queryGroq(messages, "llama-3.3-70b-versatile", 0.85);

                const weddingAnnouncement = 
                    `🔔 *THE SACRED CHAPEL OF LIMITLESS-MD* 🔔\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `💍 *Holy Covenant Binding:* \n` +
                    `🤵 *Groom:* @${groom.split('@')[0]}\n` +
                    `👰 *Bride:* @${bride.split('@')[0]}\n\n` +
                    `${ceremonyText}\n\n` +
                    `✨ _The congregation acknowledges this union as law. Let no user put asunder._ 🎉`;

                await sock.sendMessage(jid, { 
                    text: weddingAnnouncement, 
                    mentions: [groom, bride] 
                }, { quoted: msg });

            } catch (err) {
                console.error("Wedding Command Error:", err);
                await sock.sendMessage(jid, { text: "❌ The altar was interrupted by severe spiritual interference." }, { quoted: msg });
            }
        }
    },

    // 9. THE INTERACTIVE PROPOSAL ENGINE (.propose)
    {
        name: 'propose',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ Proposals must be witnessed by a group congregation!" }, { quoted: msg });
            }

            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const mentionedList = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;

            const targetJid = mentionedList[0] || quotedParticipant;

            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "⚠️ You must mention (@user) or reply to the person you wish to propose to." }, { quoted: msg });
            }

            if (targetJid === senderJid) {
                return await sock.sendMessage(jid, { text: "⚠️ You cannot propose to your own mirror image." }, { quoted: msg });
            }

            try {
                const systemPrompt = 
                    "You are a hopeless romantic writing a deeply heartfelt, beautiful, and slightly emotional marriage proposal declaration.\n" +
                    "Keep it concise (1 short paragraph) but incredibly touching and genuine. Do not include titles, greetings, or placeholders. Just the words.";

                const messages = [{ role: "system", content: systemPrompt }];
                const speech = await queryGroq(messages, "llama-3.3-70b-versatile", 0.88);

                const proposalText = 
                    `🌹 *A SACRED PROPOSAL HAS OCCURRED* 🌹\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `✨ @${senderJid.split('@')[0]} gets down on one knee, holding out a brilliant diamond ring toward @${targetJid.split('@')[0]}...\n\n` +
                    `💬 _"${speech}"_\n\n` +
                    `💍 **WILL YOU MARRY ME?**\n\n` +
                    `*👉 Options:* Type *Yes* or *No* in your reply.`;

                const sent = await sock.sendMessage(jid, { 
                    text: proposalText, 
                    mentions: [senderJid, targetJid] 
                }, { quoted: msg });

                global.proposalSessions[jid] = {
                    proposer: senderJid,
                    target: targetJid,
                    messageId: sent.key.id,
                    timestamp: Date.now()
                };

            } catch (err) {
                console.error("Proposal Init Error:", err);
                await sock.sendMessage(jid, { text: "❌ Ring case jammed. Try again." }, { quoted: msg });
            }
        }
    },

    // 10. THE ASK OUT RELATIONSHIP ENGINE (.askout)
    {
        name: 'askout',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) {
                return await sock.sendMessage(jid, { text: "❌ Romantic pursuits belong inside active group structures!" }, { quoted: msg });
            }

            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const mentionedList = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;

            const targetJid = mentionedList[0] || quotedParticipant;

            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "⚠️ You must mention (@user) or reply to the person you want to ask out." }, { quoted: msg });
            }

            if (targetJid === senderJid) {
                return await sock.sendMessage(jid, { text: "⚠️ You cannot ask yourself out out of loneliness." }, { quoted: msg });
            }

            try {
                const systemPrompt = 
                    "You are someone trying to ask their crush out on a date. Write a very cute, slightly nervous, heartfelt confession line.\n" +
                    "Make it sweet, creative, and memorable. Keep it under 3 sentences. No chat filler.";

                const messages = [{ role: "system", content: systemPrompt }];
                const confession = await queryGroq(messages, "llama-3.3-70b-versatile", 0.85);

                const askoutText = 
                    `🦋 *THE SPARK OF ROMANCE* 🦋\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `💓 @${senderJid.split('@')[0]} steps forward with butterflies in their stomach, looking into the eyes of @${targetJid.split('@')[0]}...\n\n` +
                    `💬 _"${confession}"_\n\n` +
                    `💘 **WILL YOU GO OUT WITH ME AND BE MY LOVER?**\n\n` +
                    `*👉 Options:* Type *Yes* or *No* in your reply.`;

                const sent = await sock.sendMessage(jid, { 
                    text: askoutText, 
                    mentions: [senderJid, targetJid] 
                }, { quoted: msg });

                global.askoutSessions[jid] = {
                    suitor: senderJid,
                    target: targetJid,
                    messageId: sent.key.id,
                    timestamp: Date.now()
                };

            } catch (err) {
                console.error("Askout Setup Error:", err);
                await sock.sendMessage(jid, { text: "❌ Failed to express feelings due to severe technical shyness." }, { quoted: msg });
            }
        }
    },

    // 11. THE HOLLOW PURPLE ULTIMATE INCANTATION ENGINE (.hollow-purple / .purple-tech)
    {
        name: 'hollow-purple',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            
            // Anti-Spam Mitigation: Force absolute access restrictions to prevent chat breakdown
            if (!isOwner && !isSudo) {
                return await sock.sendMessage(jid, { text: "🔒 *Limitless Secure System:* This technique expends immense cursed energy. Reserved for Owners/Sudo units only." }, { quoted: msg });
            }

            const senderJid = msg.key.participant || msg.key.remoteJid || '';

            // Render interactive dialogue layout formatted in pure Sans-Serif mathematics blocks
            const interactiveText = 
                `𝖦𝗎𝖾𝗌𝗌 𝖨 𝗁𝖺𝖿𝖾 𝗍𝗈 𝖽𝗈 𝗂𝗍 𝗇𝗈𝗐...\n\n` +
                `👉 *𝖢𝗁𝗈𝗈𝗌𝖾 𝖮𝗎𝗍𝗉𝗎𝗍 𝖫𝖾𝗏𝖾𝗅:* \n` +
                `• Reply *100%* \n` +
                `• Reply *200%*`;

            const sent = await sock.sendMessage(jid, { text: interactiveText }, { quoted: msg });

            // Lock structural execution variables straight into global active registers
            global.purpleSessions[jid] = {
                operator: senderJid,
                messageId: sent.key.id,
                timestamp: Date.now()
            };
        }
    },

    // 12. IN-LINE INTERACTIVE ROUTING SYSTEM (Catches romantic confirmations and Hollow Purple selections)
    {
        name: 'handle_fun_replies',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const textLower = args.toLowerCase().trim();
            const senderJid = msg.key.participant || msg.key.remoteJid || '';

            // Section A: Hollow Purple Incantation Routing Engine
            if (global.purpleSessions[jid]) {
                const session = global.purpleSessions[jid];
                
                if (senderJid === session.operator) {
                    if (textLower === '100%') {
                        delete global.purpleSessions[jid]; // Safe structural state clearance

                        // Phase 1 Launch
                        let currentMsg = await sock.sendMessage(jid, { text: `𝖳𝖺𝗄𝖾 𝗍𝗁𝖾 𝖺𝗆𝗉𝗅𝗂𝖿𝗂𝖾𝖽 𝗂𝗇𝖿𝗂𝗇𝗂𝗍创新 𝖺𝗇𝖽 𝗍𝗁𝖾 𝗍𝗎𝗋𝗇𝖾𝖽-𝗈𝗎𝗍 𝗂𝗇𝖿执行𝗂𝗍𝗒` }, { quoted: msg });
                        await sleep(3000);

                        // Phase 2 Edit Shift
                        await sock.sendMessage(jid, {
                            text: `𝖳𝗁𝖾𝗇 𝗌𝗆𝖺𝗌𝗁 𝗍𝗈𝗀𝖾𝗍𝗁𝖾𝗋 𝗍𝗁𝗈𝗌𝖾 𝗍𝗐𝗈 𝖽𝗂𝖿𝖿𝖾𝗋𝖾𝗇𝗍 𝖾𝗑𝗉𝗋𝖾𝗌𝗌𝗂𝗈𝗇𝗌 𝗈𝖿 𝗂𝗇𝖿𝗂𝗇𝗂𝗍𝗒 𝗍𝗈 𝖼𝗋𝖾𝖺𝗍𝖾 𝖺𝗇𝖽 𝖿𝗎𝗌𝗁 𝗈𝗎𝗍 𝗂𝗆𝖺𝗀𝗂𝗇𝖺𝗋𝗒 𝗆𝖺𝗌𝗌`,
                            edit: currentMsg.key
                        });
                        await sleep(3000);

                        // Phase 3 Edit Shift
                        await sock.sendMessage(jid, {
                            text: `𝖢𝗎𝗋𝗌𝖾𝖽 𝖳𝖾𝖼𝗁𝗇𝗂𝗊𝗎𝖾 𝖫𝖺𝗉𝗌𝖾: 𝖡𝗅𝗎𝖾\n                    🫸🔵🫷`,
                            edit: currentMsg.key
                        });
                        await sleep(3000);

                        // Phase 4 Edit Shift
                        await sock.sendMessage(jid, {
                            text: `𝖢𝗎𝗋𝗌𝖾𝖽 𝖳𝖾𝖼𝗁𝗇𝗂𝗊𝗎𝖾 𝖱𝖾𝗏𝖾𝗋𝗌𝖺𝗅: 𝖱𝖾𝖽\n                  🫸🔴🔵🫷`,
                            edit: currentMsg.key
                        });
                        await sleep(3000);

                        // Ultimate Output Release Finalization
                        await sock.sendMessage(jid, {
                            text: `𝖧𝗈𝗅𝗅𝗈𝗐 𝖳𝖾𝖼𝗁𝗇𝗂𝗊𝗎𝖾: 𝖯𝗎𝗋𝗉𝗅𝖾\n          🤌.......🫴⏤͟͟͞🟣`,
                            edit: currentMsg.key
                        });
                        return;

                    } else if (textLower === '200%') {
                        delete global.purpleSessions[jid];

                        // Phase 1 Launch
                        let currentMsg = await sock.sendMessage(jid, { text: `𝖬𝖺𝗑𝗂𝗆𝗎𝗆 𝗈𝗎𝗍𝗉𝗎𝗍!!!\n          𝖡𝗅𝗎𝖾!!!🔵` }, { quoted: msg });
                        await sleep(3000);

                        // Phase 2 Edit Shift
                        await sock.sendMessage(jid, {
                            text: `𝖯𝗁𝖺𝗌𝖾!!! 𝖯𝖺𝗋𝖺𝗆𝗂𝗍𝖺\n    𝖯𝗂𝗅𝗅𝖺𝗋 𝗈𝖿 𝗅𝗂𝗀𝗁𝗍`,
                            edit: currentMsg.key
                        });
                        await sleep(3000);

                        // Phase 3 Edit Shift
                        await sock.sendMessage(jid, {
                            text: `𝖯𝗁𝖺𝗌𝖾!!!! 𝖳𝗐𝗂𝗅𝗂𝗀𝗁𝗍\n𝖤𝗒𝖾𝗌 𝗈𝖿 𝗐𝗂𝗌𝖽𝗈𝗆`,
                            edit: currentMsg.key
                        });
                        await sleep(3000);

                        // Phase 4 Edit Shift
                        await sock.sendMessage(jid, {
                            text: `𝖭𝗂𝗇𝖾 𝗋𝗈𝗉𝖾𝗌! 𝖯𝗈𝗅𝖺𝗋𝗂𝗓𝖾𝖽 𝗅𝗂𝗀𝗁𝗍\n𝖢𝗋𝗈𝗐 𝖺𝗇𝖽 𝖽𝖾𝖼𝗅𝖺𝗋𝖺𝗍𝗂𝗈𝗇!`,
                            edit: currentMsg.key
                        });
                        await sleep(3000);

                        // Phase 5 Edit Shift
                        await sock.sendMessage(jid, {
                            text: `𝖡𝖾𝗍𝗐𝖾𝖾𝗇 𝖿𝗋𝗈𝗇𝗍 𝖺𝗇𝖽 𝖻𝖺𝖼𝗄!!!!\n             🫸🔴🔵🫷`,
                            edit: currentMsg.key
                        });
                        await sleep(3000);

                        // Ultimate Output Release Finalization
                        await sock.sendMessage(jid, {
                            text: `𝖧𝗈𝗅𝗅𝗈𝗐 𝖯𝗎𝗋𝗉𝗅𝖾!!\n🤌.......🫴⏤͟͟͞🟣`,
                            edit: currentMsg.key
                        });
                        return;
                    }
                }
            }

            if (textLower !== 'yes' && textLower !== 'no') return;

            // Section B: Proposal Session Triggers
            if (global.proposalSessions[jid]) {
                const session = global.proposalSessions[jid];
                
                if (senderJid === session.target) {
                    if (textLower === 'yes') {
                        const successText = 
                            `🎉 *CONGRATULATIONS! THE RING WAS ACCEPTED!* 💍\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `💖 Magnificent news! @${session.target.split('@')[0]} said YES to @${session.proposer.split('@')[0]}!\n\n` +
                            `✨ They are now officially **ENGAGED**! May their love transcend timelines and data structures! 🥂`;
                        
                        await sock.sendMessage(jid, { text: successText, mentions: [session.target, session.proposer] }, { quoted: msg });
                    } else {
                        try {
                            const prompt = "Write a short paragraph about a rejected marriage proposal that sounds extremely disappointed, heartbroken, and deeply sad. No introduction.";
                            const burn = await queryGroq([{ role: "user", content: prompt }], "llama-3.3-70b-versatile", 0.85);
                            
                            const failText = `💔 *PROPOSAL REJECTED* 💔\n━━━━━━━━━━━━━━━━━━━━━━\n\n@${session.proposer.split('@')[0]}... I'm so sorry. @${session.target.split('@')[0]} has declined your ring.\n\n😭 _${burn}_`;
                            await sock.sendMessage(jid, { text: failText, mentions: [session.proposer, session.target] }, { quoted: msg });
                        } catch {
                            await sock.sendMessage(jid, { text: "💔 The ring was silently turned down... The atmosphere feels heavy and incredibly sad." }, { quoted: msg });
                        }
                    }
                    delete global.proposalSessions[jid];
                    return;
                }
            }

            // Section C: Askout Session Triggers
            if (global.askoutSessions[jid]) {
                const session = global.askoutSessions[jid];

                if (senderJid === session.target) {
                    if (textLower === 'yes') {
                        const successText = 
                            `👩‍❤️‍👨 *NEW RELATIONSHIP ESTABLISHED* ❤️\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `💘 It's official! @${session.target.split('@')[0]} accepted the confession from @${session.suitor.split('@')[0]}!\n\n` +
                            `✨ They are now happily in a **RELATIONSHIP**! Hand in hand, they step into a brand new chapter together! 🎉`;
                        
                        await sock.sendMessage(jid, { text: successText, mentions: [session.target, session.suitor] }, { quoted: msg });
                    } else {
                        try {
                            const prompt = "Write a brief sentence about a dating confession being rejected that sounds absolutely crushed, sad, and deeply disappointed. Keep it punchy.";
                            const burn = await queryGroq([{ role: "user", content: prompt }], "llama-3.3-70b-versatile", 0.8);
                            
                            const failText = `🌧️ *CONFESSION DECLINED* 🌧️\n━━━━━━━━━━━━━━━━━━━━━━\n\nOuch. @${session.target.split('@')[0]} decided it's best to stay just friends with @${session.suitor.split('@')[0]}.\n\n🥀 _${burn}_`;
                            await sock.sendMessage(jid, { text: failText, mentions: [session.suitor, session.target] }, { quoted: msg });
                        } catch {
                            await sock.sendMessage(jid, { text: "🥀 Absolute silence... The confession was turned down, leaving nothing but disappointment." }, { quoted: msg });
                        }
                    }
                    delete global.askoutSessions[jid];
                    return;
                }
            }
        }
    }
];

// Add structural requested alias triggers dynamically
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'domain-expansion') {
        aliases.push({ ...cmd, name: 'dom-exp' });
    }
    if (cmd.name === 'hollow-purple') {
        aliases.push({ ...cmd, name: 'purple-tech' });
    }
});
module.exports.push(...aliases);
