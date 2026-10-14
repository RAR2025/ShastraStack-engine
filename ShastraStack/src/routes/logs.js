const express = require('express');
const ctrl = require('../controllers/logsController');

const router = express.Router();

router.get('/', ctrl.list);
router.get('/:executionId', ctrl.trace);

module.exports = router;
