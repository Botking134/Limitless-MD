// plugins/bankai.js – .bankai <query> with Groq abilities
const config = require('../config');
const axios = require('axios');

// ─── OBFUSCATED GROQ KEY (with environment fallbacks) ─────────
const I = 'gsk_';
const love = 'Pq0ezrYKQNlr77fmp7b';
const lizzy = 'iWGdyb3FYjuaKTR64bSbIHjLeRxGeL9yw';
const GROQ_API_KEY = process.env.GROQ_API_KEY || config.GROQ_API_KEY || (I + love + lizzy);
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

// ─── BANKAI LIST ──────────────────────────────────────────────────
const BANKAI_LIST = [
    {
        name: 'Genryūsai Shigekuni Yamamoto',
        bankai: 'Zanka no Tachi (East / West / South / North)',
        images: ['https://files.catbox.moe/8kl56c.jpg']
    },
    {
        name: 'Soifon',
        bankai: 'Jakuho Raikōben',
        images: ['https://files.catbox.moe/c92pzb.jpg']
    },
    {
        name: 'Gin Ichimaru',
        bankai: 'Kamishini no Yari',
        images: ['https://files.catbox.moe/jl5xxp.jpg']
    },
    {
        name: 'Retsu Unohana',
        bankai: 'Minazuki',
        images: ['https://files.catbox.moe/5mpn2v.jpg', 'https://files.catbox.moe/a9rlna.jpg']
    },
    {
        name: 'Sōsuke Aizen',
        bankai: '404 error (Too powerful for a bankai)',
        images: ['https://files.catbox.moe/z7cmvo.jpg']
    },
    {
        name: 'Byakuya Kuchiki',
        bankai: 'Senbonzakura Kageyoshi (Senkei / Gōkei / Shūkei: Hakuteiken)',
        images: ['https://files.catbox.moe/to976z.jpg']
    },
    {
        name: 'Sajin Komamura',
        bankai: 'Kokujō Tengen Myō‘ō → Kokujō Tengen Myō‘ō: Dangai Jōe',
        images: ['https://files.catbox.moe/57kq5e.jpg']
    },
    {
        name: 'Shunsui Kyōraku',
        bankai: 'Katen Kyōkotsu: Kuromatsu Shinjū',
        images: ['https://files.catbox.moe/bz10zs.jpg']
    },
    {
        name: 'Kaname Tōsen',
        bankai: 'Suzumushi Tsuishiki: Enma Kōrogi',
        images: ['https://files.catbox.moe/bvvio3.jpg']
    },
    {
        name: 'Tōshirō Hitsugaya',
        bankai: 'Daiguren Hyōrinmaru (true completed form)',
        images: ['https://files.catbox.moe/3jj9h0.jpg']
    },
    {
        name: 'Kenpachi Zaraki',
        bankai: 'Unnamed (spirit: Nozarashi)',
        images: ['https://files.catbox.moe/2i6zn8.webp']
    },
    {
        name: 'Mayuri Kurotsuchi',
        bankai: 'Konjiki Ashisogi Jizō → Konjiki Ashisogi Jizō: Matai Fukuin Shōtai',
        images: ['https://files.catbox.moe/96uxvl.jpg', 'https://files.catbox.moe/0l9srs.jpg']
    },
    {
        name: 'Jūshirō Ukitake',
        bankai: 'Unknown (never revealed)',
        images: ['https://files.catbox.moe/40iaz9.jpeg']
    },
    {
        name: 'Rukia Kuchiki',
        bankai: 'Hakka no Togame',
        images: ['https://files.catbox.moe/tdn94f.jpg']
    },
    {
        name: 'Ikkaku Madarame',
        bankai: 'Ryūmon Hōzukimaru',
        images: ['https://files.catbox.moe/e4ksn1.jpg']
    },
    {
        name: 'Chōjirō Sasakibe',
        bankai: 'Kōkō Gonryō Rikyū',
        images: ['https://files.catbox.moe/08snw1.jpg']
    },
    {
        name: 'Rōjūrō Ōtoribashi (Rose)',
        bankai: 'Kinshara Butōdan',
        images: ['https://files.catbox.moe/avnjtp.jpeg']
    },
    {
        name: 'Kensei Muguruma',
        bankai: 'Tekken Tachikaze',
        images: ['https://files.catbox.moe/b9w3wg.jpg', 'https://files.catbox.moe/a58fhp.jpg']
    },
    {
        name: 'Shinji Hirako',
        bankai: 'Sakasama Yokoshima Happō Fusagari (CFYOW novel)',
        images: ['https://files.catbox.moe/7ljeh0.jpg', 'https://files.catbox.moe/6717wl.jpg']
    },
    {
        name: 'Shūhei Hisagi',
        bankai: 'Fushi no Kōjō (CFYOW novel)',
        images: ['https://files.catbox.moe/k24my3.jpeg']
    },
    {
        name: 'Senjumaru Shutara',
        bankai: 'Shatatsu Karagara Shigarami no Summary',
        images: ['https://files.catbox.moe/j7j6n9.jpeg']
    },
    {
        name: 'Ichibē Hyōsube',
        bankai: 'Shin‘uchi: Shirafude Ichimonji (Bankai equivalent)',
        images: ['https://files.catbox.moe/k76wq7.jpeg']
    },
    {
        name: 'Ichigo Kurosaki',
        bankai: 'Tensa Zangetsu → True Tensa Zangetsu',
        images: [
            'https://files.catbox.moe/3o05ff.jpg',
            'https://files.catbox.moe/cwr9ii.jpg',
            'https://files.catbox.moe/qc9vzm.jpeg',
            'https://files.catbox.moe/i5en66.jpeg'
        ]
    },
    {
        name: 'Kūgo Ginjō',
        bankai: 'Unnamed',
        images: ['https://files.catbox.moe/au1qw3.jpeg']
    },
    {
        name: 'Renji Abarai',
        bankai: 'Hihiō Zabimaru → Sōō Zabimaru (true Bankai)',
        images: ['https://files.catbox.moe/e0o09x.jpg', 'https://files.catbox.moe/fdcp7b.jpg']
    },
    {
        name: 'Kisuke Urahara',
        bankai: 'Kannonbiraki Benihime Aratame',
        images: ['https://files.catbox.moe/8etzbd.jpg', 'https://files.catbox.moe/6wr9tj.jpeg']
    },
    {
        name: 'Sōya Azashiro (8th Kenpachi)',
        bankai: 'Urozakuro (SAFWY novel)',
        images: ['https://files.catbox.moe/wuruer.webp']
    },
    {
        name: 'Kenpachi Kuruyashiki (7th Kenpachi)',
        bankai: 'Gagaku Kairō (SAFWY)',
        images: ['https://files.catbox.moe/xvpysl.webp']
    }
];

