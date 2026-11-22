module.exports = {
	root: true,
	env: {
		browser: true,
		es6: true,
	},
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
	},
	extends: [
		'eslint:recommended',
		'plugin:react/recommended',
		'plugin:react-hooks/recommended',
	],
	settings: {
		react: {
			version: '18',
		},
	},
	overrides: [{
		files: ['.eslintrc.cjs', 'test/**/*.js'],
		env: {
			node: true,
		},
	}, {
		// page.evaluate() に渡す関数は拡張のページ内で動く
		files: ['test/e2e/**/*.js'],
		parserOptions: {
			ecmaVersion: 2022, // top-level await
		},
		globals: {
			chrome: 'readonly',
			React: 'readonly',
			ReactDOM: 'readonly',
		},
	}, {
		// <script type="module"> 以外で読み込まれるもの
		files: ['chrome-extension/background.js'],
		parserOptions: {
			sourceType: 'script',
		},
	}],
	rules: {
		quotes: ['warn', 'single', {
			avoidEscape: true,
		}],
		'comma-dangle': ['error', 'always-multiline'],
		semi: 'error',
		'no-var': 'error',
		'react/prop-types': 'off',
	},
};
