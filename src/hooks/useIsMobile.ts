import { useMediaQuery, useTheme } from "@mui/material";

/**
 * Returns true when the viewport is below the "sm" breakpoint (600px).
 * Used for fullScreen dialogs and responsive layout adjustments.
 */
export function useIsMobile() {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("sm"));
}
