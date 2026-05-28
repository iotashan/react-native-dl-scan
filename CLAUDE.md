## Debugging Tips
- remember to use zen:debug when solving errors
- use Serena tools
- don't be shy about using zen deepthink before starting a task

## Instructions
- Read the initial instructions

## Git Workflow
- after a successful merge, delete the task branch

## Android dev environment
- The example Android build requires **JDK 21**. `@react-native/gradle-plugin@0.81` was built against Kotlin 2.1.20 / AGP 8.11 and FAILS to load under JDK 25+. When this happens, gradle's error is the very misleading `Error resolving plugin [id: 'com.facebook.react.settings'] > 25.0.2` — the `25.0.2` is the rejected JVM version, NOT a plugin version.
- Fix: `brew install openjdk@21`, then either:
  - Set `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` in shell, or
  - Add `org.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` to `~/.gradle/gradle.properties` (user-scope; safer than the prebuild-output `example/android/gradle.properties` which Expo wipes).
- Homebrew's `openjdk` keg auto-upgrades to whatever's latest; this is what regresses gradle without warning. The `openjdk@21` versioned keg is the stable pin.
- The example/android directory is gitignored Expo prebuild output. Don't try to commit changes there — write a config plugin in app.json's plugins array if a persistent change is needed.