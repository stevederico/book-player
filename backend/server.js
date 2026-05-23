// ==== IMPORTS ====
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'
import Stripe from "stripe";
import { compare as legacyBcryptCompare } from "./vendor/legacy-bcrypt.js";
import crypto from "crypto";

import { databaseManager } from "./adapters/manager.js";
import { synthesize } from "./tts/kokoro.js";
import { generateChapters } from "./tts/chapters.js";
import { analyzeTranscript, attachChapterTimes } from "./tts/analyze.js";
import { synthesizeGuide } from "./tts/tts-pipeline.js";
import { generateImage, extFromContentType, pLimit } from "./lib/grokImagine.js";
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, stat, readFileSync, writeFileSync, statSync } from 'node:fs';
import { writeFile, mkdir as mkdirP } from 'node:fs/promises';
import { promisify } from 'node:util';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * Convert a title into a URL-safe kebab-case slug.
 *
 * Lowercases, replaces any run of non-alphanumeric chars with a single dash,
 * trims leading/trailing dashes. Returns null if nothing usable remains.
 *
 * @param {string} title - Free-form title text
 * @returns {string|null} Kebab-case slug, or null
 */
function slugify(title) {
  if (typeof title !== 'string') return null;
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.length ? s : null;
}

// ==== SERVER CONFIG ====
const port = parseInt(process.env.PORT || "8000");

// ==== STRUCTURED LOGGING ====
// Defined early so all code can use it (no external dependencies)
const logger = {
  error: (message, meta = {}) => {
    const logEntry = {
      level: 'ERROR',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    };
    console.error(!isProd() ? JSON.stringify(logEntry, null, 2) : JSON.stringify(logEntry));
  },

  warn: (message, meta = {}) => {
    const logEntry = {
      level: 'WARN',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    };
    console.warn(!isProd() ? JSON.stringify(logEntry, null, 2) : JSON.stringify(logEntry));
  },

  info: (message, meta = {}) => {
    const logEntry = {
      level: 'INFO',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    };
    console.log(!isProd() ? JSON.stringify(logEntry, null, 2) : JSON.stringify(logEntry));
  },

  debug: (message, meta = {}) => {
    if (isProd()) return;
    const logEntry = {
      level: 'DEBUG',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    };
    console.log(JSON.stringify(logEntry, null, 2));
  }
};

// ==== CSRF PROTECTION ====
const csrfTokenStore = new Map(); // userID -> { token, timestamp }
const CSRF_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
const CSRF_MAX_ENTRIES = 50000; // LRU eviction threshold

/**
 * LRU eviction helper that removes oldest entries when over limit
 *
 * Prevents memory leaks in CSRF store by removing oldest entries based on
 * timestamp when store exceeds maxEntries threshold.
 *
 * @param {Map} store - Map to evict entries from
 * @param {number} maxEntries - Maximum entries before eviction
 * @param {Function} getTimestamp - Function to extract timestamp from value
 * @returns {void}
 */
function evictOldestEntries(store, maxEntries, getTimestamp) {
  if (store.size <= maxEntries) return;

  // Convert to array and sort by timestamp
  const entries = Array.from(store.entries())
    .map(([key, value]) => ({ key, timestamp: getTimestamp(value) }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Remove oldest entries until under limit
  const toRemove = store.size - maxEntries;
  for (let i = 0; i < toRemove; i++) {
    store.delete(entries[i].key);
  }
}

/**
 * Generate cryptographically secure CSRF token
 *
 * Uses crypto.randomBytes to generate 64-character hex token.
 *
 * @returns {string} Hex-encoded CSRF token
 */
function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF protection middleware using timing-safe comparison
 *
 * Validates CSRF token from x-csrf-token header against stored token for userID.
 * Skips validation for GET requests and signup/signin routes. Uses timing-safe
 * comparison to prevent timing attacks. Enforces 24-hour token expiry.
 * Auto-regenerates token if missing (e.g., server restart) for authenticated users.
 *
 * @async
 * @param {Context} c - Hono context
 * @param {Function} next - Next middleware function
 * @returns {Promise<Response|void>} 403 error or continues to next middleware
 */
async function csrfProtection(c, next) {
  if (c.req.method === 'GET' || c.req.path === '/api/signup' || c.req.path === '/api/signin') {
    return next();
  }

  const csrfToken = c.req.header('x-csrf-token');
  const userID = c.get('userID'); // Set by authMiddleware

  if (!csrfToken || !userID) {
    logger.info('CSRF validation failed - missing token or userID', {
      hasToken: !!csrfToken,
      hasUserID: !!userID,
      path: c.req.path
    });
    return c.json({ error: 'Invalid CSRF token' }, 403);
  }

  let storedData = csrfTokenStore.get(userID);
  if (!storedData) {
    // Auto-regenerate token for authenticated users (e.g., after server restart)
    // Security: This block only runs if authMiddleware passed (JWT valid)
    const newToken = generateCSRFToken();
    storedData = { token: newToken, timestamp: Date.now() };
    csrfTokenStore.set(userID, storedData);

    setCookie(c, 'csrf_token', newToken, {
      httpOnly: false,
      secure: isProd(),
      sameSite: 'Lax',
      path: '/',
      maxAge: CSRF_TOKEN_EXPIRY / 1000
    });

    logger.info('CSRF token auto-regenerated after store miss', { userID });
    await next();
    return;
  }

  // Use timing-safe comparison to prevent timing attacks
  const tokenBuffer = Buffer.from(csrfToken);
  const storedBuffer = Buffer.from(storedData.token);
  if (tokenBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(tokenBuffer, storedBuffer)) {
    logger.info('CSRF validation failed - token mismatch', {
      userID,
      path: c.req.path
    });
    return c.json({ error: 'Invalid CSRF token' }, 403);
  }

  // Check if token is expired
  if (Date.now() - storedData.timestamp > CSRF_TOKEN_EXPIRY) {
    csrfTokenStore.delete(userID);
    logger.info('CSRF validation failed - token expired', {
      userID,
      age: Math.floor((Date.now() - storedData.timestamp) / 1000) + 's'
    });
    return c.json({ error: 'CSRF token expired' }, 403);
  }

  logger.debug('CSRF validation passed', { userID });
  await next();
}

// Cleanup expired CSRF tokens every hour to prevent memory leak
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [userID, data] of csrfTokenStore.entries()) {
    if (now - data.timestamp > CSRF_TOKEN_EXPIRY) {
      csrfTokenStore.delete(userID);
      cleaned++;
    }
  }

  // LRU eviction if still over limit
  evictOldestEntries(csrfTokenStore, CSRF_MAX_ENTRIES, (data) => data.timestamp);

  if (cleaned > 0) {
    logger.debug('CSRF cleanup completed', { removedTokens: cleaned });
  }
}, 60 * 60 * 1000); // Run every hour

// ==== ACCOUNT LOCKOUT ====
const loginAttemptStore = new Map(); // email -> { attempts, lockedUntil }
const LOCKOUT_THRESHOLD = 5; // Lock after 5 failed attempts
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MAX_ENTRIES = 50000; // LRU eviction threshold

/**
 * Check if account is locked due to failed login attempts
 *
 * @param {string} email - Email address to check
 * @returns {{locked: boolean, remainingTime: number}} Lock status and remaining time in seconds
 */
function isAccountLocked(email) {
  const record = loginAttemptStore.get(email);
  if (!record) return { locked: false, remainingTime: 0 };

  const now = Date.now();
  if (record.lockedUntil && now < record.lockedUntil) {
    return {
      locked: true,
      remainingTime: Math.ceil((record.lockedUntil - now) / 1000)
    };
  }

  // Lock expired, clear record
  if (record.lockedUntil && now >= record.lockedUntil) {
    loginAttemptStore.delete(email);
  }

  return { locked: false, remainingTime: 0 };
}

/**
 * Record a failed login attempt for an email
 *
 * Increments attempt counter. Locks account after LOCKOUT_THRESHOLD failures.
 *
 * @param {string} email - Email address that failed login
 * @returns {void}
 */
function recordFailedLogin(email) {
  const now = Date.now();
  let record = loginAttemptStore.get(email);

  if (!record) {
    record = { attempts: 0, lockedUntil: null };
    loginAttemptStore.set(email, record);
  }

  record.attempts++;

  if (record.attempts >= LOCKOUT_THRESHOLD) {
    record.lockedUntil = now + LOCKOUT_DURATION;
    logger.info('Account locked due to failed attempts', { email: email.substring(0, 3) + '***' });
  }
}

/**
 * Clear failed login attempts on successful login
 *
 * @param {string} email - Email address to clear
 * @returns {void}
 */
function clearFailedLogins(email) {
  loginAttemptStore.delete(email);
}

// Cleanup expired lockout entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [email, record] of loginAttemptStore.entries()) {
    if (record.lockedUntil && now >= record.lockedUntil) {
      loginAttemptStore.delete(email);
      cleaned++;
    }
  }

  // LRU eviction if still over limit
  evictOldestEntries(loginAttemptStore, LOCKOUT_MAX_ENTRIES, (data) => data.lockedUntil || 0);

  if (cleaned > 0) {
    logger.debug('Lockout cleanup completed', { removedEntries: cleaned });
  }
}, 15 * 60 * 1000);

// ==== CONFIG & ENV ====
// Environment setup - MUST happen before config loading
if (!isProd()) {
  loadLocalENV();
} else {
  setInterval(async () => {
    logger.debug('Hourly task completed');
  }, 60 * 60 * 1000); // Every hour
}

/**
 * Resolve environment variable placeholders in configuration strings
 *
 * Replaces ${VAR_NAME} patterns with process.env values. Logs warning
 * and preserves placeholder if environment variable is undefined.
 *
 * @param {string} str - String with ${VAR_NAME} placeholders
 * @returns {string} String with placeholders replaced
 */
function resolveEnvironmentVariables(str) {
  if (typeof str !== 'string') return str;

  return str.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      logger.warn('Environment variable not defined, using placeholder', { varName, placeholder: match });
      return match; // Return the placeholder if env var is not found
    }
    return envValue;
  });
}

