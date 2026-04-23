const axios = require('axios');
const db = require('../config/database');

async function getWebhookUrl(monitorId) {
  const { rows } = await db.query(
    `SELECT u.slack_webhook_url FROM users u
     JOIN websites w ON w.user_id = u.id
     JOIN monitors m ON m.website_id = w.id
     WHERE m.id = $1`,
    [monitorId]
  );
  return rows[0]?.slack_webhook_url;
}

async function sendSlackMessage(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    await axios.post(webhookUrl, payload, { timeout: 10000 });
  } catch (err) {
    console.error('Slack webhook error:', err.message);
  }
}

async function sendDownAlert(monitor, incident) {
  const webhookUrl = await getWebhookUrl(monitor.id);
  if (!webhookUrl) return;

  const target = monitor.url || `${monitor.hostname}:${monitor.port}` || monitor.name;

  await sendSlackMessage(webhookUrl, {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔴 Monitor Down', emoji: true }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Monitor:*\n${monitor.name}` },
          { type: 'mrkdwn', text: `*Type:*\n${monitor.type.toUpperCase()}` },
          { type: 'mrkdwn', text: `*Target:*\n${target}` },
          { type: 'mrkdwn', text: `*Error:*\n${incident.cause || 'Unknown'}` }
        ]
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Down since: ${new Date(incident.started_at).toISOString()}` }
        ]
      }
    ]
  });

  await db.query('UPDATE incidents SET alert_sent = true WHERE id = $1', [incident.id]);
}

async function sendRecoveryAlert(monitor) {
  const webhookUrl = await getWebhookUrl(monitor.id);
  if (!webhookUrl) return;

  const { rows: incidents } = await db.query(
    'SELECT * FROM incidents WHERE monitor_id = $1 ORDER BY started_at DESC LIMIT 1',
    [monitor.id]
  );
  const incident = incidents[0];
  if (!incident) return;

  const downtime = incident.resolved_at
    ? new Date(incident.resolved_at) - new Date(incident.started_at)
    : new Date() - new Date(incident.started_at);

  const durationMin = Math.round(downtime / 60000);
  const target = monitor.url || `${monitor.hostname}:${monitor.port}` || monitor.name;

  await sendSlackMessage(webhookUrl, {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🟢 Monitor Recovered', emoji: true }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Monitor:*\n${monitor.name}` },
          { type: 'mrkdwn', text: `*Target:*\n${target}` },
          { type: 'mrkdwn', text: `*Downtime:*\n${durationMin} minutes` },
          { type: 'mrkdwn', text: `*Status:*\nBack online` }
        ]
      }
    ]
  });

  if (incident) {
    await db.query('UPDATE incidents SET recovery_alert_sent = true WHERE id = $1', [incident.id]);
  }
}

async function sendTestAlert(webhookUrl) {
  await sendSlackMessage(webhookUrl, {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🧪 Test Alert', emoji: true }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'This is a test alert from your Uptime Monitor. If you see this, Slack alerts are working!' }
      }
    ]
  });
}

module.exports = { sendDownAlert, sendRecoveryAlert, sendTestAlert };
