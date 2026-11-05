import { useCallback, useState } from 'react';

export function useSearch(initial = '') {
    const [query, setQuery] = useState(initial);
    const [searching, setSearching] = useState(false);
    const begin = useCallback(() => setSearching(true), []);
    const finish = useCallback(() => setSearching(false), []);
    const clear = useCallback(() => {
        setQuery('');
        setSearching(false);
    }, []);
    return {
        query,
        searching,
        setQuery,
        setSearching,
        begin,
        finish,
        clear,
        escape: clear,
    };
}
