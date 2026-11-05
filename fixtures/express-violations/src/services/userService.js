import { findActiveUsers } from '../repositories/userRepository.js';

export async function activeUsers() {
  try {
    return await findActiveUsers();
  } catch (error) {
    return [];
  }
}
