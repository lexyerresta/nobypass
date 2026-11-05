import { Body, Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UsersRepository } from './users.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  // "Quick fix" from an AI agent: read straight from Prisma in the controller.
  @Get()
  list() {
    return this.prisma.user.findMany({ where: { active: true } });
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.register(dto);
  }

  describe(repo: UsersRepository) {
    return repo.constructor.name;
  }
}
