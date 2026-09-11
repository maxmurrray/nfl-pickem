/**
 * Optional "finishing pass": hand the rendered picks board to an image model
 * and ask it to make the same graphic look like a network broadcast designer
 * built it.
 *
 * This is image-to-image, not generation. The model gets the real board — real
 * ESPN logos, real picks, real records — as its input, which is a far tighter
 * leash than describing a board in words and hoping. It is still a model
 * redrawing pixels, so the UI always keeps the clean render alongside the
 * finished one; see the note in README.
 *
 * Two providers, picked by whichever credentials are present:
 *
 *   GEMINI_API_KEY      -> gemini-3-pro-image, i.e. Nano Banana PRO, up to 4K.
 *                          Works today; no account gating.
 *   HIGGSFIELD_API_KEY* -> Higgsfield's /nano-banana-pro. Same model, but it
 *                          has to be enabled on the account first (see the
 *                          error handling below).
 */

const HF_BASE = "https://api.higgsfield.ai";

/**
 * Higgsfield's published OpenAPI lists `/nano-banana`, but the live API
 * answers `model_not_found` there and `model_disabled` on `/nano-banana-pro`
 * — two different errors, which is how we know Pro is the real endpoint and is
 * simply gated per account. Overridable so a plan change doesn't need a deploy.
 */
const HF_MODEL_PATH = process.env.HIGGSFIELD_MODEL_PATH ?? "/nano-banana-pro";
// gemini-3-pro-image reports displayName "Nano Banana Pro" and supports
// generateContent (NOT the /interactions endpoint some docs describe).
const GEMINI_MODEL = "gemini-3-pro-image";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * The finishing instruction. The first paragraph is the art direction; the
 * rest is damage control — without it the model cheerfully rewrites records,
 * respells wordmarks and drops rows, because "make it look better" reads as
 * permission to redesign.
 */
export const POLISH_PROMPT = `Keep this graphic pretty much exactly the same, but just change it to make it look like a professional graphic artist, like a Fox Sports graphic designer who's paid top-of-the-line money made this graphic.

PRESERVE EXACTLY — do not alter, move, re-order, add or remove any of the following:
- Every team logo, and which card each one sits on. Do not redraw, restyle, replace or "clean up" any logo. Do not change any lettering inside a logo.
- The number of rows, and the order of the rows.
- Every word and number: the week number, both names, "LAST WEEK", "SEASON RECORD" and both records. Spelling and digits must match the input character for character.
- Which team appears in which of the three columns on each row.
- The team colours of every card.

BACKGROUND — this is a hard requirement: every part of the image that is not a card or text must be SOLID PURE BLACK (#000000). Do not add a stadium, arena, studio set, field, crowd, sky, desk, gradient, vignette, texture, noise, light rays, lens flare, glow, reflections on the floor, or any scenery whatsoever behind or around the board. The board floats on flat black, edge to edge, corner to corner.

WHAT TO IMPROVE: lighting on the cards themselves, depth, material quality, bevels, rims and highlights, and shadow realism under each card. Make the cards richer and more three-dimensional, like a broadcast lower-third package. Keep the same layout, proportions and colour identity — and keep the background black.`;

export type PolishProvider = "gemini" | "higgsfield";

export interface PolishStart {
  provider: PolishProvider;
  /** Set when the provider answered synchronously (Gemini). */
  dataUri?: string;
  /** Set when the job is asynchronous and must be polled (Higgsfield). */
  requestId?: string;
}

export interface PolishStatus {
  status: "queued" | "in_progress" | "completed" | "failed";
  url?: string;
  error?: string;
}

function higgsfieldAuth(): string | null {
  const id = process.env.HIGGSFIELD_API_KEY_ID;
  const secret = process.env.HIGGSFIELD_API_KEY_SECRET;
  return id && secret ? `Key ${id}:${secret}` : null;
}

export function availableProvider(): PolishProvider | null {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (higgsfieldAuth()) return "higgsfield";
  return null;
}

/* ----------------------------- Higgsfield ----------------------------- */

/**
 * Higgsfield takes input images by URL only, so the board is pushed to their
 * presigned bucket first. The upload URL is storage, not their API — sending
 * the API credentials to it would leak them, so only the returned headers go.
 */
async function uploadToHiggsfield(png: Buffer, auth: string): Promise<string> {
  const res = await fetch(`${HF_BASE}/files/generate-upload-url`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: "image/png" }),
  });
  if (!res.ok) {
    throw new Error(`upload url failed (${res.status}): ${await res.text()}`);
  }
  const { public_url, upload_url, upload_headers } = await res.json();
  if (!public_url || !upload_url) throw new Error("upload url response missing fields");

  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { ...(upload_headers ?? {}), "Content-Type": "image/png" },
    body: new Uint8Array(png),
  });
  if (!put.ok) {
    throw new Error(`upload failed (${put.status}): ${await put.text()}`);
  }
  return public_url as string;
}

