const net = require('net');

// TCP ping since ICMP requires root on Railway
async function checkPing(monitor) {
  const startTime = Date.now();
  const host = monitor.hostname || monitor.url;
  const port = 80; // Default to port 80 for TCP ping
  const timeout = (monitor.timeout_seconds || 30) * 1000;

  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      const responseTime = Date.now() - startTime;
      socket.destroy();
      resolve({ status: 'up', responseTime, statusCode: null, error: null });
    });

    socket.on('timeout', () => {
      socket.destroy();
      const responseTime = Date.now() - startTime;
      resolve({ status: 'down', responseTime, statusCode: null, error: 'Connection timeout' });
    });

    socket.on('error', (err) => {
      socket.destroy();
      const responseTime = Date.now() - startTime;
      resolve({ status: 'down', responseTime, statusCode: null, error: err.message });
    });

    socket.connect(port, host);
  });
}

module.exports = checkPing;
