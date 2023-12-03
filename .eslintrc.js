module.exports = {
	root: true,
	env: {
		browser: true,
		es6: true,
	},
	plugins: [
		'html',
	],
	parserOptions: {
		ecmaVersion: 2020,
	},
	extends: [
		'eslint:recommended',
		'plugin:react-hooks/recommended',
	],
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
	},
};
