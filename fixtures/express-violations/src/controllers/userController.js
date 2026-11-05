import { prisma } from '../db/client.js';

export async function listUsers(req, res) {
  // "Quick fix" from an AI agent: query straight from the controller.
  res.json(await prisma.user.findMany({ where: { active: true } }));
}
