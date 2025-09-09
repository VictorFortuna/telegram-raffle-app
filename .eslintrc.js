module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 12,
  },
  globals: {
    io: 'readonly',
    Telegram: 'readonly',
    CONFIG: 'readonly',
    UTILS: 'readonly',
    API: 'readonly',
    SOCKET: 'readonly',
    UI: 'readonly',
    APP: 'readonly'
  },
  rules: {
    'indent': ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    'no-console': 'off', // Разрешаем console.log для логирования
    'no-trailing-spaces': 'error',
    'eol-last': 'error',
    'comma-dangle': ['error', 'never'],
    'object-curly-spacing': ['error', 'always'],
    'array-bracket-spacing': ['error', 'never'],
    'space-before-function-paren': ['error', 'never'],
    'keyword-spacing': ['error', { 'before': true, 'after': true }],
    'space-infix-ops': 'error',
    'no-multiple-empty-lines': ['error', { 'max': 2 }],
    'prefer-const': 'error',
    'no-var': 'error',
    'arrow-spacing': 'error',
    'prefer-arrow-callback': 'error',
    'no-duplicate-imports': 'error'
  },
  overrides: [
    {
      files: ['public/js/*.js'],
      env: {
        browser: true,
        node: false
      }
    },
    {
      files: ['src/**/*.js', 'server.js', 'scripts/**/*.js'],
      env: {
        node: true,
        browser: false
      }
    },
    {
      files: ['tests/**/*.js'],
      env: {
        jest: true,
        node: true
      }
    }
  ]
};