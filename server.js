require('dotenv').config();
const PDFDocument = require('pdfkit');
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { createClient } = require('redis');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CERT_TOKEN_SECRET = process.env.CERT_TOKEN_SECRET || 'change-me-in-production';

const LIMITS = {
    NAME_MAX: 80,
    TITLE_MAX: 120,
    DESCRIPTION_MAX: 600,
    QUESTION_MAX: 1500,
    OPTION_MAX: 400,
    ANSWER_MAP_MAX: 300
};

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('CORS not allowed'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';");
    next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let redisClient = null;
let redisEnabled = false;

async function initRedis() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        console.log('Redis disabled: REDIS_URL not set (using in-memory fallback)');
        return;
    }

    try {
        redisClient = createClient({ url: redisUrl });
        redisClient.on('error', error => {
            console.error('Redis client error:', error.message);
        });
        await redisClient.connect();
        redisEnabled = true;
        console.log('Redis connected: persistent sessions/rate limiting enabled');
    } catch (error) {
        redisEnabled = false;
        redisClient = null;
        console.error('Redis unavailable, falling back to memory:', error.message);
    }
}

const memoryRateLimitBuckets = new Map();
function rateLimit({ key, maxRequests = 30, windowMs = 60_000 }) {
    return async (req, res, next) => {
        try {
            const ip = req.ip || req.socket?.remoteAddress || 'unknown';
            const bucketKey = `qe:rl:${key}:${ip}`;

            if (redisEnabled && redisClient) {
                const count = await redisClient.incr(bucketKey);
                if (count === 1) {
                    await redisClient.pExpire(bucketKey, windowMs);
                }

                if (count > maxRequests) {
                    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
                }

                return next();
            }

            const now = Date.now();
            const existing = memoryRateLimitBuckets.get(bucketKey) || [];
            const recent = existing.filter(timestamp => now - timestamp < windowMs);

            if (recent.length >= maxRequests) {
                return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
            }

            recent.push(now);
            memoryRateLimitBuckets.set(bucketKey, recent);
            return next();
        } catch (error) {
            console.error('Rate limit failure:', error.message);
            return next();
        }
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [bucketKey, timestamps] of memoryRateLimitBuckets.entries()) {
        const valid = timestamps.filter(timestamp => now - timestamp < 60_000);
        if (valid.length === 0) memoryRateLimitBuckets.delete(bucketKey);
        else memoryRateLimitBuckets.set(bucketKey, valid);
    }
}, 300_000);

const memorySessions = new Map();

function createSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function createSession(teacherId, email) {
    const token = createSessionToken();
    const sessionData = JSON.stringify({
        teacherId,
        email,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS
    });

    if (redisEnabled && redisClient) {
        await redisClient.set(`qe:sess:${token}`, sessionData, {
            PX: SESSION_TTL_MS
        });
        return token;
    }

    memorySessions.set(token, JSON.parse(sessionData));
    return token;
}

async function getSession(token) {
    if (!token) return null;

    if (redisEnabled && redisClient) {
        const raw = await redisClient.get(`qe:sess:${token}`);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (parsed.expiresAt <= Date.now()) {
            await redisClient.del(`qe:sess:${token}`);
            return null;
        }

        parsed.expiresAt = Date.now() + SESSION_TTL_MS;
        await redisClient.set(`qe:sess:${token}`, JSON.stringify(parsed), {
            PX: SESSION_TTL_MS
        });
        return parsed;
    }

    const session = memorySessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
        memorySessions.delete(token);
        return null;
    }

    session.expiresAt = Date.now() + SESSION_TTL_MS;
    memorySessions.set(token, session);
    return session;
}

async function deleteSession(token) {
    if (!token) return;

    if (redisEnabled && redisClient) {
        await redisClient.del(`qe:sess:${token}`);
        return;
    }

    memorySessions.delete(token);
}

setInterval(() => {
    const now = Date.now();
    for (const [token, session] of memorySessions.entries()) {
        if (session.expiresAt <= now) {
            memorySessions.delete(token);
        }
    }
}, 1_800_000);

function sanitize(value) {
    if (typeof value !== 'string') return value;
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function normalizeText(value, { min = 0, max = 200, label = 'Value' } = {}) {
    if (typeof value !== 'string') {
        throw new Error(`${label} is required`);
    }

    const cleaned = value.trim();
    if (cleaned.length < min) {
        throw new Error(`${label} must be at least ${min} characters`);
    }
    if (cleaned.length > max) {
        throw new Error(`${label} must be at most ${max} characters`);
    }

    return cleaned;
}

function parsePositiveInt(value) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return null;
    return numeric;
}

function getBearerToken(req) {
    const auth = req.headers.authorization || '';
    const [prefix, token] = auth.split(' ');
    if (prefix !== 'Bearer' || !token || token.length < 20) {
        return null;
    }
    return token;
}

