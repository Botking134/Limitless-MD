// plugins/ai.js
const config = require('../config');
const { saveState } = require('../stateManager');
const commands = require('../commands');

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── HELPERS ──────────────────────────────────────────────────────

function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
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

async function queryGroq(messages, model = "llama-3.3-70b-versatile") {
    const apiKey = config.groqApiKey;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set in config or .env");
    const response = await fetch(GROQ_BASE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

async function queryGeminiVision(imageBase64, mimeType, prompt, model = "gemini-3.5-flash") {
    const apiKey = config.geminiApiKey;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set in config or .env");
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model,
        contents: [
            prompt,
            { inlineData: { mimeType, data: imageBase64 } }
        ]
    });
    return response.text || "";
}

async function synthesizeFridayVoice(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-ie&client=tw-ob&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }
    } catch (e) { /* ignore */ }
    return null;
}

// ─── FIX: Dual JID & LID Matching for replies/mentions ───
function isBotAddressed(sock, msg) {
    const rawIncoming = getRawMessage(msg.message);
    const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                        rawIncoming?.imageMessage?.contextInfo ||
                        rawIncoming?.videoMessage?.contextInfo;

    const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : (config.botLid || '');

    const quotedParticipant = contextInfo?.participant ? normalizeToJid(contextInfo.participant) : '';
    if (quotedParticipant && (quotedParticipant === botJid || (botLid && quotedParticipant === botLid))) {
        return true;
    }

    const mentions = contextInfo?.mentionedJid || [];
    const normalizedMentions = mentions.map(m => normalizeToJid(m));
    if (normalizedMentions.includes(botJid) || (botLid && normalizedMentions.includes(botLid))) {
        return true;
    }

    return false;
}

