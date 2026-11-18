import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function stripDevSigningHarnessInBuild(): Plugin {
  const virtualPanelId = '\0virtual:trustflow-no-dev-signing-panel';
  const virtualHelperId = '\0virtual:trustflow-no-dev-signing-helpers';

  return {
    name: 'trustflow-strip-dev-signing-harness',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, '/');
      if (normalizedId.endsWith('/src/App.tsx') && code.includes('DevPrivySigningTestPanel')) {
        return {
          code: code.replace(
            /React\.lazy\(\(\)\s*=>\s*import\(["']\.\/components\/DevPrivySigningTestPanel["']\)\)/g,
            'null'
          ),
          map: null,
        };
      }
      return null;
    },
    resolveId(source) {
      if (source.includes('DevPrivySigningTestPanel')) {
        return virtualPanelId;
      }
      if (source.includes('privySigningTest')) {
        return virtualHelperId;
      }
      return null;
    },
    load(id) {
      if (id === virtualPanelId) {
        return 'export const DevPrivySigningTestPanel = () => null; export default DevPrivySigningTestPanel;';
      }
      if (id === virtualHelperId) {
        return 'export default {};';
      }
      return null;
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [stripDevSigningHarnessInBuild(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
        '@solana-program/system': path.resolve(import.meta.dirname, 'src/lib/shims/solana-system-shim.ts'),
        '@base-org/account': path.resolve(import.meta.dirname, 'src/lib/shims/base-account-shim.ts'),
        '@walletconnect/jsonrpc-http-connection': path.resolve(import.meta.dirname, 'src/lib/shims/walletconnect-http-shim.ts'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
