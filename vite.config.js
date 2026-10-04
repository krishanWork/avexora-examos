import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";
export default defineConfig({ plugins: [react()], resolve: { alias: { "@": path.resolve(process.cwd(), "src") } }, server: { proxy: { "/api": "http://localhost:3090" } } });