# LinguaLab 🌍🗣️

LinguaLab is a modern, full-stack, AI-powered conversational language immersion platform built with **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, and **Supabase**, backed by **Google Gemini AI** and **ElevenLabs TTS**.

---

## ✨ Features

- **Context-Aware Conversational Dialogue:** Practice conversational fluency with an adaptive AI partner tailored to CEFR language proficiency levels (A1–C2).
- **Immersion Mission Scenarios:** Practice structured real-world missions (e.g., ordering food, job interviews, asking directions) with live objective completion tracking alongside freeform conversation.
- **Voice Playback & Pronunciation (TTS):** High-fidelity voice playback of assistant replies powered by ElevenLabs Multilingual TTS.
- **Interactive Review Quizzes:** On-demand, AI-generated multiple-choice comprehension and vocabulary quizzes generated directly from the recent conversation transcript.
- **1-Click Vocabulary Lookup & Flashcards:** Highlight or enter any target word to get definitions, IPA phonetics, part of speech, and save directly to an interactive Spaced Repetition (SRS) vocabulary deck.
- **Real-Time Grammar Analysis:** Inline grammatical inspection detailing errors, natural corrections, and concise pedagogical explanations.
- **Enterprise-Grade Rate Limiting & Concurrency Controls:**
  - Token-bucket rate limiting (6 requests/minute) and daily quota caps (60 AI turns/day, 30 voice plays/day) enforced atomically in PostgreSQL.
  - Per-conversation generation leases to guard against race conditions, duplicate submissions, and in-flight crosstalk.
  - 100-turn session cap per conversation.
- **Modern Responsive UI:** Polished Dark and Light mode aesthetic built with Tailwind CSS.

---

## 🛠️ Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, React Router v7
- **Database & Auth:** Supabase (PostgreSQL, Row Level Security, Atomic RPCs, Auth)
- **AI Models:** Google Gemini (`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.8-flash`)
- **Text-to-Speech:** ElevenLabs API (`eleven_multilingual_v2`)
- **Backend / Serverless:** Node.js Express server (`backend/`) and Vercel Serverless edge functions (`api/`)

---

## 🚀 Getting Started

### Prerequisites

- Node.js `v20+` or `v22+`
- npm `v10+`
- A configured Supabase project with applied migrations
- Google Gemini API key
- ElevenLabs API key (optional for TTS voice synthesis)

### Environment Variables

#### Frontend (`.env.local`)
```bash
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
```

#### Backend / Serverless (`backend/.env` and Vercel Environment Variables)
```bash
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-secret-key>
GEMINI_API_KEY=<your-gemini-api-key>
ELEVENLABS_API_KEY=<your-elevenlabs-api-key>
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
```

---

## 📦 Installation & Running

### 1. Install Dependencies
```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd backend && npm install && cd ..
```

### 2. Apply Database Migrations
Migrations are managed via the Supabase CLI in `supabase/migrations/`:
```bash
npx supabase db push
```

### 3. Start Development Servers

**Run the local Express backend (Port 3000):**
```bash
cd backend
node index.js
```

**Run the Vite frontend (Port 5173):**
```bash
npm run dev
```

### 4. Build & Lint Verification
```bash
# Typecheck and production bundle build
npm run build

# Linting verification
npm run lint
```

---

## 🔒 Security Architecture

1. **Service-Role Isolation:** Sensitive database mutations, message insertions, quota increments, and generation lease acquisitions are locked down with `REVOKE ALL FROM PUBLIC, anon, authenticated` and can only be executed via backend `service_role` RPCs.
2. **Row-Level Security (RLS):** Users can only read and manage their own conversations and messages.
3. **No Secret Leaks:** Client production builds are verified to contain zero server-side API keys or service role secrets.
4. **Cache & Error Sanitization:** All AI and speech generation responses explicitly declare `Cache-Control: no-store` and sanitize internal error traces before sending responses to the client.
