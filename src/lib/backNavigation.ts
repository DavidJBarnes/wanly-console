/**
 * Where a page's back arrow should actually go.
 *
 * Hard-coding a destination ("/jobs") is wrong whenever the page can be reached from more than
 * one place, which every detail page can: a job opens from the queue, from Videos, from the
 * dashboard, from an image's job list. Sending the user to the queue from any of those throws
 * away where they were, and on the list pages it also throws away the scroll position, page
 * number and filters that useQueryState went to some trouble to preserve.
 *
 * So: step back through history when there is history of our own to step back through, and fall
 * back to a sensible page when there is not.
 *
 * `locationKey` is how "history of our own" is detected. React Router stamps every location it
 * pushes with a unique key and leaves the FIRST entry in a session as "default" -- so a default
 * key means this page was opened cold: pasted link, new tab, refresh, or arrived from another
 * site. Calling history.back() there would leave the app entirely (or do nothing at all), which
 * is a worse outcome than the hard-coded destination this replaces.
 *
 * A refresh resets the key to "default" even though the browser still holds earlier entries.
 * Falling back is the right call there anyway: after a reload the user's intent is much better
 * served by a known page than by an entry they may have visited long ago.
 */
export function backTarget(locationKey: string | undefined, fallback: string): number | string {
  return !locationKey || locationKey === "default" ? fallback : -1;
}
