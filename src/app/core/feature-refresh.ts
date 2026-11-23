import { DestroyRef, inject } from '@angular/core';

// Only a deliberate screen open counts as activity; passive tab restoration does not.
export function onFeatureRefresh(callback: (activity: boolean) => void): void {
  const destroyRef = inject(DestroyRef);
  let lastRefresh = 0;
  const refresh = (): void => {
    if (document.visibilityState === 'hidden' || Date.now() - lastRefresh < 250) return;
    lastRefresh = Date.now();
    callback(false);
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) refresh();
  };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', onPageShow);
  destroyRef.onDestroy(() => {
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('pageshow', onPageShow);
  });
  callback(true);
}
