const express = require('express');
const ctrl = require('../controllers/patchesController');

const router = express.Router();

router.get('/', ctrl.list);
router.get('/:patchId', ctrl.get);

module.exports = router;
