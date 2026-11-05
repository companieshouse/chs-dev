import type { ActionNotice } from '../hooks/use-async-action.js';
import SelectableRow from './selectable-row.js';
import { theme } from './theme.js';
import KeyboardHints from './keyboard-hints.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { Key } from 'ink';
import { useState } from 'react';
import {
    type ServiceDefinition,
    type ServiceDetails,
    type ServiceEdit,
    type SaveService,
} from '../../domain/services.js';
import type { ServiceGroup } from '../../domain/services.js';
import {
    dependencyTree,
    serviceDependencies,
    type DependencyTreeRow,
} from '../../domain/service-dependencies.js';
import type { ContainerAction } from '../../domain/live.js';
import ServiceLogs from './service-logs.js';
import { useSpinner } from '../hooks/use-spinner.js';
import {
    useAsyncAction,
    containerActionLabel,
} from '../hooks/use-async-action.js';
import { useModalSave } from '../hooks/use-modal-save.js';
import ModalFrame from './modal-frame.js';
import { centeredStart } from '../models/modules.js';
import { useProviderSelection } from '../hooks/use-provider-selection.js';
import type { ServiceProvider } from '../../domain/providers.js';
import type { StartMode } from '../../domain/start-modes.js';
import { useServiceVersions } from '../hooks/use-service-versions.js';
import { ChoiceModal, TextInputModal } from './settings-modals.js';
import ConfirmModal from './confirm-modal.js';

export interface ServiceContainerControls {
    /** Whether a container exists, is running, and runs in Development mode. */
    container?: { active: boolean; development?: boolean };
    busy: boolean;
    action(action: ContainerAction): Promise<{ ok: boolean; message: string }>;
    /** Rebuilds a development service from source, re-running its builder. */
    reload?(): Promise<{ ok: boolean; message: string }>;
    logs(tail: number, signal: AbortSignal): Promise<string[]>;
}

type MainOption =
    | 'enabled'
    | 'mode'
    | 'startMode'
    | 'scenario'
    | 'versions'
    | 'dependencies'
    | 'save'
    | 'reload'
    | 'restart'
    | 'stop'
    | 'start'
    | 'logs'
    | 'container'
    | 'cancel';

interface ServiceModalProps {
    name: string;
    details?: ServiceDetails;
    groups: ServiceGroup[];
    allDetails: Record<string, ServiceDetails>;
    onClose: () => void;
    onContainer?: () => void;
    onApply: SaveService;
    /** Explains when saved configuration will be activated. */
    saveHint?: string;
    controls?: ServiceContainerControls;
}

interface ServiceNotice {
    text: string;
    ok: boolean;
}

interface OptionLabelView {
    name: string;
    hasDetails: boolean;
    enabled: boolean;
    provider: ServiceProvider;
    mockScenario?: string;
    startModeLabel: string;
    versionLabel: string;
    base: boolean;
    modeFixed: boolean;
    dependencyCount: number;
    busy: boolean;
    reloading: boolean;
    actionBusy?: ContainerAction;
    savingLabel: string;
    rebuildingLabel: string;
    actionLabel: string;
    changed: boolean;
}

function definitionOf(groups: ServiceGroup[], name: string) {
    return groups.find((group) => group.services.includes(name))?.definitions?.[
        name
    ];
}

function exclusionsChanged(
    exclusions: Record<string, boolean>,
    allDetails: Record<string, ServiceDetails>,
) {
    return Object.entries(exclusions).some(
        ([service, excluded]) =>
            excluded !== Boolean(allDetails[service]?.excluded),
    );
}

function containerMainOptions(
    controls?: ServiceContainerControls,
): MainOption[] {
    if (!controls?.container) return [];
    return [
        ...(controls.container.development && controls.reload
            ? (['reload'] as const)
            : []),
        'restart',
        controls.container.active ? 'stop' : 'start',
        'logs',
    ];
}

function buildMainOptions(
    onContainer?: () => void,
    controls?: ServiceContainerControls,
    mock = false,
    versions = false,
    startMode = false,
): MainOption[] {
    return [
        'enabled',
        'mode',
        ...(startMode ? (['startMode'] as const) : []),
        ...(mock ? (['scenario'] as const) : []),
        ...(versions ? (['versions'] as const) : []),
        'dependencies',
        'save',
        ...(onContainer ? (['container'] as const) : []),
        ...containerMainOptions(controls),
        'cancel',
    ];
}

