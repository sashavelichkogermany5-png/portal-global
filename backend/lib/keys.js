const crypto = require('crypto');

const KEY_PREFIX = {
    api: 'pg_api',
    service: 'pg_srv',
    agent: 'pg_agent'
};

const buildKey = (type) => {
    const prefix = KEY_PREFIX[type] || KEY_PREFIX.api;
    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(24).toString('hex');
    const token = `${prefix}_${id}_${secret}`;
    const preview = `${prefix}_${id.slice(0, 8)}...${secret.slice(-4)}`;
    return { id, secret, token, preview, prefix };
};

const createSalt = () => crypto.randomBytes(16).toString('hex');

const hashSecret = (secret, salt) => crypto
    .createHash('sha256')
    .update(`${salt}:${secret}`)
    .digest('hex');

const timingSafeEqualString = (left, right) => {
    if (!left || !right) return false;
    const leftBuf = Buffer.from(String(left));
    const rightBuf = Buffer.from(String(right));
    if (leftBuf.length !== rightBuf.length) return false;
    return crypto.timingSafeEqual(leftBuf, rightBuf);
};

const parseKey = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return null;
    const match = value.match(/^(pg_(api|srv|agent))_([0-9a-f-]{36})_(.+)$/i);
    if (!match) return null;
    return {
        prefix: match[1].toLowerCase(),
        type: match[2].toLowerCase(),
        id: match[3],
        secret: match[4]
    };
};

const verifySecret = ({ secret, salt, expectedHash }) => {
    if (!secret || !salt || !expectedHash) return false;
    const computed = hashSecret(secret, salt);
    return timingSafeEqualString(computed, expectedHash);
};

module.exports = {
    KEY_PREFIX,
    buildKey,
    createSalt,
    hashSecret,
    parseKey,
    verifySecret,
    timingSafeEqualString
};
