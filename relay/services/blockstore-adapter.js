/**
 * Blockstore adapter to ensure compatibility with OrbitDB
 * 
 * PR #358 in js-stores introduced streaming blockstores, which can return
 * streams instead of Uint8Arrays. OrbitDB expects Uint8Arrays, so this
 * adapter wraps the blockstore and converts streams to Uint8Arrays.
 */

import all from 'it-all';

/**
 * Converts a stream or other format to Uint8Array
 * @param {any} result - The result to convert
 * @returns {Promise<Uint8Array>} The converted Uint8Array
 */
async function convertToUint8Array(result) {
	// Handle null/undefined
	if (result == null) {
		throw new Error('Blockstore returned null or undefined');
	}
	
	// If it's already a Uint8Array, return it
	if (result instanceof Uint8Array) {
		return result;
	}
	
	// If it's a stream, convert it to Uint8Array
	if (result && typeof result[Symbol.asyncIterator] === 'function') {
		const chunks = await all(result);
		if (chunks.length === 0) {
			throw new Error('Stream returned no chunks');
		}
		// Concatenate all chunks into a single Uint8Array
		const totalLength = chunks.reduce((sum, chunk) => {
			if (!chunk) return sum;
			if (chunk instanceof Uint8Array) return sum + chunk.length;
			if (chunk.buffer) return sum + chunk.byteLength;
			return sum;
		}, 0);
		
		if (totalLength === 0) {
			throw new Error('Stream chunks have no data');
		}
		
		const resultArray = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			if (!chunk) continue;
			if (chunk instanceof Uint8Array) {
				resultArray.set(chunk, offset);
				offset += chunk.length;
			} else if (chunk.buffer) {
				const chunkArray = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
				resultArray.set(chunkArray, offset);
				offset += chunk.byteLength;
			} else {
				const chunkArray = new Uint8Array(chunk);
				resultArray.set(chunkArray, offset);
				offset += chunkArray.length;
			}
		}
		return resultArray;
	}
	
	// If it's an array, convert to Uint8Array
	if (Array.isArray(result)) {
		return new Uint8Array(result);
	}
	
	// If it's a Buffer (Node.js), convert to Uint8Array
	if (result && result.buffer && result.buffer instanceof ArrayBuffer) {
		return new Uint8Array(result.buffer, result.byteOffset || 0, result.byteLength || result.buffer.byteLength);
	}
	
	// If it's an ArrayBuffer, convert to Uint8Array
	if (result instanceof ArrayBuffer) {
		return new Uint8Array(result);
	}
	
	// Fallback: try to convert to Uint8Array
	try {
		return new Uint8Array(result);
	} catch (error) {
		throw new Error(`Cannot convert blockstore result to Uint8Array: ${error.message}. Type: ${typeof result}, Value: ${result}`);
	}
}

/**
 * Creates a blockstore adapter that ensures get() always returns Uint8Array
 * @param {Object} blockstore - The underlying blockstore instance
 * @returns {Object} Adapted blockstore with Uint8Array guarantees
 */
export function createBlockstoreAdapter(blockstore) {
	// Use a Proxy to forward all methods while intercepting get() and getMany()
	return new Proxy(blockstore, {
		get(target, prop) {
			// Intercept get() method
			// Need to support both Promise (for direct await) and async iterable (for yield* and it-pipe)
			if (prop === 'get') {
				return function(cid, options) {
					const result = target.get(cid, options);
					
					// Create a wrapper that's both awaitable and async iterable
					// This is needed because OrbitDB uses it both ways:
					// 1. await blockstore.get(cid) - needs Promise-like
					// 2. for await (const block of blockstore.get(cid)) - needs async iterable
					// 3. it-pipe expects async iterable
					
					// Start consuming immediately to cache the value
					let cachedValue = null;
					let cachePromise = null;
					let generatorConsumed = false;
					
					const getValue = async () => {
						if (cachedValue !== null) {
							return cachedValue;
						}
						
						if (!cachePromise) {
							cachePromise = (async () => {
								let converted;
								if (result && typeof result[Symbol.asyncIterator] === 'function') {
									// It's a stream - collect all chunks and convert
									converted = await convertToUint8Array(result);
								} else {
									// It's a Promise - await and convert
									const block = await result;
									converted = await convertToUint8Array(block);
								}
								
								// Validate the result
								if (!(converted instanceof Uint8Array)) {
									throw new Error(`convertToUint8Array did not return a Uint8Array: ${typeof converted}`);
								}
								
								cachedValue = converted;
								return converted;
							})();
						}
						
						return cachePromise;
					};
					
					// Create async generator for iteration
					// This must be a proper async iterable for it-pipe to work
					async function* generator() {
						if (generatorConsumed && cachedValue !== null) {
							// If already consumed and cached, yield the cached value
							yield cachedValue;
							return;
						}
						
						generatorConsumed = true;
						const value = await getValue();
						yield value;
					}
					
					const gen = generator();
					
					// Make it awaitable (Promise-like) for direct await usage
					// This allows: await blockstore.get(cid) to work
					gen.then = function(onResolve, onReject) {
						return getValue().then(onResolve, onReject);
					};
					
					gen.catch = function(onReject) {
						return getValue().catch(onReject);
					};
					
					// Ensure it's recognized as an async iterable
					// The generator already has Symbol.asyncIterator, but we ensure it's properly set
					if (!gen[Symbol.asyncIterator]) {
						gen[Symbol.asyncIterator] = generator;
					}
					
					return gen;
				};
			}
			
			// Intercept getMany() method
			if (prop === 'getMany') {
				return async function*(cids) {
					for await (const { cid, block } of target.getMany(cids)) {
						const blockArray = await convertToUint8Array(block);
						yield { cid, block: blockArray };
					}
				};
			}
			
			// Forward all other properties/methods
			const value = target[prop];
			// If it's a function, bind it to the original target to preserve 'this'
			if (typeof value === 'function') {
				return value.bind(target);
			}
			return value;
		}
	});
}

