# Automated Quiz Engine with PDF Certification

Milestone Project - I (Full Stack Application Development)

A full-stack quiz platform for teachers and students, built with Node.js, Express, MySQL, and Redis (optional).

## Features

- Teacher authentication and dashboard
- Quiz creation and management
- Student quiz access and submission flow
- PDF certificate generation
- Optional Redis-backed sessions and rate limiting

## Tech Stack

- Backend: Node.js, Express
- Database: MySQL
- Caching/Sessions (optional): Redis
- Frontend: HTML, CSS, JavaScript (served from `public/`)

## Project Structure

- `server.js` - Express server and API routes
- `database_schema.sql` - MySQL schema setup
- `public/` - static frontend pages and scripts
- `.env.example` - environment variable template

## Prerequisites

- Node.js 18+
- MySQL server
- Redis (optional)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create environment file:

   ```bash
   copy .env.example .env
   ```

3. Update `.env` with your MySQL credentials and other settings.

4. Import database schema into MySQL:

   ```bash
   mysql -u root -p < database_schema.sql
   ```

5. Start the server:

   ```bash
   npm start
   ```

6. Open in browser:

   ```
   http://localhost:3000
   ```

## Scripts

- `npm start` - run production server
- `npm run dev` - run with nodemon

## License

This project is licensed under the ISC License.
