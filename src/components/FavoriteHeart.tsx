import { IconButton } from "@mui/material";
import { Favorite, FavoriteBorder } from "@mui/icons-material";

interface FavoriteHeartProps {
  favorited: boolean;
  onToggle: () => void;
  size?: "small" | "medium";
}

export default function FavoriteHeart({ favorited, onToggle, size = "small" }: FavoriteHeartProps) {
  return (
    <IconButton
      size={size}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      sx={{
        color: favorited ? "#e91e63" : "rgba(255,255,255,0.7)",
        bgcolor: "rgba(0,0,0,0.4)",
        "&:hover": { bgcolor: "rgba(0,0,0,0.6)" },
      }}
    >
      {favorited ? <Favorite fontSize="inherit" /> : <FavoriteBorder fontSize="inherit" />}
    </IconButton>
  );
}
