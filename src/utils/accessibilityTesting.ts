import { AccessibilityInfo } from 'react-native';

/**
 * Accessibility Testing Utilities
 * Tools for testing accessibility compliance and debugging accessibility issues
 */

export interface AccessibilityIssue {
  severity: 'error' | 'warning' | 'info';
  type: string;
  message: string;
  element?: any;
  suggestion?: string;
}

export interface AccessibilityReport {
  passed: boolean;
  score: number; // 0-100
  issues: AccessibilityIssue[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
}

/**
 * Accessibility Test Suite
 */
export class AccessibilityTestSuite {
  private issues: AccessibilityIssue[] = [];

  /**
   * Test if element has proper accessibility label
   */
  testAccessibilityLabel(element: any, context: string = ''): void {
    if (!element?.props) return;

    const { accessibilityLabel, accessibilityLabelledBy, children } =
      element.props;

    if (!accessibilityLabel && !accessibilityLabelledBy) {
      // Check if element has text children that could serve as label
      const hasTextChildren = this.hasTextContent(children);

      if (!hasTextChildren) {
        this.addIssue({
          severity: 'error',
          type: 'missing_label',
          message: `Element missing accessibility label${context ? ` in ${context}` : ''}`,
          element,
          suggestion: 'Add accessibilityLabel prop with descriptive text',
        });
      }
    } else if (accessibilityLabel && accessibilityLabel.length < 2) {
      this.addIssue({
        severity: 'warning',
        type: 'short_label',
        message: `Accessibility label too short${context ? ` in ${context}` : ''}`,
        element,
        suggestion: 'Provide more descriptive accessibility label',
      });
    }
  }

  /**
   * Test if interactive element has proper role
   */
  testAccessibilityRole(element: any, context: string = ''): void {
    if (!element?.props) return;

    const { accessibilityRole, onPress, onPressIn, onPressOut } = element.props;
    const isInteractive = !!(onPress || onPressIn || onPressOut);

    if (isInteractive && !accessibilityRole) {
      this.addIssue({
        severity: 'error',
        type: 'missing_role',
        message: `Interactive element missing accessibility role${context ? ` in ${context}` : ''}`,
        element,
        suggestion: 'Add accessibilityRole="button" or appropriate role',
      });
    }
  }

  /**
   * Test if element has appropriate touch target size
   */
  testTouchTargetSize(element: any, context: string = ''): void {
    if (!element?.props?.style) return;

    const style = Array.isArray(element.props.style)
      ? Object.assign({}, ...element.props.style)
      : element.props.style;

    const { width, height, minWidth, minHeight } = style;
    const MIN_TOUCH_SIZE = 44; // iOS HIG recommendation

    const effectiveWidth = width || minWidth;
    const effectiveHeight = height || minHeight;

    if (element.props.onPress) {
      if (effectiveWidth && effectiveWidth < MIN_TOUCH_SIZE) {
        this.addIssue({
          severity: 'warning',
          type: 'small_touch_target',
          message: `Touch target width (${effectiveWidth}) below recommended minimum${context ? ` in ${context}` : ''}`,
          element,
          suggestion: `Increase width to at least ${MIN_TOUCH_SIZE}px`,
        });
      }

      if (effectiveHeight && effectiveHeight < MIN_TOUCH_SIZE) {
        this.addIssue({
          severity: 'warning',
          type: 'small_touch_target',
          message: `Touch target height (${effectiveHeight}) below recommended minimum${context ? ` in ${context}` : ''}`,
          element,
          suggestion: `Increase height to at least ${MIN_TOUCH_SIZE}px`,
        });
      }
    }
  }

  /**
   * Test color contrast (simplified check)
   */
  testColorContrast(element: any, context: string = ''): void {
    if (!element?.props?.style) return;

    const style = Array.isArray(element.props.style)
      ? Object.assign({}, ...element.props.style)
      : element.props.style;

    const { color, backgroundColor } = style;

    // This is a simplified check - real contrast checking would require color parsing
    if (color && backgroundColor) {
      const isSimilar = this.areColorsSimilar(color, backgroundColor);
      if (isSimilar) {
        this.addIssue({
          severity: 'error',
          type: 'poor_contrast',
          message: `Poor color contrast detected${context ? ` in ${context}` : ''}`,
          element,
          suggestion:
            'Ensure sufficient contrast ratio (at least 4.5:1 for normal text)',
        });
      }
    }
  }