function enabledLabel(view: Pick<OptionLabelView, 'hasDetails' | 'enabled'>) {
    if (!view.hasDetails) return 'Unknown';
    return view.enabled ? 'Yes' : 'No';
}

function stateOptionLabel(
    option: 'enabled' | 'mode' | 'save',
    view: OptionLabelView,
): string {
    switch (option) {
        case 'enabled':
            return `Enabled: ${enabledLabel(view)}${view.base ? ' (required)' : ''}`;
        case 'mode':
            return `Provider: ${!view.hasDetails ? 'Unknown' : view.provider}${view.modeFixed ? ' (fixed)' : ''}`;
        case 'save':
            return view.busy
                ? view.savingLabel
                : `Save${!view.changed ? ' (no changes)' : ''}`;
    }
}

function containerOptionLabel(
    option: 'restart' | 'stop' | 'start',
    view: OptionLabelView,
): string {
    switch (option) {
        case 'restart':
            return view.actionBusy === 'restart'
                ? view.actionLabel
                : 'Restart container';
        case 'stop':
            return view.actionBusy === 'stop'
                ? view.actionLabel
                : 'Stop container';
        case 'start':
            return view.actionBusy === 'start'
                ? view.actionLabel
                : 'Start container';
    }
}

function mainOptionLabel(option: MainOption, view: OptionLabelView): string {
    const labels: Record<MainOption, string> = {
        enabled: stateOptionLabel('enabled', view),
        mode: stateOptionLabel('mode', view),
        startMode: `Start mode: ${view.startModeLabel} (cycle)`,
        scenario: `Mock scenario: ${view.mockScenario ?? 'Unknown'} (cycle)`,
        versions: view.versionLabel,
        save: stateOptionLabel('save', view),
        restart: containerOptionLabel('restart', view),
        stop: containerOptionLabel('stop', view),
        start: containerOptionLabel('start', view),
        dependencies: `Dependencies (${view.dependencyCount}) →`,
        reload: view.reloading
            ? view.rebuildingLabel
            : 'Reload (rebuild from source)',
        container: 'View container details →',
        logs: 'Show container logs',
        cancel: 'Close',
    };
    return labels[option];
}

function dependencyOptionLabel(
    dependency: DependencyTreeRow,
    exclusions: Record<string, boolean>,
    allDetails: Record<string, ServiceDetails>,
) {
    const excluded =
        exclusions[dependency.name] ??
        Boolean(allDetails[dependency.name]?.excluded);
    const mark =
        dependency.reference === 'cycle'
            ? '[Cycle]'
            : excluded
              ? '[Excluded]'
              : '[Allowed]';
    const required = dependency.required ? ' (required)' : '';
    const shared = dependency.reference === 'shared' ? ' (shared)' : '';
    return `${dependency.prefix}${mark} ${dependency.name}${required}${shared}`;
}

function dependencyOptionLabels(
    tree: DependencyTreeRow[],
    exclusions: Record<string, boolean>,
    allDetails: Record<string, ServiceDetails>,
) {
    return [
        ...tree.map((dependency) =>
            dependencyOptionLabel(dependency, exclusions, allDetails),
        ),
        'Back',
    ];
}

function effectiveExclusions(
    exclusions: Record<string, boolean>,
    allDetails: Record<string, ServiceDetails>,
) {
    return Object.fromEntries(
        Object.entries(exclusions).filter(
            ([name, excluded]) =>
                excluded !== Boolean(allDetails[name]?.excluded),
        ),
    );
}

/** Start-mode override state: cycles Default → Lazy → Always. */
function useStartModeSelection(
    details: ServiceModalProps['details'],
    definition: ServiceDefinition | undefined,
    provider: ServiceProvider,
) {
    const [startMode, setStartMode] = useState<StartMode | undefined>(
        details?.startModeOverride,
    );
    const cycle = () => {
        const allowLazy = !definition?.base && provider !== 'development';
        setStartMode((current) => {
            if (current === undefined) return allowLazy ? 'lazy' : 'always';
            if (current === 'lazy') return 'always';
            return undefined;
        });
    };
    const label = startMode
        ? `${startMode} (override)`
        : details?.effectiveStartMode
          ? `default → ${details.effectiveStartMode} (${details.startModeSource ?? 'default'})`
          : `default (${details?.startModeLabel ?? 'always'})`;
    return {
        startMode,
        changed: startMode !== details?.startModeOverride,
        label,
        cycle,
    };
}

