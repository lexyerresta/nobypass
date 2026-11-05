import { findActiveUsers } from '../repositories/userRepository.js';

export function activeUsers() {
  return findActiveUsers();
}
