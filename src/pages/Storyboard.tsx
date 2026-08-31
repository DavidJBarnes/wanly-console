import { useState } from "react";
import { Box, Card, CardContent, Stack, Typography, Alert, Button } from "@mui/material";
import { Movie } from "@mui/icons-material";
import { useNavigate } from "react-router";
import RecipeForm from "../components/RecipeForm";

/**
 * Storyboard — LTX 2.3 recipe renders.
 *
 * Pick a character, a pose and a start frame. The render goes through the queue
 * like any other job, so it lands in Videos and carries identity chips and
 * observations without any of that machinery knowing which engine produced it.
 *
 * The form itself is shared with the New Job dialog — see RecipeForm. Two copies
 * of it would drift, which is the same failure this project already had with two
 * copies of recipes.json.
 */
export default function Storyboard() {
  const navigate = useNavigate();
  const [created, setCreated] = useState<string | null>(null);

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Storyboard</Typography>

      <Card>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <Movie fontSize="small" />
            <Typography variant="h6">Recipe render</Typography>
          </Stack>

          {created && (
            <Alert
              severity="success"
              sx={{ mb: 2 }}
              action={
                <Button size="small" onClick={() => navigate(`/jobs/${created}`)}>
                  Open job
                </Button>
              }
            >
              Queued. A worker picks it up within seconds; the render takes 8–12 minutes.
            </Alert>
          )}

          <RecipeForm variant="page" onCreated={setCreated} />
        </CardContent>
      </Card>
    </Box>
  );
}
