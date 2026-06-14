// settings.js

module.exports = {
    "sessionId": process.env.SESSION_ID || "",
    "botName": process.env.BOT_NAME || "Limitless",
    "ownerName": process.env.OWNER_NAME || "Infinity",
    "prefix": process.env.PREFIX || "⚡",
    "packName": "♾️",
    "author": "Infinity",
    "isPublic": false,
    "ownerNumber": process.env.OWNER_NUMBER || "601129363700",
    "ownerJid": "601129363700@s.whatsapp.net",
    
    // LID config additions for permission handling
    "ownerLid": "",
    "ownerLids": [],
    "sudoLids": [],
    "devLids": [],

    "owners": [],
    "sudo": [
        "27713655070@s.whatsapp.net"
    ],
    "banned": [],
    "lizzyChats": [
        "120363403985474589@g.us"
    ],
    "chatbotChats": [],
    "autoReact": "off",
    "antilink": {
        "120363403985474589@g.us": "delete"
    },
    "antitag": {
        "120363403985474589@g.us": "on"
    },
    "antibot": {},
    "warns": {},
    "stickerCommands": {},
    // API Keys loaded securely from environmental variables
    "geminiApiKey": process.env.GEMINI_API_KEY || "YOUR_KEY_HERE",
    "groqApiKey": process.env.GROQ_API_KEY || "",
    "githubToken": process.env.GITHUB_TOKEN || "",
    "klipyApiKey": process.env.KLIPY_API_KEY || "YOUR_KEY_HERE",
    // Persistent parameters
    "vvEmoji": "🥷",
    "antipm": "off",
    "antispam": {},
    "gojoSleepChats": [],
    
    // Conversation logging parameters for Satoru Gojo Summaries (.gclog)
    "gclogActive": {},
    "conversationLogs": {},

    // Default Gojo-Themed Welcome Template
    "defaultWelcome": "🔮 *DOMAIN EXPANSION: NEW INTRUDER* 🔮\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👋 Welcome @user to *{group}*!\n\n📝 *Bio:* \"{bio}\"\n🛡️ *Status:* Standard Sorcerer\n\n🤞 _\"I hope you can handle the gravity of this void. Follow the rules, or you will be exorcised!\"_"
};