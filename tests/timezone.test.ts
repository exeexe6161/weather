import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBundledModule } from './testHarness.ts';

interface TimeModules {
  formatHour(value: string, locale?: string): string;
  formatDayMonth(value: string, locale?: string): string;
  renderRainChart(container: HTMLElement, input: Record<string, unknown>): void;
  renderTempCurve(container: HTMLElement, input: Record<string, unknown>): void;
  currentHourIndex(forecast: Record<string, unknown>): number;
  segmentsFor(hours: Array<Record<string, unknown>>): Array<{ stage: string; durationHours?: number }>;
  simplifySegments(segments: Array<Record<string, unknown>>): Array<{ stage: string; durationHours?: number }>;
}

const time = await loadBundledModule<TimeModules>(`
  export { formatHour, formatDayMonth } from './src/lib/format.ts';
  export { renderRainChart } from './src/components/RainChart.ts';
  export { renderTempCurve } from './src/components/TempCurve.ts';
  export { currentHourIndex } from './src/components/HourlyStrip.ts';
  export { segmentsFor, simplifySegments } from './src/lib/clothing.ts';
`);

function chartContainer(): { container: HTMLElement; html: { value: string } } {
  const html = { value: '' };
  const container = {
    hidden: false,
    replaceChildren() { html.value = ''; },
    insertAdjacentHTML(_where: string, markup: string) { html.value += markup; },
    appendChild() {},
    addEventListener() {},
  } as unknown as HTMLElement;
  return { container, html };
}

function axis(markup: string, className: string): string[] {
  return [...markup.matchAll(new RegExp(`<text[^>]*class="${className}"[^>]*>([^<]*)<\\/text>`, 'g'))].map((match) => match[1]);
}

test('provider wall time remains local across device DST and locales', () => {
  for (const locale of ['de-DE', 'en', 'tr']) {
    const expected = new Date(Date.UTC(2026, 2, 29, 2)).toLocaleTimeString(locale, {
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    });
    assert.equal(time.formatHour('2026-03-29 02:00', locale), expected);
    assert.equal(time.formatHour('2026-02-10 14:00', locale),
      new Date(Date.UTC(2026, 1, 10, 14)).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }));
    assert.equal(time.formatHour('2026-07-15 14:00', locale),
      new Date(Date.UTC(2026, 6, 15, 14)).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }));
  }
  assert.equal(time.formatHour('2026-02-30 14:00'), '–');
  assert.equal(time.formatHour('invalid'), '–');
  assert.equal(time.formatDayMonth('2026-03-29', 'de-DE'), '29.03.');
});

test('rain chart labels follow actual spring and repeated fall hours', () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: { createElement: () => ({ className: '' }), addEventListener() {} }, configurable: true });
  try {
    const spring = chartContainer();
    time.renderRainChart(spring.container, {
      precip: [0, 1, 0, 0, 0],
      times: ['2026-03-29T01:00', '2026-03-29T03:00', '2026-03-29T04:00', '2026-03-29T05:00', '2026-03-29T06:00'],
      locale: 'de-DE', ariaLabel: 'Regen',
    });
    assert.deepEqual(axis(spring.html.value, 'rc-axis').slice(1), ['03:00', '04:00', '05:00', '06:00']);
    assert.doesNotMatch(spring.html.value, /class="rc-axis"[^>]*>02:00/);

    const fall = chartContainer();
    time.renderRainChart(fall.container, {
      precip: [0, 1, 2, 0, 0],
      times: ['2026-10-25T01:00', '2026-10-25T02:00', '2026-10-25T02:00', '2026-10-25T03:00', '2026-10-25T04:00'],
      locale: 'de-DE', ariaLabel: 'Regen',
    });
    assert.deepEqual(axis(fall.html.value, 'rc-axis').slice(1), ['02:00', '02:00', '03:00', '04:00']);
    assert.equal((fall.html.value.match(/class="rc-bar"/g) ?? []).length, 2);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete (globalThis as { document?: unknown }).document;
  }
});

test('temperature curve uses source hour at each axis mark', () => {
  const hours = Array.from({ length: 25 }, (_, index) =>
    new Date(Date.UTC(2026, 2, 29, index < 1 ? 1 : index + 2)).toISOString().slice(0, 16));
  const view = chartContainer();
  time.renderTempCurve(view.container, {
    feels: Array.from({ length: 25 }, () => 18), times: hours,
    locale: 'de-DE', ariaLabel: 'Temperatur',
  });
  assert.deepEqual(axis(view.html.value, 'tc-axis').slice(1), [hours[6], hours[12], hours[18], hours[24]].map((hour) => time.formatHour(hour)));
});

test('duplicate local hours retain epoch identity and old cache falls back', () => {
  const hours = [
    { time: '2026-10-25T02:00', timeEpoch: 1792886400 },
    { time: '2026-10-25T02:00', timeEpoch: 1792890000 },
    { time: '2026-10-25T03:00', timeEpoch: 1792893600 },
  ];
  assert.equal(time.currentHourIndex({ current: { time: '2026-10-25T02:30', timeEpoch: 1792891800 }, hourly: hours }), 1);
  assert.equal(time.currentHourIndex({ current: { time: '2026-10-25T02:30' }, hourly: hours.map(({ time }) => ({ time })) }), 0);
});

test('clothing duration counts real hour entries through DST transitions', () => {
  const spring = time.segmentsFor(['01:00', '03:00'].map((hour) => ({
    time: `2026-03-29T${hour}`, apparentTemperature: 25,
  })));
  const fall = time.segmentsFor(['01:00', '02:00', '02:00'].map((hour) => ({
    time: `2026-10-25T${hour}`, apparentTemperature: 25,
  })));
  assert.equal(spring[0].durationHours, 2);
  assert.equal(fall[0].durationHours, 3);
  assert.equal(time.simplifySegments(fall)[0].durationHours, 3);
});
