import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = resolve(import.meta.dirname, '..');
const errors = [];
const forbiddenKeys = new Set([
  'accessToken',
  'anonKey',
  'apiKey',
  'databaseUrl',
  'dbUrl',
  'jwtSecret',
  'password',
  'refreshToken',
  'serviceRoleKey'
]);

const fail = (message) => errors.push(message);
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const exists = async (path) => access(path).then(() => true, () => false);
const relativePathPattern = /^(?:\.|[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)$/;
const projectRefPattern = /^[a-z]{20}$/;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function assertNoForbiddenKeys(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) fail(`${path}.${key}: secret-bearing keys are forbidden`);
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function assertContained(relativePath, label) {
  if (!relativePathPattern.test(relativePath)) {
    fail(`${label}: invalid relative path ${JSON.stringify(relativePath)}`);
    return null;
  }
  const candidate = resolve(root, relativePath);
  const rel = relative(root, candidate);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    fail(`${label}: path escapes repository root`);
    return null;
  }
  return candidate;
}

function requireFields(value, fields, label) {
  for (const field of fields) {
    if (!(field in value)) fail(`${label}: missing ${field}`);
  }
}

function normalizeContractJson(value) {
  if (Array.isArray(value)) return value.map(normalizeContractJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== '$id')
        .sort()
        .map((key) => [key, normalizeContractJson(value[key])]),
    );
  }
  return value;
}

function contractDigest(content, mode) {
  if (mode === 'raw') return createHash('sha256').update(content).digest('hex');
  if (mode === 'normalized-json-without-id') {
    const value = JSON.parse(content);
    return createHash('sha256').update(JSON.stringify(normalizeContractJson(value))).digest('hex');
  }
  fail(`shared-defs.lock.json: unsupported digest mode ${mode}`);
  return null;
}

const catalogPath = join(root, 'catalog.json');
const catalogSchema = await readJson(join(root, 'schemas/catalog.schema.json'));
const targetSchema = await readJson(join(root, 'schemas/project-target.schema.json'));
const contractLockSchema = await readJson(join(root, 'schemas/contract-lock.schema.json'));
const catalogSchemaValidator = new Ajv2020({ allErrors: true, strict: true });
const targetSchemaValidator = new Ajv2020({ allErrors: true, strict: true });
const contractLockSchemaValidator = new Ajv2020({ allErrors: true, strict: true });
addFormats(catalogSchemaValidator);
addFormats(targetSchemaValidator);
addFormats(contractLockSchemaValidator);
const validateCatalogSchema = catalogSchemaValidator.compile(catalogSchema);
const validateTargetSchema = targetSchemaValidator.compile(targetSchema);
const validateContractLockSchema = contractLockSchemaValidator.compile(contractLockSchema);
const contractLock = await readJson(join(root, 'shared-defs.lock.json')).catch((error) => {
  fail(`shared-defs.lock.json: ${error.message}`);
  return null;
});

if (contractLock) {
  if (!validateContractLockSchema(contractLock)) {
    for (const error of validateContractLockSchema.errors ?? []) {
      fail(`shared-defs.lock.json${error.instancePath}: ${error.message}`);
    }
  }
  assertNoForbiddenKeys(contractLock, 'shared-defs.lock.json');
  const requiredArtifacts = new Set([
    'supabase-defs/schemas/organization-catalog.schema.json',
    'supabase-defs/schemas/project-target.schema.json',
    'supabase-defs/schemas/contract-lock.schema.json',
  ]);
  const observedArtifacts = new Set(contractLock.artifacts?.map((artifact) => artifact.sourcePath) ?? []);
  for (const sourcePath of requiredArtifacts) {
    if (!observedArtifacts.has(sourcePath)) fail(`shared-defs.lock.json: missing ${sourcePath}`);
  }
  for (const artifact of contractLock.artifacts ?? []) {
    const localPath = assertContained(artifact.localPath, `shared-defs.lock.json.${artifact.sourcePath}`);
    if (!localPath || !(await exists(localPath))) {
      fail(`shared-defs.lock.json: missing local artifact ${artifact.localPath}`);
      continue;
    }
    const content = await readFile(localPath);
    const digest = contractDigest(content, artifact.digestMode);
    if (digest !== artifact.sha256) {
      fail(`shared-defs.lock.json: ${artifact.localPath} differs from pinned ${artifact.sourcePath}`);
    }
  }
}
const catalog = await readJson(catalogPath).catch((error) => {
  fail(`catalog.json: ${error.message}`);
  return null;
});