function useServiceConfiguration(props: ServiceModalProps) {
    const [enabled, setEnabled] = useState(props.details?.enabled === 'Yes');
    const [exclusions, setExclusions] = useState<Record<string, boolean>>({});
    const definition = definitionOf(props.groups, props.name);
    const selection = useProviderSelection(props.details, definition);
    const startModeSelection = useStartModeSelection(
        props.details,
        definition,
        selection.provider,
    );
    const versions = useServiceVersions(props.details, definition?.image);
    const editable = Boolean(
        props.details &&
        props.details.enabled !== 'Unknown' &&
        definition &&
        !definition.deprecated,
    );
    const changed = [
        enabled !== (props.details?.enabled === 'Yes'),
        selection.changed,
        versions.changed,
        startModeSelection.changed,
        exclusionsChanged(exclusions, props.allDetails),
    ].some(Boolean);
    const toggle = (option: MainOption) => {
        if (!editable) return;
        if (option === 'enabled' && !definition?.base)
            setEnabled((value) => !value);
        if (option === 'mode') selection.cycleProvider();
        if (option === 'startMode') startModeSelection.cycle();
        if (option === 'versions') versions.open();
        if (option === 'scenario' && selection.provider === 'mock')
            selection.cycleScenario();
    };
    const toggleDependency = (dependency: DependencyTreeRow) => {
        if (
            !editable ||
            dependency.required ||
            dependency.reference === 'cycle'
        )
            return;
        setExclusions((current) => ({
            ...current,
            [dependency.name]: !(
                current[dependency.name] ??
                Boolean(props.allDetails[dependency.name]?.excluded)
            ),
        }));
    };
    return {
        enabled,
        provider: selection.provider,
        startMode: startModeSelection.startMode,
        startModeLabel: startModeSelection.label,
        scenario: selection.scenario,
        scenarioDescription: selection.description,
        modeFixed: selection.fixed,
        exclusions,
        definition,
        editable,
        changed,
        versionLabel: versions.label,
        versionEditor: versions,
        toggle,
        toggleDependency,
        save: () =>
            props.onApply({
                name: props.name,
                enabled,
                development: selection.provider === 'development',
                provider: selection.provider,
                ...(selection.provider === 'mock'
                    ? { mockScenario: selection.scenario }
                    : {}),
                exclusions: effectiveExclusions(exclusions, props.allDetails),
                startMode: startModeSelection.startMode ?? null,
                ...versions.edit(),
            }),
    };
}

function useServiceNavigation(dependencyIndex: number) {
    const [selected, setSelected] = useState(0);
    const [dependencyView, setDependencyView] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    return {
        selected,
        dependencyView,
        logsOpen,
        move: (backward: boolean, count: number) =>
            setSelected(
                (value) => (value + (backward ? count - 1 : 1)) % count,
            ),
        dependencies: () => {
            setDependencyView(true);
            setSelected(0);
        },
        back: () => {
            setDependencyView(false);
            setSelected(dependencyIndex);
        },
        showLogs: () => setLogsOpen(true),
        closeLogs: () => setLogsOpen(false),
    };
}

function serviceKeyKind(input: string, key: Key) {
    if (key.escape || input === 'q') return 'escape';
    if (key.upArrow || key.downArrow || key.tab) return 'move';
    if (key.return || input === ' ') return 'activate';
    if (key.leftArrow || key.rightArrow) return 'cycle';
    return undefined;
}

function serviceActions({
    props,
    configuration,
    navigation,
    operations,
    setDiscardOpen,
}: {
    props: ServiceModalProps;
    configuration: ReturnType<typeof useServiceConfiguration>;
    navigation: ReturnType<typeof useServiceNavigation>;
    operations: ReturnType<typeof useServiceOperations>;
    setDiscardOpen(value: boolean): void;
}): Partial<Record<MainOption, () => void>> {
    return {
        enabled: () => configuration.toggle('enabled'),
        mode: () => configuration.toggle('mode'),
        startMode: () => configuration.toggle('startMode'),
        scenario: () => configuration.toggle('scenario'),
        versions: () => configuration.toggle('versions'),
        dependencies: navigation.dependencies,
        save: () => {
            if (configuration.editable && configuration.changed)
                void operations.save();
        },
        reload: operations.reload,
        restart: () => void operations.containerAction('restart'),
        stop: () => void operations.containerAction('stop'),
        start: () => void operations.containerAction('start'),
        logs: navigation.showLogs,
        container: props.onContainer,
        cancel: () => {
            if (configuration.changed) setDiscardOpen(true);
            else props.onClose();
        },
    };
}

