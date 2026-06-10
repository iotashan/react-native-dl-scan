# Example-app E2E UI suite (physical devices)

Drives the example app on **real devices** through
[agent-device](https://incubator.callstack.com/agent-device/) and asserts on
the accessibility tree. No driver's license is required: everything that
needs a "parsed card" uses the dev **AAMVA fixture** (the beaker button) to
inject a synthetic result, so the result screen, confidence rail, and
re-scan flow are all testable with the camera pointed at nothing.

## What it covers

| Test | What it proves |
|---|---|
| app launches to the scan screen | app boots, Nitro module registered (a registration failure shows "App entry not found" instead) |
| mode flip Front ↔ Back | mode buttons respond and persist selection |
| scan starts/stops without a card | the live-scan state machine runs and exits cleanly with zero frames |
| fixture renders the result screen | result surface renders: hero card, confidence rail, field chips |
| scan-again resets the scanner | the #70 regression stays dead — no stale result re-emit |

## One-time device prerequisites

1. `agent-device` ≥ 0.14 installed (`npm i -g agent-device`).
2. A persistent session bound to each device (REUSE these names; never churn
   new session names for a device that already has one):
   ```sh
   # iPad (physical) — use the UDID, not the device name
   AGENT_DEVICE_IOS_TEAM_ID=<your-team> agent-device open com.iotashan.dlscanexample \
     --platform ios --udid <ipad-udid> --session ipadlive
   # Android
   agent-device open com.iotashan.dlscanexample --platform android --session pix
   ```
3. iOS only: the first run after an iOS UPDATE re-prompts the XCUITest
   automation trust dialog **on the device** — approve it once. Building the
   runner for a brand-new iOS major may also need the matching Xcode beta
   (`DEVELOPER_DIR=/Applications/Xcode-beta.app/... agent-device open ...`).
4. The app installed on the device (debug build) and Metro serving this
   `example/` (`yarn start`); Android additionally needs
   `adb reverse tcp:8081 tcp:8081`.
5. Devices unlocked and awake for the duration of the run.

## Running

```sh
cd example
yarn e2e:ios       # → node e2e/run.mjs --platform ios     --session ipadlive
yarn e2e:android   # → node e2e/run.mjs --platform android --session pix
```

Failures drop a framebuffer screenshot at
`/tmp/dlscan-e2e-<platform>-<test>.png` and print the last accessibility
snapshot for diagnosis.

## Notes / limitations

- **Serial only.** One session = one device; the runner never parallelizes
  stateful commands within a session. Running iOS and Android suites
  concurrently from two terminals is fine (different sessions).
- The fixture tests skip automatically in non-dev builds (no beaker button).
- A real-scan accuracy test is deliberately out of scope — that requires a
  physical card and is covered by the maintainer's scored-scan workflow
  instead.
