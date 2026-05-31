-- Logiks AppServer — MySQL bootstrap
-- Runs once on first container start via the official mysql image's
-- /docker-entrypoint-initdb.d/ hook. Creates the two databases Logiks needs
-- (appdb for operational data, logdb for audit/security logs) and grants
-- the application user access to both.
--
-- The application user is created by the mysql image from MYSQL_USER /
-- MYSQL_PASSWORD env vars; we just add the database privileges here.

CREATE DATABASE IF NOT EXISTS appdb
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS logdb
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON appdb.* TO 'logiks'@'%';
GRANT ALL PRIVILEGES ON logdb.* TO 'logiks'@'%';

FLUSH PRIVILEGES;
