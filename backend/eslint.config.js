// ESLint 9.x flat config — for backend Node.js code
export default [
  {
    ignores: ["dist/", "node_modules/", "data/"],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        __dirname: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        fetch: "readonly",
        Crypto: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "warn",
      eqeqeq: ["error", "always"],
      curly: ["warn", "multi-line"],
      "no-throw-literal": "error",
      "prefer-promise-reject-errors": "warn",
    },
  },
];
