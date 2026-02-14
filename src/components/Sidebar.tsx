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
  { label: "Wildcards", icon: <TextSnippet />, path: "/prompts" },
  { label: "Image Repo", icon: <Image />, path: "/images" },
  { label: "Settings", icon: <Settings />, path: "/settings" },
];

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    onClose();
  };

  const drawerContent = (
    <>
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
              onClick={() => handleNavClick(item.path)}
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
    </>
  );

  const paperStyles = {
    width: DRAWER_WIDTH,
    boxSizing: "border-box" as const,
    bgcolor: "#1a223f",
    color: "#fff",
    border: "none",
  };

  return (
    <>
      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", md: "none" },
          "& .MuiDrawer-paper": paperStyles,
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Desktop drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": paperStyles,
        }}
      >
        {drawerContent}
      </Drawer>
    </>
  );
}