// Load and process configuration
let config;
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const configPath = resolve(__dirname, './config.json');
  const configData = await promisify(readFile)(configPath);
  const rawConfig = JSON.parse(configData.toString());

  // Resolve environment variables in configuration
  config = {
    staticDir: rawConfig.staticDir || '../dist',
    database: {
      ...rawConfig.database,
      connectionString: resolveEnvironmentVariables(rawConfig.database.connectionString)
    }
  };
} catch (err) {
  logger.error('Failed to load config, using defaults', { error: err.message });
  config = {
    staticDir: '../dist',
    database: {
      db: "MyApp",
      dbType: "sqlite",
      connectionString: "./databases/MyApp.db"
    }
  };
}

const STRIPE_KEY = process.env.STRIPE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Validate required environment variables are set
 *
 * Checks for STRIPE_KEY, STRIPE_ENDPOINT_SECRET, JWT_SECRET, and any
 * unresolved ${VAR} references in database config. Logs warnings for
 * missing variables but does not exit the process.
 *
 * @returns {boolean} True if all required variables are present
 */
function validateEnvironmentVariables() {
  const missing = [];

  if (!STRIPE_KEY) missing.push('STRIPE_KEY');
  if (!process.env.STRIPE_ENDPOINT_SECRET) missing.push('STRIPE_ENDPOINT_SECRET');
  if (!JWT_SECRET) missing.push('JWT_SECRET');

  // Check for database environment variables that are referenced but not defined
  if (typeof config.database.connectionString === 'string') {
    const matches = config.database.connectionString.match(/\$\{([^}]+)\}/g);
    if (matches) {
      matches.forEach(match => {
        const varName = match.slice(2, -1); // Remove ${ and }
        if (!process.env[varName]) {
          missing.push(`${varName} (referenced in database config)`);
        }
      });
    }
  }

  if (missing.length > 0) {
    logger.warn('Missing environment variables - server continuing with limited functionality', {
      missing,
      hint: 'Set DATABASE_URL, MONGODB_URL, POSTGRES_URL, STRIPE_KEY, JWT_SECRET for full functionality'
    });

    // Don't exit - let the server continue with warnings
    return false;
  }

  return true;
}

const envValidationPassed = validateEnvironmentVariables();

if (envValidationPassed) {
  logger.info('Environment variables validated successfully');
}

logger.info('Single-client backend initialized');

// ==== DATABASE CONFIG ====
// Single database configuration - no origin-based routing needed
const dbConfig = config.database;

// ==== SERVICES SETUP ====
// Stripe setup (only if key is available)
let stripe = null;
if (STRIPE_KEY) {
  stripe = new Stripe(STRIPE_KEY);
} else {
  logger.warn('STRIPE_KEY not set - Stripe functionality disabled');
}

// Single database config - always use the same one
const currentDbConfig = dbConfig;

/**
 * Database helper with pre-bound configuration
 *
 * Provides shorthand methods for database operations without repeating
 * dbType, db, connectionString on every call.
 *
 * @type {Object}
 * @example
 * // Instead of:
 * await db.findUser( { email });
 * // Use:
 * await db.findUser({ email });
 */
const db = {
  findUser: (query, projection) => databaseManager.findUser(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, query, projection),
  insertUser: (userData) => databaseManager.insertUser(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, userData),
  updateUser: (query, update) => databaseManager.updateUser(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, query, update),
  findAuth: (query) => databaseManager.findAuth(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, query),
  insertAuth: (authData) => databaseManager.insertAuth(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, authData),
  updateAuth: (query, update) => databaseManager.updateAuth(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, query, update),
  findWebhookEvent: (eventId) => databaseManager.findWebhookEvent(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, eventId),
  insertWebhookEvent: (eventId, eventType, processedAt) => databaseManager.insertWebhookEvent(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, eventId, eventType, processedAt),
  listGuides: (filters) => databaseManager.listGuides(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, filters),
  getGuide: (slug) => databaseManager.getGuide(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, slug),
  upsertGuide: (guide) => databaseManager.upsertGuide(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, guide),
  updateGuideJob: (slug, step, jobState) => databaseManager.updateGuideJob(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, slug, step, jobState),
  executeQuery: (queryObject) => databaseManager.executeQuery(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, queryObject)
};

// ==== HONO SETUP ====
const app = new Hono();

// Get __dirname for static file serving
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CORS middleware (needed for development when frontend is on different port)
// Use CORS_ORIGINS env var in production, fallback to localhost for development
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:8000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8000'];

app.use('*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  credentials: true
}));

// Apache Common Log Format middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const method = c.req.method;
  const url = c.req.path;
  const status = c.res.status;
  const duration = Date.now() - start;

  console.log(`[${timestamp}] "${method} ${url}" ${status} (${duration}ms)`);
});

// Security headers middleware
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "https:"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"]
  },
  strictTransportSecurity: !isProd() ? false : 'max-age=31536000; includeSubDomains; preload',
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
    payment: []
  }
}));

// Request logging middleware (dev only)
app.use('*', async (c, next) => {
  if (!isProd()) {
    const requestId = Math.random().toString(36).substr(2, 9);
    logger.debug('Request received', { method: c.req.method, path: c.req.path, requestId });
  }
  await next();
});

const tokenExpirationDays = 30;

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALTLEN = 16;

/**
 * Hash password using node:crypto scrypt
 *
 * Format: `scrypt$<base64url salt>$<base64url key>`. New hashes always use
 * scrypt; legacy bcrypt hashes (prefix `$2`) are verified via the dispatch
 * in verifyPassword but never created.
 *
 * @async
 * @param {string} password - Plain text password to hash
 * @returns {Promise<string>} Scrypt hash string
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALTLEN);
  const key = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * Verify password against stored hash (scrypt or legacy bcrypt)
 *
 * Dispatches on stored hash prefix: `scrypt$` → native scrypt verify;
 * `$2` → bcryptjs (legacy users predating the scrypt migration).
 *
 * @async
 * @param {string} password - Plain text password to verify
 * @param {string} stored - Stored hash (scrypt or bcrypt format)
 * @returns {Promise<boolean>} True if password matches stored hash
 */
async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  if (stored.startsWith('scrypt$')) {
    const [, saltB64, keyB64] = stored.split('$');
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(keyB64, 'base64url');
    const candidate = await scryptAsync(password, salt, SCRYPT_KEYLEN);
    return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
  }
  if (stored.startsWith('$2')) {
    return await legacyBcryptCompare(password, stored);
  }
  return false;
}

/**
 * Whether a stored hash should be migrated to scrypt on next successful login
 *
 * @param {string} stored - Stored hash
 * @returns {boolean} True if the hash is in legacy bcrypt format
 */
function needsRehash(stored) {
  return typeof stored === 'string' && !stored.startsWith('scrypt$');
}

/**
 * Calculate JWT expiration timestamp
 *
 * @returns {number} Unix timestamp 30 days in the future
 */
function tokenExpireTimestamp(){
  return Math.floor(Date.now() / 1000) + tokenExpirationDays * 24 * 60 * 60; // 30 days from now
}

/**
 * Sign an HS256 JWT using node:crypto HMAC-SHA256
 *
 * Produces a token byte-compatible with jsonwebtoken: header
 * {"alg":"HS256","typ":"JWT"} followed by the payload, joined and signed
 * over `base64url(header).base64url(payload)`.
 *
 * @param {Object} payload - Payload to encode (must include exp)
 * @param {string} secret - HMAC signing secret
 * @returns {string} Compact JWT string
 */
function jwtSign(payload, secret) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/**
 * Verify an HS256 JWT and return its payload
 *
 * Compatible with tokens issued by jsonwebtoken (same algorithm, same secret).
 * Throws an Error with name === 'TokenExpiredError' for expired tokens, or a
 * generic Error for malformed/invalid signatures.
 *
 * @param {string} token - JWT string to verify
 * @param {string} secret - HMAC verification secret
 * @returns {Object} Decoded payload
 * @throws {Error} If token is malformed, signature invalid, or expired
 */
function jwtVerify(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [head, body, sig] = parts;
  if (!head || !body || !sig) throw new Error('Invalid token');
  const expected = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid signature');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    const err = new Error('Token expired');
    err.name = 'TokenExpiredError';
    throw err;
  }
  return payload;
}

/**
 * Generate JWT token for user authentication
 *
 * Creates HS256-signed JWT with 30-day expiration. Requires JWT_SECRET
 * environment variable.
 *
 * @async
 * @param {string} userID - User ID to encode in token
 * @returns {Promise<string>} Signed JWT token
 * @throws {Error} If JWT_SECRET not configured or signing fails
 */
async function generateToken(userID) {
  try {
    if (!JWT_SECRET) {
      throw new Error("JWT_SECRET not configured - authentication disabled");
    }

    const exp = tokenExpireTimestamp();
    const payload = { userID, exp };

    return jwtSign(payload, JWT_SECRET);
  } catch (error) {
    logger.error('Token generation error', { error: error.message });
    throw error;
  }
}

/**
 * Authentication middleware using JWT from HttpOnly cookie
 *
 * Verifies JWT token from 'token' cookie. Sets userID in context on success,
 * normalized to string for consistent Map key usage across middleware (CSRF, sessions).
 * Returns 401 for missing, expired, or invalid tokens. Returns 503 if
 * JWT_SECRET not configured.
 *
 * @async
 * @param {Context} c - Hono context
 * @param {Function} next - Next middleware function
 * @returns {Promise<Response|void>} 401/503 error or continues to next middleware
 */
async function authMiddleware(c, next) {
  if (!JWT_SECRET) {
    return c.json({ error: "Authentication service unavailable" }, 503);
  }

  // Read token from HttpOnly cookie
  const token = getCookie(c, 'token');
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = jwtVerify(token, JWT_SECRET);
    // Normalize userID to string for consistent Map key usage (CSRF, sessions)
    const normalizedUserID = String(payload.userID);
    c.set('userID', normalizedUserID);
    await next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.debug('Token expired');
      return c.json({ error: "Token expired" }, 401);
    }
    logger.error('Token verification error', { error: error.message });
    return c.json({ error: "Invalid token" }, 401);
  }
}

