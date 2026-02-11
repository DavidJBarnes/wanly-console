import { Box, Card, CardContent, Typography } from "@mui/material";
import { VideoLibrary } from "@mui/icons-material";

export default function Videos() {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Videos
      </Typography>
      <Card>
        <CardContent sx={{ textAlign: "center", py: 8 }}>
          <VideoLibrary sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            Coming soon
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Finalized videos and exports will appear here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
