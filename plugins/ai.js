// plugins/ai.js
const { downloadMediaMessage } = require('@itsliaaa/baileys');
const settings = require('../settings'); // Up one level to root settings.js
const { saveSettings } = require('../settingsSaver');
const commands = require('../commands');

// Helper to query Grok's OpenAI-compatible completions endpoint
async function queryGrok(messages, model = "grok-2-latest") {
    try {
        const response = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${settings.geminiApiKey}`, // Using the key slot in settings.js
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model, // "grok-2-latest" for text, "grok-2-vision-1212" for images
                messages: messages,
                stream: false
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Grok API Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        console.error("Grok Query Failure:", e.message);
        throw e;
    }
}

// Recursive Helper to automatically unwrap View Once messages
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
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
                const responseText = await queryGrok(messages);
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
            const jid = msg.key.remoteJid;
            const cleanQuery = args.toLowerCase().startsWith('gojo ') ? args.slice(5).trim() : args.trim();

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
                    finalPrompt = `[System Context: You are speaking directly to your creator, Infinity, who built you and the Limitless bot system. Acknowledge him respectfully but with your usual playful, cocky Gojo attitude. Keep it natural.]\nQuery: ${cleanQuery}`;
                }

                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: finalPrompt }
                ];

                const responseText = await queryGrok(messages);
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

                const responseText = await queryGrok(messages);
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
                
                const summonPrompt = (
                    `[System Instructions: You are the fictional character named '${character}'. " +
                    "Respond to the following query completely in character, using their unique speech patterns, " +
                    "attitude, tone, and lore. Keep your reply concise, informal, and highly engaging.]\n" +
                    `Message: ${query}`
                );

                const messages = [
                    { role: "user", content: summonPrompt }
                ];

                const responseText = await queryGrok(messages);
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
            const isImage = msg.message.imageMessage || quoted?.imageMessage;

            if (!isImage) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please reply to an image or upload an image with the command \`${settings.prefix}read <question>\`` 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Processing visual data... 👁️" }, { quoted: msg });

                let imageMessageSource = msg;
                let mimeType = msg.message.imageMessage?.mimetype || "image/jpeg";

                if (quoted?.imageMessage) {
                    mimeType = quoted.imageMessage.mimetype || "image/jpeg";
                    imageMessageSource = {
                        key: {
                            remoteJid: jid,
                            id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                            participant: msg.message.extendedTextMessage.contextInfo.participant
                        },
                        message: quoted
                    };
                }

                const buffer = await downloadMediaMessage(
                    imageMessageSource,
                    'buffer',
                    {},
                    { logger: require('pino')({ level: 'silent' }), rekey: false }
                );

                const imageBase64 = buffer.toString("base64");
                const promptQuery = args || "Analyze this image in detail and describe what you see.";

                // Format vision payload using standard OpenAI/Grok specifications (Issue 5)
                const messages = [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: promptQuery },
                            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
                        ]
                    }
                ];

                const responseText = await queryGrok(messages, "grok-2-vision-1212"); // Exact vision model name
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });

            } catch (error) {
                console.error("Vision Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to analyze image. Ensure the image is still active and retry." }, { quoted: msg });
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
            const lowerQuery = args.toLowerCase().trim();

            if (isOwner || isSudo || isDev) {
                if (lowerQuery.includes('close group') || lowerQuery.includes('lock group') || lowerQuery.includes('mute group')) {
                    const confirmText = isDev 
                        ? "Right away, Developer-sama! I will lock the group immediately for you! 💕" 
                        : `Of course, ${settings.ownerName}-Senpai! Locking the chat now! 💖`;
                    
                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands['⚡gmode'](sock, msg, 'close', { isOwner, isSudo, isDev, senderNumber });
                }
                
                if (lowerQuery.includes('open group') || lowerQuery.includes('unlock group') || lowerQuery.includes('unmute group')) {
                    const confirmText = isDev 
                        ? "Developer-sama! Expanding your domain, opening the chat now! 💕" 
                        : `Senpai! Chat is open now! 💖`;

                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands['⚡gmode'](sock, msg, 'open', { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('tag everyone') || lowerQuery.includes('tag all') || lowerQuery.includes('summon everyone')) {
                    await sock.sendMessage(jid, { text: isDev ? "Worshipping your presence... Summoning everyone! 🤞" : "Summoning all weaklings for Senpai! 💕" }, { quoted: msg });
                    return await commands['⚡tagall'](sock, msg, 'Summoned by Satoru Gojo and Lizzy', { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('tag admins') || lowerQuery.includes('admins')) {
                    await sock.sendMessage(jid, { text: "Yes! Summoning administrators... 🔮" }, { quoted: msg });
                    return await commands['⚡admins'](sock, msg, '', { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('kick ') || lowerQuery.includes('remove ')) {
                    await sock.sendMessage(jid, { text: "Exorcising target as requested! Sayonara! 👋" }, { quoted: msg });
                    const targetText = args.replace(/kick|remove/gi, '').trim();
                    return await commands['⚡kick'](sock, msg, targetText, { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('promote ') || lowerQuery.includes('admin ')) {
                    await sock.sendMessage(jid, { text: "Elevating target status! 👑" }, { quoted: msg });
                    const targetText = args.replace(/promote|admin/gi, '').trim();
                    return await commands['⚡promote'](sock, msg, targetText, { isOwner, isSudo, isDev, senderNumber });
                }

                if (lowerQuery.includes('demote ')) {
                    await sock.sendMessage(jid, { text: "Stripping privileges as ordered! 🛡️" }, { quoted: msg });
                    const targetText = args.replace(/demote/gi, '').trim();
                    return await commands['⚡demote'](sock, msg, targetText, { isOwner, isSudo, isDev, senderNumber });
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

                const responseText = await queryGrok(messages);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error("Lizzy Chat Error:", error);
                await sock.sendMessage(jid, { text: "Ah... something interfered with my system, Senpai..." }, { quoted: msg });
            }
        }
    }
];