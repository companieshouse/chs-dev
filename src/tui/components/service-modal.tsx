import type { ActionNotice } from '../hooks/use-async-action.js';
import SelectableRow from './selectable-row.js';
import { theme } from './theme.js';
import KeyboardHints from './keyboard-hints.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { Key } from 'ink';
import { useState } from 'react';
import {
    serviceMode,
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
    /** Saving also applies the change to the running environment. */
    applyOnSave?: boolean;
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
    development: boolean;
    base: boolean;
    modeFixed: boolean;
    dependencyCount: number;
    busy: boolean;
    applyOnSave: boolean;
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
): MainOption[] {
    return [
        'enabled',
        'mode',
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
            return `Mode: ${!view.hasDetails ? 'Unknown' : serviceMode(view.name, view.development)}${view.modeFixed ? ' (fixed)' : ''}`;
        case 'save':
            return view.busy
                ? view.savingLabel
                : `${view.applyOnSave ? 'Save & apply' : 'Save'}${!view.changed ? ' (no changes)' : ''}`;
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

function useServiceConfiguration(props: ServiceModalProps) {
    const [enabled, setEnabled] = useState(props.details?.enabled === 'Yes');
    const [development, setDevelopment] = useState(
        props.details?.mode === 'Development',
    );
    const [exclusions, setExclusions] = useState<Record<string, boolean>>({});
    const definition = definitionOf(props.groups, props.name);
    const editable = Boolean(
        props.details &&
        props.details.enabled !== 'Unknown' &&
        definition &&
        !definition.deprecated,
    );
    const changed =
        enabled !== (props.details?.enabled === 'Yes') ||
        development !== (props.details?.mode === 'Development') ||
        exclusionsChanged(exclusions, props.allDetails);
    const toggle = (option: MainOption) => {
        if (!editable) return;
        if (option === 'enabled' && !definition?.base)
            setEnabled((value) => !value);
        if (option === 'mode' && definition?.development)
            setDevelopment((value) => !value);
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
        development,
        exclusions,
        definition,
        editable,
        changed,
        toggle,
        toggleDependency,
        save: () =>
            props.onApply({
                name: props.name,
                enabled,
                development,
                exclusions: effectiveExclusions(exclusions, props.allDetails),
            }),
    };
}

function useServiceNavigation() {
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
            setSelected(2);
        },
        showLogs: () => setLogsOpen(true),
        closeLogs: () => setLogsOpen(false),
    };
}

function serviceKeyKind(input: string, key: Key) {
    if (key.escape || input === 'q') return 'escape';
    if (key.upArrow || key.downArrow || key.tab) return 'move';
    if (key.return || input === ' ' || key.leftArrow || key.rightArrow)
        return 'activate';
    return undefined;
}

function useServiceModal(props: ServiceModalProps) {
    const configuration = useServiceConfiguration(props);
    const navigation = useServiceNavigation();
    const operations = useServiceOperations(props, configuration.save);
    const tree = dependencyTree(props.name, props.groups);
    const mainOptions = buildMainOptions(props.onContainer, props.controls);
    const actions: Partial<Record<MainOption, () => void>> = {
        enabled: () => configuration.toggle('enabled'),
        mode: () => configuration.toggle('mode'),
        dependencies: navigation.dependencies,
        save: () => {
            if (configuration.editable && configuration.changed)
                void operations.save();
        },
        reload: operations.reload,
        restart: () => {
            void operations.containerAction('restart');
        },
        stop: () => {
            void operations.containerAction('stop');
        },
        start: () => {
            void operations.containerAction('start');
        },
        logs: navigation.showLogs,
        container: props.onContainer,
        cancel: props.onClose,
    };
    const activate = () => {
        if (!navigation.dependencyView) {
            actions[mainOptions[navigation.selected]!]?.();
            return;
        }
        const dependency = tree[navigation.selected];
        if (dependency) configuration.toggleDependency(dependency);
        else navigation.back();
    };
    const inputBusy =
        operations.busy ||
        Boolean(operations.actionBusy) ||
        operations.reloading;
    const optionCount = navigation.dependencyView
        ? tree.length + 1
        : mainOptions.length;

    useInput(
        (input, key) => {
            if (inputBusy) return;
            switch (serviceKeyKind(input, key)) {
                case 'escape':
                    return navigation.dependencyView
                        ? navigation.back()
                        : props.onClose();
                case 'move':
                    return navigation.move(
                        key.upArrow || (key.tab && key.shift),
                        optionCount,
                    );
                case 'activate':
                    return activate();
            }
        },
        {
            isActive: !navigation.logsOpen,
        },
    );
    const view = useServicePresentation(
        props,
        configuration,
        navigation,
        operations,
        tree,
    );
    return {
        view,
        logsOpen: navigation.logsOpen,
        closeLogs: navigation.closeLogs,
    };
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
        development: configuration.development,
        base: Boolean(configuration.definition?.base),
        modeFixed: !configuration.definition?.development,
        dependencyCount: serviceDependencies(props.name, props.groups).length,
        busy: operations.busy,
        applyOnSave: props.applyOnSave ?? false,
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
        : buildMainOptions(props.onContainer, props.controls).map((option) =>
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
