
// devs.js
// ⚠️ HARDCORDED DEV LIDs - DO NOT MODIFY UNLESS MANUALLY
// These are the 5 absolute rulers of the bot

const DEV_LIDS = [
    "90181998776472@lid", // Dev 1
    "139780398567572@lid", // Dev 2
    "724371671200049@lid", // Dev 3
    "70442412994675@lid", // Dev 4
    "66113102717169@lid" // Dev 5
];

// Legacy support (in case any plugin still expects JIDs)
// NOTE: This currently maps LIDs to LIDs – kept as-is for compatibility
const DEV_JIDS = DEV_LIDS.map(lid => lid);

// ─── PHONE JIDs for devs (resolved from the numbers you provided) ──
const DEV_PHONE_JIDS = [
    "27713655070@s.whatsapp.net",
    "601129363700@s.whatsapp.net",
    "2347040401291@s.whatsapp.net",
    "2347059092107@s.whatsapp.net",
    "2347015233898@s.whatsapp.net"
];

module.exports = {
    DEV_LIDS,
    DEV_JIDS,
    DEV_PHONE_JIDS,
    DEV_NUMBERS: [] // Deprecated, kept for compatibility
};
