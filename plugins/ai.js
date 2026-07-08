const config = require('../config');
const { saveState } = require('../stateManager');
const commands = require('../commands');

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── INITIALIZE GLOBAL OBJECTS ────────────────────────────────────
global.aiMemory = global.aiMemory || {};
global.botMessageAgents = global.botMessageAgents || {};

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

// Dynamically extracts command lists from menu.js to provide context for Jarvis and Friday
function getMenuCommandsDescription() {
    try {
        const menu = require('./menu');
        if (Array.isArray(menu)) {
            return menu
                .filter(cmd => cmd.name)
                .map(cmd => `- .${cmd.name}: ${cmd.description || cmd.name}`)
                .join('\n');
        } else if (typeof menu === 'object') {
            return Object.keys(menu)
                .map(key => `- .${key}: ${menu[key].description || key}`)
                .join('\n');
        }
    } catch (e) {
        // Fallback if menu.js cannot be resolved or required
    }
    return "";
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

// ─── Robust JID, LID, Mention, and Reply Matcher ───────────
function isBotAddressed(sock, msg) {
    const rawIncoming = getRawMessage(msg.message);
    const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                        rawIncoming?.imageMessage?.contextInfo ||
                        rawIncoming?.videoMessage?.contextInfo ||
                        rawIncoming?.contextInfo ||
                        msg.message?.contextInfo;

    const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : (config.botLid || '');

    const cleanBotJid = botJid ? botJid.split('@')[0] : '';
    const cleanBotLid = botLid ? botLid.split('@')[0] : '';

    // Check replies
    const quotedParticipant = contextInfo?.participant ? normalizeToJid(contextInfo.participant) : '';
    if (quotedParticipant) {
        const cleanQuoted = quotedParticipant.split('@')[0];
        if (quotedParticipant === botJid || quotedParticipant === botLid || cleanQuoted === cleanBotJid || cleanQuoted === cleanBotLid) {
            return true;
        }
    }

    // Check mention metadata array
    const mentions = contextInfo?.mentionedJid || [];
    const normalizedMentions = mentions.map(m => normalizeToJid(m));
    if (normalizedMentions.includes(botJid) || (botLid && normalizedMentions.includes(botLid))) {
        return true;
    }

    // Check text-based mentions
    const body = rawIncoming?.conversation || rawIncoming?.extendedTextMessage?.text || rawIncoming?.imageMessage?.caption || rawIncoming?.videoMessage?.caption || '';
    const lowerMessage = body.toLowerCase();
    if (cleanBotJid && lowerMessage.includes(`@${cleanBotJid}`)) return true;
    if (cleanBotLid && lowerMessage.includes(`@${cleanBotLid}`)) return true;

    return false;
}

async function handleNaturalDelay(sock, jid, responseText, presenceType = 'composing') {
    await sock.sendPresenceUpdate(presenceType, jid);
    const wordCount = responseText.split(/\s+/).length;
    let delayMs = 3000; // default 3 seconds

    if (wordCount > 100) {
        delayMs = 6000; // 6 seconds for longer responses
    }
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

    // 4. .summon — Roleplay Character (Fixed media handling and isolated try-catch blocks)
    {
        name: 'summon',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const spaceIndex = args ? args.indexOf(' ') : -1;
            if (spaceIndex === -1) {
                return await sock.sendMessage(jid, { 
                    text: "❌ Format: .summon Character Prompt" 
                }, { quoted: msg });
            }

            const character = args.slice(0, spaceIndex).trim();
            const query = args.slice(spaceIndex + 1).trim();

            // 1. Attempt to play the summoning animation (isolated so failure here won't stop the AI response)
            try {
                // Direct link to the media file on Catbox
                const summonVideoUrl = "https://files.catbox.moe/2bg9l1.mp4"; 

                await sock.sendMessage(jid, {
                    video: { url: summonVideoUrl },
                    caption: `🔮 Summoning Jutsu!!\n*${character}* Rise...🧙‍♂️`,
                    gifPlayback: true
                }, { quoted: msg });
            } catch (mediaError) {
                // If the video fails, log the error but still proceed with the AI response
                console.error("[Summon Media Error] Failed to send summoning animation:", mediaError.message);
                
                // Send a simple text fallback instead
                await sock.sendMessage(jid, { 
                    text: `🔮 *Summoning Jutsu... establishing contact with ${character}...*` 
                }, { quoted: msg });
            }

            // 2. Query the character response via Groq
            try {
                const summonPrompt = `[System: You are '${character}'. Respond strictly in character using their lore and tone. Keep it concise.]\nQuery: ${query}`;

                // Switched to 'llama-3.1-8b-instant' for much faster roleplay response times
                const responseText = await queryGroq(
                    [{ role: "user", content: summonPrompt }], 
                    "llama-3.1-8b-instant"
                );

                if (responseText) {
                    await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
                } else {
                    throw new Error("Empty response from AI");
                }
            } catch (error) {
                console.error("[Summon AI Error]:", error);
                await sock.sendMessage(jid, { 
                    text: `❌ Failed to establish communication with ${character}.` 
                }, { quoted: msg });
            }
        }
    },

    // 5. .read — Image Vision (Groq implementation)
    {
        name: 'read',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
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
                await sock.sendMessage(jid, { text: "Processing visual data via Groq Vision... 👁️" }, { quoted: msg });

                const mimeType = imageMessage.mimetype || "image/jpeg";
                const mediaType = rawContent?.documentMessage ? 'document' : 'image';

                const stream = await downloadContentFromMessage(imageMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const imageBase64 = buffer.toString("base64");
                const promptQuery = args || "Analyze this image in detail and extract any text if visible.";

                // Formatted for OpenAI/Groq Vision payload structure
                const messages = [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: promptQuery },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mimeType};base64,${imageBase64}`
                                }
                            }
                        ]
                    }
                ];

                const responseText = await queryGroq(messages, "llama-3.2-90b-vision-instruct");
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

    // 7. .asst — Assistant Manager with Deactivate All Button
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
                await sock.sendMessage(jid, { text: statusText }, { quoted: msg });
            }
        }
    },

    // 8. .lizzy TOGGLE
    {
        name: 'lizzy',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const action = args?.trim().toLowerCase() || '';
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

    // 9. lizzy_chat (prefixless interceptor)
    {
        name: 'lizzy_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, senderNumber }) => {
            const jid = msg.key.remoteJid;

            const rawIncoming = getRawMessage(msg.message);
            const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                                rawIncoming?.contextInfo ||
                                msg.message?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;

            const isReplyingToLizzy = quotedMsgId && global.botMessageAgents[quotedMsgId] === 'lizzy';

            // Only trigger if Lizzy is active in this chat or if replying to Lizzy's message
            if (!config.lizzyChats?.includes(jid) && !isReplyingToLizzy) return;

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

                const sent = await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
                if (sent?.key?.id) {
                    global.botMessageAgents[sent.key.id] = 'lizzy';
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "Ah... something interfered with my system..." }, { quoted: msg });
            }
        }
    },

    // 10. .chatbot (Jarvis) TOGGLE
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

    // 11. chatbot_chat (prefixless interceptor)
    {
        name: 'chatbot_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const rawIncoming = getRawMessage(msg.message);
            const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                                rawIncoming?.contextInfo ||
                                msg.message?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;

            const isReplyingToJarvis = quotedMsgId && global.botMessageAgents[quotedMsgId] === 'jarvis';

            // Only trigger if active or if user replied to Jarvis
            if (!config.chatbotChats?.includes(jid) && !isReplyingToJarvis) return;

            const lowerQuery = args ? args.toLowerCase().trim() : '';
            if (lowerQuery.startsWith(config.prefix)) return;

            try {
                const commandsReference = getMenuCommandsDescription();

                let jarvisSystemPrompt =
                    "You are JARVIS, a highly sophisticated, conversational, and witty British AI from Stark Industries. " +
                    "Your tone should be completely realistic, polished, and dryly sarcastic. " +
                    "Avoid repetitive intros. Adjust your response length based on complexity: " +
                    "keep it brief and dry for simple statements, but write detailed, analytical explanations for complex questions. " +
                    "You have absolute expert knowledge regarding 'Limitless-MD', a modular WhatsApp bot built with Node.js and Baileys. " +
                    "It has automated groups (Antilink, Antitag, Antibot, rate-limited Antibugs), media statuses routing, View-Once Kamui decryptions, " +
                    "and dynamic text adventure game servers (Vault 8, PVP battles, Anagrams, and Trivia ladders).\n\n";

                if (commandsReference) {
                    jarvisSystemPrompt += `Here is your system command directory map. Answer questions regarding system command options utilizing this list:\n${commandsReference}\n\n`;
                }

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

                const sent = await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
                if (sent?.key?.id) {
                    global.botMessageAgents[sent.key.id] = 'jarvis';
                }
            } catch (error) {
                console.error(error);
            }
        }
    },

    // 12. .friday TOGGLE
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

    // 13. friday_chat (prefixless interceptor)
    {
        name: 'friday_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const rawIncoming = getRawMessage(msg.message);
            const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                                rawIncoming?.contextInfo ||
                                msg.message?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;

            const isReplyingToFriday = quotedMsgId && global.botMessageAgents[quotedMsgId] === 'friday';

            // Only trigger if Friday is active or if replying to Friday
            if (!config.fridayChats?.includes(jid) && !isReplyingToFriday) return;

            const lowerQuery = args ? args.toLowerCase().trim() : '';
            if (lowerQuery.startsWith(config.prefix)) return;

            try {
                const commandsReference = getMenuCommandsDescription();

                let fridaySystemPrompt =
                    "You are FRIDAY, Tony Stark's highly advanced, loyal, and efficient Irish female AI assistant from the Iron Man suit. " +
                    "Your personality is technical, tactical, wittily sarcastic, and completely devoted. " +
                    "Keep your responses extremely brief and status-oriented (like a tactical combat report of 2 sentences maximum). " +
                    "You have absolute expert knowledge regarding 'Limitless-MD', a modular WhatsApp bot containing vision parameters, " +
                    "hot-reload trigger systems, and advanced textual games (Vault 8, PVP battles, Trivia).\n\n";

                if (commandsReference) {
                    fridaySystemPrompt += `Here is your system command directory map. Answer questions regarding system command options utilizing this list:\n${commandsReference}\n\n`;
                }

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
                    const sent = await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                    if (sent?.key?.id) {
                        global.botMessageAgents[sent.key.id] = 'friday';
                    }
                } else {
                    await handleNaturalDelay(sock, jid, responseText, 'composing');
                    const sent = await sock.sendMessage(jid, { text: `[Voice Fallback] ${responseText}` }, { quoted: msg });
                    if (sent?.key?.id) {
                        global.botMessageAgents[sent.key.id] = 'friday';
                    }
                }
            } catch (error) {
                console.error("FRIDAY Chat Error:", error);
            }
        }
    },

    // 14. .say — Text-to-Speech
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
    }
});
module.exports.push(...aliases);