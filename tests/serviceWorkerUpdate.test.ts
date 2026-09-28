import assert from "node:assert/strict";
import { test } from "node:test";
import { watchServiceWorkerUpdates } from "../src/lib/serviceWorkerUpdate.ts";
import { uiLabels } from "../src/i18n/ui.ts";

test("first control is silent; a later controller change offers one voluntary reload", () => {
  const first = {};
  const second = {};
  let listener = () => {};
  const source = {
    controller: null as object | null,
    addEventListener(type: "controllerchange", callback: () => void) {
      assert.equal(type, "controllerchange");
      listener = callback;
    },
  };
  const actions: Array<() => void> = [];
  let reloads = 0;
  watchServiceWorkerUpdates(source, (action) => actions.push(action), () => { reloads++; });

  source.controller = first;
  listener();
  assert.equal(actions.length, 0);
  source.controller = second;
  listener();
  listener();
  assert.equal(actions.length, 1);
  assert.equal(reloads, 0);
  actions[0]();
  actions[0]();
  assert.equal(reloads, 1);
});

test("an already controlled tab gets one action and all update labels are translated", () => {
  const first = {};
  const second = {};
  let listener = () => {};
  const source = {
    controller: first as object | null,
    addEventListener(_type: "controllerchange", callback: () => void) { listener = callback; },
  };
  let notices = 0;
  watchServiceWorkerUpdates(source, () => { notices++; }, () => {});
  source.controller = second;
  listener();
  listener();
  assert.equal(notices, 1);
  for (const lang of ["de", "en", "tr"] as const) {
    assert.ok(uiLabels.updateAvailable[lang]);
    assert.ok(uiLabels.reloadApp[lang]);
  }
});
