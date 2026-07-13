export const DEFAULT_TODO_DATABASE_NAME = 'simple-todos';

/**
 * The main app intentionally gives every browser identity access to the
 * same default database. Identity-specific databases belong to collab01.
 */
export function getDefaultTodoDatabaseName() {
	return DEFAULT_TODO_DATABASE_NAME;
}
