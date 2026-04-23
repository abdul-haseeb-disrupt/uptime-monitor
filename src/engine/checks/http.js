const axios = require('axios');

async function checkHttp(monitor) {
  const startTime = Date.now();

  try {
    const response = await axios({
      method: monitor.http_method || 'GET',
      url: monitor.url,
      timeout: (monitor.timeout_seconds || 30) * 1000,
      validateStatus: () => true, // Don't throw on any status
      maxRedirects: 5,
      headers: {
        'User-Agent': 'UptimeMonitor/1.0'
      }
    });

    const responseTime = Date.now() - startTime;
    const expectedCodes = monitor.expected_status_codes || [200, 201, 301, 302];
    const isUp = expectedCodes.includes(response.status);

    // Keyword check
    if (isUp && monitor.type === 'keyword' && monitor.keyword) {
      const bodyText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const keywordFound = bodyText.includes(monitor.keyword);

      if (monitor.keyword_type === 'exists' && !keywordFound) {
        return { status: 'down', responseTime, statusCode: response.status, error: `Keyword "${monitor.keyword}" not found` };
      }
      if (monitor.keyword_type === 'not_exists' && keywordFound) {
        return { status: 'down', responseTime, statusCode: response.status, error: `Keyword "${monitor.keyword}" was found (should not exist)` };
      }
    }

    return {
      status: isUp ? 'up' : 'down',
      responseTime,
      statusCode: response.status,
      error: isUp ? null : `Unexpected status code: ${response.status}`
    };
  } catch (err) {
    const responseTime = Date.now() - startTime;
    let error = err.message;

    if (err.code === 'ECONNABORTED') error = 'Request timeout';
    else if (err.code === 'ENOTFOUND') error = 'DNS resolution failed';
    else if (err.code === 'ECONNREFUSED') error = 'Connection refused';
    else if (err.code === 'ECONNRESET') error = 'Connection reset';

    return { status: 'down', responseTime, statusCode: null, error };
  }
}

module.exports = checkHttp;
