// Application test harness.
//
// Importing ./db.js first is load-bearing: it sets the environment that
// config.js reads at import time, so the app comes up on an in-memory
// database rather than reaching for a real Postgres server.

import './db.js';

import request from 'supertest';

let cached = null;

/** Build the app once per test file. */
export async function getApp() {
  if (!cached) {
    const { createApp } = await import('../../app.js');
    cached = await createApp();
  }
  return cached;
}

/** A cookie-carrying agent, so sessions and CSRF tokens survive requests. */
export async function agent() {
  return request.agent(await getApp());
}

/**
 * Pull the CSRF token out of a rendered form.
 * Every state-changing POST needs one, so tests fetch a page first.
 */
export async function csrfFrom(client, path = '/account/login') {
  const res = await client.get(path);
  const match = res.text.match(/name="_csrf" value="([a-f0-9]{64})"/);
  if (!match) throw new Error(`No CSRF token found on ${path} (status ${res.status})`);
  return match[1];
}

/** Sign in an existing user and return the agent. */
export async function signIn(client, email, password) {
  const token = await csrfFrom(client, '/account/login');
  const res = await client
    .post('/account/login')
    .type('form')
    .send({ email, password, _csrf: token });
  return res;
}

export { request };
