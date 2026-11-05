import type { Key } from 'ink';
import type { JourneyInput } from '../../project/journeys.js';
import type { JourneyDerivation } from './journeys-tab.js';

type EditKey = Pick<Key, 'backspace' | 'delete' | 'ctrl' | 'meta'>;

/** Where a service sits in a journey being authored. */
export type JourneyMemberState = 'start' | 'lazy' | 'out';

/**
 * Authoring state for one journey. `services`, `lazy` and `excluded` are the
 * explicit lists (the only things a save writes); `states` is the derived
 * effective mode per member, closure-, label- and usage-cache-aware.
 */
export interface JourneyCreatorState {
    name: string;
    /** Member names in display order (grouped). */
    members: string[];
    services: string[];
    lazy: string[];
    excluded: string[];
    dependencies: JourneyDerivation['dependencies'];
    lazyDefault: ReadonlySet<string>;
    /** Services the usage cache demoted to lazy. */
    learned: ReadonlySet<string>;
    /** Last run's selected services that saw no traffic. */
    unusedLastRun: ReadonlySet<string>;
    states: Record<string, JourneyMemberState>;
    /** 0 selects the journey-name row; 1.. selects a member row. */
    selected: number;
}

export function journeyMemberLabel(state: JourneyMemberState): string {
    return state === 'start'
        ? 'always start'
        : state === 'lazy'
          ? 'lazy'
          : 'not included';
}

export function moveJourneyCursor(
    state: JourneyCreatorState,
    backward: boolean,
): JourneyCreatorState {
    const selected = Math.max(
        0,
        Math.min(state.members.length, state.selected + (backward ? -1 : 1)),
    );
    return { ...state, selected };
}

/** Applies a text edit to the journey name; only the name row edits. */
export function renameJourney(
    state: JourneyCreatorState,
    input: string,
    key: EditKey,
    edit: (value: string, input: string, key: EditKey) => string | undefined,
): JourneyCreatorState {
    if (state.selected !== 0) return state;
    const next = edit(state.name, input, key);
    return next === undefined ? state : { ...state, name: next };
}

/** The explicit journey content a save writes. */
export function journeyDraft(state: JourneyCreatorState): JourneyInput {
    return {
        name: state.name.trim(),
        services: [...state.services],
        lazy: [...state.lazy],
        excluded: [...state.excluded],
    };
}

/** Returns why the draft cannot be saved, or undefined when it can. */
export function journeyDraftProblem(
    state: JourneyCreatorState,
    namePattern: RegExp,
): string | undefined {
    const draft = journeyDraft(state);
    if (!draft.name) return 'Name the journey first.';
    if (!namePattern.test(draft.name)) {
        return 'Use letters, digits, dots, dashes or underscores for the name.';
    }
    if (!draft.services.length && !draft.lazy.length) {
        return 'Include at least one service.';
    }
    return undefined;
}
