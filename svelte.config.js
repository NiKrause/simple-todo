import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		prerender: {
			handleUnseenRoutes: 'ignore' // or 'fail' to fail on unseen routes
		}
	}
};

export default config;
