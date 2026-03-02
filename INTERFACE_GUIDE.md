# Quiz Engine - Production-Ready Multi-Page Application

## Overview

A professional quiz management platform built with Node.js, Express, MySQL, and vanilla HTML/CSS/JS. Teachers create quizzes and share access codes; students take quizzes and receive instant results with PDF certificates for passing scores.

## Architecture

### Pages

| Page | File | Purpose |
|------|------|---------|
| Landing | `index.html` | Feature overview & CTA |
| Teacher Auth | `teacher-auth.html` | Register/Login with password strength meter |
| Dashboard | `teacher-dashboard.html` | Stats, quizzes, results, access codes |
| Quiz Editor | `quiz-creation.html` | Add/delete questions to a quiz |
| Student Access | `student-access.html` | Enter name + access code |
| Student Quiz | `student-quiz.html` | One-question-at-a-time quiz, results, PDF certificate |

### API Endpoints

#### Teacher Authentication
- `POST /api/teacher/register` — Register (name, email, password)
- `POST /api/teacher/login` — Login (email, password)
- `POST /api/teacher/logout` — Server-side session cleanup

#### Quiz Management
- `POST /api/quiz/create` — Create quiz
- `DELETE /api/quiz/:quizId` — Delete quiz (cascades)
- `POST /api/quiz/:quizId/question` — Add question
- `DELETE /api/quiz/:quizId/question/:questionId` — Delete question
- `GET /api/quiz/:quizId/questions` — List questions (teacher view, includes answers)
- `GET /api/teacher/quizzes` — List all teacher's quizzes (with question_count, attempt_count)

#### Results & Stats
- `GET /api/teacher/stats` — Dashboard stats (total_quizzes, total_questions, total_attempts, total_passed)
- `GET /api/quiz/:quizId/results` — All student results for a quiz

#### Access Codes
- `POST /api/quiz/:quizId/access-code` — Generate code
- `GET /api/quiz/:quizId/access-codes` — List codes (with usage_count)
- `PATCH /api/access-code/:codeId/toggle` — Toggle active/inactive

#### Student
- `POST /api/student/access` — Validate access code
- `GET /api/quiz/:quizId/student-questions/:accessCodeId` — Get questions (no answers)
- `POST /api/submit-quiz` — Submit answers
- `GET /api/certificate/:resultId?token=...` — Download PDF certificate (requires secure token returned from submit)

## Security

- **Password hashing**: bcrypt with 12 salt rounds
- **XSS protection**: Server-side HTML entity sanitization on all text inputs
- **Rate limiting**: IP-based with Redis persistence when `REDIS_URL` is configured
- **Session expiry**: 24-hour TTL with Redis-backed persistence (memory fallback in local dev)
- **Input validation**: Email regex, min password length (8), min name length (2), strict ID and answer payload validation
- **Relative URLs**: No hardcoded localhost — works on any hostname
- **SQL injection**: Parameterized queries throughout
- **Client-side escaping**: `escapeHtml()` utility on all rendered user content
- **Certificate protection**: PDF download requires server-issued HMAC token
- **Security headers**: CSP, frame deny, no-sniff, strict referrer, and permissions policy

## UI/UX Features

- **Toast notifications** — Replaces all `alert()` calls with slide-in toasts (success/error/warning/info)
- **Confirm dialogs** — Custom modal for destructive actions (delete quiz/question)
- **Loading spinners** — Visual feedback during all API calls
- **Button loading states** — Disabled + text change while processing
- **Password strength meter** — 4-bar visual indicator with real-time feedback
- **Password show/hide** — Toggle button on all password fields
- **Copy to clipboard** — One-click copy for access codes
- **Empty states** — Illustrated empty states with helpful CTAs
- **Responsive design** — Mobile hamburger menu, stacked layouts at 768px/480px
- **Navbar scroll effect** — Glassmorphism on scroll
- **Modern design system** — CSS variables, Inter font, indigo/green palette, smooth transitions

## Setup

### 1. Database
```sql
-- In MySQL (XAMPP phpMyAdmin or CLI):
CREATE DATABASE IF NOT EXISTS quiz_db;
USE quiz_db;
SOURCE database_schema.sql;
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Create a `.env` file (or set platform env vars) before production deploy:

```bash
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASS=your_mysql_password
DB_NAME=quiz_db

# Comma-separated allowed browser origins
ALLOWED_ORIGINS=https://your-domain.com

# Set when app runs behind reverse proxy/load balancer
TRUST_PROXY=true

# Required for secure certificate token signing
CERT_TOKEN_SECRET=replace-with-long-random-secret

# Optional but recommended for publish-grade durability
REDIS_URL=redis://localhost:6379
```

### 4. Start Server
```bash
npm start        # Production
npm run dev      # Development (nodemon)
```

Server runs on `http://localhost:3000`

## User Flows

### Teacher
1. Register/Login → Dashboard
2. View stats (quizzes, questions, attempts, pass rate)
3. Create quiz → Add questions (with delete support)
4. Generate access codes → Copy & share with students
5. View student results per quiz

### Student
1. Enter name + access code
2. Answer questions (one at a time, prev/next navigation)
3. Submit → instant results with pass/fail status
4. Download PDF certificate (if passed)

## Notes

- Redis is optional: if `REDIS_URL` is set, sessions and rate limits are persistent across restarts
- Without `REDIS_URL`, the app falls back to in-memory storage (acceptable for local/dev only)
- Database uses XAMPP-friendly defaults for local use — always set env vars in production
- Cascading deletes: removing a quiz deletes its questions, codes, and results
- Access codes are 8-char hex strings
- Certificates include decorative borders, trophy icon, quiz title, and unique certificate ID