  /**
   * Test if live regions are properly configured
   */
  testLiveRegions(element: any, context: string = ''): void {
    if (!element?.props) return;

    const { accessibilityLiveRegion, children } = element.props;

    if (accessibilityLiveRegion && !this.hasTextContent(children)) {
      this.addIssue({
        severity: 'warning',
        type: 'empty_live_region',
        message: `Live region has no text content${context ? ` in ${context}` : ''}`,
        element,
        suggestion: 'Ensure live regions contain text that can be announced',
      });
    }
  }

  /**
   * Test focus management
   */
  testFocusManagement(element: any, context: string = ''): void {
    if (!element?.props) return;

    const { accessible, accessibilityElementsHidden } = element.props;

    if (accessible === false && element.props.onPress) {
      this.addIssue({
        severity: 'warning',
        type: 'non_accessible_interactive',
        message: `Interactive element marked as not accessible${context ? ` in ${context}` : ''}`,
        element,
        suggestion:
          'Remove accessible={false} or provide alternative access method',
      });
    }

    if (accessibilityElementsHidden && this.hasInteractiveChildren(element)) {
      this.addIssue({
        severity: 'error',
        type: 'hidden_interactive_elements',
        message: `Interactive elements hidden from accessibility${context ? ` in ${context}` : ''}`,
        element,
        suggestion:
          'Remove accessibilityElementsHidden or restructure component',
      });
    }
  }

  /**
   * Run comprehensive accessibility audit
   */
  audit(componentTree: any, context: string = ''): AccessibilityReport {
    this.issues = [];
    this.auditElement(componentTree, context);

    const errors = this.issues.filter(
      (issue) => issue.severity === 'error'
    ).length;
    const warnings = this.issues.filter(
      (issue) => issue.severity === 'warning'
    ).length;
    const infos = this.issues.filter(
      (issue) => issue.severity === 'info'
    ).length;

    const score = Math.max(0, 100 - errors * 20 - warnings * 5 - infos * 1);

    return {
      passed: errors === 0 && warnings === 0,
      score,
      issues: this.issues,
      summary: {
        errors,
        warnings,
        infos,
      },
    };
  }

  /**
   * Generate accessibility checklist
   */
  generateChecklist(): string[] {
    return [
      '✓ All interactive elements have accessibility labels',
      '✓ Touch targets are at least 44x44 points',
      '✓ Color contrast meets WCAG guidelines (4.5:1)',
      '✓ Focus order is logical and predictable',
      '✓ Live regions announce important changes',
      '✓ Custom gestures have accessibility alternatives',
      '✓ Modal content is properly trapped',
      '✓ Dynamic content updates are announced',
      '✓ Error messages are clearly communicated',
      '✓ Form fields have associated labels',
      '✓ Images have meaningful alternative text',
      '✓ Video content has captions/transcripts',
    ];
  }

  private auditElement(element: any, context: string): void {
    if (!element || typeof element !== 'object') return;

    this.testAccessibilityLabel(element, context);
    this.testAccessibilityRole(element, context);
    this.testTouchTargetSize(element, context);
    this.testColorContrast(element, context);
    this.testLiveRegions(element, context);
    this.testFocusManagement(element, context);

    // Recursively audit children
    if (element.props?.children) {
      const children = Array.isArray(element.props.children)
        ? element.props.children
        : [element.props.children];

      children.forEach((child: any, index: number) => {
        this.auditElement(child, `${context}.child[${index}]`);
      });
    }
  }

  private addIssue(issue: AccessibilityIssue): void {
    this.issues.push(issue);
  }

  private hasTextContent(children: any): boolean {
    if (!children) return false;
    if (typeof children === 'string') return true;
    if (Array.isArray(children)) {
      return children.some((child) => this.hasTextContent(child));
    }
    if (children.props?.children) {
      return this.hasTextContent(children.props.children);
    }
    return false;
  }

  private hasInteractiveChildren(element: any): boolean {
    if (!element?.props?.children) return false;

    const checkInteractive = (child: any): boolean => {
      if (!child || typeof child !== 'object') return false;
      if (child.props?.onPress) return true;
      if (child.props?.children) {
        const children = Array.isArray(child.props.children)
          ? child.props.children
          : [child.props.children];
        return children.some(checkInteractive);
      }
      return false;
    };

    const children = Array.isArray(element.props.children)
      ? element.props.children
      : [element.props.children];

    return children.some(checkInteractive);
  }

