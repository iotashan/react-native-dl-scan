/* eslint-disable @typescript-eslint/no-unused-vars */

const React = require('react');
const RN = jest.requireActual('react-native');

// Mock all the needed modules
const mockAnimatedValue = () => ({
  setValue: jest.fn(),
  setOffset: jest.fn(),
  flattenOffset: jest.fn(),
  extractOffset: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn(),
  stopAnimation: jest.fn(),
  resetAnimation: jest.fn(),
  interpolate: jest.fn(),
  animate: jest.fn(),
  _startListeningToNativeValueUpdates: jest.fn(),
  _stopListeningForNativeValueUpdates: jest.fn(),
});

const mockAnimatedTimingConfig = () => ({
  start: jest.fn((callback) => callback && callback({ finished: true })),
  stop: jest.fn(),
  reset: jest.fn(),
});

const Platform = {
  OS: 'ios',
  select: jest.fn((obj) => obj.ios || obj.default),
  Version: '14.0',
  constants: {
    isTesting: true,
    osVersion: '14.0',
    reactNativeVersion: {
      major: 0,
      minor: 79,
      patch: 0,
    },
    systemName: 'iOS',
  },
  isDisableAnimations: false,
};

const Animated = {
  Value: jest.fn(mockAnimatedValue),
  View: 'Animated.View',
  Text: 'Animated.Text',
  Image: 'Animated.Image',
  ScrollView: 'Animated.ScrollView',
  createAnimatedComponent: jest.fn((component) => component),
  timing: jest.fn(mockAnimatedTimingConfig),
  spring: jest.fn(mockAnimatedTimingConfig),
  sequence: jest.fn(mockAnimatedTimingConfig),
  parallel: jest.fn(mockAnimatedTimingConfig),
  decay: jest.fn(mockAnimatedTimingConfig),
  delay: jest.fn(mockAnimatedTimingConfig),
  loop: jest.fn(mockAnimatedTimingConfig),
  event: jest.fn(),
  add: jest.fn(),
  subtract: jest.fn(),
  divide: jest.fn(),
  multiply: jest.fn(),
  modulo: jest.fn(),
  diffClamp: jest.fn(),
};

// Create proper component mocks
const TouchableOpacity = ({ children, ...props }) => 
  React.createElement('TouchableOpacity', props, children);

const TouchableHighlight = ({ children, ...props }) => 
  React.createElement('TouchableHighlight', props, children);

const TouchableWithoutFeedback = ({ children, ...props }) => 
  React.createElement('TouchableWithoutFeedback', props, children);

module.exports = {
  ...RN,
  Platform,
  Animated,
  // Mock Touchable components
  TouchableOpacity,
  TouchableHighlight,
  TouchableWithoutFeedback,
  // Mock other components
  View: ({ children, ...props }) => React.createElement('View', props, children),
  Text: ({ children, ...props }) => React.createElement('Text', props, children),
  Image: (props) => React.createElement('Image', props),
  ScrollView: ({ children, ...props }) => React.createElement('ScrollView', props, children),
  FlatList: ({ children, ...props }) => React.createElement('FlatList', props, children),
  // Mock utilities
  StyleSheet: {
    create: (styles) => styles,
    flatten: jest.fn(),
    compose: jest.fn(),
  },
  Dimensions: {
    get: jest.fn(() => ({ width: 375, height: 667 })),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
  PixelRatio: {
    get: jest.fn(() => 2),
    getFontScale: jest.fn(() => 1),
    getPixelSizeForLayoutSize: jest.fn((size) => size * 2),
    roundToNearestPixel: jest.fn((size) => size),
  },
  // Mock APIs
  Vibration: {
    vibrate: jest.fn(),
  },
  AccessibilityInfo: {
    announceForAccessibility: jest.fn(),
    isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)),
    isScreenReaderEnabled: jest.fn(() => Promise.resolve(false)),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
  // Mock NativeModules
  NativeModules: {
    ...RN.NativeModules,
  },
};