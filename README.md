# Quiz Engine - Full Stack Assessment Platform

**Milestone Project 1 (Full Stack Development)** - A comprehensive quiz platform for creating, managing, and distributing quizzes with AI-powered question generation and automated PDF certificate issuing.

![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)
![Node.js Version](https://img.shields.io/badge/Node.js-18+-green)
[![Express.js](https://img.shields.io/badge/Express-5.0-black)](https://expressjs.com)

---

## 🎯 Features

### Teacher Features
- **User Authentication**: Secure JWT-based session management with bcrypt password hashing
- **Quiz Management**: Create, edit, and delete unlimited quizzes with custom passing scores
- **Question Management**: 
  - Manually add/edit multiple-choice questions
  - AI-powered automated question generation via ASI:One API
  - Support for difficulty levels (easy, medium, hard) and topic depth
- **Access Codes**: Generate and manage student access codes with expiration dates and enable/disable functionality
- **Results Dashboard**: View comprehensive student attempt statistics and performance metrics
- **Real-time Stats**: Track total quizzes, questions, attempts, and pass rates

### Student Features
- **Quiz Access**: Join quizzes using unique access codes
- **Interactive Quiz Interface**: 
  - Keyboard navigation (arrow keys)
  - Progress tracking with resume capability
  - Auto-saving of answers during quiz
- **Instant Scoring**: Real-time evaluation with detailed results
- **Certificate Generation**: Auto-generated professional PDF certificates for passing attempts
- **No Authentication Required**: Quick and simple access for students

### Technical Features
- **Security**: 
  - CORS protection with configurable origins
  - Rate limiting (memory-based or Redis-backed)
  - SQL injection prevention via parameterized queries
  - XSS protection through HTML sanitization
  - CSRF token validation for certificate downloads
- **Optional Redis**: Persistent sessions and distributed rate limiting
- **Scalable Architecture**: MySQL connection pooling, async/await, error handling
- **Responsive Design**: Mobile-friendly UI with smooth interactions

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js, Express.js 5.x |
| **Database** | MySQL 8.0+ |
| **Authentication** | bcrypt, custom JWT sessions |
| **PDF Generation** | PDFKit |
| **AI Integration** | ASI:One API (asi1.ai) |
| **Caching/Sessions** | Redis (optional; in-memory fallback) |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **Rate Limiting** | Custom middleware (memory/Redis) |

---

## 📋 Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** 9.0.0 or higher
- **MySQL** 8.0 or higher (5.7+ may work but untested)
- **Git** (recommended)

### Optional
- **Redis** 6.0+ (for persistent sessions and distributed rate limiting; in-memory fallback works for development)
- **ASI:One API Key** (required for AI question generation; free tier available at [asi1.ai](https://asi1.ai))

---

## 🚀 Installation & Setup

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd MSP1-FSD
npm install
```

### 2. Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your configuration
nano .env  # or use your preferred editor
```

**Required `.env` variables:**

```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASS=your_mysql_password
DB_NAME=quiz_db
CERT_TOKEN_SECRET=your-random-secret-key
ASI_API_KEY=your_asi1_api_key
```

[[Detailed `.env` reference guide below](#-environment-configuration)]

### 3. Set Up MySQL Database

```bash
# Using MySQL CLI
mysql -u root -p < database_schema.sql

# Or manually:
mysql -u root -p
mysql> CREATE DATABASE IF NOT EXISTS quiz_db;
mysql> USE quiz_db;
mysql> source database_schema.sql;
```

**Database includes tables for:**
- Teachers (authentication)
- Quizzes (quiz metadata)
- Questions (quiz content)
- Access Codes (student access management)
- Results (quiz attempt scores)

### 4. Start the Server

```bash
# Development (with auto-reload using nodemon)
npm run dev

# Production
npm start
```

**Server runs on `http://localhost:3000`** (or custom PORT from `.env`)

---

## 📖 Usage Guide

### For Teachers

1. **Register/Login**: Navigate to `http://localhost:3000/teacher-auth.html`
2. **Create Quiz**: Click "New Quiz" → Enter title, description, and passing score
3. **Add Questions**: 
   - Manually: Use "Add Question" form with 4 options and correct answer
   - AI-Generated: Use "Generate Questions" with topic, difficulty, and depth
4. **Manage Access**: Generate access codes with optional expiration dates
5. **View Results**: Check student performance, scores, and statistics

### For Students

1. **Access Quiz**: Go to `http://localhost:3000/student-access.html`
2. **Enter Code**: Input the access code provided by teacher
3. **Take Quiz**: Answer all questions (use arrow keys to navigate)
4. **Submit**: Review and submit your answers
5. **Download Certificate** (if passed): Automatic PDF generation with personalized details

---

## 🔐 Environment Configuration

### Full `.env` Reference

```env
# === SERVER ===
PORT=3000                           # Server port
NODE_ENV=development                # development, staging, or production

# === DATABASE (MySQL) ===
DB_HOST=localhost                   # MySQL host/IP
DB_PORT=3306                        # MySQL port (default shown)
DB_USER=root                        # MySQL username
DB_PASS=your_password               # MySQL password (leave empty if no password)
DB_NAME=quiz_db                     # Database name

# === AI INTEGRATION ===
ASI_API_KEY=your_key_here           # Get from https://asi1.ai (free tier available)

# === SECURITY ===
CERT_TOKEN_SECRET=random-string     # HMAC secret - generate with: openssl rand -hex 32
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com  # Comma-separated CORS origins

# === CACHING/SESSIONS (OPTIONAL) ===
REDIS_URL=redis://localhost:6379    # Leave empty to use in-memory fallback
# Format: redis://[:password@]host[:port][/db-number]

# === PROXY ===
TRUST_PROXY=false                   # Set true if behind nginx/CloudFlare/AWS ALB
```

---

## 🏗️ Project Structure

```
MSP1-FSD/
├── server.js                      # Main Express server & API routes
├── database_schema.sql            # MySQL database DDL
├── package.json                   # Dependencies & scripts
├── .env.example                   # Environment template
├── .gitignore                     # Git ignore rules
├── README.md                      # This file
├── INTERFACE_GUIDE.md             # UI/UX documentation
├── LICENSE                        # ISC License
├── architecture-diagram.html      # Visual architecture
└── public/                        # Frontend static files
    ├── index.html                 # Landing page
    ├── style.css                  # Global styles
    ├── teacher-auth.html          # Login/Register page
    ├── teacher-auth.js
    ├── teacher-dashboard.html     # Teacher dashboard
    ├── teacher-dashboard.js
    ├── quiz-creation.html         # Quiz builder
    ├── quiz-creation.js
    ├── student-access.html        # Student code entry
    ├── student-access.js
    ├── student-quiz.html          # Quiz taker interface
    └── student-quiz.js
```

---

## 🔌 API Reference

### Authentication Endpoints

```
POST   /api/teacher/register      Register new teacher account
POST   /api/teacher/login         Login and get session token
POST   /api/teacher/logout        Logout and invalidate session
```

### Quiz Management

```
POST   /api/quiz/create           Create new quiz
DELETE /api/quiz/:quizId          Delete quiz
GET    /api/teacher/quizzes       List teacher's quizzes
GET    /api/teacher/stats         Get aggregated statistics
```

### Questions

```
POST   /api/quiz/:quizId/question                     Add manual question
DELETE /api/quiz/:quizId/question/:questionId         Delete question
GET    /api/quiz/:quizId/questions                    Get all questions
POST   /api/quiz/:quizId/generate-questions           Generate AI questions
```

### Access Codes

```
POST   /api/quiz/:quizId/access-code              Generate access code
GET    /api/quiz/:quizId/access-codes             List access codes
PATCH  /api/access-code/:codeId/toggle            Enable/disable code
```

### Student Quiz Flow

```
POST   /api/student/access                        Verify access code
GET    /api/quiz/:quizId/student-questions/:accessCodeId    Get quiz questions
POST   /api/submit-quiz                           Submit answers
GET    /api/certificate/:resultId                 Download certificate
```

**Authentication**: Endpoints requiring authentication use `Authorization: Bearer <token>` header. Tokens are 64+ character hex strings stored in localStorage/sessionStorage.

---

## 🐛 Known Limitations & Future Enhancements

### Current Limitations
- Students cannot resume interrupted quizzes (session storage only)
- No question shuffling/randomization
- Certificate styling is fixed (purple/gold theme)
- No multi-language support
- No question image support

### Planned Enhancements
- [ ] Database persistence for student progress
- [ ] Question bank library and templates
- [ ] Advanced analytics dashboard
- [ ] Email notifications for access codes
- [ ] Question image/media support
- [ ] Quiz timer/time limits
- [ ] Partial credit scoring
- [ ] Mobile app (React Native)
- [ ] API documentation (Swagger/OpenAPI)

---

## 🚨 Security Considerations

### Production Deployment Checklist
- [ ] Change `CERT_TOKEN_SECRET` to random 32-byte hex string
- [ ] Use HTTPS with valid SSL certificate
- [ ] Set `NODE_ENV=production`
- [ ] Enable Redis for distributed sessions
- [ ] Configure `ALLOWED_ORIGINS` whitelist (remove localhost)
- [ ] Set strong MySQL password
- [ ] Enable MySQL SSL connections
- [ ] Use environment-specific `.env` files
- [ ] Review security headers in `server.js`
- [ ] Enable firewall rules
- [ ] Regular database backups
- [ ] Monitor rate limiting logs
- [ ] Use PM2/systemd for process management
- [ ] Set up error logging/monitoring

### Security Features Implemented
- ✅ Parameterized SQL queries (prevent SQL injection)
- ✅ HTML entity encoding (prevent XSS)
- ✅ bcrypt password hashing (10+ rounds)
- ✅ Rate limiting (configurable by endpoint)
- ✅ HMAC-SHA256 certificate tokens
- ✅ CORS protection
- ✅ Security headers (CSP, X-Frame-Options, etc.)
- ✅ Session expiration (24-hour default)
- ✅ Secure token comparison (timing-safe)

---

## 📊 Database Schema

### teachers
```sql
id (INT, PK) | email (VARCHAR, UNIQUE) | password_hash (VARCHAR) | name (VARCHAR) | created_at
```

### quizzes
```sql
id (INT, PK) | teacher_id (FK) | title | description | passing_score_percentage | is_active | created_at | updated_at
```

### questions
```sql
id (INT, PK) | quiz_id (FK) | question_text | option_a | option_b | option_c | option_d | correct_option | created_at
```

### access_codes
```sql
id (INT, PK) | quiz_id (FK) | code (VARCHAR, UNIQUE) | expires_at | active | created_at
```

### results
```sql
id (INT, PK) | candidate_name | score | total_questions | passed | quiz_id (FK) | access_code_id (FK) | date_taken
```

All tables include proper indexes for optimal query performance.

---

## 🧪 Testing

### Manual Testing Steps

1. **Teacher Route**:
   - Register account with unique email
   - Create quiz with 3+ questions
   - Generate 2 access codes with different expiration dates
   - View statistics and results

2. **Student Route**:
   - Use access code to join quiz
   - Answer all questions
   - Submit and verify scoring
   - Download certificate if passed

3. **Edge Cases**:
   - Use expired/disabled access code
   - Submit with unanswered questions
   - Rapid duplicate submissions
   - Invalid data in request bodies

---

## 📝 License

This project is licensed under the **ISC License** - see the [LICENSE](LICENSE) file for details.

---

## 🎓 Learning Outcomes

This project demonstrates proficiency in:
- **Backend**: Node.js/Express, REST API design, middleware
- **Database**: MySQL, query optimization, schema design
- **Frontend**: Vanilla JS, DOM manipulation, session management
- **Security**: Authentication, encryption, CORS, rate limiting
- **DevOps**: Environment configuration, error handling, logging
- **Full Stack**: End-to-end feature implementation

---

**Last Updated**: March 2026