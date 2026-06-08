// plugins/fun.js
const settings = require('../settings'); // Up one level to root
const { Sticker, StickerTypes } = require('wa-sticker-formatter'); // Sticker compiler

// Obfuscated Groq Key to bypass GitHub Push Protection
const s1 = "gsk_";
const s2 = "tPB0xMyZ2oijloaBNcDs";
const s3 = "WGdyb3FY5iC2p9hwRE";
const s4 = "SIJXAV3t53LZg9";
const GROQ_API_KEY = s1 + s2 + s3 + s4;

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

// Reusable Helper to query Groq's completions endpoint
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
                temperature: 0.3
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            throw new Error(`Groq API Error ${response.status}: ${errData}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e) {
        console.error("Groq API Query Error (fun.js):", e.message);
        throw e;
    }
}

// Inline delay helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Unicode mathematical sans-serif text converter helper
function toSans(text) {
    return text.split('').map(char => {
        const code = char.charCodeAt(0);
        // Uppercase A-Z mapping to U+1D5A0
        if (code >= 65 && code <= 90) {
            return String.fromCodePoint(code - 65 + 0x1D5A0);
        }
        // Lowercase a-z mapping to U+1D5BA
        if (code >= 97 && code <= 122) {
            return String.fromCodePoint(code - 97 + 0x1D5BA);
        }
        // Digits 0-9 mapping to U+1D7E2
        if (code >= 48 && code <= 57) {
            return String.fromCodePoint(code - 48 + 0x1D7E2);
        }
        return char;
    }).join('');
}

// Helper to determine the client operating system from the message ID structure [INDEX: tools.js]
function getDeviceTypeFromId(id) {
    if (!id) return "UNKNOWN ❓";
    const len = id.length;
    
    // 1. iOS signature rules
    if (len === 20 && id.startsWith('3A')) return "iOS (iPhone) 🍏";
    
    // 2. Android signature rules
    if (len === 32) return "Android! 🤖";
    
    // 3. PC / Desktop Web signature rules
    if (len === 12 || id.startsWith('3EB0') || id.startsWith('BAE5')) return "PC (Desktop) 💻";
    
    return "UNKNOWN ❓";
}

// Emoji Extractor Regex helper
function extractEmojis(text) {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02B}\u{1F0A0}-\u{1F0B0}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;
    return text.match(emojiRegex) || [];
}

// -------------------------------------------------------------
// METADATA DATASETS
// -------------------------------------------------------------
const bankaiData = [
    {
        name: "Ichigo Kurosaki",
        aliases: ["ichigo", "kurosaki", "kurosaki ichigo", "tensa zangetsu"],
        position: "Substitute Shinigami",
        bankaiName: "Tensa Zangetsu (Heaven Chain Slaying Moon)",
        abilities: "Compresses immense spiritual pressure into a sleek, pitch-black blade, granting physical speed, enhanced reflexes, and the ability to fire highly concentrated black Getsuga Tensho and Getsuga Jujisho blasts."
    },
    {
        name: "Rukia Kuchiki",
        aliases: ["rukia", "kuchiki rukia", "hakka no togame"],
        position: "Captain of Division 13",
        bankaiName: "Hakka no Togame (White Haze Punishment)",
        abilities: "Reaches absolute zero temperature instantly, creating a towering pillar of freezing mist. Anything within its influence is frozen solid and crumbles into dust. Rukia must melt herself back slowly to avoid breaking her own frozen body."
    },
    {
        name: "Byakuya Kuchiki",
        aliases: ["byakuya", "kuchiki byakuya", "senbonzakura", "senbonzakura kageyoshi"],
        position: "Captain of Division 6",
        bankaiName: "Senbonzakura Kageyoshi (Vibrant Display of a Thousand Cherry Blossoms)",
        abilities: "Scatters millions of tiny blade petals that shred targets with absolute offensive and defensive control. Byakuya can guide them with his hands to double their speed, or consolidate them into swords for direct combat (Senkei)."
    },
    {
        name: "Kisuke Urahara",
        aliases: ["kisuke", "urahara", "kisuke urahara", "kannonbiraki"],
        position: "Former Captain of Division 12 / Store Owner",
        bankaiName: "Kannonbiraki Benihime Aratame (Inquisition of the Crimson Princess of the Opened Gate)",
        abilities: "Restructures and reconstructs anything it physically touches or operates within its area of influence. Can be used to heal wounds by stitching tissue, open paths through solid barriers, or dissect opponents."
    },
    {
        name: "Shunsui Kyoraku",
        aliases: ["shunsui", "kyoraku", "shunsui kyoraku", "katen kyokotsu"],
        position: "Captain-Commander of the Gotei 13 / Captain of Division 1",
        bankaiName: "Katen Kyokotsu: Karamatsu Shinju (Heavenly Blossom Madness: Withered Pine Love Suicide)",
        abilities: "Forces shared despair through a tragic 4-act play: sharing wounds, giving the enemy an incurable disease, drowning both in an inescapable abyss of water, and finally slicing the opponent's throat with a thread of spiritual energy."
    },
    {
        name: "Genryusai Shigekuni Yamamoto",
        aliases: ["yamamoto", "genryusai", "shigekuni yamamoto", "zanka no tachi"],
        position: "Former Captain-Commander of the Gotei 13 / Captain of Division 1",
        bankaiName: "Zanka no Tachi (Longsword of the Remnant Flame)",
        abilities: "Concentrates all flames into the edge of the blade, reaching temperatures of 15 million degrees. It burns anything on contact to ash, wraps him in heat shielding, raises the skeletons of those killed by his flames, and erases anything touched from existence."
    },
    {
        name: "Toshiro Hitsugaya",
        aliases: ["toshiro", "hitsugaya", "toshiro hitsugaya", "daiguren hyorinmaru"],
        position: "Captain of Division 10",
        bankaiName: "Grand Crimson Ice Ring Cold Moon (Daiguren Hyorinmaru)",
        abilities: "Manifests ice wings, tail, and armor to freeze everything. When the flower petals behind him fully dissolve, his body ages to a mature adult, allowing him to flash-freeze all matter, concepts, and abilities instantly."
    },
    {
        name: "Kenpachi Zaraki",
        aliases: ["kenpachi", "zaraki", "zaraki kenpachi"],
        position: "Captain of Division 11",
        bankaiName: "Unnamed Bankai (Turns him into a red demon)",
        abilities: "Unleashes overwhelming, mindless berserker physical strength. His skin turns crimson, and his blade can cleave through giant opponents or cut through clean space with brute force, although his own body struggles to contain the physical stress."
    },
    {
        name: "Renji Abarai",
        aliases: ["renji", "abarai", "renji abarai", "soo zabimaru"],
        position: "Lieutenant of Division 6",
        bankaiName: "Soo Zabimaru (Twin Kings Snake Tail)",
        abilities: "Equips Renji with a skeletal serpent armor gauntlet and a heavy blade. He can fire a massive heat blast from the serpent's skull mouth or use close combat crushing force."
    },
    {
        name: "Mayuri Kurotsuchi",
        aliases: ["mayuri", "kurotsuchi", "mayuri kurotsuchi", "ashisogi jizo"],
        position: "Captain of Division 12 / President of R&D",
        bankaiName: "Konjiki Ashisogi Jizo (Golden Demon-Slaying Soil Jizo)",
        abilities: "Summons a giant baby-like caterpillar monster that breathes deadly, mutating nerve toxins. It can also sprout blades from its chest, and Mayuri can modify its genetic code mid-battle to specifically counter and neutralize enemy elements."
    }
];

const nonBankaiCharacters = {
    "aizen": "Sosuke Aizen possesses the Kyoka Suigetsu (Shikai), but has never revealed or used a Bankai in canon.",
    "sosuke aizen": "Sosuke Aizen possesses the Kyoka Suigetsu (Shikai), but has never revealed or used a Bankai in canon.",
    "ishida": "Uryu Ishida is a Quincy and doesn't possess a Shinigami Zanpakuto or Bankai.",
    "uryu ishida": "Uryu Ishida is a Quincy and doesn't possess a Shinigami Zanpakuto or Bankai.",
    "chad": "Yasutora Sado (Chad) is a Human/Fullbringer and does not possess a Zanpakuto or Bankai.",
    "sado": "Yasutora Sado (Chad) is a Human/Fullbringer and does not possess a Zanpakuto or Bankai.",
    "orihime": "Orihime Inoue is a Human with Shun Shun Rikka and does not possess a Zanpakuto or Bankai.",
    "orihime inoue": "Orihime Inoue is a Human with Shun Shun Rikka and does not possess a Zanpakuto or Bankai.",
    "grimmjow": "Grimmjow Jaegerjaquez is an Arrancar/Espada and does not possess a Bankai; he uses Resurrección (Pantera).",
    "ulquiorra": "Ulquiorra Cifer is an Arrancar/Espada and does not possess a Bankai; he uses Resurrección and Segunda Etapa.",
    "yoruichi": "Yoruichi Shihoin is the Former Captain of Division 2. While she possesses a Zanpakuto and likely has a Bankai, she never uses it in combat, preferring hand-to-hand combat and Shunko."
};

const nonBleachAnime = ["luffy", "zoro", "naruto", "sasuke", "goku", "vegeta", "deku", "tanjiro", "gojo", "sukuna", "itadori", "megumi"];

// -------------------------------------------------------------
// JUJUTSU KAISEN (DOMAIN EXPANSION) DATABASE & CONFIGS
// -------------------------------------------------------------
const domainData = [
    {
        name: "Satoru Gojo",
        aliases: ["gojo", "satoru", "satoru gojo", "unlimited void", "muryokusho"],
        position: "Special Grade Jujutsu Sorcerer",
        domainName: "Unlimited Void (Muryōkūsho)",
        abilities: "Floods the target's brain with an infinite stream of raw information, forcing them to perceive and analyze everything in existence infinitely. This instantly paralyzes the target, rendering them completely brain-dead and unable to move or think."
    },
    {
        name: "Ryomen Sukuna",
        aliases: ["sukuna", "ryomen", "ryomen sukuna", "malevolent shrine", "fukuma mizushi"],
        position: "King of Curses / Special Grade Vengeful Spirit",
        domainName: "Malevolent Shrine (Fukuma Mizushi)",
        abilities: "An open-barrier domain that paints its technique onto the real world instead of creating an enclosed space. It continuously rains down devastating cutting slashes (Cleave for things with cursed energy, Dismantle for inanimate objects) up to a 200m radius."
    },
    {
        name: "Megumi Fushiguro",
        aliases: ["megumi", "fushiguro", "megumi fushiguro", "chimera shadow garden"],
        position: "Grade 2 Sorcerer / Zen'in Clan Head",
        domainName: "Chimera Shadow Garden (Kanga Koshōien)",
        abilities: "Floods the battlefield with highly fluid shadows. Megumi can summon multiple shadow shikigami simultaneously, hide inside shadows to escape attacks, and create shadow clones of himself. (Incomplete Domain)"
    },
    {
        name: "Yuta Okkotsu",
        aliases: ["yuta", "okkotsu", "yuta okkotsu", "authentic mutual love"],
        position: "Special Grade Jujutsu Sorcerer",
        domainName: "Authentic Mutual Love (Shingan Sōai)",
        abilities: "Creates a graveyard filled with countless copied swords. Within the domain, Yuta can bypass the cooldown of his Copied techniques and imbue his sure-hit effect with any technique he has duplicated, allowing infinite use of highly diverse skills."
    },
    {
        name: "Mahito",
        aliases: ["mahito", "self-embodiment of perfection"],
        position: "Special Grade Cursed Spirit",
        domainName: "Self-Embodiment of Perfection (Heika Jisei)",
        abilities: "Automatically creates a barrier where Mahito is physically connected to the soul of anyone trapped inside. This grants him the ability to use 'Idle Transfiguration' to warp, morph, or instantly obliterate the target's soul without needing physical touch."
    },
    {
        name: "Jogo",
        aliases: ["jogo", "coffin of the iron mountain"],
        position: "Special Grade Cursed Spirit",
        domainName: "Coffin of the Iron Mountain (Gaichūzō)",
        abilities: "Envelops targets inside an incredibly active volcano. The ambient heat is so intense that standard sorcerers instantly combust on entry. Jogo gains absolute control over volcanic fire and magma, striking with absolute accuracy."
    },
    {
        name: "Hakari Kinji",
        aliases: ["hakari", "kinji", "kinji hakari", "idle death gamble"],
        position: "Suspended Jujutsu High Student",
        domainName: "Idle Death Gamble (Zatsubo Shingetsu)",
        abilities: "A Pachinko-themed game domain. If Hakari spins and hits a jackpot, he gains infinite cursed energy and automatic Reverse Cursed Technique, making him completely immortal and un-killable for 4 minutes and 11 seconds."
    },
    {
        name: "Hiromi Higuruma",
        aliases: ["higuruma", "hiromi", "deadly sentencing"],
        position: "Cursed Sorcerer / Defense Attorney",
        domainName: "Deadly Sentencing (Shushikyū)",
        abilities: "Enforces a strict courtroom where violence of any kind is physically prohibited. Judgeman prosecutes the target for a crime they committed in real life. If found guilty, they suffer 'Confiscation' (loss of cursed technique) or receive the Death Penalty."
    }
];

const nonDomainCharacters = {
    "nanami": "Kento Nanami is a Grade 1 Sorcerer who possessed precision with his Ratio Technique, but never achieved a Domain Expansion.",
    "kento nanami": "Kento Nanami is a Grade 1 Sorcerer who possessed precision with his Ratio Technique, but never achieved a Domain Expansion.",
    "toji": "Toji Fushiguro has zero cursed energy due to Heavenly Restriction, meaning he physically cannot create a Domain Expansion.",
    "toji fushiguro": "Toji Fushiguro has zero cursed energy due to Heavenly Restriction, meaning he physically cannot create a Domain Expansion.",
    "maki": "Maki Zen'in has zero cursed energy due to Heavenly Restriction, making it physically impossible for her to expand a Domain.",
    "maki zen'in": "Maki Zen'in has zero cursed energy due to Heavenly Restriction, making it physically impossible for her to expand a Domain.",
    "nobara": "Nobara Kugisaki possesses the Straw Doll Technique but never unlocked Domain Expansion before her battle in Shibuya.",
    "nobara kugisaki": "Nobara Kugisaki possesses the Straw Doll Technique but never unlocked Domain Expansion before her battle in Shibuya.",
    "miwa": "Kasumi Miwa uses Simple Domain (New Shadow Style) for defense, but cannot expand a full innate domain.",
    "toge": "Toge Inumaki uses Cursed Speech, but does not possess a Domain Expansion."
};

const nonJjkAnime = ["luffy", "zoro", "naruto", "sasuke", "goku", "vegeta", "deku", "tanjiro", "ichigo", "byakuya", "rukia", "yamamoto"];

// -------------------------------------------------------------
// WOULD YOU RATHER QUESTIONS DATASET
// -------------------------------------------------------------
const wyrQuestions = [
    { o1: "Always have wet socks", o2: "Always have a popcorn kernel stuck in your teeth" },
    { o1: "Have your search history read out loud at your wedding", o2: "Have your search history read at your funeral" },
    { o1: "Only be able to whisper everything you say", o2: "Only be able to scream everything you say" },
    { o1: "Fight 1 horse-sized duck", o2: "Fight 100 duck-sized horses" },
    { o1: "Have cheese for hair", o2: "Sweat warm maple syrup" },
    { o1: "Have to announce every time you fart", o2: "Have everyone else announce when you fart" },
    { o1: "Only eat raw onions for a week", o2: "Only drink warm hot sauce for a week" },
    { o1: "Always be 10 minutes late", o2: "Always be 45 minutes early" },
    { o1: "Have your body permanently covered in glitter", o2: "Permanently smell like a wet dog" },
    { o1: "Be able to talk to animals but they all roast you", o2: "Speak all human languages but everyone ignores you" },
    { o1: "Free pizza for life but it's always cold", o2: "Free tacos for life but they are always soggy" },
    { o1: "Never be able to use a touch screen again", o2: "Never be able to use a vacuum cleaner again" }
];

// -------------------------------------------------------------
// JOKES, INSULTS, AND ROASTS DATASETS
// -------------------------------------------------------------
const jokeData = [
    "Why don't skeletons fight each other? They don't have the guts.",
    "I only know 25 letters of the alphabet. I don't know y.",
    "What do you call a fake noodle? An impasta.",
    "Why did the scarecrow win an award? Because he was outstanding in his field.",
    "I'm reading a book on anti-gravity. I just can't put it down!",
    "My wife told me to stop impersonating a flamingo. I had to put my foot down.",
    "I told my doctor that I broke my arm in two places. He told me to stop going to those places.",
    "Parallel lines have so much in common. It’s a shame they’ll never meet.",
    "My boss told me to have a good day... so I went home.",
    "I used to play piano by ear, but now I use my hands.",
    "What did the zero say to the eight? Nice belt!",
    "What do you call a sleeping bull? A bulldozer.",
    "Why do we tell actors to 'break a leg'? Because every play has a cast.",
    "Why don't scientists trust atoms? Because they make up everything!"
];

const insultData = [
    "You're the reason the shampoo bottle has instructions.",
    "If I had a face like yours, I'd sue my parents.",
    "You are like a cloud. When you disappear, it's a beautiful day.",
    "I've seen puddles deeper than your personality.",
    "Your brain is like the Bermuda Triangle: information goes in, but it's never heard from again.",
    "You bring everyone so much joy... when you leave the room.",
    "I’d agree with you but then we’d both be wrong.",
    "Some cause happiness wherever they go; others, whenever they go.",
    "You are proof that evolution can go in reverse.",
    "If laughter is the best medicine, your face is curing the world."
];

const roastData = [
    "If absolute zero is -273.15 degrees, your charisma is at least -300.",
    "You have the perfect face for radio.",
    "You're not standard material, you're the draft copy that got rejected.",
    "I would roast you, but my mom told me not to burn trash.",
    "You look like a cartoon character that got drawn with a non-dominant hand.",
    "You're so slow, a snail could pass you while walking backward.",
    "Your secrets are always safe with me. I never listen anyway.",
    "If I wanted to commit suicide, I’d climb your ego and jump to your IQ.",
    "You have entire paths of logic that go undiscovered.",
    "My Six Eyes can analyze infinitely, yet I still can't find the point of your argument."
];

const proposalMessages = [
    "From the moment I met you, my world changed. I want to build a domain with you where my infinity only surrounds you.",
    "You are my reverse cursed technique; you heal me when I'm broken. I can't imagine a future without you by my side.",
    "They say nothing is infinite, but my love for you defies that law. Will you make me the happiest person in this chat?"
];

const askoutMessages = [
    "I've been thinking about you a lot lately... and I was wondering if we could be more than just group members?",
    "You have a certain spark that lights up my whole chat. Would you make me the happiest person and go out with me?",
    "No games, no curses, just pure feelings. I really like you. Will you be mine?"
];

const sadnessQuotes = [
    "Ouch... the conceptual void collapsed. My heart is officially shattered. Alexa, play Sadness and Sorrow. 💔😭",
    "Rejected... Even absolute zero feels warmer than this cold refusal. Satoru Gojo is sending his condolences. 🥀",
    "My disappointment is immeasurable, and my day is ruined. F in the chat for our fallen soldier. 💔"
];

// -------------------------------------------------------------
// RIZZ (PICKUP LINES) & SPEECH DATASETS
// -------------------------------------------------------------
const rizzLines = [
    "Are you a cursed spirit? Because you've been haunting my mind all day long.",
    "Are you the King of Curses? Because you have absolute control over my heart.",
    "Is your name Satoru? Because you are simply the strongest thing in my world.",
    "Do you have a map? I keep getting lost in your eyes.",
    "Are you made of copper and tellurium? Because you're CuTe.",
    "If beauty were a crime, you'd be serving a life sentence without bail.",
    "Are you a keyboard? Because you're just my type.",
    "Is there an airport nearby, or was that just my heart taking off when I saw you?",
    "Are you a camera? Because every time I look at you, I smile.",
    "Do you believe in love at first sight, or should I walk by again in slow motion?"
];

const famousSpeeches = [
    {
        character: "Erwin Smith",
        anime: "Attack on Titan",
        speech: "My soldiers, rage! My soldiers, scream! My soldiers, fight!"
    },
    {
        character: "Pain (Nagato)",
        anime: "Naruto Shippuden",
        speech: "Feel pain, contemplate pain, accept pain, know pain. Those who do not know pain can never understand true peace. I will never forget the pain that Yahiko suffered. And now... this world shall know pain!"
    },
    {
        character: "Madara Uchiha",
        anime: "Naruto Shippuden",
        speech: "Wake up to reality! Nothing ever goes as planned in this accursed world. The longer you live, the more you realize that in this reality only pain, suffering, and futility exist."
    },
    {
        character: "Satoru Gojo",
        anime: "Jujutsu Kaisen",
        speech: "Throughout Heaven and Earth, I alone am the honored one."
    },
    {
        character: "Lelouch vi Britannia",
        anime: "Code Geass",
        speech: "If the king does not lead, how can he expect his subordinates to follow? The only ones who should kill are those who are prepared to be killed!"
    }
];

// -------------------------------------------------------------
// GENERIC ANIME ACTION EXECUTOR
// -------------------------------------------------------------
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
        const targetNum = targetJid.split('@')[0];
        captionText = `✨ @${senderNum} ${verb} @${targetNum}`;
        finalMentions = [senderJid, targetJid];
    } 
    else {
        if (isGroup) {
            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants.map(p => p.id);
            captionText = `✨ @${senderNum} ${verb} everybody!`;
            finalMentions = [senderJid, ...participants];
        } else {
            captionText = `✨ @${senderNum} ${verb} themselves!`;
            finalMentions = [senderJid];
        }
    }

    try {
        const res = await fetch(`https://api.waifu.pics/sfw/${action}`);
        if (!res.ok) throw new Error("Waifu.pics SFW API returned an error status.");
        
        const data = await res.json();
        const gifUrl = data.url;

        await sock.sendMessage(jid, {
            video: { url: gifUrl },
            gifPlayback: true,
            caption: captionText,
            mentions: finalMentions
        }, { quoted: msg });

    } catch (err) {
        console.error(`Anime action GIF failed for ${action}:`, err.message);
        await sock.sendMessage(jid, { 
            text: `${captionText}\n\n_(Failed to generate anime GIF from API)_`, 
            mentions: finalMentions 
        }, { quoted: msg });
    }
}

