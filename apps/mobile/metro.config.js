// Metro config for the Expo monorepo.
//
// Two things matter:
//   1. `watchFolders` includes the workspace root so changes inside
//      `packages/*` are picked up by Fast Refresh.
//   2. `nodeModulesPaths` lists both the local and workspace node_modules so
//      pnpm-symlinked workspace packages (`@workspace/*`) resolve.
//   3. Hierarchical lookup remains enabled so Metro can follow pnpm's nested
//      package links for Expo/runtime transitive dependencies.
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

module.exports = config;