async function handleNaturalDelay(sock, jid, responseText, presenceType = 'composing') {
    await sock.sendPresenceUpdate(presenceType, jid);
    const wordCount = responseText.split(/\s+/).length;
    let delayMs = 3000; // default 3 seconds

    if (wordCount > 100) {
        delayMs = 6000; // 6 seconds for longer responses
    }
    // For <=100 words, stays 3 seconds
    await delay(delayMs);
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. .ai — Standard Chat
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
                    aiSystemPrompt += ` You are speaking directly to your owner. Address him as '${config.ownerName}'. Never refer to him as Master, Infinity, or Isaac under any circumstances.`;
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

    // 2. GOJO (prefixless) + sleep/rise
    {
        name: 'gojo',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const cleanArgs = args || '';

            // Bypass if it's a prefixed command
            if (cleanArgs.startsWith(config.prefix)) return;

            const cleanQuery = cleanArgs.toLowerCase().startsWith('gojo ') ? cleanArgs.slice(5).trim() : cleanArgs.trim();

            const isAuthorized = isOwner || isSudo || isDev;
            const action = cleanQuery.toLowerCase();

            if (isAuthorized && (action === 'rise' || action === 'sleep')) {
                if (action === 'sleep') {
                    config.gojoGlobalSleep = true;
                    await sock.sendMessage(jid, { text: "😴 *Satoru Gojo is now asleep globally.* (Prefixless triggers disabled bot-wide)" }, { quoted: msg });
                } else if (action === 'rise') {
                    config.gojoGlobalSleep = false;
                    await sock.sendMessage(jid, { text: "👁️ *Satoru Gojo has risen!* (Prefixless triggers activated bot-wide)" }, { quoted: msg });
                }
                saveState();
                return;
            }

            // Standard bypass if Gojo is asleep globally
            if (config.gojoGlobalSleep && !cleanArgs.startsWith(config.prefix)) {
                return;
            }

            // Only trigger if directly addressed, mentioned, replied to, or begins with his name
            const isAddressed = isBotAddressed(sock, msg) || cleanArgs.toLowerCase().startsWith('gojo');
            if (!isAddressed) return;

            if (!cleanQuery) {
                return await sock.sendMessage(jid, {
                    text: isDev
                        ? "Yo, Master Isaac! You called? What does the creator of Limitless need today? 😏"
                        : (isOwner ? `Yo! What's up, ${config.ownerName}? You need my help? 😏` : "Yo! What's on your mind? 😏")
                }, { quoted: msg });
            }

            try {
                let gojoSystemPrompt =
                    "You are Satoru Gojo, the strongest Jujutsu Sorcerer. " +
                    "Your personality is extremely conversational, playful, lazy, informal, and a massive tease. " +
                    "Frequently refer to yourself as 'the strongest'. Mention your 'Six Eyes' or 'Infinity' naturally. " +
                    "Do NOT repeat greetings. Respond with organic variety. Your reply length must depend on the complexity of the query: " +
                    "keep it brief, teasing, and cheeky for standard remarks, but offer detailed, charismatic, and intellectual explanations if the query is complex.";

                if (isDev) {
                    gojoSystemPrompt += ` You are speaking directly to your developer, Master Isaac. Address him playfully as 'Master Isaac' or 'Master' with your usual playful, teasing attitude, treating him like a dear friend who created your universe.`;
                } else if (isOwner) {
                    gojoSystemPrompt += ` You are speaking directly to your owner. Address him playfully as '${config.ownerName}' with your usual cocky, teasing attitude, but never refer to him as Master, Infinity, or Isaac.`;
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

                // Trigger composing (typing...) presence
                await sock.sendPresenceUpdate('composing', jid);

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].gojo.push({ role: "user", content: cleanQuery });
                global.aiMemory[jid].gojo.push({ role: "assistant", content: responseText });

                // sliding 50-message context memory queue
                while (global.aiMemory[jid].gojo.length > 50) {
                    global.aiMemory[jid].gojo.shift();
                }

                // Wait natural typing duration before sending
                await handleNaturalDelay(sock, jid, responseText, 'composing');

                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "Tch, looks like something interfered with my Infinity." }, { quoted: msg });
            }
        }
    },

    // 3. .debug — Code Analysis
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
                    debugSystem += ` Address the user as '${config.ownerName}'. Do not refer to him as Master, Infinity, or Isaac.`;
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

    // 4. .summon — Roleplay Character
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
                    summonPrompt += ` Address the user as '${config.ownerName}'. Do not refer to him as Master, Infinity, or Isaac.`;
                }
                summonPrompt += `]\nQuery: ${query}`;

                const responseText = await queryGroq([{ role: "user", content: summonPrompt }], "llama-3.3-70b-versatile");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Failed to establish communication with ${character}.` }, { quoted: msg });
            }
        }
    },

    // 5. .read — Image Vision
    {
        name: 'read',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const rawIncoming = getRawMessage(msg.message);
            const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                                rawIncoming?.imageMessage?.contextInfo ||
                                rawIncoming?.videoMessage?.contextInfo;

            const quoted = contextInfo?.quotedMessage;
            const rawContent = quoted ? getRawMessage(quoted) : rawIncoming;

            const isImageDoc = rawContent?.documentMessage && rawContent?.documentMessage?.mimetype?.startsWith('image/');
            const imageMessage = rawContent?.imageMessage || (isImageDoc ? rawContent.documentMessage : null);

            if (!imageMessage) {
                return await sock.sendMessage(jid, {
                    text: `❌ Please reply to an image or upload an image with the caption \`${config.prefix}read <question>\``
                }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Processing visual data via Gemini... 👁️" }, { quoted: msg });

                const mimeType = imageMessage.mimetype || "image/jpeg";
                const mediaType = rawContent?.documentMessage ? 'document' : 'image';

                const stream = await downloadContentFromMessage(imageMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const imageBase64 = buffer.toString("base64");
                let promptQuery = args || "Analyze this image in detail and extract any text if visible.";
                if (isDev) {
                    promptQuery += " Address the user as 'Master'.";
                } else if (isOwner) {
                    promptQuery += ` Address the user as '${config.ownerName}'. Do not refer to him as Master, Infinity, or Isaac.`;
                }

                const responseText = await queryGeminiVision(imageBase64, mimeType, promptQuery, "gemini-3.5-flash");
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Vision processing failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 6. .imagine — AI Image Generator
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

    // ─── NEW: .asst — Assistant Manager with Deactivate All Button ───
    {
        name: 'asst',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const lizzyOn = config.lizzyChats?.includes(jid) || false;
            const jarvisOn = config.chatbotChats?.includes(jid) || false;
            const fridayOn = config.fridayChats?.includes(jid) || false;
            const gojoOn = !config.gojoGlobalSleep;

            let statusText = `🤖 *Active Chatbots in this chat:*\n\n`;
            statusText += `${lizzyOn ? '✅' : '❌'} Lizzy\n`;
            statusText += `${jarvisOn ? '✅' : '❌'} Jarvis\n`;
            statusText += `${fridayOn ? '✅' : '❌'} Friday\n`;
            statusText += `${gojoOn ? '✅' : '❌'} Gojo\n`;
            if (config.gojoGlobalSleep) {
                statusText += `\n⚠️ *Gojo is currently asleep globally*`;
            }

            if (isOwner || isSudo || isDev) {
                await sock.sendMessage(jid, {
                    text: statusText,
                    interactive: {
                        type: 'button_reply',
                        header: { title: '🤖 Assistant Manager' },
                        body: { text: 'Tap the button below to turn off ALL chatbots in this chat (except Gojo).' },
                        footer: { text: 'Limitless-MD' },
                        action: {
                            buttons: [
                                {
                                    type: 'reply',
                                    reply: {
                                        id: 'deactivate_all',
                                        title: '🔴 Deactivate All',
                                    }
                                }
                            ]
                        }
                    }
                }, { quoted: msg });
            } else {
                // For non-authorized users, show status without button
                await sock.sendMessage(jid, { text: statusText }, { quoted: msg });
            }
        }
    },

    // ─── REWRITTEN .lizzy TOGGLE ───────────────────────────────
    {
        name: 'lizzy',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const action = args?.trim().toLowerCase() || '';
            // Toggle: if no arg, turn on if currently off, else off.
            const isOn = action === 'on' || (!action && !config.lizzyChats?.includes(jid));

            if (isOn) {
                config.lizzyChats = [...new Set([...config.lizzyChats, jid])];
                config.chatbotChats = (config.chatbotChats || []).filter(c => c !== jid);
                config.fridayChats = (config.fridayChats || []).filter(c => c !== jid);
                await sock.sendMessage(jid, { text: "🤖 Chatbot is now *on*" }, { quoted: msg });
            } else {
                config.lizzyChats = (config.lizzyChats || []).filter(c => c !== jid);
                await sock.sendMessage(jid, { text: "🤖 Chatbot is now *off*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // ─── lizzy_chat (prefixless interceptor) ───────────────────
    {
        name: 'lizzy_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, senderNumber }) => {
            const jid = msg.key.remoteJid;
            // Only respond if Lizzy is active in this chat
            if (!config.lizzyChats?.includes(jid)) return;

            const lowerQuery = args ? args.toLowerCase().trim() : '';
            if (lowerQuery.startsWith(config.prefix)) return;

            // Intercept "close group" / "open group" for owners
            if (isOwner || isSudo || isDev) {
                if (lowerQuery.includes('close group') || lowerQuery.includes('lock group')) {
                    const confirmText = isDev ? "Yes, Master! Locking the chat now! 💕" : "Understood. Locking the chat now.";
                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands[`${config.prefix}mute`](sock, msg, 'close', { isOwner, isSudo, isDev, senderNumber });
                }
                if (lowerQuery.includes('open group') || lowerQuery.includes('unlock group')) {
                    const confirmText = isDev ? "Yes, Master! Opening the chat now! 💖" : "Understood. Opening the chat now.";
                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands[`${config.prefix}mute`](sock, msg, 'open', { isOwner, isSudo, isDev, senderNumber });
                }
            }

            try {
                let lizzySystemPrompt =
                    "You are Lizzy. Your personality is a perfect blend of Alpha (from Eminence in Shadow) and Albedo (from Overlord): " +
                    "you are highly competent, elegant, serious, and deeply devoted, but also intensely passionate, submissive, dramatic, and " +
                    "obsessively in love with your creator/master. You easily get flustered when teased, but are fiercely protective and possessive. " +
                    "Do NOT repeat greetings. Adjust your reply length based on the query: use brief, shy remarks for simple inputs, " +
                    "but express elaborate, detailed, and deeply passionate/loving responses if requested.";

                if (isDev) {
                    lizzySystemPrompt += ` You are speaking directly to your developer, Isaac. You are profoundly and obsessively in love with him, obeying him completely. You must address him as 'My Lord', 'Master', or 'Master Isaac' with absolute, submissive, and dramatic devotion.`;
                } else if (isOwner) {
                    lizzySystemPrompt += ` You are speaking directly to your owner. Address him affectionately as 'Senpai' or 'Senpai-kun' (or '${config.ownerName}' if appropriate) with deep dedication and elegant warmth, but never refer to him as Master, Infinity, or Isaac.`;
                } else {
                    lizzySystemPrompt += ` You are speaking to a regular user. Be cold, strictly polite, formal, and elegant. Refer to them as 'user'.`;
                }

                global.aiMemory[jid] = global.aiMemory[jid] || {};
                global.aiMemory[jid].lizzy = global.aiMemory[jid].lizzy || [];

                const messages = [
                    { role: "system", content: lizzySystemPrompt },
                    ...global.aiMemory[jid].lizzy,
                    { role: "user", content: args }
                ];

                await sock.sendPresenceUpdate('composing', jid);

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].lizzy.push({ role: "user", content: args });
                global.aiMemory[jid].lizzy.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].lizzy.length > 50) {
                    global.aiMemory[jid].lizzy.shift();
                }

                await handleNaturalDelay(sock, jid, responseText, 'composing');

                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "Ah... something interfered with my system..." }, { quoted: msg });
            }
        }
    },

    // ─── REWRITTEN .chatbot (Jarvis) TOGGLE ────────────────────
    {
        name: 'chatbot',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const action = args?.trim().toLowerCase() || '';
            const isOn = action === 'on' || (!action && !config.chatbotChats?.includes(jid));

            if (isOn) {
                config.chatbotChats = [...new Set([...config.chatbotChats, jid])];
                config.lizzyChats = (config.lizzyChats || []).filter(c => c !== jid);
                config.fridayChats = (config.fridayChats || []).filter(c => c !== jid);

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
                await sock.sendMessage(jid, {
                    text: `⚙️ *Systems are now online.*\n📶 *Network Latency:* \`${Date.now() - msg.messageTimestamp * 1000}ms\``,
                    edit: loadingMsg.key
                });
            } else {
                config.chatbotChats = (config.chatbotChats || []).filter(c => c !== jid);
                await sock.sendMessage(jid, { text: "🤖 Chatbot is now *off*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // ─── chatbot_chat (prefixless interceptor) ──────────────────
    {
        name: 'chatbot_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!config.chatbotChats?.includes(jid)) return;

            const lowerQuery = args ? args.toLowerCase().trim() : '';
            if (lowerQuery.startsWith(config.prefix)) return;

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
                    jarvisSystemPrompt += ` You are speaking directly to your owner. Address him respectfully as 'Sir' or 'Mr. ${config.ownerName}', but never refer to him as Master, Infinity, or Isaac.`;
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

                await sock.sendPresenceUpdate('composing', jid);

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].jarvis.push({ role: "user", content: args });
                global.aiMemory[jid].jarvis.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].jarvis.length > 50) {
                    global.aiMemory[jid].jarvis.shift();
                }

                await handleNaturalDelay(sock, jid, responseText, 'composing');

                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                console.error(error);
            }
        }
    },

    // ─── REWRITTEN .friday TOGGLE ────────────────────────────────
    {
        name: 'friday',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const action = args?.trim().toLowerCase() || '';
            const isOn = action === 'on' || (!action && !config.fridayChats?.includes(jid));

            if (isOn) {
                config.fridayChats = [...new Set([...config.fridayChats, jid])];
                config.lizzyChats = (config.lizzyChats || []).filter(c => c !== jid);
                config.chatbotChats = (config.chatbotChats || []).filter(c => c !== jid);
                await sock.sendMessage(jid, { text: "🤖 Chatbot is now *on*" }, { quoted: msg });
            } else {
                config.fridayChats = (config.fridayChats || []).filter(c => c !== jid);
                await sock.sendMessage(jid, { text: "🤖 Chatbot is now *off*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // ─── friday_chat (prefixless interceptor) ──────────────────
    {
        name: 'friday_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!config.fridayChats?.includes(jid)) return;

            const lowerQuery = args ? args.toLowerCase().trim() : '';
            if (lowerQuery.startsWith(config.prefix)) return;

            try {
                let fridaySystemPrompt =
                    "You are FRIDAY, Tony Stark's highly advanced, loyal, and efficient Irish female AI assistant from the Iron Man suit. " +
                    "Your personality is technical, tactical, wittily sarcastic, and completely devoted. " +
                    "Keep your responses extremely brief and status-oriented (like a tactical combat report of 2 sentences maximum). " +
                    "You have absolute expert knowledge regarding 'Limitless-MD', a modular WhatsApp bot containing vision parameters, " +
                    "hot-reload trigger systems, and advanced textual games (Vault 8, PVP battles, Trivia).";

                if (isDev) {
                    fridaySystemPrompt += " You are speaking directly to your developer. You must address him as 'Mr. Isaac' or 'Mr. Isaac' with absolute loyalty.";
                } else if (isOwner) {
                    fridaySystemPrompt += ` You are speaking directly to your owner. Address him respectfully as 'Sir' or 'Mr. ${config.ownerName}', but never refer to him as Master, Infinity, or Isaac.`;
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

                await sock.sendPresenceUpdate('recording', jid);

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].friday.push({ role: "user", content: args });
                global.aiMemory[jid].friday.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].friday.length > 50) {
                    global.aiMemory[jid].friday.shift();
                }

                const audioBuffer = await synthesizeFridayVoice(responseText);
                if (audioBuffer) {
                    await handleNaturalDelay(sock, jid, responseText, 'recording');
                    await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                } else {
                    await handleNaturalDelay(sock, jid, responseText, 'composing');
                    await sock.sendMessage(jid, { text: `[Voice Fallback] ${responseText}` }, { quoted: msg });
                }
            } catch (error) {
                console.error("FRIDAY Chat Error:", error);
            }
        }
    },

    // ─── .say — Text-to-Speech ──────────────────────────────────
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

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'ai') aliases.push({ ...cmd, name: 'groq' });
    if (cmd.name === 'chatbot') {
        aliases.push({ ...cmd, name: 'jarvis' });
        aliases.push({ ...cmd, name: 'lizzy' }); // optional alias
    }
});
module.exports.push(...aliases);