import { useEffect, useMemo, useState } from 'react';
import { createPersistence } from './persistence/bootstrap.ts';
import { ChallengeWorkspace } from './workspace/ChallengeWorkspace.tsx';
import './App.css';

function App() {
  const persistence = useMemo(() => createPersistence(), []);
  const [unavailableNotice, setUnavailableNotice] = useState(false);

  useEffect(() => {
    return persistence.onStorageUnavailable(() => {
      setUnavailableNotice(true);
    });
  }, [persistence]);

  const storageAvailable = persistence.storageAvailable && !unavailableNotice;

  return (
    <>
      {!storageAvailable && (
        <div className="storage-banner banner--muted" role="status">
          Local storage unavailable — progress won&apos;t be saved
        </div>
      )}
      <ChallengeWorkspace progressService={persistence.progress} reader={persistence.dao} />
    </>
  );
}

export default App