function safeCompare(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b || '');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function createCertificateToken(resultId, accessCodeId, candidateName) {
    return crypto
        .createHmac('sha256', CERT_TOKEN_SECRET)
        .update(`${resultId}:${accessCodeId || 0}:${candidateName}`)
        .digest('hex');
}

function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'quiz_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const dbPromise = db.promise();

async function query(sql, values = []) {
    const [rows] = await dbPromise.query(sql, values);
    return rows;
}

db.getConnection((err, connection) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        return;
    }
    console.log('Successfully connected to MySQL database.');
    connection.release();
});

async function validateSession(req, res, next) {
    try {
        const token = getBearerToken(req);
        if (!token) {
            return res.status(401).json({ error: 'Session expired. Please log in again.' });
        }

        const session = await getSession(token);
        if (!session) {
            return res.status(401).json({ error: 'Session expired. Please log in again.' });
        }

        req.teacherId = session.teacherId;
        req.sessionEmail = session.email;
        return next();
    } catch (error) {
        console.error('Session validation failed:', error.message);
        return res.status(500).json({ error: 'Unable to validate session' });
    }
}

app.get('/api/test', asyncHandler(async (req, res) => {
    await query('SELECT 1');
    res.json({
        message: 'Quiz Engine API is running smoothly!',
        redis: redisEnabled ? 'connected' : 'fallback-memory',
        timestamp: new Date().toISOString()
    });
}));

