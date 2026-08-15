# Mizo ASR UI

Browser UI for Mizo speech-to-text. Record or upload audio; the app converts it to 16 kHz mono WAV and POSTs it through `/api/transcribe` to the Lambda bridge.

## Local

```bash
cp .env.example .env.local
# set LAMBDA_URL and LAMBDA_API_KEY
npm install
npm run dev
```

## Vercel

Add the same two env vars. Deploy this folder. Hobby plans cap serverless at 10s — warming replies are instant; a warm transcription can take ~10s, so a Pro plan (or a 60s function limit) is safer.
