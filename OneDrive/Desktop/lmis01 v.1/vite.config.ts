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
const appBuildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

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
 * Dev service worker interceptor: prevents stale service worker from intercepting localhost dev.
 */
function devServiceWorkerPlugin() {
  return {
    name: "lsmis-dev-sw-interceptor",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const urlPath = (req.url || "").split("?")[0];
        if (urlPath === "/sw.js") {
          res.setHeader("Content-Type", "application/javascript");
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.end(`// LSMIS Dev Service Worker Interceptor: immediately unregister self on localhost
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration.unregister().then(() => self.clients.claim())
  );
});
`);
          return;
        }
        if (urlPath === "/version.json") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.end(JSON.stringify({ buildId: "dev", isDev: true, timestamp: Date.now() }));
          return;
        }
        next();
      });
    },
  };
}

/**
 * Stamps public/sw.js with a unique build id and outputs version.json in production
 * so each deployment ships a byte-different service worker and verifiable build id.
 */
function lsmisServiceWorkerPlugin() {
  let outDir = "dist";
  return {
    name: "lsmis-service-worker",
    apply: "build" as const,
    configResolved(config: any) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      // 1. Stamp sw.js
      const swPath = path.join(outDir, "sw.js");
      if (fs.existsSync(swPath)) {
        const stamped = fs.readFileSync(swPath, "utf8").replace(/__BUILD_ID__/g, appBuildId);
        fs.writeFileSync(swPath, stamped);
      }

      // 2. Output version.json for client version verification
      const versionPath = path.join(outDir, "version.json");
      fs.writeFileSync(
        versionPath,
        JSON.stringify(
          {
            buildId: appBuildId,
            timestamp: Date.now(),
            builtAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    apkMimePlugin(),
    devServiceWorkerPlugin(),
    react(),
    tailwindcss(),
    viteSingleFile(),
    lsmisServiceWorkerPlugin(),
  ],
  define: {
    __DEV_LAN_ORIGIN__: JSON.stringify(devLanOrigin),
    __APP_BUILD_ID__: JSON.stringify(appBuildId),
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
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true,
  },
});
