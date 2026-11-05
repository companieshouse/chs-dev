import { useEffect, useState } from 'react';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function useSpinner(active = true): string {
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        if (!active) return;
        setFrame(0);
        const timer = setInterval(
            () => setFrame((value) => (value + 1) % frames.length),
            80,
        );
        return () => clearInterval(timer);
    }, [active]);
    return frames[frame];
}
