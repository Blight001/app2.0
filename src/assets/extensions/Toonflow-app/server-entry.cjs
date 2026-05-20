"use strict";

const path = require("node:path");
const { createRequire } = require("node:module");

const requireFromThisFile = createRequire(__filename);
const appRoot = path.dirname(__filename);

process.chdir(appRoot);

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "prod";
}

requireFromThisFile("./data/serve/app.js");
