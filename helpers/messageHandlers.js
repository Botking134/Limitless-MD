// plugins/fun.js
const config = require('../config');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const { getPhoneJid, normalizeToJid } = require('../stateManager');

// ─── PURPLE_ANS GIFS (Issue 6) ──────────────────────────────────
const PURPLE_100_GIF = "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExMXgwdG55YjMyeGtsbThnOGczY2k5bTczYjFzbXBocndiemZzYjJxNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/1Nzq2od8Zz3aQYqfFi/giphy.mp4";
const PURPLE_200_GIF = "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExMGlyODhydzVqM2FxNnJmMDY1ZXQyZDR0YnhiaTh6ZHlwZHRwYmR0MyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0wxRYPhdD7n3W7NQ1R/giphy.mp4";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        const botJid = config.botJid || '';
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

function getGiphyDirectUrl(url) {
    if (!url) return '';
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1] || parts[parts.length - 2] || '';
    const segmentParts = lastPart.split('-');
    const id = segmentParts[segmentParts.length - 1];
    return `https://media.giphy.com/media/${id}/giphy.mp4`;
}

function toSans(text) {
    return text.split('').map(char => {
        const code = char.charCodeAt(0);
        if (code >= 65 && code <= 90) {
            return String.fromCodePoint(code - 65 + 0x1D5A0);
        }
        if (code >= 97 && code <= 122) {
            return String.fromCodePoint(code - 97 + 0x1D5BA);
        }
        if (code >= 48 && code <= 57) {
            return String.fromCodePoint(code - 48 + 0x1D7E2);
        }
        return char;
    }).join('');
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
        body: JSON.stringify({ model, messages, temperature: 0.3 })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

// ─── ASSETS (unchanged) ────────────────────────────────────────

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
            } catch (e) { /* ignore */ }
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

// ─── STATIC DATABASES ───────────────────────────────────────────

const bankaiData = [
    { name: "Ichigo Kurosaki", aliases: ["ichigo", "kurosaki", "tensa zangetsu"], position: "Substitute Shinigami", bankaiName: "Tensa Zangetsu", abilities: "Grants extreme speed and enhanced reflexes. It concentrates his spiritual pressure into a condensed sword state, allowing him to fire devastating, high-velocity black Getsuga Tensho blasts." },
    { name: "Rukia Kuchiki", aliases: ["rukia", "hakka no togame"], position: "Captain of Division 13", bankaiName: "Hakka no Togame", abilities: "Extends her frost-based release parameters to reach absolute zero instantly. This freezes all spatial constructs, freezing and vaporizing any matter within her direct vicinity." },
    { name: "Byakuya Kuchiki", aliases: ["byakuya", "senbonzakura"], position: "Captain of Division 6", bankaiName: "Senbonzakura Kageyoshi", abilities: "Scatters millions of tiny blade petals that shred targets with absolute spatial control. It forms an inescapable arena of floating, defensive and offensive blade sheets." },
    { name: "Kisuke Urahara", aliases: ["kisuke", "urahara", "kannonbiraki"], position: "Store Owner / Former Captain", bankaiName: "Kannonbiraki Benihime Aratame", abilities: "Grants him the power to reconstruct and restructure anything his release physically touches. This can be used to open up pathways, heal wounded flesh, or restructure his arms for physical combat." },
    { name: "Shunsui Kyoraku", aliases: ["shunsui", "kyoraku", "katen kyokotsu"], position: "Captain-Commander / Division 1", bankaiName: "Katen Kyokotsu: Karamatsu Shinju", abilities: "Engulfs a massive area in a pitch-black aura of shared despair. It forces opponents to play through a tragic, unavoidable four-act theatrical play that cuts, drowns, and cleanly slices their throat." },
    { name: "Genryusai Shigekuni Yamamoto", aliases: ["yamamoto", "genryusai", "zanka no tachi"], position: "Former Captain-Commander", bankaiName: "Zanka no Tachi", abilities: "Concentrates 15 million degrees of roaring heat and flame directly into a single scorched blade edge. It vaporizes anything it touches instantly, leaving only ashes behind." },
    { name: "Toshiro Hitsugaya", aliases: ["toshiro", "hitsugaya", "daiguren hyorinmaru"], position: "Captain of Division 10", bankaiName: "Grand Crimson Ice Ring (Daiguren Hyorinmaru)", abilities: "Unleashes massive amounts of absolute zero ice. In its completed state, it allows him to flash-freeze all matter, conceptual abilities, and physical attacks instantly upon contact." },
    { name: "Kenpachi Zaraki", aliases: ["kenpachi", "zaraki"], position: "Captain of Division 11", bankaiName: "Unnamed Bankai", abilities: "Turns him into a blood-red berserker demon of pure, mindless, and limitless physical strength. It grants him raw cutting power capable of slicing through clean space and giant constructs easily." }
];

