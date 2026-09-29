// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
// `title` and `sidebar` are filled in by the migration engine (convert.mjs).
export default defineConfig({
	integrations: [
		starlight({
			title: '__SITE_TITLE__',
			sidebar: [
			],
		}),
	],
});
