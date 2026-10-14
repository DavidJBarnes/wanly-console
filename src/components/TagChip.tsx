import type { ElementType } from "react";
import { Avatar, Chip, type ChipProps } from "@mui/material";

import { useCharacterIcons } from "../hooks/useCharacterIcons";
import { iconForName } from "../lib/characterIcon";

type Props = ChipProps & {
  /** The character to show the icon of. Defaults to the label when the label is plain text --
   *  a tag -- so pass it only when the text is more than the name (`pair: DavidJoana`). */
  character?: string | null;
  /** The compact tag on a grid card: a 20 px chip with a 16 px icon. */
  dense?: boolean;
  /** Pass-throughs for a chip that is a link (component={RouterLink} to=...). */
  component?: ElementType;
  to?: string;
};

/**
 * A badge that shows a character's icon when it names one (console#658, #684): a tag that is
 * a character's name, or a chip about a character. Anything else is a plain Chip. The one
 * place this looks, so every tag and name badge in the console looks the same.
 */
export default function TagChip({ character, dense, label, sx, ...rest }: Props) {
  const icons = useCharacterIcons();
  const name = character ?? (typeof label === "string" ? label : null);
  const icon = iconForName(icons, name);
  return (
    <Chip
      label={label}
      avatar={icon
        ? <Avatar src={icon} alt={name ?? ""} imgProps={{ loading: "lazy" }}
                  sx={dense ? { width: 16, height: 16 } : undefined} />
        : undefined}
      sx={[dense ? { height: 20, fontSize: 11 } : {}, ...(Array.isArray(sx) ? sx : [sx])]}
      {...rest}
    />
  );
}
