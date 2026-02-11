import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Box,
} from "@mui/material";
import {
  Dashboard as DashboardIcon,
  VideoLibrary,
  QueueMusic,
  Dns,
  AutoFixHigh,
  TextSnippet,
  Image,
  Settings,
} from "@mui/icons-material";
import { useNavigate, useLocation } from "react-router";

export const DRAWER_WIDTH = 220;

const NAV_ITEMS = [
  { label: "Dashboard", icon: <DashboardIcon />, path: "/" },
  { label: "Job Queue", icon: <QueueMusic />, path: "/jobs" },
  { label: "Workers", icon: <Dns />, path: "/workers" },
  { label: "Videos", icon: <VideoLibrary />, path: "/videos" },
  { label: "LoRA Library", icon: <AutoFixHigh />, path: "/loras" },
  { label: "Prompts", icon: <TextSnippet />, path: "/prompts" },
  { label: "Image Repo", icon: <Image />, path: "/images" },
  { label: "Settings", icon: <Settings />, path: "/settings" },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: DRAWER_WIDTH,
          boxSizing: "border-box",
          bgcolor: "#1a223f",
          color: "#fff",
          border: "none",
        },
      }}
    >
      <Toolbar sx={{ px: 2, py: 1 }}>
        <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
          Wanly Console
        </Typography>
      </Toolbar>
      <Box sx={{ overflow: "auto", mt: 1 }}>
        <List disablePadding>
          {NAV_ITEMS.map((item) => (
            <ListItemButton
              key={item.path}
              onClick={() => navigate(item.path)}
              selected={isActive(item.path)}
              sx={{
                mx: 1,
                borderRadius: 2,
                mb: 0.5,
                color: "rgba(255,255,255,0.6)",
                "&.Mui-selected": {
                  bgcolor: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  "&:hover": { bgcolor: "rgba(255,255,255,0.12)" },
                },
                "&:hover": { bgcolor: "rgba(255,255,255,0.06)" },
              }}
            >
              <ListItemIcon sx={{ color: "inherit", minWidth: 40 }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Drawer>
  );
}
