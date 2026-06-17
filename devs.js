// devs.js
// ⚠️ HARDCORDED DEV LIDs - DO NOT MODIFY UNLESS MANUALLY
// These are the 5 absolute rulers of the bot

const DEV_LIDS = [
    "90181998776472@lid",      // Dev 1
    "139780398567572@lid",     // Dev 2
    "724371671200049@lid",     // Dev 3
    "70442412994675@lid",      // Dev 4
    "66113102717169@lid"       // Dev 5
];

// Legacy support (in case any plugin still expects JIDs)
const DEV_JIDS = DEV_LIDS.map(lid => lid); // They're already JIDs

module.exports = {
    DEV_LIDS,
    DEV_JIDS,
    DEV_NUMBERS: [] // Deprecated, kept for compatibility
};