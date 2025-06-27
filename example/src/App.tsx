import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Import all screens
import HomeScreen from './screens/HomeScreen';
import BasicScanningScreen from './screens/BasicScanningScreen';
import IntelligentModeScreen from './screens/IntelligentModeScreen';
import ManualModeScreen from './screens/ManualModeScreen';
import QualityDemoScreen from './screens/QualityDemoScreen';
import AccessibilityDemoScreen from './screens/AccessibilityDemoScreen';
import ErrorScenariosScreen from './screens/ErrorScenariosScreen';
import PerformanceTestScreen from './screens/PerformanceTestScreen';
import HistoryScreen from './screens/HistoryScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="BasicScanning" component={BasicScanningScreen} />
        <Stack.Screen
          name="IntelligentMode"
          component={IntelligentModeScreen}
        />
        <Stack.Screen name="ManualMode" component={ManualModeScreen} />
        <Stack.Screen name="QualityDemo" component={QualityDemoScreen} />
        <Stack.Screen
          name="AccessibilityDemo"
          component={AccessibilityDemoScreen}
        />
        <Stack.Screen name="ErrorScenarios" component={ErrorScenariosScreen} />
        <Stack.Screen
          name="PerformanceTest"
          component={PerformanceTestScreen}
        />
        <Stack.Screen name="History" component={HistoryScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
