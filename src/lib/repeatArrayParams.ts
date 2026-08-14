/**
 * Axios request options that serialise array params as REPEATED KEYS: `tags=a&tags=b`.
 *
 * FastAPI reads a repeated key into a list. Axios' default is the bracket form (`tags[]=a`),
 * which arrives as a parameter named "tags[]" that the endpoint does not have -- so the filter
 * would be silently dropped and the search would quietly return everything instead of failing.
 *
 * Lives here rather than inline in the client so the serialisation can be asserted without
 * importing api/client, whose import-time interceptors assign window.location on a 401.
 */
export const REPEAT_ARRAY_PARAMS = { paramsSerializer: { indexes: null as null } };