app.post('/api/teacher/register', rateLimit({ key: 'register', maxRequests: 5 }), asyncHandler(async (req, res) => {
    const email = normalizeText(req.body.email, { min: 5, max: 255, label: 'Email' }).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const name = normalizeText(req.body.name, { min: 2, max: LIMITS.NAME_MAX, label: 'Name' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    try {
        const result = await query(
            'INSERT INTO teachers (email, password_hash, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name]
        );

        const sessionToken = await createSession(result.insertId, email);
        res.json({
            message: 'Registration successful',
            sessionToken,
            teacherId: result.insertId,
            name
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email already registered' });
        }
        throw error;
    }
}));

app.post('/api/teacher/login', rateLimit({ key: 'login', maxRequests: 10 }), asyncHandler(async (req, res) => {
    const email = normalizeText(req.body.email, { min: 5, max: 255, label: 'Email' }).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    const rows = await query(
        'SELECT id, password_hash, name FROM teachers WHERE email = ? LIMIT 1',
        [email]
    );

    if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    const teacher = rows[0];
    const validPassword = await bcrypt.compare(password, teacher.password_hash);
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    const sessionToken = await createSession(teacher.id, email);
    res.json({
        message: 'Login successful',
        sessionToken,
        teacherId: teacher.id,
        name: teacher.name
    });
}));

app.post('/api/teacher/logout', asyncHandler(async (req, res) => {
    const token = getBearerToken(req);
    await deleteSession(token);
    res.json({ message: 'Logged out' });
}));

app.post('/api/quiz/create', validateSession, asyncHandler(async (req, res) => {
    const title = normalizeText(req.body.title, { min: 2, max: LIMITS.TITLE_MAX, label: 'Quiz title' });
    const descriptionRaw = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const description = sanitize(descriptionRaw.slice(0, LIMITS.DESCRIPTION_MAX));
    const passScore = Number.parseInt(req.body.passing_score_percentage, 10) || 75;

    if (!Number.isInteger(passScore) || passScore < 1 || passScore > 100) {
        return res.status(400).json({ error: 'Passing score must be between 1 and 100' });
    }

    const result = await query(
        'INSERT INTO quizzes (teacher_id, title, description, passing_score_percentage) VALUES (?, ?, ?, ?)',
        [req.teacherId, title, description, passScore]
    );

    res.json({ message: 'Quiz created successfully', quizId: result.insertId });
}));

app.delete('/api/quiz/:quizId', validateSession, asyncHandler(async (req, res) => {
    const quizId = parsePositiveInt(req.params.quizId);
    if (!quizId) {
        return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    const result = await query(
        'DELETE FROM quizzes WHERE id = ? AND teacher_id = ?',
        [quizId, req.teacherId]
    );

    if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Quiz not found or unauthorized' });
    }

    res.json({ message: 'Quiz deleted successfully' });
}));

app.post('/api/quiz/:quizId/question', validateSession, asyncHandler(async (req, res) => {
    const quizId = parsePositiveInt(req.params.quizId);
    if (!quizId) {
        return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    const questionText = normalizeText(req.body.question_text, { min: 5, max: LIMITS.QUESTION_MAX, label: 'Question text' });
    const optionA = normalizeText(req.body.option_a, { min: 1, max: LIMITS.OPTION_MAX, label: 'Option A' });
    const optionB = normalizeText(req.body.option_b, { min: 1, max: LIMITS.OPTION_MAX, label: 'Option B' });
    const optionC = normalizeText(req.body.option_c, { min: 1, max: LIMITS.OPTION_MAX, label: 'Option C' });
    const optionD = normalizeText(req.body.option_d, { min: 1, max: LIMITS.OPTION_MAX, label: 'Option D' });
    const correctOption = normalizeText(req.body.correct_option, { min: 1, max: 1, label: 'Correct option' }).toUpperCase();

    if (!['A', 'B', 'C', 'D'].includes(correctOption)) {
        return res.status(400).json({ error: 'Correct option must be A, B, C, or D' });
    }

    const quizRows = await query(
        'SELECT id FROM quizzes WHERE id = ? AND teacher_id = ? LIMIT 1',
        [quizId, req.teacherId]
    );

    if (quizRows.length === 0) {
        return res.status(403).json({ error: 'Quiz not found or unauthorized' });
    }

    const result = await query(
        'INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [quizId, questionText, optionA, optionB, optionC, optionD, correctOption]
    );

    res.json({ message: 'Question added successfully', questionId: result.insertId });
}));

app.delete('/api/quiz/:quizId/question/:questionId', validateSession, asyncHandler(async (req, res) => {
    const quizId = parsePositiveInt(req.params.quizId);
    const questionId = parsePositiveInt(req.params.questionId);

    if (!quizId || !questionId) {
        return res.status(400).json({ error: 'Invalid quiz or question ID' });
    }

    const quizRows = await query(
        'SELECT id FROM quizzes WHERE id = ? AND teacher_id = ? LIMIT 1',
        [quizId, req.teacherId]
    );

    if (quizRows.length === 0) {
        return res.status(403).json({ error: 'Quiz not found or unauthorized' });
    }

    const result = await query(
        'DELETE FROM questions WHERE id = ? AND quiz_id = ?',
        [questionId, quizId]
    );

    if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Question not found' });
    }

    res.json({ message: 'Question deleted successfully' });
}));

const ASI_API_KEY = process.env.ASI_API_KEY || '';

app.post('/api/quiz/:quizId/generate-questions', validateSession, rateLimit({ key: 'ai-generate', maxRequests: 5 }), asyncHandler(async (req, res) => {
    if (!ASI_API_KEY) {
        return res.status(503).json({ error: 'AI generation is not configured. Please set ASI_API_KEY.' });
    }

    const quizId = parsePositiveInt(req.params.quizId);
    if (!quizId) {
        return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    const quizRows = await query(
        'SELECT id FROM quizzes WHERE id = ? AND teacher_id = ? LIMIT 1',
        [quizId, req.teacherId]
    );

    if (quizRows.length === 0) {
        return res.status(403).json({ error: 'Quiz not found or unauthorized' });
    }

    const topic = normalizeText(req.body.topic, { min: 3, max: 200, label: 'Topic' });
    const depth = req.body.depth;
    const difficulty = req.body.difficulty;
    const numberOfQuestions = parsePositiveInt(req.body.numberOfQuestions);

    if (!['basic', 'intermediate', 'advanced'].includes(depth)) {
        return res.status(400).json({ error: 'Depth must be basic, intermediate, or advanced' });
    }

    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
        return res.status(400).json({ error: 'Difficulty must be easy, medium, or hard' });
    }

    if (!numberOfQuestions || numberOfQuestions < 1 || numberOfQuestions > 20) {
        return res.status(400).json({ error: 'Number of questions must be between 1 and 20' });
    }

    const prompt = `Generate exactly ${numberOfQuestions} multiple choice questions about "${topic}".

Topic depth: ${depth} (${depth === 'basic' ? 'surface-level concepts' : depth === 'intermediate' ? 'moderate detail and understanding' : 'in-depth, expert-level knowledge'})
Difficulty: ${difficulty} (${difficulty === 'easy' ? 'straightforward, recall-based' : difficulty === 'medium' ? 'requires understanding and application' : 'challenging, requires analysis and deep knowledge'})

Rules:
- Each question must have exactly 4 options (A, B, C, D)
- Exactly one option must be correct
- All 4 options must be different from each other
- Questions should be clear and unambiguous
- Options should be plausible (no obviously wrong answers)

Respond ONLY with a JSON array, no other text. Each object must have these exact fields:
[
  {
    "question_text": "The question here?",
    "option_a": "First option",
    "option_b": "Second option",
    "option_c": "Third option",
    "option_d": "Fourth option",
    "correct_option": "A"
  }
]

correct_option must be exactly one of: "A", "B", "C", "D"`;

    let aiResponse;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 55000);

        const response = await fetch('https://api.asi1.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ASI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'asi1-mini',
                messages: [
                    { role: 'system', content: 'You are a quiz question generator. You ONLY respond with valid JSON arrays. No markdown, no explanations, just the JSON array.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 4000
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error('ASI:One API error:', response.status, errorBody);
            return res.status(502).json({ error: 'AI service returned an error. Please try again.' });
        }

        aiResponse = await response.json();
    } catch (error) {
        if (error.name === 'AbortError') {
            return res.status(504).json({ error: 'AI service timed out. Please try again with fewer questions.' });
        }
        console.error('ASI:One API call failed:', error.message);
        return res.status(502).json({ error: 'Failed to connect to AI service. Please try again.' });
    }

    let generatedQuestions;
    try {
        let content = aiResponse.choices?.[0]?.message?.content || '';
        content = content.trim();

        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error('No JSON array found in response');
        }

        generatedQuestions = JSON.parse(jsonMatch[0]);

        if (!Array.isArray(generatedQuestions) || generatedQuestions.length === 0) {
            throw new Error('Empty or invalid question array');
        }
    } catch (error) {
        console.error('Failed to parse AI response:', error.message);
        return res.status(502).json({ error: 'AI returned an invalid response. Please try again.' });
    }

    const insertedQuestions = [];
    for (const q of generatedQuestions) {
        try {
            const qText = normalizeText(q.question_text, { min: 5, max: LIMITS.QUESTION_MAX, label: 'Question' });
            const optA = normalizeText(q.option_a, { min: 1, max: LIMITS.OPTION_MAX, label: 'Option A' });
            const optB = normalizeText(q.option_b, { min: 1, max: LIMITS.OPTION_MAX, label: 'Option B' });
            const optC = normalizeText(q.option_c, { min: 1, max: LIMITS.OPTION_MAX, label: 'Option C' });
            const optD = normalizeText(q.option_d, { min: 1, max: LIMITS.OPTION_MAX, label: 'Option D' });
            const correct = (typeof q.correct_option === 'string' ? q.correct_option.trim().toUpperCase() : '');

            if (!['A', 'B', 'C', 'D'].includes(correct)) continue;

            const result = await query(
                'INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [quizId, qText, optA, optB, optC, optD, correct]
            );

            insertedQuestions.push({ id: result.insertId, question_text: qText, option_a: optA, option_b: optB, option_c: optC, option_d: optD, correct_option: correct });
        } catch {
            continue;
        }
    }

    if (insertedQuestions.length === 0) {
        return res.status(502).json({ error: 'AI generated questions but none were valid. Please try again.' });
    }

    res.json({
        message: `Successfully generated ${insertedQuestions.length} question${insertedQuestions.length > 1 ? 's' : ''}`,
        questions: insertedQuestions,
        count: insertedQuestions.length
    });
}));

app.get('/api/quiz/:quizId/questions', validateSession, asyncHandler(async (req, res) => {
    const quizId = parsePositiveInt(req.params.quizId);
    if (!quizId) {
        return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    const quizRows = await query(
        'SELECT id FROM quizzes WHERE id = ? AND teacher_id = ? LIMIT 1',
        [quizId, req.teacherId]
    );

    if (quizRows.length === 0) {
        return res.status(403).json({ error: 'Quiz not found or unauthorized' });
    }

    const questions = await query(
        'SELECT id, question_text, option_a, option_b, option_c, option_d, correct_option FROM questions WHERE quiz_id = ? ORDER BY id',
        [quizId]
    );

    res.json(questions);
}));

app.get('/api/teacher/quizzes', validateSession, asyncHandler(async (req, res) => {
    const quizzes = await query(
        `SELECT q.id, q.title, q.description, q.passing_score_percentage, q.created_at,
         (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count,
         (SELECT COUNT(*) FROM results WHERE quiz_id = q.id) AS attempt_count
         FROM quizzes q WHERE q.teacher_id = ? ORDER BY q.created_at DESC`,
        [req.teacherId]
    );

    res.json(quizzes);
}));

app.get('/api/quiz/:quizId/results', validateSession, asyncHandler(async (req, res) => {
    const quizId = parsePositiveInt(req.params.quizId);
    if (!quizId) {
        return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    const quizRows = await query(
        'SELECT id FROM quizzes WHERE id = ? AND teacher_id = ? LIMIT 1',
        [quizId, req.teacherId]
    );

    if (quizRows.length === 0) {
        return res.status(403).json({ error: 'Quiz not found or unauthorized' });
    }

    const studentResults = await query(
        `SELECT r.id, r.candidate_name, r.score, r.total_questions, r.passed, r.date_taken,
         ROUND((r.score / NULLIF(r.total_questions, 0)) * 100) as percentage
         FROM results r WHERE r.quiz_id = ? ORDER BY r.date_taken DESC`,
        [quizId]
    );

    res.json(studentResults);
}));

app.get('/api/teacher/stats', validateSession, asyncHandler(async (req, res) => {
    const rows = await query(
        `SELECT
            (SELECT COUNT(*) FROM quizzes WHERE teacher_id = ?) as total_quizzes,
            (SELECT COUNT(*) FROM questions WHERE quiz_id IN (SELECT id FROM quizzes WHERE teacher_id = ?)) as total_questions,
            (SELECT COUNT(*) FROM results WHERE quiz_id IN (SELECT id FROM quizzes WHERE teacher_id = ?)) as total_attempts,
            (SELECT COUNT(*) FROM results WHERE quiz_id IN (SELECT id FROM quizzes WHERE teacher_id = ?) AND passed = 1) as total_passed`,
        [req.teacherId, req.teacherId, req.teacherId, req.teacherId]
    );

    res.json(rows[0]);
}));

app.post('/api/quiz/:quizId/access-code', validateSession, rateLimit({ key: 'access-code-create', maxRequests: 20 }), asyncHandler(async (req, res) => {
    const quizId = parsePositiveInt(req.params.quizId);
    if (!quizId) {
        return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    const quizRows = await query(
        'SELECT id FROM quizzes WHERE id = ? AND teacher_id = ? LIMIT 1',
        [quizId, req.teacherId]
    );

    if (quizRows.length === 0) {
        return res.status(403).json({ error: 'Quiz not found or unauthorized' });
    }

    let expiresAt = null;
    if (req.body.expires_at) {
        const parsed = new Date(req.body.expires_at);
        if (Number.isNaN(parsed.getTime())) {
            return res.status(400).json({ error: 'Invalid expiration date' });
        }
        expiresAt = parsed;
    }

    const code = crypto.randomBytes(4).toString('hex').toUpperCase();

    const result = await query(
        'INSERT INTO access_codes (quiz_id, code, expires_at) VALUES (?, ?, ?)',
        [quizId, code, expiresAt]
    );

    res.json({ message: 'Access code generated', code, accessCodeId: result.insertId });
}));

app.patch('/api/access-code/:codeId/toggle', validateSession, asyncHandler(async (req, res) => {
    const codeId = parsePositiveInt(req.params.codeId);
    if (!codeId) {
        return res.status(400).json({ error: 'Invalid access code ID' });
    }

    const rows = await query(
        `SELECT ac.id, ac.active FROM access_codes ac
         JOIN quizzes q ON ac.quiz_id = q.id
         WHERE ac.id = ? AND q.teacher_id = ? LIMIT 1`,
        [codeId, req.teacherId]
    );

    if (rows.length === 0) {
        return res.status(403).json({ error: 'Access code not found or unauthorized' });
    }

    const newActive = !rows[0].active;
    await query('UPDATE access_codes SET active = ? WHERE id = ?', [newActive, codeId]);

    res.json({ message: `Access code ${newActive ? 'activated' : 'deactivated'}`, active: newActive });
}));

app.get('/api/quiz/:quizId/access-codes', validateSession, asyncHandler(async (req, res) => {
    const quizId = parsePositiveInt(req.params.quizId);
    if (!quizId) {
        return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    const quizRows = await query(
        'SELECT id FROM quizzes WHERE id = ? AND teacher_id = ? LIMIT 1',
        [quizId, req.teacherId]
    );

    if (quizRows.length === 0) {
        return res.status(403).json({ error: 'Quiz not found or unauthorized' });
    }

    const codes = await query(
        `SELECT ac.id, ac.code, ac.expires_at, ac.active, ac.created_at,
         (SELECT COUNT(*) FROM results WHERE access_code_id = ac.id) as usage_count
         FROM access_codes ac WHERE ac.quiz_id = ? ORDER BY ac.created_at DESC`,
        [quizId]
    );

    res.json(codes);
}));

app.post('/api/student/access', rateLimit({ key: 'student-access', maxRequests: 25 }), asyncHandler(async (req, res) => {
    const code = normalizeText(req.body.code, { min: 4, max: 20, label: 'Access code' }).toUpperCase();

    const codeRows = await query(
        'SELECT id, quiz_id, expires_at, active FROM access_codes WHERE code = ? LIMIT 1',
        [code]
    );

    if (codeRows.length === 0) {
        return res.status(401).json({ error: 'Invalid access code. Please check and try again.' });
    }

    const accessCode = codeRows[0];
    const isExpired = accessCode.expires_at && new Date(accessCode.expires_at) < new Date();

    if (!accessCode.active) {
        return res.status(401).json({ error: 'This access code has been deactivated by your teacher.' });
    }

    if (isExpired) {
        return res.status(401).json({ error: 'This access code has expired. Please ask your teacher for a new one.' });
    }

    const quizRows = await query(
        'SELECT id, title, description, passing_score_percentage FROM quizzes WHERE id = ? LIMIT 1',
        [accessCode.quiz_id]
    );

    if (quizRows.length === 0) {
        return res.status(404).json({ error: 'Quiz not found' });
    }

    const countRows = await query('SELECT COUNT(*) as count FROM questions WHERE quiz_id = ?', [accessCode.quiz_id]);
    const questionCount = countRows[0].count;

    if (questionCount === 0) {
        return res.status(400).json({ error: 'This quiz is not ready yet. Please contact your teacher.' });
    }

    res.json({
        accessCodeId: accessCode.id,
        quizId: accessCode.quiz_id,
        quiz: quizRows[0],
        questionCount
    });
}));

app.get('/api/quiz/:quizId/student-questions/:accessCodeId', rateLimit({ key: 'student-questions', maxRequests: 60 }), asyncHandler(async (req, res) => {
    const quizId = parsePositiveInt(req.params.quizId);
    const accessCodeId = parsePositiveInt(req.params.accessCodeId);

    if (!quizId || !accessCodeId) {
        return res.status(400).json({ error: 'Invalid quiz access details' });
    }

    const codeRows = await query(
        'SELECT expires_at, active FROM access_codes WHERE id = ? AND quiz_id = ? LIMIT 1',
        [accessCodeId, quizId]
    );

    if (codeRows.length === 0) {
        return res.status(401).json({ error: 'Invalid access' });
    }

    const accessCode = codeRows[0];
    const isExpired = accessCode.expires_at && new Date(accessCode.expires_at) < new Date();
    if (!accessCode.active || isExpired) {
        return res.status(401).json({ error: 'Access code is no longer valid' });
    }

    const questions = await query(
        'SELECT id, question_text, option_a, option_b, option_c, option_d FROM questions WHERE quiz_id = ? ORDER BY id',
        [quizId]
    );

    res.json(questions);
}));

app.post('/api/submit-quiz', rateLimit({ key: 'submit-quiz', maxRequests: 12 }), asyncHandler(async (req, res) => {
    const candidateName = normalizeText(req.body.candidate_name, {
        min: 2,
        max: LIMITS.NAME_MAX,
        label: 'Candidate name'
    });

    const quizId = parsePositiveInt(req.body.quizId);
    const accessCodeId = parsePositiveInt(req.body.accessCodeId);
    const answers = req.body.answers;

    if (!quizId || !accessCodeId || !answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return res.status(400).json({ error: 'Missing or invalid required fields' });
    }

    if (Object.keys(answers).length > LIMITS.ANSWER_MAP_MAX) {
        return res.status(400).json({ error: 'Too many answers submitted' });
    }

    const codeRows = await query(
        'SELECT expires_at, active FROM access_codes WHERE id = ? AND quiz_id = ? LIMIT 1',
        [accessCodeId, quizId]
    );

    if (codeRows.length === 0) {
        return res.status(401).json({ error: 'Invalid access code' });
    }

    const accessCode = codeRows[0];
    const isExpired = accessCode.expires_at && new Date(accessCode.expires_at) < new Date();
    if (!accessCode.active || isExpired) {
        return res.status(401).json({ error: 'Access code is invalid or expired' });
    }

    const quizRows = await query(
        'SELECT passing_score_percentage FROM quizzes WHERE id = ? LIMIT 1',
        [quizId]
    );

    if (quizRows.length === 0) {
        return res.status(404).json({ error: 'Quiz not found' });
    }

    const duplicateRows = await query(
        `SELECT id, score, total_questions, passed
         FROM results
         WHERE quiz_id = ? AND access_code_id = ? AND candidate_name = ?
         AND date_taken > (NOW() - INTERVAL 30 SECOND)
         ORDER BY id DESC LIMIT 1`,
        [quizId, accessCodeId, candidateName]
    );

    if (duplicateRows.length > 0) {
        const duplicate = duplicateRows[0];
        const payload = {
            message: 'Quiz was already submitted recently',
            score: duplicate.score,
            total_questions: duplicate.total_questions,
            passed: !!duplicate.passed,
            percentage: Math.round((duplicate.score / Math.max(1, duplicate.total_questions)) * 100),
            result_id: duplicate.id,
            duplicate: true
        };

        if (duplicate.passed) {
            payload.certificateToken = createCertificateToken(duplicate.id, accessCodeId, candidateName);
        }

        return res.json(payload);
    }

    const dbQuestions = await query(
        'SELECT id, correct_option FROM questions WHERE quiz_id = ? ORDER BY id',
        [quizId]
    );

    if (dbQuestions.length === 0) {
        return res.status(400).json({ error: 'Quiz has no questions' });
    }

    let score = 0;
    for (const question of dbQuestions) {
        const answer = answers[question.id.toString()];
        if (!['A', 'B', 'C', 'D'].includes(answer)) {
            return res.status(400).json({ error: 'Invalid answer payload' });
        }
        if (answer === question.correct_option) {
            score += 1;
        }
    }

    const totalQuestions = dbQuestions.length;
    const passingPercentage = quizRows[0].passing_score_percentage;
    const passingScore = Math.ceil(totalQuestions * (passingPercentage / 100));
    const passed = score >= passingScore;

    const insertResult = await query(
        'INSERT INTO results (candidate_name, score, total_questions, passed, quiz_id, access_code_id) VALUES (?, ?, ?, ?, ?, ?)',
        [candidateName, score, totalQuestions, passed, quizId, accessCodeId]
    );

    const response = {
        message: 'Quiz evaluated successfully',
        score,
        total_questions: totalQuestions,
        passed,
        percentage: Math.round((score / totalQuestions) * 100),
        result_id: insertResult.insertId
    };

    if (passed) {
        response.certificateToken = createCertificateToken(insertResult.insertId, accessCodeId, candidateName);
    }

    res.json(response);
}));

app.get('/api/certificate/:resultId', rateLimit({ key: 'certificate', maxRequests: 20 }), asyncHandler(async (req, res) => {
    const resultId = parsePositiveInt(req.params.resultId);
    const token = typeof req.query.token === 'string' ? req.query.token : '';

    if (!resultId || !token) {
        return res.status(400).json({ error: 'Invalid certificate request' });
    }

    const rows = await query(
        `SELECT r.id, r.candidate_name, r.score, r.total_questions, r.passed, r.date_taken, r.access_code_id,
                q.title as quiz_title
         FROM results r
         JOIN quizzes q ON r.quiz_id = q.id
         WHERE r.id = ? LIMIT 1`,
        [resultId]
    );

    if (rows.length === 0) {
        return res.status(404).json({ error: 'Result not found' });
    }

    const data = rows[0];
    if (!data.passed) {
        return res.status(403).json({ error: 'Certificate only available for passing results' });
    }

    const expectedToken = createCertificateToken(data.id, data.access_code_id, data.candidate_name);
    if (!safeCompare(expectedToken, token)) {
        return res.status(401).json({ error: 'Unauthorized certificate request' });
    }

    const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 0 });

    const safeName = data.candidate_name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80) || 'student';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename=Certificate_${safeName}.pdf`);

    doc.pipe(res);

    const w = doc.page.width;   // 841.89
    const h = doc.page.height;  // 595.28
    const purple = '#3B1F6E';
    const gold = '#D4A843';
    const darkText = '#2D2D2D';
    const headerBottom = h * 0.35;

    // --- White background ---
    doc.rect(0, 0, w, h).fill('#FFFFFF');

    // --- Thin gold border/frame inset ---
    doc.save();
    doc.rect(18, 18, w - 36, h - 36).lineWidth(1.5).strokeColor(gold).stroke();
    doc.restore();

    // --- Top-right purple header (~35% height) ---
    doc.save();
    doc.moveTo(w * 0.38, 0).lineTo(w, 0).lineTo(w, headerBottom).lineTo(w * 0.32, headerBottom).closePath().fill(purple);
    doc.restore();

    // --- Top-left gold diagonal triangle ---
    doc.save();
    doc.moveTo(0, 0).lineTo(w * 0.28, 0).lineTo(0, h * 0.15).closePath().fill(gold);
    doc.restore();

    // --- Gold accent stripe under triangle ---
    doc.save();
    doc.lineWidth(3).strokeColor(gold);
    doc.moveTo(0, h * 0.17).lineTo(w * 0.31, 0).stroke();
    doc.restore();

    // --- Bottom-left purple triangle (taller) ---
    doc.save();
    doc.moveTo(0, h).lineTo(w * 0.18, h).lineTo(0, h * 0.80).closePath().fill(purple);
    doc.restore();

    // --- Bottom-right gold bar (taller) ---
    doc.save();
    doc.rect(w * 0.50, h - 40, w * 0.50, 40).fill(gold);
    doc.restore();

    // --- Bottom-right purple triangle (taller) ---
    doc.save();
    doc.moveTo(w, h).lineTo(w * 0.80, h).lineTo(w, h * 0.80).closePath().fill(purple);
    doc.restore();

    // --- "Certificate" title on purple area ---
    doc.font('Helvetica-Bold').fontSize(56).fillColor('#FFFFFF');
    doc.text('Certificate', w * 0.38, 50, { width: w * 0.58, align: 'center' });

    // --- "of Achievement" gold banner straddling purple bottom edge ---
    const bannerW = 250;
    const bannerH = 38;
    const bannerX = w * 0.64 - bannerW / 2;
    const bannerY = headerBottom - bannerH / 2;
    doc.save();
    doc.moveTo(bannerX - 14, bannerY).lineTo(bannerX + bannerW + 14, bannerY)
       .lineTo(bannerX + bannerW, bannerY + bannerH).lineTo(bannerX, bannerY + bannerH).closePath().fill(gold);
    doc.restore();
    doc.font('Helvetica').fontSize(19).fillColor('#FFFFFF');
    doc.text('of Achievement', bannerX, bannerY + 9, { width: bannerW, align: 'center' });

    // --- "Quiz Engine" branding top-left ---
    doc.font('Helvetica-Bold').fontSize(16).fillColor(purple);
    doc.text('Quiz Engine', 50, h * 0.19, { width: 220 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#888888');
    doc.text('Assessment Platform', 50, h * 0.19 + 20, { width: 220 });

    // --- Left side content ---
    const contentX = 50;
    const contentW = w * 0.52;
    let curY = h * 0.42;

    // "This is to certify that"
    doc.font('Helvetica').fontSize(13).fillColor('#666666');
    doc.text('This is to certify that', contentX, curY, { width: contentW });
    curY += 28;

    // Candidate name - sized to fit
    const nameText = data.candidate_name.toUpperCase();
    const nameFontSize = nameText.length > 24 ? 22 : nameText.length > 18 ? 26 : nameText.length > 14 ? 30 : 34;
    doc.font('Helvetica-Bold').fontSize(nameFontSize).fillColor(darkText);
    doc.text(nameText, contentX, curY, { width: contentW });
    curY += nameFontSize + 10;

    // Gold underline beneath name
    doc.save();
    doc.moveTo(contentX, curY).lineTo(contentX + Math.min(380, contentW - 10), curY).lineWidth(2).strokeColor(gold).stroke();
    doc.restore();
    curY += 18;

    // Description text
    const percentage = Math.round((data.score / data.total_questions) * 100);
    doc.font('Helvetica').fontSize(12).fillColor('#444444');
    doc.text(
        `has successfully completed the quiz "${data.quiz_title}" with a score of ${data.score} out of ${data.total_questions} (${percentage}%).`,
        contentX, curY, { width: contentW - 20, lineGap: 5 }
    );

    // --- Gold seal on the right (larger, more rings) ---
    const sealX = w * 0.74;
    const sealY = h * 0.52;
    const sealR = 44;
    doc.save();
    doc.circle(sealX, sealY, sealR + 12).lineWidth(2.5).strokeColor(gold).stroke();
    doc.circle(sealX, sealY, sealR + 7).lineWidth(1).strokeColor(gold).stroke();
    doc.circle(sealX, sealY, sealR + 3).lineWidth(0.5).strokeColor(gold).stroke();
    doc.circle(sealX, sealY, sealR).fill(gold);
    doc.restore();
    // Year inside seal
    const year = new Date(data.date_taken).getFullYear().toString();
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF');
    doc.text(year, sealX - 30, sealY - 10, { width: 60, align: 'center' });

    // --- Date badge on the right ---
    const dateString = new Date(data.date_taken).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
    const dateBadgeW = 210;
    const dateBadgeH = 30;
    const dateBadgeX = w * 0.74 - dateBadgeW / 2;
    const dateBadgeY = h * 0.66;
    doc.save();
    doc.moveTo(dateBadgeX - 12, dateBadgeY).lineTo(dateBadgeX + dateBadgeW + 12, dateBadgeY)
       .lineTo(dateBadgeX + dateBadgeW, dateBadgeY + dateBadgeH).lineTo(dateBadgeX, dateBadgeY + dateBadgeH).closePath().fill(gold);
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(purple);
    doc.text(dateString, dateBadgeX, dateBadgeY + 8, { width: dateBadgeW, align: 'center' });

    // --- Certificate ID in bottom gold bar ---
    const certId = `QE-${resultId}-${Date.now().toString(36).toUpperCase()}`;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
    doc.text(`CERTIFICATE NO: ${certId}`, w * 0.56, h - 28, { width: w * 0.40, align: 'center' });

    doc.end();
}));

app.get('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
    if (error?.message === 'CORS not allowed') {
        return res.status(403).json({ error: 'Origin not allowed' });
    }

    console.error('Unhandled server error:', error);
    if (res.headersSent) return next(error);
    return res.status(500).json({ error: 'Internal server error' });
});

process.on('unhandledRejection', error => {
    console.error('Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught Exception:', error);
});

async function startServer() {
    await initRedis();

    app.listen(PORT, () => {
        console.log(`\n  🚀 Quiz Engine is running at http://localhost:${PORT}\n`);
    });
}

async function shutdown() {
    try {
        if (redisEnabled && redisClient) {
            await redisClient.quit();
        }
    } catch (error) {
        console.error('Error during shutdown:', error.message);
    } finally {
        process.exit(0);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
