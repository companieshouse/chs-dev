import { settingKeys } from '../domain/settings.js';
import {
    ClientError,
    protocolVersion,
    type CommandRequest,
    type QueryRequest,
    type LogRequest,
} from './types.js';

export function invalid(message: string): never {
    throw new ClientError({ code: 'INVALID_REQUEST', message });
}
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalid('Expected an object.');
    return value as Record<string, unknown>;
}
export function string(value: unknown, max = 4096): string {
    if (
        typeof value !== 'string' ||
        !value.length ||
        value.length > max ||
        value.includes('\0')
    )
        invalid('Invalid text field.');
    return value;
}
function bool(value: unknown) {
    if (typeof value !== 'boolean') invalid('Expected a boolean.');
}
function action(value: unknown) {
    if (!['start', 'stop', 'restart'].includes(String(value)))
        invalid('Invalid container action.');
}
function fields(value: Record<string, unknown>, names: string[]) {
    if (Object.keys(value).some((k) => !names.includes(k)))
        invalid('Unknown request field.');
}
export function scope(value: unknown) {
    const s = object(value);
    fields(s, ['project', 'generation']);
    if (typeof s.project !== 'string' || s.project.length > 4096)
        invalid('Invalid project.');
    string(s.generation, 128);
}
type Args = Record<string, unknown>;
type ArgsValidator = (a: Args) => void;

