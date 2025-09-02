// ESLint v9 flat config
// Uses Next.js recommended config with TypeScript + React rules.
// Docs: https://eslint.org/docs/latest/use/configure/configuration-files-new

import next from 'eslint-config-next';

export default [
  // Next.js core + core-web-vitals
  ...next,

  // Project-specific ignores and overrides
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'dist-server/**',
      'monitor.logs/**',
      '.krosy-logs/**',
      'logs/**',
    ],
  },
  {
    rules: {
      // Keep noise low by default; adjust as needed
      'react/no-unescaped-entities': 'off',
    },
  },
];
