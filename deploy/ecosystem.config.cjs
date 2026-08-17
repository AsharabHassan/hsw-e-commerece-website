// PM2 process definition.
//
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save
//   pm2 startup systemd     # then run the command it prints
//
// This file MUST keep the .cjs extension. package.json sets "type": "module",
// so a .js file here would be loaded as an ES module and `module.exports`
// would be undefined. PM2 requires the config as CommonJS.

module.exports = {
  apps: [
    {
      name: 'hsw',
      script: 'server.js',
      cwd: '/srv/hsw',

      // One instance. This shop's session store and rate limiter are
      // per-process; cluster mode would give each worker its own rate-limit
      // counter and is not worth the complexity at this scale. A single Node
      // process handles far more traffic than a supplement shop will see.
      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
      },

      // The app reads the rest of its configuration from /srv/hsw/.env via
      // dotenv, so secrets live in one file with 600 permissions rather than
      // in the process list.

      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',

      // Restart if the process leaks past this. Under normal load it sits far
      // below; scrypt hashing is the only memory spike, and it is bounded.
      max_memory_restart: '400M',

      // server.js closes the HTTP server and the database pool on SIGINT and
      // SIGTERM, so in-flight requests finish rather than being cut off.
      kill_timeout: 10000,
      listen_timeout: 10000,
      wait_ready: false,

      error_file: '/var/log/hsw/error.log',
      out_file: '/var/log/hsw/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
