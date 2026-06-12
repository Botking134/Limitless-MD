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
    "klipyApiKey": process.env.KLIPY_API_KEY || "EJp0obDxHHa1J9l8as9wyBl0HLiLhbxeBT4wmAgJhzJt2R6pB00iHkOZXylY9pT8",
    // Persistent parameters
    "vvEmoji": "🥷",
    "antipm": "off",
    "antispam": {},
    "gojoSleepChats": []
};