/**
 * Generate RFC 4122 compliant UUID v4
 *
 * Uses crypto.randomUUID() for cryptographically secure unique identifiers.
 *
 * @returns {string} UUID string
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Escape HTML special characters to prevent XSS attacks
 *
 * Replaces &, <, >, ", ', / with HTML entities. Returns original value
 * if not a string.
 *
 * @param {string} text - Text to escape
 * @returns {string} HTML-escaped text
 */
const escapeHtml = (text) => {
  if (typeof text !== 'string') return text;
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return text.replace(/[&<>"'/]/g, (char) => map[char]);
};

/**
 * Validate email address format and length
 *
 * RFC 5321 compliant validation with robust regex checking local part,
 * domain, and TLD. Max length 254 characters. Prevents consecutive dots
 * and leading/trailing hyphens.
 *
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email format
 */
const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false; // RFC 5321

  // More robust email validation:
  // - Local part: letters, numbers, and common special chars (no consecutive dots)
  // - Domain: letters, numbers, hyphens (no consecutive dots or leading/trailing hyphens)
  // - TLD: 2-63 characters
  const emailRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,63}$/;
  return emailRegex.test(email);
};

/**
 * Validate password length within bcrypt limits
 *
 * Enforces 6-72 character range (bcrypt's maximum is 72 bytes).
 *
 * @param {string} password - Password to validate
 * @returns {boolean} True if valid password length
 */
const validatePassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  if (password.length < 6 || password.length > 72) return false; // bcrypt limit
  return true;
};

/**
 * Validate name length and non-empty after trim
 *
 * Enforces 1-100 character range after trimming whitespace.
 *
 * @param {string} name - Name to validate
 * @returns {boolean} True if valid name
 */
const validateName = (name) => {
  if (!name || typeof name !== 'string') return false;
  if (name.trim().length === 0 || name.length > 100) return false;
  return true;
};

/**
 * Set authentication cookies and generate CSRF token for user session
 *
 * Creates CSRF token, stores it in memory, and sets both JWT (HttpOnly) and
 * CSRF (readable) cookies. Consolidates duplicate cookie logic from signup/signin.
 *
 * @async
 * @param {Context} c - Hono context
 * @param {string} userID - User ID to associate with session
 * @param {string} jwtToken - Pre-generated JWT token
 * @returns {string} Generated CSRF token
 */
function setAuthCookies(c, userID, jwtToken) {
  const csrfToken = generateCSRFToken();
  csrfTokenStore.set(userID.toString(), { token: csrfToken, timestamp: Date.now() });

  // Set HttpOnly JWT cookie
  setCookie(c, 'token', jwtToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'Strict',
    path: '/',
    maxAge: tokenExpirationDays * 24 * 60 * 60
  });

  // Set CSRF token cookie (readable by frontend)
  setCookie(c, 'csrf_token', csrfToken, {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'Lax',
    path: '/',
    maxAge: CSRF_TOKEN_EXPIRY / 1000
  });

  return csrfToken;
}

// ==== STRIPE WEBHOOK (raw body needed) ====

/**
 * Resolve a Stripe customer ID to a normalized lowercase email.
 *
 * @param {string} stripeID - Stripe customer ID
 * @returns {Promise<string|null>} Normalized email, or null if missing
 */
async function resolveCustomerEmail(stripeID) {
  const customer = await stripe.customers.retrieve(stripeID);
  if (!customer?.email) {
    logger.warn('Webhook: Customer has no email', { stripeID });
    return null;
  }
  return customer.email.toLowerCase();
}

/**
 * Build the canonical user.subscription patch from a Stripe customer ID
 * and a Stripe subscription object.
 *
 * @param {string} stripeID - Stripe customer ID
 * @param {object} stripeSub - Stripe subscription object
 * @returns {{stripeID: string, expires: number, status: string}}
 */
function buildSubscriptionPatch(stripeID, stripeSub) {
  return {
    stripeID,
    expires: stripeSub.current_period_end,
    status: stripeSub.status
  };
}

/**
 * Apply a $set patch to the user identified by email. Returns false if no
 * matching user is found (silent no-op so Stripe will not retry).
 *
 * @param {string} email - Normalized email
 * @param {object} $set - MongoDB-style $set fields
 * @returns {Promise<boolean>} True if a user was patched
 */
async function applyUserPatch(email, $set) {
  const user = await db.findUser({ email });
  if (!user) {
    logger.warn('Webhook: No user found for email', { email });
    return false;
  }
  await db.updateUser({ email }, { $set });
  return true;
}

app.post("/api/payment", async (c) => {
  logger.info('Payment webhook received');

  const signature = c.req.header("stripe-signature");
  const rawBody = await c.req.arrayBuffer();
  const body = Buffer.from(rawBody);

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, process.env.STRIPE_ENDPOINT_SECRET);
    logger.debug('Webhook event received', { type: event.type });
  } catch (e) {
    logger.error('Webhook signature verification failed', { error: e.message });
    return c.body(null, 400);
  }

  try {
    // Idempotency check - skip if already processed
    const existingEvent = await db.findWebhookEvent(event.id);
    if (existingEvent) {
      logger.info('Webhook event already processed, skipping', { eventId: event.id });
      return c.body(null, 200);
    }

    // Record event BEFORE processing to prevent race conditions
    await db.insertWebhookEvent(event.id, event.type, Date.now());

    const eventObject = event.data.object;

    if (["customer.subscription.deleted", "customer.subscription.updated", "customer.subscription.created"].includes(event.type)) {
      const { customer: stripeID, current_period_end, status } = eventObject;
      if (!stripeID) {
        logger.error('Webhook missing customer ID', { type: event.type });
        return c.body(null, 400);
      }
      const email = await resolveCustomerEmail(stripeID);
      if (!email) return c.body(null, 400);
      const ok = await applyUserPatch(email, { subscription: { stripeID, expires: current_period_end, status } });
      if (ok) logger.info('Subscription updated', { type: event.type, email, status });
    }

    if (event.type === "checkout.session.completed") {
      const { customer: stripeID, customer_email, subscription: subscriptionId } = eventObject;
      if (subscriptionId && stripeID) {
        const [subscription, email] = await Promise.all([
          stripe.subscriptions.retrieve(subscriptionId),
          customer_email ? Promise.resolve(customer_email.toLowerCase()) : resolveCustomerEmail(stripeID)
        ]);
        if (email) {
          const ok = await applyUserPatch(email, { subscription: buildSubscriptionPatch(stripeID, subscription) });
          if (ok) logger.info('Checkout completed', { email, status: subscription.status });
        }
      }
    }

    if (event.type === "invoice.paid") {
      const { customer: stripeID, subscription: subscriptionId } = eventObject;
      if (subscriptionId && stripeID) {
        const [subscription, email] = await Promise.all([
          stripe.subscriptions.retrieve(subscriptionId),
          resolveCustomerEmail(stripeID)
        ]);
        if (email) {
          const ok = await applyUserPatch(email, { subscription: buildSubscriptionPatch(stripeID, subscription) });
          if (ok) logger.info('Invoice paid', { email });
        }
      }
    }

    if (event.type === "invoice.payment_failed") {
      const { customer: stripeID } = eventObject;
      if (stripeID) {
        const email = await resolveCustomerEmail(stripeID);
        if (email) {
          const ok = await applyUserPatch(email, {
            'subscription.paymentFailed': true,
            'subscription.paymentFailedAt': Date.now()
          });
          if (ok) logger.warn('Invoice payment failed', { email });
        }
      }
    }

    return c.body(null, 200);
  } catch (e) {
    logger.error('Webhook processing error', { error: e.message });
    return c.body(null, 500);
  }
});

// ==== STATIC ROUTES ====
app.get("/api/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// Simple server-side page fetch + extraction for the create flow
// Minimal HTML entity decoder — covers the common named entities and all numeric refs
const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©',
  reg: '®', trade: '™', deg: '°', middot: '·', bull: '•',
};
function decodeHtmlEntities(s) {
  if (!s) return '';
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => HTML_ENTITIES[name.toLowerCase()] ?? m);
}

// Convert HTML fragment to text while preserving paragraph breaks
function htmlFragmentToText(html) {
  return html
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|blockquote|tr)>/gi, '\n\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