// ─── HELPERS ──────────────────────────────────────────────────────

const imageCache = {};

async function getImageBuffer(url) {
    if (imageCache[url]) return imageCache[url];

    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}`;

    try {
        const response = await axios.get(proxyUrl, { 
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });
        
        const buffer = Buffer.from(response.data);
        if (buffer && buffer.length > 0) {
            imageCache[url] = buffer;
            return buffer;
        }
        return null;
    } catch (err) {
        console.error(`[Bankai Plugin] Failed to fetch image via proxy: ${url}`, err.message);
        return null;
    }
}

function levenshteinDistance(str1, str2) {
    const track = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    for (let i = 0; i <= str1.length; i += 1) track[0][i] = i;
    for (let j = 0; j <= str2.length; j += 1) track[j][0] = j;
    for (let j = 1; j <= str2.length; j += 1) {
        for (let i = 1; i <= str1.length; i += 1) {
            const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
            track[j][i] = Math.min(
                track[j][i - 1] + 1,
                track[j - 1][i] + 1,
                track[j - 1][i - 1] + indicator
            );
        }
    }
    return track[str2.length][str1.length];
}

function searchBankaiMultiple(query) {
    const q = query.toLowerCase().trim();
    
    // Phase 1: Substring Matches Only
    const exactMatches = [];
    for (const entry of BANKAI_LIST) {
        const name = entry.name.toLowerCase();
        const bankai = entry.bankai.toLowerCase();

        if (name.includes(q) || bankai.includes(q)) {
            exactMatches.push(entry);
        }
    }

    // If matches are found in Phase 1, return them immediately (skips Phase 2)
    if (exactMatches.length > 0) {
        return exactMatches;
    }

    // Phase 2: Tightened Fuzzy Matching (Fallback)
    const fuzzyMatches = [];
    for (const entry of BANKAI_LIST) {
        const name = entry.name.toLowerCase();
        const bankai = entry.bankai.toLowerCase();

        const distName = levenshteinDistance(q, name);
        const distBankai = levenshteinDistance(q, bankai);
        const minDist = Math.min(distName, distBankai);

        // Max distance is scaled based on query length (1 for short queries, 2 for longer ones)
        const maxDistance = q.length <= 3 ? 1 : 2;
        if (minDist <= maxDistance) {
            fuzzyMatches.push({ entry, dist: minDist });
        }
    }

    fuzzyMatches.sort((a, b) => a.dist - b.dist);
    return fuzzyMatches.map(match => match.entry);
}

async function getBankaiAbility(name, bankai) {
    if (bankai.includes('404 error')) {
        return 'This Bankai is beyond description.';
    }
    if (bankai.toLowerCase().includes('unknown') || bankai.toLowerCase().includes('unnamed')) {
        return 'No known abilities are recorded for this Bankai.';
    }

    try {
        const prompt =
            `Describe the abilities of the Bankai "${bankai}" from the anime Bleach, used by the character "${name}". Provide a detailed and structured explanation of its powers, effects, and any notable techniques. 
            
            CRITICAL FORMATTING RULES:
            1. The response must be structured strictly using line breaks into short, readable lines or small bullet points.
            2. The total length of your output must be exactly between 5 and 8 lines of text (including blank lines if used for spacing).
            3. Do not include any introductory or concluding remarks, just the formatted lines describing the abilities.`;

        const response = await axios.post(GROQ_BASE_URL, {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are a knowledgeable Bleach lore expert. You strictly adhere to line count and formatting requirements." },
                { role: "user", content: prompt }
            ],
            temperature: 0.5,
            max_tokens: 300
        }, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            }
        });

        let text = response.data?.choices?.[0]?.message?.content || '';
        if (text.length > 800) text = text.slice(0, 797) + '...';
        return text.trim() || 'Abilities are unknown.';
    } catch (err) {
        console.error('Groq error:', err.message);
        return 'Could not retrieve abilities.';
    }
}

async function showBankai(sock, msg, entry) {
    const jid = msg.key.remoteJid;

    const imageUrl = entry.images[Math.floor(Math.random() * entry.images.length)];
    const imageBuffer = await getImageBuffer(imageUrl);

    const ability = await getBankaiAbility(entry.name, entry.bankai);

    const caption =
        `══ ══ ═══════ ═════ ══\n` +
        `        Ｂ Ａ Ｎ Ｋ Ａ Ｉ\n` +
        `        ${entry.bankai}\n` +
        `══ ══ ═══════ ═════ ══\n` +
        `⚔️ ${entry.name}\n\n` +
        `${ability}`;

    if (imageBuffer && imageBuffer.length > 0) {
        const fileExt = imageUrl.split('.').pop().toLowerCase();
        const mimeType = fileExt === 'webp' ? 'image/webp' : (fileExt === 'png' ? 'image/png' : 'image/jpeg');

        await sock.sendMessage(jid, {
            image: imageBuffer,
            mimetype: mimeType,
            caption: caption
        }, { quoted: msg });
    } else {
        await sock.sendMessage(jid, {
            text: `${caption}\n\n*[Image failed to load: ${imageUrl}]*`
        }, { quoted: msg });
    }
}

// ─── COMMANDS ─────────────────────────────────────────────────────

module.exports = [
    {
        name: 'bankai',
        isPrefixless: false,
        execute: async (sock, msg, args, { isMaster }) => {
            const jid = msg.key.remoteJid;

            if (!isMaster) {
                return await sock.sendMessage(jid, { text: "❌ Only the master can use this command." }, { quoted: msg });
            }

            if (!args || args.length === 0) {
                const randomEntry = BANKAI_LIST[Math.floor(Math.random() * BANKAI_LIST.length)];
                await showBankai(sock, msg, randomEntry);
                return;
            }

            const query = args.join(' ');
            const results = searchBankaiMultiple(query);

            if (results.length === 0) {
                return await sock.sendMessage(jid, {
                    text: `❌ No Bankai found for '${query}'. Try a different name.`
                }, { quoted: msg });
            }

            if (results.length === 1) {
                await showBankai(sock, msg, results[0]);
                return;
            }

            let selectionText = `🔍 *Multiple matches found for "${query}":*\n\n`;
            results.forEach((entry, idx) => {
                selectionText += `${idx + 1}. ${entry.name} (${entry.bankai.split(' →')[0]})\n`;
            });
            selectionText += `\n_Reply to this message with the number of your choice._`;

            const sentMsg = await sock.sendMessage(jid, { text: selectionText }, { quoted: msg });

            if (!global.bankaiSessions) {
                global.bankaiSessions = {};
            }

            const expiryLimit = Date.now() - 5 * 60 * 1000;
            for (const key in global.bankaiSessions) {
                if (global.bankaiSessions[key].timestamp < expiryLimit) {
                    delete global.bankaiSessions[key];
                }
            }

            const messageId = sentMsg.key.id;
            global.bankaiSessions[messageId] = {
                results: results,
                timestamp: Date.now()
            };
        }
    }
];

// ─── SELECTION HANDLER (for menu triggers) ──────────────────────
async function handleBankaiSelection(sock, msg) {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo;
    if (!quotedMsg || !quotedMsg.quotedMessage) return false;

    const quotedId = quotedMsg.stanzaId;
    const session = global.bankaiSessions?.[quotedId];
    if (!session) return false;

    const replyText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const num = parseInt(replyText.trim());
    if (isNaN(num) || num < 1 || num > session.results.length) {
        await sock.sendMessage(msg.key.remoteJid, {
            text: `❌ Invalid selection. Please choose a number between 1 and ${session.results.length}.`
        }, { quoted: msg });
        return true;
    }

    const selected = session.results[num - 1];
    delete global.bankaiSessions[quotedId];
    await showBankai(sock, msg, selected);
    return true;
}

module.exports.handleBankaiSelection = handleBankaiSelection;