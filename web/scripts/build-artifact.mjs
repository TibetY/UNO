// Builds dist-artifact/card-duel.html: one self-contained page for claude.ai
// Artifacts. React loads from cdnjs (allowed by the artifact CSP); the app's
// JS and CSS are inlined.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, "dist-artifact", ".tmp");
await rm(tmp, { recursive: true, force: true });

await build({
  root,
  configFile: false,
  logLevel: "warn",
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: tmp,
    emptyOutDir: true,
    minify: true,
    lib: { entry: path.join(root, "src/main.tsx"), formats: ["iife"], name: "CardDuel", fileName: () => "app.js" },
    rollupOptions: {
      external: ["react", "react-dom", "react-dom/client"],
      output: { globals: { react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM" } },
    },
  },
});

const js = (await readFile(path.join(tmp, "app.js"), "utf8")).replace(/<\/(script)/gi, "<\\/$1");
const css = await readFile(path.join(tmp, "style.css"), "utf8");
const html = `<title>Card Duel</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600;700&display=swap">
<style>${css}</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${js}</script>
`;
await mkdir(path.join(root, "dist-artifact"), { recursive: true });
await writeFile(path.join(root, "dist-artifact", "card-duel.html"), html);
await rm(tmp, { recursive: true, force: true });
console.log(`dist-artifact/card-duel.html  ${(html.length / 1024).toFixed(1)} KiB`);
