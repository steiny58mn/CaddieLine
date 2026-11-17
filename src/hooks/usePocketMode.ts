import { useEffect, useState } from 'react';

/**
 * Pocket Mode Detection:
 * Listens for native proximity sensor events from Android MainActivity ('pocketModeState').
 * When in pocket, dims screen and blocks all touch interaction to prevent accidental taps.
 */
export function usePocketMode() {
  const [inPocket, setInPocket] = useState<boolean>(false);

  useEffect(() => {
    const handlePocketEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ inPocket?: boolean }>;
      if (typeof customEvent.detail?.inPocket === 'boolean') {
        setInPocket(customEvent.detail.inPocket);
      }
    };

    window.addEventListener('pocketModeState', handlePocketEvent);
    return () => {
      window.removeEventListener('pocketModeState', handlePocketEvent);
    };
  }, []);

  return {
    inPocket,
    setInPocket,
  };
}