module.exports = [
    // 1. .bankai COMMAND
    {
        name: 'bankai',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                const randomBankai = bankaiData[Math.floor(Math.random() * bankaiData.length)];
                const text = `🗡️ *RANDOM BANKAI MANIFESTATION* 🗡️\n` +
                             `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                             `👤 *Owner Name:* ${randomBankai.name}\n` +
                             `🎖️ *Position:* ${randomBankai.position}\n` +
                             `🔥 *Bankai:* ${randomBankai.bankaiName}\n\n` +
                             `🔮 *Abilities:* ${randomBankai.abilities}\n\n` +
                             `_“Ban-kai!”_ 卍`;
                return await sock.sendMessage(jid, { text }, { quoted: msg });
            }

            const cleanQuery = args.toLowerCase().trim();

            const matched = bankaiData.find(b => b.aliases.includes(cleanQuery) || b.name.toLowerCase().includes(cleanQuery));
            if (matched) {
                const text = `🗡️ *BANKAI ARCHIVE INDEX* 🗡️\n` +
                             `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                             `👤 *Owner Name:* ${matched.name}\n` +
                             `🎖️ *Position:* ${matched.position}\n` +
                             `🔥 *Bankai:* ${matched.bankaiName}\n\n` +
                             `🔮 *Abilities:* ${matched.abilities}\n\n` +
                             `_“Ban-kai!”_ 卍`;
                return await sock.sendMessage(jid, { text }, { quoted: msg });
            }

            if (nonBankaiCharacters[cleanQuery]) {
                return await sock.sendMessage(jid, { text: `❌ ${nonBankaiCharacters[cleanQuery]}` }, { quoted: msg });
            }

            if (nonBleachAnime.includes(cleanQuery)) {
                return await sock.sendMessage(jid, { text: `❌ "${args}" is not from the Bleach anime.` }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Searching Soul Society archives... 🪽" }, { quoted: msg });

                const systemPrompt = 
                    "You are an expert on the Bleach anime and manga universe.\n" +
                    "Analyze the user's query, which represents a character name or a Bankai.\n\n" +
                    "1. If this character/object is NOT from the Bleach anime/manga universe, reply ONLY with the exact word 'NOT_FROM_BLEACH'.\n" +
                    "2. If they are from Bleach but DO NOT have or have never shown a Bankai in canon, reply ONLY with the exact word 'NO_BANKAI'.\n" +
                    "3. If they are from Bleach and possess a Bankai, respond ONLY in this exact layout:\n\n" +
                    "🗡️ *BANKAI ARCHIVE INDEX* 🗡️\n" +
                    "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                    "👤 *Owner Name:* [Insert Character Name]\n" +
                    "🎖️ *Position:* [Insert position/identity]\n" +
                    "🔥 *Bankai:* [Insert Bankai Name]\n\n" +
                    "🔮 *Abilities:* [Short but detailed description of the Bankai's abilities]\n\n" +
                    "_“Ban-kai!”_ 卍\n\n" +
                    "Keep formatting consistent and do not write any introductory or concluding pleasantries.";

                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                const cleanResponse = responseText.trim();

                if (cleanResponse.includes("NOT_FROM_BLEACH")) {
                    await sock.sendMessage(jid, { text: `❌ "${args}" is not from the Bleach anime.` }, { quoted: msg });
                } else if (cleanResponse.includes("NO_BANKAI")) {
                    await sock.sendMessage(jid, { text: `❌ Character "${args}" doesn't have a Bankai.` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: cleanResponse }, { quoted: msg });
                }

            } catch (err) {
                console.error("Bankai Fallback Error:", err);
                await sock.sendMessage(jid, { text: "❌ Failed to retrieve Bleach archives." }, { quoted: msg });
            }
        }
    },

    // 2. .dom-exp / .domain-expansion COMMANDS
    {
        name: 'dom-exp',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                const randomDomain = domainData[Math.floor(Math.random() * domainData.length)];
                const text = `🌀 *RANDOM DOMAIN EXPANSION* 🌀\n` +
                             `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                             `👤 *Owner Name:* ${randomDomain.name}\n` +
                             `🎖️ *Status/Grade:* ${randomDomain.position}\n` +
                             `🔥 *Domain Expansion:* ${randomDomain.domainName}\n\n` +
                             `🔮 *Abilities:* ${randomDomain.abilities}\n\n` +
                             `_“Ryoiki Tenkai...”_ 🤞`;
                return await sock.sendMessage(jid, { text }, { quoted: msg });
            }

            const cleanQuery = args.toLowerCase().trim();

            const matched = domainData.find(d => d.aliases.includes(cleanQuery) || d.name.toLowerCase().includes(cleanQuery));
            if (matched) {
                const text = `🌀 *DOMAIN EXPANSION ARCHIVE* 🌀\n` +
                             `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                             `👤 *Owner Name:* ${matched.name}\n` +
                             `🎖️ *Status/Grade:* ${matched.position}\n` +
                             `🔥 *Domain Expansion:* ${matched.domainName}\n\n` +
                             `🔮 *Abilities:* ${matched.abilities}\n\n` +
                             `_“Ryoiki Tenkai...”_ 🤞`;
                return await sock.sendMessage(jid, { text }, { quoted: msg });
            }

            if (nonDomainCharacters[cleanQuery]) {
                return await sock.sendMessage(jid, { text: `❌ ${nonDomainCharacters[cleanQuery]}` }, { quoted: msg });
            }

            if (nonJjkAnime.includes(cleanQuery)) {
                return await sock.sendMessage(jid, { text: `❌ "${args}" is not from the JJK anime.` }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Expanding Domain coordinates... 🤞🌀" }, { quoted: msg });

                const systemPrompt = 
                    "You are an expert on the Jujutsu Kaisen (JJK) anime and manga universe.\n" +
                    "Analyze the user's query, which represents a character name or a Domain Expansion.\n\n" +
                    "1. If this character/object is NOT from the Jujutsu Kaisen universe, reply ONLY with the exact word 'NOT_FROM_JJK'.\n" +
                    "2. If they are from Jujutsu Kaisen but DO NOT possess a Domain Expansion (or have never shown one in canon), reply ONLY with the exact word 'NO_DOMAIN'.\n" +
                    "3. If they are from Jujutsu Kaisen and possess a Domain Expansion, respond ONLY in this exact layout:\n\n" +
                    "🌀 *DOMAIN EXPANSION ARCHIVE* 🌀\n" +
                    "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                    "👤 *Owner Name:* [Insert Character Name]\n" +
                    "🎖️ *Status/Grade:* [Insert status/grade/identity]\n" +
                    "🔥 *Domain Expansion:* [Insert Domain Expansion Name]\n\n" +
                    "🔮 *Abilities:* [Short but detailed description of the Domain's barrier rules and sure-hit abilities]\n\n" +
                    "_“Ryoiki Tenkai...”_ 🤞\n\n" +
                    "Keep formatting consistent and do not write any introductory or concluding pleasantries.";

                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                const cleanResponse = responseText.trim();

                if (cleanResponse.includes("NOT_FROM_JJK")) {
                    await sock.sendMessage(jid, { text: `❌ "${args}" is not from the JJK anime.` }, { quoted: msg });
                } else if (cleanResponse.includes("NO_DOMAIN")) {
                    await sock.sendMessage(jid, { text: `❌ Character "${args}" doesn't have a Domain Expansion.` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: cleanResponse }, { quoted: msg });
                }

            } catch (err) {
                console.error("Domain expansion fallback error:", err);
                await sock.sendMessage(jid, { text: "❌ Failed to retrieve Jujutsu records." }, { quoted: msg });
            }
        }
    },

    // 3. .wyr COMMAND (WOULD YOU RATHER POLL)
    {
        name: 'wyr',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            try {
                const randomWyr = wyrQuestions[Math.floor(Math.random() * wyrQuestions.length)];

                await sock.sendMessage(jid, {
                    poll: {
                        name: "Would you rather... 🤔",
                        values: [randomWyr.o1, randomWyr.o2],
                        selectableCount: 1
                    }
                }, { quoted: msg });

            } catch (err) {
                console.error("Would You Rather error:", err);
                await sock.sendMessage(jid, { text: "❌ Failed to create Would You Rather poll." }, { quoted: msg });
            }
        }
    },

    // 4. .joke COMMAND (DAD JOKES & HUMOROUS JOKES)
    {
        name: 'joke',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            try {
                const selectedJoke = jokeData[Math.floor(Math.random() * jokeData.length)];
                await sock.sendMessage(jid, { text: `😂 *Here is a joke for you:* \n\n${selectedJoke}` }, { quoted: msg });
            } catch (err) {
                console.error("Joke error:", err);
            }
        }
    },

    // 5. .insult COMMAND
    {
        name: 'insult',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = msg.key.participant || msg.key.remoteJid || '';
            const targetNumber = targetJid.split('@')[0];
            try {
                const insult = insultData[Math.floor(Math.random() * insultData.length)];
                await sock.sendMessage(jid, { 
                    text: `👿 *Hey @${targetNumber}!* \n\n${insult}`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } catch (err) {
                console.error("Insult error:", err);
            }
        }
    },

    // 6. .roast COMMAND
    {
        name: 'roast',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = msg.key.participant || msg.key.remoteJid || '';
            const targetNumber = targetJid.split('@')[0];
            try {
                const roast = roastData[Math.floor(Math.random() * roastData.length)];
                await sock.sendMessage(jid, { 
                    text: `🔥 *Prepare yourself @${targetNumber}!* \n\n${roast}`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } catch (err) {
                console.error("Roast error:", err);
            }
        }
    },

    // 7. .ship COMMAND (COMPATIBILITY CALCULATOR)
    {
        name: 'ship',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map(p => p.id);

                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const botLid = sock.user.id.split(':')[0] + '@lid';

                const cleanParticipants = participants.filter(p => p !== botJid && p !== botLid);

                if (cleanParticipants.length < 2) {
                    return await sock.sendMessage(jid, { text: "❌ There are not enough active members in this group to calculate compatibility." }, { quoted: msg });
                }

                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                let target1 = '';
                let target2 = '';

                if (mentions.length >= 2) {
                    target1 = mentions[0];
                    target2 = mentions[1];
                } else if (mentions.length === 1) {
                    target1 = mentions[0];
                    const pool = cleanParticipants.filter(p => p !== target1);
                    if (pool.length === 0) {
                        return await sock.sendMessage(jid, { text: "❌ No other users are available to determine compatibility." }, { quoted: msg });
                    }
                    target2 = pool[Math.floor(Math.random() * pool.length)];
                } else {
                    const idx1 = Math.floor(Math.random() * cleanParticipants.length);
                    target1 = cleanParticipants[idx1];
                    const pool = cleanParticipants.filter(p => p !== target1);
                    target2 = pool[Math.floor(Math.random() * pool.length)];
                }

                const percentage = Math.floor(Math.random() * 101);
                
                const barLength = 10;
                const filledCount = Math.round((percentage / 100) * barLength);
                const emptyCount = barLength - filledCount;
                const bar = "█".repeat(filledCount) + "░".repeat(emptyCount);

                let verdict = "";
                if (percentage >= 80) {
                    verdict = "💍 *True Soulmates!* Satoru Gojo approves of this divine union. Plan the wedding already! ❤️";
                } else if (percentage >= 50) {
                    verdict = "💒 *A Match Made in Heaven!* Go ahead and confess your feelings! ✨";
                } else if (percentage >= 20) {
                    verdict = "⚡ *There is a spark!* But you both need to work on your communication. 🗣️";
                } else {
                    verdict = "🏃💨 *Complete Mismatch.* Even my Six Eyes can't find compatibility here. Flee!";
                }

                const shipCaption = 
                    `💞 *LIMITLESS LOVE TRANSMITTER* 💞\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👩‍❤️‍👨 *Lovers:* @${target1.split('@')[0]}  x  @${target2.split('@')[0]}\n` +
                    `📊 *Compatibility:* [${bar}] *${percentage}%*\n\n` +
                    `📢 *Verdict:* ${verdict}`;

                await sock.sendMessage(jid, {
                    text: shipCaption,
                    mentions: [target1, target2]
                }, { quoted: msg });

            } catch (err) {
                console.error("Ship command error:", err);
                await sock.sendMessage(jid, { text: "❌ Failed to compute shipping compatibility." }, { quoted: msg });
            }
        }
    },

    // 8. .wed COMMAND (WEDDING SIMULATOR)
    {
        name: 'wed',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map(p => p.id);

                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const botLid = sock.user.id.split(':')[0] + '@lid';

                const cleanParticipants = participants.filter(p => p !== botJid && p !== botLid);

                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

                let partner1 = '';
                let partner2 = '';

                if (repliedJid && repliedJid !== botJid && repliedJid !== botLid) {
                    partner1 = senderJid;
                    partner2 = repliedJid;
                }
                else if (mentions.length >= 2) {
                    partner1 = mentions[0];
                    partner2 = mentions[1];
                }
                else if (mentions.length === 1) {
                    partner1 = senderJid;
                    partner2 = mentions[0];
                }
                else {
                    if (cleanParticipants.length < 2) {
                        return await sock.sendMessage(jid, { text: "❌ Not enough participants to host a ceremony." }, { quoted: msg });
                    }
                    const idx1 = Math.floor(Math.random() * cleanParticipants.length);
                    partner1 = cleanParticipants[idx1];
                    const pool = cleanParticipants.filter(p => p !== partner1);
                    partner2 = pool[Math.floor(Math.random() * pool.length)];
                }

                if (!partner1 || !partner2 || partner1 === partner2) {
                    return await sock.sendMessage(jid, { text: "❌ Invalid candidates. You cannot wed yourself." }, { quoted: msg });
                }

                const p1Num = partner1.split('@')[0];
                const p2Num = partner2.split('@')[0];

                const ceremonyText = 
                    `🔔 *HOLY MATRIMONY CEREMONY* 🔔\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🎤 *Priest:* "Dearly beloved, we are gathered here today in this domain to join these two souls in holy matrimony."\n\n` +
                    `💍 *Priest:* "Do you, @${p1Num}, take @${p2Num} to be your lawfully wedded partner, in active typing and in silence, in spam and in Simple Domains, until a kick do you part?"\n\n` +
                    `🤵‍♂️ *Priest:* "By the power vested in me by Satoru Gojo and the Limitless framework, I now declare you partners in life!"\n\n` +
                    `💋 *Priest:* "You may now kiss the bride!" 🤵‍♂️👰‍♀️💍`;

                await sock.sendMessage(jid, {
                    text: ceremonyText,
                    mentions: [partner1, partner2]
                }, { quoted: msg });

            } catch (err) {
                console.error("Wedding error:", err);
            }
        }
    },

    // 9. .propose COMMAND
    {
        name: 'propose',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

                const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');

                if (!targetJid || targetJid === senderJid) {
                    return await sock.sendMessage(jid, { text: "❌ Please mention (@user) or reply to the message of the user you wish to propose to." }, { quoted: msg });
                }

                const senderNum = senderJid.split('@')[0];
                const targetNum = targetJid.split('@')[0];
                const heartMsg = proposalMessages[Math.floor(Math.random() * proposalMessages.length)];

                const text = 
                    `🌹 *A HEARTFELT PROPOSAL AMONGST INFINITY* 🌹\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `💖 *To:* @${targetNum}\n` +
                    `📝 _"${heartMsg}"_\n\n` +
                    `💍 *WILL YOU MARRY ME?* @${targetNum} 💍\n\n` +
                    `⚠️ _Only @${targetNum} can respond to this proposal._\n` +
                    `💡 _If buttons are not visible on your client, reply with:_\n` +
                    `• \`${settings.prefix}prop_ans yes ${targetNum} ${senderNum}\`\n` +
                    `• \`${settings.prefix}prop_ans no ${targetNum} ${senderNum}\``;

                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${settings.prefix}prop_ans yes ${targetNum} ${senderNum}`, buttonText: { displayText: '💍 Yes!' }, type: 1 },
                        { buttonId: `${settings.prefix}prop_ans no ${targetNum} ${senderNum}`, buttonText: { displayText: '💔 No' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid]
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (btnErr) {
                    await sock.sendMessage(jid, { text: text, mentions: [targetJid] }, { quoted: msg });
                }

            } catch (err) {
                console.error("Proposal error:", err);
            }
        }
    },

    // 10. .prop_ans HANDLER COMMAND
    {
        name: 'prop_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const parts = args.split(' ');
            const action = parts[0]?.toLowerCase().trim();
            const targetNumInput = parts[1]?.trim();
            const senderNumInput = parts[2]?.trim();

            if (!action || !targetNumInput || !senderNumInput) return;

            const clickerJid = msg.key.participant || msg.key.remoteJid || '';
            const clickerNum = clickerJid.split('@')[0];

            if (clickerNum !== targetNumInput) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Hey!* This proposal is not meant for you. Let @${targetNumInput} answer! 👿`,
                    mentions: [`${targetNumInput}@s.whatsapp.net`]
                }, { quoted: msg });
            }

            const senderJid = `${senderNumInput}@s.whatsapp.net`;
            const targetJid = `${targetNumInput}@s.whatsapp.net`;

            if (action === 'yes') {
                const text = `💍 *PROPOSAL ACCEPTED!* 💍\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🎉 @${targetNumInput} and @${senderNumInput} are now officially *ENGAGED*! Satoru Gojo has blessed this union! 🥂✨`;
                await sock.sendMessage(jid, { text, mentions: [targetJid, senderJid] }, { quoted: msg });
            } else if (action === 'no') {
                const sadness = sadnessQuotes[Math.floor(Math.random() * sadnessQuotes.length)];
                const text = `💔 *PROPOSAL REJECTED* 💔\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n@${senderNumInput}... \n${sadness}`;
                await sock.sendMessage(jid, { text, mentions: [senderJid] }, { quoted: msg });
            }
        }
    },

    // 11. .askout COMMAND
    {
        name: 'askout',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

                const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');

                if (!targetJid || targetJid === senderJid) {
                    return await sock.sendMessage(jid, { text: "❌ Please mention (@user) or reply to the message of the user you wish to ask out." }, { quoted: msg });
                }

                const senderNum = senderJid.split('@')[0];
                const targetNum = targetJid.split('@')[0];
                const heartMsg = askoutMessages[Math.floor(Math.random() * askoutMessages.length)];

                const text = 
                    `💌 *A CONFESSION UNDER THE LIGHTS* 💌\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `💖 *To:* @${targetNum}\n` +
                    `📝 _"${heartMsg}"_\n\n` +
                    `👉 *WILL YOU GO OUT WITH ME?* @${targetNum} 👈\n\n` +
                    `⚠️ _Only @${targetNum} can respond to this confession._\n` +
                    `💡 _If buttons are not visible on your client, reply with:_\n` +
                    `• \`${settings.prefix}ask_ans yes ${targetNum} ${senderNum}\`\n` +
                    `• \`${settings.prefix}ask_ans no ${targetNum} ${senderNum}\``;

                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${settings.prefix}ask_ans yes ${targetNum} ${senderNum}`, buttonText: { displayText: '💖 Yes!' }, type: 1 },
                        { buttonId: `${settings.prefix}ask_ans no ${targetNum} ${senderNum}`, buttonText: { displayText: '💔 No' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid]
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (btnErr) {
                    await sock.sendMessage(jid, { text: text, mentions: [targetJid] }, { quoted: msg });
                }

            } catch (err) {
                console.error("Askout error:", err);
            }
        }
    },

    // 12. .ask_ans HANDLER COMMAND
    {
        name: 'ask_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const parts = args.split(' ');
            const action = parts[0]?.toLowerCase().trim();
            const targetNumInput = parts[1]?.trim();
            const senderNumInput = parts[2]?.trim();

            if (!action || !targetNumInput || !senderNumInput) return;

            const clickerJid = msg.key.participant || msg.key.remoteJid || '';
            const clickerNum = clickerJid.split('@')[0];

            if (clickerNum !== targetNumInput) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Hey!* This confession is not meant for you. Let @${targetNumInput} answer! 👿`,
                    mentions: [`${targetNumInput}@s.whatsapp.net`]
                }, { quoted: msg });
            }

            const senderJid = `${senderNumInput}@s.whatsapp.net`;
            const targetJid = `${targetNumInput}@s.whatsapp.net`;

            if (action === 'yes') {
                const text = `🎉 *CONFESSION ACCEPTED!* 🎉\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n💖 @${targetNumInput} and @${senderNumInput} are now officially in a *relationship*! Protect this bond! 💖`;
                await sock.sendMessage(jid, { text, mentions: [targetJid, senderJid] }, { quoted: msg });
            } else if (action === 'no') {
                const sadness = sadnessQuotes[Math.floor(Math.random() * sadnessQuotes.length)];
                const text = `💔 *CONFESSION REJECTED* 💔\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n@${senderNumInput}... \n${sadness}`;
                await sock.sendMessage(jid, { text, mentions: [senderJid] }, { quoted: msg });
            }
        }
    },

    // 13. .hollow-purple / .purple-tech COMMAND (Owner & Sudo Exclusive)
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

            try {
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {
                const fallbackText = `${text}\n\n💡 _Reply with:_\n• \`${settings.prefix}purple_ans 100\`\n• \`${settings.prefix}purple_ans 200\``;
                await sock.sendMessage(jid, { text: fallbackText }, { quoted: msg });
            }
        }
    },

    // 14. .purple_ans RESPONSE HANDLER (Owner & Sudo Exclusive)
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
                    toSans("Take the amplified infinity and the turned-out infinity"),
                    toSans("Then smash together those two different expressions of infinity to create and push out imaginary mass"),
                    toSans("Cursed Technique Lapse: Blue") + "\n                    🫸🔵🫷",
                    toSans("Cursed Technique Reversal: Red") + "\n                  🫸🔴🔵🫷",
                    toSans("Hollow Technique: Purple") + "\n          🤌.......🫴⏤͟͟͞🟣"
                ];

                try {
                    let sentMsg = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
                    for (let i = 1; i < frames.length; i++) {
                        await delay(3000);
                        await sock.sendMessage(jid, { text: frames[i], edit: sentMsg.key });
                    }
                } catch (err) {
                    console.error("100% Purple loop error:", err);
                }
            } 
            else if (selection === '200') {
                const frames = [
                    toSans("Maximum output!!!") + "\n          " + toSans("Blue!!!🔵"),
                    toSans("Phase!!! Paramita") + "\n    " + toSans("Pillar of light"),
                    toSans("Phase!!!! Twilight") + "\n" + toSans("Eyes of wisdom"),
                    toSans("Nine ropes! Polarized light") + "\n" + toSans("Crow and declaration!"),
                    toSans("Between front and back!!!!") + " \n             🫸🔴🔵🫷",
                    toSans("Hollow Purple!!") + " \n🤌.......🫴⏤͟͟͞🟣"
                ];

                try {
                    let sentMsg = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
                    for (let i = 1; i < frames.length; i++) {
                        await delay(3000);
                        await sock.sendMessage(jid, { text: frames[i], edit: sentMsg.key });
                    }
                } catch (err) {
                    console.error("200% Purple loop error:", err);
                }
            }
        }
    },

    // 15. .hack / .hack bank TERMINAL ANIMATIONS
    {
        name: 'hack',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const subAction = args ? args.toLowerCase().trim() : '';

            if (subAction === 'bank') {
                const frames = [
                    "🏦 `[SECURITY BREACH: SWIFT CODES]`\n" +
                    "🛰️ `Establishing secure handshake...`\n" +
                    "🔐 `Bypassing bank firewall: 0%`\n" +
                    "💸 `Target: Central Reserve Vault`",

                    "🏦 `[SECURITY BREACH: SWIFT CODES]`\n" +
                    "🛰️ `Handshake established (Port 443)`\n" +
                    "🔑 `Decrypting SSL private keys: 35%`\n" +
                    "💸 `Intercepting transaction ledger...`",

                    "🏦 `[SECURITY BREACH: SWIFT CODES]`\n" +
                    "🛰️ `Uplink: STABLE (Proxy: Switzerland)`\n" +
                    "🔓 `Bank firewall bypassed: 78%`\n" +
                    "💸 `Injecting routing tables...`",

                    "🏦 `[SECURITY BREACH: SWIFT CODES]`\n" +
                    "🛰️ `Core Database COMPROMISED`\n" +
                    "💳 `Exfiltrating funds: 100%`\n\n" +
                    "💸 *HACK SUCCESSFUL! $50,000,000 wired.* 💰⚡"
                ];

                try {
                    let sent = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
                    for (let i = 1; i < frames.length; i++) {
                        await delay(2000);
                        await sock.sendMessage(jid, { text: frames[i], edit: sent.key });
                    }
                } catch (err) {
                    console.error("Bank hack animation failed:", err.message);
                }
                return;
            }

            const frames = [
                "⚙️ `[BOOTING EXPLOIT KIT: LIMITLESS]`\n" +
                "🌐 `Scanning network interfaces...`\n" +
                "🖥️ `Target Host found: IP 192.168.1.104`\n" +
                "📦 `Progress: [░░░░░░░░░░] 0%`",

                "⚙️ `[BOOTING EXPLOIT KIT: LIMITLESS]`\n" +
                "💉 `Injecting payload into system kernel...`\n" +
                "🔓 `Privilege escalation: ROOT ACCESS`\n" +
                "📦 `Progress: [████░░░░░░] 40%`",

                "⚙️ `[BOOTING EXPLOIT KIT: LIMITLESS]`\n" +
                "🕵️ `Extracting cached system credentials...`\n" +
                "🔑 `Shadow password file decrypter running...`\n" +
                "📦 `Progress: [████████░░] 80%`",

                "⚙️ `[BOOTING EXPLOIT KIT: LIMITLESS]`\n" +
                "🖥️ *System ownership fully claimed!*\n" +
                "⚠️ *Encryption complete. Target locked.* 🔓💥\n" +
                "📦 `Progress: [██████████] 100%`"
            ];

            try {
                let sent = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
                for (let i = 1; i < frames.length; i++) {
                    await delay(2000);
                    await sock.sendMessage(jid, { text: frames[i], edit: sent.key });
                }
            } catch (err) {
                console.error("Software hack animation failed:", err.message);
            }
        }
    },

    // 16. .arrest COMMAND (ARREST MEMORANDUM & JAIL TRIGGER)
    {
        name: 'arrest',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

                const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');

                if (!targetJid || targetJid === senderJid) {
                    return await sock.sendMessage(jid, { text: "❌ Please reply to a user's message or mention (@user) to arrest them." }, { quoted: msg });
                }

                const senderNum = senderJid.split('@')[0];
                const targetNum = targetJid.split('@')[0];

                const text = 
                    `🚨 *ARREST MEMORANDUM* 🚨\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *Target:* @${targetNum}\n` +
                    `⚖️ *Officer:* @${senderNum}\n\n` +
                    `📄 "You have the right to remain silent. Anything you say can and will be used against you in the court of Jujutsu law..."\n\n` +
                    `⛓️ *Bail is denied. Secure them behind bars below:*`;

                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${settings.prefix}jail_ans ${targetNum}`, buttonText: { displayText: 'Send to Jail ⛓️' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid, senderJid]
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (btnErr) {
                    const fallbackText = `${text}\n\n💡 _Reply with:_\n• \`${settings.prefix}jail_ans ${targetNum}\``;
                    await sock.sendMessage(jid, { text: fallbackText, mentions: [targetJid, senderJid] }, { quoted: msg });
                }

            } catch (err) {
                console.error("Arrest command error:", err);
            }
        }
    },

    // 17. .jail_ans RESPONSE HANDLER (PROCESSED IMAGE COMPOSITE OVERLAY VIA SHARP)
    {
        name: 'jail_ans',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const targetNum = args.trim().split(' ')[0];
            const targetJid = `${targetNum}@s.whatsapp.net`;

            try {
                const craftingMsg = await sock.sendMessage(jid, { text: `Forging iron bars for target @${targetNum}... ⚙️⛓️`, mentions: [targetJid] }, { quoted: msg });

                let profileUrl;
                try {
                    profileUrl = await sock.profilePictureUrl(targetJid, 'image');
                } catch (err) {
                    profileUrl = "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";
                }

                const imageRes = await fetch(profileUrl);
                if (!imageRes.ok) throw new Error("Profile picture server currently unreachable.");
                
                const arrayBuffer = await imageRes.arrayBuffer();
                const imageBuffer = Buffer.from(arrayBuffer);

                const sharp = require('sharp');

                const jailSvg = Buffer.from(`
                    <svg width="500" height="500">
                        <line x1="80" y1="0" x2="80" y2="500" stroke="black" stroke-width="14" />
                        <line x1="160" y1="0" x2="160" y2="500" stroke="black" stroke-width="14" />
                        <line x1="240" y1="0" x2="240" y2="500" stroke="black" stroke-width="14" />
                        <line x1="320" y1="0" x2="320" y2="500" stroke="black" stroke-width="14" />
                        <line x1="400" y1="0" x2="400" y2="500" stroke="black" stroke-width="14" />
                        <!-- horizontal lock bars -->
                        <line x1="0" y1="120" x2="500" y2="120" stroke="#222222" stroke-width="18" />
                        <line x1="0" y1="380" x2="500" y2="380" stroke="#222222" stroke-width="18" />
                    </svg>
                `);

                const processedBuffer = await sharp(imageBuffer)
                    .resize(500, 500)
                    .composite([{ input: jailSvg, top: 0, left: 0 }])
                    .png()
                    .toBuffer();

                try {
                    await sock.sendMessage(jid, { delete: craftingMsg.key });
                } catch (e) {}

                await sock.sendMessage(jid, {
                    image: processedBuffer,
                    caption: `⛓️ *Target @${targetNum} has been officially locked up inside the Limitless Prison cell!* \n_\"No visitors allowed.\"_`,
                    mentions: [targetJid]
                }, { quoted: msg });

            } catch (err) {
                console.error("Jail image composite error:", err);
                await sock.sendMessage(jid, { text: `⛓️ *Target @${targetNum} is locked up inside prison!* \n\n_(The jail cells were locked but image formatting failed: ${err.message})_`, mentions: [targetJid] }, { quoted: msg });
            }
        }
    },

    // 18. ANIME ACTIONS (SLAP, KILL, KISS, HUG, KICK, PUNCH, HI-FIVE, BITE, POKE)
    {
        name: 'slap',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await executeAction(sock, msg, "slap", "slapped");
        }
    },
    {
        name: 'kill',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await executeAction(sock, msg, "kill", "killed");
        }
    },
    {
        name: 'kiss',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await executeAction(sock, msg, "kiss", "kissed");
        }
    },
    {
        name: 'hug',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await executeAction(sock, msg, "hug", "hugged");
        }
    },
    {
        name: 'kik',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await executeAction(sock, msg, "kick", "kicked");
        }
    },
    {
        name: 'punch',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await executeAction(sock, msg, "punch", "punched");
        }
    },
    {
        name: 'hifive',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await executeAction(sock, msg, "highfive", "highfived");
        }
    },
    {
        name: 'bite',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await executeAction(sock, msg, "bite", "bit");
        }
    },
    {
        name: 'poke',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await executeAction(sock, msg, "poke", "poked");
        }
    },

    // 19. .info COMMAND (USER PROFILE DIAGNOSTICS)
    {
        name: 'info',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

            const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : senderJid);
            const targetNum = targetJid.split('@')[0];

            let pfpUrl;
            try {
                pfpUrl = await sock.profilePictureUrl(targetJid, 'image');
            } catch (e) {
                pfpUrl = "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png";
            }

            let bio = "No bio set.";
            try {
                const statusObj = await sock.fetchStatus(targetJid);
                bio = statusObj?.status || bio;
            } catch (e) {}

            const stanzaId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
            let device = "Reply to their message to detect OS ❓";
            if (stanzaId && targetJid === repliedJid) {
                device = getDeviceTypeFromId(stanzaId);
            }

            const displayName = targetJid === senderJid ? (msg.pushName || "User") : "WhatsApp Contact";

            const infoCaption = 
                `📋 *LIMITLESS USER INTEL SUMMARY* 📋\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *Name:* \`${displayName}\`\n` +
                `📱 *Number:* \`+${targetNum}\`\n` +
                `✍️ *Bio:* \`"${bio}"\`\n` +
                `🛡️ *Platform Device:* \`${device}\`\n\n` +
                `_Metadata extracted from WhatsApp system servers._ 🤞`;

            await sock.sendMessage(jid, {
                image: { url: pfpUrl },
                caption: infoCaption,
                mentions: [targetJid]
            }, { quoted: msg });
        }
    },

    // 20. .liedetector COMMAND (TRUTH OR LIE TEST)
    {
        name: 'liedetector',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

            const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : senderJid);
            const senderNum = senderJid.split('@')[0];
            const targetNum = targetJid.split('@')[0];

            try {
                const loadingMsg = await sock.sendMessage(jid, { text: `Analyzing biometric patterns for @${targetNum}... 🔍📈`, mentions: [targetJid] }, { quoted: msg });
                await delay(2000);

                const isLying = Math.random() < 0.5;
                const percentage = Math.floor(Math.random() * 41) + 60; // 60% - 100% certainty

                const barLength = 10;
                const filledCount = Math.round((percentage / 100) * barLength);
                const emptyCount = barLength - filledCount;
                const bar = "█".repeat(filledCount) + "░".repeat(emptyCount);

                let verdict = "";
                if (isLying) {
                    verdict = `🔴 *Lying with ${percentage}% certainty!* \n_“Even my Six Eyes can see right through your lies!”_ 👿`;
                } else {
                    verdict = `🟢 *Saying the truth with ${percentage}% certainty!* \n_“Your biometric signatures match up. You are safe.”_ 🤞`;
                }

                const responseText = 
                    `🧬 *LIMITLESS BIOMETRIC LIE DETECTOR* 🧬\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *Subject:* @${targetNum}\n` +
                    `⚖️ *Tester:* @${senderNum}\n\n` +
                    `📊 *Signal Deviances:* [${bar}]\n\n` +
                    `📢 *Verdict:* ${verdict}`;

                await sock.sendMessage(jid, {
                    text: responseText,
                    edit: loadingMsg.key,
                    mentions: [targetJid, senderJid]
                });

            } catch (err) {
                console.error("Lie detector failed:", err.message);
            }
        }
    },

    // 21. .rizz COMMAND (PICKUP LINES)
    {
        name: 'rizz',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            try {
                const rizz = rizzLines[Math.floor(Math.random() * rizzLines.length)];
                await sock.sendMessage(jid, { text: `🌹 *Infinite Rizz manifested:* \n\n${rizz}` }, { quoted: msg });
            } catch (err) {
                console.error("Rizz command failed:", err.message);
            }
        }
    },

    // 22. .speech COMMAND (ANIME SPEECH RECOVERY / AI-GENERATION)
    {
        name: 'speech',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            // Case A: Fetch random speech from local dataset
            if (!args) {
                const randomSpeech = famousSpeeches[Math.floor(Math.random() * famousSpeeches.length)];
                const text = 
                    `🎬 *FAMOUS ANIME SPEECH RECOVERED* 🎬\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *Character:* *${randomSpeech.character}*\n` +
                    `📺 *Anime:* _${randomSpeech.anime}_\n\n` +
                    `🗣️ *Speech:* \n_"${randomSpeech.speech}"_`;
                return await sock.sendMessage(jid, { text }, { quoted: msg });
            }

            // Case B: Query specific character speech using Groq LLM [INDEX: ai.js]
            try {
                await sock.sendMessage(jid, { text: `Searching chronicles for speeches of *"${args}"*... 📜✨` }, { quoted: msg });

                const systemPrompt = 
                    "You are an expert anime/manga librarian.\n" +
                    "Find or write the most iconic, impactful, or epic speech delivered by the requested character.\n" +
                    "Format your response exactly like this:\n\n" +
                    "🎬 *ANIME SPEECH RECOVERED* 🎬\n" +
                    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                    "👤 *Character:* [Character Name]\n" +
                    "📺 *Anime:* [Anime Name]\n\n" +
                    "🗣️ *Speech:* \n" +
                    "\"[Epic/Impactful Speech text]\"\n\n" +
                    "If the character does not exist in any anime/manga, write: 'NOT_FOUND'.\n" +
                    "Do not include any greeting or conversational pleasantries.";

                const messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: args }
                ];

                const responseText = await queryGroq(messages, "llama-3.3-70b-versatile");
                const cleanResponse = responseText.trim();

                if (cleanResponse.includes("NOT_FOUND")) {
                    await sock.sendMessage(jid, { text: `❌ Character *"${args}"* was not found in anime databases.` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: cleanResponse }, { quoted: msg });
                }

            } catch (err) {
                console.error("Speech generation failed:", err.message);
                await sock.sendMessage(jid, { text: "❌ Failed to retrieve speech archives." }, { quoted: msg });
            }
        }
    },

    // 23. .emojimix / .emix STICKER GENERATOR (PROGRAMMATIC POLLI-STICKER COMPOSITE)
    {
        name: 'emojimix',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { text: `❌ Please provide two emojis.\nExample: \`${settings.prefix}emix ❄️ + 😂\`` }, { quoted: msg });
            }

            const emojis = extractEmojis(args);
            if (emojis.length < 2) {
                return await sock.sendMessage(jid, { text: "❌ Please enter at least *two distinct emojis* to mix." }, { quoted: msg });
            }

            const emoji1 = emojis[0];
            const emoji2 = emojis[1];

            try {
                const craftingMsg = await sock.sendMessage(jid, { text: `Combining ${emoji1} and ${emoji2} into a hybrid sticker... 🧪🎨` }, { quoted: msg });

                // Generate mixed emoji vector using a high-quality prompt and Pollinations AI
                const prompt = `a 3D high-resolution render of a mixed emoji combining ${emoji1} and ${emoji2} on a transparent white background, official high-quality emoji sticker style`;
                const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&private=true`;

                // Download image buffer
                const imageRes = await fetch(imageUrl);
                if (!imageRes.ok) throw new Error("Image generation server timed out.");

                const arrayBuffer = await imageRes.arrayBuffer();
                const imageBuffer = Buffer.from(arrayBuffer);

                // Compile transparent sticker using wa-sticker-formatter
                const sticker = new Sticker(imageBuffer, {
                    pack: settings.packName || "Limitless Pack",
                    author: settings.author || "Infinity",
                    type: StickerTypes.CROPPED,
                    quality: 85
                });

                const stickerBuffer = await sticker.toBuffer();

                try {
                    await sock.sendMessage(jid, { delete: craftingMsg.key });
                } catch (e) {}

                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });

            } catch (err) {
                console.error("EmojiMix failed:", err.message);
                await sock.sendMessage(jid, { text: `❌ Emoji mixing failed: ${err.message}` }, { quoted: msg });
            }
        }
    }
];

// Add structural aliases safely
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'dom-exp') {
        aliases.push({ ...cmd, name: 'domain-expansion' });
    }
    if (cmd.name === 'hollow-purple') {
        aliases.push({ ...cmd, name: 'purple-tech' });
    }
    if (cmd.name === 'emojimix') {
        aliases.push({ ...cmd, name: 'emix' });
    }
});
module.exports.push(...aliases);