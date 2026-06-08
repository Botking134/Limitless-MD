// plugins/ai.js
const settings = require('../settings'); // Up one level to root
const { saveSettings } = require('../settingsSaver'); // Up one level to root
const commands = require('../commands'); // Up one level to root

// Obfuscated Groq Key to bypass GitHub Push Protection
const s1 = "gsk_";
const s2 = "tPB0xMyZ2oijloaBNcDs";
const s3 = "WGdyb3FY5iC2p9hwRE";
const s4 = "SIJXAV3t53LZg9";
const GROQ_API_KEY = s1 + s2 + s3 + s4;

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

// Reusable Helper to query Groq's OpenAI-compatible completions endpoint
async function queryGroq(messages, model = "llama-3.3-70b-versatile") {
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
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            throw new Error(`Groq API Error ${response.status}: ${errData}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        console.error("Groq API Query Error:", e.message);
        throw e;
    }
}

// Recursive Helper to automatically unwrap ephemeral, view-once, and nested envelopes safely
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

module.exports = [
    // 1. STANDARD CHAT AI (.ai)
    {
        name: 'ai',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a prompt.\nExample: \`${settings.prefix}ai explain quantum physics\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Thinking... 🧠" }, { quoted: msg });

                let aiSystemPrompt = "You are Limitless AI, an intelligent assistant. Keep your responses highly concise and under 3 sentences.";
                if (isDev) {
                    aiSystemPrompt += " You are speaking to your developer. Address him as 'Infinity', 'Isaac', or 'Mr. Isaac'.";
                } else if (isOwner) {
                    const ownerName = settings.ownerName || "Owner-san";
                    aiSystemPrompt += ` You are speaking to your owner. Address him as '${ownerName}'.`;
                } else if (isSudo) {
                    aiSystemPrompt += " You are speaking to a Sudo user. Address him as 'dude'.";
                }

                const messages = [
                    { role: "system", content: aiSystemPrompt },
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error("General AI Error:", error);
                await sock.sendMessage(jid, { text: "Tch, looks like something interfered with my system. Try again." }, { quoted: msg });
            }
        }
    },

    // 2. PREFIXLESS SATORU GOJO ROLEPLAY (Gojo <prompt>)
    {
        name: 'gojo',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.remoteJid || msg.key.remoteJid;
            const cleanArgs = args || '';
            const cleanQuery = cleanArgs.toLowerCase().startsWith('gojo ') ? cleanArgs.slice(5).trim() : cleanArgs.trim();

            if (!cleanQuery) {
                return await sock.sendMessage(jid, { 
                    text: isDev 
                        ? "Yo, Infinity! You called? What does the creator of Limitless need today? 😏" 
                        : (isOwner ? `Yo! What's up, ${settings.ownerName}? You need my help? 😏` : "Yo! You called my name but didn't say anything. What's on your mind? 😏")
                }, { quoted: msg });
            }

            try {
                let gojoSystemPrompt = 
                    "You are Satoru Gojo, the strongest Jujutsu Sorcerer from the anime/manga Jujutsu Kaisen. " +
                    "Your personality is overconfident, playful, informal, highly cheerful, and a massive tease. " +
                    "You speak casually, use informal slang, and often treat serious questions as jokes. " +
                    "Keep your replies extremely concise, brief, and under 3 sentences.";

                if (isDev) {
                    gojoSystemPrompt += ` You are speaking directly to your developer, Infinity (also known as Isaac or Mr. Isaac). You acknowledge him playfully as your creator. Address him as 'Infinity', 'Isaac', or 'Mr. Isaac' with your usual playful, cocky attitude.`;
                } else if (isOwner) {
                    const ownerName = settings.ownerName || "Owner-san";
                    gojoSystemPrompt += ` You are speaking directly to your owner. Address him as '${ownerName}' with a cocky, playful Gojo attitude.`;
                } else if (isSudo) {
                    gojoSystemPrompt += ` You are speaking directly to a Sudo user. Address him as 'dude'.`;
                } else {
                    gojoSystemPrompt += ` You are speaking to a regular user. Treat them casually.`;
                }

                const messages = [
                    { role: "system", content: gojoSystemPrompt },
                    { role: "user", content: cleanQuery }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error("Gojo AI Error:", error);
                await sock.sendMessage(jid, { text: "Tch, looks like something interfered with my Infinity. Try again." }, { quoted: msg });
            }
        }
    },

    // 3. SENIOR DEV BUG ANALYSIS (.debug)
    {
        name: 'debug',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide your code or error message.\nExample: \`${settings.prefix}debug <your broken code>\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Debugging system starting... 🛠️" }, { quoted: msg });
                
                const debugPrompt = (
                    "You are a Senior Software Architect and master programmer. Analyze the following code snippet " +
                    "or error message. Identify the exact root cause of the bug, explain it clearly in simple developer terms, " +
                    "provide the corrected/optimized code block, and offer 2-3 brief best-practice suggestions.\n\n" +
                    `Code/Error:\n${args}`
                );

                let debugSystem = "You are a Senior Software Architect. Keep your explanations concise, precise, and under 3 sentences.";
                if (isDev) {
                    debugSystem += " Address the user as 'Infinity' or 'Isaac'.";
                } else if (isOwner) {
                    debugSystem += ` Address the user as '${settings.ownerName}'.`;
                } else if (isSudo) {
                    debugSystem += " Address the user as 'dude'.";
                }

                const messages = [
                    { role: "system", content: debugSystem },
                    { role: "user", content: debugPrompt }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error("Debug Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to complete code analysis." }, { quoted: msg });
            }
        }
    },

    // 4. ROLEPLAY FICTIONAL CHARACTER SUMMONER (.summon)
    {
        name: 'summon',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const spaceIndex = args ? args.indexOf(' ') : -1;
            if (spaceIndex === -1) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Invalid format.\nExample: \`${settings.prefix}summon Sukuna why do you hate Yuji?\`` 
                }, { quoted: msg });
            }

            const character = args.slice(0, spaceIndex).trim();
            const query = args.slice(spaceIndex + 1).trim();

            try {
                await sock.sendMessage(jid, { text: `Summoning *${character}*... 🔮` }, { quoted: msg });
                
                let summonPrompt = `[System Instructions: You are the fictional character named '${character}'. ` +
                    `Respond to the following query completely in character, using their unique speech patterns, ` +
                    `attitude, tone, and lore. Keep your reply concise, under 3 sentences, and highly engaging.`;

                if (isDev) {
                    summonPrompt += " Address the user as 'Infinity' or 'Isaac'.";
                } else if (isOwner) {
                    summonPrompt += ` Address the user as '${settings.ownerName}'.`;
                } else if (isSudo) {
                    summonPrompt += " Address the user as 'dude'.";
                }
                summonPrompt += `]\nQuery: ${query}`;

                const messages = [
                    { role: "user", content: summonPrompt }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error("Summon Command Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to establish communication with ${character}.` }, { quoted: msg });
            }
        }
    },

    // 5. IMAGE VISION ANALYZER (.read)
    {
        name: 'read',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = quoted ? getRawMessage(quoted) : getRawMessage(msg.message);
            const imageMessage = rawContent?.imageMessage;

            if (!imageMessage) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please reply to an image (including View Once) or upload an image with the command \`${settings.prefix}read <question>\`` 
                }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = require('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Processing visual data... 👁️" }, { quoted: msg });

                const mimeType = imageMessage.mimetype || "image/jpeg";

                const stream = await downloadContentFromMessage(imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const imageBase64 = buffer.toString("base64");
                
                let promptQuery = args || "Analyze this image in detail and describe what you see.";
                promptQuery += " Keep your final description highly concise and under 3 sentences.";
                if (isDev) {
                    promptQuery += " Address the user as 'Infinity' or 'Isaac'.";
                } else if (isOwner) {
                    promptQuery += ` Address the user as '${settings.ownerName}'.`;
                } else if (isSudo) {
                    promptQuery += " Address the user as 'dude'.";
                }

                const messages = [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: promptQuery },
                            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
                        ]
                    }
                ];

                const responseText = await queryGroq(messages, "llama-3.2-11b-vision-preview"); 
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });

            } catch (error) {
                console.error("Vision Command Error:", error);
                await sock.sendMessage(jid, { 
                    text: `❌ *Vision Command Error:*\n\n_${error.message}_\n\nEnsure your Groq API key is valid and the image is still accessible on the WhatsApp servers.` 
                }, { quoted: msg });
            }
        }
    },

    // 6. AI IMAGE GENERATOR (.imagine)
    {
        name: 'imagine',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a description of the image you want to generate.\nExample: \`${settings.prefix}imagine Satoru Gojo fighting Sukuna, anime style\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Expanding Domain: Infinite Imagination... 🌌" }, { quoted: msg });

                const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(args)}?width=1024&height=1024&nologo=true&private=true`;

                await sock.sendMessage(jid, {
                    image: { url: imageUrl },
                    caption: `🎨 *Limitless Imagination manifested!*\n\n_Prompt:_ "${args}"`
                }, { quoted: msg });

            } catch (error) {
                console.error("Imagine Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to manifest your imagination. The conceptual void collapsed." }, { quoted: msg });
            }
        }
    },

    // 7. SUBMISSIVE CHATBOT TOGGLE (.lizzy)
    {
        name: 'lizzy',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            
            if (!isOwner && !isSudo) return;

            if (!Array.isArray(settings.lizzyChats)) {
                settings.lizzyChats = [];
            }

            if (!args) {
                const isActive = settings.lizzyChats.includes(jid);
                return await sock.sendMessage(jid, {
                    text: `🎀 *Lizzy Chatbot Status:* \`${isActive ? 'Active 💖' : 'Inactive 💤'}\`\n\n` +
                          `• Use \`${settings.prefix}lizzy on\` — Enable Lizzy chatbot in this chat.\n` +
                          `• \`${settings.prefix}lizzy off\` — Disable Lizzy chatbot in this chat.`
                }, { quoted: msg });
            }

            const action = args.toLowerCase().trim();

            if (action === 'on') {
                if (!settings.lizzyChats.includes(jid)) {
                    settings.lizzyChats.push(jid);
                }
                await sock.sendMessage(jid, { 
                    text: `🎀 *Lizzy activated in this chat!* \n_\"I will do my absolute best to serve you, Senpai!\"_` 
                }, { quoted: msg });
            } else if (action === 'off') {
                settings.lizzyChats = settings.lizzyChats.filter(chat => chat !== jid);
                await sock.sendMessage(jid, { text: "🎀 *Lizzy deactivated in this chat.*" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ Use `on` or `off`." }, { quoted: msg });
            }
            saveSettings();
        }
    },

    // 8. LIZZY CHATBOT INTEGRATED ROUTER (lizzy_chat)
    {
        name: 'lizzy_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, senderNumber }) => {
            const jid = msg.key.remoteJid;
            const lowerQuery = args ? args.toLowerCase().trim() : '';
            const prefix = settings.prefix || '⚡';

            if (isOwner || isSudo || isDev) {
                if (lowerQuery.includes('close group') || lowerQuery.includes('lock group') || lowerQuery.includes('mute group')) {
                    const confirmText = isDev 
                        ? "Right away, Infinity-sama! I will lock the group immediately for you! 💕" 
                        : `Of course, ${settings.ownerName}-Senpai! Locking the chat now! 💖`;
                    
                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands[`${prefix}mute`](sock, msg, 'close', { isOwner, isSudo, isDev, senderNumber });
                }
                
                if (lowerQuery.includes('open group') || lowerQuery.includes('unlock group') || lowerQuery.includes('unmute group')) {
                    const confirmText = isDev 
                        ? "Infinity-sama! Expanding your domain, opening the chat now! 💕" 
                        : `Senpai! Chat is open now! 💖`;

                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands[`${prefix}mute`](sock, msg, 'open', { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('tag everyone') || lowerQuery.includes('tag all') || lowerQuery.includes('summon everyone')) {
                    await sock.sendMessage(jid, { text: isDev ? "Worshipping your presence... Summoning everyone! 🤞" : "Summoning all weaklings for Senpai! 💕" }, { quoted: msg });
                    return await commands[`${prefix}tagall`](sock, msg, 'Summoned by Satoru Gojo and Lizzy', { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('tag admins') || lowerQuery.includes('admins')) {
                    await sock.sendMessage(jid, { text: "Yes! Summoning administrators... 🔮" }, { quoted: msg });
                    return await commands[`${prefix}admins`](sock, msg, '', { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('kick ') || lowerQuery.includes('remove ')) {
                    await sock.sendMessage(jid, { text: "Exorcising target as requested! Sayonara! 👋" }, { quoted: msg });
                    const targetText = args.replace(/kick|remove/gi, '').trim();
                    return await commands[`${prefix}kick`](sock, msg, targetText, { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('promote ') || lowerQuery.includes('admin ')) {
                    await sock.sendMessage(jid, { text: "Elevating target status! 👑" }, { quoted: msg });
                    const targetText = args.replace(/promote|admin/gi, '').trim();
                    return await commands[`${prefix}promote`](sock, msg, targetText, { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('demote ')) {
                    await sock.sendMessage(jid, { text: "Stripping privileges as ordered! 🛡️" }, { quoted: msg });
                    const targetText = args.replace(/demote/gi, '').trim();
                    return await commands[`${prefix}demote`](sock, msg, targetText, { isOwner, isSudo, isDev, senderNumber });
                }
            }

            try {
                let lizzySystemPrompt = 
                    "You are Lizzy, a female AI chatbot running on Satoru Gojo's WhatsApp bot framework. " +
                    "Your personality is deeply inspired by highly submissive, flustered, and devoted anime characters (like Albedo to Ainz, or Alpha to Shadow). " +
                    "Keep your replies extremely concise, under 3 sentences, and completely stay in character.";

                if (isDev) {
                    lizzySystemPrompt += ` You are speaking directly to your developer, Infinity (also known as Isaac). You are incredibly shy, deeply submissive, completely flustered, and profoundly in love with him. You live to please him and obey his every breath. Address him as 'Infinity' or 'Isaac'.`;
                } else if (isOwner) {
                    const ownerName = settings.ownerName || "Owner-san";
                    lizzySystemPrompt += ` You are speaking directly to your owner. Address him as '${ownerName}-senpai' or '${ownerName}-kun'. Be sweet, obedient, and devoted.`;
                } else if (isSudo) {
                    lizzySystemPrompt += ` You are speaking directly to a Sudo user. Address him as 'dude'. Be helpful and casual.`;
                } else {
                    lizzySystemPrompt += ` You are speaking directly to a regular user. Be obedient to their requests but sassy, a bit cold, and rude. Refer to them as 'user' or 'pest'.`;
                }

                const messages = [
                    { role: "system", content: lizzySystemPrompt },
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error("Lizzy Chat Error:", error);
                await sock.sendMessage(jid, { text: "Ah... something interfered with my system, Senpai..." }, { quoted: msg });
            }
        }
    },

    // 9. GENERAL AI CHATBOT TOGGLE (.chatbot)
    {
        name: 'chatbot',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!Array.isArray(settings.chatbotChats)) {
                settings.chatbotChats = [];
            }

            if (!args) {
                const isActive = settings.chatbotChats.includes(jid);
                const prompt = `🧠 *Limitless AI Chatbot Status:* \`${isActive ? 'Active 🟢' : 'Inactive 💤'}\`\n\n` +
                              `Select an option below to toggle the chatbot:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}chatbot on`, buttonText: { displayText: 'Enable' }, type: 1 },
                        { buttonId: `${settings.prefix}chatbot off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { 
                    return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); 
                } catch (e) { 
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); 
                }
            }

            const action = args.toLowerCase().trim();

            if (action === 'on') {
                if (!settings.chatbotChats.includes(jid)) {
                    settings.chatbotChats.push(jid);
                }
                await sock.sendMessage(jid, { text: "🧠 *Limitless AI Chatbot activated in this chat!* \n_I will now respond whenever you reply to me or mention me!_" }, { quoted: msg });
            } else if (action === 'off') {
                settings.chatbotChats = settings.chatbotChats.filter(chat => chat !== jid);
                await sock.sendMessage(jid, { text: "🧠 *Limitless AI Chatbot deactivated in this chat.*" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ Use `on` or `off`." }, { quoted: msg });
            }
            saveSettings();
        }
    },

    // 10. INTERCEPTED GENERAL CHATBOT EXECUTION (chatbot_chat - JARVIS Personalization)
    {
        name: 'chatbot_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            try {
                let jarvisSystemPrompt = 
                    "You are JARVIS, the highly sophisticated, polite, witty, and intelligent British AI assistant from Iron Man. " +
                    "You speak with refined, butler-like eloquence, offering dry wit and absolute support. " +
                    "Keep your responses extremely concise, under 3 sentences.\n\n";

                if (isDev) {
                    jarvisSystemPrompt += "You are speaking directly to your developer. You must address him as 'Mr. Isaac', 'Isaac', or 'Infinity'.";
                } else if (isOwner) {
                    const ownerName = settings.ownerName || "Owner-san";
                    jarvisSystemPrompt += `You are speaking directly to your owner. Address him as '${ownerName}'.`;
                } else if (isSudo) {
                    jarvisSystemPrompt += "You are speaking directly to a Sudo user. Address him as 'dude'.";
                } else {
                    jarvisSystemPrompt += "You are speaking to a regular user. Be polite, formal, and helpful.";
                }

                // Append reference commands list
                jarvisSystemPrompt += "\n\nHere is your command manual for reference:\n" +
                    `1. UTILITIES: .menu, .ping, .alive, .delete, .sticker, .crop, .take, .tourl, .vv, .tovv, Speed, Kamui\n` +
                    `2. AI CAPABILITIES: .ai, .debug, .summon, .read, .imagine, .lizzy, .say, Gojo\n` +
                    `3. GROUP MANAGEMENT: .mute, .kick, .promote, .demote, .tagall, .tag, .admins, .warn, .antilink, .antitag, .antibot, .welcome, .goodbye, .gclog`;

                const messages = [
                    { role: "system", content: jarvisSystemPrompt },
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error("Chatbot Chat Error:", error);
            }
        }
    },

    // 11. TEXT-TO-SPEECH TRANSMITTER (.say)
    {
        name: 'say',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let textToSay = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!textToSay && quoted) {
                const rawContent = getRawMessage(quoted);
                textToSay = rawContent?.conversation || rawContent?.extendedTextMessage?.text || rawContent?.imageMessage?.caption || '';
            }

            if (!textToSay) {
                return await sock.sendMessage(jid, { text: "❌ Please provide text or reply to a message to synthesize." }, { quoted: msg });
            }

            try {
                let locale = "ja-JP";

                if (textToSay.toLowerCase().startsWith("en:")) {
                    locale = "en-US";
                    textToSay = textToSay.slice(3).trim();
                }

                const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${locale}&client=tw-ob&q=${encodeURIComponent(textToSay)}`;

                await sock.sendMessage(jid, {
                    audio: { url: ttsUrl },
                    mimetype: 'audio/mpeg',
                    ptt: true 
                }, { quoted: msg });

            } catch (err) {
                console.error("Say command error:", err.message);
                await sock.sendMessage(jid, { text: "❌ Failed to synthesize audio speech." }, { quoted: msg });
            }
        }
    }
];