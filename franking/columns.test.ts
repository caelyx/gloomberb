import { afterEach, expect, setSystemTime, test } from "bun:test";
import type { TickerRecord } from "gloomberb/types/ticker";
import { frankingPercentColumn } from "./columns";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-10T00:00:00Z");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setSystemTime();
});

const ticker = { metadata: { ticker: "CBA.AX" } } as unknown as TickerRecord;
const render = () => frankingPercentColumn.render(ticker, null as never);

test("a failed refresh under a stale copy keeps the copy and waits out the back-off", async () => {
  let calls = 0;
  let up = true;
  globalThis.fetch = (async () => {
    calls += 1;
    return up
      ? new Response(JSON.stringify({ data: { dividend: 2.7, dividendCurrency: "AUD", dividendType: "F", frankingPercent: 100 } }))
      : new Response("gone", { status: 404 });
  }) as unknown as typeof fetch;

  setSystemTime(new Date(T0));
  expect(render()).toBe("");
  await Bun.sleep(20);
  expect(render()).toBe("100%");
  expect(calls).toBe(1);

  // Past the six-hour window ASX stops answering: the stale value stays, asked once.
  up = false;
  setSystemTime(new Date(T0 + 7 * HOUR));
  expect(render()).toBe("100%");
  await Bun.sleep(20);
  expect(calls).toBe(2);
  for (let repaint = 0; repaint < 5; repaint += 1) {
    expect(render()).toBe("100%");
    await Bun.sleep(5);
  }
  expect(calls).toBe(2);

  // Half an hour on, it is tried again.
  setSystemTime(new Date(T0 + 7.6 * HOUR));
  render();
  await Bun.sleep(20);
  expect(calls).toBe(3);
});
