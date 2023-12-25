module.exports = {
	root: true,
	env: {
		browser: true,
		es6: true,
	},
	parserOptions: {
		ecmaVersion: 2020,
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
		files: ['.eslintrc.js'],
		env: {
			node: true,
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
