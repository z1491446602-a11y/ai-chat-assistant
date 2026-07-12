import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const browserGlobals = {
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  alert: 'readonly',
  AudioContext: 'readonly',
  Blob: 'readonly',
  btoa: 'readonly',
  clearTimeout: 'readonly',
  confirm: 'readonly',
  crypto: 'readonly',
  document: 'readonly',
  Event: 'readonly',
  fetch: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  HTMLAudioElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLImageElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLVideoElement: 'readonly',
  Image: 'readonly',
  localStorage: 'readonly',
  MediaStream: 'readonly',
  MediaStreamAudioSourceNode: 'readonly',
  MediaStreamConstraints: 'readonly',
  navigator: 'readonly',
  Navigator: 'readonly',
  Notification: 'readonly',
  queueMicrotask: 'readonly',
  React: 'readonly',
  Response: 'readonly',
  RTCPeerConnection: 'readonly',
  RTCIceCandidate: 'readonly',
  RTCIceCandidateInit: 'readonly',
  RTCSessionDescription: 'readonly',
  RTCSessionDescriptionInit: 'readonly',
  ScriptProcessorNode: 'readonly',
  setTimeout: 'readonly',
  TextDecoder: 'readonly',
  window: 'readonly',
};

const nodeGlobals = {
  __dirname: 'readonly',
  Blob: 'readonly',
  Buffer: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  FormData: 'readonly',
  process: 'readonly',
  queueMicrotask: 'readonly',
  Response: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  TextDecoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
};

export default [
  {
    ignores: [
      'dist',
      'node_modules',
      'workspace-artifacts',
    ],
  },
  js.configs.recommended,
  {
    files: [
      '*.js',
      '*.mjs',
      'server.js',
      'fileAttachmentTools.js',
      'server/**/*.js',
      'tests/**/*.js',
      'scripts/**/*.js',
      'scripts/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-constant-condition': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tsParser,
      globals: browserGlobals,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactPlugin,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-constant-condition': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'off',
    },
  }
];
