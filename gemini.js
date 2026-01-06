const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'auto';

function normalizeModelId(model) {
  const m = String(model || '').trim();
  if (!m) return '';
  return m.startsWith('models/') ? m.slice('models/'.length) : m;
}

function summarizeErrorText(errText) {
  const raw = String(errText || '');
  try {
    const json = JSON.parse(raw);
    const msg = json?.error?.message;
    return msg ? String(msg) : raw;
  } catch {
    return raw;
  }
}

function parseRetryAfterMs(message, retryAfterHeader) {
  // Prefer header if present (seconds)
  const header = String(retryAfterHeader || '').trim();
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs > 0) return Math.ceil(secs * 1000);
  }

  // Fallback to message: "Please retry in 22.4s."
  const m = String(message || '').match(/retry in\s+([0-9.]+)s/i);
  if (!m) return 0;
  const secs = Number(m[1]);
  if (!Number.isFinite(secs) || secs <= 0) return 0;
  return Math.ceil(secs * 1000);
}

function extractTextFromResponse(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => p?.text || '').join('').trim();
}

async function generateGeminiReply({
  apiKey,
  model = DEFAULT_MODEL,
  systemPrompt = 'Write a short, helpful reply.',
  userPrompt
}) {
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  if (!userPrompt) throw new Error('Missing userPrompt');

  const resolvedModel = normalizeModelId(model);
  const modelForRequest = resolvedModel || 'auto';

  const pickModel = async () => {
    // If user specified a concrete model, try it first.
    if (modelForRequest !== 'auto') return modelForRequest;

    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(listUrl);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const summary = summarizeErrorText(errText).replace(/\s+/g, ' ').trim().slice(0, 300);
      throw new Error(`Gemini listModels error ${res.status}: ${summary}`);
    }
    const json = await res.json();
    const models = Array.isArray(json?.models) ? json.models : [];
    const candidates = models
      .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => normalizeModelId(m?.name || ''))
      .filter(Boolean);

    // Prefer "flash" variants.
    const flash = candidates.find((m) => m.includes('flash'));
    return flash || candidates[0] || '';
  };

  const doRequest = async (modelId) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const summary = summarizeErrorText(errText).replace(/\s+/g, ' ').trim().slice(0, 300);
      const err = new Error(`Gemini API error ${res.status}: ${summary}`);
      err.status = res.status;
      err.body = errText;
      err.retryAfterMs = parseRetryAfterMs(summary, res.headers.get('retry-after'));
      throw err;
    }

    const json = await res.json();
    const text = extractTextFromResponse(json);
    if (!text) throw new Error('Gemini returned empty text');
    return text;
  };

  try {
    const modelId = await pickModel();
    if (!modelId) throw new Error('No Gemini model available for generateContent');
    return await doRequest(modelId);
  } catch (e) {
    // Fallback: if user specified a model and it failed, retry with auto model discovery.
    const status = e?.status;
    if (modelForRequest !== 'auto' && (status === 404 || status === 400)) {
      const autoModel = await generateGeminiReply({
        apiKey,
        model: 'auto',
        systemPrompt,
        userPrompt
      });
      return autoModel;
    }
    throw e;
  }
}

module.exports = {
  generateGeminiReply
};


