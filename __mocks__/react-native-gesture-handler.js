// Mock for react-native-gesture-handler
const mockGesture = {
  Pan: jest.fn(() => mockGesture),
  Pinch: jest.fn(() => mockGesture),
  Rotation: jest.fn(() => mockGesture),
  Tap: jest.fn(() => mockGesture),
  onBegin: jest.fn(() => mockGesture),
  onUpdate: jest.fn(() => mockGesture),
  onEnd: jest.fn(() => mockGesture),
  onFinalize: jest.fn(() => mockGesture),
  onChange: jest.fn(() => mockGesture),
  withSpring: jest.fn(() => mockGesture),
  enabled: jest.fn(() => mockGesture),
  maxPointers: jest.fn(() => mockGesture),
  minPointers: jest.fn(() => mockGesture),
  shouldCancelWhenOutside: jest.fn(() => mockGesture),
  onStart: jest.fn(() => mockGesture),
  runOnJS: jest.fn(() => mockGesture),
  simultaneousWithExternalGesture: jest.fn(() => mockGesture),
  numberOfTaps: jest.fn(() => mockGesture),
  numberOfPointers: jest.fn(() => mockGesture),
  Simultaneous: jest.fn((...gestures) => mockGesture),
};

module.exports = {
  Gesture: mockGesture,
  GestureDetector: ({ gesture, children }) => children,
  GestureHandlerRootView: ({ children }) => children,
  State: {
    BEGAN: 0,
    FAILED: 1,
    ACTIVE: 2,
    CANCELLED: 3,
    END: 4,
    UNDETERMINED: 5,
  },
  Directions: {
    RIGHT: 1,
    LEFT: 2,
    UP: 4,
    DOWN: 8,
  },
  PanGestureHandler: ({ children }) => children,
  TapGestureHandler: ({ children }) => children,
  PinchGestureHandler: ({ children }) => children,
  TouchableOpacity: ({ children, ...props }) => {
    const { View } = require('react-native');
    const Component = props.onPress ? View : View;
    return Component({ ...props, children });
  },
  gestureHandlerRootHOC: (Component) => Component,
  GestureStateManager: {
    create: jest.fn(),
  },
};
