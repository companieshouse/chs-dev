import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileRule } from '../src/proxy/rule.js';

const matches = (rule: string, host: string, path: string) =>
    compileRule(rule)(host, path);

test('host-only rules match the host case-insensitively', () => {
    const rule = 'Host(`find-and-file.company-information.service.chs.local`)';
    assert.ok(
        matches(
            rule,
            'FIND-and-File.company-information.service.chs.local',
            '/',
        ),
    );
    assert.ok(!matches(rule, 'api.chs.local', '/'));
});

test('conjunctions require every matcher and bind tighter than disjunctions', () => {
    const rule =
        'Host(`api.chs.local`) && (PathPrefix(`/e5/rest`) || PathRegexp(`^/x/[0-9]+$`))';
    assert.ok(matches(rule, 'api.chs.local', '/e5/rest/thing'));
    assert.ok(matches(rule, 'api.chs.local', '/x/123'));
    assert.ok(!matches(rule, 'api.chs.local', '/other'));
    assert.ok(!matches(rule, 'other.chs.local', '/e5/rest'));
});

test('unparenthesized disjunctions only guard the first branch with the host', () => {
    const rule =
        'Host(`acsp-api.chs.local`) && PathPrefix(`/a`) || PathPrefix(`/b`)';
    assert.ok(matches(rule, 'acsp-api.chs.local', '/a/1'));
    assert.ok(matches(rule, 'anything.chs.local', '/b/2'));
    assert.ok(!matches(rule, 'other.chs.local', '/a/1'));
});

test('Path matches exactly and PathPrefix matches by prefix', () => {
    assert.ok(
        matches(
            'Host(`h.chs.local`) && Path(`/exact`)',
            'h.chs.local',
            '/exact',
        ),
    );
    assert.ok(
        !matches(
            'Host(`h.chs.local`) && Path(`/exact`)',
            'h.chs.local',
            '/exact/2',
        ),
    );
    assert.ok(
        matches(
            'Host(`h.chs.local`) && PathPrefix(`/pre`)',
            'h.chs.local',
            '/prefix',
        ),
    );
});

test('PathRegexp evaluates the pattern with named groups in both styles', () => {
    const goStyle =
        'Host(`api.chs.local`) && PathRegexp(`^/limited-partnerships/(?P<number>[a-zA-Z0-9]{8})/`)';
    const jsStyle =
        'Host(`api.chs.local`) && PathRegexp(`^/company/(?<number>[a-zA-Z0-9]{8})/registers`)';
    assert.ok(
        matches(goStyle, 'api.chs.local', '/limited-partnerships/OC123456/'),
    );
    assert.ok(matches(jsStyle, 'api.chs.local', '/company/OC123456/registers'));
    assert.ok(
        !matches(jsStyle, 'api.chs.local', '/company/TOOLONG123/registers'),
    );
});

test('rules that cannot parse never match', () => {
    const broken =
        'Host(`api.chs.local`) && (PathPrefix(`/e5/rest`) || Path Prefix(`/v4/customer`))';
    assert.ok(!matches(broken, 'api.chs.local', '/v4/customer'));
    assert.ok(!matches(broken, 'api.chs.local', '/e5/rest'));
    assert.ok(!matches('Host(`h`', 'h', '/'));
    assert.ok(!matches('Bogus(`h`)', 'h', '/'));
});