const nonBankaiCharacters = {
    "aizen": "Sosuke Aizen possesses Kyoka Suigetsu (Shikai), but never revealed a Bankai in canon.",
    "sosuke aizen": "Sosuke Aizen possesses Kyoka Suigetsu (Shikai), but never revealed a Bankai in canon.",
    "ishida": "Uryu Ishida is a Quincy and does not possess a Zanpakuto or Bankai.",
    "uryu ishida": "Uryu Ishida is a Quincy and does not possess a Zanpakuto or Bankai.",
    "chad": "Yasutora Sado (Chad) is a Human/Fullbringer and does not possess a Bankai.",
    "orihime": "Orihime Inoue is a Human with Shun Shun Rikka and does not possess a Bankai.",
    "grimmjow": "Grimmjow is an Arrancar and does not possess a Bankai; he uses Resurrección.",
    "ulquiorra": "Ulquiorra is an Arrancar and does not possess a Bankai; he uses Segunda Etapa.",
    "yoruichi": "Yoruichi possesses a Zanpakuto and likely has Bankai, but never uses it in combat."
};

const nonBleachAnime = ["luffy", "zoro", "naruto", "sasuke", "goku", "vegeta", "deku", "tanjiro", "gojo", "sukuna", "itadori", "megumi"];

const domainData = [
    { name: "Satoru Gojo", aliases: ["gojo", "satoru", "unlimited void", "muryokusho"], position: "Special Grade Sorcerer", domainName: "Unlimited Void (Muryōkūsho)", abilities: "Floods the brains of all targets with an infinite flow of raw information and sensory stimulation. This paralyzes them instantly, leaving them entirely unable to react or function." },
    { name: "Ryomen Sukuna", aliases: ["sukuna", "ryomen", "malevolent shrine", "fukuma mizushi"], position: "King of Curses", domainName: "Malevolent Shrine (Fukuma Mizushi)", abilities: "An open-barrier domain that can span up to a massive 200 meters. It constantly rains down endless, invisible slashes (Cleave and Dismantle) to shred all objects and living things to dust." },
    { name: "Megumi Fushiguro", aliases: ["megumi", "fushiguro", "chimera shadow garden"], position: "Grade 2 Sorcerer", domainName: "Chimera Shadow Garden (Kanga Koshōien)", abilities: "Floods the surrounding area in a thick, active ocean of dark shadow fluid. It allows him to summon endless duplicates of his shikigami and easily slip into the shadows for absolute evasion." },
    { name: "Yuta Okkotsu", aliases: ["yuta", "okkotsu", "authentic mutual love"], position: "Special Grade Sorcerer", domainName: "Authentic Mutual Love (Shingan Sōai)", abilities: "Spawns a massive, beautiful sword graveyard inside a golden, knotted-rope barrier. It allows him to access and execute an infinite variety of copied cursed techniques by retrieving the blades." },
    { name: "Mahito", aliases: ["mahito", "self-embodiment of perfection"], position: "Special Grade Curse", domainName: "Self-Embodiment of Perfection (Heika Jisei)", abilities: "Spawns a giant web of giant hands that locks the area down. It grants him a guaranteed, instant connection to all target souls, letting him transfigure or destroy them without needing physical touch." },
    { name: "Jogo", aliases: ["jogo", "coffin of the iron mountain"], position: "Special Grade Curse", domainName: "Coffin of the Iron Mountain (Gaichūzō)", abilities: "Envelops all targets deep inside the active chamber of an erupting volcano. Standard sorcerers instantly ignite and combust upon entering the extreme ambient temperatures of this domain." },
    { name: "Hakari Kinji", aliases: ["hakari", "kinji", "idle death gamble"], position: "Jujutsu High Student", domainName: "Idle Death Gamble (Zatsubo Shingetsu)", abilities: "Creates a giant, real-world pachinko casino. Tapping into its luck multipliers and hitting a jackpot grants him an endless supply of cursed energy and absolute immortality for exactly 4 minutes and 11 seconds." }
];

