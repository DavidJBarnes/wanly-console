import { Box, Card, CardContent, Typography } from "@mui/material";
import { Settings } from "@mui/icons-material";

export default function SettingsPage() {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Settings
      </Typography>
      <Card>
        <CardContent sx={{ textAlign: "center", py: 8 }}>
          <Settings sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            Coming soon
          </Typography>
          <Typography variant="body2" color="text.secondary">
            API configuration and user preferences.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
