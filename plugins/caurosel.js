// plugins/carousel.js
const settings = require('../settings');

// Helper function to format system uptime
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

// Satoru Gojo Menu Graphics list
const menuImages = [
    "https://iili.io/CFIJoDg.jpg",
    "https://iili.io/CFIJfUB.jpg",
    "https://iili.io/CFIJnOF.jpg",
    "https://iili.io/CFIJBHP.jpg",
    "https://iili.io/CFIJTiv.jpg",
    "https://iili.io/CFIJRlp.jpg",
    "https://iili.io/CFIJYJI.jpg",
    "https://iili.io/CFIJlbn.jpg",
    "https://iili.io/CFIJ1xs.jpg"
];

// Helper to compile a WhatsApp Carousel card with media attachments
async function createCard(sock, title, description, imageUrl, commandId, buttonText) {
    const { prepareWAMessageMedia } = await import('@itsliaaa/baileys');

    const media = await prepareWAMessageMedia(
        { image: { url: imageUrl } },
        { upload: sock.waUploadToServer }
    );
