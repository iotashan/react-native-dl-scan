#!/usr/bin/env node
// E2E UI suite for the example app on PHYSICAL devices, driven through
// agent-device. No driver's license required: the suite exercises every UI
// state that doesn't need a real card, and uses the dev AAMVA fixture (the
// beaker button) to fake a parsed result so the result screen, hero card,
// confidence rail, and re-scan flow can all be asserted.
//
// Usage:
//   node e2e/run.mjs --platform ios     --session ipadlive
//   node e2e/run.mjs --platform android --session pix
//   (or: yarn e2e:ios / yarn e2e:android — see package.json)
//
// Prereqs (see e2e/README.md): Metro serving this example, the app installed
// and reachable, an agent-device session already bound to the target device.

import { Device, sleep } from './lib/agentDevice.mjs';

const BUNDLE_ID = 'com.iotashan.dlscanexample';

// ─── tiny runner ────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null))
    .filter(Boolean)
);
const platform = args.platform;
const session = args.session;
if (!platform || !session) {
  console.error(
    'usage: node e2e/run.mjs --platform <ios|android> --session <name>'
  );
  process.exit(2);
}

const device = new Device({ session, platform });
const results = [];
let failed = 0;

async function test(name, fn, { skipReason } = {}) {
  if (skipReason) {
    results.push({ name, status: 'SKIP', detail: skipReason });
    console.log(`⏭  SKIP ${name} — ${skipReason}`);
    return;
  }
  process.stdout.write(`▶ ${name} ... `);
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS');
  } catch (err) {
    failed += 1;
    results.push({ name, status: 'FAIL', detail: err.message });
    console.log(`FAIL\n   ${err.message.split('\n')[0]}`);
    // Failure artifact: screenshot + the last snapshot when available.
    const shot = `/tmp/dlscan-e2e-${platform}-${name.replace(/\W+/g, '-')}.png`;
    try {
      await device.screenshot(shot);
      console.log(`   screenshot: ${shot}`);
    } catch {
      /* screenshots are best-effort on failure paths */
    }
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

// ─── the suite ──────────────────────────────────────────────────────────────

// NOTE on selectors: prefer pressing by label selector for stability; fall
// back to refs from the freshest snapshot when labels are ambiguous.

let snap = '';

/**
 * Normalize to the standby scan screen from wherever the app is:
 * result screen → press the re-scan affordance; live scan → press stop.
 * Tests call this so a prior test's end-state (or a pre-existing app
 * session) can't poison them.
 */
async function ensureScanScreen() {
  for (let i = 0; i < 3; i++) {
    snap = await device.snapshot();
    if (/Start scan/i.test(snap)) return snap;
    const again = device.refFor(snap, /Scan again|Scan next license/i);
    if (again) {
      await device.press(again);
      await sleep(1500);
      continue;
    }
    const stop = device.refFor(snap, /Stop scanning/i);
    if (stop) {
      await device.press(stop);
      await sleep(1500);
      continue;
    }
    await sleep(1500);
  }
  return device.waitFor(/Start scan/i, { timeoutMs: 10_000 });
}

await test('app launches to the scan screen', async () => {
  // --relaunch needs the device unlocked on iOS; fall back to a plain
  // foreground open (good enough when the app is already running).
  try {
    await device.open(BUNDLE_ID, { relaunch: true });
  } catch {
    await device.open(BUNDLE_ID);
  }
  snap = await device.waitFor(/Front|Back/, { timeoutMs: 45_000 });
  // The Nitro-registration canary: a failed module registration renders
  // "App entry not found" instead of the app. The app-NAME node only
  // appears in the iOS tree; Android's snapshot starts at the content, so
  // assert on the in-app header there.
  assert(!/App entry not found/i.test(snap), 'no registration failure screen');
  if (platform === 'ios') {
    // The app-name/application node only exists in the iOS tree; Android's
    // collapsed snapshot starts at the interactive content.
    assert(/DLScan Example/i.test(snap), 'app chrome visible');
  }
  assert(/Back/.test(snap) && /Front/.test(snap), 'mode flip visible');
  assert(/Start scan/i.test(snap), 'Start scan button visible');
});

await test('mode flip: Front ↔ Back', async () => {
  snap = await device.snapshot();
  const front = device.refFor(snap, /Front.*mode|"Front/);
  assert(front, 'Front mode button found');
  await device.press(front);
  snap = await device.waitFor(/Front/i);
  const back = device.refFor(snap, /Back.*mode|"Back/);
  assert(back, 'Back mode button found');
  await device.press(back);
  snap = await device.waitFor(/Back/i);
  // Return to Front for the rest of the suite.
  const front2 = device.refFor(snap, /Front.*mode|"Front/);
  await device.press(front2);
  await sleep(800);
});

await test('scan starts and stops without a card', async () => {
  snap = await device.snapshot();
  const start = device.refFor(snap, /Start scan/i);
  assert(start, 'Start scan ref found');
  await device.press(start);
  // "Stop scanning" replacing "Start scan" IS the live-state proof; the
  // status badges ("No frames yet", the pass counter) sit inside collapsed
  // helper nodes on Android, so don't assert on them.
  snap = await device.waitFor(/Stop scanning/i, { timeoutMs: 15_000 });
  assert(!/App entry not found/i.test(snap), 'scanner alive while scanning');
  const stop = device.refFor(snap, /Stop scanning/i);
  await device.press(stop);
  await device.waitFor(/Start scan/i, { timeoutMs: 15_000 });
});

// The dev fixture (beaker button, __DEV__ builds only) injects a synthetic
// AAMVA result without any camera input — the fakery that lets us test the
// whole result surface with no card present.
let fixtureRef = null;
snap = await device.snapshot();
fixtureRef = device.refFor(snap, /fixture/i);

await test(
  'fixture renders the result screen',
  async () => {
    await device.press(fixtureRef);
    // The re-scan affordance is the most reliable cross-platform marker of
    // the result screen (decorative text like the "Parsed" meta line gets
    // collapsed out of Android's snapshot).
    snap = await device.waitFor(/Scan again|Scan next license/i, {
      timeoutMs: 20_000,
    });
    assert(
      /ALL FIELDS|FIRST|LAST|CONFIDENCE/i.test(snap),
      'result fields visible'
    );
  },
  fixtureRef
    ? {}
    : { skipReason: 'fixture button not visible (non-dev build or hidden)' }
);

await test(
  'scan-again resets to a fresh scanner (no stale re-emit)',
  async () => {
    snap = await device.snapshot();
    const again = device.refFor(snap, /Scan again|Scan next license/i);
    assert(again, 're-scan button found');
    await device.press(again);
    // Must land on a LIVE scanner (the #70 regression rendered the previous
    // result instantly instead).
    snap = await device.waitFor(/Stop scanning|Start scan/i, {
      timeoutMs: 15_000,
    });
    assert(
      !/Parsed/i.test(snap),
      'result screen must not re-emit after Scan again'
    );
    // Park the app back at standby if a scan is live.
    const stop = device.refFor(snap, /Stop scanning/i);
    if (stop) {
      await device.press(stop);
      await device.waitFor(/Start scan/i, { timeoutMs: 15_000 });
    }
  },
  fixtureRef ? {} : { skipReason: 'depends on the fixture result screen' }
);

// ─── report ─────────────────────────────────────────────────────────────────

console.log('\n── e2e summary ──');
for (const r of results) {
  console.log(
    ` ${r.status.padEnd(4)} ${r.name}${r.detail ? ` — ${r.detail.split('\n')[0]}` : ''}`
  );
}
const passed = results.filter((r) => r.status === 'PASS').length;
const skipped = results.filter((r) => r.status === 'SKIP').length;
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
