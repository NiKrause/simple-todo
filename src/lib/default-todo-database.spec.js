import { describe, expect, it } from 'vitest';
import { getDefaultTodoDatabaseName } from './default-todo-database.js';

describe('getDefaultTodoDatabaseName', () => {
	it('uses one shared database name for every main tutorial browser', () => {
		expect(getDefaultTodoDatabaseName()).toBe('simple-todos');
	});
});
