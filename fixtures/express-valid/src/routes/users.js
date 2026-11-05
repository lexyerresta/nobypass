import { Router } from 'express';
import { listUsers } from '../controllers/userController.js';

export const userRouter = Router();
userRouter.get('/', listUsers);
