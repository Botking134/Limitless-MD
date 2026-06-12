// plugins/fun.js
const settings = require('../settings'); 
const { Sticker, StickerTypes } = require('wa-sticker-formatter'); 
const { getPhoneJid } = require('../helpers/messageHandlers');

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

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

function normalizeToJid(input) {
    if (!input) return '';
    if (input.endsWith('@s.whatsapp.net')) return input;
    if (input.endsWith('@lid')) return input;
    const raw = input.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

function parseTarget(msg, args) {
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || 
                        rawMsg?.extendedTextMessage?.contextInfo || 
                        rawMsg?.imageMessage?.contextInfo || 
                        rawMsg?.videoMessage?.contextInfo || 
                        rawMsg?.stickerMessage?.contextInfo || 
                        rawMsg?.audioMessage?.contextInfo || 
                        rawMsg?.documentMessage?.contextInfo;

    const quotedParticipant = contextInfo?.participant;
    let target = '';

    if (quotedParticipant) {
        target = normalizeToJid(quotedParticipant);
    } else if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
        const botJid = settings.botJid || '';
        const filteredMention = contextInfo.mentionedJid.find(jid => !jid.includes(botJid));
        const selectedJid = filteredMention || contextInfo.mentionedJid[0];
        target = normalizeToJid(selectedJid);
    } else if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            target = `${cleanDigits}@s.whatsapp.net`;
        }
    }
    return target;
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

// Giphy CDN ID Extractor
function getGiphyDirectUrl(url) {
    if (!url) return '';
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1] || parts[parts.length - 2] || '';
    const segmentParts = lastPart.split('-');
    const id = segmentParts[segmentParts.length - 1];
    return `https://media.giphy.com/media/${id}/giphy.mp4`;
}

