/**
 * POST /api/subscribe
 *
 * Receives a newsletter signup from the site and forwards it to Kit (v4 API).
 * The Kit API key lives only in Vercel environment variables, never in the browser.
 *
 * Required env vars:
 *   KIT_API_KEY  - Kit v4 API key (Kit > Settings > Developer)
 *   KIT_FORM_ID  - numeric ID of the Kit form that receives signups
 *
 * Double opt-in: the subscriber is created as "inactive", then added to the form.
 * Kit sends the confirmation email (the form must have "Send confirmation email"
 * on and "Auto-confirm new subscribers" off). They become active once they click it.
 */

const KIT_API = "https://api.kit.com/v4";
const DEFAULT_REFERRER = "https://withjuancarlos.com/updates/";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser or same-origin GET-style request
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function kit(path, apiKey, payload) {
  return fetch(`${KIT_API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Kit-Api-Key": apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!isSameOrigin(req)) {
    return res.status(403).json({ error: "Forbidden." });
  }

  const apiKey = process.env.KIT_API_KEY;
  const formId = process.env.KIT_FORM_ID;
  if (!apiKey || !formId) {
    console.error("subscribe: KIT_API_KEY or KIT_FORM_ID is not configured");
    return res.status(500).json({ error: "Signup is temporarily unavailable." });
  }

  const body = parseBody(req);

  // Honeypot: real visitors never fill this hidden field. Pretend success for bots.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return res.status(200).json({ ok: true });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const firstName =
    typeof body.first_name === "string" ? body.first_name.trim().slice(0, 80) : "";

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  try {
    // 1. Create (or update) the subscriber. "inactive" = unconfirmed, which keeps
    //    double opt-in intact. For an existing subscriber, Kit only updates the
    //    first name and leaves their state alone.
    const created = await kit("/subscribers", apiKey, {
      email_address: email,
      ...(firstName ? { first_name: firstName } : {}),
      state: "inactive",
    });

    if (!created.ok) {
      console.error("subscribe: create subscriber failed", created.status);
      const status = created.status === 422 ? 400 : 502;
      return res.status(status).json({
        error:
          status === 400
            ? "That email address was not accepted. Please check it and try again."
            : "Something went wrong. Please try again in a moment.",
      });
    }

    const { subscriber } = await created.json();

    // 2. Add them to the form, which triggers Kit's confirmation email.
    const referrer =
      typeof req.headers.referer === "string" && req.headers.referer.startsWith("http")
        ? req.headers.referer
        : DEFAULT_REFERRER;

    const added = await kit(
      `/forms/${encodeURIComponent(formId)}/subscribers/${subscriber.id}`,
      apiKey,
      { referrer }
    );

    if (!added.ok) {
      console.error("subscribe: add to form failed", added.status);
      return res
        .status(502)
        .json({ error: "Something went wrong. Please try again in a moment." });
    }

    // Same response whether the address is new or already on the list, so the
    // endpoint can't be used to check who is subscribed.
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("subscribe: unexpected error", err && err.name);
    return res
      .status(502)
      .json({ error: "Something went wrong. Please try again in a moment." });
  }
};
