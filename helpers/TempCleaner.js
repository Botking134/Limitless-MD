// helpers/TempCleaner.js
//
// index.js points the temp folder at storage/temp so conversions don't use the small system /tmp.
// Nothing ever emptied it, though: a conversion that crashed, timed out or was killed left its
// files behind, and over weeks that fills the disk ("No space left on device").
// This sweeps files older than a limit, once at startup (nothing can be in use yet) and then
// every 10 minutes.

const fs = require('fs');
const path = require('path');

function sweep(dir, maxAgeMs) {
    let removed = 0;
    let freed = 0;
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (e) { return { removed, freed }; }
    const now = Date.now();
    for (const name of entries) {
        const full = path.join(dir, name);
        try {
            const st = fs.lstatSync(full);
            if (now - st.mtimeMs < maxAgeMs) continue;
            freed += st.isDirectory() ? dirSize(full) : st.size;
            fs.rmSync(full, { recursive: true, force: true });
            removed++;
        } catch (e) { /* in use or already gone: skip */ }
    }
    return { removed, freed };
}

function dirSize(dir) {
    let total = 0;
    try {
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            const st = fs.lstatSync(full);
            total += st.isDirectory() ? dirSize(full) : st.size;
        }
    } catch (e) { /* ignore */ }
    return total;
}

function start(dir) {
    const first = sweep(dir, 60 * 1000);
    if (first.removed) console.log(`🧹 [TEMP] Removed ${first.removed} leftover temp item(s), freed ${(first.freed / 1048576).toFixed(1)} MB`);
    const timer = setInterval(() => sweep(dir, 20 * 60 * 1000), 10 * 60 * 1000);
    if (timer.unref) timer.unref();
}

module.exports = { start, sweep, dirSize };
