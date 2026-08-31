/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // wanly-api. Without this, `npm run dev` cannot even log in: the app posts to /api,
      // nothing serves it, and the failure looks like a rejected password rather than a
      // missing route — which is why local dev has gone unused.
      //
      // It points at the DEPLOYED api by default, so local dev is the real console against
      // real data, and your normal credentials work. Override with API_URL to aim it
      // somewhere else (a local api, a staging one).
      "/api": {
        target: process.env.API_URL ?? "http://api.wanly22.com:8001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
        // Uploads and long reads; matches the nginx read timeout in front of prod.
        timeout: 900_000,
        proxyTimeout: 900_000,
      },
      // ltx-engine, for the Storyboard page. Not a convenience: the engine is a
      // plain FastAPI app with no access-control headers, so a browser cannot
      // call it directly and `npm run build` output will NOT work without a
      // reverse proxy in front of it.
      //
      // This is the job API on 8190, NOT ComfyUI on 8191. The engine owns the
      // graph: it uploads keyframes, patches the workflow and submits. Pointing
      // the browser at ComfyUI would put graph assembly in the client, which is
      // where every silent conversion bug on that project lived.
      //
      // TEMPORARY. It goes away when wanly-api owns the queue and the recipe
      // book (wanly-api#206, #207) and this page talks to /api like every other.
      "/ltx": {
        target: process.env.LTX_URL ?? "http://3090.zero:8190",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ltx/, ""),
        // Submitting returns at once, but the video GET streams an mp4 and a job
        // can sit queued behind another for a long time.
        timeout: 960_000,
        proxyTimeout: 960_000,
      },
    },
  },
  // Pure-logic tests only: no jsdom, no testing-library, no mocking. Every console bug worth
  // catching so far has been state -> request-payload logic, which needs none of that.
  // Node environment also keeps `src/api/client.ts` out of reach — importing it installs axios
  // interceptors, one of which assigns window.location on a 401.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
