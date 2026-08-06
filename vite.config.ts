/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
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
