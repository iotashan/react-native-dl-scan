// Babel config for the example app.
//
// react-native-worklets/plugin must be LAST in the plugins array — it
// transforms 'worklet' marker strings into native worklet metadata, and
// any plugin that runs after it could rewrite those strings and break
// the worklet detection (final review reminder).

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
