import { createHash } from 'node:crypto';
import { parseSync } from '@babel/core';

const negations = {
    '===': '!==',
    '!==': '===',
    '==': '!=',
    '!=': '==',
    '<': '>=',
    '<=': '>',
    '>': '<=',
    '>=': '<',
};
const boundaries = { '<': '<=', '<=': '<', '>': '>=', '>=': '>' };
const ignoredKeys = new Set([
    'loc',
    'extra',
    'comments',
    'tokens',
    'leadingComments',
    'trailingComments',
    'innerComments',
    'typeAnnotation',
    'typeParameters',
    'typeArguments',
    'returnType',
    'superTypeParameters',
    'implements',
]);

export function parseSource(source, file) {
    const plugins = file.endsWith('.tsx')
        ? ['typescript', 'jsx']
        : ['typescript'];
    return parseSync(source, {
        filename: file,
        babelrc: false,
        configFile: false,
        parserOpts: { plugins, tokens: true },
    });
}

function children(node) {
    if (node.type.startsWith('TS')) {
        return [node.expression ?? node.parameter].filter(Boolean);
    }
    return Object.entries(node)
        .filter(([key]) => !ignoredKeys.has(key))
        .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
        .filter((value) => value && typeof value.type === 'string');
}

function nodeEdits(node, tokens) {
    const edits = [];
    const add = (operator, start, end, replacement) => {
        edits.push({ operator, start, end, replacement });
    };
    if (node.type === 'BooleanLiteral') {
        add('boolean', node.start, node.end, String(!node.value));
    }
    if (
        node.test &&
        [
            'IfStatement',
            'WhileStatement',
            'DoWhileStatement',
            'ForStatement',
            'ConditionalExpression',
        ].includes(node.type)
    ) {
        add('guard-true', node.test.start, node.test.end, 'true');
        add('guard-false', node.test.start, node.test.end, 'false');
    }
    if (node.type === 'UnaryExpression' && node.operator === '!') {
        add('negation-removal', node.start, node.end, '');
        edits[edits.length - 1].argument = node.argument;
    }
    return [...edits, ...operatorEdits(node, tokens)];
}

function operatorEdits(node, tokens) {
    const edits = [];
    const add = (operator, start, end, replacement) => {
        edits.push({ operator, start, end, replacement });
    };
    if (!['BinaryExpression', 'LogicalExpression'].includes(node.type))
        return [];
    const token = tokens.find(
        (candidate) =>
            candidate.start >= node.left.end &&
            candidate.end <= node.right.start &&
            candidate.value === node.operator,
    );
    if (!token) throw new Error(`Cannot locate operator ${node.operator}`);
    if (node.operator === '&&' || node.operator === '||') {
        add(
            'logical',
            token.start,
            token.end,
            node.operator === '&&' ? '||' : '&&',
        );
    }
    if (negations[node.operator])
        add(
            'comparison-negation',
            token.start,
            token.end,
            negations[node.operator],
        );
    if (boundaries[node.operator])
        add(
            'comparison-boundary',
            token.start,
            token.end,
            boundaries[node.operator],
        );
    return edits;
}

function describeEdit(edit, source, file) {
    const replacement = edit.argument
        ? `(${source.slice(edit.argument.start, edit.argument.end)})`
        : edit.replacement;
    const original = source.slice(edit.start, edit.end);
    const hash = createHash('sha256')
        .update(
            JSON.stringify([file, edit.start, edit.end, original, replacement]),
        )
        .digest('hex');
    const prefix = source.slice(0, edit.start);
    return {
        id: `${file.replace(/[^a-zA-Z0-9]/g, '-')}-${hash.slice(0, 12)}`,
        hash,
        file,
        operator: edit.operator,
        start: edit.start,
        end: edit.end,
        line: prefix.split('\n').length,
        column: edit.start - prefix.lastIndexOf('\n'),
        original,
        replacement,
    };
}

export function generateMutants(source, file) {
    const ast = parseSource(source, file);
    const pending = [ast.program];
    const mutants = new Map();
    while (pending.length) {
        const node = pending.pop();
        if (node.type.startsWith('TS')) {
            pending.push(...children(node));
            continue;
        }
        for (const edit of nodeEdits(node, ast.tokens)) {
            const mutant = describeEdit(edit, source, file);
            if (
                mutant.original !== mutant.replacement &&
                !mutants.has(mutant.hash)
            )
                mutants.set(mutant.hash, mutant);
        }
        pending.push(...children(node).reverse());
    }
    return [...mutants.values()].sort(
        (a, b) =>
            a.start - b.start || a.replacement.localeCompare(b.replacement),
    );
}

export function applyMutant(source, mutant) {
    return (
        source.slice(0, mutant.start) +
        mutant.replacement +
        source.slice(mutant.end)
    );
}
