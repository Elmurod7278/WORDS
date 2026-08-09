const crypto = require('node:crypto');

function adminAuth(env) {
  return (req, res, next) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="Admin"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    const usernameOk =
      username.length === env.adminUsername.length &&
      crypto.timingSafeEqual(Buffer.from(username), Buffer.from(env.adminUsername));
    const passwordOk =
      password.length === env.adminPassword.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(env.adminPassword));

    if (!usernameOk || !passwordOk) {
      res.set('WWW-Authenticate', 'Basic realm="Admin"');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    next();
  };
}

module.exports = { adminAuth };