function activateServiceSelection({
    navigation,
    mainOptions,
    actions,
    configuration,
    tree,
    setConfirmation,
}: {
    navigation: ReturnType<typeof useServiceNavigation>;
    mainOptions: MainOption[];
    actions: Partial<Record<MainOption, () => void>>;
    configuration: ReturnType<typeof useServiceConfiguration>;
    tree: DependencyTreeRow[];
    setConfirmation(value: ContainerAction): void;
}) {
    if (!navigation.dependencyView) {
        const option = mainOptions[navigation.selected];
        if (option === 'restart' || option === 'stop') {
            setConfirmation(option);
            return;
        }
        actions[option!]?.();
        return;
    }
    const dependency = tree[navigation.selected];
    if (dependency) configuration.toggleDependency(dependency);
    else navigation.back();
}

function useModalKeyboard({
    navigation,
    inputBusy,
    optionCount,
    activate,
    onClose,
    cycle,
}: {
    navigation: ReturnType<typeof useServiceNavigation>;
    inputBusy: boolean;
    optionCount: number;
    activate(): void;
    onClose(): void;
    cycle(): void;
}) {
    useServiceKeyboard(navigation, {
        inputBusy,
        optionCount,
        activate,
        onClose,
        cycle,
    });
}

function serviceInputBusy(
    configuration: ReturnType<typeof useServiceConfiguration>,
    operations: ReturnType<typeof useServiceOperations>,
    confirmation: ContainerAction | undefined,
    discardOpen: boolean,
) {
    return (
        operations.busy ||
        Boolean(operations.actionBusy) ||
        operations.reloading ||
        configuration.versionEditor.pickerOpen ||
        configuration.versionEditor.inputOpen ||
        Boolean(confirmation) ||
        discardOpen
    );
}

function useServiceModal(props: ServiceModalProps) {
    const configuration = useServiceConfiguration(props);
    const mainOptions = configurationOptions(props, configuration);
    const navigation = useServiceNavigation(
        mainOptions.indexOf('dependencies'),
    );
    const operations = useServiceOperations(props, configuration.save);
    const [confirmation, setConfirmation] = useState<ContainerAction>();
    const [discardOpen, setDiscardOpen] = useState(false);
    const tree = dependencyTree(props.name, props.groups);
    const actions = serviceActions({
        props,
        configuration,
        navigation,
        operations,
        setDiscardOpen,
    });
    const requestClose = () => {
        if (configuration.changed) setDiscardOpen(true);
        else props.onClose();
    };
    const activate = () =>
        activateServiceSelection({
            navigation,
            mainOptions,
            actions,
            configuration,
            tree,
            setConfirmation,
        });
    const optionCount = navigation.dependencyView
        ? tree.length + 1
        : mainOptions.length;

    useModalKeyboard({
        navigation,
        inputBusy: serviceInputBusy(
            configuration,
            operations,
            confirmation,
            discardOpen,
        ),
        optionCount,
        activate,
        onClose: requestClose,
        cycle: () => {
            const option = mainOptions[navigation.selected];
            if (
                option === 'enabled' ||
                option === 'mode' ||
                option === 'startMode' ||
                option === 'scenario'
            )
                configuration.toggle(option);
            if (option === 'versions') configuration.toggle(option);
        },
    });
    const view = useServicePresentation(
        props,
        configuration,
        navigation,
        operations,
        tree,
    );
    return {
        view,
        versionEditor: configuration.versionEditor,
        logsOpen: navigation.logsOpen,
        closeLogs: navigation.closeLogs,
        confirmation,
        confirm: () => {
            if (!confirmation) return;
            void operations.containerAction(confirmation);
            setConfirmation(undefined);
        },
        cancelConfirmation: () => setConfirmation(undefined),
        discardOpen,
        discard: props.onClose,
        cancelDiscard: () => setDiscardOpen(false),
    };
}

