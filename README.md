# LinguaLab 🌍🗣️

> **Live Demo:** [https://your-demo-url.vercel.app](https://your-demo-url.vercel.app) *(Replace with live deployment link)*  
> **Screenshots:** *(Add application screenshots / demo walkthroughs here)*

LinguaLab is a modern, full-stack, AI-powered conversational language immersion platform built with **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, and **Supabase**, backed by **Google Gemini AI** and **ElevenLabs TTS**.

---

## 🏛️ Architecture

LinguaLab separates client-side state and presentation from privileged backend operations. The frontend is a React 19 single-page application that uses Supabase Auth for session management and queries Supabase directly under Row-Level Security (RLS) for read access to a user's conversations and messages. All state-mutating and AI-generating operations—including conversational turns, grammar analysis, vocabulary lookups, review quizzes, and ElevenLabs speech synthesis—are routed through backend handlers (either the local Node.js/Express server or Vercel serverless functions in `api/`). The backend uses the privileged `service_role` key to execute PostgreSQL stored procedures (RPCs) that atomically enforce user rate limits, daily quotas, generation lease locks, and message persistence without granting direct insert or update permissions to client tokens.

---

## ✨ Features

- **Context-Aware Conversational Dialogue:** Practice conversational fluency with an adaptive AI partner tailored to CEFR language proficiency levels (A1–C2).
- **Immersion Mission Scenarios:** Practice structured real-world missions (e.g., ordering food, job interviews, asking directions) with live objective completion tracking alongside freeform conversation.
- **Voice Playback & Pronunciation (TTS):** High-fidelity voice playback of assistant replies powered by ElevenLabs Multilingual TTS.
- **Interactive Review Quizzes:** On-demand, AI-generated multiple-choice comprehension and vocabulary quizzes generated directly from the recent conversation transcript.
- **1-Click Vocabulary Lookup & Flashcards:** Highlight or enter any target word to get definitions, IPA phonetics, part of speech, and save directly to an interactive Spaced Repetition (SRS) vocabulary deck.
- **Real-Time Grammar Analysis:** Inline grammatical inspection detailing errors, natural corrections, and concise pedagogical explanations.
- **Rate Limiting & Concurrency Controls:**
  - Per-minute (6) and per-day request limits (60 AI turns/day, 30 voice plays/day) enforced atomically in PostgreSQL.
  - Per-conversation generation leases to guard against race conditions, duplicate submissions, and in-flight crosstalk.
  - 100-turn session cap per conversation.
- **Modern Responsive UI:** Polished Dark and Light mode aesthetic built with Tailwind CSS.

---

## 🛠️ Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, React Router v7
- **Database & Auth:** Supabase (PostgreSQL, Row Level Security, Atomic RPCs, Auth)
- **AI Models:** Google Gemini (`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.8-flash`)
- **Text-to-Speech:** ElevenLabs API (`eleven_multilingual_v2`)
- **Backend / Serverless:** Node.js Express server (`backend/`) and Vercel serverless functions (`api/`)

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
The frontend client in `src/lib/supabase.ts` inspects the following variables (checking `VITE_SUPABASE_PUBLISHABLE_KEY` first, with `VITE_SUPABASE_ANON_KEY` as fallback):
```bash
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-or-publishable-key>
# Alternative fallback accepted:
# VITE_SUPABASE_ANON_KEY=<your-anon-or-publishable-key>
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
Link to your Supabase project before applying migrations:
```bash
npx supabase link --project-ref <your-project-ref>
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

### 4. Build & Lint Commands
```bash
# Typecheck and production bundle build
npm run build

# Linting check
npm run lint
```

---

## ☁️ Deploying to Vercel

1. **Configure Environment Variables:**
   Add both frontend and serverless environment variables in your Vercel Project Settings under **Settings > Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID`

2. **Configure Supabase Auth Redirect URLs:**
   In your Supabase Dashboard under **Authentication > URL Configuration**:
   - Set **Site URL** to your production Vercel domain (e.g., `https://lingua-lab.vercel.app`).
   - Add wildcard preview URLs under **Redirect URLs** (e.g., `https://*-your-team.vercel.app/**` and `https://lingua-lab.vercel.app/**`) so authentication confirmations and session redirects resolve properly.

3. **Database Schema Sync:**
   Make sure your remote Supabase project is linked and up-to-date before deployment:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

---

## ⚠️ Known Limitations

- **Quota & Turn Limits:** Users are capped at 60 AI requests/day and 30 voice generation requests/day, with a per-minute burst rate limit of 6 requests/minute. Conversation sessions are limited to 100 turns.
- **Audio Autoplay Restrictions:** Modern web browsers require explicit user interaction before playing audio. Automatic audio playback may be blocked until a user interacts with the page.
- **Web Speech Fallback:** If ElevenLabs credentials or voice quotas are exhausted, speech synthesis relies on browser-native Web Speech API voices, whose availability and quality vary by operating system and browser.
- **Serverless Cold Starts:** When running on Vercel serverless functions, initial requests to API routes may encounter slight latency from serverless cold starts.

---

## 🔒 Security Architecture

1. **Service-Role Isolation:** Sensitive database mutations, message insertions, quota increments, and generation lease acquisitions are restricted (`REVOKE ALL FROM PUBLIC, anon, authenticated`) and can only be executed via backend `service_role` RPCs.
2. **Row-Level Security (RLS):** Authenticated users can only read their own conversations, messages, and saved exercises.
3. **Client Secret Exclusion:** Server-side API keys (Gemini, ElevenLabs) and the Supabase service role secret are kept on the server and are not included in frontend environment variables or client code.
4. **Cache-Control & Error Handling:** API routes declare `Cache-Control: no-store` headers and return generic error messages for server-side exceptions to avoid leaking internals to the client.