app.post("/api/fetch-url", async (c) => {
  try {
    const { url } = await c.req.json();

    if (!url || typeof url !== 'string') {
      return c.json({ error: "URL is required" }, 400);
    }

    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch {
      return c.json({ error: "Invalid URL" }, 400);
    }
    if (!/^https?:$/.test(targetUrl.protocol)) {
      return c.json({ error: "Only http(s) URLs are supported" }, 400);
    }

    // 15-second timeout on the outbound fetch so we don't hang the request
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BookPlayerBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        return c.json({ error: 'Upstream fetch timed out after 15s' }, 504);
      }
      throw err;
    }
    clearTimeout(timer);

    if (!response.ok) {
      return c.json({ error: `Failed to fetch page (status ${response.status})` }, 502);
    }

    const html = await response.text();

    // Title — [^<] still includes newlines, so multi-line titles work
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    let title = titleMatch
      ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim().replace(/\s*[|–—].*$/, '')
      : 'Untitled';

    // Strip noise once, up front
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Try to find the main content container (rough priority order)
    const containerRegexes = [
      /<article[^>]*>([\s\S]*?)<\/article>/i,
      /<main[^>]*>([\s\S]*?)<\/main>/i,
      /<div[^>]+(?:id|class)=["'][^"']*(?:post|article|content|entry-content|post-content|article-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ];

    let mainHtml = '';
    for (const regex of containerRegexes) {
      const match = cleaned.match(regex);
      if (match && match[1].length > 500) {
        mainHtml = match[1];
        break;
      }
    }

    let transcript;
    if (mainHtml) {
      transcript = htmlFragmentToText(mainHtml);
    } else {
      // First fallback: stitch <p> contents (modern blogs)
      const paras = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map(m => htmlFragmentToText(m[1]))
        .filter(Boolean);
      transcript = paras.join('\n\n');

      // Second fallback: pages with no <p> at all (e.g. paulgraham.com uses <font> + <br><br>).
      // Drop nav-ish tags then run the body through htmlFragmentToText so <br><br> becomes \n\n.
      if (!transcript || transcript.length < 100) {
        const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const bodySource = bodyMatch ? bodyMatch[1] : cleaned;
        const stripped = bodySource
          .replace(/<(?:nav|header|footer|aside|form|svg)[\s\S]*?<\/(?:nav|header|footer|aside|form|svg)>/gi, '')
          .replace(/<(?:img|map|area|input|link|meta)[^>]*\/?>/gi, '');
        transcript = htmlFragmentToText(stripped);
      }
    }

    transcript = decodeHtmlEntities(transcript);

    const authorMatch = cleaned.match(/<meta[^>]+name=["'](?:author|twitter:creator|og:article:author)["'][^>]+content=["']([^"']+)["']/i);
    const author = authorMatch ? decodeHtmlEntities(authorMatch[1]).trim() : '';

    if (!transcript || transcript.length < 100) {
      return c.json({ error: 'Could not extract readable text from the page' }, 422);
    }

    transcript = transcript.slice(0, 25000);

    const date = extractDate(cleaned, transcript);
    const thumbnail = extractOgImage(cleaned, targetUrl);

    return c.json({
      title: title.trim(),
      author: author || null,
      transcript,
      date,
      thumbnail,
      sourceUrl: response.url || targetUrl.toString(),
    });

  } catch (err) {
    logger.error('fetch-url error', { error: err.message });
    return c.json({ error: 'Failed to fetch or parse the page' }, 500);
  }
});

/**
 * Extract a publication date from cleaned HTML.
 *
 * Tries meta tags, then <time datetime="...">, then a "Month YYYY" fallback
 * in the body text. Returns a trimmed string or null.
 *
 * @param {string} cleanedHtml - HTML with script/style/noscript stripped
 * @param {string} bodyText - Plain-text transcript for fallback scan
 * @returns {string|null}
 */
function extractDate(cleanedHtml, bodyText) {
  const metaPatterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']article:published["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:article:published_time["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of metaPatterns) {
    const m = cleanedHtml.match(re);
    if (m) return decodeHtmlEntities(m[1]).trim();
  }
  const timeMatch = cleanedHtml.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (timeMatch) return decodeHtmlEntities(timeMatch[1]).trim();
  const MONTHS = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
  const bodyMatch = bodyText.match(new RegExp(`${MONTHS}\\s+\\d{4}`));
  if (bodyMatch) return bodyMatch[0];
  return null;
}

/**
 * Extract an og:image / twitter:image URL, resolved against the page URL.
 *
 * @param {string} cleanedHtml - HTML with script/style/noscript stripped
 * @param {URL} baseUrl - Page URL for relative-href resolution
 * @returns {string|null}
 */
function extractOgImage(cleanedHtml, baseUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = cleanedHtml.match(re);
    if (m) {
      const raw = decodeHtmlEntities(m[1]).trim();
      try { return new URL(raw, baseUrl).toString(); } catch { return raw; }
    }
  }
  return null;
}

// ==== GUIDE ROUTES (public read) ====
app.get("/api/guides", async (c) => {
  try {
    const guides = await db.listGuides({ visibility: 'public' });
    return c.json(guides);
  } catch (e) {
    logger.error('List guides error', { error: e.message });
    return c.json({ error: "Failed to load guides" }, 500);
  }
});

app.get("/api/guides/:slug", async (c) => {
  try {
    const slug = c.req.param('slug');
    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);
    if (guide.visibility && guide.visibility !== 'public') {
      return c.json({ error: "Guide not found" }, 404);
    }
    return c.json(guide);
  } catch (e) {
    logger.error('Get guide error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: "Failed to load guide" }, 500);
  }
});

/**
 * Delete a guide by slug. Removes the DB row only; on-disk audio/images stay
 * orphaned in backend/public/{audio,images}/ and are safe to garbage-collect later.
 */
app.delete("/api/guides/:slug", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);

    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);

    const result = await db.executeQuery({
      query: `DELETE FROM Guides WHERE slug = ?`,
      params: [slug],
    });

    return c.json({ ok: true, slug, changes: result?.data?.affectedRows ?? 1 });
  } catch (e) {
    logger.error('Delete guide error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: "Failed to delete guide" }, 500);
  }
});

// Text-to-speech — returns WAV bytes + per-word timestamps.
// Returns JSON with base64-encoded audio so a single response carries both
// the audio and the timing array. Caller decodes audio with `atob`.
app.post("/api/tts", async (c) => {
  try {
    const body = await parseJsonBody(c);
    if (!body) return c.json({ error: "Invalid request body" }, 400);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return c.json({ error: "Missing 'text'" }, 400);
    if (text.length > 20000) return c.json({ error: "Text too long (max 20,000 chars)" }, 413);

    const voice = typeof body.voice === 'string' ? body.voice : 'af_heart';
    const speed = Number.isFinite(body.speed) ? Math.max(0.5, Math.min(2, body.speed)) : 1;

    const t0 = Date.now();
    const { audioWav, words, sampleRate, durationSec } = await synthesize(text, { voice, speed });
    logger.info('TTS synthesize', { chars: text.length, ms: Date.now() - t0, durationSec, words: words.length });

    return c.json({
      audioBase64: audioWav.toString('base64'),
      mimeType: 'audio/wav',
      sampleRate,
      durationSec,
      words,
    });
  } catch (e) {
    logger.error('TTS error', { error: e.message });
    return c.json({ error: "Failed to synthesize" }, 500);
  }
});

// Generate chapters from the existing transcript + word timings via Grok.
// Overwrites Guides.chapters_json. Requires the guide to have a transcript
// and word timings (timing.words). Open for now — see todo.md re: auth.
// Stubs for the enrichment pipeline. Each step the create flow doesn't run yet
// has an endpoint here so the GuideProgress UI can show a "Not implemented" failure
// with a hint instead of a generic 404. Replace each body with a real implementation
// as the pipeline lands.
// No remaining 501 stubs — every step has a real route below.
const MAX_CHAPTER_IMAGES_PER_GUIDE = 60;
const CHAPTER_IMAGE_CONCURRENCY = 3;

app.post("/api/guides/:slug/auto-chapters", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);

    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);
    if (!guide.transcript) return c.json({ error: "Guide has no transcript" }, 422);
    const words = guide.timing?.words;
    if (!Array.isArray(words) || !words.length) return c.json({ error: "Guide has no word timings" }, 422);

    const t0 = Date.now();
    const chapters = await generateChapters({
      transcript: guide.transcript,
      words,
      durationSec: guide.duration || words[words.length - 1]?.t || 0,
    });
    if (!chapters.length) return c.json({ error: "No chapters generated" }, 502);

    await db.upsertGuide({ ...guide, chapters });
    logger.info('Auto-chapters generated', { slug, count: chapters.length, ms: Date.now() - t0 });
    return c.json({ chapters });
  } catch (e) {
    logger.error('Auto-chapters error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: e.message || "Failed to generate chapters" }, 500);
  }
});

// Combined Grok pass: author + summary + chapter outlines from the transcript
// in one model call. Persists guide.author (if missing), guide.summary, and
// guide.chapters (outlines — time gets attached later by /chapter-timing).
app.post("/api/guides/:slug/analyze", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);
    await runAnalyzeStep(slug);
    const fresh = await db.getGuide(slug);
    return c.json({
      author: fresh.author,
      summary: fresh.summary,
      chapters: (fresh.chapters || []).map(c => ({ title: c.title, quote: c.quote, caption: c.caption })),
    });
  } catch (e) {
    logger.error('Analyze endpoint error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: e.message || "Failed to analyze" }, 500);
  }
});

// Quote-match chapter outlines against word timings (no AI call).
app.post("/api/guides/:slug/chapter-timing", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);
    await runChapterTimingStep(slug);
    const fresh = await db.getGuide(slug);
    return c.json({ chapters: fresh.chapters });
  } catch (e) {
    logger.error('Chapter-timing endpoint error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: e.message || "Failed to time chapters" }, 500);
  }
});

// Generate a 2-3 paragraph summary from the transcript via xAI Grok.
// Persists to guide.summary.
app.post("/api/guides/:slug/summary", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);

    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);
    if (!guide.transcript) return c.json({ error: "Guide has no transcript" }, 422);

    const t0 = Date.now();
    // Delegate to the combined analyze call so we only ever make one Grok request.
    await runAnalyzeStep(slug);
    const fresh = await db.getGuide(slug);
    logger.info('Summary generated', { slug, chars: fresh.summary?.length || 0, ms: Date.now() - t0 });
    return c.json({ summary: fresh.summary });
  } catch (e) {
    logger.error('Summary error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: e.message || "Failed to generate summary" }, 500);
  }
});

// Kick off a Kokoro TTS run for a guide. Fire-and-forget — returns 202 with
// jobId so the FE can poll GET /api/guides/:slug and watch guide.jobs.tts.
// On completion: writes /audio/<slug>.wav and updates audio/duration/timing.
app.post("/api/guides/:slug/tts", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);

    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);
    if (!guide.transcript) return c.json({ error: "Guide has no transcript" }, 422);
    if (guide.jobs?.tts?.status === 'running') {
      return c.json({ jobId: 'tts', status: 'running', message: 'Already running' }, 202);
    }

    await db.updateGuideJob(slug, 'tts', {
      status: 'running',
      startedAt: Date.now(),
      chunksDone: 0,
      chunksTotal: 0,
      error: null,
    });

    // Fire-and-forget; do not await.
    runTtsJob(slug, guide).catch(err => {
      logger.error('TTS job crashed', { slug, error: err.message });
    });

    return c.json({ jobId: 'tts', status: 'running' }, 202);
  } catch (e) {
    logger.error('TTS kickoff error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: e.message || "Failed to kick off TTS" }, 500);
  }
});

/**
 * Background TTS job: synthesize the full transcript and persist results.
 * Updates Guides.jobs_json on progress and on terminal state (done/failed).
 *
 * @param {string} slug
 * @param {Object} guide - The guide payload at job kickoff
 * @returns {Promise<void>}
 */
