import { Box, Toolbar } from "@mui/material";
import { Outlet, Navigate } from "react-router";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import { useAuthStore } from "../stores/authStore";

export default function MainLayout() {
  const token = useAuthStore((s) => s.token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <TopBar />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: "background.default",
          p: 3,
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
