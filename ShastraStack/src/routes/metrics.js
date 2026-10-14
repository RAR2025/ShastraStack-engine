const express = require('express');
const ctrl = require('../controllers/metricsController');

const router = express.Router();

router.get('/summary', ctrl.summary);
router.get('/executions', ctrl.executions);

module.exports = router;
