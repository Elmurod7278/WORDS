const crypto = require('node:crypto');

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

function verifyInitData(initDataRaw, botToken, options = {}) {
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  if (!initDataRaw || typeof initDataRaw !== 'string') {
    throw new Error('initData is required');
  }

  const params = new URLSearchParams(initDataRaw);
  const receivedHash = params.get('hash');
  if (!receivedHash) {
    throw new Error('initData is missing hash');
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([keyA], [keyB]) => (keyA < keyB ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const receivedHashBuffer = Buffer.from(receivedHash, 'hex');
  const computedHashBuffer = Buffer.from(computedHash, 'hex');
  const hashesMatch =
    receivedHashBuffer.length === computedHashBuffer.length &&
    crypto.timingSafeEqual(receivedHashBuffer, computedHashBuffer);

  if (!hashesMatch) {
    throw new Error('initData signature is invalid');
  }

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw new Error('initData has expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('initData is missing user');
  }

  try {
    return JSON.parse(userRaw);
  } catch {
    throw new Error('initData has invalid user payload');
  }
}

module.exports = { verifyInitData };