async function runTtsJob(slug, guide) {
  const t0 = Date.now();
  try {
    const audioDir = resolve(__dirname, './public/audio');
    await mkdirP(audioDir, { recursive: true });
    const outPath = resolve(audioDir, `${slug}.wav`);

    const { audioWav, words, totalDuration } = await synthesizeGuide({
      transcript: guide.transcript,
      onProgress: ({ chunksDone, chunksTotal }) => {
        // Best-effort progress write — errors here shouldn't kill the job.
        db.updateGuideJob(slug, 'tts', { chunksDone, chunksTotal }).catch(() => {});
      },
    });

    await writeFile(outPath, audioWav);

    const fresh = await db.getGuide(slug);
    await db.upsertGuide({
      ...fresh,
      audio: `/audio/${slug}.wav`,
      duration: Math.round(totalDuration),
      timing: { words },
    });
    await db.updateGuideJob(slug, 'tts', {
      status: 'done',
      ms: Date.now() - t0,
      finishedAt: Date.now(),
      error: null,
    });
    logger.info('TTS job done', { slug, durationSec: totalDuration, words: words.length, ms: Date.now() - t0 });
  } catch (err) {
    logger.error('TTS job failed', { slug, error: err.message });
    await db.updateGuideJob(slug, 'tts', {
      status: 'failed',
      error: err.message || 'Unknown error',
      ms: Date.now() - t0,
      finishedAt: Date.now(),
    }).catch(() => {});
  }
}

// Re-scrape the source URL to fill in / refresh guide.date.
app.post("/api/guides/:slug/date", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);

    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);
    if (!guide.sourceUrl) return c.json({ error: "Guide has no source_url" }, 422);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(guide.sourceUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BookPlayerBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') return c.json({ error: 'Upstream fetch timed out after 15s' }, 504);
      throw err;
    }
    clearTimeout(timer);
    if (!res.ok) return c.json({ error: `Source returned HTTP ${res.status}` }, 502);

    const html = await res.text();
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    const date = extractDate(cleaned, html);
    if (!date) return c.json({ error: 'No publication date found on source page' }, 422);

    await db.upsertGuide({ ...guide, date });
    return c.json({ date });
  } catch (e) {
    logger.error('Date re-scrape error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: e.message || "Failed to re-scrape date" }, 500);
  }
});

// Generate a hero/cover image for the guide via Grok Imagine.
// No-op if guide.thumbnail is already set (e.g. from og:image at fetch-url).
app.post("/api/guides/:slug/thumbnail", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);

    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);
    if (guide.thumbnail) return c.json({ thumbnail: guide.thumbnail, skipped: true });
    if (!guide.transcript) return c.json({ error: "Guide has no transcript" }, 422);

    const t0 = Date.now();
    const prompt = `${guide.title}. ${guide.transcript.slice(0, 600)}. Editorial illustration, no text.`;
    const { buffer, contentType } = await generateImage({ prompt });
    const ext = extFromContentType(contentType);

    const dir = resolve(__dirname, `./public/images/${slug}`);
    await mkdirP(dir, { recursive: true });
    const outPath = resolve(dir, `cover.${ext}`);
    await writeFile(outPath, buffer);
    const thumbnail = `/images/${slug}/cover.${ext}`;

    const fresh = await db.getGuide(slug);
    await db.upsertGuide({ ...fresh, thumbnail });
    logger.info('Thumbnail generated', { slug, bytes: buffer.length, ms: Date.now() - t0 });
    return c.json({ thumbnail });
  } catch (e) {
    logger.error('Thumbnail error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: e.message || "Failed to generate thumbnail" }, 500);
  }
});

// Kick off Grok Imagine generation for each chapter that lacks image.generated.
// Background job (jobs.chapter-images). Concurrency cap = CHAPTER_IMAGE_CONCURRENCY.
app.post("/api/guides/:slug/chapter-images", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);

    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);
    if (!guide.chapters?.length) return c.json({ error: "Guide has no chapters" }, 422);
    if (guide.jobs?.['chapter-images']?.status === 'running') {
      return c.json({ jobId: 'chapter-images', status: 'running' }, 202);
    }

    const needed = guide.chapters.filter(ch => !ch.image?.generated).length;
    if (needed === 0) return c.json({ skipped: true, message: 'All chapters already have images' });
    if (needed > MAX_CHAPTER_IMAGES_PER_GUIDE) {
      return c.json({ error: `Too many images (${needed} > cap ${MAX_CHAPTER_IMAGES_PER_GUIDE})` }, 422);
    }

    await db.updateGuideJob(slug, 'chapter-images', {
      status: 'running',
      startedAt: Date.now(),
      chunksDone: 0,
      chunksTotal: needed,
      error: null,
    });

    runChapterImagesJob(slug).catch(err => {
      logger.error('chapter-images job crashed', { slug, error: err.message });
    });

    return c.json({ jobId: 'chapter-images', status: 'running' }, 202);
  } catch (e) {
    logger.error('chapter-images kickoff error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: e.message || "Failed to kick off chapter-images" }, 500);
  }
});

/**
 * Background job: generate one Grok Imagine image per chapter that lacks one.
 * Writes to /images/<slug>/generated/<idx>.<ext> and updates each chapter's
 * image.generated field. Concurrency capped by CHAPTER_IMAGE_CONCURRENCY.
 *
 * @param {string} slug
 * @returns {Promise<void>}
 */
async function runChapterImagesJob(slug) {
  const t0 = Date.now();
  try {
    const guide = await db.getGuide(slug);
    if (!guide) throw new Error('Guide vanished');
    const chapters = [...guide.chapters];
    const dir = resolve(__dirname, `./public/images/${slug}/generated`);
    await mkdirP(dir, { recursive: true });

    const todo = chapters
      .map((ch, idx) => ({ ch, idx }))
      .filter(({ ch }) => !ch.image?.generated);

    let done = 0;
    const tasks = todo.map(({ ch, idx }) => async () => {
      const prompt = `${ch.quote || ch.title}. Editorial illustration, no text.`;
      const { buffer, contentType } = await generateImage({ prompt });
      const ext = extFromContentType(contentType);
      const outPath = resolve(dir, `${idx}.${ext}`);
      await writeFile(outPath, buffer);
      chapters[idx] = { ...ch, image: { ...(ch.image || {}), generated: `/images/${slug}/generated/${idx}.${ext}` } };
      done += 1;
      await db.updateGuideJob(slug, 'chapter-images', { chunksDone: done }).catch(() => {});
    });

    await pLimit(CHAPTER_IMAGE_CONCURRENCY, tasks);

    const fresh = await db.getGuide(slug);
    await db.upsertGuide({ ...fresh, chapters });
    await db.updateGuideJob(slug, 'chapter-images', {
      status: 'done',
      ms: Date.now() - t0,
      finishedAt: Date.now(),
      error: null,
    });
    logger.info('chapter-images done', { slug, count: todo.length, ms: Date.now() - t0 });
  } catch (err) {
    logger.error('chapter-images failed', { slug, error: err.message });
    await db.updateGuideJob(slug, 'chapter-images', {
      status: 'failed',
      error: err.message || 'Unknown error',
      ms: Date.now() - t0,
      finishedAt: Date.now(),
    }).catch(() => {});
  }
}

// Search Unsplash per chapter and store the top hit as chapter.realImage.
// Background job. After completion, flips defaultViewMode to 'real' if any image landed.
app.post("/api/guides/:slug/chapter-real-images", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);

    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);
    if (!guide.chapters?.length) return c.json({ error: "Guide has no chapters" }, 422);
    if (!process.env.UNSPLASH_ACCESS_KEY) return c.json({ error: "UNSPLASH_ACCESS_KEY not set" }, 500);
    if (guide.jobs?.['chapter-real-images']?.status === 'running') {
      return c.json({ jobId: 'chapter-real-images', status: 'running' }, 202);
    }

    const needed = guide.chapters.filter(ch => !ch.realImage).length;
    if (needed === 0) return c.json({ skipped: true, message: 'All chapters already have realImage' });

    await db.updateGuideJob(slug, 'chapter-real-images', {
      status: 'running',
      startedAt: Date.now(),
      chunksDone: 0,
      chunksTotal: needed,
      error: null,
    });

    runChapterRealImagesJob(slug).catch(err => {
      logger.error('chapter-real-images job crashed', { slug, error: err.message });
    });

    return c.json({ jobId: 'chapter-real-images', status: 'running' }, 202);
  } catch (e) {
    logger.error('chapter-real-images kickoff error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: e.message || "Failed to kick off chapter-real-images" }, 500);
  }
});

/**
 * Background job: Unsplash-search one image per chapter (where missing),
 * download the top result, save under /images/<slug>/real/<idx>.<ext>,
 * and update chapter.realImage. After completion, flips defaultViewMode to
 * 'real' if any image was added.
 *
 * @param {string} slug
 * @returns {Promise<void>}
 */
