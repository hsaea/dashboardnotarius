import { findUser, checkPassword } from './store.js';

export function login(req, loginName, password) {
  const user = findUser(loginName);
  if (!user || !checkPassword(user, password)) return null;
  req.session.user = {
    login: user.login,
    role: user.role,
    assistant_name: user.assistant_name,
  };
  return req.session.user;
}

export function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'not_authenticated' });
}

export function requireCeo(req, res, next) {
  if (req.session?.user?.role === 'ceo') return next();
  return res.status(403).json({ error: 'forbidden' });
}

// Помічник бачить лише себе: примусово підставляє його імʼя у фільтр assistant
export function scopeAssistant(req, requested) {
  const u = req.session.user;
  if (u.role === 'ceo') return requested || null; // CEO: як запросив (або всі)
  return u.assistant_name;                         // assistant: завжди лише він
}
