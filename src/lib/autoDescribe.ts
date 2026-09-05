/**
 * When tagging an image should trigger a scene description (console#414).
 *
 * The tag box saves on a 500ms debounce, so this question is asked on every pause in
 * typing, not once per image. It has to answer "yes" exactly once — a second yes is a
 * second 2070 call for a frame that is already described, on a box that also serves
 * Automatic1111.
 *
 * Tagging is the trigger because it is the moment a person has decided the image is worth
 * keeping. An untagged image is triage; describing all of them would be a queue of GPU work
 * for frames nobody has looked at.
 */
export function shouldAutoDescribe(args: {
  /** The tags just saved. */
  tags: string | null;
  /** What the image already has. A description is never silently replaced. */
  existing: string | null;
  /** True while a description for this image is already on its way. */
  inFlight: boolean;
}): boolean {
  if (args.inFlight) return false;
  if ((args.existing ?? "").trim()) return false;
  return Boolean((args.tags ?? "").trim());
}