async function runChapterRealImagesJob(slug) {
  const t0 = Date.now();
  try {
    const guide = await db.getGuide(slug);
    if (!guide) throw new Error('Guide vanished');
    const chapters = [...guide.chapters];
    const dir = resolve(__dirname, `./public/images/${slug}/real`);
    await mkdirP(dir, { recursive: true });

    const todo = chapters
      .map((ch, idx) => ({ ch, idx }))
      .filter(({ ch }) => !ch.realImage);

    let done = 0;
    let added = 0;
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    const tasks = todo.map(({ ch, idx }) => async () => {
      const q = `${ch.title || ''} ${guide.author || ''}`.trim();
      if (!q) { done += 1; return; }
      const url = `https://api.unsplash.com/search/photos?per_page=1&query=${encodeURIComponent(q)}`;
      const searchRes = await fetch(url, {
        headers: { 'Authorization': `Client-ID ${accessKey}` },
      });
      if (!searchRes.ok) {
        done += 1;
        await db.updateGuideJob(slug, 'chapter-real-images', { chunksDone: done }).catch(() => {});
        return;
      }
      const data = await searchRes.json();
      const photoUrl = data?.results?.[0]?.urls?.regular;
      if (!photoUrl) {
        done += 1;
        await db.updateGuideJob(slug, 'chapter-real-images', { chunksDone: done }).catch(() => {});
        return;
      }
      const imgRes = await fetch(photoUrl);
      if (!imgRes.ok) {
        done += 1;
        await db.updateGuideJob(slug, 'chapter-real-images', { chunksDone: done }).catch(() => {});
        return;
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const ext = extFromContentType(imgRes.headers.get('content-type'));
      const outPath = resolve(dir, `${idx}.${ext}`);
      await writeFile(outPath, buf);
      chapters[idx] = { ...ch, realImage: `/images/${slug}/real/${idx}.${ext}` };
      added += 1;
      done += 1;
      await db.updateGuideJob(slug, 'chapter-real-images', { chunksDone: done }).catch(() => {});
    });

    await pLimit(CHAPTER_IMAGE_CONCURRENCY, tasks);

    const fresh = await db.getGuide(slug);
    const update = { ...fresh, chapters };
    if (added > 0) update.defaultViewMode = 'real';
    await db.upsertGuide(update);
    await db.updateGuideJob(slug, 'chapter-real-images', {
      status: 'done',
      ms: Date.now() - t0,
      finishedAt: Date.now(),
      error: null,
    });
    logger.info('chapter-real-images done', { slug, added, ms: Date.now() - t0 });
  } catch (err) {
    logger.error('chapter-real-images failed', { slug, error: err.message });
    await db.updateGuideJob(slug, 'chapter-real-images', {
      status: 'failed',
      error: err.message || 'Unknown error',
      ms: Date.now() - t0,
      finishedAt: Date.now(),
    }).catch(() => {});
  }
}

/**
 * Backend-orchestrated pipeline: turn a freshly-created guide row (title +
 * transcript) into a fully-populated guide. ONE Grok call extracts author +
 * summary + chapter outlines; TTS + thumbnail run in parallel; chapter times
 * are attached locally after TTS produces word timings.
 *
 * Stages:
 *   1. parallel: analyze (author + summary + chapter outlines), thumbnail, tts
 *   2. attach chapter times (no API call) once words are available
 *   3. parallel: chapter-images, chapter-real-images
 *
 * Errors in one branch do not abort other branches.
 *
 * @param {string} slug
 * @returns {Promise<void>}
 */
async function runFullPipeline(slug) {
  const pipeT0 = Date.now();
  await db.updateGuideJob(slug, 'pipeline', { status: 'running', startedAt: Date.now(), error: null });

  const guide = await db.getGuide(slug);
  if (!guide) {
    await db.updateGuideJob(slug, 'pipeline', { status: 'failed', error: 'Guide not found' });
    return;
  }

  const stageA = await Promise.allSettled([
    runAnalyzeStep(slug),
    runThumbnailStep(slug),
    runTtsJobStaged(slug),
  ]);
  logStageOutcomes('stageA', slug, ['analyze', 'thumbnail', 'tts'], stageA);

  // Chapter timing is a local quote-match against word timings — no API call.
  await runChapterTimingStep(slug);

  const stageC = await Promise.allSettled([
    runChapterImagesJobStaged(slug),
    runChapterRealImagesJobStaged(slug),
  ]);
  logStageOutcomes('stageC', slug, ['chapter-images', 'chapter-real-images'], stageC);

  await db.updateGuideJob(slug, 'pipeline', {
    status: 'done',
    ms: Date.now() - pipeT0,
    finishedAt: Date.now(),
  });
  logger.info('Pipeline complete', { slug, ms: Date.now() - pipeT0 });
}

function logStageOutcomes(stage, slug, names, settled) {
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      logger.warn(`Pipeline ${stage} step failed`, { slug, step: names[i], error: r.reason?.message });
    }
  });
}

// Stage helpers — each updates its own jobs row + the guide row. Wrap the
// raw work in try/catch so one failure doesn't abort the pipeline.

async function runAnalyzeStep(slug) {
  const t0 = Date.now();
  try {
    const guide = await db.getGuide(slug);
    if (!guide?.transcript) return;
    // Skip only if everything analyze produces is already present.
    if (guide.summary && guide.author && guide.chapters?.length) return;
    await db.updateGuideJob(slug, 'analyze', { status: 'running', startedAt: Date.now(), error: null });
    const { author, summary, chapterOutlines } = await analyzeTranscript({
      transcript: guide.transcript,
      durationSec: guide.duration,
      sourceUrl: guide.sourceUrl,
    });
    const fresh = await db.getGuide(slug);
    const update = { ...fresh };
    if (summary) update.summary = summary;
    // Fill author only if we don't already have one — never overwrite a real value with null.
    if (!fresh.author && author) update.author = author;
    // Store outlines as chapters with time:0 placeholder. Times get attached later.
    if (chapterOutlines.length) {
      update.chapters = chapterOutlines.map(o => ({ ...o, time: 0 }));
    }
    await db.upsertGuide(update);
    await db.updateGuideJob(slug, 'analyze', {
      status: 'done',
      ms: Date.now() - t0,
      finishedAt: Date.now(),
      authorFound: !!author,
      chapters: chapterOutlines.length,
    });
  } catch (err) {
    logger.error('Pipeline analyze failed', { slug, error: err.message });
    await db.updateGuideJob(slug, 'analyze', { status: 'failed', error: err.message, ms: Date.now() - t0 }).catch(() => {});
    throw err;
  }
}

async function runThumbnailStep(slug) {
  const t0 = Date.now();
  try {
    const guide = await db.getGuide(slug);
    if (!guide?.transcript) return;
    if (guide.thumbnail) return; // og:image already set
    await db.updateGuideJob(slug, 'thumbnail', { status: 'running', startedAt: Date.now(), error: null });
    const prompt = `${guide.title}. ${guide.transcript.slice(0, 600)}. Editorial illustration, no text.`;
    const { buffer, contentType } = await generateImage({ prompt });
    const ext = extFromContentType(contentType);
    const dir = resolve(__dirname, `./public/images/${slug}`);
    await mkdirP(dir, { recursive: true });
    await writeFile(resolve(dir, `cover.${ext}`), buffer);
    const fresh = await db.getGuide(slug);
    await db.upsertGuide({ ...fresh, thumbnail: `/images/${slug}/cover.${ext}` });
    await db.updateGuideJob(slug, 'thumbnail', { status: 'done', ms: Date.now() - t0, finishedAt: Date.now() });
  } catch (err) {
    logger.error('Pipeline thumbnail failed', { slug, error: err.message });
    await db.updateGuideJob(slug, 'thumbnail', { status: 'failed', error: err.message, ms: Date.now() - t0 }).catch(() => {});
    throw err;
  }
}

async function runTtsJobStaged(slug) {
  const guide = await db.getGuide(slug);
  if (!guide?.transcript) return;
  if (guide.audio && guide.timing?.words?.length) return; // already done
  await db.updateGuideJob(slug, 'tts', { status: 'running', startedAt: Date.now(), chunksDone: 0, chunksTotal: 0, error: null });
  await runTtsJob(slug, guide);
  // Re-throw if it failed so Promise.allSettled records it
  const fresh = await db.getGuide(slug);
  if (fresh.jobs?.tts?.status === 'failed') {
    throw new Error(fresh.jobs.tts.error || 'tts failed');
  }
}

async function runChapterTimingStep(slug) {
  const t0 = Date.now();
  try {
    const guide = await db.getGuide(slug);
    if (!guide?.chapters?.length) {
      logger.warn('Skipping chapter-timing — no chapter outlines', { slug });
      return;
    }
    const words = guide.timing?.words;
    if (!Array.isArray(words) || !words.length) {
      logger.warn('Skipping chapter-timing — no word timings', { slug });
      return;
    }
    // Already timed? Skip — every chapter has time>0 except the first (time:0).
    if (guide.chapters.length > 1 && guide.chapters.slice(1).every(ch => Number(ch.time) > 0)) {
      return;
    }
    await db.updateGuideJob(slug, 'chapter-timing', { status: 'running', startedAt: Date.now(), error: null });
    const chapters = attachChapterTimes({ chapterOutlines: guide.chapters, words });
    if (chapters.length) {
      const fresh = await db.getGuide(slug);
      await db.upsertGuide({ ...fresh, chapters });
    }
    await db.updateGuideJob(slug, 'chapter-timing', {
      status: 'done',
      ms: Date.now() - t0,
      finishedAt: Date.now(),
      kept: chapters.length,
      dropped: guide.chapters.length - chapters.length,
    });
  } catch (err) {
    logger.error('Pipeline chapter-timing failed', { slug, error: err.message });
    await db.updateGuideJob(slug, 'chapter-timing', { status: 'failed', error: err.message, ms: Date.now() - t0 }).catch(() => {});
  }
}

async function runChapterImagesJobStaged(slug) {
  const guide = await db.getGuide(slug);
  if (!guide?.chapters?.length) return;
  const needed = guide.chapters.filter(ch => !ch.image?.generated).length;
  if (needed === 0) return;
  if (needed > MAX_CHAPTER_IMAGES_PER_GUIDE) {
    logger.warn('Skipping chapter-images — over cap', { slug, needed });
    return;
  }
  await db.updateGuideJob(slug, 'chapter-images', { status: 'running', startedAt: Date.now(), chunksDone: 0, chunksTotal: needed, error: null });
  await runChapterImagesJob(slug);
  const fresh = await db.getGuide(slug);
  if (fresh.jobs?.['chapter-images']?.status === 'failed') {
    throw new Error(fresh.jobs['chapter-images'].error || 'chapter-images failed');
  }
}

async function runChapterRealImagesJobStaged(slug) {
  if (!process.env.UNSPLASH_ACCESS_KEY) return; // skip if no key
  const guide = await db.getGuide(slug);
  if (!guide?.chapters?.length) return;
  const needed = guide.chapters.filter(ch => !ch.realImage).length;
  if (needed === 0) return;
  await db.updateGuideJob(slug, 'chapter-real-images', { status: 'running', startedAt: Date.now(), chunksDone: 0, chunksTotal: needed, error: null });
  await runChapterRealImagesJob(slug);
  const fresh = await db.getGuide(slug);
  if (fresh.jobs?.['chapter-real-images']?.status === 'failed') {
    throw new Error(fresh.jobs['chapter-real-images'].error || 'chapter-real-images failed');
  }
}

