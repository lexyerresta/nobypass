import express from 'express';
import { userRouter } from './routes/users.js';

export const app = express();
app.use('/users', userRouter);