function argsEmpty(a: Args) {
    fields(a, []);
}
function argsStart(a: Args) {
    fields(a, ['approveStops']);
    if (a.approveStops !== undefined) bool(a.approveStops);
}
function names(value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 500)
        invalid('Invalid names.');
    value.forEach((name) => string(name, 256));
}
function argsLegacyEdit(a: Args) {
    fields(a, ['edit', 'revision']);
    string(a.revision, 128);
    const edit = object(a.edit);
    fields(edit, ['topic', 'action', 'names', 'dependencies']);
    const actions: Record<string, string[]> = {
        services: ['enable', 'disable'],
        modules: ['enable', 'disable'],
        development: ['enable', 'disable'],
        exclusions: ['add', 'remove'],
    };
    if (!actions[String(edit.topic)]?.includes(String(edit.action)))
        invalid('Invalid legacy edit.');
    names(edit.names);
    if (edit.dependencies !== undefined) {
        bool(edit.dependencies);
        if (edit.topic !== 'exclusions')
            invalid('Dependencies apply only to exclusions.');
    }
}
function argsDiagram(a: Args) {
    fields(a, ['services']);
    if (!Array.isArray(a.services) || a.services.length > 500)
        invalid('Invalid diagram services.');
    a.services.forEach((name) => string(name, 256));
}
function argsConfirm(a: Args) {
    fields(a, ['plan']);
    string(a.plan, 200000);
}
function argsServiceAction(a: Args) {
    fields(a, ['services', 'action']);
    action(a.action);
    if (
        !Array.isArray(a.services) ||
        !a.services.length ||
        a.services.length > 500
    )
        invalid('Invalid services.');
    a.services.forEach((x) => string(x, 256));
}
function argsServiceReload(a: Args) {
    fields(a, ['service']);
    string(a.service, 256);
}
function argsContainerAction(a: Args) {
    fields(a, ['container', 'action']);
    action(a.action);
    const c = object(a.container);
    for (const k of ['id', 'name', 'image', 'state', 'status']) string(c[k]);
    if (c.incarnation !== undefined) string(c.incarnation);
    bool(c.currentProject);
    if (!Array.isArray(c.ports) || c.ports.some((p) => typeof p !== 'string'))
        invalid('Invalid ports.');
}
function argsConfigurationSave(a: Args) {
    fields(a, ['edit', 'revision']);
    string(a.revision, 128);
    const e = object(a.edit);
    fields(e, ['name', 'enabled', 'development', 'exclusions']);
    string(e.name, 256);
    bool(e.enabled);
    bool(e.development);
    const exclusions = object(e.exclusions);
    if (Object.keys(exclusions).length > 500) invalid('Too many exclusions.');
    for (const [k, v] of Object.entries(exclusions)) {
        string(k, 256);
        bool(v);
    }
}
function argsSettingsSave(a: Args) {
    fields(a, ['key', 'value', 'revision']);
    if (!(settingKeys as readonly unknown[]).includes(a.key))
        invalid('Unknown setting.');
    string(a.revision, 128);
}
function argsSshSetup(a: Args) {
    fields(a, ['keyPath', 'passphrase', 'replace']);
    string(a.keyPath);
    if (
        typeof a.passphrase !== 'string' ||
        a.passphrase.length > 16384 ||
        a.passphrase.includes('\0')
    )
        invalid('Invalid passphrase.');
    bool(a.replace);
}
function argsAuthenticationLogin(a: Args) {
    fields(a, ['action', 'automatic']);
    if (!['aws', 'registry'].includes(String(a.action)))
        invalid('Invalid login action.');
    if (a.automatic !== undefined) bool(a.automatic);
}
function argsProjectClone(a: Args) {
    fields(a, ['destination']);
    string(a.destination);
}
function argsQueryInspect(a: Args) {
    fields(a, ['id']);
    string(a.id);
}
function argsQueryDirectory(a: Args) {
    fields(a, ['directory']);
    string(a.directory);
}
function argsQueryLogs(a: Args, key: 'id' | 'service') {
    fields(a, [key, 'tail']);
    string(a[key]);
    if (
        !Number.isInteger(a.tail) ||
        Number(a.tail) < 1 ||
        Number(a.tail) > 5000
    )
        invalid('Tail must be between 1 and 5000.');
}
const queryArgValidators = new Map<string, ArgsValidator>([
    ['configuration.snapshot', argsEmpty],
    ['environment.preview', argsEmpty],
    ['dependency.diagram', argsDiagram],
    ['containers.list', argsEmpty],
    ['aws.discovery', argsEmpty],
    ['aws.refresh', argsEmpty],
    ['project.search', argsEmpty],
    ['project.defaultDestination', argsEmpty],
    ['diagnostics', argsEmpty],
    ['refresh', argsEmpty],
    ['containers.inspect', argsQueryInspect],
    ['containers.logs', (a) => argsQueryLogs(a, 'id')],
    ['services.logs', (a) => argsQueryLogs(a, 'service')],
    ['project.validate', argsQueryDirectory],
    ['project.cloneDestination', argsQueryDirectory],
]);
const commandArgValidators = new Map<string, ArgsValidator>([
    ['environment.start', argsStart],
    ['environment.apply', argsStart],
    ['environment.stop', argsEmpty],
    ['environment.cancel', argsEmpty],
    ['environment.dismiss', argsEmpty],
    ['runtime.start', argsEmpty],
    ['environment.confirm', argsConfirm],
    ['service.action', argsServiceAction],
    ['service.reload', argsServiceReload],
    ['container.action', argsContainerAction],
    ['configuration.save', argsConfigurationSave],
    ['configuration.legacyEdit', argsLegacyEdit],
    ['settings.save', argsSettingsSave],
    ['ssh.setup', argsSshSetup],
    ['authentication.login', argsAuthenticationLogin],
    ['project.clone', argsProjectClone],
]);
export function commandRequest(value: unknown): CommandRequest {
    const v = object(value);
    fields(v, [
        'protocol',
        'clientId',
        'requestId',
        'scope',
        'command',
        'args',
    ]);
    if (v.protocol !== protocolVersion)
        throw new ClientError({
            code: 'PROTOCOL_MISMATCH',
            message:
                'The frontend and daemon versions differ. Restart the daemon after current work finishes.',
        });
    string(v.clientId, 128);
    string(v.requestId, 128);
    scope(v.scope);
    const a = object(v.args);
    const validate = commandArgValidators.get(v.command as string);
    if (!validate) invalid('Unknown command.');
    validate(a);
    return v as unknown as CommandRequest;
}
export function queryRequest(value: unknown): QueryRequest {
    const v = object(value);
    fields(v, ['scope', 'query', 'args']);
    scope(v.scope);
    const a = object(v.args);
    const validate = queryArgValidators.get(v.query as string);
    if (!validate) invalid('Unknown query.');
    validate(a);
    return v as unknown as QueryRequest;
}
export function logRequest(value: unknown): LogRequest {
    const v = object(value);
    fields(v, ['scope', 'source', 'services', 'tail', 'follow']);
    scope(v.scope);
    if (!['environment', 'services'].includes(String(v.source)))
        invalid('Invalid log source.');
    if (!Array.isArray(v.services) || v.services.length > 500)
        invalid('Invalid log services.');
    v.services.forEach((name) => string(name, 256));
    bool(v.follow);
    if (
        v.tail !== 'all' &&
        (!Number.isSafeInteger(v.tail) || Number(v.tail) < 0)
    )
        invalid('Tail must be all or a nonnegative integer.');
    return v as unknown as LogRequest;
}
