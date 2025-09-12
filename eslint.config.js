import next from 'eslint-config-next';

// Silence lint/import processing for firmware sources (non-JS/TS)
export default [
  ...next(),
  {
    ignores: [
      'src/cpp codes/**',
      'src/cpp codes/**/*',
    ],
  },
];
