// config.js
require('dotenv').config(); // ← Load .env FIRST

module.exports = {

    // ================================================================
    // 🔑 1. ENVIRONMENT VARIABLES (from .env)
    //    These are the source of truth for API keys and owner details.
    // ================================================================

    ownerNumber: process.env.OWNER_NUMBER || "601129363700",
    ownerName: process.env.OWNER_NAME || "Infinity",
    botName: process.env.BOT_NAME || "Limitless",
    sessionId: process.env.SESSION_ID || "",

    // API Keys
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    groqApiKey: process.env.GROQ_API_KEY || "",
    githubToken: process.env.GITHUB_TOKEN || "",
    klipyApiKey: process.env.KLIPY_API_KEY || "",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",

    // ================================================================
    // ⚙️ 2. DYNAMIC BEHAVIOR VARS (from .env, overwritten by vars.json)
    //    These are the defaults if vars.json doesn't exist.
    // ================================================================

    prefix: process.env.PREFIX || "⚡",
    vvs: process.env.VVS || "wow",
    packName: process.env.PACK_NAME || "♾️",
    author: process.env.AUTHOR || "Infinity",
    menuImage: process.env.MENU_IMAGE ? process.env.MENU_IMAGE.split(',') : null,
    warnThreshold: parseInt(process.env.WARN_THRESHOLD) || 5,
    presenceMode: process.env.PRESENCE_MODE || null,
    isPublic: process.env.IS_PUBLIC === 'true' ? true : false,
    autoReact: process.env.AUTO_REACT || "off",
    antipm: process.env.ANTIPM || "off",

    // Chats (comma-separated strings from .env)
    lizzyChats: process.env.LIZZY_CHATS ? process.env.LIZZY_CHATS.split(',') : [],
    chatbotChats: process.env.CHATBOT_CHATS ? process.env.CHATBOT_CHATS.split(',') : [],
    fridayChats: process.env.FRIDAY_CHATS ? process.env.FRIDAY_CHATS.split(',') : [],
    gojoSleepChats: process.env.GOJO_SLEEP_CHATS ? process.env.GOJO_SLEEP_CHATS.split(',') : [],
    gojoGlobalSleep: process.env.GOJO_GLOBAL_SLEEP === 'true' ? true : false,

    // ================================================================
    // 🧬 3. OTHER CONFIG OBJECTS (still in memory, saved via state.json)
    //    These are not loaded from .env – they are set via commands.
    // ================================================================

    antilink: {},
    antitag: {},
    antibot: {},
    antispam: {},
    antigm: {},
    antigcstatus: "off",
    antipromote: {},
    antidemote: {},
    stickerCommands: {},
    welcome: {},
    goodbye: {},
    gcalerts: { promote: {}, demote: {}, welcome: {}, goodbye: {} },
    presence: {
        autotyping: { all: false, chats: [] },
        autorecording: { all: false, chats: [] },
        alwaysonline: { all: false, chats: [] },
        autoread: { all: false, chats: [] }
    },

    // ================================================================
    // 👑 4. PERMISSION LISTS (loaded from state.json)
    // ================================================================

    secondaryOwners: [],
    sudos: [],
    banned: [],
    warns: {},
    conversationLogs: {},
    gclogActive: {},
    aza: { set: false },

    // ================================================================
    // 📦 5. STATIC DEFAULTS
    // ================================================================

    defaultWelcome: "🔮 *DOMAIN EXPANSION: NEW INTRUDER* 🔮\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👋 Welcome @user to *{group}*!\n\n📝 *Bio:* \"{bio}\"\n🛡️ *Status:* Standard Sorcerer\n\n🤞 _\"I hope you can handle the gravity of this void. Follow the rules, or you will be exorcised!\"_",

    // ================================================================
    // 🏃 6. RUNTIME POPULATED (set by pair.js / stateManager)
    // ================================================================

    ownerJid: "",
    ownerLid: "",
    ownerLids: [],
    devLids: [],
    sudoLids: [],
    botJid: "",
    botLid: ""
};