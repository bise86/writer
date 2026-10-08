module.exports = {
  dependencies: {
    // Harmony forks are linked through HARs; never autolink their podspecs on iOS.
    '@react-native-oh-tpl/react-native-share': {
      platforms: {ios: null, android: null},
    },
    '@react-native-oh-tpl/react-native-pdf': {
      platforms: {ios: null, android: null},
    },
    '@react-native-oh-tpl/react-native-blob-util': {
      platforms: {ios: null, android: null},
    },
  },
};
