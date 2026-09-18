import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type {ClientRequest, IncomingMessage, ServerResponse} from 'node:http';
import path from 'path';
import {defineConfig, loadEnv, type ProxyOptions} from 'vite';

const APP_BASE = '/the-delegation';

function stripBrowserSiteHeaders(proxyReq: ClientRequest) {
  // Ollama and ComfyUI reject LAN Origin/Referer (and some Sec-Fetch-* values).
  // Other PCs open http://<lan-ip>:3000/... so those headers must not be forwarded.
  proxyReq.removeHeader('origin');
  proxyReq.removeHeader('referer');
  proxyReq.removeHeader('sec-fetch-site');
  proxyReq.removeHeader('sec-fetch-mode');
  proxyReq.removeHeader('sec-fetch-dest');
}

function onProxyError(service: string, err: Error, _req: IncomingMessage, res: unknown) {
  console.error(`[vite] ${service} proxy error:`, err.message);
  const socket = res as ServerResponse | undefined;
  if (socket && typeof socket.writeHead === 'function' && !socket.headersSent) {
    socket.writeHead(502, {'Content-Type': 'application/json'});
    socket.end(
      JSON.stringify({
        error: `${service} is not reachable on the host PC (${err.message}).`,
      }),
    );
  }
}

function localProxy(
  prefix: string,
  target: string,
  extraProxyReq?: (proxyReq: ClientRequest) => void,
): ProxyOptions {
  const pattern = new RegExp(`^${prefix}`);
  return {
    target,
    changeOrigin: true,
    timeout: 600000,
    ws: true,
    rewrite: (p) => p.replace(pattern, ''),
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        stripBrowserSiteHeaders(proxyReq);
        extraProxyReq?.(proxyReq);
      });
      proxy.on('error', (err, req, res) => onProxyError(prefix.replace(/^\//, ''), err, req, res));
    },
  };
}

function serviceProxies(env: Record<string, string>): Record<string, ProxyOptions> {
  const ollama = (prefix: string) => localProxy(prefix, 'http://127.0.0.1:11434');
  const comfy = (prefix: string) => localProxy(prefix, 'http://127.0.0.1:8188');
  const openai = (prefix: string) =>
    localProxy(prefix, 'https://api.openai.com', (proxyReq) => {
      if (env.OPENAI_API_KEY) {
        proxyReq.setHeader('Authorization', `Bearer ${env.OPENAI_API_KEY}`);
      }
    });
  const memoryApi = (prefix: string): ProxyOptions => {
    const pattern = new RegExp(`^${prefix}`);
    return {
      target: `http://127.0.0.1:${env.API_PORT || '3001'}`,
      changeOrigin: true,
      timeout: 60000,
      rewrite: (p) => `/api${p.replace(pattern, '')}`,
      configure: (proxy) => {
        proxy.on('error', (err, req, res) => onProxyError('memory API', err, req, res));
      },
    };
  };

  return {
    '/api': memoryApi('/api'),
    [`${APP_BASE}/api`]: memoryApi(`${APP_BASE}/api`),
    '/ollama': ollama('/ollama'),
    [`${APP_BASE}/ollama`]: ollama(`${APP_BASE}/ollama`),
    '/comfyui': comfy('/comfyui'),
    [`${APP_BASE}/comfyui`]: comfy(`${APP_BASE}/comfyui`),
    '/openai': openai('/openai'),
    [`${APP_BASE}/openai`]: openai(`${APP_BASE}/openai`),
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const proxy = serviceProxies(env);
  const listen = {
    host: true as const,
    port: 3000,
    cors: true,
    allowedHosts: true as const,
    proxy,
  };

  return {
    base: `${APP_BASE}/`,
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      ...listen,
      strictPort: true,
      // Bind all interfaces so LAN clients can reach the app.
      // (`npm run dev` also passes --host=0.0.0.0)
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        // OneDrive sync touches docs/README/scripts and triggers full page reloads.
        ignored: ['**/docs/**', '**/*.md', '**/scripts/**', '**/.git/**'],
      },
    },
    preview: listen,
  };
});
