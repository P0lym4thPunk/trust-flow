import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createApiModule, errorHandler } from "./backend/src/index.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_PROD = process.env.NODE_ENV === "production";

function resolvePort(): number {
  const portArgIndex = process.argv.indexOf("--port");
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const parsed = parseInt(process.argv[portArgIndex + 1], 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (process.env.PORT) {
    const parsed = parseInt(process.env.PORT, 10);
    if (!Number.isNaN(parsed) && (IS_PROD || parsed !== 8080)) return parsed;
  }
  return 3000;
}

const PORT = resolvePort();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  // Mount consolidated authoritative /api backend
  const apiModule = createApiModule();
  app.use("/api", apiModule.router);
  app.use("/api", errorHandler);

  const httpServer = http.createServer(app);

  if (!IS_PROD) {
    let viteMiddleware: express.RequestHandler | null = null;
    const viteReady = createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : { server: httpServer },
      },
      appType: "spa",
    })
      .then((vite) => {
        viteMiddleware = vite.middlewares;
        return vite;
      })
      .catch((err) => {
        console.error("Failed to initialize Vite dev middleware:", err);
        throw err;
      });

    app.use(async (req, res, next) => {
      try {
        if (!viteMiddleware) {
          await viteReady;
        }
        return viteMiddleware!(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(
      `TrustFlow server running on http://0.0.0.0:${PORT} (Production: ${IS_PROD}, AI Model: ${apiModule.config.ai.model}, DevSandbox: ${apiModule.config.auth.allowDevSandbox})`
    );
  });
}

startServer();
