import { Box, Card, CardContent, Typography } from "@mui/material";
import { TextSnippet } from "@mui/icons-material";

export default function PromptLibrary() {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Prompt Library
      </Typography>
      <Card>
        <CardContent sx={{ textAlign: "center", py: 8 }}>
          <TextSnippet sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            Coming soon
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Save and reuse your favorite prompts.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
