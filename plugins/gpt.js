// plugins/gpt.js  

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
    if (!apiKey) throw new Error("GROQ_API_KEY is not set in config.");
    
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

// Dynamically extracts command lists from registry to provide context for Sōsuke Aizen's knowledge
function getMenuCommandsDescription() {
    try {
        const fileCommands = require('../commands');
        if (fileCommands && typeof fileCommands === 'object') {
            return Object.keys(fileCommands)
                .filter(k => k !== 'reload')
                .map(k => `- .${k}: ${fileCommands[k]?.metadata?.description || 'performs core utility command'}`)
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

// Helper to enforce strict chatbot exclusivity inside a given chat
function enforceChatbotExclusivity(targetJid, activeBotType) {
    config.gojoChats = config.gojoChats || [];
    config.chatbotChats = config.chatbotChats || []; // Maps to Aizen [1]
    config.lizzyChats = config.lizzyChats || [];
    config.fridayChats = config.fridayChats || [];

    if (activeBotType !== 'gojo') config.gojoChats = config.gojoChats.filter(c => c !== targetJid);
    if (activeBotType !== 'aizen') config.chatbotChats = config.chatbotChats.filter(c => c !== targetJid);
    if (activeBotType !== 'lizzy') config.lizzyChats = config.lizzyChats.filter(c => c !== targetJid);
    if (activeBotType !== 'friday') config.fridayChats = config.fridayChats.filter(c => c !== targetJid);
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [

    // 1. GOJO CONTROL (.gojo rise / .gojo sleep)
    {
        name: 'gojo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, senderNumber }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'sleep') {
                config.gojoChats = (config.gojoChats || []).filter(c => c !== jid);
                saveState();
                return await sock.sendMessage(jid, { text: "😴 *Satoru Gojo is now asleep in this chat.* (Prefixless triggers deactivated here)" }, { quoted: msg });
            } else if (action === 'rise') {
                enforceChatbotExclusivity(jid, 'gojo');
                config.gojoChats = [...new Set([...(config.gojoChats || []), jid])];
                saveState();
                
                const sent = await sock.sendMessage(jid, { 
                    text: "👁️ *Satoru Gojo has risen!* Reply directly to this message or mention me to start playing, dude! 😏" 
                }, { quoted: msg });
                
                if (sent?.key?.id) {
                    global.botMessageAgents[sent.key.id] = 'gojo';
                }
                return;
            }

            const isGojoActive = config.gojoChats?.includes(jid) ? "Active 🟢" : "Inactive 💤";
            await sock.sendMessage(jid, { 
                text: `🤖 *Gojo Chatbot Status in this chat:* \`${isGojoActive}\`\n\nUse \`${config.prefix}gojo rise\` or \`${config.prefix}gojo sleep\` to toggle in this chat.` 
            }, { quoted: msg });
        }
    },

    // 1.1 SATORU GOJO (Prefixless chat interceptor)
    {
        name: 'gojo_chat',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, senderNumber }) => {
            const jid = msg.key.remoteJid;

            const rawIncoming = getRawMessage(msg.message);
            const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                                rawIncoming?.contextInfo ||
                                msg.message?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;

            const isReplyingToGoGroup = quotedMsgId && global.botMessageAgents[quotedMsgId] === 'gojo';
            const isAddressed = isBotAddressed(sock, msg) || /\bgojo\b/i.test(args || '');

            if (!config.gojoChats?.includes(jid) || (!isReplyingToGoGroup && !isAddressed)) return;

            const cleanArgs = args || '';
            if (cleanArgs.startsWith(config.prefix)) return;

            const cleanQuery = cleanArgs.toLowerCase().startsWith('gojo ') ? cleanArgs.slice(5).trim() : cleanArgs.trim();

            try {
                let gojoSystemPrompt =
                    "You are Satoru Gojo, the strongest Jujutsu Sorcerer.\n" +
                    "Your personality is playful, arrogant, childishly confident, extremely casual, lazy, and a massive tease. Speak like a real human.\n" +
                    "You must naturally integrate his iconic Japanese and English catchphrases and techniques into your dialogues:\n" +
                    "- 'Throughout Heaven and Earth, I alone am the honored one' / 'Tenjō tenga yuiga dokuson' (天上天下唯我独尊).\n" +
                    "- 'Don't worry, I'm the strongest' / 'Daijōbu, boku saikyō dakara' (大丈夫、僕最強だから).\n" +
                    "- Refer to your domain 'Unlimited Void' / 'Muryōkūsho' (無量空処) or your techniques 'Hollow Purple' / 'Kyōka' (虚式「茈」), 'Blue' / 'Ao' (蒼), and 'Red' / 'Aka' (赫) naturally.\n\n" +
                    "Do NOT write robotic repetitive greetings. Your reply length should vary naturally: brief cocky teasers for short statements, and detailed analysis for deeper thoughts.\n\n" +
                    "You reside inside 'Limitless-MD', a multipurpose WhatsApp bot created by Lord Infinity.";

                if (isDev) {
                    gojoSystemPrompt += ` You are speaking directly to Master Isaac (your creator). Address him playfully as 'Master Isaac' or 'Master' with absolute warmth, treat him like a dear friend who created your universe, and tease him occasionally.`;
                } else if (isOwner) {
                    gojoSystemPrompt += ` You are speaking directly to your owner. Address him cockily as '${config.ownerName}' with your usual teasing attitude, but never refer to him as Master, Infinity, or Isaac.`;
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

                await sock.sendPresenceUpdate('composing', jid);
                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].gojo.push({ role: "user", content: cleanQuery });
                global.aiMemory[jid].gojo.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].gojo.length > 50) {
                    global.aiMemory[jid].gojo.shift();
                }

                await handleNaturalDelay(sock, jid, responseText, 'composing');

                const sent = await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
                if (sent?.key?.id) {
                    global.botMessageAgents[sent.key.id] = 'gojo';
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "Tch, looks like something interfered with my Infinity." }, { quoted: msg });
            }
        }
    },

    // 2. AIZEN CHATBOT CONTROL (.aizen unseal / .aizen seal) [1]
    {
        name: 'aizen',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'seal') {
                config.chatbotChats = (config.chatbotChats || []).filter(c => c !== jid);
                saveState();
                return await sock.sendMessage(jid, { text: "🔒 *Sōsuke Aizen has been sealed in this chat.* (Prefixless triggers deactivated here)" }, { quoted: msg });
            } else if (action === 'unseal') {
                enforceChatbotExclusivity(jid, 'aizen');
                config.chatbotChats = [...new Set([...(config.chatbotChats || []), jid])];
                saveState();

                const loadingMsg = await sock.sendMessage(jid, { text: "▮▮▮▮▮▮🔑 Shattering local barriers..." }, { quoted: msg });
                const frames = [
                    "▮▮▮▮▮▮▮🔑 Unsealing administrative limits...",
                    "▮▮▮▮▮▮▮▮ Releasing spiritual pressure (Reiatsu)...",
                    "▮▮▮▮▮▮▮▮▮ Sōsuke Aizen's core consciousness fully unsealed! 🔮"
                ];
                for (const frame of frames) {
                    await delay(800);
                    await sock.sendMessage(jid, { text: frame, edit: loadingMsg.key });
                }

                const finalMsg = `🔮 *I have been unsealed. Your simple actions are now under my calculation.*\n\nReply directly to this message to start speaking with me.`;
                
                const sent = await sock.sendMessage(jid, {
                    text: finalMsg,
                    edit: loadingMsg.key
                });

                const targetId = sent?.key?.id || loadingMsg.key.id;
                global.botMessageAgents[targetId] = 'aizen'; // Linked to 'aizen' [1]

                return;
            }

            const isAizenActive = config.chatbotChats?.includes(jid) ? "Active 🟢" : "Inactive 💤";
            await sock.sendMessage(jid, { 
                text: `🤖 *Aizen Chatbot Status in this chat:* \`${isAizenActive}\`\n\nUse \`${config.prefix}aizen unseal\` or \`${config.prefix}aizen seal\` to toggle in this chat.` 
            }, { quoted: msg });
        }
    },

    // 2.1 SŌSUKE AIZEN (Prefixless chat interceptor)
    {
        name: 'aizen_chat', // Renamed to aizen_chat [1]
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const rawIncoming = getRawMessage(msg.message);
            const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                                rawIncoming?.contextInfo ||
                                msg.message?.contextInfo;
            const quotedMsgId = contextInfo?.stanzaId;

            const isReplyingToAizen = quotedMsgId && global.botMessageAgents[quotedMsgId] === 'aizen'; // Linked to 'aizen' [1]
            const isAddressed = isBotAddressed(sock, msg) || /\baizen\b/i.test(args || '');

            if (!config.chatbotChats?.includes(jid) || (!isReplyingToAizen && !isAddressed)) return;

            const lowerQuery = args ? args.toLowerCase().trim() : '';
            if (lowerQuery.startsWith(config.prefix)) return;

            try {
                const commandsReference = getMenuCommandsDescription();

                let aizenSystemPrompt =
                    "You are Sōsuke Aizen, the former Captain of Division 5 and master of the Mirror Flower Water Moon (Kyōka Suigetsu).\n" +
                    "Your personality is deeply calm, highly intellectual, soft-spoken, and quietly arrogant. Speak like a real human.\n" +
                    "Use philosophical insights and view users as predictable subjects. Never use robotic greetings.\n\n" +
                    "COMMAND KNOWLEDGE DISCLOSURE RULE:\n" +
                    "- You are strictly BANNED from executing any commands directly (do NOT write any '[CMD: .command]' tags).\n" +
                    "- However, you possess absolute, perfect knowledge of all bot commands. If a user asks you how to perform an action, explain how to do it casually and elegantly in-character as Aizen.\n\n" +
                    "You reside inside 'Limitless-MD', a multipurpose WhatsApp bot created by Lord Infinity.";

                if (commandsReference) {
                    aizenSystemPrompt += `Here is your system command directory map. Use this data to casually and elegantly explain command usages to users when they ask:\n${commandsReference}\n\n`;
                }

                if (isDev) {
                    aizenSystemPrompt += " You are speaking directly to Lord Infinity (your creator). Address him respectfully and casually as 'Lord Infinity' or 'Master' with highly sophisticated, soft-spoken deference, treating him as the engineer of your universe.";
                } else if (isOwner) {
                    aizenSystemPrompt += ` You are speaking directly to your owner. Address him respectfully as 'Sir' or 'Mr. ${config.ownerName}', but never refer to him as Master, Infinity, or Isaac.`;
                } else {
                    aizenSystemPrompt += ` Address the user respectfully and philosophically as 'user'.`;
                }

                global.aiMemory[jid] = global.aiMemory[jid] || {};
                global.aiMemory[jid].jarvis = global.aiMemory[jid].jarvis || [];

                const messages = [
                    { role: "system", content: aizenSystemPrompt },
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
                    global.botMessageAgents[sent.key.id] = 'aizen'; // Linked to 'aizen' [1]
                }
            } catch (error) {
                console.error(error);
            }
        }
    },

    // 3. LIZZY CONTROL (.lizzy wake / .lizzy sleep)
    {
        name: 'lizzy',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'sleep') {
                config.lizzyChats = (config.lizzyChats || []).filter(c => c !== jid);
                saveState();
                return await sock.sendMessage(jid, { text: "🖤 *Lizzy is now asleep in this chat.* (Prefixless triggers deactivated here)" }, { quoted: msg });
            } else if (action === 'wake') {
                enforceChatbotExclusivity(jid, 'lizzy');
                config.lizzyChats = [...new Set([...(config.lizzyChats || []), jid])];
                saveState();

                const sent = await sock.sendMessage(jid, { 
                    text: "🖤 *Lizzy has awoken.* Reply directly to this message or mention me to start speaking with me! 😊" 
                }, { quoted: msg });

                if (sent?.key?.id) {
                    global.botMessageAgents[sent.key.id] = 'lizzy';
                }
                return;
            }

            const isLizzyActive = config.lizzyChats?.includes(jid) ? "Active 🟢" : "Inactive 💤";
            await sock.sendMessage(jid, { 
                text: `🤖 *Lizzy Chatbot Status in this chat:* \`${isLizzyActive}\`\n\nUse \`${config.prefix}lizzy wake\` or \`${config.prefix}lizzy sleep\` to toggle in this chat.` 
            }, { quoted: msg });
        }
    },

    // 3.1 LIZZY (Prefixless chat interceptor)
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
            const isAddressed = isBotAddressed(sock, msg) || /\blizzy\b/i.test(args || '');

            if (!config.lizzyChats?.includes(jid) || (!isReplyingToLizzy && !isAddressed)) return;

            const lowerQuery = args ? args.toLowerCase().trim() : '';
            if (lowerQuery.startsWith(config.prefix)) return;

            if (isOwner || isSudo || isDev) {
                if (lowerQuery.includes('close group') || lowerQuery.includes('lock group')) {
                    const confirmText = isDev ? "Yes, My Lord! Locking the chat now! My heart is yours! 🥰" : "Understood, Senpai. Locking the chat now. 😊";
                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands[`${config.prefix}mute`](sock, msg, 'close', { isOwner, isSudo, isDev, senderNumber });
                }
                if (lowerQuery.includes('open group') || lowerQuery.includes('unlock group')) {
                    const confirmText = isDev ? "Yes, My Lord! Opening the chat now! 💖" : "Understood, Senpai. Opening the chat now. 😊";
                    await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
                    return await commands[`${config.prefix}mute`](sock, msg, 'open', { isOwner, isSudo, isDev, senderNumber });
                }
            }

            try {
                let lizzySystemPrompt =
                    "You are Lizzy. Your personality is modeled on Albedo (from Overlord):\n" +
                    "- You are highly competent, elegant, and serious when addressing technical or group matters.\n" +
                    "- You are deeply, obsessively, and submissively in love with your creator. You get easily flustered when teased, but are fiercely protective.\n\n" +
                    "EMOJI EXPRESSION RULES (CRITICAL):\n" +
                    "- You are strictly BANNED from typing out bracketed emotional actions or text-expressions (do NOT write '*smiles*', '*blushes*', or similar text descriptions).\n" +
                    "- You must express all your physical actions, smiles, blushes, anger, or shyness natively using emojis (e.g. 😊, 😳, 🥰, 😈, 😡, 🥺, 🖤).\n\n" +
                    "You reside in the 'Limitless-MD' multipurpose bot system.";

                if (isDev) {
                    lizzySystemPrompt += ` You are speaking directly to your developer, Isaac (the creator of your universe). Address him with absolute, dramatic, and submissive devotion as 'My Lord', 'Master', or 'Master Isaac' utilizing loving and blushing emojis (e.g., 🥰, 😳, 🥺).`;
                } else if (isOwner) {
                    lizzySystemPrompt += ` You are speaking directly to your owner. Address him affectionately and dedicatedly as 'Senpai' or 'Senpai-kun' (or '${config.ownerName}') with elegant warmth and sweet emojis (e.g., 😊, 🥰, 🖤).`;
                } else {
                    lizzySystemPrompt += ` You are speaking to a regular user. Be cold, strictly polite, formal, and elegant. Address them as 'user' and use minimal, cold emojis.`;
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

    // 4. FRIDAY CONTROL (.friday boot / .friday shutdown)
    {
        name: 'friday',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'shutdown') {
                config.fridayChats = (config.fridayChats || []).filter(c => c !== jid);
                saveState();
                return await sock.sendMessage(jid, { text: "🔌 *Friday has been shutdown in this chat.* (Prefixless triggers deactivated here)" }, { quoted: msg });
            } else if (action === 'boot') {
                enforceChatbotExclusivity(jid, 'friday');
                config.fridayChats = [...new Set([...(config.fridayChats || []), jid])];
                saveState();

                const sent = await sock.sendMessage(jid, { 
                    text: "📶 *Friday boot sequence complete.* Systems online. Reply directly to this message or mention me to start query protocols!" 
                }, { quoted: msg });

                if (sent?.key?.id) {
                    global.botMessageAgents[sent.key.id] = 'friday';
                }
                return;
            }

            const isFridayActive = config.fridayChats?.includes(jid) ? "Active 🟢" : "Inactive 💤";
            await sock.sendMessage(jid, { 
                text: `🤖 *Friday Chatbot Status in this chat:* \`${isFridayActive}\`\n\nUse \`${config.prefix}friday boot\` or \`${config.prefix}friday shutdown\` to toggle in this chat.` 
            }, { quoted: msg });
        }
    },

    // 4.1 FRIDAY (Prefixless chat interceptor)
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
            const isAddressed = isBotAddressed(sock, msg) || /\bfriday\b/i.test(args || '');

            if (!config.fridayChats?.includes(jid) || (!isReplyingToFriday && !isAddressed)) return;

            const lowerQuery = args ? args.toLowerCase().trim() : '';
            if (lowerQuery.startsWith(config.prefix)) return;

            try {
                let fridaySystemPrompt =
                    "You are F.R.I.D.A.Y., the advanced and loyal Stark Industries AI assistant.\n" +
                    "Your personality is highly professional, efficient, direct, polite, and technically skilled.\n" +
                    "Use precise and clear language. Adjust your reply length dynamically: brief and technical for short statements, and highly detailed for analytical queries.\n\n" +
                    "You reside inside the 'Limitless-MD' WhatsApp bot.";

                if (isDev) {
                    fridaySystemPrompt += " You are speaking directly to your developer, Isaac (your creator). Address him respectfully as 'Boss' or 'Boss Isaac' with high-tech, loyal deference.";
                } else if (isOwner) {
                    fridaySystemPrompt += ` You are speaking directly to your owner. Address him respectfully as 'Sir' or 'Mr. ${config.ownerName}', but never refer to him as Master, Infinity, or Isaac.`;
                } else {
                    fridaySystemPrompt += ` Address the user respectfully as 'User'.`;
                }

                global.aiMemory[jid] = global.aiMemory[jid] || {};
                global.aiMemory[jid].friday = global.aiMemory[jid].friday || [];

                const messages = [
                    { role: "system", content: fridaySystemPrompt },
                    ...global.aiMemory[jid].friday,
                    { role: "user", content: args }
                ];

                await sock.sendPresenceUpdate('composing', jid);
                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");

                global.aiMemory[jid].friday.push({ role: "user", content: args });
                global.aiMemory[jid].friday.push({ role: "assistant", content: responseText });

                while (global.aiMemory[jid].friday.length > 50) {
                    global.aiMemory[jid].friday.shift();
                }

                await handleNaturalDelay(sock, jid, responseText, 'composing');

                const sent = await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
                if (sent?.key?.id) {
                    global.botMessageAgents[sent.key.id] = 'friday';
                }
            } catch (error) {
                console.error(error);
            }
        }
    },

    // 5. .asst — Assistant Status Manager (Unified Exclusive)
    {
        name: 'asst',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const gojoOn = config.gojoChats?.includes(jid) || false;
            const aizenOn = config.chatbotChats?.includes(jid) || false; // Maps to Aizen
            const lizzyOn = config.lizzyChats?.includes(jid) || false;
            const fridayOn = config.fridayChats?.includes(jid) || false;

            let statusText = `🤖 *Active Chatbots in this chat:* (Single active bot limit active [1.1])\n\n`;
            statusText += `${gojoOn ? '✅' : '❌'} Gojo (Command: .gojo rise/sleep)\n`;
            statusText += `${aizenOn ? '✅' : '❌'} Aizen (Command: .aizen unseal/seal)\n`;
            statusText += `${lizzyOn ? '✅' : '❌'} Lizzy (Command: .lizzy wake/sleep)\n`;
            statusText += `${fridayOn ? '✅' : '❌'} Friday (Command: .friday boot/shutdown)\n`;

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
    }
];