// helpers/WelcomeCardManager.js
//
// Generates the constant welcome/goodbye card image (profile picture +
// username baked into a graphic via sharp) and the accompanying caption
// text. The image is always sent; only the caption's message line is
// configurable via .setwelcome / .setgoodbye.

const axios = require('axios');
const sharp = require('sharp');

const WIDTH = 1000;
const HEIGHT = 560;
const AVATAR_SIZE = 220;

const THEMES = {
    welcome: { top: '#0f2027', bottom: '#2c5364', accent: '#4ADE80', label: 'WELCOME' },
    goodbye: { top: '#232526', bottom: '#414345', accent: '#F87171', label: 'GOODBYE' }
};

function escapeXml(str) {
    return String(str || '').replace(/[&<>'"]/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;'
    }[c]));
}

const AVATAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const avatarCache = new Map(); // jid -> { buffer, expiresAt }

async function fetchAvatarBuffer(sock, jid) {
    try {
        let url;
        try {
            url = await sock.profilePictureUrl(jid, 'image');
        } catch (e) {
            url = await sock.profilePictureUrl(jid, 'preview');
        }
        if (!url) return null;

        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
        return Buffer.from(res.data);
    } catch (e) {
        return null;
    }
}

function defaultAvatarSvg() {
    // Generic silhouette used when a profile picture can't be fetched
    // (privacy settings, no picture set, resolution failure, etc.)
    return Buffer.from(`
        <svg width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#555b6e"/>
            <circle cx="${AVATAR_SIZE / 2}" cy="${AVATAR_SIZE * 0.38}" r="${AVATAR_SIZE * 0.22}" fill="#cfd3e0"/>
            <ellipse cx="${AVATAR_SIZE / 2}" cy="${AVATAR_SIZE * 0.92}" rx="${AVATAR_SIZE * 0.34}" ry="${AVATAR_SIZE * 0.30}" fill="#cfd3e0"/>
        </svg>
    `);
}

async function buildCircularAvatar(sock, jid) {
    const cached = avatarCache.get(jid);
    let raw;
    if (cached && cached.expiresAt > Date.now()) {
        raw = cached.buffer;
    } else {
        raw = (await fetchAvatarBuffer(sock, jid)) || (await sharp(defaultAvatarSvg()).png().toBuffer());
        avatarCache.set(jid, { buffer: raw, expiresAt: Date.now() + AVATAR_CACHE_TTL_MS });
    }

    const circleMask = Buffer.from(
        `<svg width="${AVATAR_SIZE}" height="${AVATAR_SIZE}"><circle cx="${AVATAR_SIZE / 2}" cy="${AVATAR_SIZE / 2}" r="${AVATAR_SIZE / 2}" fill="#fff"/></svg>`
    );

    const resized = await sharp(raw).resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }).toBuffer();

    return sharp(resized)
        .composite([{ input: circleMask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

/**
 * Generates the card image. `type` is 'welcome' | 'goodbye'.
 * Returns a PNG buffer.
 */
async function generateMemberCard(sock, { type, targetJid, displayName, groupName, memberCount }) {
    const theme = THEMES[type] || THEMES.welcome;
    const avatarBuffer = await buildCircularAvatar(sock, targetJid);

    const bgSvg = Buffer.from(`
        <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${theme.top}"/>
                    <stop offset="100%" stop-color="${theme.bottom}"/>
                </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#bg)"/>
            <circle cx="${WIDTH - 80}" cy="80" r="160" fill="${theme.accent}" opacity="0.12"/>
            <circle cx="80" cy="${HEIGHT - 60}" r="120" fill="${theme.accent}" opacity="0.10"/>
            <rect x="0" y="${HEIGHT - 130}" width="100%" height="130" fill="#000000" opacity="0.25"/>
        </svg>
    `);

    // Avatar sits on the left; the text block sits to its right.
    const avatarX = 80;
    const avatarY = Math.round((HEIGHT - AVATAR_SIZE) / 2) - 20;

    const finalTextSvg = Buffer.from(`
        <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
            <style>
                .label { font-family: 'Arial Black', Arial, sans-serif; font-weight: 900; font-size: 54px; fill: ${theme.accent}; letter-spacing: 6px; }
                .name { font-family: Arial, sans-serif; font-weight: bold; font-size: 46px; fill: #ffffff; }
                .group { font-family: Arial, sans-serif; font-size: 30px; fill: #e5e7eb; }
                .count { font-family: Arial, sans-serif; font-size: 26px; fill: #b8bfd1; }
            </style>
            <text x="${avatarX + AVATAR_SIZE + 60}" y="220" class="label">${theme.label}</text>
            <text x="${avatarX + AVATAR_SIZE + 60}" y="290" class="name">${escapeXml(displayName)}</text>
            <text x="${avatarX + AVATAR_SIZE + 60}" y="335" class="group">${escapeXml(groupName)}</text>
            <text x="${avatarX + AVATAR_SIZE + 60}" y="378" class="count">Members now: ${memberCount}</text>
        </svg>
    `);

    return sharp(bgSvg)
        .composite([
            { input: finalTextSvg, top: 0, left: 0 },
            { input: avatarBuffer, top: avatarY, left: avatarX }
        ])
        .jpeg({ quality: 90 })
        .toBuffer();
}

/**
 * Builds the caption text. `extra.activityPercent` is only meaningful for goodbye cards.
 */
function buildCaption({ type, phoneNumber, groupName, memberCount, customMessage, activityPercent }) {
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: true, day: 'numeric', month: 'short', year: 'numeric' });

    if (type === 'welcome') {
        const msg = (customMessage || `Welcome @user to *${groupName}*! Glad to have you. 🌸`)
            .replace(/@user/g, `@${phoneNumber}`)
            .replace(/@group/g, groupName);

        return `👋 *NEW MEMBER JOINED*\n━━━━━━━━━━━━━━━━━━━━━\n` +
               `👤 *User:* @${phoneNumber}\n` +
               `🏠 *Group:* ${groupName}\n` +
               `🕒 *Joined:* ${timeStr}\n` +
               `👥 *Members now:* ${memberCount}\n\n${msg}`;
    }

    // ─── GOODBYE ───
    const isActive = activityPercent >= 50;
    const defaultTone = isActive
        ? `They were an active one — @${phoneNumber} sent ${activityPercent}% of the group's messages during their stay. Hate to see them go! 🥲`
        : `@${phoneNumber} barely made a peep (${activityPercent}% of messages while here) — ride safe, stranger. 🥀`;

    const msg = (customMessage || defaultTone)
        .replace(/@user/g, `@${phoneNumber}`)
        .replace(/@group/g, groupName);

    return `👋 *MEMBER LEFT*\n━━━━━━━━━━━━━━━━━━━━━\n` +
           `👤 *User:* @${phoneNumber}\n` +
           `🏠 *Group:* ${groupName}\n` +
           `🕒 *Left:* ${timeStr}\n` +
           `👥 *Members now:* ${memberCount}\n` +
           `📊 *Activity while here:* ${activityPercent}%\n\n${msg}`;
}

module.exports = { generateMemberCard, buildCaption };