// Create a new guide. Open for now — see todo.md re: auth gating.
// Audio is uploaded in a follow-up call to POST /api/guides/:slug/audio.
app.post("/api/guides", async (c) => {
  try {
    const body = await parseJsonBody(c);
    if (!body) return c.json({ error: "Invalid request body" }, 400);

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return c.json({ error: "Title required" }, 400);
    if (title.length > 200) return c.json({ error: "Title too long" }, 400);

    const slug = (typeof body.slug === 'string' && body.slug.trim()) || slugify(title);
    if (!slug || !SLUG_REGEX.test(slug)) {
      return c.json({ error: "Invalid slug — use lowercase letters, numbers, and dashes" }, 400);
    }

    const existing = await db.getGuide(slug);
    if (existing) return c.json({ error: "A guide with this slug already exists", slug }, 409);

    await db.upsertGuide({
      slug,
      title,
      author: typeof body.author === 'string' ? body.author.trim() : null,
      date: typeof body.date === 'string' ? body.date.trim() : null,
      duration: Number.isFinite(body.duration) ? body.duration : null,
      thumbnail: typeof body.thumbnail === 'string' ? body.thumbnail.trim() : null,
      transcript: typeof body.transcript === 'string' ? body.transcript : null,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : null,
      // Default to 'generated' on create — real images don't exist until Section E lands.
      // Once a chapter gets a realImage, an enrichment job should flip this to 'real'.
      defaultViewMode: body.defaultViewMode === 'real' ? 'real' : 'generated',
      chapters: Array.isArray(body.chapters) ? body.chapters : [],
      timing: body.timing && typeof body.timing === 'object' ? body.timing : null,
      audio: typeof body.audio === 'string' ? body.audio.trim() : null,
      visibility: typeof body.visibility === 'string' ? body.visibility : 'public',
    });

    logger.info('Guide created', { slug });

    // Backend orchestrates the rest. Fire-and-forget — FE polls GET /api/guides/:slug.
    runFullPipeline(slug).catch(err => {
      logger.error('Pipeline crashed', { slug, error: err.message });
    });

    return c.json({ slug }, 201);
  } catch (e) {
    logger.error('Create guide error', { error: e.message });
    return c.json({ error: "Failed to create guide" }, 500);
  }
});

// Upload an MP3 for an existing guide. Writes to backend/public/audio/<slug>.mp3
// and updates the guide's audio_url to /audio/<slug>.mp3.
app.post("/api/guides/:slug/audio", async (c) => {
  try {
    const slug = c.req.param('slug');
    if (!SLUG_REGEX.test(slug)) return c.json({ error: "Invalid slug" }, 400);

    const guide = await db.getGuide(slug);
    if (!guide) return c.json({ error: "Guide not found" }, 404);

    const form = await c.req.parseBody();
    const file = form.audio;
    if (!file || typeof file === 'string') return c.json({ error: "Missing 'audio' file field" }, 400);
    if (!file.type || !file.type.startsWith('audio/')) {
      return c.json({ error: `Unsupported content-type: ${file.type || 'unknown'}` }, 415);
    }
    if (typeof file.size === 'number' && file.size > MAX_AUDIO_BYTES) {
      return c.json({ error: `File too large (max ${MAX_AUDIO_BYTES / 1024 / 1024} MB)` }, 413);
    }

    const audioDir = resolve(__dirname, './public/audio');
    await mkdirP(audioDir, { recursive: true });
    const outPath = resolve(audioDir, `${slug}.mp3`);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(outPath, buf);

    const audioUrl = `/audio/${slug}.mp3`;
    await db.upsertGuide({ ...guide, audio: audioUrl });

    logger.info('Audio uploaded', { slug, bytes: buf.length });
    return c.json({ audio: audioUrl, bytes: buf.length });
  } catch (e) {
    logger.error('Audio upload error', { error: e.message, slug: c.req.param('slug') });
    return c.json({ error: "Failed to upload audio" }, 500);
  }
});

/**
 * Parse JSON request body with proper error handling
 *
 * Returns parsed JSON or null if parsing fails. Sets 400 response on failure.
 * Handles SyntaxError from malformed JSON.
 *
 * @async
 * @param {Context} c - Hono context
 * @returns {Promise<Object|null>} Parsed body or null on error
 */
async function parseJsonBody(c) {
  try {
    return await c.req.json();
  } catch (e) {
    if (e instanceof SyntaxError) {
      return null;
    }
    throw e;
  }
}

// ==== AUTH ROUTES ====
app.post("/api/signup", async (c) => {
  try {
    const body = await parseJsonBody(c);
    if (!body) {
      return c.json({ error: 'Invalid request body' }, 400);
    }
    let { email, password, name } = body;

    // Validation
    if (!validateEmail(email)) {
      return c.json({ error: 'Invalid email format or length' }, 400);
    }
    if (!validatePassword(password)) {
      return c.json({ error: 'Password must be 6-72 characters' }, 400);
    }
    if (!validateName(name)) {
      return c.json({ error: 'Name required (max 100 characters)' }, 400);
    }

    email = email.toLowerCase().trim();
    name = escapeHtml(name.trim());

    const hash = await hashPassword(password);
    let insertID = generateUUID()

    try {
      // Insert user first
      await db.insertUser({
        _id: insertID,
        email: email,
        name: name,
        created_at: Date.now()
      });

      // Insert auth record (compensating delete on failure)
      try {
        await db.insertAuth({ email: email, password: hash, userID: insertID });
      } catch (authError) {
        // Rollback: delete the user we just created
        logger.error('Auth insert failed, rolling back user creation', { error: authError.message });
        try {
          await db.executeQuery({ query: 'DELETE FROM Users WHERE _id = ?', params: [insertID] });
        } catch (rollbackError) {
          logger.error('Rollback failed - orphaned user record', { userID: insertID, error: rollbackError.message });
        }
        throw authError;
      }

      const token = await generateToken(insertID);
      setAuthCookies(c, insertID, token);
      logger.info('Signup success');

      return c.json({
        id: insertID.toString(),
        email: email,
        name: name.trim(),
        tokenExpires: tokenExpireTimestamp()
      }, 201);
    } catch (e) {
      if (e.message?.includes('UNIQUE constraint failed') || e.message?.includes('duplicate key') || e.code === 11000) {
        logger.warn('Signup failed - duplicate account');
        return c.json({ error: "Unable to create account with provided credentials" }, 400);
      }
      throw e;
    }
  } catch (e) {
    logger.error('Signup error', { error: e.message });
    return c.json({ error: "Server error" }, 500);
  }
});

