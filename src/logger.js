const Logger = require('pizza-logger')
const config = require("./config");


const logger = new Logger(config.logging.source);

async function databaseLogger(connection, sql, params) {
    logger.dbLogger(sql);
    const [results] = await connection.execute(sql, params);
    sendLogToGrafana(results);
}