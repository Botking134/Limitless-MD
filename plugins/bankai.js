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