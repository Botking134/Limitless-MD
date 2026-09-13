// helpers/SessionManager.js
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { saveState, normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('./Message');

const notesPath = path.join(__dirname, '../storage/notes.json');

// In-memory AFK notice cooldown tracker (1 alert per chat per 60 seconds)
global.afkNoticeCooldowns = global.afkNoticeCooldowns || {};

// ─── NOTES LOCAL STORAGE HELPERS ─────────────────────────────────

function readNotes() {
    try {
        if (fs.existsSync(notesPath)) {
            const rawData = fs.readFileSync(notesPath, 'utf-8');
            return JSON.parse(rawData);
        }
    } catch (e) {
        console.error("⚠️ [NOTES] Parse failed. Backing up corrupted file.");
        try {
            if (fs.existsSync(notesPath)) {
                fs.renameSync(notesPath, notesPath.replace('.json', '.corrupted.json'));
            }
        } catch (backupErr) { /* ignore */ }
    }
    return {};
}

function saveNotes(notes) {
    try {
        const dir = path.dirname(notesPath);