// This file is excluded by the fixture ignore file.
import express from 'express';
const app = express();
const router = express.Router();
router.get('/:id', (_req, res) => res.json({ id: 1 }));
app.use('/api/widgets', router);
