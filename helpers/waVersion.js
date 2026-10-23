// helpers/waVersion.js
//
// Shared lookup for a current WhatsApp Web version, used when creating sockets.
// A stale version makes WhatsApp reject the connection (405), which means no
// pairing code is ever issued. pair.js does this lookup for the main bot;
// this helper lets SubBotManager do the same.

const axios = require('axios');
const config = require('../config');

let cached = null;
let cachedAt = 0;
const CACHE_MS = 6 * 3600 * 1000; // re-check every 6 hours

const fresh = (v) =>
    Array.isArray(v) && v.length === 3 && v.every(Number.isInteger) && v[0] === 2 && v[1] >= 3000;

async function getWaVersion() {
    if (cached && Date.now() - cachedAt < CACHE_MS) return cached;

    // 1) Manual override: env WA_VERSION or config.waVersion, e.g. "2,3000,1043857760"
    const manual = process.env.WA_VERSION || config.waVersion;
    if (manual) {
        const arr = Array.isArray(manual)
            ? manual.map(Number)
            : String(manual).split(/[^0-9]+/).filter(Boolean).map(Number);
        if (fresh(arr)) {
            cached = arr;
            cachedAt = Date.now();
            return arr;
        }
    }

    // 2) Version published in the WhiskeySockets repo
    try {
        const res = await axios.get(
            'https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/index.ts',
            { timeout: 10000, responseType: 'text', transformResponse: [(d) => d] }
        );
        const m = String(res.data).match(/version\s*[:=]\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);
        const v = m && [Number(m[1]), Number(m[2]), Number(m[3])];
        if (fresh(v)) {
            cached = v;
            cachedAt = Date.now();
            return v;
        }
    } catch (e) {
        console.log('⚠️ [WA VERSION] Lookup failed:', e.message);
    }

    // null = let the library use its built-in default
    return null;
}

module.exports = { getWaVersion };
