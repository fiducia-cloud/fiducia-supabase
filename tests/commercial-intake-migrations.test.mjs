import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("catalog.json", root), "utf8"));
const expectedMigrations = [
  "20260902014500_commercial_intake_v1.sql",
  "20260902014600_commercial_intake_rpc_v1.sql",
];

const projects = await Promise.all(
  catalog.projects.map(async (entry) => {
    const target = JSON.parse(await readFile(new URL(entry.target, root), "utf8"));
    const directory = `${target.providerOverlay.migrationsDirectory}/`;
    const names = (await readdir(new URL(directory, root)))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const migrations = new Map(
      await Promise.all(
        names.map(async (name) => [
          name,
          await readFile(new URL(`${directory}${name}`, root), "utf8"),
        ]),
      ),
    );
    return { entry, target, names, migrations };
  }),
);

function normalizeSql(sql) {
  return sql
    .replace(/--.*$/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function baseMigration(project) {
  return project.migrations.get(expectedMigrations[0]);
}

function rpcMigration(project) {
  return project.migrations.get(expectedMigrations[1]);
}

test("every mapped project carries the same ordered commercial migrations", () => {
  assert.ok(projects.length >= 2, "commercial storage must cover every mapped provider target");
  for (const project of projects) {
    assert.deepEqual(project.names, expectedMigrations, project.entry.ref);
  }
});

test("provider copies are semantically identical after comments and whitespace", () => {
  for (const name of expectedMigrations) {
    const canonical = normalizeSql(projects[0].migrations.get(name));
    for (const project of projects.slice(1)) {
      assert.equal(
        normalizeSql(project.migrations.get(name)),
        canonical,
        `${project.entry.ref}:${name}`,
      );
    }
  }
});

test("submission table accepts only the three versioned commercial intake kinds", () => {
  for (const project of projects) {
    const sql = baseMigration(project);
    assert.match(sql, /create table fiducia\.commercial_intake_submissions/iu);
    for (const kind of ["quote", "pre_interest_registration", "enterprise_application"]) {
      assert.match(sql, new RegExp(`'${kind}'`, "u"), `${project.entry.ref}:${kind}`);
    }
    assert.doesNotMatch(sql, /kind\s+text[^;]*\bother\b/iu);
    assert.match(sql, /contract_version\s+text\s+not null\s+default\s+'commercial-intake-v1'/iu);
    assert.match(sql, /check\s*\(contract_version\s*=\s*'commercial-intake-v1'\)/iu);
  }
});

test("requests, responses, and contact identities are stored as bounded digests or JSON objects", () => {
  for (const project of projects) {
    const sql = baseMigration(project);
    for (const column of ["request_sha256", "response_sha256", "contact_email_sha256"]) {
      assert.match(
        sql,
        new RegExp(`${column}\\s+text\\s+not null\\s+check\\s*\\(${column}\\s*~\\s*'\\^\\[0-9a-f\\]\\{64\\}\\$'\\)`, "iu"),
        `${project.entry.ref}:${column}`,
      );
    }
    assert.match(sql, /request_payload\s+jsonb\s+not null\s+check\s*\(jsonb_typeof\(request_payload\)\s*=\s*'object'\)/iu);
    assert.match(sql, /response_payload\s+jsonb\s+not null\s+check\s*\(jsonb_typeof\(response_payload\)\s*=\s*'object'\)/iu);
    assert.match(sql, /retention_expires_at[\s\S]*interval\s+'730 days'/iu);
  }
});

test("enterprise submissions require authority and privacy acceptance is never nullable", () => {
  for (const project of projects) {
    const sql = baseMigration(project);
    assert.match(sql, /privacy_notice_accepted\s+boolean\s+not null/iu);
    assert.match(sql, /submitter_authorized\s+boolean\s+not null\s+default\s+false/iu);
    assert.match(
      sql,
      /kind\s*<>\s*'enterprise_application'\s+or\s+submitter_authorized/iu,
    );
  }
});

test("commercial submissions are append-only with forced row-level security", () => {
  for (const project of projects) {
    const sql = baseMigration(project);
    assert.match(sql, /before\s+update\s+or\s+delete\s+on\s+fiducia\.commercial_intake_submissions/iu);
    assert.match(sql, /raise exception\s+'commercial intake submissions are append-only'/iu);
    assert.match(sql, /enable row level security/iu);
    assert.match(sql, /force row level security/iu);
    assert.doesNotMatch(sql, /create\s+policy/iu);
  }
});

test("browser roles receive no table privileges and the service role cannot mutate rows", () => {
  for (const project of projects) {
    const sql = baseMigration(project);
    assert.match(sql, /revoke all on fiducia\.commercial_intake_submissions from public/iu);
    assert.match(sql, /revoke all on fiducia\.commercial_intake_submissions from anon/iu);
    assert.match(sql, /revoke all on fiducia\.commercial_intake_submissions from authenticated/iu);
    assert.match(sql, /grant select, insert on fiducia\.commercial_intake_submissions to service_role/iu);
    assert.doesNotMatch(sql, /grant\s+(?:update|delete|all)[^;]*to\s+service_role/iu);
  }
});

test("the submission RPC is security-definer code with a fixed search path", () => {
  for (const project of projects) {
    const sql = rpcMigration(project);
    assert.match(sql, /create or replace function public\.fiducia_submit_commercial_intake_v1/iu);
    assert.match(sql, /language\s+plpgsql\s+security\s+definer/iu);
    assert.match(sql, /set\s+search_path\s*=\s*pg_catalog,\s*fiducia/iu);
    assert.doesNotMatch(sql, /set\s+search_path\s*=\s*public/iu);
  }
});

test("idempotent replay returns the original result and rejects key reuse with a changed request", () => {
  for (const project of projects) {
    const sql = rpcMigration(project);
    assert.match(sql, /on conflict\s*\(kind,\s*idempotency_key\)\s+do nothing/iu);
    assert.match(sql, /stored\.request_sha256\s*<>\s*p_request_sha256/iu);
    assert.match(sql, /errcode\s*=\s*'23505'/iu);
    assert.match(sql, /'idempotent_replay',\s*not inserted/iu);
    assert.match(sql, /'response_payload',\s*stored\.response_payload/iu);
  }
});

test("only the service role may execute the public submission RPC", () => {
  for (const project of projects) {
    const sql = rpcMigration(project);
    assert.match(sql, /revoke all on function public\.fiducia_submit_commercial_intake_v1[\s\S]*from public/iu);
    assert.match(sql, /revoke all on function public\.fiducia_submit_commercial_intake_v1[\s\S]*from anon/iu);
    assert.match(sql, /revoke all on function public\.fiducia_submit_commercial_intake_v1[\s\S]*from authenticated/iu);
    assert.match(sql, /grant execute on function public\.fiducia_submit_commercial_intake_v1[\s\S]*to service_role/iu);
    assert.doesNotMatch(sql, /grant execute[\s\S]*to\s+(?:public|anon|authenticated)/iu);
  }
});

test("the ledger schema contains no credential-bearing columns", () => {
  const forbidden = new Set([
    "access_token",
    "api_key",
    "client_secret",
    "connection_string",
    "database_url",
    "password",
    "private_key",
    "refresh_token",
    "service_role_key",
  ]);
  for (const project of projects) {
    const sql = baseMigration(project);
    const table = sql.match(
      /create table fiducia\.commercial_intake_submissions\s*\(([\s\S]*?)\n\);/iu,
    );
    assert.ok(table, `${project.entry.ref}: table body missing`);
    const columns = [...table[1].matchAll(/^\s{4}([a-z][a-z0-9_]*)\s+(?:uuid|text|jsonb|boolean|timestamptz)\b/gmu)]
      .map((match) => match[1]);
    assert.ok(columns.length >= 15, `${project.entry.ref}: column parser drifted`);
    assert.deepEqual(columns.filter((column) => forbidden.has(column)), []);
  }
});

test("production migration deployment remains disabled until hosted verification", () => {
  for (const project of projects) {
    assert.equal(project.target.gitIntegration.deployToProduction, false, project.entry.ref);
    assert.notEqual(project.target.baseline.state, "verified", project.entry.ref);
  }
});
