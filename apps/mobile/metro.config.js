// Metro config for the Expo monorepo.
//
// Two things matter:
//   1. `watchFolders` includes the workspace root so changes inside
//      `packages/*` are picked up by Fast Refresh.
//   2. `nodeModulesPaths` lists both the local and the hoisted node_modules
//      so pnpm-symlinked workspace packages (`@workspace/*`) resolve.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
