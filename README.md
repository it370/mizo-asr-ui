# Mizo ASR UI

Browser UI for Mizo speech-to-text. The page records audio, converts it to 16 kHz mono WAV in the browser, and POSTs it through `/api/transcribe` to the Lambda bridge. The API key never ships to the client.

## Local

```bash
cp .env.example .env
# set LAMBDA_URL and LAMBDA_API_KEY
npm install
npm run dev
```

## Vercel

1. Import this folder as its own Git repository (root = this project, not a parent monorepo).
2. In the Vercel project → **Settings → Environment Variables**, add both for Production and Preview:

   | Name | Value |
   | --- | --- |
   | `LAMBDA_URL` | Function URL, e.g. `https://xxxx.lambda-url.us-east-1.on.aws/` |
   | `LAMBDA_API_KEY` | Same value as the Lambda `API_KEY` |

   Do not prefix these with `NEXT_PUBLIC_`.
3. Deploy. Node 20+ is required. The function runs in `iad1` (N. Virginia) next to the `us-east-1` Lambda.
4. After deploy, open the HTTPS URL and allow the microphone. `getUserMedia` will not work on plain HTTP.

Warm-up replies from the bridge are immediate. A warm transcription can take up to the Lambda timeout (90s). The Vercel route allows 120s so it does not cut that off.
