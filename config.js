// config.js

module.exports = {

    // ================================================================
    // 🔑 1. PRIMARY OWNER & BOT INFO (Hardcoded)
    // ================================================================

    ownerNumber: "601129363700",
    ownerName: "Infinity",
    botName: "Limitless",
    sessionId: "",

    // ================================================================
    // 🔑 2. API KEYS (Hardcoded – replace with your actual keys)
    // ================================================================

    geminiApiKey: "your_gemini_api_key_here",
    groqApiKey: "your_groq_api_key_here",
    githubToken: "your_github_token_here",
    klipyApiKey: "",
    telegramBotToken: "",

    // ================================================================
    // ⚙️ 3. DYNAMIC BEHAVIOR VARS (fallbacks – overridden by vars.json)
    // ================================================================

    prefix: "⚡",
    vvs: "wow",
    packName: "♾️",
    author: "Infinity",
    menuImage: null,
    warnThreshold: 5,
    presenceMode: null,
    isPublic: false,
    autoReact: "cmd",
    antipm: "off",

    // Chats
    lizzyChats: [],
    chatbotChats: [],
    fridayChats: [],
    gojoSleepChats: [],
    gojoGlobalSleep: false,

    // ================================================================
    // 🧬 4. GROUP PROTECTIONS (persisted via vars.json)
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
    // 👑 5. PERMISSION LISTS (loaded from state.json)
    // ================================================================

    secondaryOwners: [],
    sudos: [],
    banned: [],
    warns: {},
    conversationLogs: {},
    gclogActive: {},
    aza: { set: false },

    // ================================================================
    // 📦 6. STATIC DEFAULTS
    // ================================================================

    defaultWelcome: "🔮 *DOMAIN EXPANSION: NEW INTRUDER* 🔮\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👋 Welcome @user to *{group}*!\n\n📝 *Bio:* \"{bio}\"\n🛡️ *Status:* Standard Sorcerer\n\n🤞 _\"I hope you can handle the gravity of this void. Follow the rules, or you will be exorcised!\"_",

    // ================================================================
    // 🏃 7. RUNTIME POPULATED (set by pair.js / stateManager)
    // ================================================================

    ownerJid: "",
    ownerLid: "",
    ownerLids: [],
    devLids: [],
    sudoLids: [],
    botJid: "",
    botLid: ""
};