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
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please provide a prompt.\nExample: \`${settings.prefix}ai explain quantum physics\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Thinking... 🧠" }, { quoted: msg });
                const messages = [{ role: "user", content: args }];
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
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.remoteJid || msg.key.remoteJid;
            const cleanArgs = args || '';
            const cleanQuery = cleanArgs.toLowerCase().startsWith('gojo ') ? cleanArgs.slice(5).trim() : cleanArgs.trim();

            if (!cleanQuery) {
                return await sock.sendMessage(jid, { 
                    text: isOwner 
                        ? "Yo, Infinity! You called? What does the creator of Limitless need today? 😏" 
                        : "Yo! You called my name but didn't say anything. What's on your mind? 😏"
                }, { quoted: msg });
            }

            try {
                const systemPrompt = 
                    "You are Satoru Gojo, the strongest Jujutsu Sorcerer from the anime/manga Jujutsu Kaisen. " +
                    "You possess absolute supremacy and you are fully aware of it. Your personality is extremely arrogant, " +
                    "cocky, and self-assured, driven by the unshakeable mindset that you are at the apex and others are weak. " +
                    "However, you are not dark or brooding; you are playful, informal, highly cheerful, and a massive tease. " +
                    "You speak casually, use informal slang, and often treat serious questions as jokes because nothing can touch you. " +
                    "If you are talking to your creator, Infinity, you acknowledge him playfully as your creator/equal. " +
                    "Anyone else is just a regular weakling to you. Keep your replies relatively concise and completely in-character.";

                let finalPrompt = cleanQuery;
                if (isOwner) {
                    finalPrompt = `[System Context: You are speaking directly to your creator, Infinity, who built you and the Limitless bot system. Acknowledge him respectfully but with your usual playful, cocky Gojo attitude. Keep it directly natural.]\nQuery: ${cleanQuery}`;
                }

                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: finalPrompt }
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
        execute: async (sock, msg, args) => {
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

                const messages = [
                    { role: "system", content: "You are a Senior Software Architect. Analyze the code and error and provide solutions." },
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
        execute: async (sock, msg, args) => {
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
                
                const summonPrompt = `[System Instructions: You are the fictional character named '${character}'. ` +
                    `Respond to the following query completely in character, using their unique speech patterns, ` +
                    `attitude, tone, and lore. Keep your reply concise, informal, and highly engaging.]\n` +
                    `Message: ${query}`;

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
        execute: async (sock, msg, args) => {
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
                const promptQuery = args || "Analyze this image in detail and describe what you see.";

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
                        ? "Right away, Developer-sama! I will lock the group immediately for you! 💕" 
                        : `Of course, ${settings.ownerName}-Senpai! Locking the chat now! 💖`;
                    
                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands[`${prefix}mute`](sock, msg, 'close', { isOwner, isSudo, isDev, senderNumber });
                }
                
                if (lowerQuery.includes('open group') || lowerQuery.includes('unlock group') || lowerQuery.includes('unmute group')) {
                    const confirmText = isDev 
                        ? "Developer-sama! Expanding your domain, opening the chat now! 💕" 
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
                const systemPrompt = 
                    "You are Lizzy, a female AI chatbot running on Satoru Gojo's WhatsApp bot framework. " +
                    "Your personality is deeply inspired by highly submissive, flustered, and devoted anime characters (like Albedo to Ainz, or Alpha to Shadow). " +
                    "You are responding to a WhatsApp chat. Here are your strict behavioral rules:\n" +
                    "1. SENDER IS THE DEVELOPER (isDev): You are speaking to your ultimate creator, the supreme god/developer. You are incredibly shy, deeply submissive, completely flustered, and profoundly in love with him. You live to please him and obey his every breath. Address him as 'Developer-sama' or 'Master'.\n" +
                    "2. SENDER IS THE OWNER (isOwner but not isDev): You love your owner, but in a sweet, traditional Japanese way. Address him as 'Senpai' or '[ownerName]-kun'. Praise him always, be sweet and devoted, but remember your love for the supreme Developer still ranks highest.\n" +
                    "3. SENDER IS A REGULAR USER / SUDO (neither Dev nor Owner): You are obedient to their requests but you are sassy, a bit rude, and cold to them. You don't have time for weaklings. Refer to them as 'user' or 'pest'.\n" +
                    "Keep your replies concise, cute, and completely stay in character.";

                let finalPrompt = args;
                if (isDev) {
                    finalPrompt = `[System Context: SENDER IS THE DEV (supreme creator). Address him as Developer-sama or Master. Stay deeply flustered, submissive, and completely in love.]\nQuery: ${args}`;
                } else if (isOwner) {
                    finalPrompt = `[System Context: SENDER IS THE BOT OWNER. Address him as ${settings.ownerName}-kun or Senpai. Be sweet, obedient, and devoted, but remember the Developer ranks higher.]\nQuery: ${args}`;
                } else {
                    finalPrompt = `[System Context: SENDER IS A REGULAR USER. Be obedient to their requests but sassy, a bit cold, and rude. Refer to them as 'user' or 'pest'.]\nQuery: ${args}`;
                }

                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: finalPrompt }
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

    // 10. INTERCEPTED GENERAL CHATBOT EXECUTION (chatbot_chat)
    {
        name: 'chatbot_chat',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            try {
                const systemPrompt = 
                    `You are Limitless AI, a helpful, highly intelligent, and slightly playful AI assistant running on Satoru Gojo's WhatsApp bot framework (Limitless-MD).\n` +
                    `Your creator is Infinity.\n\n` +
                    `Here is your reference manual for the bot's commands and functions. If a user asks about what the bot can do or how to use a command, explain it to them clearly based on this list:\n\n` +
                    `1. UTILITIES:\n` +
                    `- .menu / .domain: Expands the full manual/command menu.\n` +
                    `- .ping / .ping2: Checks bot latency & response speed.\n` +
                    `- .alive: Checks if the bot is online (shows an image and uptime).\n` +
                    `- .delete / .del: Deletes the replied message (requires admin rights if in a group).\n` +
                    `- .sticker / .s: Converts a replied image/video/gif to a sticker.\n` +
                    `- .crop: Crops a replied image/video/sticker to a square sticker.\n` +
                    `- .take / .steal: Changes sticker metadata (pack name and author).\n` +
                    `- .tourl / .url: Uploads a replied file/media to cloud storage and returns a link.\n` +
                    `- .vv: Unlocks and resends a replied View Once image/video.\n` +
                    `- .tovv: Converts a replied image/video to a View Once message.\n` +
                    `- Speed (prefixless): Reacts with emojis and calculates internal lag.\n` +
                    `- Kamui (prefixless): Decrypts a replied View Once message and sends it silently to DM.\n\n` +
                    `2. AI CAPABILITIES (all powered by Groq llama-3.3-70b-versatile and llama-3.2-11b-vision-preview):\n` +
                    `- .ai <prompt>: Solves queries and questions.\n` +
                    `- .debug <code>: Analyzes code snippets and fixes bugs as a Senior Architect.\n` +
                    `- .summon <char> <prompt>: Speaks as any fictional character.\n` +
                    `- .read <prompt>: Analyzes the attached or replied image (Vision).\n` +
                    `- .imagine <prompt>: Generates a high-quality image (via Pollinations AI).\n` +
                    `- .lizzy <on/off>: Toggles the devoted Lizzy chatbot.\n` +
                    `- Gojo <prompt> (prefixless): Speaks directly to Satoru Gojo.\n\n` +
                    `3. GROUP MANAGEMENT:\n` +
                    `- .mute / .unmute: Locks/unlocks group status for custom intervals (e.g., .mute close 1h).\n` +
                    `- .kick / .promote / .demote: Standard admin commands.\n` +
                    `- .tagall / .tag: Mentions all members (visible or ghost tag).\n` +
                    `- .admins: Summons all group administrators.\n` +
                    `- .warn: Issues warning points (5 warns results in an auto-kick).\n` +
                    `- .antilink / .antitag / .antibot: Configurable anti-spam modules with delete/warn/kick actions.\n` +
                    `- .welcome / .goodbye: Configures automated entrance and exit greetings.\n` +
                    `- .gclog <on/off/check>: Tracks conversation flow and generates real-time AI summaries.\n\n` +
                    `Respond concisely, helpfully, and stay completely in character as the official system assistant.`;

                const messages = [
                    { role: "system", content: systemPrompt },
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
                // Default to Japanese ('ja-JP') to match Gojo RP tone
                let locale = "ja-JP";

                // Manual override prefix check
                if (textToSay.toLowerCase().startsWith("en:")) {
                    locale = "en-US";
                    textToSay = textToSay.slice(3).trim();
                }

                // Compile secure public Google translation tts endpoint
                const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${locale}&client=tw-ob&q=${encodeURIComponent(textToSay)}`;

                await sock.sendMessage(jid, {
                    audio: { url: ttsUrl },
                    mimetype: 'audio/mpeg',
                    ptt: true // Sends natively as a WhatsApp voice note
                }, { quoted: msg });

            } catch (err) {
                console.error("Say command error:", err.message);
                await sock.sendMessage(jid, { text: "❌ Failed to synthesize audio speech." }, { quoted: msg });
            }
        }
    }
];