app.post("/api/signin", async (c) => {
  try {
    const body = await parseJsonBody(c);
    if (!body) {
      return c.json({ error: 'Invalid request body' }, 400);
    }
    let { email, password } = body;

    // Validation
    if (!validateEmail(email)) {
      return c.json({ error: 'Invalid credentials' }, 400);
    }
    if (!password || typeof password !== 'string') {
      return c.json({ error: 'Invalid credentials' }, 400);
    }

    email = email.toLowerCase().trim();
    logger.debug('Attempting signin');

    // Check account lockout
    const lockStatus = isAccountLocked(email);
    if (lockStatus.locked) {
      c.header('Retry-After', String(lockStatus.remainingTime));
      return c.json({
        error: 'Account temporarily locked. Try again later.',
        retryAfter: lockStatus.remainingTime
      }, 429);
    }

    // Check if auth exists
    const auth = await db.findAuth( { email: email });
    if (!auth) {
      logger.debug('Auth record not found');
      recordFailedLogin(email);
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Verify password
    if (!(await verifyPassword(password, auth.password))) {
      logger.debug('Password verification failed');
      recordFailedLogin(email);
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Lazy migrate legacy bcrypt hash to scrypt (best-effort, never blocks login)
    if (needsRehash(auth.password)) {
      try {
        const newHash = await hashPassword(password);
        await db.updateAuth({ email }, { password: newHash });
        logger.debug('Password hash migrated to scrypt');
      } catch (e) {
        logger.warn('Password rehash failed', { error: e.message });
      }
    }

    // Get user
    const user = await db.findUser( { email: email });
    if (!user) {
      logger.error('User not found for auth record');
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Clear failed attempts on successful login
    clearFailedLogins(email);

    // Generate token
    const token = await generateToken(user._id.toString());
    setAuthCookies(c, user._id, token);
    logger.info('Signin success');

    return c.json({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      ...(user.subscription && {
        subscription: {
          stripeID: user.subscription.stripeID,
          expires: user.subscription.expires,
          status: user.subscription.status,
        },
      }),
      tokenExpires: tokenExpireTimestamp()
    });
  } catch (e) {
    logger.error('Signin error', { error: e.message });
    return c.json({ error: "Server error" }, 500);
  }
});

app.post("/api/signout", authMiddleware, async (c) => {
  try {
    const userID = c.get('userID');

    // Clear CSRF token from store
    csrfTokenStore.delete(userID);

    // Clear the HttpOnly cookie
    deleteCookie(c, 'token', {
      httpOnly: true,
      secure: isProd(),
      sameSite: 'Strict',
      path: '/'
    });

    // Clear the CSRF token cookie
    deleteCookie(c, 'csrf_token', {
      httpOnly: false,
      secure: isProd(),
      sameSite: 'Lax',
      path: '/'
    });

    logger.info('Signout success');
    return c.json({ message: "Signed out successfully" });
  } catch (e) {
    logger.error('Signout error', { error: e.message });
    return c.json({ error: "Server error" }, 500);
  }
});

// ==== USER DATA ROUTES ====
app.get("/api/me", authMiddleware, async (c) => {
  const userID = c.get('userID');
  const user = await db.findUser( { _id: userID });
  logger.debug('/me checking for user');
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

app.put("/api/me", authMiddleware, csrfProtection, async (c) => {
  try {
    const userID = c.get('userID');
    const body = await c.req.json();
    const { name } = body;

    // Validation
    if (name !== undefined && !validateName(name)) {
      return c.json({ error: 'Name must be 1-100 characters' }, 400);
    }

    // Whitelist of fields users are allowed to update
    const UPDATEABLE_USER_FIELDS = ['name'];

    // Find user first to verify existence
    const user = await db.findUser( { _id: userID });
    if (!user) return c.json({ error: "User not found" }, 404);

    // Whitelist approach - only allow specific fields
    const update = {};
    for (const [key, value] of Object.entries(body)) {
      if (UPDATEABLE_USER_FIELDS.includes(key)) {
        // Sanitize string values to prevent XSS
        update[key] = typeof value === 'string' ? escapeHtml(value.trim()) : value;
      }
    }

    if (Object.keys(update).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    // Update user document
    const result = await db.updateUser( { _id: userID }, { $set: update });

    if (result.modifiedCount === 0) {
      return c.json({ error: "No changes made" }, 400);
    }

    // Return updated user
    const updatedUser = await db.findUser( { _id: userID });
    return c.json(updatedUser);
  } catch (err) {
    logger.error('Update user error', { error: err.message });
    return c.json({ error: "Failed to update user" }, 500);
  }
});

// ==== USAGE TRACKING ====
app.post("/api/usage", authMiddleware, async (c) => {
  try {
    const userID = c.get('userID');
    const body = await c.req.json();
    const { operation } = body; // "check" or "track"

    if (!operation || !['check', 'track'].includes(operation)) {
      return c.json({ error: "Invalid operation. Must be 'check' or 'track'" }, 400);
    }

    // Get user
    const user = await db.findUser( { _id: userID });
    if (!user) return c.json({ error: "User not found" }, 404);

    // Check if user is a subscriber - subscribers get unlimited
    const isSubscriber = user.subscription?.status === 'active' &&
      (!user.subscription?.expires || user.subscription.expires > Math.floor(Date.now() / 1000));

    if (isSubscriber) {
      return c.json({
        remaining: -1,
        total: -1,
        isSubscriber: true,
        subscription: {
          status: user.subscription.status,
          expiresAt: user.subscription.expires ? new Date(user.subscription.expires * 1000).toISOString() : null
        }
      });
    }

    // Get usage limit from environment
    const limit = parseInt(process.env.FREE_USAGE_LIMIT || '20');
    const now = Math.floor(Date.now() / 1000);

    // Initialize usage if not set
    let usage = user.usage || { count: 0, reset_at: null };

    // Check if we need to reset (30 days = 2592000 seconds)
    if (!usage.reset_at || now > usage.reset_at) {
      const newResetAt = now + (30 * 24 * 60 * 60); // 30 days from now
      // Reset usage - atomic set operation
      await db.updateUser(
        { _id: userID },
        { $set: { usage: { count: 0, reset_at: newResetAt } } }
      );
      usage = { count: 0, reset_at: newResetAt };
    }

    if (operation === 'track') {
      // Atomic increment first to prevent race conditions
      // Then verify we haven't exceeded the limit
      await db.updateUser(
        { _id: userID },
        { $inc: { 'usage.count': 1 } }
      );

      // Re-read user to get actual count after atomic increment
      const updatedUser = await db.findUser( { _id: userID });
      const actualCount = updatedUser?.usage?.count || 1;

      // If we exceeded the limit, rollback the increment and return 429
      if (actualCount > limit) {
        await db.updateUser(
          { _id: userID },
          { $inc: { 'usage.count': -1 } }
        );
        return c.json({
          error: "Usage limit reached",
          remaining: 0,
          total: limit,
          isSubscriber: false
        }, 429);
      }

      usage.count = actualCount;
    }

    // Return usage info (with subscription details for free users too)
    return c.json({
      remaining: Math.max(0, limit - usage.count),
      total: limit,
      isSubscriber: false,
      used: usage.count,
      subscription: user.subscription ? {
        status: user.subscription.status,
        expiresAt: user.subscription.expires ? new Date(user.subscription.expires * 1000).toISOString() : null
      } : null
    });

  } catch (error) {
    logger.error('Usage tracking error', { error: error.message });
    return c.json({ error: "Server error" }, 500);
  }
});

// ==== PAYMENT ROUTES ====
app.post("/api/checkout", authMiddleware, csrfProtection, async (c) => {
  try {
    const userID = c.get('userID');
    const body = await c.req.json();
    const { email, lookup_key } = body;

    if (!email || !lookup_key) return c.json({ error: "Missing email or lookup_key" }, 400);

    // Verify the email matches the authenticated user
    const user = await db.findUser( { _id: userID });
    if (!user || user.email !== email) return c.json({ error: "Email mismatch" }, 403);

    const prices = await stripe.prices.list({ lookup_keys: [lookup_key], expand: ["data.product"] });

    if (!prices.data || prices.data.length === 0) {
      return c.json({ error: `No price found for lookup_key: ${lookup_key}` }, 400);
    }

    // Use FRONTEND_URL env var or origin header, fallback to localhost for dev
    const origin = process.env.FRONTEND_URL || c.req.header('origin') || `http://localhost:${port}`;

    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: prices.data[0].id, quantity: 1 }],
      billing_address_collection: "auto",
      success_url: `${origin}/app/payment?success=true`,
      cancel_url: `${origin}/app/payment?canceled=true`,
      subscription_data: { metadata: { email } },
    });
    return c.json({ url: session.url, id: session.id, customerID: session.customer });
  } catch (e) {
    logger.error('Checkout session error', { error: e.message });
    return c.json({ error: "Stripe session failed" }, 500);
  }
});

app.post("/api/portal", authMiddleware, csrfProtection, async (c) => {
  try {
    const userID = c.get('userID');
    const body = await c.req.json();
    const { customerID } = body;

    if (!customerID) return c.json({ error: "Missing customerID" }, 400);

    // Verify the customerID matches the authenticated user's subscription
    const user = await db.findUser( { _id: userID });
    if (!user || (user.subscription?.stripeID && user.subscription.stripeID !== customerID)) {
      return c.json({ error: "Unauthorized customerID" }, 403);
    }

    // Use FRONTEND_URL env var or origin header, fallback to localhost for dev
    const origin = process.env.FRONTEND_URL || c.req.header('origin') || `http://localhost:${port}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerID,
      return_url: `${origin}/app/payment?portal=return`,
    });
    return c.json({ url: portalSession.url, id: portalSession.id });
  } catch (e) {
    logger.error('Portal session error', { error: e.message });
    return c.json({ error: "Stripe portal failed" }, 500);
  }
});

// ==== STATIC FILE SERVING (Production) ====
const staticDir = resolve(__dirname, config.staticDir);
const backendPublicDir = resolve(__dirname, './public');

// Content assets (audio + images) live under backend/public/ so they're served by
// Hono in both dev (via Vite proxy) and prod. Mount before the SPA static catch-all.
app.use('/audio/*', serveStatic({ root: backendPublicDir }));
app.use('/images/*', serveStatic({ root: backendPublicDir }));

// Serve static files
app.use('/*', serveStatic({ root: staticDir }));

// SPA fallback — only for non-asset routes
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api/') || c.req.path.match(/\.\w+$/)) {
    return c.notFound();
  }
  try {
    const indexPath = resolve(staticDir, 'index.html');
    const file = await promisify(readFile)(indexPath);
    return c.html(new TextDecoder().decode(file));
  } catch {
    return c.text("Welcome to Skateboard API", 200);
  }
});

// ==== ERROR HANDLER ====
app.onError((err, c) => {
  const requestId = Math.random().toString(36).substr(2, 9);

  logger.error('Unhandled error occurred', {
    message: err.message,
    stack: !isProd() ? err.stack : undefined,
    path: c.req.path,
    method: c.req.method,
    requestId
  });

  return c.json({
    error: !isProd() ? err.message : 'Internal server error',
    ...(!isProd() && { stack: err.stack })
  }, 500);
});

// ==== UTILITY FUNCTIONS ====

/**
 * Check if the server is running in production mode
 *
 * Reads the NODE_ENV environment variable. Returns true only when
 * NODE_ENV is explicitly set to "production".
 *
 * @returns {boolean} True if NODE_ENV === "production"
 */
function isProd() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Load environment variables from .env and optional .env.local file.
 *
 * Reads in two passes: backend/.env first (may be symlink to shared creds),
 * then backend/.env.local for project-specific overrides (wins on conflict).
 * Creates .env from .env.example if it doesn't exist. Only called in
 * non-production mode — Railway injects vars directly in prod.
 *
 * @returns {void}
 */
function loadLocalENV() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const envFilePath = resolve(__dirname, './.env');
  const envLocalPath = resolve(__dirname, './.env.local');
  const envExamplePath = resolve(__dirname, './.env.example');

  // Check if .env exists, if not create it from .env.example
  try {
    statSync(envFilePath);
  } catch (err) {
    try {
      const exampleData = readFileSync(envExamplePath, 'utf8');
      writeFileSync(envFilePath, exampleData);
    } catch (exampleErr) {
      logger.error('Failed to create .env from template', { error: exampleErr.message });
      return;
    }
  }

  // Load .env (may be symlink to shared creds)
  loadEnvFile(envFilePath);

  // Load .env.local overrides (project-specific, optional)
  loadEnvFile(envLocalPath);
}

/**
 * Parse a .env file and apply key=value pairs to process.env.
 * Skips blank lines and comments. Handles quoted values and values containing '='.
 * Silently skips if file doesn't exist.
 * @param {string} filePath - Absolute path to the .env file
 * @returns {void}
 */
function loadEnvFile(filePath) {
  try {
    const data = readFileSync(filePath, 'utf8');
    for (let line of data.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      let [key, ...valueParts] = line.split('=');
      let value = valueParts.join('=');
      if (key && value) {
        key = key.trim();
        value = value.trim().replace(/^["']|["']$/g, '');
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist or unreadable — silent
  }
}

// ==== SERVER STARTUP ====
const server = serve({
  fetch: app.fetch,
  port,
  hostname: '::'  // Listen on both IPv4 and IPv6
}, (info) => {
  logger.info('Server started successfully', {
    port: info.port,
    environment: !isProd() ? 'development' : 'production'
  });
});

// Handle graceful shutdown on SIGTERM and SIGINT - NEED THIS FOR PROXY
if (typeof process !== 'undefined') {
  const gracefulShutdown = async (signal) => {
    console.log(`${signal} received. Shutting down gracefully...`);

    // Close HTTP server first
    server.close(async () => {
      console.log('Server closed');

      // Close all database connections with error handling
      try {
        await databaseManager.closeAll();
        console.log('Database connections closed');
      } catch (err) {
        console.error('Error closing database connections:', err);
      }

      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
