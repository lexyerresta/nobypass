import { activeUsers } from '../services/userService.js';

export async function listUsers(req, res) {
  res.json(await activeUsers());
}
