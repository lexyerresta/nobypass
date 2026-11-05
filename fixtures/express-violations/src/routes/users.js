import { Router } from 'express';
import { listUsers } from '../controllers/userController.js';
import { activeUsers } from '../services/userService.js';

export const userRouter = Router();
userRouter.get('/', listUsers);
userRouter.get('/count', async (req, res) => res.json((await activeUsers()).length));
