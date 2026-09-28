interface ControllerSource {
  controller: object | null;
  addEventListener(type: "controllerchange", listener: () => void): void;
}

// First control is installation, not an update. Later controller changes
// offer one user action per actual new controller, without reloading the page.
export function watchServiceWorkerUpdates(
  source: ControllerSource,
  onUpdate: (reload: () => void) => void,
  reload: () => void,
): void {
  let previous = source.controller;
  let lastNotified: object | null = null;
  let reloadRequested = false;
  source.addEventListener("controllerchange", () => {
    const next = source.controller;
    if (next === previous) return;
    const wasControlled = previous !== null;
    previous = next;
    if (!wasControlled || next === null || next === lastNotified) return;
    lastNotified = next;
    onUpdate(() => {
      if (reloadRequested) return;
      reloadRequested = true;
      reload();
    });
  });
}
