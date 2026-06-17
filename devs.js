// devs.js
// ⚠️ HARDCORDED DEV NUMBERS - DO NOT MODIFY UNLESS MANUALLY
// These are the 5 absolute rulers of the bot

const DEV_NUMBERS = [
    "27713655070",        // Dev 1
    "601129363700",       // Dev 2
    "2347059092107",      // Dev 3
    "2347040401291",      // Dev 4
    "2347015233898"        // Dev 5 (REPLACE WITH ACTUAL)
];

// Generate JIDs from numbers
const DEV_JIDS = DEV_NUMBERS.map(num => `${num}@s.whatsapp.net`);

module.exports = {
    DEV_NUMBERS,
    DEV_JIDS,
    // LIDs will be resolved at runtime and stored here
    DEV_LIDS: []
};