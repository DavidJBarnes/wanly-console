/**
 * The two tag groups (wanly-api#486). Person tags name who is in an image; Action tags say
 * what is happening, and only they have a description: the short "what happens" prompt that
 * Enhance prompt sends to the Sulphur-2 enhancer with the image.
 */
import type { TitleTagResponse } from "../api/types";

export const PERSON_GROUP = 1;
export const ACTION_GROUP = 2;

/**
 * What Enhance prompt will send for an image tagged `tags`: the descriptions of ALL its Action
 * tags, in the image's tag order, each once. Null when none of them has a description. Mirrors
 * wanly-api's prompt_enhance.action_prompt, which is what actually decides; this is so the
 * modal can say so before the ~30 s call.
 */
export function actionPrompt(tags: string | null | undefined, actionTags: TitleTagResponse[]): string | null {
  const byName = new Map(
    actionTags.map((t) => [t.name.toLowerCase(), (t.description ?? "").trim()] as const));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of (tags ?? "").split(",")) {
    const key = raw.trim().toLowerCase();
    const text = byName.get(key);
    if (!key || seen.has(key) || !text) continue;
    seen.add(key);
    lines.push(text);
  }
  return lines.length ? lines.join("\n") : null;
}

/**
 * The Action tags `tags` carries, by their canonical names, in the image's tag order, each
 * once (console#709). Unlike actionPrompt this keeps tags with no description: a job is named
 * for what happens in it, whether or not the enhancer has words for it yet.
 */
export function actionTagNames(tags: string | null | undefined, actionTags: TitleTagResponse[]): string[] {
  const byName = new Map(actionTags.map((t) => [t.name.toLowerCase(), t.name] as const));
  const names: string[] = [];
  for (const raw of (tags ?? "").split(",")) {
    const name = byName.get(raw.trim().toLowerCase());
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
