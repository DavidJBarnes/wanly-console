import { Box, Card, CardContent, Typography } from "@mui/material";
import { Dashboard as DashboardIcon } from "@mui/icons-material";

export default function Dashboard() {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Dashboard
      </Typography>
      <Card>
        <CardContent sx={{ textAlign: "center", py: 8 }}>
          <DashboardIcon sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            Coming soon
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Stats, worker status, and queue overview will appear here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
