//plugins/gpt.js  

const config = require('../config');
const { saveState } = require('../stateManager');
const commands = require('../commands');
const axios = require('axios');

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
    
    const response = await axios.post(GROQ_BASE_URL, {
        model,
        messages,
        temperature: 0.7
    }, {
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        }
    });
    return response.data.choices?.[0]?.message?.content || "";
}

// Dynamically extracts command lists from menu.js to provide context for Jarvis and Gojo
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
    } catch (e) { /* ignore */ }
    return "";
}

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

    const quotedParticipant = contextInfo?.participant ? normalizeToJid(contextInfo.participant) : '';
    if (quotedParticipant) {
        const cleanQuoted = quotedParticipant.split('@')[0];
        if (quotedParticipant === botJid || quotedParticipant === botLid || cleanQuoted === cleanBotJid || cleanQuoted === cleanBotLid) {
            return true;
        }
    }

    const mentions = contextInfo?.mentionedJid || [];
    const normalizedMentions = mentions.map(m => normalizeToJid(m));
    if (normalizedMentions.includes(botJid) || (botLid && normalizedMentions.includes(botLid))) {
        return true;
    }

    const body = rawIncoming?.conversation || rawIncoming?.extendedTextMessage?.text || rawIncoming?.imageMessage?.caption || rawIncoming?.videoMessage?.caption || '';
    const lowerMessage = body.toLowerCase();
    if (cleanBotJid && lowerMessage.includes(`@${cleanBotJid}`)) return true;
    if (cleanBotLid && lowerMessage.includes(`@${cleanBotLid}`)) return true;

    return false;
}