const nonDomainCharacters = {
    "nanami": "Kento Nanami is a Grade 1 Sorcerer who possessed precision with his Ratio Technique, but never achieved a Domain Expansion.",
    "toji": "Toji Fushiguro has zero cursed energy due to Heavenly Restriction, meaning he physically cannot create a Domain Expansion.",
    "maki": "Maki Zen'in has zero cursed energy due to Heavenly Restriction, making it physically impossible for her to expand a Domain.",
    "nobara": "Nobara Kugisaki possesses the Straw Doll Technique but never unlocked Domain Expansion.",
    "miwa": "Kasumi Miwa uses Simple Domain for defense, but cannot expand an innate domain.",
    "toge": "Toge Inumaki uses Cursed Speech, but does not possess a Domain Expansion."
};

const nonJjkAnime = ["luffy", "zoro", "naruto", "sasuke", "goku", "vegeta", "deku", "tanjiro", "ichigo", "byakuya", "rukia", "yamamoto"];

const wyrQuestions = [
    { o1: "Always have wet socks", o2: "Always have a popcorn kernel stuck in your teeth" },
    { o1: "Have your search history read out loud at your wedding", o2: "Have your search history read at your funeral" },
    { o1: "Only be able to whisper everything you say", o2: "Only be able to scream everything you say" },
    { o1: "Fight 1 horse-sized duck", o2: "Fight 100 duck-sized horses" },
    { o1: "Have cheese for hair", o2: "Sweat warm maple syrup" },
    { o1: "Have to announce every time you fart", o2: "Have everyone else announce when you fart" }
];

const jokeData = [
    "Why don't skeletons fight each other? They don't have the guts.",
    "I only know 25 letters of the alphabet. I don't know y.",
    "What do you call a fake noodle? An impasta.",
    "Why did the scarecrow win an award? Because he was outstanding in his field.",
    "I'm reading a book on anti-gravity. I just can't put it down!"
];

const insultData = [
    "You're the reason the shampoo bottle has instructions.",
    "If I had a face like yours, I'd sue my parents.",
    "You are like a cloud. When you disappear, it's a beautiful day.",
    "I've seen puddles deeper than your personality."
];

const roastData = [
    "If absolute zero is -273.15 degrees, your charisma is at least -300.",
    "You have the perfect face for radio.",
    "You're not standard material, you're the draft copy that got rejected.",
    "I would roast you, but my mom told me not to burn trash."
];

const proposalMessages = [
    "From the moment I met you, my world changed. I want to build a domain with you.",
    "You are my reverse cursed technique; you heal me when I'm broken.",
    "They say nothing is infinite, but my love for you defies that law."
];

const askoutMessages = [
    "I've been thinking about you a lot... can we be more than just group members?",
    "You have a certain spark that lights up my whole chat. Will you go out with me?",
    "No games, no curses, just pure feelings. Will you be mine?"
];

const rizzLines = [
    "Are you a cursed spirit? Because you've been haunting my mind all day.",
    "Is your name Gojo? Because you're the strongest thing that's ever hit my heart."
];

