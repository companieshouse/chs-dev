/**
 * Compiles Traefik router rules into host/path matchers. Grammar and
 * precedence follow the v3 syntax the checkout uses: `&&` binds tighter than
 * `||`, values are backtick-quoted, and matchers are Host, Path, PathPrefix
 * and PathRegexp. A rule that fails to parse never matches, mirroring a
 * router Traefik cannot create (for example the `Path Prefix` typo on
 * ch-service-mock).
 */
export type RuleMatcher = (host: string, path: string) => boolean;

const MATCHERS = new Set(['Host', 'Path', 'PathPrefix', 'PathRegexp']);

interface Token {
    kind: 'matcher' | 'and' | 'or' | 'open' | 'close';
    name?: string;
    value?: string;
}

export function compileRule(rule: string): RuleMatcher {
    try {
        const tokens = tokenize(rule);
        const matcher = parseOr(tokens);
        if (tokens.length) return never;
        return matcher;
    } catch {
        return never;
    }
}

function never() {
    return false;
}

function tokenize(rule: string): Token[] {
    const tokens: Token[] = [];
    const matcher = /(&&|\|\||\(|\)|([A-Za-z]+)\s*\(`([^`]*)`\))/g;
    let position = 0;
    for (const match of rule.matchAll(matcher)) {
        if (match.index !== position) skip(rule, position, match.index);
        position = match.index + match[0]!.length;
        if (match[1] === '&&') tokens.push({ kind: 'and' });
        else if (match[1] === '||') tokens.push({ kind: 'or' });
        else if (match[1] === '(') tokens.push({ kind: 'open' });
        else if (match[1] === ')') tokens.push({ kind: 'close' });
        else if (!MATCHERS.has(match[2]!)) fail(rule, match.index);
        else tokens.push({ kind: 'matcher', name: match[2], value: match[3] });
    }
    if (rule.slice(position).trim() !== '') fail(rule, position);
    return tokens;
}

function skip(rule: string, from: number, to: number) {
    if (rule.slice(from, to).trim() !== '') fail(rule, from);
}

function fail(rule: string, position: number): never {
    throw new Error(
        `Unparsable rule at column ${position + 1}: ${JSON.stringify(rule)}`,
    );
}

function parseOr(tokens: Token[]): RuleMatcher {
    const parts: RuleMatcher[] = [parseAnd(tokens)];
    while (tokens[0]?.kind === 'or') {
        tokens.shift();
        parts.push(parseAnd(tokens));
    }
    if (parts.length === 1) return parts[0]!;
    return (host, path) => parts.some((part) => part(host, path));
}

function parseAnd(tokens: Token[]): RuleMatcher {
    const parts: RuleMatcher[] = [parseAtom(tokens)];
    while (tokens[0]?.kind === 'and') {
        tokens.shift();
        parts.push(parseAtom(tokens));
    }
    if (parts.length === 1) return parts[0]!;
    return (host, path) => parts.every((part) => part(host, path));
}

function parseAtom(tokens: Token[]): RuleMatcher {
    const token = tokens.shift();
    if (!token) throw new Error('Rule ended unexpectedly');
    if (token.kind === 'open') {
        const inner = parseOr(tokens);
        if (tokens.shift()?.kind !== 'close') throw new Error('Unclosed group');
        return inner;
    }
    if (token.kind !== 'matcher') throw new Error(`Unexpected ${token.kind}`);
    return atomMatcher(token.name!, token.value!);
}

function atomMatcher(name: string, value: string): RuleMatcher {
    if (name === 'Host') {
        const host = value.toLowerCase();
        return (candidate) => candidate.toLowerCase() === host;
    }
    if (name === 'Path') {
        return (_host, path) => path === value;
    }
    if (name === 'PathPrefix') {
        return (_host, path) => path.startsWith(value);
    }
    return regexpMatcher(value);
}

function regexpMatcher(value: string): RuleMatcher {
    const javascript = value.replace(/\(\?P</g, '(?<');
    const expression = new RegExp(javascript);
    return (_, path) => expression.test(path);
}
