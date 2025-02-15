/**
 * @module dev_server
 * @desc The Development initializer of `main.js` as well as managing the startup of a locally created Docker SQL
 * Server. This uses pg-test to set up a database hosted on local Docker. Migrating all data as needed,
 * to allow the real server feel, without having access or the risk of the production database. But otherwise runs
 * the backend API server as normal.
 */

/**
 * This is the recommended and only way to mock how Jest would use the module.
 */
const dbSetup = require("../node_modules/@databases/pg-test/jest/globalSetup");
const dbTeardown = require("../node_modules/@databases/pg-test/jest/globalTeardown");

async function test() {
  await dbSetup();

  // lets take the value made by the test runner database, and put it where the api server expects.
  let db_url = process.env.DATABASE_URL;
  // this gives us something like postgres://test-user@localhost:5432/test-db
  // We then need to map these values to where the API server expects,
  let db_url_reg = /postgres:\/\/([\/\S]+)@([\/\S]+):(\d+)\/([\/\S]+)/;
  let db_url_parsed = db_url_reg.exec(db_url);

  // set the parsed URL as proper env
  process.env.DB_HOST = db_url_parsed[2];
  process.env.DB_USER = db_url_parsed[1];
  process.env.DB_DB = db_url_parsed[4];
  process.env.DB_PORT = db_url_parsed[3];

  // Then since we want to make sure we don't initialize the config module, before we have set our values,
  // we will define our own port to use here.
  process.env.PORT = 8080;

  const app = require("./main.js");
  const logger = require("./logger.js");
  const database = require("./database.js");
  // We can only require these items after we have set our env variables

  logger.warningLog(
    "Pulsar Server is in Development Mode with a Local Database!"
  );

  const serve = app.listen(process.env.PORT, () => {
    logger.infoLog(`Pulsar Server Listening on port ${process.env.PORT}`);
  });

  process.on("SIGTERM", async () => {
    await localExterminate("SIGTERM", serve, database);
  });

  process.on("SIGINT", async () => {
    await localExterminate("SIGINT", serve, database);
  });
}

/**
 * @async
 * @function localExterminate
 * @desc Similar to `server.js` exterminate(), except used for the `dev_server.js` instance.
 * @param {string} callee - Simply a way to better log what called the server to shutdown.
 * @param {object} serve - The instance of the ExpressJS `app` that has started listening and can be called to shutdown.
 * @param {object} db - The instance of the `database.js` module, used to properly close its connections during a
 * graceful shutdown.
 */
async function localExterminate(callee, serve, db) {
  console.log(`${callee} signal received: closing HTTP server.`);
  await db.shutdownSQL();
  await dbTeardown();
  console.log("Exiting...");
  serve.close(() => {
    console.log("HTTP Server Closed.");
  });
}

test();
