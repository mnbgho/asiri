import { defineConfig } from "vite";

// Static app: the chain is the database, this bundle holds no state,
// no keys, and no server-side anything.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
});