async function startHiggsfield(
  png: Buffer,
  prompt: string,
  aspectRatio: string,
  auth: string
): Promise<PolishStart> {
  const imageUrl = await uploadToHiggsfield(png, auth);
  const res = await fetch(`${HF_BASE}${HF_MODEL_PATH}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      num_images: 1,
      aspect_ratio: aspectRatio,
      output_format: "png",
      input_images: [{ type: "image_url", image_url: imageUrl }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Turn the two gating errors into something actionable rather than a code.
    if (res.status === 503 && body.includes("model_disabled")) {
      throw new Error(
        `Nano Banana Pro isn't enabled on this Higgsfield account. Enable it in Higgsfield Cloud, or set GEMINI_API_KEY to run the same model (gemini-3-pro-image) directly through Google at 4K.`
      );
    }
    if (res.status === 423 && body.includes("model_blocked")) {
      throw new Error(`Higgsfield has this model blocked for this account.`);
    }
    throw new Error(
      `${HF_MODEL_PATH} failed (${res.status}): ${body.slice(0, 300)}`
    );
  }
  const data = await res.json();
  const requestId = data?.request_id;
  if (!requestId) throw new Error("no request_id in response");
  return { provider: "higgsfield", requestId };
}

export async function checkHiggsfield(requestId: string): Promise<PolishStatus> {
  const auth = higgsfieldAuth();
  if (!auth) return { status: "failed", error: "Higgsfield credentials missing" };

  const res = await fetch(`${HF_BASE}/requests/${requestId}/status`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) {
    return { status: "failed", error: `status ${res.status}` };
  }
  const data = await res.json();
  const status = data?.status;

  if (status === "completed") {
    const url = data?.images?.[0]?.url;
    return url
      ? { status: "completed", url }
      : { status: "failed", error: "completed with no image" };
  }
  if (status === "failed" || status === "canceled" || status === "nsfw") {
    return { status: "failed", error: data?.error ?? status };
  }
  return { status: status === "in_progress" ? "in_progress" : "queued" };
}

/* -------------------------------- Gemini -------------------------------- */

/**
 * Gemini answers 503 "high demand" fairly often and 429 when rate limited.
 * Both are transient and worth waiting out — a single attempt makes the button
 * look broken when it isn't.
 */
const GEMINI_RETRIES = 3;
const GEMINI_BACKOFF_MS = 8000;

async function startGemini(
  png: Buffer,
  prompt: string,
  aspectRatio: string
): Promise<PolishStart> {
  let lastTransient = "";
  for (let attempt = 0; attempt < GEMINI_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, GEMINI_BACKOFF_MS * attempt));
    }
    try {
      return await callGemini(png, prompt, aspectRatio);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/\b(503|429)\b/.test(msg)) throw e;
      lastTransient = msg;
    }
  }
  throw new Error(
    `Nano Banana Pro is busy on Google's side right now (tried ${GEMINI_RETRIES} times). This is temporary — give it a minute and hit the button again.` +
      (lastTransient ? ` [${lastTransient.slice(0, 120)}]` : "")
  );
}

async function callGemini(
  png: Buffer,
  prompt: string,
  aspectRatio: string
): Promise<PolishStart> {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY as string,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/png", data: png.toString("base64") } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio, imageSize: "4K" },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `gemini failed (${res.status}): ${(await res.text()).slice(0, 400)}`
    );
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.find((p: any) => p?.inlineData?.data ?? p?.inline_data?.data)
    ? (parts.find((p: any) => p?.inlineData?.data ?? p?.inline_data?.data).inlineData ??
        parts.find((p: any) => p?.inline_data?.data).inline_data).data
    : null;
  if (!b64) {
    const text = parts.map((p: any) => p?.text).filter(Boolean).join(" ");
    throw new Error(
      `Gemini returned no image${text ? `: ${text.slice(0, 200)}` : "."}`
    );
  }
  return { provider: "gemini", dataUri: `data:image/png;base64,${b64}` };
}

/* -------------------------------- entry --------------------------------- */

export async function startPolish(
  png: Buffer,
  prompt: string,
  aspectRatio: string
): Promise<PolishStart> {
  const provider = availableProvider();
  if (provider === "gemini") return startGemini(png, prompt, aspectRatio);
  const auth = higgsfieldAuth();
  if (auth) return startHiggsfield(png, prompt, aspectRatio, auth);
  throw new Error(
    "No image-model credentials configured (set HIGGSFIELD_API_KEY_ID/SECRET or GEMINI_API_KEY)."
  );
}
