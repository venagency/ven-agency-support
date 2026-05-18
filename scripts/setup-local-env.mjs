#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wpOverridePath = path.join(rootDir, '.wp-env.override.json');
const workerVarsPath = path.join(rootDir, 'cloudflare/ven-support-task-gateway/.dev.vars');

const defaultSiteId = 'local-ven-agency-support';
const defaultWordPressUrl = 'http://localhost:8896';
const previousDefaultGatewayUrl = 'http://host.docker.internal:8787';
const defaultGatewayUrl = 'http://host.docker.internal:8796';
const previousDefaultIntro = 'Ask Ven for help or create a support task.';
const defaultIntro = 'Ask Ven for help with this website.';

function localValue(name, fallback) {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

async function readText(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ('ENOENT' === error.code) {
      return '';
    }

    throw error;
  }
}

async function readJson(filePath) {
  const text = await readText(filePath);
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path.relative(rootDir, filePath)} is not valid JSON: ${error.message}`);
  }
}

function stripDotenvQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function readDotenvValue(contents, key) {
  const prefix = `${key}=`;
  const line = contents
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith(prefix));

  return line ? stripDotenvQuotes(line.trim().slice(prefix.length)) : '';
}

function upsertDotenvValue(contents, key, value) {
  const prefix = `${key}=`;
  const lines = contents ? contents.split(/\r?\n/) : [];
  const nextLine = `${key}=${value}`;
  let replaced = false;

  const next = lines.map((line) => {
    if (line.trim().startsWith(prefix)) {
      replaced = true;
      return nextLine;
    }

    return line;
  });

  if (!replaced) {
    if (next.length && '' !== next[next.length - 1]) {
      next.push('');
    }
    next.push(nextLine);
  }

  return `${next.join('\n').replace(/\n+$/, '')}\n`;
}

function parseAuthorizedSites(contents) {
  const value = readDotenvValue(contents, 'AUTHORIZED_SITES');
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && 'object' === typeof parsed && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`cloudflare/ven-support-task-gateway/.dev.vars has invalid AUTHORIZED_SITES JSON: ${error.message}`);
  }
}

async function main() {
  const wpOverride = await readJson(wpOverridePath);
  const workerVars = await readText(workerVarsPath);
  const authorizedSites = parseAuthorizedSites(workerVars);

  const existingConfig = wpOverride.config && 'object' === typeof wpOverride.config ? wpOverride.config : {};
  const siteId = localValue('VEN_SUPPORT_LOCAL_SITE_ID', existingConfig.VEN_SUPPORT_SITE_ID || defaultSiteId);
  const wordpressUrl = localValue('VEN_SUPPORT_LOCAL_WORDPRESS_URL', defaultWordPressUrl);
  const existingGatewayUrl = existingConfig.VEN_SUPPORT_GATEWAY_URL && existingConfig.VEN_SUPPORT_GATEWAY_URL !== previousDefaultGatewayUrl
    ? existingConfig.VEN_SUPPORT_GATEWAY_URL
    : defaultGatewayUrl;
  const gatewayUrl = localValue('VEN_SUPPORT_LOCAL_GATEWAY_URL', existingGatewayUrl);
  const existingSite = authorizedSites[siteId] && 'object' === typeof authorizedSites[siteId] ? authorizedSites[siteId] : {};
  const allowedOrigins = Array.isArray(existingSite.allowedOrigins) && existingSite.allowedOrigins.length
    ? [...existingSite.allowedOrigins]
    : [];
  const siteSecret = localValue(
    'VEN_SUPPORT_SITE_SECRET',
    existingConfig.VEN_SUPPORT_SITE_SECRET || existingSite.secret || randomBytes(32).toString('hex')
  );
  if (!allowedOrigins.includes(wordpressUrl)) {
    allowedOrigins.push(wordpressUrl);
  }

  const nextWpOverride = {
    ...wpOverride,
    config: {
      ...existingConfig,
      VEN_SUPPORT_GATEWAY_URL: gatewayUrl,
      VEN_SUPPORT_SITE_ID: siteId,
      VEN_SUPPORT_SITE_SECRET: siteSecret,
    },
  };

  authorizedSites[siteId] = {
    ...existingSite,
    enabled: false === existingSite.enabled ? false : true,
    chatEnabled: false === existingSite.chatEnabled ? false : true,
    ticketsEnabled: false === existingSite.ticketsEnabled ? false : true,
    secret: siteSecret,
    allowedOrigins,
    title: existingSite.title || 'Ven Support',
    intro: existingSite.intro && existingSite.intro !== previousDefaultIntro ? existingSite.intro : defaultIntro,
    chatPlaceholder: existingSite.chatPlaceholder || 'Ask about this website...',
  };

  await mkdir(path.dirname(workerVarsPath), { recursive: true });
  await writeFile(wpOverridePath, `${JSON.stringify(nextWpOverride, null, 2)}\n`);
  await writeFile(
    workerVarsPath,
    upsertDotenvValue(workerVars, 'AUTHORIZED_SITES', JSON.stringify(authorizedSites))
  );

  console.log('Local WordPress override and Worker dev vars are ready.');
  console.log(`Site ID: ${siteId}`);
  console.log(`WordPress URL: ${wordpressUrl}`);
  console.log(`WordPress gateway URL: ${gatewayUrl}`);
  console.log('Generated or reused the local shared secret in ignored files.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
