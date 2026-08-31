declare global {
	const __APP_VERSION__: string;
	const __BUILD_DATE__: string;
	const __APP_BRANCH__: string;
	const __COMMIT_SHA__: string;
	// null when Vite could not resolve the package at build time.
	const __ORBITDB_VERSION__: string | null;
	const __HELIA_VERSION__: string | null;
	const __LIBP2P_VERSION__: string | null;
	namespace App {}
}
export {};
