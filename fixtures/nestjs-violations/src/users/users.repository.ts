import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive() {
    return this.prisma.user.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  }

  create(dto: CreateUserDto) {
    return this.prisma.user.create({ data: dto });
  }
}
