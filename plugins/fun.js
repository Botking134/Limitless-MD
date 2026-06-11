// plugins/fun.js
const settings = require('../settings'); 
const { Sticker, StickerTypes } = require('wa-sticker-formatter'); 

// Loaded securely from environment mapping configs in settings
const KLIPY_API_KEY = settings.klipyApiKey;
const GROQ_API_KEY = settings.groqApiKey;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

async function queryGroq(messages, model = "llama-3.3-70b-versatile") {
    try {
        const response = await fetch(GROQ_BASE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({ model: model, messages: messages, temperature: 0.3 })
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        console.error("Groq Query Error (fun.js):", e.message);
        throw e;
    }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function toSans(text) {
    return text.split('').map(char => {
        const code = char.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(code - 65 + 0x1D5A0);
        if (code >= 97 && code <= 122) return String.fromCodePoint(code - 97 + 0x1D5BA);
        if (code >= 48 && code <= 57) return String.fromCodePoint(code - 48 + 0x1D7E2);
        return char;
    }).join('');
}

function getDeviceTypeFromId(id) {
    if (!id) return "UNKNOWN ❓";
    const len = id.length;
    if (len === 20 && id.startsWith('3A')) return "iOS (iPhone) 🍏";
    if (len === 12 || id.startsWith('3EB0') || id.startsWith('BAE5')) return "PC (Desktop) 💻";
    if (len === 32 || (len >= 16 && len <= 22 && !id.startsWith('3A'))) return "Android! 🤖";
    return "UNKNOWN ❓";
}

function extractEmojis(text) {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02B}\u{1F0A0}-\u{1F0B0}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;
    return text.match(emojiRegex) || [];
}

const bankaiData = [
    { name: "Ichigo Kurosaki", aliases: ["ichigo", "kurosaki"], position: "Substitute Shinigami", bankaiName: "Tensa Zangetsu", abilities: "Extreme speed and Black Getsuga Tensho blasts." },
    { name: "Rukia Kuchiki", aliases: ["rukia"], position: "Captain of Division 13", bankaiName: "Hakka no Togame", abilities: "Reaches absolute zero temperature instantly, freezing all matter." }
];

const domainData = [
    { name: "Satoru Gojo", aliases: ["gojo"], position: "Special Grade Sorcerer", domainName: "Unlimited Void (Muryōkūsho)", abilities: "Paralyzes targets instantly by flooding their brains with infinite raw information." }
];

const wyrQuestions = [
    { o1: "Always have wet socks", o2: "Always have a popcorn kernel stuck in your teeth" },
    { o1: "Only be able to whisper", o2: "Only be able to scream" }
];

const jokeData = [
    "Why don't skeletons fight each other? They don't have the guts.",
    "What do you call a fake noodle? An impasta."
];

const insultData = [
    "You're the reason the shampoo bottle has instructions.",
    "I've seen puddles deeper than your personality."
];

const roastData = [
    "If absolute zero is -273.15 degrees, your charisma is at least -300.",
    "I would roast you, but my mom told me not to burn trash."
];

const proposalMessages = [
    "From the moment I met you, my world changed. I want to build a domain with you.",
    "They say nothing is infinite, but my love for you defies that law."
];

const askoutMessages = [
    "I've been thinking about you a lot... can we be more than just group members?",
    "Will you go out with me?"
];

const rizzLines = [
    "Are you a cursed spirit? Because you've been haunting my mind all day.",
    "Is your name Gojo? Because you're the strongest thing that's ever hit my heart."
];

const famousSpeeches = [
    { character: "Satoru Gojo", speech: "Don't worry, I'm the strongest." },
    { character: "Sosuke Aizen", speech: "No one stands on the top of the world from the beginning. Not you, not me, not even Gods." }
];

async function executeAction(sock, msg, action, verb) {
    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const senderJid = msg.key.participant || msg.key.remoteJid || '';
    const senderNum = senderJid.split('@')[0];

    const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
    const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
    let targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');

    let captionText = "";
    let finalMentions = [];

    if (targetJid && targetJid !== senderJid) {
        captionText = `✨ @${senderNum} ${verb} @${targetJid.split('@')[0]}`;
        finalMentions = [senderJid, targetJid];
    } else {
        if (isGroup) {
            captionText = `✨ @${senderNum} ${verb} everybody!`;
            finalMentions = [senderJid];
        } else {
            captionText = `✨ @${senderNum} ${verb} themselves!`;
            finalMentions = [senderJid];
        }
    }

    try {
        const searchQuery = `anime ${action}`;
        
        // Retrieve results from Klipy using the config key
        const res = await fetch(`https://api.klipy.co/v1/gifs/search?api_key=${KLIPY_API_KEY}&q=${encodeURIComponent(searchQuery)}&limit=15`);
        if (!res.ok) throw new Error("Klipy lookup failed");

        const data = await res.json();
        const results = data.data || [];

        if (results.length > 0) {
            // Select a random GIF for variety
            const chosenGif = results[Math.floor(Math.random() * results.length)];
            const mp4Url = chosenGif.images?.original?.mp4 || chosenGif.images?.downsized?.mp4 || chosenGif.mp4;
            const gifUrl = chosenGif.images?.original?.url || chosenGif.gif;
            const mediaUrl = mp4Url || gifUrl;

            if (mediaUrl) {
                return await sock.sendMessage(jid, { 
                    video: { url: mediaUrl }, 
                    gifPlayback: true, 
                    caption: captionText, 
                    mentions: finalMentions 
                }, { quoted: msg });
            }
        }
        throw new Error("Empty collection retrieved from Klipy");

    } catch (err) {
        // Fallback to waifu.pics API
        try {
            const fallbackRes = await fetch(`https://api.waifu.pics/sfw/${action === 'kick' ? 'kick' : action}`);
            if (fallbackRes.ok) {
                const fallbackData = await fallbackRes.json();
                return await sock.sendMessage(jid, { 
                    video: { url: fallbackData.url }, 
                    gifPlayback: true, 
                    caption: captionText, 
                    mentions: finalMentions 
                }, { quoted: msg });
            }
        } catch (fallbackErr) {}

        // Text fallback
        await sock.sendMessage(jid, { text: `${captionText}`, mentions: finalMentions }, { quoted: msg });
    }
}

module.exports = [
    // 1. BANKAI COMMAND
    {
        name: 'bankai',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                const randomBankai = bankaiData[Math.floor(Math.random() * bankaiData.length)];
                return await sock.sendMessage(jid, { text: `🗡️ *BANKAI MANIFESTATION* \n\n👤 *Owner:* ${randomBankai.name}\n🔥 *Bankai:* ${randomBankai.bankaiName}\n🔮 *Abilities:* ${randomBankai.abilities}` }, { quoted: msg });
            }

            const cleanQuery = args.toLowerCase().trim();
            const matched = bankaiData.find(b => b.aliases.includes(cleanQuery) || b.name.toLowerCase().includes(cleanQuery));
            if (matched) return await sock.sendMessage(jid, { text: `🗡️ *BANKAI INDEX* \n\n👤 *Owner:* ${matched.name}\n🔥 *Bankai:* ${matched.bankaiName}\n🔮 *Abilities:* ${matched.abilities}` }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching Soul Society archives... 🪽" }, { quoted: msg });
                const responseText = await queryGroq([{ role: "system", content: "You are a Bleach anime expert. Analyze query and return only bankai description layout." }, { role: "user", content: args }]);
                await sock.sendMessage(jid, { text: responseText.trim() }, { quoted: msg });
            } catch (err) {}
        }
    },

    // 2. DOMAIN EXPANSION COMMAND
    {
        name: 'dom-exp',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                const randomDomain = domainData[Math.floor(Math.random() * domainData.length)];
                return await sock.sendMessage(jid, { text: `🌀 *DOMAIN EXPANSION* \n\n👤 *Owner:* ${randomDomain.name}\n🔥 *Domain:* ${randomDomain.domainName}\n🔮 *Abilities:* ${randomDomain.abilities}` }, { quoted: msg });
            }

            const cleanQuery = args.toLowerCase().trim();
            const matched = domainData.find(d => d.aliases.includes(cleanQuery) || d.name.toLowerCase().includes(cleanQuery));
            if (matched) return await sock.sendMessage(jid, { text: `🌀 *DOMAIN EXPANSION* \n\n👤 *Owner:* ${matched.name}\n🔥 *Domain:* ${matched.domainName}\n🔮 *Abilities:* ${matched.abilities}` }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Expanding Domain... 🤞🌀" }, { quoted: msg });
                const responseText = await queryGroq([{ role: "system", content: "You are a JJK anime expert. Analyze query and return only domain description layout." }, { role: "user", content: args }]);
                await sock.sendMessage(jid, { text: responseText.trim() }, { quoted: msg });
            } catch (err) {}
        }
    },

    // 3. WOULD YOU RATHER POLL
    {
        name: 'wyr',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            try {
                const randomWyr = wyrQuestions[Math.floor(Math.random() * wyrQuestions.length)];
                await sock.sendMessage(jid, { poll: { name: "Would you rather... 🤔", values: [randomWyr.o1, randomWyr.o2], selectableCount: 1 } }, { quoted: msg });
            } catch (err) {}
        }
    },

    // 4. JOKE COMMAND
    {
        name: 'joke',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            await sock.sendMessage(jid, { text: `😂 *Joke:* \n\n${jokeData[Math.floor(Math.random() * jokeData.length)]}` }, { quoted: msg });
        }
    },

    // 5. INSULT COMMAND
    {
        name: 'insult',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = msg.key.participant || msg.key.remoteJid || '';
            await sock.sendMessage(jid, { text: `👿 @${targetJid.split('@')[0]}: \n${insultData[Math.floor(Math.random() * insultData.length)]}`, mentions: [targetJid] }, { quoted: msg });
        }
    },

    // 6. ROAST COMMAND
    {
        name: 'roast',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = msg.key.participant || msg.key.remoteJid || '';
            await sock.sendMessage(jid, { text: `🔥 @${targetJid.split('@')[0]}: \n${roastData[Math.floor(Math.random() * roastData.length)]}`, mentions: [targetJid] }, { quoted: msg });
        }
    },

    // 7. COMPATIBILITY CALCULATOR
    {
        name: 'ship',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map(p => p.id);
                const cleanParticipants = participants.filter(p => !p.includes(sock.user.id.split(':')[0]));

                if (cleanParticipants.length < 2) return;

                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                let target1 = mentions[0] || cleanParticipants[Math.floor(Math.random() * cleanParticipants.length)];
                let target2 = mentions[1] || cleanParticipants.filter(p => p !== target1)[Math.floor(Math.random() * (cleanParticipants.length - 1))];

                const percentage = Math.floor(Math.random() * 101);
                let verdict = percentage >= 80 ? "💍 Soulmates!" : (percentage >= 50 ? "💒 Match!" : "🏃💨 Mismatch.");

                const shipCaption = `💞 *SHIP* 💞\n👩‍❤️‍👨 @${target1.split('@')[0]} x @${target2.split('@')[0]} — *${percentage}%*\n📢 *Verdict:* ${verdict}`;
                await sock.sendMessage(jid, { text: shipCaption, mentions: [target1, target2] }, { quoted: msg });
            } catch (err) {}
        }
    },

    // 8. WED PROPOSAL COMMAND
    {
        name: 'wed',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

                const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');
                if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

                const senderNum = senderJid.split('@')[0];
                const targetNum = targetJid.split('@')[0];
                const targetJidArg = targetJid.replace('@', '_at_');
                const senderJidArg = senderJid.replace('@', '_at_');

                const text = `👰🤵 *HOLY MATRIMONY PROPOSAL* 👰🤵\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👉 @${targetNum}, do you accept @${senderNum} as your lawfully wedded partner?`;

                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${settings.prefix}wed_ans yes ${targetJidArg} ${senderJidArg}`, buttonText: { displayText: '💍 I Do!' }, type: 1 },
                        { buttonId: `${settings.prefix}wed_ans no ${targetJidArg} ${senderJidArg}`, buttonText: { displayText: "💔 I Don't" }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid, senderJid]
                };
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {}
        }
    },

    // 9. WED PROPOSAL ANSWER HANDLER
    {
        name: 'wed_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const parts = args.split(' ');
            const action = parts[0]?.toLowerCase().trim();
            const targetJid = parts[1]?.replace('_at_', '@').trim();
            const senderJid = parts[2]?.replace('_at_', '@').trim();

            const clickerJid = msg.key.participant || msg.key.remoteJid || '';
            if (clickerJid !== targetJid) return;

            const targetNum = targetJid.split('@')[0];
            const senderNum = senderJid.split('@')[0];

            if (action === 'yes') {
                await sock.sendMessage(jid, { text: `👰🤵 *MATRIMONY COMPLETED!* 👰🤵\n\nBy Satoru Gojo's authority, I declare @${senderNum} and @${targetNum} joined in holy matrimony! 💍✨`, mentions: [senderJid, targetJid] }, { quoted: msg });
            } else if (action === 'no') {
                await sock.sendMessage(jid, { text: `💔 Matrimony declined by @${targetNum}.`, mentions: [targetJid] }, { quoted: msg });
            }
        }
    },

    // 10. PROPOSE COMMAND
    {
        name: 'propose',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

                const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');
                if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

                const senderNum = senderJid.split('@')[0];
                const targetNum = targetJid.split('@')[0];
                const heartMsg = proposalMessages[Math.floor(Math.random() * proposalMessages.length)];
                
                const targetJidArg = targetJid.replace('@', '_at_');
                const senderJidArg = senderJid.replace('@', '_at_');

                const text = `🌹 *A CONFESSION* 🌹\n\n💖 *To:* @${targetNum}\n📝 _"${heartMsg}"_\n\n💍 *WILL YOU MARRY ME?* @${targetNum} 💍`;

                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${settings.prefix}prop_ans yes ${targetJidArg} ${senderJidArg}`, buttonText: { displayText: '💍 Yes!' }, type: 1 },
                        { buttonId: `${settings.prefix}prop_ans no ${targetJidArg} ${senderJidArg}`, buttonText: { displayText: '💔 No' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid]
                };
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {}
        }
    },

    // 11. PROPOSE ANSWER HANDLER
    {
        name: 'prop_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const parts = args.split(' ');
            const action = parts[0]?.toLowerCase().trim();
            const targetJid = parts[1]?.replace('_at_', '@').trim();
            const senderJid = parts[2]?.replace('_at_', '@').trim();

            const clickerJid = msg.key.participant || msg.key.remoteJid || '';
            if (clickerJid !== targetJid) return;

            const targetNum = targetJid.split('@')[0];
            const senderNum = senderJid.split('@')[0];

            if (action === 'yes') {
                await sock.sendMessage(jid, { text: `💍 *ENGAGED!* 💍\n\n🎉 @${targetNum} and @${senderNum} are now officially *ENGAGED*!`, mentions: [targetJid, senderJid] }, { quoted: msg });
            } else if (action === 'no') {
                await sock.sendMessage(jid, { text: `💔 Proposal declined by @${targetNum}.`, mentions: [targetJid] }, { quoted: msg });
            }
        }
    },

    // 12. ASKOUT COMMAND
    {
        name: 'askout',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

                const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');
                if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

                const senderNum = senderJid.split('@')[0];
                const targetNum = targetJid.split('@')[0];
                const heartMsg = askoutMessages[Math.floor(Math.random() * askoutMessages.length)];

                const targetJidArg = targetJid.replace('@', '_at_');
                const senderJidArg = senderJid.replace('@', '_at_');

                const text = `💌 *A CONFESSION* 💌\n\n💖 *To:* @${targetNum}\n📝 _"${heartMsg}"_\n\n👉 *WILL YOU GO OUT WITH ME?* @${targetNum} 👈`;

                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${settings.prefix}ask_ans yes ${targetJidArg} ${senderJidArg}`, buttonText: { displayText: '💖 Yes!' }, type: 1 },
                        { buttonId: `${settings.prefix}ask_ans no ${targetJidArg} ${senderJidArg}`, buttonText: { displayText: '💔 No' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid]
                };
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {}
        }
    },

    // 13. ASKOUT ANSWER HANDLER
    {
        name: 'ask_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const parts = args.split(' ');
            const action = parts[0]?.toLowerCase().trim();
            const targetJid = parts[1]?.replace('_at_', '@').trim();
            const senderJid = parts[2]?.replace('_at_', '@').trim();

            const clickerJid = msg.key.participant || msg.key.remoteJid || '';
            if (clickerJid !== targetJid) return;

            const targetNum = targetJid.split('@')[0];
            const senderNum = senderJid.split('@')[0];

            if (action === 'yes') {
                await sock.sendMessage(jid, { text: `🎉 *CONFESSION ACCEPTED!* 🎉\n\n💖 @${targetNum} and @${senderNum} are now officially in a relationship!`, mentions: [targetJid, senderJid] }, { quoted: msg });
            } else if (action === 'no') {
                await sock.sendMessage(jid, { text: `💔 Confession declined by @${targetNum}.`, mentions: [targetJid] }, { quoted: msg });
            }
        }
    },

    // 14. HOLLOW PURPLE
    {
        name: 'hollow-purple',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;
            const text = toSans("Guess I have to do it now");
            const buttonMessage = {
                text: text,
                buttons: [
                    { buttonId: `${settings.prefix}purple_ans 100`, buttonText: { displayText: '100%' }, type: 1 },
                    { buttonId: `${settings.prefix}purple_ans 200`, buttonText: { displayText: '200%' }, type: 1 }
                ],
                headerType: 1
            };
            try { await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (err) {}
        }
    },

    // 15. HOLLOW PURPLE ANSWER HANDLER
    {
        name: 'purple_ans',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            const selection = args ? args.trim().split(' ')[0] : '';
            if (selection !== '100' && selection !== '200') return;

            if (selection === '100') {
                const frames = [
                    toSans("Cursed Technique Lapse: Blue") + "\n                    🫸🔵🫷",
                    toSans("Cursed Technique Reversal: Red") + "\n                  🫸🔴🔵🫷",
                    toSans("Hollow Technique: Purple") + "\n          🤌.......🫴⏤͟͟͞🟣"
                ];
                let sentMsg = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
                for (let i = 1; i < frames.length; i++) {
                    await delay(2500);
                    await sock.sendMessage(jid, { text: frames[i], edit: sentMsg.key });
                }
            } else if (selection === '200') {
                const frames = [
                    toSans("Maximum output!!!") + "\n          " + toSans("Blue!!!🔵"),
                    toSans("Phase!!! Paramita") + "\n    " + toSans("Pillar of light"),
                    toSans("Between front and back!!!!") + " \n             🫸🔴🔵🫷",
                    toSans("Hollow Purple!!") + " \n🤌.......🫴⏤͟͟͞🟣"
                ];
                let sentMsg = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
                for (let i = 1; i < frames.length; i++) {
                    await delay(2500);
                    await sock.sendMessage(jid, { text: frames[i], edit: sentMsg.key });
                }
            }
        }
    },

    // 16. DETAILED TERMINAL HACK COMMANDS
    {
        name: 'hack',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subAction = args ? args.toLowerCase().trim() : '';

            if (subAction === 'bank') {
                const frames = [
                    "🏦 `[CONNECTION] INITIATING SWIFT SHAKEDOWN...`",
                    "🛰️ `[ROUTE] Establishing proxy uplink (Zürich, CH)...`",
                    "🔑 `[SSL] Intercepting bank central ledger keys...`",
                    "🔓 `[BYPASS] Disarming multi-factor firewall blocks: 45%...`",
                    "🔓 `[BYPASS] Disarming multi-factor firewall blocks: 92%...`",
                    "💉 `[INJECTION] Injecting custom routing tables...`",
                    "💸 `[FUNDS] Wiring transaction logs: 100% complete.`",
                    "💰 *SUCCESS: $50,000,000 wired to secure wallet.* ⚡"
                ];

                let sent = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
                for (let i = 1; i < frames.length; i++) {
                    await delay(1800);
                    await sock.sendMessage(jid, { text: frames[i], edit: sent.key });
                }
                return;
            }

            const frames = [
                "⚙️ `[BOOT] INITIATING SYSTEM KERNEL INJECTION...`",
                "🌐 `[SCAN] Tracing host IP parameters: 192.168.1.104`",
                "🔑 `[DECRYPT] Decrypting shadow password registers...`",
                "🔓 `[ACCESS] Privilege escalation: ROOT PRIVILEGES UNLOCKED`",
                "💉 `[TROJAN] Injecting persistence payload backdoor...`",
                "🖥️ `[CLAIM] Fully claimed administrative system control`",
                "⚠️ *SYSTEM ENCRYPTED: Target terminal locked.* 💥"
            ];

            let sent = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
            for (let i = 1; i < frames.length; i++) {
                await delay(1800);
                await sock.sendMessage(jid, { text: frames[i], edit: sent.key });
            }
        }
    },

    // 17. ARREST CONTEXT INITIALIZER
    {
        name: 'arrest',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

                const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');
                if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

                const senderNum = senderJid.split('@')[0];
                const targetNum = targetJid.split('@')[0];
                const targetJidArg = targetJid.replace('@', '_at_'); 

                const text = 
                    `🚨 *ARREST WARRANT* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *Target:* @${targetNum}\n` +
                    `⚖️ *Officer:* @${senderNum}\n\n` +
                    `⛓️ *Bail is denied. Secure them behind bars below:*`;

                const buttonMessage = {
                    text: text,
                    buttons: [{ buttonId: `${settings.prefix}jail_ans ${targetJidArg}`, buttonText: { displayText: 'Send to Jail ⛓️' }, type: 1 }],
                    headerType: 1,
                    mentions: [targetJid, senderJid]
                };
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {}
        }
    },

    // 18. JAIL PROFILE OVERLAY CONTEXT GENERATOR
    {
        name: 'jail_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const targetJid = args.trim().replace('_at_', '@');
            const targetNum = targetJid.split('@')[0];

            try {
                const craftingMsg = await sock.sendMessage(jid, { text: `Forging iron bars for target @${targetNum}... ⚙️`, mentions: [targetJid] }, { quoted: msg });

                let profileUrl;
                try {
                    profileUrl = await sock.profilePictureUrl(targetJid, 'image');
                } catch (err) {
                    profileUrl = "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";
                }

                const imageRes = await fetch(profileUrl);
                if (!imageRes.ok) throw new Error();
                const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

                const sharp = require('sharp');
                const jailSvg = Buffer.from(`
                    <svg width="500" height="500">
                        <line x1="80" y1="0" x2="80" y2="500" stroke="black" stroke-width="14" />
                        <line x1="160" y1="0" x2="160" y2="500" stroke="black" stroke-width="14" />
                        <line x1="240" y1="0" x2="240" y2="500" stroke="black" stroke-width="14" />
                        <line x1="320" y1="0" x2="320" y2="500" stroke="black" stroke-width="14" />
                        <line x1="400" y1="0" x2="400" y2="500" stroke="black" stroke-width="14" />
                        <line x1="0" y1="120" x2="500" y2="120" stroke="#222222" stroke-width="18" />
                        <line x1="0" y1="380" x2="500" y2="380" stroke="#222222" stroke-width="18" />
                    </svg>
                `);

                const processedBuffer = await sharp(imageBuffer)
                    .resize(500, 500)
                    .composite([{ input: jailSvg, top: 0, left: 0 }])
                    .png()
                    .toBuffer();

                try { await sock.sendMessage(jid, { delete: craftingMsg.key }); } catch (e) {}

                await sock.sendMessage(jid, { image: processedBuffer, caption: `⛓️ *Target @${targetNum} locked up inside jail!*`, mentions: [targetJid] }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `⛓️ *Target @${targetNum} is locked up!*`, mentions: [targetJid] }, { quoted: msg });
            }
        }
    },

    // 19. ANIME ACTIONS
    { name: 'slap', isPrefixless: false, execute: async (sock, msg) => { await executeAction(sock, msg, "slap", "slapped"); } },
    { name: 'kill', isPrefixless: false, execute: async (sock, msg) => { await executeAction(sock, msg, "kill", "killed"); } },
    { name: 'kiss', isPrefixless: false, execute: async (sock, msg) => { await executeAction(sock, msg, "kiss", "kissed"); } },
    { name: 'hug', isPrefixless: false, execute: async (sock, msg) => { await executeAction(sock, msg, "hug", "hugged"); } },
    { name: 'kik', isPrefixless: false, execute: async (sock, msg) => { await executeAction(sock, msg, "kick", "kicked"); } },
    { name: 'punch', isPrefixless: false, execute: async (sock, msg) => { await executeAction(sock, msg, "punch", "punched"); } },
    { name: 'hifive', isPrefixless: false, execute: async (sock, msg) => { await executeAction(sock, msg, "highfive", "highfived"); } },
    { name: 'bite', isPrefixless: false, execute: async (sock, msg) => { await executeAction(sock, msg, "bite", "bit"); } },
    { name: 'poke', isPrefixless: false, execute: async (sock, msg) => { await executeAction(sock, msg, "poke", "poked"); } },

    // 20. USER DETAIL DIAGNOSTICS
    {
        name: 'info',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            let targetJid = msg.key.participant || msg.key.remoteJid || '';
            const quoted = msg.message.extendedTextMessage?.contextInfo;

            if (quoted && quoted.participant) targetJid = quoted.participant;
            const targetNum = targetJid.split('@')[0];

            let pfpUrl;
            try {
                pfpUrl = await sock.profilePictureUrl(targetJid, 'image');
            } catch (e) {
                pfpUrl = "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";
            }

            let bio = "No bio set.";
            try { bio = (await sock.fetchStatus(targetJid))?.status || bio; } catch (e) {}

            const device = getDeviceTypeFromId(quoted?.stanzaId || msg.key.id);

            const infoCaption = 
                `📋 *LIMITLESS USER INTEL* 📋\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *Name:* \`${msg.pushName || "User"}\`\n` +
                `📱 *Number:* \`+${targetNum}\`\n` +
                `✍️ *Bio:* \`"${bio}"\`\n` +
                `🛡️ *Device:* \`${device}\``;

            await sock.sendMessage(jid, { image: { url: pfpUrl }, caption: infoCaption, mentions: [targetJid] }, { quoted: msg });
        }
    },

    // 21. LIE DETECTOR
    {
        name: 'liedetector',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            let targetJid = msg.key.participant || msg.key.remoteJid || '';
            const quoted = msg.message.extendedTextMessage?.contextInfo;

            if (quoted && quoted.participant) targetJid = quoted.participant;
            const targetNum = targetJid.split('@')[0];

            const loadingMsg = await sock.sendMessage(jid, { text: `Analyzing biometric patterns...`, mentions: [targetJid] }, { quoted: msg });
            await delay(1500);

            const isLying = Math.random() < 0.5;
            const percentage = Math.floor(Math.random() * 41) + 60; 

            const verdict = isLying 
                ? `🔴 *Lying with ${percentage}% certainty!*`
                : `🟢 *Saying the truth with ${percentage}% certainty!*`;

            await sock.sendMessage(jid, { text: `🧬 *LIE DETECTOR* 🧬\n\n👤 *Subject:* @${targetNum}\n📢 *Verdict:* ${verdict}`, edit: loadingMsg.key, mentions: [targetJid] });
        }
    },

    // 22. RIZZ LINES
    {
        name: 'rizz',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            await sock.sendMessage(jid, { text: `🌹 *Rizz:* \n\n${rizzLines[Math.floor(Math.random() * rizzLines.length)]}` }, { quoted: msg });
        }
    },

    // 23. ANIME MONOLOGUES
    {
        name: 'speech',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                const randomSpeech = famousSpeeches[Math.floor(Math.random() * famousSpeeches.length)];
                return await sock.sendMessage(jid, { text: `🎬 *ANIME SPEECH RECOVERED* \n\n👤 *Character:* *${randomSpeech.character}*\n\n🗣️ _"${randomSpeech.speech}"_` }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: `Searching speech archives...` }, { quoted: msg });
                const responseText = await queryGroq([{ role: "system", content: "You are an anime librarian. Find or write the most iconic speech of the requested character. Format nicely. Do not include pleasantries." }, { role: "user", content: args }]);
                await sock.sendMessage(jid, { text: responseText.trim() }, { quoted: msg });
            } catch (err) {}
        }
    },

    // 24. EMOJIMIX GENERATOR
    {
        name: 'emojimix',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Provide two emojis." }, { quoted: msg });

            const emojis = extractEmojis(args);
            if (emojis.length < 2) return await sock.sendMessage(jid, { text: "❌ Please enter at least *two distinct emojis* to mix." }, { quoted: msg });

            const emoji1 = emojis[0];
            const emoji2 = emojis[1];

            try {
                const mixApiUrl = `https://api.sandipbbaruwal.onrender.com/emojimix?emoji1=${encodeURIComponent(emoji1)}&emoji2=${encodeURIComponent(emoji2)}`;
                const mixRes = await fetch(mixApiUrl);
                
                if (mixRes.ok) {
                    const arrayBuffer = await mixRes.arrayBuffer();
                    const imageBuffer = Buffer.from(arrayBuffer);

                    const sticker = new Sticker(imageBuffer, {
                        pack: settings.packName,
                        author: settings.author,
                        type: StickerTypes.CROPPED,
                        quality: 85
                    });
                    return await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
                }
                throw new Error();
            } catch (err) {
                try {
                    const prompt = `a 3D high-resolution render of a mixed emoji combining ${emoji1} and ${emoji2} on a transparent white background, official high-quality emoji sticker style`;
                    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&private=true`;

                    const imageRes = await fetch(imageUrl);
                    if (!imageRes.ok) throw new Error();

                    const arrayBuffer = await imageRes.arrayBuffer();
                    const imageBuffer = Buffer.from(arrayBuffer);

                    const sticker = new Sticker(imageBuffer, {
                        pack: settings.packName,
                        author: settings.author,
                        type: StickerTypes.CROPPED,
                        quality: 85
                    });
                    await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: "❌ Failed to mix emojis." }, { quoted: msg });
                }
            }
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'dom-exp') aliases.push({ ...cmd, name: 'domain-expansion' });
    if (cmd.name === 'hollow-purple') aliases.push({ ...cmd, name: 'purple-tech' });
    if (cmd.name === 'emojimix') aliases.push({ ...cmd, name: 'emix' });
});
module.exports.push(...aliases);