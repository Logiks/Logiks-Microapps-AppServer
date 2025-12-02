module.exports = {
  apps : [{
    name: 'Logiks_MicroAppServer',
    script: 'index.js',
    instances : '1',
    watch: ["public/*", "api/*"],
    max_memory_restart: '1024M',
    exec_mode : "cluster",
    env: {
        "NODE_ENV": "production"
    }
  }]
};