if (catalog) {
  if (!validateCatalogSchema(catalog)) {
    for (const error of validateCatalogSchema.errors ?? []) {
      fail(`catalog.json${error.instancePath}: ${error.message}`);
    }
  }
  assertNoForbiddenKeys(catalog);
  requireFields(catalog, ['version', 'github', 'supabaseOrganization', 'canonicalProjectRef', 'projects'], 'catalog.json');
  if (catalog.version !== 1) fail('catalog.json: version must be 1');
  if (!repoPattern.test(catalog.github?.repository ?? '')) fail('catalog.json: invalid GitHub repository');
  if (!projectRefPattern.test(catalog.supabaseOrganization?.id ?? '')) fail('catalog.json: invalid Supabase organization id');
  if (!Array.isArray(catalog.projects)) fail('catalog.json: projects must be an array');

  const refs = new Set();
  const workingDirectories = new Set();
  let canonicalCount = 0;

  for (const entry of catalog.projects ?? []) {
    if (!projectRefPattern.test(entry.ref ?? '')) fail(`catalog.json: invalid project ref ${entry.ref}`);
    if (refs.has(entry.ref)) fail(`catalog.json: duplicate project ref ${entry.ref}`);
    refs.add(entry.ref);

    const expectedTarget = `projects/${entry.ref}/target.json`;
    if (entry.target !== expectedTarget) fail(`${entry.ref}: target must be ${expectedTarget}`);
    const targetPath = assertContained(entry.target, `${entry.ref}.target`);
    if (!targetPath || !(await exists(targetPath))) {
      fail(`${entry.ref}: missing target file`);
      continue;
    }

    const target = await readJson(targetPath).catch((error) => {
      fail(`${entry.target}: ${error.message}`);
      return null;
    });
    if (!target) continue;
    if (!validateTargetSchema(target)) {
      for (const error of validateTargetSchema.errors ?? []) {
        fail(`${entry.target}${error.instancePath}: ${error.message}`);
      }
    }
    assertNoForbiddenKeys(target, entry.target);
    requireFields(target, ['version', 'githubOrganization', 'supabaseOrganization', 'project', 'contractSource', 'providerOverlay', 'gitIntegration', 'baseline', 'databaseAlignment', 'dependencies'], entry.target);

    if (target.version !== 1) fail(`${entry.target}: version must be 1`);
    if (target.githubOrganization !== catalog.github.organization) fail(`${entry.target}: GitHub organization differs from catalog`);
    if (target.supabaseOrganization?.id !== catalog.supabaseOrganization.id) fail(`${entry.target}: Supabase organization id differs from catalog`);
    if (target.project?.ref !== entry.ref) fail(`${entry.target}: project ref differs from catalog entry`);
    if (target.project?.canonical) canonicalCount += 1;

    const provider = target.providerOverlay ?? {};
    const expectedWorkingDirectory = `projects/${entry.ref}`;
    if (provider.repository !== catalog.github.repository) fail(`${entry.target}: provider repository differs from catalog`);
    if (provider.repository?.split('/')[0] !== catalog.github.organization) fail(`${entry.target}: provider repository must stay in the mapped GitHub organization`);
    if (provider.branch !== catalog.github.defaultBranch) fail(`${entry.target}: provider branch differs from catalog`);
    if (provider.workingDirectory !== expectedWorkingDirectory) fail(`${entry.target}: workingDirectory must be ${expectedWorkingDirectory}`);
    if (workingDirectories.has(provider.workingDirectory)) fail(`${entry.target}: duplicate workingDirectory`);
    workingDirectories.add(provider.workingDirectory);

    const expectedSupabase = `${expectedWorkingDirectory}/supabase`;
    if (provider.supabaseDirectory !== expectedSupabase) fail(`${entry.target}: invalid supabaseDirectory`);
    if (provider.migrationsDirectory !== `${expectedSupabase}/migrations`) fail(`${entry.target}: invalid migrationsDirectory`);
    if (provider.functionsDirectory !== `${expectedSupabase}/functions`) fail(`${entry.target}: invalid functionsDirectory`);
    if (provider.configPath !== `${expectedSupabase}/config.toml`) fail(`${entry.target}: invalid configPath`);

    for (const [label, path] of Object.entries({
      workingDirectory: provider.workingDirectory,
      supabaseDirectory: provider.supabaseDirectory,
      migrationsDirectory: provider.migrationsDirectory,
      functionsDirectory: provider.functionsDirectory,
      configPath: provider.configPath
    })) {
      const absolute = assertContained(path, `${entry.target}.${label}`);
      if (absolute && !(await exists(absolute))) fail(`${entry.target}: missing ${label} at ${path}`);
    }

    const configPath = assertContained(provider.configPath, `${entry.target}.configPath`);
    if (configPath && await exists(configPath)) {
      const config = await readFile(configPath, 'utf8');
      if (!new RegExp(`^project_id\\s*=\\s*"${entry.ref}"$`, 'm').test(config)) {
        fail(`${entry.target}: config.toml project_id must equal the hosted project ref`);
      }
      if (!/^auto_expose_new_tables\s*=\s*false$/m.test(config)) {
        fail(`${entry.target}: config.toml must require explicit Data API grants`);
      }
      if (/^enable_signup\s*=\s*true$/m.test(config)) {
        fail(`${entry.target}: config.toml must not bypass the shared-auth signup boundary`);
      }
    }

    const migrationDirectory = assertContained(provider.migrationsDirectory, `${entry.target}.migrationsDirectory`);
    const migrations = migrationDirectory && await exists(migrationDirectory)
      ? (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql'))
      : [];
    for (const name of migrations) {
      if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) fail(`${entry.target}: invalid migration filename ${name}`);
    }

    const integration = target.gitIntegration ?? {};
    const baseline = target.baseline ?? {};
    const contract = target.contractSource ?? {};
    if (integration.branchProtection?.state === 'verified' && integration.branchProtection.verifiedAt === null) {
      fail(`${entry.target}: verified branch protection requires verifiedAt`);
    }
    if (integration.providerReadback?.state === 'verified' && integration.providerReadback.verifiedAt === null) {
      fail(`${entry.target}: verified provider read-back requires verifiedAt`);
    }
    if (integration.state === 'connected') {
      if (integration.verifiedAt === null) fail(`${entry.target}: connected integration requires verifiedAt`);
      if (integration.branchProtection?.state !== 'verified') fail(`${entry.target}: connected integration requires verified branch protection`);
      if (integration.providerReadback?.state !== 'verified') fail(`${entry.target}: connected integration requires verified provider read-back`);
      if (baseline.state !== 'verified') fail(`${entry.target}: connected integration requires a verified baseline`);
      if (contract.state !== 'ready') fail(`${entry.target}: connected integration requires a ready contract source`);
      if (migrations.length === 0) fail(`${entry.target}: connected integration requires at least one migration`);
    }
    if (integration.deployToProduction) {
      if (integration.state !== 'connected') fail(`${entry.target}: production deploy requires connected state`);
      if (baseline.state !== 'verified') fail(`${entry.target}: production deploy requires verified baseline`);
    }
    if (baseline.state === 'verified') {
      for (const field of ['migrationHead', 'sourceCommit', 'verifiedAt']) {
        if (baseline[field] === null) fail(`${entry.target}: verified baseline requires ${field}`);
      }
    }
    if (contract.state === 'ready' && (contract.sqlDesiredState === null || contract.jsonSchemaDirectory === null)) {
      fail(`${entry.target}: ready contract source requires SQL desired state and JSON Schema directory`);
    }
    if (target.databaseAlignment?.relationship !== 'controlled-drift') fail(`${entry.target}: database relationship must be controlled-drift`);
    if (target.databaseAlignment?.convergence !== 'explicit-only') fail(`${entry.target}: convergence must be explicit-only`);
  }

  if (catalog.canonicalProjectRef === null) {
    if (catalog.projects.length !== 0) fail('catalog.json: projects exist but canonicalProjectRef is null');
  } else {
    if (!refs.has(catalog.canonicalProjectRef)) fail('catalog.json: canonicalProjectRef is not catalogued');
    if (canonicalCount !== 1) fail(`catalog.json: expected one canonical project, found ${canonicalCount}`);
  }
}

const suspiciousNames = [];
const secretFindings = [];
const secretPatterns = [
  ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{16,}/],
  ['JWT-like credential', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ['credential-bearing Postgres URL', /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/]
];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.temp') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      if (/^\.env(?:\.|$)/.test(entry.name) && entry.name !== '.env.example') suspiciousNames.push(relative(root, path));
      const content = await readFile(path, 'utf8').catch(() => null);
      if (content !== null) {
        for (const [label, pattern] of secretPatterns) {
          if (pattern.test(content)) secretFindings.push(`${relative(root, path)}: ${label}`);
        }
      }
    }
  }
}
await walk(root);
for (const path of suspiciousNames) fail(`${path}: plaintext environment files are forbidden`);
for (const finding of secretFindings) fail(`${finding} is forbidden`);

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`validated ${catalog?.projects?.length ?? 0} Supabase project target(s)`);
