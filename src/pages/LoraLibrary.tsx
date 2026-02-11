import { Box, Card, CardContent, Typography } from "@mui/material";
import { AutoFixHigh } from "@mui/icons-material";

export default function LoraLibrary() {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        LoRA Library
      </Typography>
      <Card>
        <CardContent sx={{ textAlign: "center", py: 8 }}>
          <AutoFixHigh sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            Coming soon
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Upload and manage LoRA models here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