const famousSpeeches = [
    { character: "Satoru Gojo", speech: "Don't worry, I'm the strongest." },
    { character: "Sosuke Aizen", speech: "No one stands on the top of the world from the beginning. Not you, not me, not even Gods." }
];

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. BANKAI
    {
        name: 'bankai',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                const randomBankai = bankaiData[Math.floor(Math.random() * bankaiData.length)];
                const text = `🗡️ *BANKAI MANIFESTATION* 🗡️\n` +
                             `👤 *Owner:* ${randomBankai.name}\n` +
                             `🎖️ *Position:* ${randomBankai.position}\n` +
                             `🔥 *Bankai:* ${randomBankai.bankaiName}\n` +
                             `🔮 *Abilities:* ${randomBankai.abilities}`;
                return await sock.sendMessage(jid, { text }, { quoted: msg });
            }

            const cleanQuery = args.toLowerCase().trim();
            const matched = bankaiData.find(b => b.aliases.includes(cleanQuery) || b.name.toLowerCase().includes(cleanQuery));
            if (matched) {
                const text = `🗡️ *BANKAI INDEX* 🗡️\n` +
                             `👤 *Owner:* ${matched.name}\n` +
                             `🎖️ *Position:* ${matched.position}\n` +
                             `🔥 *Bankai:* ${matched.bankaiName}\n` +
                             `🔮 *Abilities:* ${matched.abilities}`;
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
                    "You are an expert on the Bleach anime universe.\n" +
                    "Analyze the user's query.\n\n" +
                    "1. If NOT from Bleach, reply ONLY: 'NOT_FROM_BLEACH'.\n" +
                    "2. If from Bleach but has NO Bankai, reply ONLY with a clear, direct, and concise explanation why they do not possess a Bankai.\n" +
                    "3. If they possess a Bankai, respond ONLY in this layout:\n\n" +
                    "🗡️ *BANKAI INDEX* 🗡️\n" +
                    "👤 *Owner:* [Name]\n" +
                    "🎖️ *Position:* [Position/Identity]\n" +
                    "🔥 *Bankai:* [Bankai Name]\n" +
                    "🔮 *Abilities:* [Write a detailed, medium-length explanation of 2 to 3 sentences detailing the bankai's combat properties, visual appearance, and active abilities]";

                const responseText = await queryGroq([
                    { role: "system", content: systemPrompt },
                    { role: "user", content: args }
                ]);
                const cleanResponse = responseText.trim();

                if (cleanResponse.includes("NOT_FROM_BLEACH")) {
                    await sock.sendMessage(jid, { text: `❌ "${args}" is not from the Bleach anime.` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: cleanResponse }, { quoted: msg });
                }
            } catch (err) { /* ignore */ }
        }
    },

    // 2. DOMAIN EXPANSION
    {
        name: 'dom-exp',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                const randomDomain = domainData[Math.floor(Math.random() * domainData.length)];
                const text = `🌀 *DOMAIN EXPANSION* 🌀\n` +
                             `👤 *Owner:* ${randomDomain.name}\n` +
                             `🎖️ *Status/Grade:* ${randomDomain.position}\n` +
                             `🔥 *Domain:* ${randomDomain.domainName}\n` +
                             `🔮 *Abilities:* ${randomDomain.abilities}`;
                return await sock.sendMessage(jid, { text }, { quoted: msg });
            }

            const cleanQuery = args.toLowerCase().trim();
            const matched = domainData.find(d => d.aliases.includes(cleanQuery) || d.name.toLowerCase().includes(cleanQuery));
            if (matched) {
                const text = `🌀 *DOMAIN EXPANSION* 🌀\n` +
                             `👤 *Owner:* ${matched.name}\n` +
                             `🎖️ *Status/Grade:* ${matched.position}\n` +
                             `🔥 *Domain:* ${matched.domainName}\n` +
                             `🔮 *Abilities:* ${matched.abilities}`;
                return await sock.sendMessage(jid, { text }, { quoted: msg });
            }

            if (nonDomainCharacters[cleanQuery]) {
                return await sock.sendMessage(jid, { text: `❌ ${nonDomainCharacters[cleanQuery]}` }, { quoted: msg });
            }

            if (nonJjkAnime.includes(cleanQuery)) {
                return await sock.sendMessage(jid, { text: `❌ "${args}" is not from the JJK anime.` }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Expanding Domain... 🤞🌀" }, { quoted: msg });
                const systemPrompt =
                    "You are an expert on the Jujutsu Kaisen (JJK) universe.\n" +
                    "Analyze the user's query.\n\n" +
                    "1. If NOT from JJK, reply ONLY: 'NOT_FROM_JJK'.\n" +
                    "2. If from JJK but has NO Domain, reply ONLY with a clear, direct, and concise explanation why they do not possess a Domain Expansion.\n" +
                    "3. If they possess a Domain, respond ONLY in this layout:\n\n" +
                    "🌀 *DOMAIN EXPANSION* 🌀\n" +
                    "👤 *Owner:* [Name]\n" +
                    "🎖️ *Status:* [Status/Grade]\n" +
                    "🔥 *Domain:* [Domain Expansion Name]\n" +
                    "🔮 *Abilities:* [Write a detailed, medium-length explanation of 2 to 3 sentences detailing the domain's environmental appearance, sure-hit effect, and core combat properties]";

                const responseText = await queryGroq([
                    { role: "system", content: systemPrompt },
                    { role: "user", content: args }
                ]);
                const cleanResponse = responseText.trim();

                if (cleanResponse.includes("NOT_FROM_JJK")) {
                    await sock.sendMessage(jid, { text: `❌ "${args}" is not from the JJK anime.` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: cleanResponse }, { quoted: msg });
                }
            } catch (err) { /* ignore */ }
        }
    },

    // 3. WOULD YOU RATHER
    {
        name: 'wyr',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            try {
                const randomWyr = wyrQuestions[Math.floor(Math.random() * wyrQuestions.length)];
                await sock.sendMessage(jid, {
                    poll: { name: "Would you rather... 🤔", values: [randomWyr.o1, randomWyr.o2], selectableCount: 1 }
                }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: "❌ Failed to create Would You Rather poll." }, { quoted: msg });
            }
        }
    },

    // 4. JOKE
    {
        name: 'joke',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            await sock.sendMessage(jid, { text: `😂 *Joke:* \n\n${jokeData[Math.floor(Math.random() * jokeData.length)]}` }, { quoted: msg });
        }
    },

    // 5. INSULT
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

    // 6. ROAST
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

    // 7. SHIP
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
                const contextInfo = rawMsg?.contextInfo ||
                                    rawMsg?.extendedTextMessage?.contextInfo ||
                                    rawMsg?.imageMessage?.contextInfo ||
                                    rawMsg?.videoMessage?.contextInfo ||
                                    rawMsg?.stickerMessage?.contextInfo ||
                                    rawMsg?.audioMessage?.contextInfo ||
                                    rawMsg?.documentMessage?.contextInfo;
                const mentions = contextInfo?.mentionedJid || [];

                let target1 = mentions[0] || cleanParticipants[Math.floor(Math.random() * cleanParticipants.length)];
                let target2 = mentions[1] || cleanParticipants.filter(p => p !== target1)[Math.floor(Math.random() * (cleanParticipants.length - 1))];

                const t1Num = target1.split('@')[0].split(':')[0];
                const t2Num = target2.split('@')[0].split(':')[0];

                const percentage = Math.floor(Math.random() * 101);

                const barLength = 10;
                const filledCount = Math.round((percentage / 100) * barLength);
                const emptyCount = barLength - filledCount;
                const bar = "█".repeat(filledCount) + "░".repeat(emptyCount);

                let verdict = percentage >= 80 ? "💍 Soulmates!" : (percentage >= 50 ? "💒 Match!" : "🏃💨 Mismatch.");

                const shipCaption = `💞 *SHIP* 💞\n👩‍❤️‍👨 @${t1Num} x @${t2Num}\n📊 [${bar}] *${percentage}%*\n📢 *Verdict:* ${verdict}`;
                await sock.sendMessage(jid, { text: shipCaption, mentions: [target1, target2] }, { quoted: msg });
            } catch (err) { /* ignore */ }
        }
    },

    // 8. WED
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
                        { buttonId: `${config.prefix}wed_ans yes ${targetNum} ${senderNum}`, buttonText: { displayText: '💍 I Do!' }, type: 1 },
                        { buttonId: `${config.prefix}wed_ans no ${targetNum} ${senderNum}`, buttonText: { displayText: "💔 I Don't" }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid, senderJid]
                };
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) { /* ignore */ }
        }
    },

    // 9. WED_ANS
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
            const clickerNum = clickerJid.split('@')[0];

            if (clickerNum !== targetNum) return;

            const targetJid = targetNum + (clickerJid.endsWith('@lid') ? '@lid' : '@s.whatsapp.net');
            const senderJid = senderNum + (clickerJid.endsWith('@lid') ? '@lid' : '@s.whatsapp.net');

            if (action === 'yes') {
                await sock.sendMessage(jid, { text: `👰🤵 *MATRIMONY COMPLETED!* 👰🤵\n\nBy Satoru Gojo's authority, I declare @${senderNum} and @${targetNum} joined in holy matrimony! 💍✨`, mentions: [senderJid, targetJid] }, { quoted: msg });
            } else if (action === 'no') {
                await sock.sendMessage(jid, { text: `💔 Matrimony declined by @${targetNum}.`, mentions: [targetJid] }, { quoted: msg });
            }
        }
    },

    // 10. PROPOSE
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
                        { buttonId: `${config.prefix}prop_ans yes ${targetNum} ${senderNum}`, buttonText: { displayText: '💍 Yes!' }, type: 1 },
                        { buttonId: `${config.prefix}prop_ans no ${targetNum} ${senderNum}`, buttonText: { displayText: '💔 No' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid]
                };
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) { /* ignore */ }
        }
    },

    // 11. PROP_ANS
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
            const clickerNum = clickerJid.split('@')[0];

            if (clickerNum !== targetNum) return;

            const targetJid = targetNum + (clickerJid.endsWith('@lid') ? '@lid' : '@s.whatsapp.net');
            const senderJid = senderNum + (clickerJid.endsWith('@lid') ? '@lid' : '@s.whatsapp.net');

            if (action === 'yes') {
                await sock.sendMessage(jid, { text: `💍 *ENGAGED!* 💍\n\n🎉 @${targetNum} and @${senderNum} are now officially *ENGAGED*!`, mentions: [targetJid, senderJid] }, { quoted: msg });
            } else if (action === 'no') {
                await sock.sendMessage(jid, { text: `💔 Proposal declined by @${targetNum}.`, mentions: [targetJid] }, { quoted: msg });
            }
        }
    },

    // 12. ASKOUT
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
                        { buttonId: `${config.prefix}ask_ans yes ${targetNum} ${senderNum}`, buttonText: { displayText: '💖 Yes!' }, type: 1 },
                        { buttonId: `${config.prefix}ask_ans no ${targetNum} ${senderNum}`, buttonText: { displayText: '💔 No' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid]
                };
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) { /* ignore */ }
        }
    },

    // 13. ASK_ANS
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
            const clickerNum = clickerJid.split('@')[0];

            if (clickerNum !== targetNum) return;

            const targetJid = targetNum + (clickerJid.endsWith('@lid') ? '@lid' : '@s.whatsapp.net');
            const senderJid = senderNum + (clickerJid.endsWith('@lid') ? '@lid' : '@s.whatsapp.net');

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
                    { buttonId: `${config.prefix}purple_ans 100`, buttonText: { displayText: '100%' }, type: 1 },
                    { buttonId: `${config.prefix}purple_ans 200`, buttonText: { displayText: '200%' }, type: 1 }
                ],
                headerType: 1
            };
            try { await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (err) { /* ignore */ }
        }
    },

    // ─── 15. PURPLE_ANS (Issue 6) ───────────────────────────────
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
                let sentMsg = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
                for (let i = 1; i < frames.length; i++) {
                    await delay(3000);
                    await sock.sendMessage(jid, { text: frames[i], edit: sentMsg.key });
                }

                // ─── Send 100% follow‑up GIF (Issue 6) ──────────
                await sock.sendMessage(jid, {
                    video: { url: PURPLE_100_GIF },
                    gifPlayback: true,
                    caption: "100% Hollow Purple"
                });
            } else if (selection === '200') {
                const frames = [
                    toSans("Maximum output!!!") + "\n          " + toSans("Blue!!!🔵"),
                    toSans("Phase!!! Paramita") + "\n    " + toSans("Pillar of light"),
                    toSans("Phase!!!! Twilight") + "\n" + toSans("Eyes of wisdom"),
                    toSans("Nine ropes! Polarized light") + "\n" + toSans("Crow and declaration!"),
                    toSans("Between front and back!!!!") + " \n             🫸🔴🔵🫷",
                    toSans("Hollow Purple!!") + " \n🤌.......🫴⏤͟͟͞🟣"
                ];
                let sentMsg = await sock.sendMessage(jid, { text: frames[0] }, { quoted: msg });
                for (let i = 1; i < frames.length; i++) {
                    await delay(3000);
                    await sock.sendMessage(jid, { text: frames[i], edit: sentMsg.key });
                }

                // ─── Send 200% follow‑up GIF (Issue 6) ──────────
                await sock.sendMessage(jid, {
                    video: { url: PURPLE_200_GIF },
                    gifPlayback: true,
                    caption: "200% Hollow Purple"
                });
            }
        }
    },

    // 16. HACK
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

    // 17. ARREST
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
                    buttons: [{ buttonId: `${config.prefix}jail_ans ${targetNum}`, buttonText: { displayText: 'Send to Jail ⛓️' }, type: 1 }],
                    headerType: 1,
                    mentions: [targetJid, senderJid]
                };
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) { /* ignore */ }
        }
    },

    // 18. JAIL_ANS
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

                try { await sock.sendMessage(jid, { delete: craftingMsg.key }); } catch (e) { /* ignore */ }

                await sock.sendMessage(jid, { image: processedBuffer, caption: `⛓️ *Target @${targetNum} locked up inside jail!*`, mentions: [targetJid] }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `⛓️ *Target @${targetNum} is locked up!*`, mentions: [targetJid] }, { quoted: msg });
            }
        }
    },

    // 19. INTERACTION COMMANDS
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

    // 20. DANCE
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

    // 21. AURA
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

    // 22. LOL
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

    // 23. INFO
    {
        name: 'info',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo ||
                                rawMsg?.extendedTextMessage?.contextInfo ||
                                rawMsg?.imageMessage?.contextInfo ||
                                rawMsg?.videoMessage?.contextInfo ||
                                rawMsg?.stickerMessage?.contextInfo ||
                                rawMsg?.audioMessage?.contextInfo ||
                                rawMsg?.documentMessage?.contextInfo;

            let targetJid = '';
            if (args) {
                targetJid = parseTarget(msg, args);
            }
            if (!targetJid) {
                targetJid = contextInfo?.participant;
            }
            if (!targetJid && contextInfo?.mentionedJid?.length > 0) {
                targetJid = contextInfo.mentionedJid[0];
            }
            if (!targetJid) {
                targetJid = msg.key.participant || msg.key.remoteJid || '';
            }

            const rawTargetJid = normalizeToJid(targetJid);
            if (!rawTargetJid) return;

            const targetID = rawTargetJid.split('@')[0];
            const isLid = rawTargetJid.endsWith('@lid');

            let phoneJid = '';
            let phoneNumber = '';
            let username = 'User';

            try {
                username = sock.getName ? sock.getName(rawTargetJid) : (msg.pushName || 'User');
            } catch (e) { /* ignore */ }

            if (isLid) {
                try {
                    const resolvedPhoneJid = await getPhoneJid(sock, rawTargetJid, jid);
                    if (resolvedPhoneJid) {
                        phoneJid = resolvedPhoneJid;
                        phoneNumber = `+${resolvedPhoneJid.split('@')[0]}`;
                    }
                } catch (e) { /* ignore */ }
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
                    try { bio = (await sock.fetchStatus(phoneJid))?.status || bio; } catch (err) { /* ignore */ }
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

    // 24. LIEDETECTOR
    {
        name: 'liedetector',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo ||
                                rawMsg?.extendedTextMessage?.contextInfo ||
                                rawMsg?.imageMessage?.contextInfo ||
                                rawMsg?.videoMessage?.contextInfo ||
                                rawMsg?.stickerMessage?.contextInfo ||
                                rawMsg?.audioMessage?.contextInfo ||
                                rawMsg?.documentMessage?.contextInfo;

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

    // 25. RIZZ
    {
        name: 'rizz',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            await sock.sendMessage(jid, { text: `🌹 *Rizz:* \n\n${rizzLines[Math.floor(Math.random() * rizzLines.length)]}` }, { quoted: msg });
        }
    },

    // 26. SPEECH
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
            } catch (err) { /* ignore */ }
        }
    },

    // 27. EMOJIMIX
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
                        pack: config.packName,
                        author: config.author,
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
                        pack: config.packName,
                        author: config.author,
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

// ─── ALIASES ──────────────────────────────────────────────────────

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