// Media Assets Lists
const assets = {
    slap: [
        "https://giphy.com/gifs/Gf3AUz3eBNbTW",
        "https://giphy.com/gifs/super-slap-terrell-wade-empire-4R6EMXhNPz5WsJFEta",
        "https://giphy.com/gifs/funimation-slap-xUNd9HZq1itMkiK652",
        "https://giphy.com/gifs/iQiyiOfficial-funny-anime-spyxfamily-WvzGVdiVRNq8qtWPKu"
    ],
    punch: [
        "https://giphy.com/gifs/anime-bhola-serioussaitama-56lLsVkQMEmlEfOyGC",
        "https://giphy.com/gifs/super-saiyan-XKO2OnnJnmqxW",
        "https://giphy.com/gifs/Edgerunners-anime-cyberpunk-edgerunners-NY3tXwOBUwQYq7lbXx",
        "https://giphy.com/gifs/punch-yep-OpvUphysvKumQ",
        "https://giphy.com/gifs/attack-on-titan-badass-11HeubLHnQJSAU",
        "https://giphy.com/gifs/iQiyiOfficial-anime-anya-spy-x-family-NuiEoMDbstN0J2KAiH",
        "https://giphy.com/gifs/jujutsu-kaisen-jjk-3-00V9zBPthegYnOxmFq"
    ],
    hifive: [
        "https://giphy.com/gifs/witch-hat-atelier-impact-frame-meme-hwdlx08M5DJdAcr1nh",
        "https://giphy.com/gifs/pokemon-high-five-x58AS8I9DBRgA"
    ],
    kill: [
        "https://giphy.com/gifs/pokemon-high-five-x58AS8I9DBRgA",
        "https://giphy.com/gifs/mortal-kombat-3lIgOk4Gjfptu",
        "https://giphy.com/gifs/midway-mortal-kombat-3-trilogy-LxfSL6Ong0NDG",
        "https://giphy.com/gifs/deviantart-mk-ermac-NQQoLnrWExPbi",
        "https://giphy.com/gifs/90s-mortal-kombat-video-games-Mkrv6hMDj7kcM",
        "https://giphy.com/gifs/jujutsu-kaisen-3-episode-51-rMSjN5eXy8238yChf5",
        "https://giphy.com/gifs/xbox-game-xbox-series-x-s-thGRsuBVXvJaxb3fKz",
        "https://giphy.com/gifs/manga-fight-cosmic-garou-vs-satima-ptmWoT5ZoeStn3PP5v"
    ],
    dap: [
        "https://giphy.com/gifs/happy-nice-congrats-WSMCmFSCmtnuOWgqvr",
        "https://giphy.com/gifs/hamlet-tiger-woods-big-dog-lets-go-to-work-HlLg2GcPOmOuVvEENM",
        "https://giphy.com/gifs/dap-ayee-splinter-cell-XNTgP3fNsSpyKE4NaS",
        "https://giphy.com/gifs/Bovada-bro-dap-up-UNPnqHRo3VVJaYvWPo",
        "https://giphy.com/gifs/fah-faaaah-faaah-pwrMzlfl5R0KkvG33q"
    ],
    kiss: [
        "https://giphy.com/gifs/kiss-kawaii-QGc8RgRvMonFm",
        "https://giphy.com/gifs/sora-haru-zkppEMFvRX5FC",
        "https://giphy.com/gifs/kiss-anime-love-jR22gdcPiOLaE",
        "https://giphy.com/gifs/anime-couple-11rWoZNpAKw8w",
        "https://giphy.com/gifs/otp-taiga-ryuuji-gTLfgIRwAiWOc"
    ],
    hug: [
        "https://giphy.com/gifs/hug-QFPoctlgZ5s0E",
        "https://giphy.com/gifs/hug-svXXBgduBsJ1u"
    ],
    kik: [
        "https://giphy.com/gifs/spiritridingfree-LXvU6blUNRuzR7ROLU",
        "https://giphy.com/gifs/taiwanese-animation-nmatv-harlem-shake-ZJzuJJJJCqNPO",
        "https://giphy.com/gifs/adultswim-anime-kick-lazarus-7dnvXm1zNQVNjRWFi1",
        "https://giphy.com/gifs/fighting-mugen-KmG26GNmdWOUE"
    ],
    bite: [
        "https://giphy.com/gifs/AGoodDoctorBTC-big-bite-shark-eating-watermelon-bvCa9hlxOfUmcLMckl",
        "https://giphy.com/gifs/bite-OqQOwXiCyJAmA",
        "https://giphy.com/gifs/funimation-vanitas-no-carte-the-case-study-of-karte-b6mpA0JrIUsFSdhG9q",
        "https://giphy.com/gifs/funimation-vanitas-no-carte-the-case-study-of-karte-lrMUMn9lnpaJDsvP0u"
    ],
    poke: [
        "https://giphy.com/gifs/Playgigaverse-meme-poke-poking-2CBBBmBlkw5GlJl8kH",
        "https://giphy.com/gifs/jCENc3aA4fLJm",
        "https://giphy.com/gifs/jujutsu-kaisen-jjk-gojo-iNPNqI81MvDQ4D4n6D",
        "https://giphy.com/gifs/touch-poke-windpress-YxfHVKacUyjBtWS2SH",
        "https://giphy.com/gifs/michael-jackson-mj-king-of-pop-lGkUyj3IrEcvu"
    ],
    dance: [
        "https://giphy.com/gifs/dope-moon-walk-micheal-jackson-pnyjo9W76V116",
        "https://giphy.com/gifs/michael-jackson-dancing-DH9skMDA3Vf0s",
        "https://giphy.com/gifs/dancing-black-moonwalk-DuoLKerazS0r61ffGo",
        "https://giphy.com/gifs/michael-jackson-gif-king-of-pop-ibE2G1af8aMZG",
        "https://giphy.com/gifs/michael-jackson-king-of-pop-mjfam-oz8jiKqcBTKnu",
        "https://giphy.com/gifs/michael-jackson-gif-12cpBxBl4WqlHO",
        "https://giphy.com/gifs/street-dancing-funny-meme-biggroove-rIiSZgZfNbwjdBBmfw"
    ],
    aura: [
        "https://giphy.com/gifs/escanor-lionsin-lionsinofpride-LURDTf4W7Er0KVbuH7",
        "https://giphy.com/gifs/naruto-dance-naeuto-5SPjgRi9ABVEg2pxmx",
        "https://giphy.com/gifs/itachi-edit-moon-red-S7GacQl21noDYivnaM",
        "https://giphy.com/gifs/jinwoo-sololeveling-sungjinwoo-ggaDSurtR6YN9MsW07",
        "https://giphy.com/gifs/sololeveling-sungjinwoo-jinwoosung-E82h6xe6foRoo8iM68",
        "https://giphy.com/gifs/goku-ultra-instinct-1gVUhlXhETaRRxzeHO",
        "https://giphy.com/gifs/goku-dragonballdaima-daimagoku-Cm9hlV215X8ZhLabYQ",
        "https://giphy.com/gifs/goku-super-dragon-ball-heroes-mastered-ultra-instint-x02HlyLWjAUdrOUa8h",
        "https://giphy.com/gifs/dragonball-mangaedit-gokuvsmoro-9VZc2R0ni6GC6jAMVn",
        "https://giphy.com/gifs/beast-gohan-truebeast-JfV56bRI3Ggk2WOiIj",
        "https://giphy.com/gifs/hypergoku7-aura-farmer-piccolo-tower-C7KYexAn5wAqkzTAhW",
        "https://giphy.com/gifs/michael-jackson-mj-king-of-pop-lGkUyj3IrEcvu"
    ],
    lol: [
        "https://giphy.com/gifs/naruto-shippuden-laugh-zHVDvEgSqIclW",
        "https://giphy.com/gifs/anime-laugh-crying-gqIthR70IxgagboMTo",
        "https://giphy.com/gifs/ZTl9Apm9F5434r7dTQ",
        "https://giphy.com/gifs/senku-rCmMQAWw2TSNSFYvMX",
        "https://giphy.com/gifs/anime-laugh-gachiakuta-39usF2pQcL6Pw7JDxD",
        "https://giphy.com/gifs/B1JKtacZXunqU"
    ]
};

