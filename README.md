# react-native-dl-scan

iOS DL scanning library for React Native

## Installation

```sh
npm install react-native-dl-scan
```

## Usage

```js
import { scanLicense } from 'react-native-dl-scan';

// Basic usage
const result = await scanLicense();

if (result.success && result.data) {
  console.log('License scanned successfully:', result.data);
  console.log('Name:', result.data.firstName, result.data.lastName);
  console.log('License Number:', result.data.licenseNumber);
  console.log('Expiration:', result.data.expirationDate);
} else if (result.error) {
  console.error('Scan failed:', result.error.userMessage);
}
```

## TypeScript Support

This library includes TypeScript definitions for better development experience:

```typescript
import { scanLicense, LicenseData, ScanResult } from 'react-native-dl-scan';

const handleScan = async (): Promise<void> => {
  const result: ScanResult = await scanLicense();
  // TypeScript will provide full type checking and autocompletion
};
```


## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