  private areColorsSimilar(color1: string, color2: string): boolean {
    // Simplified color similarity check
    // In a real implementation, this would parse colors and calculate contrast ratio
    if (color1 === color2) return true;

    const lightColors = [
      '#FFFFFF',
      '#F0F0F0',
      '#E0E0E0',
      'white',
      'transparent',
    ];
    const darkColors = ['#000000', '#333333', '#666666', 'black'];

    const isLight1 = lightColors.some((c) => color1.includes(c));
    const isLight2 = lightColors.some((c) => color2.includes(c));
    const isDark1 = darkColors.some((c) => color1.includes(c));
    const isDark2 = darkColors.some((c) => color2.includes(c));

    return (isLight1 && isLight2) || (isDark1 && isDark2);
  }
}

/**
 * Accessibility Test Helpers
 */
export const AccessibilityTestHelpers = {
  /**
   * Mock VoiceOver being enabled for testing
   */
  mockVoiceOverEnabled: (enabled: boolean = true) => {
    jest
      .spyOn(AccessibilityInfo, 'isScreenReaderEnabled')
      .mockResolvedValue(enabled);
  },

  /**
   * Mock high contrast being enabled
   */
  mockHighContrastEnabled: (enabled: boolean = true) => {
    if (typeof AccessibilityInfo.isHighTextContrastEnabled === 'function') {
      jest
        .spyOn(AccessibilityInfo, 'isHighTextContrastEnabled')
        .mockResolvedValue(enabled);
    }
  },

  /**
   * Mock reduced motion being enabled
   */
  mockReducedMotionEnabled: (enabled: boolean = true) => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(enabled);
  },

  /**
   * Mock accessibility announcement
   */
  mockAccessibilityAnnouncement: () => {
    const announceForAccessibility = jest.fn();
    jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(announceForAccessibility);
    return announceForAccessibility;
  },

  /**
   * Create test element with accessibility props
   */
  createTestElement: (props: any = {}) => ({
    type: 'View',
    props: {
      accessible: true,
      accessibilityLabel: 'Test element',
      accessibilityRole: 'button',
      ...props,
    },
    children: props.children || null,
  }),

  /**
   * Assert accessibility compliance
   */
  assertAccessible: (element: any, context?: string) => {
    const testSuite = new AccessibilityTestSuite();
    const report = testSuite.audit(element, context);

    if (!report.passed) {
      const errorMessages = report.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('\n');

      throw new Error(`Accessibility violations found:\n${errorMessages}`);
    }

    return report;
  },
};

/**
 * Accessibility Performance Monitoring
 */
export class AccessibilityPerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();

  /**
   * Time accessibility operations
   */
  time(operation: string, fn: () => void): void {
    const start = performance.now();
    fn();
    const duration = performance.now() - start;

    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }

    this.metrics.get(operation)!.push(duration);
  }

  /**
   * Get performance statistics
   */
  getStats(
    operation: string
  ): { avg: number; min: number; max: number; count: number } | null {
    const times = this.metrics.get(operation);
    if (!times || times.length === 0) return null;

    return {
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      min: Math.min(...times),
      max: Math.max(...times),
      count: times.length,
    };
  }

  /**
   * Clear metrics
   */
  clear(): void {
    this.metrics.clear();
  }
}

/**
 * Accessibility Debug Utilities
 */
export const AccessibilityDebugUtils = {
  /**
   * Log accessibility tree structure
   */
  logAccessibilityTree: (element: any, depth: number = 0): void => {
    if (!element) return;

    const indent = '  '.repeat(depth);
    const { accessibilityLabel, accessibilityRole, accessible } =
      element.props || {};

    console.log(
      `${indent}${element.type || 'Unknown'} - ${accessibilityLabel || 'No label'} (${accessibilityRole || 'No role'}) ${accessible === false ? '[Hidden]' : ''}`
    );

    if (element.props?.children) {
      const children = Array.isArray(element.props.children)
        ? element.props.children
        : [element.props.children];

      children.forEach((child: any) => {
        if (child && typeof child === 'object') {
          AccessibilityDebugUtils.logAccessibilityTree(child, depth + 1);
        }
      });
    }
  },

  /**
   * Simulate screen reader navigation
   */
  simulateScreenReaderNavigation: (element: any): string[] => {
    const announcements: string[] = [];

    const traverse = (el: any) => {
      if (!el || typeof el !== 'object') return;

      const { accessibilityLabel, accessible, accessibilityElementsHidden } =
        el.props || {};

      if (
        accessible !== false &&
        !accessibilityElementsHidden &&
        accessibilityLabel
      ) {
        announcements.push(accessibilityLabel);
      }

      if (el.props?.children) {
        const children = Array.isArray(el.props.children)
          ? el.props.children
          : [el.props.children];

        children.forEach(traverse);
      }
    };

    traverse(element);
    return announcements;
  },
};

// Export singleton instance
export const accessibilityTestSuite = new AccessibilityTestSuite();
export const accessibilityPerformanceMonitor =
  new AccessibilityPerformanceMonitor();
