//Picks and registers a driver instance per dbkey, based on CONFIG.databases'
//per-entry `driver` field. Mirrors api/controllers/queue/QueueManager.js.

const MySQLDriver = require("./drivers/MySQLDriver");
const PgSQLDriver = require("./drivers/PgSQLDriver");
const MSSQLDriver = require("./drivers/MSSQLDriver");
const MongoDBDriver = require("./drivers/MongoDBDriver");
const DuckDBDriver = require("./drivers/DuckDBDriver");
const DynamoDBDriver = require("./drivers/DynamoDBDriver");

//driver id (CONFIG.databases[key].driver) -> driver class.
const DRIVER_MAP = {
	mysql: MySQLDriver,
	mariadb: MySQLDriver, //MySQL wire-protocol compatible
	pgsql: PgSQLDriver,
	postgres: PgSQLDriver,
	postgresql: PgSQLDriver,
	cockroachdb: PgSQLDriver, //Postgres wire-protocol compatible
	cockroach: PgSQLDriver,
	crdb: PgSQLDriver,
	mssql: MSSQLDriver,
	mongodb: MongoDBDriver,
	mongo: MongoDBDriver,
	duckdb: DuckDBDriver,
	dynamodb: DynamoDBDriver,
	dynamo: DynamoDBDriver,
};

class DBManager {

	constructor() {
		this.drivers = {};
	}

	//Synchronous by design - see DBDriver.connect() for why.
	initialize() {
		const section = CONFIG.databases;
		if (!section) return;

		_.each(section, (conf, keyid) => {
			if (!conf.enable) return;

			const driverId = (conf.driver || "mysql").toLowerCase();
			const DriverClass = DRIVER_MAP[driverId];

			if (!DriverClass) {
				console.log("\x1b[31m%s\x1b[0m", `DATABASE Unknown driver "${conf.driver}" for dbkey "${keyid}"`);
				return;
			}

			delete conf.enable;
			delete conf.driver;
			delete conf.keyid;

			const driver = new DriverClass(keyid, conf);
			driver.connect();

			this.drivers[keyid] = driver;
		});
	}

	getDriver(dbkey) {
		return this.drivers[dbkey] || null;
	}
}

module.exports = new DBManager();
