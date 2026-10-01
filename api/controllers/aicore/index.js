//AI Engine factory for AICore.
//Turns a normalized list of engine configs into instantiated engine
//adapters, ordered by priority (lowest number first) for resilience.js's
//fallback chain. Each `driver` maps 1:1 to a file in ./engines/.

const DRIVERS = {
    logiksai: "./engines/logiksai.js",
    openai: "./engines/openai.js",
    claude: "./engines/claude.js"
};

//engineConfigs: [{ key, driver, priority, config }]
//returns: [{ key, priority, instance }] sorted by priority ascending
function createEngines(engineConfigs = []) {
    const engines = [];

    for (const entry of engineConfigs) {
        const driverPath = DRIVERS[entry.driver];
        if (!driverPath) {
            console.log("\x1b[31m%s\x1b[0m", `AICore: unknown engine driver '${entry.driver}' for engine '${entry.key}' - skipping`);
            continue;
        }

        const EngineClass = require(driverPath);
        engines.push({
            key: entry.key,
            priority: entry.priority != null ? entry.priority : 100,
            instance: new EngineClass(entry.config || {})
        });
    }

    engines.sort((a, b) => a.priority - b.priority);
    return engines;
}

module.exports = { createEngines, DRIVERS };
