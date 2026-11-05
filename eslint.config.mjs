import combinedNesting from './scripts/eslint-rules/combined-nesting.mjs';
import babelParser from '@babel/eslint-parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
    { ignores: ['dist/**', 'node_modules/**'] },
    {
        files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}', '**/*.mjs'],
        languageOptions: {
            parser: babelParser,
            parserOptions: {
                requireConfigFile: false,
                babelOptions: {
                    babelrc: false,
                    configFile: false,
                    parserOpts: { plugins: ['typescript'] },
                },
            },
        },
        rules: {
            'no-async-promise-executor': 'error',
            'no-promise-executor-return': 'error',
            'no-unsafe-finally': 'error',
            'no-constant-binary-expression': 'error',
            'no-dupe-else-if': 'error',
            'no-duplicate-case': 'error',
            'array-callback-return': 'error',
            'no-fallthrough': 'error',
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'prefer-const': 'error',
            'no-var': 'error',
            'no-debugger': 'error',
        },
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: { local: { rules: { 'combined-nesting': combinedNesting } } },
        rules: {
            'local/combined-nesting': ['warn', 3],
            'max-depth': ['warn', 3],
            complexity: ['warn', 10],
            'max-lines-per-function': [
                'warn',
                { max: 80, skipBlankLines: true, skipComments: true },
            ],
            'max-nested-callbacks': ['warn', 3],
            'max-params': ['warn', 5],
        },
    },
    {
        files: ['**/*.tsx'],
        languageOptions: {
            parserOptions: {
                babelOptions: {
                    parserOpts: { plugins: ['typescript', 'jsx'] },
                },
            },
        },
    },
    {
        files: ['src/tui/**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
    {
        files: ['src/domain/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '(^|/)(infrastructure|tui|application|server|client|entrypoints|daemon-control)(/|$)',
                            message:
                                'Domain code must not depend on implementation or frontend layers.',
                        },
                    ],
                },
            ],
        },
    },
];