function useServiceKeyboard(
    navigation: ReturnType<typeof useServiceNavigation>,
    options: {
        inputBusy: boolean;
        optionCount: number;
        activate(): void;
        onClose(): void;
        cycle(): void;
    },
) {
    useInput(
        (input, key) => {
            if (options.inputBusy) return;
            switch (serviceKeyKind(input, key)) {
                case 'escape':
                    return navigation.dependencyView
                        ? navigation.back()
                        : options.onClose();
                case 'move':
                    return navigation.move(
                        key.upArrow || (key.tab && key.shift),
                        options.optionCount,
                    );
                case 'activate':
                    return options.activate();
                case 'cycle':
                    return options.cycle();
            }
        },
        {
            isActive: !navigation.logsOpen,
        },
    );
}

function useServiceOperations(
    props: ServiceModalProps,
    persist: () => Promise<void>,
) {
    const save = useModalSave(persist, props.onClose);
    const [notice, setNotice] = useState<ActionNotice>();
    const container = useAsyncAction<ContainerAction>(setNotice);
    const reload = useAsyncAction<'reload'>(setNotice);
    const containerAction = (action: ContainerAction) =>
        container.run(action, async () => {
            if (!props.controls || props.controls.busy)
                return {
                    ok: false,
                    message: 'The environment is busy; try again shortly.',
                };
            return props.controls.action(action);
        });
    return {
        busy: save.busy,
        error: save.error,
        save: save.submit,
        actionBusy: container.busy,
        reloading: Boolean(reload.busy),
        notice,
        containerAction,
        reload: () => {
            if (props.controls?.reload)
                void reload.run('reload', props.controls.reload, {
                    ok: true,
                    message:
                        'Rebuilding from source; follow progress in Ctrl+E.',
                });
        },
    };
}

function serviceLabelView(
    props: ServiceModalProps,
    configuration: ReturnType<typeof useServiceConfiguration>,
    operations: ReturnType<typeof useServiceOperations>,
    spinner: string,
): OptionLabelView {
    return {
        name: props.name,
        hasDetails: Boolean(props.details),
        enabled: configuration.enabled,
        provider: configuration.provider,
        mockScenario: configuration.scenario,
        startModeLabel: configuration.startModeLabel,
        versionLabel: configuration.versionLabel,
        base: Boolean(configuration.definition?.base),
        modeFixed: configuration.modeFixed,
        dependencyCount: serviceDependencies(props.name, props.groups).length,
        busy: operations.busy,
        reloading: operations.reloading,
        actionBusy: operations.actionBusy,
        savingLabel: `${spinner} Saving`,
        rebuildingLabel: `${spinner} Rebuilding`,
        actionLabel: `${spinner} ${operations.actionBusy ? containerActionLabel[operations.actionBusy] : ''}`,
        changed: configuration.changed,
    };
}

function useServicePresentation(
    props: ServiceModalProps,
    configuration: ReturnType<typeof useServiceConfiguration>,
    navigation: ReturnType<typeof useServiceNavigation>,
    operations: ReturnType<typeof useServiceOperations>,
    tree: DependencyTreeRow[],
) {
    const spinner = useSpinner(
        operations.busy ||
            operations.reloading ||
            Boolean(operations.actionBusy),
    );
    const labels = navigation.dependencyView
        ? dependencyOptionLabels(
              tree,
              configuration.exclusions,
              props.allDetails,
          )
        : configurationOptions(props, configuration).map((option) =>
              mainOptionLabel(
                  option,
                  serviceLabelView(props, configuration, operations, spinner),
              ),
          );
    return {
        name: props.name,
        labels,
        selected: navigation.selected,
        dependencyView: navigation.dependencyView,
        changed: configuration.changed,
        mockHint:
            configuration.provider === 'mock'
                ? `Mock: ${configuration.scenarioDescription ?? ''} Dependencies are not started for this service.`
                : undefined,
        footer: {
            dependencyCount: serviceDependencies(props.name, props.groups)
                .length,
            editable: configuration.editable,
            error: operations.error,
            notice: operations.notice && {
                text: operations.notice.message,
                ok: operations.notice.ok,
            },
            saveHint:
                props.saveHint ??
                'Saves configuration only; containers are unchanged.',
        },
    };
}

