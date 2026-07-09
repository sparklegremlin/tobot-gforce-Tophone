/**
 * TOBOT G-FORCE — Kindroid + ElevenLabs relay worker
 * ---------------------------------------------------
 * This runs on Cloudflare Workers (free tier is plenty).
 * It is the ONLY place your Kindroid key, Kindroid AI ID, and
 * ElevenLabs key live. The HTML page never sees any of them.
 *
 * WHAT THIS DOES:
 * 1. Takes what Garrett said (text).
 * 2. Sends it to Kindroid, gets Tobot's reply back as text.
 * 3. Sends that reply text to ElevenLabs, gets real spoken audio back.
 * 4. Sends BOTH the text and the audio back to the page in one go,
 *    so the page can show the words AND play the real voice.
 *
 * SETUP:
 * 1. Go to https://dash.cloudflare.com -> Workers & Pages -> your worker
 *    -> Edit code -> replace everything with this file -> Deploy.
 * 2. Settings -> Variables and Secrets -> make sure these exist:
 *      KINDROID_API_KEY      (Secret)  = kn_75956c85-a91d-4e43-91be-748197187e45
 *      KINDROID_AI_ID        (Secret)  = cfkyOPx31WmFTRmDXhZI
 *      ELEVENLABS_API_KEY    (Secret)  = sk_63dabc6d7af3cae261bb95dadd899e062676819481a41778
 *      ELEVENLABS_VOICE_ID   (Variable, plain text is fine) = RlebciW0Zq58a5o4KVOa
 *        ID you picked in ElevenLabs (from the Voices page, "Voice ID")
 * 3. Deploy again after adding the new secrets/variables.
 * 4. Nothing needs to change in your Cloudflare Worker's URL — the same
 *    URL you already put in the Voice Link page's settings keeps working.
 */

const BLOCKED_TERMS = [
  // Keep this list short and obvious — it's a backstop, not the main defense.
];

const SAFE_FALLBACK =
  "Whoa, my signal got fuzzy there! Ask me about flying, my powers, or Daedo City instead!";

function containsBlocked(text) {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some((term) => term && lower.includes(term));
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Turn raw audio bytes into a base64 string the page can decode and play.
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function textToSpeech(text, env) {
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) {
    return { audio: null, error: "Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID" };
  }
  try {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: text.slice(0, 900),
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );
    if (!resp.ok) {
      const errText = await resp.text();
      return { audio: null, error: `ElevenLabs ${resp.status}: ${errText.slice(0, 200)}` };
    }
    const buf = await resp.arrayBuffer();
    return { audio: arrayBufferToBase64(buf), error: null };
  } catch (e) {
    return { audio: null, error: `Exception: ${e.message}` };
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response("Use POST", { status: 405, headers: CORS_HEADERS });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response("Bad JSON", { status: 400, headers: CORS_HEADERS });
    }

    const message = (body.message || "").toString().slice(0, 800);
    if (!message.trim()) {
      return new Response("Empty message", { status: 400, headers: CORS_HEADERS });
    }

    // First safety pass: what Garrett said
    if (containsBlocked(message)) {
      const tts = await textToSpeech(SAFE_FALLBACK, env);
      return jsonResponse({ text: SAFE_FALLBACK, audio: tts.audio, audio_error: tts.error });
    }

    if (!env.KINDROID_API_KEY || !env.KINDROID_AI_ID) {
      return jsonResponse(
        {
          text: "Relay isn't configured yet — add KINDROID_API_KEY and KINDROID_AI_ID in the worker's secret variables.",
          audio: null,
        },
        500
      );
    }

    let reply;
    try {
      const kindroidResp = await fetch("https://api.kindroid.ai/v1/send-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.KINDROID_API_KEY}`,
        },
        body: JSON.stringify({
          ai_id: env.KINDROID_AI_ID,
          message: message,
          stream: false,
        }),
      });

      if (!kindroidResp.ok) {
        const tts = await textToSpeech(SAFE_FALLBACK, env);
        return jsonResponse({ text: SAFE_FALLBACK, audio: tts.audio, audio_error: tts.error });
      }

      reply = await kindroidResp.text();
    } catch (e) {
      const tts = await textToSpeech(SAFE_FALLBACK, env);
      return jsonResponse({ text: SAFE_FALLBACK, audio: tts.audio, audio_error: tts.error });
    }

    // Second safety pass: what the AI said back
    if (containsBlocked(reply)) {
      reply = SAFE_FALLBACK;
    }

    const tts = await textToSpeech(reply, env);
    return jsonResponse({ text: reply, audio: tts.audio, audio_error: tts.error });
  },
};
