// master/routes/jobs.js
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// Must be before /:id to avoid route conflict
router.get('/meta/stats',   (_req, res) => res.json(db.getStats()));
router.get('/meta/queues',  (_req, res) => res.json(db.getJobsByQueue()));
router.get('/meta/workers', (_req, res) => res.json(db.getAllWorkers()));

// GET all jobs
router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(db.getAllJobs(limit));
});

// GET jobs filtered by queue level e.g. /api/jobs/by-queue/1
router.get('/by-queue/:queueLevel', (req, res) => {
  const q    = parseInt(req.params.queueLevel);
  const jobs = db.getAllJobs(200).filter(j => j.effective_queue === q);
  res.json(jobs);
});

// GET single job
router.get('/:id', (req, res) => {
  const job = db.getJob(parseInt(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// POST cancel a pending job
router.post('/:id/cancel', (req, res) => {
  const job = db.getJob(parseInt(req.params.id));
  if (!job)                   return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'PENDING') return res.status(400).json({ error: 'Can only cancel PENDING jobs' });
  res.json(db.updateJobStatus(job.id, 'CANCELLED'));
});

module.exports = router;
