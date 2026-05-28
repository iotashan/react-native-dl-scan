// `react-native-reanimated` must be the FIRST import in the entry file so its
// global setup runs before any other module touches React Native's runtime.
// Reanimated 4 reuses the existing `react-native-worklets/plugin` Babel plugin
// (no additional plugin needed); see example/babel.config.js for why that
// must remain LAST in the plugins array.
import 'react-native-reanimated';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