async function executeAction(sock, msg, category, verb, args) {
    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
    const senderNumber = senderJid.split('@')[0];

    const targetJid = parseTarget(msg, args);
    const targetNumber = targetJid ? targetJid.split('@')[0] : '';

    let captionText = "";
    let finalMentions = [senderJid];

    if (targetJid && targetJid !== senderJid) {
        captionText = `✨ @${senderNumber} ${verb} @${targetNumber}`;
        finalMentions.push(targetJid);
    } else {
        captionText = `✨ @${senderNumber} ${verb} everyone`;
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map(p => p.id);
                finalMentions = [...finalMentions, ...participants];
            } catch (e) {}
        }
    }

    const list = assets[category] || [];
    const randomUrl = list[Math.floor(Math.random() * list.length)];
    const mediaUrl = getGiphyDirectUrl(randomUrl);

    if (mediaUrl) {
        await sock.sendMessage(jid, { 
            video: { url: mediaUrl }, 
            gifPlayback: true, 
            caption: captionText, 
            mentions: finalMentions 
        }, { quoted: msg });
    }
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

const toSans = (text) => text; // Minimal text transformer fallback

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
            const targetJid = parseTarget(msg, args) || (msg.key.participant || msg.key.remoteJid || '');
            const targetNumber = targetJid.split('@')[0];
            await sock.sendMessage(jid, { text: `👿 @${targetNumber}: \n${insultData[Math.floor(Math.random() * insultData.length)]}`, mentions: [targetJid] }, { quoted: msg });
        }
    },

    // 6. ROAST COMMAND
    {
        name: 'roast',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = parseTarget(msg, args) || (msg.key.participant || msg.key.remoteJid || '');
            const targetNumber = targetJid.split('@')[0];
            await sock.sendMessage(jid, { text: `🔥 @${targetNumber}: \n${roastData[Math.floor(Math.random() * roastData.length)]}`, mentions: [targetJid] }, { quoted: msg });
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

                const rawMsg = getRawMessage(msg.message);
                const contextInfo = rawMsg?.contextInfo;
                const mentions = contextInfo?.mentionedJid || [];
                
                let target1 = mentions[0] || cleanParticipants[Math.floor(Math.random() * cleanParticipants.length)];
                let target2 = mentions[1] || cleanParticipants.filter(p => p !== target1)[Math.floor(Math.random() * (cleanParticipants.length - 1))];

                const t1Num = target1.split('@')[0].split(':')[0];
                const t2Num = target2.split('@')[0].split(':')[0];

                const percentage = Math.floor(Math.random() * 101);
                let verdict = percentage >= 80 ? "💍 Soulmates!" : (percentage >= 50 ? "💒 Match!" : "🏃💨 Mismatch.");

                const shipCaption = `💞 *SHIP* 💞\n👩‍❤️‍👨 @${t1Num} x @${t2Num} — *${percentage}%*\n📢 *Verdict:* ${verdict}`;
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
                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
                const senderNum = senderJid.split('@')[0];

                const targetJid = parseTarget(msg, args);
                if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

                const targetNum = targetJid.split('@')[0];

                const text = `👰🤵 *HOLY MATRIMONY PROPOSAL* 👰🤵\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👉 @${targetNum}, do you accept @${senderNum} as your lawfully wedded partner?`;

                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${settings.prefix}wed_ans yes ${targetNum} ${senderNum}`, buttonText: { displayText: '💍 I Do!' }, type: 1 },
                        { buttonId: `${settings.prefix}wed_ans no ${targetNum} ${senderNum}`, buttonText: { displayText: "💔 I Don't" }, type: 1 }
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
            const targetNum = parts[1]?.trim();
            const senderNum = parts[2]?.trim();

            const rawClicker = msg.key.participant || msg.key.remoteJid || '';
            const clickerJid = rawClicker.split(':')[0] + (rawClicker.includes('@lid') ? '@lid' : '@s.whatsapp.net');

            // Optimized comparison direct extraction matching both JIDs and LIDs safely
            const clickerNum = clickerJid.split('@')[0];

            if (clickerNum !== targetNum) return; 

            const targetJid = targetNum + (targetJid && targetJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');
            const senderJid = senderNum + (senderJid && senderJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');

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
                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
                const senderNum = senderJid.split('@')[0];

                const targetJid = parseTarget(msg, args);
                if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

                const targetNum = targetJid.split('@')[0];
                const heartMsg = proposalMessages[Math.floor(Math.random() * proposalMessages.length)];

                const text = `🌹 *A CONFESSION* 🌹\n\n💖 *To:* @${targetNum}\n📝 _"${heartMsg}"_\n\n💍 *WILL YOU MARRY ME?* @${targetNum} 💍`;

                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${settings.prefix}prop_ans yes ${targetNum} ${senderNum}`, buttonText: { displayText: '💍 Yes!' }, type: 1 },
                        { buttonId: `${settings.prefix}prop_ans no ${targetNum} ${senderNum}`, buttonText: { displayText: '💔 No' }, type: 1 }
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
            const targetNum = parts[1]?.trim();
            const senderNum = parts[2]?.trim();

            const rawClicker = msg.key.participant || msg.key.remoteJid || '';
            const clickerJid = rawClicker.split(':')[0] + (rawClicker.includes('@lid') ? '@lid' : '@s.whatsapp.net');

            // Optimized comparison direct extraction matching both JIDs and LIDs safely
            const clickerNum = clickerJid.split('@')[0];

            if (clickerNum !== targetNum) return; 

            const targetJid = targetNum + (targetJid && targetJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');
            const senderJid = senderNum + (senderJid && senderJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');

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
                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
                const senderNum = senderJid.split('@')[0];

                const targetJid = parseTarget(msg, args);
                if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

                const targetNum = targetJid.split('@')[0];
                const heartMsg = askoutMessages[Math.floor(Math.random() * askoutMessages.length)];

                const text = `💌 *A CONFESSION* 💌\n\n💖 *To:* @${targetNum}\n📝 _"${heartMsg}"_\n\n👉 *WILL YOU GO OUT WITH ME?* @${targetNum} 👈`;

                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${settings.prefix}ask_ans yes ${targetNum} ${senderNum}`, buttonText: { displayText: '💖 Yes!' }, type: 1 },
                        { buttonId: `${settings.prefix}ask_ans no ${targetNum} ${senderNum}`, buttonText: { displayText: '💔 No' }, type: 1 }
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
            const targetNum = parts[1]?.trim();
            const senderNum = parts[2]?.trim();

            const rawClicker = msg.key.participant || msg.key.remoteJid || '';
            const clickerJid = rawClicker.split(':')[0] + (rawClicker.includes('@lid') ? '@lid' : '@s.whatsapp.net');

            // Optimized comparison direct extraction matching both JIDs and LIDs safely
            const clickerNum = clickerJid.split('@')[0];

            if (clickerNum !== targetNum) return; 

            const targetJid = targetNum + (targetJid && targetJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');
            const senderJid = senderNum + (senderJid && senderJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');

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
                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
                const senderNum = senderJid.split('@')[0];

                const targetJid = parseTarget(msg, args);
                if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

                const targetNum = targetJid.split('@')[0];

                const text = 
                    `🚨 *ARREST WARRANT* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *Target:* @${targetNum}\n` +
                    `⚖️ *Officer:* @${senderNum}\n\n` +
                    `⛓️ *Bail is denied. Secure them behind bars below:*`;

                const buttonMessage = {
                    text: text,
                    buttons: [{ buttonId: `${settings.prefix}jail_ans ${targetNum}`, buttonText: { displayText: 'Send to Jail ⛓️' }, type: 1 }],
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

            const targetNum = args.trim().split(' ')[0].split('@')[0];
            const targetJid = targetNum + '@s.whatsapp.net';

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

    // 19. RECONSTRUCTED INTERACTION COMMANDS
    { name: 'slap', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "slap", "slapped", args); } },
    { name: 'punch', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "punch", "punched", args); } },
    { name: 'hifive', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "hifive", "highfived", args); } },
    { name: 'kill', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "kill", "killed", args); } },
    { name: 'dap', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "dap", "dapped", args); } },
    { name: 'kiss', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "kiss", "kissed", args); } },
    { name: 'hug', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "hug", "hugged", args); } },
    { name: 'kik', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "kik", "kicked", args); } },
    { name: 'bite', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "bite", "bit", args); } },
    { name: 'poke', isPrefixless: false, execute: async (sock, msg, args) => { await executeAction(sock, msg, "poke", "poked", args); } },

    // 20. SOLO COMMAND: DANCE
    {
        name: 'dance',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderNumber = senderJid.split('@')[0];

            const list = assets.dance;
            const randomUrl = list[Math.floor(Math.random() * list.length)];
            const mediaUrl = getGiphyDirectUrl(randomUrl);

            if (mediaUrl) {
                await sock.sendMessage(jid, { 
                    video: { url: mediaUrl }, 
                    gifPlayback: true, 
                    caption: `✨ @${senderNumber} is dancing`, 
                    mentions: [senderJid] 
                }, { quoted: msg });
            }
        }
    },

    // 21. SOLO COMMAND: AURA
    {
        name: 'aura',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderNumber = senderJid.split('@')[0];

            const list = assets.aura;
            const randomUrl = list[Math.floor(Math.random() * list.length)];
            const mediaUrl = getGiphyDirectUrl(randomUrl);

            if (mediaUrl) {
                await sock.sendMessage(jid, { 
                    video: { url: mediaUrl }, 
                    gifPlayback: true, 
                    caption: `✨ @${senderNumber} is aura farming`, 
                    mentions: [senderJid] 
                }, { quoted: msg });
            }
        }
    },

    // 22. REACTION DUAL-ROUTE COMMAND: LOL
    {
        name: 'lol',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const senderNumber = senderJid.split('@')[0];

            const targetJid = parseTarget(msg, args);
            const targetNumber = targetJid ? targetJid.split('@')[0] : '';

            let captionText = "";
            let finalMentions = [senderJid];

            if (targetJid && targetJid !== senderJid) {
                captionText = `✨ @${senderNumber} is laughing at @${targetNumber}`;
                finalMentions.push(targetJid);
            } else {
                captionText = `✨ @${senderNumber} is laughing`;
            }

            const list = assets.lol;
            const randomUrl = list[Math.floor(Math.random() * list.length)];
            const mediaUrl = getGiphyDirectUrl(randomUrl);

            if (mediaUrl) {
                await sock.sendMessage(jid, { 
                    video: { url: mediaUrl }, 
                    gifPlayback: true, 
                    caption: captionText, 
                    mentions: finalMentions 
                }, { quoted: msg });
            }
        }
    },

    // 23. USER DETAIL DIAGNOSTICS
    {
        name: 'info',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo;
            
            // Get raw participant JID/LID from message
            let targetJid = contextInfo?.participant || msg.key.participant || msg.key.remoteJid || '';
            if (args) {
                const targetFromArgs = parseTarget(msg, args);
                if (targetFromArgs) targetJid = targetFromArgs;
            }
            
            const rawTargetJid = targetJid.split(':')[0] + (targetJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');
            const targetID = rawTargetJid.split('@')[0];
            const isLid = rawTargetJid.endsWith('@lid');

            let phoneJid = '';
            let phoneNumber = '';
            let username = 'User';

            // Resolve contact name or fall back to message pushName
            try {
                username = sock.getName ? sock.getName(rawTargetJid) : (msg.pushName || 'User');
            } catch (e) {}

            if (isLid) {
                // If the target is a LID, resolve their traditional phone number JID
                try {
                    const resolvedPhoneJid = await getPhoneJid(sock, rawTargetJid, jid);
                    if (resolvedPhoneJid) {
                        phoneJid = resolvedPhoneJid;
                        phoneNumber = `+${resolvedPhoneJid.split('@')[0]}`;
                    }
                } catch (e) {}
            } else {
                phoneJid = rawTargetJid;
                phoneNumber = `+${targetID}`;
            }

            let pfpUrl;
            try {
                pfpUrl = await sock.profilePictureUrl(rawTargetJid, 'image');
            } catch (e) {
                pfpUrl = "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";
            }

            let bio = "No bio set.";
            try { 
                bio = (await sock.fetchStatus(rawTargetJid))?.status || bio; 
            } catch (e) {
                if (phoneJid && phoneJid !== rawTargetJid) {
                    try { bio = (await sock.fetchStatus(phoneJid))?.status || bio; } catch (err) {}
                }
            }

            const device = getDeviceTypeFromId(contextInfo?.stanzaId || msg.key.id);

            const infoCaption = 
                `📋 *LIMITLESS USER INTEL* 📋\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *Username:* \`${username}\`\n` +
                `🆔 *User ID / LID:* \`${targetID}${isLid ? ' (@lid)' : ' (@s.whatsapp.net)'}\`\n` +
                `📱 *Phone Number:* \`${phoneNumber || 'Not Resolved'}\`\n` +
                `✍️ *Bio:* \`"${bio}"\`\n` +
                `🛡️ *Device:* \`${device}\``;

            await sock.sendMessage(jid, { image: { url: pfpUrl }, caption: infoCaption, mentions: [rawTargetJid] }, { quoted: msg });
        }
    },

    // 24. LIE DETECTOR
    {
        name: 'liedetector',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo;

            let targetJid = contextInfo?.participant || msg.key.participant || msg.key.remoteJid || '';
            const targetNum = targetJid.split('@')[0].split(':')[0];
            targetJid = targetNum + '@s.whatsapp.net';

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

    // 25. RIZZ LINES
    {
        name: 'rizz',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            await sock.sendMessage(jid, { text: `🌹 *Rizz:* \n\n${rizzLines[Math.floor(Math.random() * rizzLines.length)]}` }, { quoted: msg });
        }
    },

    // 26. ANIME MONOLOGUES
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

    // 27. EMOJIMIX GENERATOR
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
    if (cmd.name === 'lol') {
        aliases.push({ ...cmd, name: 'laugh' });
        aliases.push({ ...cmd, name: 'xd' });
    }
    if (cmd.name === 'aura') {
        aliases.push({ ...cmd, name: 'farm' });
    }
});
module.exports.push(...aliases);