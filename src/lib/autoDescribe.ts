/**
 * When tagging an image should trigger a scene description (console#414).
 *
 * The tag box saves on a 500ms debounce, so this question is asked on every pause in
 * typing, not once per image. It has to answer "yes" exactly once — a second yes is a
 * second 2070 call for a frame that is already described, on a box that also serves
 * Automatic1111.
 *
 * Since console#727 every upload is described anyway, by the API's describe queue, so this is
 * the fast path for an image uploaded before that (or one the queue gave up on): tagging it
 * describes it now rather than waiting for a retry.
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
