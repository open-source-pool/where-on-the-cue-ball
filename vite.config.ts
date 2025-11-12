import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const env = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

const repoName = env?.GITHUB_REPOSITORY?.split("/")?.[1] ?? "";
const base = env?.GITHUB_ACTIONS && repoName ? `/${repoName}/` : "/";

export default defineConfig({
  base,
  plugins: [react()],
});
