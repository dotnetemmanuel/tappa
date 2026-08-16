import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Relative asset urls keep the build portable to a subpath, which is how
			// GitHub Pages serves it, and 404.html is what Pages falls back to.
			adapter: adapter({ fallback: '404.html' })
		})
	],
	test: {
		include: ['src/lib/core/**/*.test.ts', 'src/lib/io/**/*.test.ts'],
		environment: 'node'
	}
});
