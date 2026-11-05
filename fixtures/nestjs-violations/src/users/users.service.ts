import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersRepository } from './users.repository';

const prisma = new PrismaClient();

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  listActive() {
    return prisma.user.findMany({ where: { active: true } });
  }

  async register(dto: CreateUserDto) {
    try {
      return await this.repository.create(dto);
    } catch (error) {
      return null;
    }
  }
}
