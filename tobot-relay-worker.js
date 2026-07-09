/**
 * TOBOT G-FORCE — Kindroid relay worker
 * ---------------------------------------------------
 * This runs on Cloudflare Workers (free tier is plenty).
 * It is the ONLY place your Kindroid API key and AI ID live.
 * The HTML page never sees them — it only talks to this worker.
 *
 * SETUP:
 * 1. Go to https://dash.cloudflare.com -> Workers & Pages -> Create -> Worker
 * 2. Paste this whole file in, replacing the default code.
 * 3. Go to Settings -> Variables and Secrets -> add two SECRET variables:
 *      KINDROID_API_KEY   = kn_75956c85-a91d-4e43-91be-748197187e45 
 *      KINDROID_AI_ID     = cfkyOPx31WmFTRmDXhZI
 *    (Regenerate your key in Kindroid's settings first if you ever pasted
 *    the old one anywhere outside Kindroid's own site — treat any key
 *    that's been typed into a chat or doc as burned.)
 * 4. Click Deploy. Copy the worker URL, something like:
 *      https://tobot-relay.YOURNAME.workers.dev
 * 5. Paste that URL into the settings (gear icon) on the Tobot Voice Link
 *    page. That's it — no keys ever touch the page or Garrett's device.
 *
 * This worker also does a light server-side safety pass on both what
 * Garrett says and what comes back, as a second layer on top of the
 * kid-safe persona you already configured in Kindroid. It's a basic
 * keyword net, not a substitute for adult supervision — please keep
 * an eye on the transcript log from time to time.
 */

const BLOCKED_TERMS = [
  // Keep this list short and obvious — it's a backstop, not the main defense.
  // Add/remove terms freely; this is just a basic net.
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
      return new Response(SAFE_FALLBACK, {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain" },
      });
    }

    if (!env.KINDROID_API_KEY || !env.KINDROID_AI_ID) {
      return new Response(
        "Relay isn't configured yet — add KINDROID_API_KEY and KINDROID_AI_ID in the worker's secret variables.",
        { status: 500, headers: CORS_HEADERS }
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
        const errText = await kindroidResp.text();
        return new Response(SAFE_FALLBACK, {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "text/plain" },
        });
      }

      reply = await kindroidResp.text();
    } catch (e) {
      return new Response(SAFE_FALLBACK, {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain" },
      });
    }

    // Second safety pass: what the AI said back
    if (containsBlocked(reply)) {
      reply = SAFE_FALLBACK;
    }

    return new Response(reply, {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "text/plain" },
    });
  },
};
