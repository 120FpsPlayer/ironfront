'use strict';

/**
 * Turns install tasks into progress events for the window: { stage, label, done, total, percent }.
 * Updates are throttled (10 per second) so thousands of small asset downloads don't flood the UI.
 */

const STAGES = {
  minecraft: 'Pobieranie Minecrafta',
  java: 'Pobieranie Javy',
  loader: 'Instalacja loadera modów',
  mods: 'Pobieranie modów',
  launch: 'Uruchamianie gry',
};

function createProgress(emit, { interval = 100 } = {}) {
  let last = 0;
  let pending = null;
  const send = (event) => {
    const now = Date.now();
    pending = event;
    if (now - last >= interval || event.done >= event.total) {
      last = now;
      emit(pending);
      pending = null;
    }
  };
  return {
    stage(stage, label = STAGES[stage] ?? stage) {
      emit({ stage, label, done: 0, total: 0, percent: null });
    },
    update(stage, done, total, label = STAGES[stage] ?? stage) {
      const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
      send({ stage, label, done, total, percent });
    },
    /** A TaskContext for @xmcl tasks – reports the root task's bytes. */
    context(stage, rootTask, label) {
      return {
        onUpdate: () => send({ stage, label: label ?? STAGES[stage] ?? stage, done: rootTask.progress, total: rootTask.total, percent: rootTask.total > 0 ? Math.min(100, Math.round((rootTask.progress / rootTask.total) * 100)) : null }),
      };
    },
    flush() {
      if (pending) emit(pending);
      pending = null;
    },
  };
}

module.exports = { createProgress, STAGES };
