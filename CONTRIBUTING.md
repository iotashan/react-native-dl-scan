# Contributing to react-native-dl-scan

Thanks for taking the time to contribute. This library is a small project, and
every bug report, feature suggestion, and pull request is appreciated. The
fastest way to get traction on a change is to open an issue first so we can
agree on the shape of it before code is written.

The issue tracker lives at
<https://github.com/iotashan/react-native-dl-scan/issues>.

## Reporting bugs

Open a GitHub issue and include, at minimum:

- Library version (`react-native-dl-scan` from your `package.json`)
- React Native version, and whether you're on Expo or bare RN
- Platform and OS version (iOS 18.2, Android 15, etc.)
- Device or simulator/emulator model
- A minimal repro — ideally a branch of the example app, or a short snippet
  that triggers the bug
- Relevant error logs, including native logs (`xcrun simctl spawn ... log
  stream` for iOS, `adb logcat` for Android) if the failure is native

If the issue involves a specific driver's license, please **do not** attach a
real one. A redacted photo or a description of the layout is enough.

## Suggesting enhancements

For anything non-trivial (new public API, new field, new platform behavior),
open an issue describing the use case before sending a PR. This avoids the
situation where a PR lands a week of work that has to be reshaped or rejected.
Small fixes — typos, doc clarifications, obvious bugs — can go straight to a
PR.

## Development setup

### Prerequisites

- Node.js 20+
- Yarn 3.6.1 (pinned via packageManager in package.json; run `corepack enable` once)
- Xcode 16+ with Command Line Tools (for iOS)
- Android Studio with NDK, and **JDK 21** (Android's Gradle build requires
  JDK 21; set `JAVA_HOME` to your OpenJDK 21 installation, e.g.
  `/opt/homebrew/opt/openjdk@21`)
- CMake 3.22+ and a C++17 toolchain (for the C++ core and its tests)

### Clone and install

```bash
git clone https://github.com/iotashan/react-native-dl-scan.git
cd react-native-dl-scan
yarn install
```

### Run the example app

The example app is the easiest way to exercise the library end to end.

```bash
cd example
yarn install

# iOS (boots a Simulator)
yarn ios

# Android (needs an emulator running or a device attached)
yarn android
```

For iOS Simulator testing of the camera pipeline — and the simulator's
limitations around document segmentation and OCR — see
[docs/SIMULATOR_TESTING.md](./docs/SIMULATOR_TESTING.md). Feeding a static
image into the simulator camera (via SimCam) is the only way to exercise the
scanner without a physical card, but accuracy verification always needs a
physical device.

### Tests

```bash
# TypeScript/JS unit tests (Jest)
yarn test

# C++ unit tests (GoogleTest, 261 cases)
cd cpp
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

### Lint and type-check

```bash
yarn lint
yarn typecheck
```

### Updating the example app's open-source acknowledgments

The example app ships an "Open source licenses" screen (reachable from the
debug drawer) that lists every dependency it bundles along with its license
text. The data is generated from `example/node_modules` and checked in at
`example/assets/licenses.json`. **Re-run the generator whenever you add,
remove, or upgrade a dependency in `example/package.json`:**

```bash
cd example
yarn generate-licenses
```

The script walks production dependencies + their transitive prod deps, reads
each `LICENSE` file, and emits a single JSON file. devDependencies are skipped
because they don't ship in the consumer's app bundle.

Both are run by `lefthook` as pre-commit hooks, alongside `commitlint`, so
broken commits are blocked locally before they reach CI.

## Conventional commits

Commit messages are validated by [commitlint](https://commitlint.js.org/) using
the config in `commitlint.config.js`. The format is:

```
<type>(<optional scope>): <subject>
```

Examples that pass:

```
feat(ios): add Vision document segmentation request
fix(cpp): handle empty AAMVA payload without throwing
docs: clarify Android JDK 21 requirement
chore: bump nitro-modules to 0.x
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`,
`build`, `ci`. The hook will reject the commit and print a message if the
format is wrong — fix the message and re-commit (don't `--amend` blindly if
other hook stages failed; create a fresh commit so nothing is lost).

## Pull request flow

1. Fork the repo (or branch directly if you have push access).
2. Create a branch off `main`. Use a short descriptive name, e.g.
   `fix/android-corner-overlay-rotation`.
3. Make your change. Keep PRs focused — one fix or one feature per PR.
4. Fill in the PR template. Link the issue it addresses.
5. CI runs lint, types, JS tests, and the C++ test suite. All must pass.
6. A maintainer will review. Expect a turnaround in days, not hours — this is
   a small project.
7. Once approved, the PR is merged into `main`. Releases are cut from `main`
   on a release branch; you don't need to touch `CHANGELOG.md` unless your PR
   is a release commit.

## Code style

- TypeScript and JS: ESLint + Prettier, both run from `yarn lint`. The
  formatter is the source of truth — don't argue with it, and don't disable
  rules without a comment explaining why.
- C++: follow the style of the existing code in `cpp/`. The CMake build runs
  with `-Wall -Wextra`; new warnings should be fixed, not silenced.
- Native (Swift / Kotlin): match the surrounding file. Don't reformat
  unrelated code in the same PR.

If you need to disable a lint rule for a legitimate reason, leave a short
inline comment so the next contributor knows it was intentional.

## License

By submitting a contribution, you agree that your work is licensed under the
project's [MIT License](LICENSE).
