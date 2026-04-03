# Wanly Console

React frontend for the Wanly video generation system.

## Purpose

- Job creation and management
- Segment monitoring and control
- Video preview and download
- LoRA library management
- System status dashboard

## Key Pages

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/` | Overview of jobs, workers, system status |
| Job List | `/jobs` | List all jobs with status |
| Job Detail | `/jobs/:id` | Segment management, video preview |
| Workers | `/workers` | GPU worker status |
| LoRA Library | `/loras` | Manage LoRA models |

## Key Components

- `src/pages/JobDetail.tsx`: Main job/segment management interface
- `src/pages/CreateJobDialog.tsx`: Job creation form
- `src/pages/Workers.tsx`: Worker monitoring
- `src/api/`: API client functions

## Quality Enhancement UI

Displays information about quality enhancement features:

### Segment Detail Modal
- **Motion Keywords**: Shows detected motion keywords as styled chips
- **Reference Frames**: Shows thumbnails of reference frames used for identity anchoring

### Segment Form
- **Cross-dissolve option**: Transition between segments (not recommended - use seamless continuity instead)

## Tech Stack

- React 18
- MUI (Material UI)
- React Router
- Vite

## Development

```bash
npm install
npm run dev
npm run build
```

## Related Projects

- `wanly-api`: Backend API server
- `wanly-gpu-daemon`: Worker daemon
