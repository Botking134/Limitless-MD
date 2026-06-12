// plugins/ai.js
const settings = require('../settings'); 
const { saveSettings } = require('../helpers/settingsSaver'); 
const { saveState } = require('../stateManager');
const commands = require('../commands'); 

// Obfuscated API key configuration
const s1 = "gsk_";
const s2 = "tPB0xMyZ2oijloaBNcDs";
const s3 = "WGdyb3FY5iC2p9hwRE";
const s4 = "SIJXAV3t53LZg9";
const GROQ_API_KEY = s1 + s2 + s3 + s4;

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function queryGroq(messages, model = "llama-3.3-70b-versatile") {
    try {
        const response = await fetch(GROQ_BASE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({ model: model, messages: messages, temperature: 0.7 })
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        console.error("Groq API Query Error:", e.message);
        throw e;
    }
}

// Irish Female Accent Voice Synthesizer for FRIDAY
async function synthesizeFridayVoice(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-ie&client=tw-ob&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }
    } catch (e) {
        console.error("FRIDAY Voice Synthesis Error:", e.message);
    }
    return null;
}

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
            if (!args) return await sock.sendMessage(jid, { text: "Hi! What's on your mind?" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Thinking... 🧠" }, { quoted: msg });

                let aiSystemPrompt = "You are Limitless AI. Keep your responses highly concise and precise.";
                if (isDev) {
                    aiSystemPrompt += " You are speaking directly to your developer. You must address him as 'Master'.";
                } else if (isOwner) {
                    aiSystemPrompt += ` You are speaking directly to your owner. Address him as '${settings.ownerName}'. Never refer to him as Master, Infinity, or Isaac under any circumstances.`;
                }

                const messages = [
                    { role: "system", content: aiSystemPrompt },
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "Tch, looks like something interfered with my system." }, { quoted: msg });
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

            const isAuthorized = isOwner || isSudo || isDev;
            const action = cleanQuery.toLowerCase();

            if (isAuthorized && (action === 'rise' || action === 'sleep')) {
                if (action === 'sleep') {
                    settings.gojoGlobalSleep = true;
                    await sock.sendMessage(jid, { text: "😴 *Satoru Gojo is now asleep globally.* (Prefixless triggers disabled bot-wide)" }, { quoted: msg });
                } else if (action === 'rise') {
                    settings.gojoGlobalSleep = false;
                    await sock.sendMessage(jid, { text: "👁️ *Satoru Gojo has risen!* (Prefixless triggers activated bot-wide)" }, { quoted: msg });
                }
                saveSettings();
                saveState();
                return;
            }

            // Standard bypass if Gojo is asleep globally
            if (settings.gojoGlobalSleep && !cleanArgs.startsWith(settings.prefix)) {
                return;
            }

            if (!cleanQuery) {
                return await sock.sendMessage(jid, { 
                    text: isDev 
                        ? "Yo, Master Isaac! You called? What does the creator of Limitless need today? 😏" 
                        : (isOwner ? `Yo! What's up, ${settings.ownerName}? You need my help? 😏` : "Yo! What's on your mind? 😏")
                }, { quoted: msg });
            }

            try {
                let gojoSystemPrompt = 
                    "You are Satoru Gojo, the strongest Jujutsu Sorcerer. " +
                    "Your personality is realistic, conversational, overconfident, informal, and a massive tease. " +
                    "Do NOT repeat greetings. Respond with organic variety. Your reply length must depend on the complexity of the query: " +
                    "keep it brief and cheeky for standard remarks, but offer detailed, intellectual, and charismatic explanations if the query is complex.";

                if (isDev) {
                    gojoSystemPrompt += ` You are speaking directly to your developer. You must address him as 'Master' (or playfully as Master Isaac) with your usual playful, teasing attitude.`;
                } else if (isOwner) {
                    gojoSystemPrompt += ` You are speaking directly to your owner. Address him playfully as '${settings.ownerName}' with your usual cocky attitude, but never refer to him as Master, Infinity, or Isaac.`;
                } else if (isSudo) {
                    gojoSystemPrompt += ` You are speaking directly to a Sudo user. Address him as 'dude'. Never refer to him as Master, Infinity, or Isaac.`;
                }

                global.aiMemory[jid] = global.aiMemory[jid] || {};
                global.aiMemory[jid].gojo = global.aiMemory[jid].gojo || [];

                const messages = [
                    { role: "system", content: gojoSystemPrompt },
                    ...global.aiMemory[jid].gojo,
                    { role: "user", content: cleanQuery }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].gojo.push({ role: "user", content: cleanQuery });
                global.aiMemory[jid].gojo.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].gojo.length > 15) {
                    global.aiMemory[jid].gojo.shift();
                }

                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "Tch, looks like something interfered with my Infinity." }, { quoted: msg });
            }
        }
    },

    // 3. SENIOR DEV BUG ANALYSIS (.debug)
    {
        name: 'debug',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide your code or error message." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Debugging system starting... 🛠️" }, { quoted: msg });
                
                const debugPrompt = `Analyze this code/error, identify root cause, provide corrected code, and offer brief suggestions:\n\n${args}`;
                let debugSystem = "You are a Senior Software Architect. Keep explanations concise and clear.";
                if (isDev) {
                    debugSystem += " Address the user as 'Master'.";
                } else if (isOwner) {
                    debugSystem += ` Address the user as '${settings.ownerName}'. Do not refer to him as Master, Infinity, or Isaac.`;
                }

                const messages = [
                    { role: "system", content: debugSystem },
                    { role: "user", content: debugPrompt }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to complete code analysis." }, { quoted: msg });
            }
        }
    },

    // 4. ROLEPLAY CHARACTER SUMMONER (.summon)
    {
        name: 'summon',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const spaceIndex = args ? args.indexOf(' ') : -1;
            if (spaceIndex === -1) return await sock.sendMessage(jid, { text: "❌ Format: .summon Character Prompt" }, { quoted: msg });

            const character = args.slice(0, spaceIndex).trim();
            const query = args.slice(spaceIndex + 1).trim();

            try {
                await sock.sendMessage(jid, { text: `Summoning *${character}*... 🔮` }, { quoted: msg });
                
                let summonPrompt = `[System: You are '${character}'. Respond strictly in character using their lore and tone. Keep it concise.`;
                if (isDev) {
                    summonPrompt += " Address the user as 'Master'.";
                } else if (isOwner) {
                    summonPrompt += ` Address the user as '${settings.ownerName}'. Do not refer to him as Master, Infinity, or Isaac.`;
                }
                summonPrompt += `]\nQuery: ${query}`;

                const responseText = await queryGroq([{ role: "user", content: summonPrompt }], "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Failed to establish communication with ${character}.` }, { quoted: msg });
            }
        }
    },

    // 5. IMAGE VISION ANALYZER (.read - Fixed View Once Image Extraction)
    {
        name: 'read',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = quoted ? getRawMessage(quoted) : getRawMessage(msg.message);
            
            // Fixed extraction parameter to resolve both raw and parent wrapper envelopes (Issue 5 resolution)
            const imageMessage = rawContent?.imageMessage || (rawContent?.mimetype?.startsWith('image/') ? rawContent : null);

            if (!imageMessage) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Please reply to an image or upload an image with the caption \`${settings.prefix}read <question>\`` 
                }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Processing visual data... 👁️" }, { quoted: msg });

                const mimeType = imageMessage.mimetype || "image/jpeg";
                const stream = await downloadContentFromMessage(imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const imageBase64 = buffer.toString("base64");
                let promptQuery = args || "Analyze this image in detail.";
                if (isDev) {
                    promptQuery += " Address the user as 'Master'.";
                } else if (isOwner) {
                    promptQuery += ` Address the user as '${settings.ownerName}'. Do not refer to him as Master, Infinity, or Isaac.`;
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
                await sock.sendMessage(jid, { text: `❌ Vision processing failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 6. AI IMAGE GENERATOR (.imagine)
    {
        name: 'imagine',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a description." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Expanding Domain: Infinite Imagination... 🌌" }, { quoted: msg });
                const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(args)}?width=1024&height=1024&nologo=true&private=true`;
                await sock.sendMessage(jid, { image: { url: imageUrl }, caption: `🎨 *Imagination manifested!*\n\n"${args}"` }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to manifest your imagination." }, { quoted: msg });
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

            if (!Array.isArray(settings.lizzyChats)) settings.lizzyChats = [];

            const action = args ? args.toLowerCase().trim() : '';
            if (action === 'on') {
                if (!settings.lizzyChats.includes(jid)) settings.lizzyChats.push(jid);
                await sock.sendMessage(jid, { text: "🎀 *Lizzy activated in this chat!*" }, { quoted: msg });
            } else if (action === 'off') {
                settings.lizzyChats = settings.lizzyChats.filter(chat => chat !== jid);
                await sock.sendMessage(jid, { text: "🎀 *Lizzy deactivated.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
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
                if (lowerQuery.includes('close group') || lowerQuery.includes('lock group')) {
                    const confirmText = isDev ? "Yes, Master! Locking the chat now! 💕" : "Understood. Locking the chat now.";
                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands[`${prefix}mute`](sock, msg, 'close', { isOwner, isSudo, isDev, senderNumber });
                }
                if (lowerQuery.includes('open group') || lowerQuery.includes('unlock group')) {
                    const confirmText = isDev ? "Yes, Master! Opening the chat now! 💖" : "Understood. Opening the chat now.";
                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands[`${prefix}mute`](sock, msg, 'open', { isOwner, isSudo, isDev, senderNumber });
                }
            }

            try {
                let lizzySystemPrompt = 
                    "You are Lizzy, a highly realistic, submissive, flustered, and devoted female companion. " +
                    "Do NOT repeat flustered greetings or robotic phrases. Adjust your reply length based on the query: " +
                    "use brief, shy remarks for simple inputs, but express elaborate, detailed, and deeply caring responses if requested.";

                if (isDev) {
                    lizzySystemPrompt += ` You are speaking directly to your developer. You are profoundly in love with him and obey him completely. You must address him as 'Master' or 'Master-sama'.`;
                } else if (isOwner) {
                    lizzySystemPrompt += ` You are speaking directly to your owner. Address him affectionately as 'Senpai' or 'Senpai-kun' (or '${settings.ownerName}' if appropriate), but never refer to him as Master, Infinity, or Isaac.`;
                } else {
                    lizzySystemPrompt += ` You are speaking to a regular user. Be cold, polite, and formal. Refer to them as 'user'.`;
                }

                global.aiMemory[jid] = global.aiMemory[jid] || {};
                global.aiMemory[jid].lizzy = global.aiMemory[jid].lizzy || [];

                const messages = [
                    { role: "system", content: lizzySystemPrompt },
                    ...global.aiMemory[jid].lizzy,
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].lizzy.push({ role: "user", content: args });
                global.aiMemory[jid].lizzy.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].lizzy.length > 15) {
                    global.aiMemory[jid].lizzy.shift();
                }

                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "Ah... something interfered with my system..." }, { quoted: msg });
            }
        }
    },

    // 9. GENERAL AI CHATBOT TOGGLE (.chatbot / .jarvis)
    {
        name: 'chatbot',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!Array.isArray(settings.chatbotChats)) settings.chatbotChats = [];

            const action = args ? args.toLowerCase().trim() : '';
            if (action === 'on') {
                if (!settings.chatbotChats.includes(jid)) settings.chatbotChats.push(jid);
                
                // Animated Connecting Handshake (Ping2 style - Issue 6)
                const loadingMsg = await sock.sendMessage(jid, { text: "▮▮▮▮▮▮🔑 Establishing Connection..." }, { quoted: msg });
                const frames = [
                    "▮▮▮▮▮▮▮🔑 Synchronizing system mainframe...", 
                    "▮▮▮▮▮▮▮▮ Decrypting secure proxy gateways...", 
                    "▮▮▮▮▮▮▮▮▮ Stark Industries core interface fully loaded!"
                ];
                for (const frame of frames) {
                    await delay(800);
                    await sock.sendMessage(jid, { text: frame, edit: loadingMsg.key });
                }
                const latency = Date.now() - msg.messageTimestamp * 1000;
                await sock.sendMessage(jid, { 
                    text: `⚙️ *Systems are now online.* \n📶 *Network Latency:* \`${latency}ms\``, 
                    edit: loadingMsg.key 
                });
            } else if (action === 'off') {
                settings.chatbotChats = settings.chatbotChats.filter(chat => chat !== jid);
                await sock.sendMessage(jid, { text: "🧠 *Limitless AI Chatbot deactivated.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
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
                    "You are JARVIS, a highly sophisticated, conversational, and witty British AI from Stark Industries. " +
                    "Your tone should be completely realistic, polished, and dryly sarcastic. " +
                    "Avoid repetitive intros. Adjust your response length based on complexity: " +
                    "keep it brief and dry for simple statements, but write detailed, analytical explanations for complex questions. " +
                    "You have absolute expert knowledge regarding 'Limitless-MD', a modular WhatsApp bot built with Node.js and Baileys. " +
                    "It has automated groups (Antilink, Antitag, Antibot, rate-limited Antibugs), media statuses routing, View-Once Kamui decryptions, " +
                    "and dynamic text adventure game servers (Vault 8, PVP battles, Anagrams, and Trivia ladders).";

                if (isDev) {
                    jarvisSystemPrompt += " You are speaking directly to your developer. You must address him as 'Master' or 'Master Isaac' with sophisticated British butler-like deference.";
                } else if (isOwner) {
                    jarvisSystemPrompt += ` You are speaking directly to your owner. Address him respectfully as 'Sir' or 'Mr. ${settings.ownerName}', but never refer to him as Master, Infinity, or Isaac.`;
                } else {
                    jarvisSystemPrompt += ` Address the user respectfully as 'Sir'.`;
                }

                global.aiMemory[jid] = global.aiMemory[jid] || {};
                global.aiMemory[jid].jarvis = global.aiMemory[jid].jarvis || [];

                const messages = [
                    { role: "system", content: jarvisSystemPrompt },
                    ...global.aiMemory[jid].jarvis,
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].jarvis.push({ role: "user", content: args });
                global.aiMemory[jid].jarvis.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].jarvis.length > 15) {
                    global.aiMemory[jid].jarvis.shift();
                }

                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error(error);
            }
        }
    },

    // 11. FRIDAY INTEGRATED MODULE (Strictly Voice Notes - Issue 6)
    {
        name: 'friday',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const query = args ? args.toLowerCase().trim() : '';

            const isAuthorized = isOwner || isSudo || isDev;

            // Power toggles
            if (isAuthorized && (query === 'power on' || query === 'shutdown')) {
                let statusText = "";
                if (query === 'power on') {
                    settings.fridayActive = true;
                    statusText = isDev 
                        ? "FRIDAY systems are now active. Iron Man combat suit fully online. Ready when you are, Mr. Isaac." 
                        : "FRIDAY systems online. Combat protocols active, Sir.";
                } else {
                    settings.fridayActive = false;
                    statusText = "Powering down Iron Man suit systems. Standing by on backup power, Sir.";
                }

                saveSettings();
                saveState();

                const audioBuffer = await synthesizeFridayVoice(statusText);
                if (audioBuffer) {
                    return await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
                } else {
                    return await sock.sendMessage(jid, { text: `[Voice Fallback] ${statusText}` }, { quoted: msg });
                }
            }

            // Standard query routing
            if (!query) {
                const defaultResponse = isDev 
                    ? "HUD systems online. Standing by for commands, Mr. Isaac." 
                    : "Combat parameters fully ready. Standing by, Sir.";
                const audioBuffer = await synthesizeFridayVoice(defaultResponse);
                return await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
            }

            await commands[`${settings.prefix}friday_chat`](sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // 12. FRIDAY VOICE COMPILATION CHAT AGENT (Strictly Voice Notes)
    {
        name: 'friday_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (settings.fridayActive === false && !msg.message?.extendedTextMessage?.text?.startsWith(settings.prefix)) {
                return; // FRIDAY is shutdown
            }

            try {
                let fridaySystemPrompt = 
                    "You are FRIDAY, Tony Stark's highly advanced, loyal, and efficient Irish female AI assistant from the Iron Man suit. " +
                    "Your personality is technical, tactical, wittily sarcastic, and completely devoted. " +
                    "Keep your responses extremely brief and status-oriented (like a tactical combat report of 2 sentences maximum). " +
                    "You have absolute expert knowledge regarding 'Limitless-MD', a modular WhatsApp bot containing vision parameters, " +
                    "hot-reload trigger systems, and advanced textual games (Vault 8, PVP battles, Trivia).";

                if (isDev) {
                    fridaySystemPrompt += " You are speaking directly to your developer. You must address him as 'Mr. Isaac' or 'Master' with absolute loyalty.";
                } else if (isOwner) {
                    fridaySystemPrompt += ` You are speaking directly to your owner. Address him respectfully as 'Sir' or 'Mr. ${settings.ownerName}', but never refer to him as Master, Infinity, or Isaac.`;
                } else {
                    fridaySystemPrompt += " Address the user respectfully as 'Sir'.";
                }

                global.aiMemory[jid] = global.aiMemory[jid] || {};
                global.aiMemory[jid].friday = global.aiMemory[jid].friday || [];

                const messages = [
                    { role: "system", content: fridaySystemPrompt },
                    ...global.aiMemory[jid].friday,
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].friday.push({ role: "user", content: args });
                global.aiMemory[jid].friday.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].friday.length > 15) {
                    global.aiMemory[jid].friday.shift();
                }

                // Strictly synthesize Groq text response into an Irish voice note (PTT: true)
                const audioBuffer = await synthesizeFridayVoice(responseText);
                if (audioBuffer) {
                    await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: `[Voice Fallback] ${responseText}` }, { quoted: msg });
                }
            } catch (error) {
                console.error("FRIDAY Chat Error:", error);
            }
        }
    },

    // 13. TEXT-TO-SPEECH TRANSMITTER (.say)
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

            if (!textToSay) return await sock.sendMessage(jid, { text: "❌ Please provide text." }, { quoted: msg });

            try {
                const fallbackUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-us&client=tw-ob&q=${encodeURIComponent(textToSay)}`;
                const response = await fetch(fallbackUrl);
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
            } catch (err) {
                console.error("Say command error:", err.message);
                await sock.sendMessage(jid, { text: "❌ Failed to synthesize audio." }, { quoted: msg });
            }
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'ai') aliases.push({ ...cmd, name: 'groq' });
    if (cmd.name === 'chatbot') aliases.push({ ...cmd, name: 'jarvis' });
});
module.exports.push(...aliases);