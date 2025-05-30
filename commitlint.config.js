module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // New feature
        'fix', // Bug fix
        'docs', // Documentation
        'style', // Formatting, missing semicolons, etc
        'refactor', // Code refactoring
        'perf', // Performance improvements
        'test', // Adding tests
        'chore', // Maintenance tasks
        'ci', // CI/CD changes
        'build', // Build system changes
        'revert', // Reverting changes
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'backend',
        'frontend',
        'shared',
        'sdk',
        'task-manager',
        'auth',
        'ui',
        'api',
        'websocket',
        'heartbeat',
        'theme',
        'i18n',
        'build',
        'deps',
      ],
    ],
    'subject-case': [2, 'always', 'sentence-case'],
    'subject-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
  },
}
