module.exports = {
  apps: [{
    name: "sapply-klm",
    script: "start.sh",
    interpreter: "/bin/bash",
    max_memory_restart: "400M",
    env: {
      NODE_ENV: "production"
    }
  }]
};
