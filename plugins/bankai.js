// plugins/bankai.js – .bankai <query> with Groq abilities
const config = require('../config');
const axios = require('axios');

// ─── GROQ KEY (single source of truth: config.js) ─────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || config.groqApiKey;
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