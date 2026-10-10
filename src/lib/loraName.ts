/** "v2·final" out of a published basename like "Joana_v2_final" (wanly-api _artifact_key). */
export function shortLora(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /_v(\d+)_([A-Za-z0-9]+)$/.exec(name);
  return m ? `v${m[1]}·${m[2]}` : name;
}

