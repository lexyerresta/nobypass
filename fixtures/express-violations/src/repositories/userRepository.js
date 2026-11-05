import { prisma } from '../db/client.js';

export function findActiveUsers() {
  return prisma.user.findMany({ where: { active: true } });
}
