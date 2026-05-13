// master/routes/events.js
const express = require('express');
const router  = express.Router();
const clients = new Set();

router.get('/', (req, res) => {
  res.setHeader('Content-Type',                'text/event-stream');
  res.setHeader('Cache-Control',               'no-cache');
  res.setHeader('Connection',                  'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const { getAllJobs, getAllWorkers, getStats } = require('../db');

  res.write(`data: ${JSON.stringify({
    type:    'INIT',
    jobs:    getAllJobs(30),
    workers: getAllWorkers(),
    stats:   getStats(),
  })}\n\n`);

  clients.add(res);
  console.log(`[SSE] Client connected (total: ${clients.size})`);

  const heartbeat = setInterval(() => {
    try { res.write(':ping\n\n'); } catch { clearInterval(heartbeat); clients.delete(res); }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    console.log(`[SSE] Client disconnected (total: ${clients.size})`);
  });
});

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch { clients.delete(client); }
  }
}

module.exports        = router;
module.exports.broadcast = broadcast;
