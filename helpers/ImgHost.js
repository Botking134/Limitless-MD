// helpers/ImgHost.js
// ImgBB image uploader (free API key: https://api.imgbb.com).
// Put the key in the host's environment as IMGBB_API_KEY,
// or set `imgbbApiKey` in config.js.
const axios = require('axios');
const FormData = require('form-data');

let config = {};
try { config = require('../config'); } catch (e) { /* config is optional here */ }

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MAX_BYTES = 32 * 1024 * 1024; // ImgBB limit

const getKey = () => (process.env.IMGBB_API_KEY || config.imgbbApiKey || '').trim();

// ImgBB only hosts images
function canUseImgBB(mimeType, buffer) {
    return !!getKey() &&
        typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/') &&
        (!buffer || buffer.length <= MAX_BYTES);
}

// Returns the direct image URL, or null if not possible / failed (never throws)
async function uploadToImgBB(buffer, mimeType) {
    if (!canUseImgBB(mimeType, buffer)) return null;
    try {
        let ext = (mimeType.split('/')[1] || 'jpg').split(';')[0].trim();
        if (ext === 'jpeg') ext = 'jpg';
        const form = new FormData();
        form.append('image', buffer, { filename: `img_${Date.now()}.${ext}`, contentType: mimeType });

        const res = await axios.post('https://api.imgbb.com/1/upload', form, {
            params: { key: getKey() },
            headers: { ...form.getHeaders(), 'User-Agent': BROWSER_UA },
            timeout: 30000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        const url = res.data?.data?.url || res.data?.data?.display_url;
        if (res.data?.success && url) return String(url).trim();
        console.error('❌ [IMGBB] Unexpected response:', JSON.stringify(res.data).slice(0, 200));
    } catch (err) {
        const detail = err.response?.data?.error?.message || err.message;
        console.error('❌ [IMGBB] Upload failed:', detail);
    }
    return null;
}

module.exports = { uploadToImgBB, canUseImgBB, BROWSER_UA };
