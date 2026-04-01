# AI Agent App

A full-stack AI chat agent built with **Next.js**, **PostgreSQL**, **LangChain**, **Bun**, and **Better Auth**.

## Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 15 (App Router) |
| Runtime | Bun |
| Auth | Better Auth (email/password, JWE sessions) |
| Database | PostgreSQL + Drizzle ORM |
| AI | LangChain + OpenAI gpt-4o-mini |
| Styling | Tailwind CSS |

## Features

- ✅ Email/password auth with secure JWE cookie sessions
- ✅ Rate-limited auth endpoints
- ✅ Streaming AI responses (ReadableStream)
- ✅ Persistent chat history per user
- ✅ History-aware conversations (last 20 messages as context)

## Setup

```bash
# 1. Install deps
bun install

# 2. Copy env and fill in values
cp .env.example .env.local

# 3. Run DB migrations
bun drizzle-kit push

# 4. Start dev server
bun dev
```

## Environment Variables

```env
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
OPENAI_API_KEY=sk-...
```
