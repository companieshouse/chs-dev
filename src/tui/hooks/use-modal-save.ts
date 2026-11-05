import { useAsyncAction } from './use-async-action.js';

export function useModalSave(save: () => Promise<void>, close: () => void) {
    const action = useAsyncAction<'save'>();
    const submit = () =>
        action.run('save', async () => {
            await save();
            close();
            return { ok: true, message: '' };
        });
    return {
        busy: action.busy !== undefined,
        error: action.notice?.ok === false ? action.notice.message : '',
        submit,
    };
}
