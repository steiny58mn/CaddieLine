/**
 * Service to bridge PocketCaddy course & hole distance data to Wear OS companion watch
 */

export interface WatchDistanceUpdate {
  roundActive?: boolean;
  courseName?: string;
  hole: number;
  par: number;
  front: number | null;
  pin: number | null;
  back: number | null;
  unit?: string;
}

export interface WatchShotEventDetail {
  clubId: string;
  clubName: string;
  lie: 'fairway' | 'rough' | 'sand' | 'green' | 'tee';
  direction: 'left' | 'straight' | 'right';
}

/**
 * Pushes live yardages & round state to the connected Wear OS companion watch.
 */
export function syncDistancesToWatch(update: WatchDistanceUpdate): void {
  if (typeof window === 'undefined' || !window.NativeFeedback?.updateWatchDistances) {
    return;
  }

  try {
    const f = update.front !== null && !isNaN(update.front) ? Math.round(update.front) : -1;
    const p = update.pin !== null && !isNaN(update.pin) ? Math.round(update.pin) : -1;
    const b = update.back !== null && !isNaN(update.back) ? Math.round(update.back) : -1;
    const unit = update.unit || 'yd';
    const roundActive = update.roundActive !== false;
    const courseName = update.courseName || '';

    window.NativeFeedback.updateWatchDistances(
      roundActive,
      courseName,
      update.hole,
      update.par,
      f,
      p,
      b,
      unit
    );
  } catch (err) {
    console.debug('Failed to sync distances to Wear OS watch:', err);
  }
}

/**
 * Notifies the connected Wear OS companion watch that a club was scanned on the phone.
 * Triggers vibration, chime, and a confirmation display on the watch.
 */
export function notifyWatchClubScanned(clubName: string, clubShortName?: string): void {
  if (typeof window === 'undefined' || !window.NativeFeedback?.notifyWatchClubScanned) {
    return;
  }

  try {
    window.NativeFeedback.notifyWatchClubScanned(clubName, clubShortName || clubName);
  } catch (err) {
    console.debug('Failed to notify watch of club scan:', err);
  }
}

/**
 * Subscribes to hole change requests triggered from the Wear OS watch navigation arrows.
 */
export function subscribeToWatchHoleChange(onAction: (action: 'next' | 'prev') => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const custom = event as CustomEvent<{ action?: 'next' | 'prev' }>;
    if (custom.detail?.action === 'next' || custom.detail?.action === 'prev') {
      onAction(custom.detail.action);
    }
  };

  window.addEventListener('watchHoleChange', handler);
  return () => window.removeEventListener('watchHoleChange', handler);
}

/**
 * Subscribes to shot logging requests sent from the Wear OS companion watch.
 */
export function subscribeToWatchLogShot(
  onLogShot: (detail: WatchShotEventDetail) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const custom = event as CustomEvent<WatchShotEventDetail>;
    if (custom.detail && custom.detail.clubId) {
      onLogShot(custom.detail);
    }
  };

  window.addEventListener('watchLogShot', handler);
  return () => window.removeEventListener('watchLogShot', handler);
}
