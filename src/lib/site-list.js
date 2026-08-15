import { createPrivateTodoList, addTodo } from './db-actions.js';
import { SITE_TODOS } from './site-todos.js';

/**
 * The chapter's worked example: a site manager's list, ready to hand over.
 *
 * Ten items covering the excavation pit and basement of a new single-family
 * house, in the order the work actually happens. They exist so the chapter can
 * be demonstrated without typing ten lines on a phone at a building site, which
 * is exactly where nobody wants to be typing.
 *
 * The strings live in `site-todos.js` so a test can import them without
 * importing the app — see the note there.
 */
export { SITE_TODOS };

/**
 * Create an owner-only list and fill it with the ten items.
 *
 * Sequential rather than concurrent: these go into one OrbitDB log and the
 * order on screen is the order of the work, which a `Promise.all` would
 * scramble.
 *
 * @param {string} [name]
 * @returns {Promise<{ address: string, name: string, count: number }>}
 */
export async function createSiteList(name = 'Baugrube und Keller') {
	const list = await createPrivateTodoList(name);

	let count = 0;
	for (const text of SITE_TODOS) {
		const result = await addTodo(text);
		// `addTodo` reports failure by return value rather than throwing. Counting
		// what actually landed means the caller can say "7 of 10" instead of
		// claiming ten and showing seven.
		if (result?.ok !== false) count += 1;
	}

	return { ...list, count };
}
