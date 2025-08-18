import config, { browser, mocha } from 'eslint-config-coinspace';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...config,
  ...browser,
  {
    files: ['test/**/*.js'],
    ...mocha[0],
  },
];
