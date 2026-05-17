/** Strip markdown fences / prose so Gemini JSON responses parse reliably. */
export function parseGeminiJsonResponse(raw: string): Record<string, unknown> {
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as Record<string, unknown>;
}

export function normalizeConfidence(value: unknown): number {
  let c = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(c)) return 0.85;
  if (c > 1) c = Math.min(c / 100, 1);
  return Math.min(Math.max(c, 0), 1);
}
