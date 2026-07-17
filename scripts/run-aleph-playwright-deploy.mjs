import { pathToFileURL } from 'node:url';
import { sanitizeAlephApiHosts } from '../e2e/remote/aleph-provider-contract.mjs';

const modulePath = process.env.LE_SPACE_NODE_MODULE_PATH;
if (!modulePath) throw new Error('LE_SPACE_NODE_MODULE_PATH is required.');
const hosts = sanitizeAlephApiHosts(process.env.ALEPH_VM_API_HOSTS);
process.env.ALEPH_VM_API_HOST = hosts[0];
process.env.ALEPH_VM_API_HOSTS = hosts.join(',');
const { runActionMode } = await import(pathToFileURL(modulePath));
await runActionMode(process.env);
