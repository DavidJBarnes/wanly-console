import { Divider } from "@mui/material";

/**
 * The line between Person tags and Action tags in a wrapping row of pills. The full flex-basis is
 * what breaks the row: the Action tags start on a new line below it.
 */
export default function TagGroupRule() {
  return <Divider sx={{ flexBasis: "100%", my: 0.5 }} />;
}
