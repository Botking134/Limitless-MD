const config = require('../config');

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

// ─── HELPERS ──────────────────────────────────────────────────────

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

    // 2. .debug — Code Analysis
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

    // 3. .summon — Roleplay Character
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

            try {
                const summonVideoUrl = "https://files.catbox.moe/2bg9l1.mp4"; 

                await sock.sendMessage(jid, {
                    video: { url: summonVideoUrl },
                    caption: `🔮 Summoning Jutsu!!\n*${character}* Rise...🧙‍♂️`,
                    gifPlayback: true
                }, { quoted: msg });
            } catch (mediaError) {
                console.error("[Summon Media Error] Failed to send summoning animation:", mediaError.message);
                await sock.sendMessage(jid, { 
                    text: `🔮 *Summoning Jutsu... establishing contact with ${character}...*` 
                }, { quoted: msg });
            }

            try {
                const summonPrompt = `[System: You are '${character}'. Respond strictly in character using their lore and tone. Keep it concise.]\nQuery: ${query}`;
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

    // 4. .read — Image Vision
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
                    text: "❌ Please reply to an image or upload an image with the caption `.read <question>`"
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

    // 5. .imagine — AI Image Generator
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

    // 6. .say — Text-to-Speech
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
});
module.exports.push(...aliases);