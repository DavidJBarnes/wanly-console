import { Box, Card, CardContent, Typography } from "@mui/material";
import { Image } from "@mui/icons-material";

export default function ImageRepo() {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Image Repo
      </Typography>
      <Card>
        <CardContent sx={{ textAlign: "center", py: 8 }}>
          <Image sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            Coming soon
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage starting images and reference images.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