function configurationOptions(
    props: ServiceModalProps,
    configuration: ReturnType<typeof useServiceConfiguration>,
) {
    return buildMainOptions(
        props.onContainer,
        props.controls,
        configuration.provider === 'mock',
        configuration.provider === 'service' &&
            Boolean(props.details?.versionSource || props.details?.imagePinned),
        Boolean(configuration.definition && !configuration.definition.base),
    );
}

function ModalStatus({
    error,
    notice,
}: {
    error: string;
    notice?: ServiceNotice;
}) {
    return (
        <>
            {error && <Text color={theme.error}>{error}</Text>}
            {notice && (
                <Text color={notice.ok ? theme.healthy : theme.error}>
                    {notice.text}
                </Text>
            )}
        </>
    );
}

function ModalOptions({
    options,
    selected,
    capacity,
}: {
    options: string[];
    selected: number;
    capacity: number;
}) {
    const start = centeredStart(selected, capacity, options.length);

    return (
        <Box flexDirection="column" marginY={1}>
            {options.slice(start, start + capacity).map((option, index) => (
                <SelectableRow
                    key={index}
                    selected={selected === start + index}
                >
                    {option}
                </SelectableRow>
            ))}
        </Box>
    );
}

function ServiceModalView(props: ReturnType<typeof useServicePresentation>) {
    const { rows } = useWindowSize();
    const { labels: options, footer } = props;
    const capacity = Math.max(1, rows - 14);
    const dependencyHint = footer.dependencyCount
        ? 'Exclusions apply project-wide, including shared dependencies.'
        : 'This service has no dependencies.';

    return (
        <ModalFrame title={props.name} width={props.dependencyView ? 100 : 64}>
            <Box flexDirection="column">
                <Text color={theme.muted}>
                    {props.dependencyView
                        ? 'Dependencies'
                        : 'Service configuration'}
                    {props.changed ? ' · unsaved changes' : ''}
                </Text>
                <ModalOptions
                    options={options}
                    selected={props.selected}
                    capacity={capacity}
                />
                {props.dependencyView && (
                    <Text color={theme.muted}>{dependencyHint}</Text>
                )}
                {!footer.editable && (
                    <Text color={theme.development}>
                        Configuration is unavailable for this service.
                    </Text>
                )}
                <ModalStatus error={footer.error} notice={footer.notice} />
                {!props.dependencyView && props.mockHint && (
                    <Text color={theme.mocked}>{props.mockHint}</Text>
                )}
                <Text color={theme.muted}>{footer.saveHint}</Text>
                <KeyboardHints>
                    {props.dependencyView
                        ? '↑ ↓ choose · Space toggle · Esc back'
                        : '↑ ↓ choose · Enter select · Esc cancel'}
                </KeyboardHints>
            </Box>
        </ModalFrame>
    );
}

export default function ServiceModal(props: ServiceModalProps) {
    const state = useServiceModal(props);
    if (state.confirmation)
        return (
            <ConfirmModal
                title={`${state.confirmation[0].toUpperCase()}${state.confirmation.slice(1)} container`}
                message={`Really ${state.confirmation} this container?`}
                confirmLabel={
                    state.confirmation === 'stop'
                        ? 'Stop container'
                        : 'Restart container'
                }
                onConfirm={state.confirm}
                onCancel={state.cancelConfirmation}
            />
        );
    if (state.discardOpen)
        return (
            <ConfirmModal
                title="Discard unsaved changes?"
                message="Your service changes have not been saved."
                confirmLabel="Discard changes"
                onConfirm={state.discard}
                onCancel={state.cancelDiscard}
            />
        );
    if (state.versionEditor.inputOpen)
        return (
            <TextInputModal
                title="Specific service version"
                label="Version"
                validate={async () => undefined}
                detail="Enter a tag, SHA256 digest or full image reference."
                initial={state.versionEditor.pinned}
                onSave={state.versionEditor.saveInput}
                onClose={state.versionEditor.closeInput}
            />
        );
    if (state.versionEditor.pickerOpen)
        return (
            <ChoiceModal
                title="Service version source"
                choices={state.versionEditor.choices}
                current={state.versionEditor.selection}
                onChoose={state.versionEditor.choose}
                onClose={state.versionEditor.closePicker}
            />
        );
    if (state.logsOpen && props.controls)
        return (
            <ServiceLogs
                name={props.name}
                load={props.controls.logs}
                onClose={state.closeLogs}
            />
        );
    return <ServiceModalView {...state.view} />;
}
