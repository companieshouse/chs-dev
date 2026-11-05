import type {
    JourneyCreatorState,
    JourneyMemberState,
} from './journey-creator.js';

/** One row of the Journeys tab list. */
export interface JourneyListRow {
    name: string;
    active: boolean;
    /** Parse failure for an invalid journeys/*.yaml file; read-only row. */
    invalid?: string;
    services: string[];
    lazy: string[];
    excluded: string[];
    /** Derived (closure- and label-aware) member counts for the row. */
    derived?: { start: number; lazy: number };
}

export interface JourneyListInput {
    journeys: Array<{
        name: string;
        services: string[];
        lazy: string[];
        excluded?: string[];
    }>;
    invalid: Array<{ file: string; error: string }>;
    active?: string;
}

/** Compose knowledge needed to derive a journey's effective membership. */
export interface JourneyDerivation {
    dependencies: Readonly<Record<string, readonly string[]>>;
    /** Services labelled `chs.start-mode: lazy`. */
    lazyDefault: ReadonlySet<string>;
    /** Services the usage cache demoted to lazy. */
    learned?: ReadonlySet<string>;
}

/** Valid journeys first (sorted), then invalid files (sorted). */
export function journeyListRows(
    input: JourneyListInput,
    derivation?: JourneyDerivation,
): JourneyListRow[] {
    const valid = input.journeys
        .map((journey) => ({
            name: journey.name,
            active: journey.name === input.active,
            services: journey.services,
            lazy: journey.lazy,
            excluded: journey.excluded ?? [],
            ...(derivation
                ? {
                      derived: derivedCounts(
                          journey.services,
                          journey.lazy,
                          journey.excluded ?? [],
                          derivation,
                      ),
                  }
                : {}),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const invalid = input.invalid
        .map(({ file, error }) => {
            const name = /^journeys\/(.*)\.yaml$/.exec(file)?.[1] ?? file;
            return {
                name,
                active: false,
                invalid: error,
                services: [] as string[],
                lazy: [] as string[],
                excluded: [] as string[],
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    return [...valid, ...invalid];
}

function derivedCounts(
    services: readonly string[],
    lazy: readonly string[],
    excluded: readonly string[],
    derivation: JourneyDerivation,
): { start: number; lazy: number } {
    const sets = deriveJourneySets({
        services,
        lazy,
        excluded,
        ...derivation,
    });
    return { start: sets.started.length, lazy: sets.lazy.length };
}

export interface JourneyEditorInput {
    name: string;
    /** Known service names offered for inclusion. */
    members: readonly string[];
    initial?: {
        services?: readonly string[];
        lazy?: readonly string[];
        excluded?: readonly string[];
    };
    dependencies: Readonly<Record<string, readonly string[]>>;
    lazyDefault?: ReadonlySet<string>;
    /** Services the usage cache demoted to lazy. */
    learned?: ReadonlySet<string>;
    /** Last run's selected services that saw no traffic. */
    unusedLastRun?: ReadonlySet<string>;
    /** True for a brand-new journey: the name row is selected. */
    isNew?: boolean;
    /** Cursor row to preserve across list edits. */
    selected?: number;
}

const sortedUnique = (names: readonly string[]): string[] =>
    [...new Set(names)].sort((a, b) => a.localeCompare(b));

/**
 * Full unpruned dependency closure of the roots (group placement only);
 * the effective closure below prunes excluded subtrees like apply does.
 */
function reachableClosure(
    roots: ReadonlySet<string>,
    dependencies: Readonly<Record<string, readonly string[]>>,
): Set<string> {
    const closure = new Set<string>();
    const pending = [...roots];
    while (pending.length) {
        for (const dependency of dependencies[pending.pop()!] ?? []) {
            if (roots.has(dependency) || closure.has(dependency)) continue;
            closure.add(dependency);
            pending.push(dependency);
        }
    }
    return closure;
}

/** Dependencies pulled in by the roots, pruning excluded subtrees. */
function effectiveClosure(
    roots: ReadonlySet<string>,
    excluded: ReadonlySet<string>,
    dependencies: Readonly<Record<string, readonly string[]>>,
): Set<string> {
    const closure = new Set<string>();
    const pending = [...roots];
    while (pending.length) {
        for (const dependency of dependencies[pending.pop()!] ?? []) {
            if (
                excluded.has(dependency) ||
                roots.has(dependency) ||
                closure.has(dependency)
            )
                continue;
            closure.add(dependency);
            pending.push(dependency);
        }
    }
    return closure;
}

/**
 * Inheritance: a closure member whose every direct parent in the closure
 * is lazy defers with it, matching the resolver's rule.
 */
function inheritLazyMembers(
    closure: ReadonlySet<string>,
    members: ReadonlySet<string>,
    dependencies: Readonly<Record<string, readonly string[]>>,
    lazySet: Set<string>,
): void {
    const parentsOf = (name: string) =>
        [...members].filter((parent) =>
            (dependencies[parent] ?? []).includes(name),
        );
    const inherits = (name: string) => {
        const parents = parentsOf(name);
        return (
            parents.length > 0 && parents.every((parent) => lazySet.has(parent))
        );
    };
    let changed = true;
    while (changed) {
        changed = false;
        for (const name of closure) {
            if (lazySet.has(name) || !inherits(name)) continue;
            lazySet.add(name);
            changed = true;
        }
    }
}

/** The effective start and lazy sets a journey resolves to. */
export function deriveJourneySets(derivation: {
    services: readonly string[];
    lazy: readonly string[];
    excluded: readonly string[];
    dependencies: Readonly<Record<string, readonly string[]>>;
    lazyDefault?: ReadonlySet<string>;
    learned?: ReadonlySet<string>;
}): { started: string[]; lazy: string[] } {
    const roots = new Set([...derivation.services, ...derivation.lazy]);
    const closure = effectiveClosure(
        roots,
        new Set(derivation.excluded),
        derivation.dependencies,
    );
    const labels = derivation.lazyDefault ?? new Set<string>();
    const learned = derivation.learned ?? new Set<string>();
    const started = [...derivation.services];
    const lazy = [...derivation.lazy];
    for (const name of closure)
        if (labels.has(name) || learned.has(name)) lazy.push(name);
    const lazySet = new Set(lazy);
    const members = new Set([...roots, ...closure]);
    inheritLazyMembers(closure, members, derivation.dependencies, lazySet);
    lazy.push(...[...lazySet].filter((name) => !lazy.includes(name)));
    for (const name of closure) if (!lazySet.has(name)) started.push(name);
    return {
        started: sortedUnique(started),
        lazy: sortedUnique(lazy),
    };
}

function journeyStates(
    universe: readonly string[],
    lists: {
        services: ReadonlySet<string>;
        lazy: ReadonlySet<string>;
        closure: ReadonlySet<string>;
        labels: ReadonlySet<string>;
        learned: ReadonlySet<string>;
        dependencies: Readonly<Record<string, readonly string[]>>;
        excluded: ReadonlySet<string>;
    },
): Record<string, JourneyMemberState> {
    const effective = deriveJourneySets({
        services: [...lists.services],
        lazy: [...lists.lazy],
        excluded: [...lists.excluded],
        dependencies: lists.dependencies,
        lazyDefault: lists.labels,
        learned: lists.learned,
    });
    const effectiveLazy = new Set(effective.lazy);
    const states: Record<string, JourneyMemberState> = {};
    for (const member of universe) {
        states[member] = lists.services.has(member)
            ? 'start'
            : effectiveLazy.has(member)
              ? 'lazy'
              : lists.closure.has(member)
                ? 'start'
                : 'out';
    }
    return states;
}

/**
 * Editor state over a journey's effective membership: explicit roots and
 * exclusions from the file, everything the closure pulls in derived from
 * the compose dependencies and `chs.start-mode` labels. Members are kept
 * in display order (grouped), so the selection index addresses the exact
 * order the editor renders.
 */
export function journeyEditorState(
    input: JourneyEditorInput,
): JourneyCreatorState {
    const initial = input.initial ?? {};
    const services = new Set(initial.services ?? []);
    const lazy = new Set(initial.lazy ?? []);
    const excluded = new Set(initial.excluded ?? []);
    const labels = input.lazyDefault ?? new Set<string>();
    const learned = input.learned ?? new Set<string>();
    const roots = new Set([...services, ...lazy]);
    const closure = effectiveClosure(roots, excluded, input.dependencies);
    const universe = sortedUnique([
        ...input.members,
        ...services,
        ...lazy,
        ...excluded,
    ]);
    const states = journeyStates(universe, {
        services,
        lazy,
        closure,
        labels,
        learned,
        dependencies: input.dependencies,
        excluded,
    });
    const grouping = journeyGrouping({
        services: [...services],
        lazy: [...lazy],
        excluded: [...excluded],
        dependencies: input.dependencies,
    });
    const members = journeyGroups(universe, grouping).flatMap(
        (group) => group.members,
    );
    return {
        name: input.name,
        members,
        services: sortedUnique([...services]),
        lazy: sortedUnique([...lazy]),
        excluded: sortedUnique([...excluded]),
        dependencies: input.dependencies,
        lazyDefault: labels,
        learned,
        unusedLastRun: input.unusedLastRun ?? new Set<string>(),
        states,
        selected: input.selected ?? (input.isNew ? 0 : 1),
    };
}

/** Re-derives the editor state after the explicit lists change. */
function withJourneyLists(
    state: JourneyCreatorState,
    lists: {
        services: readonly string[];
        lazy: readonly string[];
        excluded: readonly string[];
    },
): JourneyCreatorState {
    return journeyEditorState({
        name: state.name,
        members: state.members,
        initial: lists,
        dependencies: state.dependencies,
        lazyDefault: state.lazyDefault,
        learned: state.learned,
        unusedLastRun: state.unusedLastRun,
        selected: state.selected,
    });
}

/** Maps an explicit member choice onto the three journey lists. */
export function applyMemberState(
    state: JourneyCreatorState,
    member: string,
    mode: JourneyMemberState,
): JourneyCreatorState {
    const without = (list: readonly string[]) =>
        list.filter((name) => name !== member);
    if (mode === 'start')
        return withJourneyLists(state, {
            services: sortedUnique([...state.services, member]),
            lazy: without(state.lazy),
            excluded: without(state.excluded),
        });
    if (mode === 'lazy')
        return withJourneyLists(state, {
            services: without(state.services),
            lazy: sortedUnique([...state.lazy, member]),
            excluded: without(state.excluded),
        });
    return withJourneyLists(state, {
        services: without(state.services),
        lazy: without(state.lazy),
        excluded: sortedUnique([...state.excluded, member]),
    });
}

export interface JourneyGrouping {
    enabled: ReadonlySet<string>;
    /** Would-be dependencies of the enabled set (excluded ones included). */
    closure: ReadonlySet<string>;
}

export interface JourneyGroup {
    label: string;
    members: string[];
}

/** Display grouping for a journey state: roots, would-be closure, other. */
export function journeyGrouping(state: {
    services: readonly string[];
    lazy: readonly string[];
    excluded: readonly string[];
    dependencies: Readonly<Record<string, readonly string[]>>;
}): JourneyGrouping {
    const services = new Set(state.services);
    // What the always-start roots pull in decides placement: dependencies
    // stay in the dependency group even when their mode is lazy; only lazy
    // roots nothing depends on sit with the enabled selections.
    const pulled = reachableClosure(services, state.dependencies);
    const enabled = new Set([
        ...state.services,
        ...state.lazy.filter((name) => !pulled.has(name)),
    ]);
    return { enabled, closure: pulled };
}

const groupOrder = ['Enabled', 'Dependencies of enabled', 'Other'] as const;

/**
 * Groups the editor's members for display: included roots, the closure the
 * roots pull in (excluded dependencies keep their place here), then
 * everything else. Sorted within groups; empty groups are omitted.
 */
export function journeyGroups(
    members: readonly string[],
    grouping: JourneyGrouping,
): JourneyGroup[] {
    const groups: JourneyGroup[] = groupOrder.map((label) => ({
        label,
        members: [],
    }));
    for (const member of [...members].sort((a, b) => a.localeCompare(b))) {
        if (grouping.enabled.has(member)) groups[0]!.members.push(member);
        else if (grouping.closure.has(member)) groups[1]!.members.push(member);
        else groups[2]!.members.push(member);
    }
    return groups.filter((group) => group.members.length > 0);
}

/** Members in display order: grouped, filtered by a search substring. */
export function visibleMembers(
    members: readonly string[],
    grouping: JourneyGrouping,
    query: string,
): string[] {
    const groups = journeyGroups(members, grouping);
    const needle = query.toLocaleLowerCase();
    const rows: string[] = [];
    for (const group of groups)
        for (const member of group.members)
            if (!needle || member.toLocaleLowerCase().includes(needle))
                rows.push(member);
    return rows;
}

/** Group label for one member, for header placement during rendering. */
export function journeyGroupLabel(
    member: string,
    grouping: JourneyGrouping,
): string {
    if (grouping.enabled.has(member)) return 'Enabled';
    if (grouping.closure.has(member)) return 'Dependencies of enabled';
    return 'Other';
}

/** Derived display inputs for the editor rows: grouping and suffix sets. */
export interface JourneyEditorView {
    grouping: JourneyGrouping;
    excluded: ReadonlySet<string>;
    /** Members included by the closure (excluded pruning applied). */
    dependencyMembers: ReadonlySet<string>;
    /** Members whose lazy mode comes from the compose label. */
    lazyByDefault: ReadonlySet<string>;
    /** Derived members whose lazy mode comes from the usage cache. */
    learnedLazy: ReadonlySet<string>;
    /** Explicitly selected services that saw no traffic last run. */
    unusedPinned: ReadonlySet<string>;
}

export function journeyEditorView(
    state: JourneyCreatorState,
): JourneyEditorView {
    const services = new Set(state.services);
    const lazy = new Set(state.lazy);
    const excluded = new Set(state.excluded);
    const roots = new Set([...services, ...lazy]);
    const closure = effectiveClosure(roots, excluded, state.dependencies);
    const lazyByDefault = new Set(
        [...closure].filter((name) => state.lazyDefault.has(name)),
    );
    const learnedLazy = new Set(
        [...closure].filter(
            (name) => state.learned.has(name) && !state.lazyDefault.has(name),
        ),
    );
    const unusedPinned = new Set(
        state.services.filter((name) => state.unusedLastRun.has(name)),
    );
    return {
        grouping: journeyGrouping(state),
        excluded,
        dependencyMembers: closure,
        lazyByDefault,
        learnedLazy,
        unusedPinned,
    };
}

/**
 * True when the draft differs from the editor's opening state: the journey
 * name or any of the three explicit lists changed.
 */
export function journeyDirty(
    state: JourneyCreatorState,
    initial: JourneyCreatorState,
): boolean {
    if (state.name !== initial.name) return true;
    const lists: Array<[readonly string[], readonly string[]]> = [
        [state.services, initial.services],
        [state.lazy, initial.lazy],
        [state.excluded, initial.excluded],
    ];
    return lists.some(
        ([before, after]) =>
            before.length !== after.length ||
            [...before].sort().join() !== [...after].sort().join(),
    );
}