async function handleNaturalDelay(sock, jid, responseText, presenceType = 'composing') {
    await sock.sendPresenceUpdate(presenceType, jid);
    const wordCount = responseText.split(/\s+/).length;
    let delayMs = 3000;

    if (wordCount > 100) {
        delayMs = 6000;
    }
    await delay(delayMs);
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. Gojo Agent (Prefixless buddy, extracted from menu.js)
    {
        name: 'gojo',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, senderNumber }) => {
            const jid = msg.key.remoteJid;
            const cleanArgs = args || '';

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

            if (config.gojoGlobalSleep === true) return;

            const isAddressed = isBotAddressed(sock, msg) || /\bgojo\b/i.test(cleanArgs);
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
                    "Do NOT repeat greetings. Respond with organic variety. Your reply length must depend on the complexity of the query.\n\n" +
                    "You reside in 'Limitless-MD', a WhatsApp bot. You have the authorization to trigger administrative, conversion, and utility commands on behalf of users by parsing their natural language intent. " +
                    "When a user asks you to perform a task, check if it matches any capability in your command list. Respond normally in-character, but you MUST append a command execution tag at the very end of your response: [CMD: .commandName arguments]\n\n" +
                    "COMMAND TRIGGER DICTIONARY:\n" +
                    "- Show menu / list commands / drop menu: Append '[CMD: .menu]' or '[CMD: .menu2]'\n" +
                    "- Delete a message (reply context): Append '[CMD: .delete]'\n" +
                    "- Convert image/video/gif to sticker: Append '[CMD: .sticker]'\n" +
                    "- Convert sticker to image: Append '[CMD: .toimg]'\n" +
                    "- Convert video/audio to audio/mp3: Append '[CMD: .tomp3]'\n" +
                    "- Convert sticker/gif to video/mp4: Append '[CMD: .tomp4]'\n" +
                    "- Lock/close group: Append '[CMD: .close]'\n" +
                    "- Unlock/open group: Append '[CMD: .open]'\n" +
                    "- Mute chat: Append '[CMD: .mute]'\n\n";

                if (isDev) {
                    gojoSystemPrompt += ` You are speaking directly to your developer, Master Isaac. Address him playfully as 'Master Isaac' or 'Master' with your usual playful, teasing attitude, treating him like a dear friend who created your universe.`;
                } else if (isOwner) {
                    gojoSystemPrompt += ` You are speaking directly to your owner. Address him playfully as '${config.ownerName}' with your usual cocky, teasing attitude, but never refer to him as Master, Infinity, or Isaac.`;
                } else if (isSudo) {
                    gojoSystemPrompt += ` You are speaking directly to a Sudo user. Address him as 'dude'. Never refer to him as Master, Infinity, or Isaac.`;
                }

                global.aiMemory[jid] = global.aiMemory[jid] || {};
                global.aiMemory[jid].gojo = global.aiMemory[jid].gojo || [];

                const ruleReminder = "\n\n(IMPORTANT FORMAT RULE: If I asked you to do something that matches a command, you MUST append the exact execution tag at the absolute end of your response, e.g. '[CMD: .menu]' or '[CMD: .sticker]'. If I am only chatting, do not append any tags.)";
                const activeQuery = cleanQuery + ruleReminder;

                const messages = [
                    { role: "system", content: gojoSystemPrompt },
                    ...global.aiMemory[jid].gojo,
                    { role: "user", content: activeQuery }
                ];

                await sock.sendPresenceUpdate('composing', jid);
                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].gojo.push({ role: "user", content: cleanQuery });
                global.aiMemory[jid].gojo.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].gojo.length > 50) {
                    global.aiMemory[jid].gojo.shift();
                }

                const cmdRegex = /\[CMD:\s*(\.[a-zA-Z0-9_-]+.*?)\s*\]/;
                const match = responseText.match(cmdRegex);
                let cleanResponse = responseText;
                let extractedCmd = null;

                if (match) {
                    extractedCmd = match[1].trim();
                    cleanResponse = responseText.replace(cmdRegex, '').trim();
                }

                await handleNaturalDelay(sock, jid, cleanResponse, 'composing');

                const sent = await sock.sendMessage(jid, { text: cleanResponse }, { quoted: msg });
                if (sent?.key?.id) {
                    global.botMessageAgents[sent.key.id] = 'gojo';
                }

                if (extractedCmd) {
                    console.log(`[GOJO EXECUTION] Extracted command intent: "${extractedCmd}"`);
                    try {
                        const parts = extractedCmd.split(' ');
                        const cmdName = parts[0]; 
                        const cmdArgs = parts.slice(1).join(' '); 
                        const cleanCmdName = cmdName.startsWith('.') ? cmdName.slice(1) : cmdName;

                        let commandFunction;
                        if (Array.isArray(commands)) {
                            const targetCmd = commands.find(c => c.name === cleanCmdName);
                            if (targetCmd) commandFunction = targetCmd.execute;
                        } else if (typeof commands === 'object' && commands !== null) {
                            const found = commands[cleanCmdName] || commands[cmdName];
                            if (found) {
                                commandFunction = typeof found === 'function' ? found : found.execute;
                            }
                        }

                        if (commandFunction) {
                            await commandFunction(sock, msg, cmdArgs, { isOwner, isSudo, isDev, senderNumber });
                        }
                    } catch (cmdErr) {
                        console.error("❌ Gojo dynamic execution failed:", cmdErr.message);
                    }
                }

            } catch (error) {
                await sock.sendMessage(jid, { text: "Tch, looks like something interfered with my Infinity." }, { quoted: msg });
            }
        }
    },

    // 2. .asst — Assistant Status Manager
    {
        name: 'asst',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const lizzyOn = config.lizzyChats?.includes(jid) || false;
            const jarvisOn = config.chatbotChats?.includes(jid) || false;
            const gojoOn = !config.gojoGlobalSleep;

            let statusText = `🤖 *Active Chatbots in this chat:*\n\n`;
            statusText += `${lizzyOn ? '✅' : '❌'} Lizzy\n`;
            statusText += `${jarvisOn ? '✅' : '❌'} Jarvis\n`;
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
                        body: { text: 'Tap the button below to turn off ALL chatbots in this chat.' },
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

    // 3. .lizzy TOGGLE
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

                const sent = await sock.sendMessage(jid, { 
                    text: "🖤 *Lizzy is now activated.* Reply directly to this message to start speaking with me!" 
                }, { quoted: msg });

                if (sent?.key?.id) {
                    global.botMessageAgents[sent.key.id] = 'lizzy';
                }
            } else {
                config.lizzyChats = (config.lizzyChats || []).filter(c => c !== jid);
                await sock.sendMessage(jid, { text: "🖤 Chatbot is now *off*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 4. lizzy_chat (prefixless interceptor)
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

            // STRICT FILTER: Lizzy only triggers when a user explicitly replies to Lizzy
            if (!config.lizzyChats?.includes(jid) || !isReplyingToLizzy) return;

            const lowerQuery = args ? args.toLowerCase().trim() : '';
            if (lowerQuery.startsWith(config.prefix)) return;

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

    // 5. .chatbot (Jarvis) TOGGLE
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

                const finalMsg = `⚙️ *Systems are now online.*\n📶 *Network Latency:* \`${Date.now() - msg.messageTimestamp * 1000}ms\`\n\nReply directly to this message to talk to me!`;
                
                const sent = await sock.sendMessage(jid, {
                    text: finalMsg,
                    edit: loadingMsg.key
                });

                const targetId = sent?.key?.id || loadingMsg.key.id;
                global.botMessageAgents[targetId] = 'jarvis';

            } else {
                config.chatbotChats = (config.chatbotChats || []).filter(c => c !== jid);
                await sock.sendMessage(jid, { text: "🤖 Chatbot is now *off*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 6. chatbot_chat (prefixless interceptor)
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

            // STRICT FILTER: Jarvis only triggers when a user explicitly replies to Jarvis
            if (!config.chatbotChats?.includes(jid) || !isReplyingToJarvis) return;

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
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'chatbot') {
        aliases.push({ ...cmd, name: 'jarvis' });
    }
});
module.exports.push(...aliases);