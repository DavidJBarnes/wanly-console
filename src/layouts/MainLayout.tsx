import { useState } from "react";
import { Box, Toolbar } from "@mui/material";
import { Outlet, Navigate } from "react-router";
import Sidebar, { DRAWER_WIDTH } from "../components/Sidebar";
import TopBar from "../components/TopBar";
import { useAuthStore } from "../stores/authStore";

export default function MainLayout() {
  const token = useAuthStore((s) => s.token);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const handleDrawerToggle = () => {
    setMobileOpen((prev) => !prev);
  };

  return (
    <Box sx={{ display: "flex", height: "100dvh" }}>
      <Sidebar mobileOpen={mobileOpen} onClose={handleDrawerToggle} />
      <TopBar onMenuClick={handleDrawerToggle} />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: "background.default",
          p: { xs: 1.5, sm: 2, md: 3 },
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          overflow: "auto",
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
