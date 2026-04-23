const net = require('net');

async function checkPort(monitor) {
  const startTime = Date.now();
  const host = monitor.hostname;
  const port = monitor.port;
  const timeout = (monitor.timeout_seconds || 30) * 1000;

  if (!host || !port) {
    return { status: 'down', responseTime: 0, statusCode: null, error: 'Hostname and port required' };
  }

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
      resolve({ status: 'down', responseTime, statusCode: null, error: `Port ${port} timeout` });
    });

    socket.on('error', (err) => {
      socket.destroy();
      const responseTime = Date.now() - startTime;
      resolve({ status: 'down', responseTime, statusCode: null, error: `Port ${port}: ${err.message}` });
    });

    socket.connect(port, host);
  });
}

module.exports = checkPort;
