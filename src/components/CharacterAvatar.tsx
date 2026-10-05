import { Avatar } from "@mui/material";

import { getFileUrl } from "../api/client";
import type { Character } from "../api/ltx";
import { characterIconUri } from "../lib/characterIcon";

/**
 * A character's icon (console#616): the same image everywhere a character appears. Falls back
 * to the initial when the character has no image at all.
 */
export default function CharacterAvatar({
  character, name, size = 24, rounded = true,
}: {
  character?: Pick<Character, "icon_uri" | "image_uri" | "face_ref_uri" | "sheet_uri"> | null;
  /** For the initial, when there is no image (or no character row). */
  name: string;
  size?: number;
  rounded?: boolean;
}) {
  const uri = characterIconUri(character);
  return (
    <Avatar
      src={uri ? getFileUrl(uri) : undefined}
      alt={name}
      variant={rounded ? "rounded" : "circular"}
      sx={{ width: size, height: size, fontSize: size * 0.45, flexShrink: 0 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </Avatar>
  );
}
