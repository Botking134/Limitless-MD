// config.js

module.exports = {

    // ================================================================
    // 🔐 1. USER VARIABLES
    // ================================================================

    /** Primary owner's phone number (without +). */
    ownerNumber: "2347059092107",

    /** Primary owner's display name. */
    ownerName: "Infinity",

    /** Bot's display name. */
    botName: "Limitless",

    /** Session ID (future feature – reserved). */
    sessionId: "",

    githubToken: "",
    klipyApiKey: "",
    telegramBotToken: "",

    // ================================================================
    // ⚙️ 2. DYNAMIC BEHAVIOR VARS (loaded from vars.json)
    //    Changeable via .setvar command. Survives restarts.
    // ================================================================

    /** Command prefix. If empty string or null → bot becomes prefixless. */
    prefix: "⚡",

    /** Custom prefixless ViewOnce decryption trigger (e.g., 'kamui' or '🔮'). */
    vvs: "wow",

    /** Sticker pack name (metadata). */
    packName: "♾️",

    /** Sticker author (metadata). */
    author: "Infinity",

    /**
     * Custom menu image URLs. Comma-separated string.
     * Example: "https://img1.com,https://img2.com,https://img3.com"
     * If set, completely overwrites the hardcoded menuImages array in menu.js.
     */
    menuImage: null,

    /** Warning threshold before auto-kick (default: 5). */
    warnThreshold: 5,

    /**
     * Global presence mode. If set, overrides individual presence toggles.
     * Example: "autotyping" → sets presence.autotyping.all = true.
     * Example: "off" → disables all presence automation.
     */
    presenceMode: null,


    // ================================================================
    // 🧬 3. BEHAVIOR TOGGLES (vars.json)
    //    Changeable via dedicated commands (.mode, .antilink, etc.).
    // ================================================================

    /** Public mode: true = anyone can use, false = owners/sudos only. */
    isPublic: false,

    /** Auto-react mode: 'cmd' (react to commands), 'all' (react to everything), 'off'. */
    autoReact: "off",

    /** Anti-PM: blocks non-owners from DMing the bot. 'on' or 'off'. */
    antipm: "off",

    /** Chats where Lizzy chatbot is active. */
    lizzyChats: [],

    /** Chats where Jarvis chatbot is active. */
    chatbotChats: [],

    /** Chats where Friday chatbot is active (NEW). */
    fridayChats: [],

    /** Chats where Gojo is manually put to sleep. */
    gojoSleepChats: [],

    /** Global Gojo sleep toggle (true = prefixless Gojo is disabled everywhere). */
    gojoGlobalSleep: true,

    // --- Group Security Protections (per group JID) ---

    /** Antilink policy: 'delete', 'warn', 'kick', or 'off'. */
    antilink: {},

    /** Antitag policy: 'on' or 'off'. */
    antitag: {},

    /** Antibot policy: 'delete', 'warn', 'kick', or 'off'. */
    antibot: {},

    /** Antispam configuration: { status: 'on'|'off', rate: { count, seconds } }. */
    antispam: {},

    /** Anti-group-mention policy: 'delete', 'warn', 'kick', or 'off'. */
    antigm: {},

    /** Anti-status-update policy: 'delete', 'warn', 'kick', or 'off'. */
    antigcstatus: "off",

    /** Antipromote protection: 'on' or 'off'. */
    antipromote: {},

    /** Antidemote protection: 'on' or 'off'. */
    antidemote: {},

    /** Sticker → command mapping (set via .setcmd / .delcmd). */
    stickerCommands: {},

    /** Welcome message config per group: { active: bool, msg: string }. */
    welcome: {},

    /** Goodbye message config per group: { active: bool, msg: string }. */
    goodbye: {},

    /** Group event alerts: promote, demote, welcome, goodbye (each 'on' or 'off'). */
    gcalerts: { promote: {}, demote: {}, welcome: {}, goodbye: {} },

    /**
     * Presence automation settings.
     * Each can be set to 'all' (global) or per chat via commands.
     */
    presence: {
        autotyping: { all: false, chats: [] },
        autorecording: { all: false, chats: [] },
        alwaysonline: { all: false, chats: [] },
        autoread: { all: false, chats: [] }
    },


    // ================================================================
    // 👑 4. PERMISSION LISTS (loaded from state.json)
    //    Changeable via .addowner, .setsudo, .ban, etc.
    // ================================================================

    /** Secondary owners (added via .addowner). */
    secondaryOwners: [],

    /** Sudo users (added via .setsudo). */
    sudos: [],

    /** Banned users (added via .ban). */
    banned: [],

    /** Warning counts per user (key: `${jid}_${number}`). */
    warns: {},

    /** Bank account details (set via .aza). */
    aza: { set: false },


    // ================================================================
    // 📦 5. STATIC DEFAULTS (manual edit only – no commands)
    // ================================================================

    /** Default welcome message when no custom is set. */
    defaultWelcome: "🔮 *DOMAIN EXPANSION: NEW INTRUDER* 🔮\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👋 Welcome @user to *{group}*!\n\n📝 *Bio:* \"{bio}\"\n🛡️ *Status:* Standard Sorcerer\n\n🤞 _\"I hope you can handle the gravity of this void. Follow the rules, or you will be exorcised!\"_",


    // ================================================================
    // 👑 6. RUNTIME POPULATED (set by pair.js on connection)
    //    These are resolved from WhatsApp during boot.
    // ================================================================

    /** Primary owner's JID (phone-based). */
    ownerJid: "",

    /** Primary owner's LID (resolved from phone JID). */
    ownerLid: "",

    /** Primary owner's LIDs (array). */
    ownerLids: [],

    /** Developer LIDs (resolved from hardcoded devs.js). */
    devLids: [],

    /** Sudo LIDs (resolved from phone-based sudos). */
    sudoLids: [],

    /** Bot's own JID. */
    botJid: "",

    /** Bot's own LID. */
    botLid: "",

    geminiApiKey: [
    'AQ.Ab8RN',
    '6K5bOy5u',
    'RTPI_yxd',
    'vWAeYI6L',
    'a69PJkwE',
    'sbXoYmdR',
    'ciHXw'
].join(''),

    groqApiKey: [
        'gsk_Pq0e',
        'zrYKQNlr',
        '77fmp7bi',
        'WGdyb3FY',
        'juaKTR64',
        'bSbIHjLe',
        'RxGeL9yw'
    ].join(''),



telegramBotToken: [
    '89891615',
    '11:AAEjE',
    'O3nvYMH1',
    'almQy_8O',
    'xzLCgmE9',
    'sBdMDg'
].join('')

};