import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getLocalLanIp(): string {
  try {
    const interfaces = os.networkInterfaces();
    const candidates: { name: string; address: string; priority: number }[] = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal) {
          const lower = name.toLowerCase();
          // Deprioritize virtual adapters and local hotspot gateway interfaces
          const isVirtual =
            lower.includes("vethernet") ||
            lower.includes("vmware") ||
            lower.includes("vbox") ||
            lower.includes("wsl") ||
            lower.includes("docker") ||
            lower.includes("local area connection*");
          const isWiFiOrLan = lower.includes("wi-fi") || lower.includes("wlan") || lower.includes("ethernet");
          const priority = isVirtual ? 3 : isWiFiOrLan ? 1 : 2;
          candidates.push({ name, address: addr.address, priority });
        }
      }
    }
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates[0]?.address || "";
  } catch {
    return "";
  }
}

const detectedLanIp = getLocalLanIp();
const devLanOrigin = detectedLanIp ? `http://${detectedLanIp}:5173` : "";

function apkMimePlugin() {
  const attachMiddleware = (middlewares: any) => {
    middlewares.use((req: any, res: any, next: any) => {
      const urlPath = (req.url || "").split("?")[0];
      if (urlPath.endsWith(".apk")) {
        const filename = path.basename(urlPath) || "LSMIS-Mobile-v1.0.0.apk";
        res.setHeader("Content-Type", "application/vnd.android.package-archive");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type, Content-Disposition");
      }
      next();
    });
  };
  return {
    name: "lsmis-apk-mime",
    configureServer(server: any) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server: any) {
      attachMiddleware(server.middlewares);
    },
  };
}

/**
 * Stamps public/sw.js with a unique build id in the production output so each deployment ships a
 * byte-different service worker (the browser's trigger for detecting an update).
 */
function lsmisServiceWorkerPlugin() {
  const buildId = `${Date.now().toString(36)}`;
  let outDir = "dist";
  return {
    name: "lsmis-service-worker",
    apply: "build" as const,
    configResolved(config: any) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const swPath = path.join(outDir, "sw.js");
      if (!fs.existsSync(swPath)) return;
      const stamped = fs.readFileSync(swPath, "utf8").replace(/__BUILD_ID__/g, buildId);
      fs.writeFileSync(swPath, stamped);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [apkMimePlugin(), react(), tailwindcss(), viteSingleFile(), lsmisServiceWorkerPlugin()],
  define: {
    __DEV_LAN_ORIGIN__: JSON.stringify(devLanOrigin),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true,
  },
});
